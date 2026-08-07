import {
  buildCashReconAssociates,
  buildRequiredCashAssociates,
  isLiabilityClear,
  moneyValue,
  normalizeNonZeroFields,
  type BaselineAssociate,
  type CashReconDriver,
  type CashReconRow,
  type DriverReconciliationNormalized,
  type ExpectedCashSummary,
  type LiabilitySummaryNormalized,
  type RemittanceRowNormalized,
  type RemittanceSummaryNormalized
} from "@/lib/ops-pulse/cash-recon-types";

function workerConfig() {
  const baseUrl = (process.env.CASH_RECON_WORKER_URL || process.env.NEXT_PUBLIC_CASH_RECON_WORKER_URL || "").trim().replace(/\/$/, "");
  const adminKey = (process.env.CASH_RECON_ADMIN_KEY || process.env.X_ADMIN_KEY || "").trim().replace(/^["']|["']$/g, "");
  return { baseUrl, adminKey };
}

export function isCashReconWorkerConfigured() {
  const { baseUrl, adminKey } = workerConfig();
  return Boolean(baseUrl && adminKey);
}

async function postWorkerOnce<T>(path: string, body: { stationCode: string; date: string }): Promise<T> {
  const { baseUrl, adminKey } = workerConfig();
  if (!baseUrl || !adminKey) {
    throw new Error("Cash recon worker is not configured. Set CASH_RECON_WORKER_URL and CASH_RECON_ADMIN_KEY.");
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": adminKey
    },
    body: JSON.stringify({
      stationCode: body.stationCode.trim().toUpperCase(),
      date: body.date
    }),
    cache: "no-store"
  });

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload
      ? String((payload as { message?: unknown }).message)
      : payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : text || `Cash recon worker returned ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

function isTransientPortalSessionError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("session expired")
    || normalized.includes("unauthorized")
    || normalized.includes("not authenticated");
}

async function postWorker<T>(path: string, body: { stationCode: string; date: string }): Promise<T> {
  try {
    return await postWorkerOnce<T>(path, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // First hit after idle often races Amazon portal login; one retry usually succeeds.
    if (!isTransientPortalSessionError(message)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return postWorkerOnce<T>(path, body);
  }
}

type RawDriverReconciliation = {
  status?: string;
  stationCode?: string;
  date?: string;
  sessionSource?: string | null;
  drivers?: CashReconDriver[];
  driverCount?: number;
  reconciliation?: CashReconRow[];
  reconciliationCount?: number;
  expectedCash?: ExpectedCashSummary | null;
};

export async function fetchDriverReconciliation(params: {
  stationCode: string;
  date: string;
  baselineAssociates?: BaselineAssociate[];
}): Promise<DriverReconciliationNormalized> {
  const raw = await postWorker<RawDriverReconciliation>("/api/admin/executive/driver-reconciliation", params);
  const drivers = Array.isArray(raw.drivers) ? raw.drivers : [];
  const reconciliation = Array.isArray(raw.reconciliation) ? raw.reconciliation : [];
  const expectedCash = raw.expectedCash && typeof raw.expectedCash === "object"
    ? {
        totalReceived: moneyValue(raw.expectedCash.totalReceived),
        shipmentCount: Number(raw.expectedCash.shipmentCount ?? 0) || 0,
        byDriver: Array.isArray(raw.expectedCash.byDriver) ? raw.expectedCash.byDriver : [],
        cashShipments: Array.isArray(raw.expectedCash.cashShipments) ? raw.expectedCash.cashShipments : []
      }
    : null;
  const { associates, missingFromDer } = buildCashReconAssociates(
    drivers,
    reconciliation,
    params.baselineAssociates ?? [],
    expectedCash
  );
  const requiredForCashEntry = buildRequiredCashAssociates(
    reconciliation,
    associates,
    missingFromDer,
    drivers,
    expectedCash
  );

  return {
    status: String(raw.status ?? "ok"),
    stationCode: String(raw.stationCode ?? params.stationCode).toUpperCase(),
    date: String(raw.date ?? params.date),
    sessionSource: raw.sessionSource == null ? null : String(raw.sessionSource),
    driverCount: Number(raw.driverCount ?? drivers.length) || drivers.length,
    reconciliationCount: Number(raw.reconciliationCount ?? reconciliation.length) || reconciliation.length,
    associates,
    missingFromDer,
    requiredForCashEntry,
    reconciliation,
    expectedCash
  };
}

type RawLiabilitySummary = {
  status?: string;
  stationCode?: string;
  date?: string;
  summary?: {
    cashSummary?: {
      expectedAmount?: { value?: number };
      actualAmount?: { value?: number };
      shortExcessAmount?: { value?: number };
      count?: number;
    };
    mposSummary?: {
      amount?: { value?: number };
      count?: number;
    };
  };
  check?: {
    passed?: boolean;
    nonZeroFields?: unknown[];
  };
};

export async function fetchLiabilitySummary(params: {
  stationCode: string;
  date: string;
}): Promise<LiabilitySummaryNormalized> {
  const raw = await postWorker<RawLiabilitySummary>("/api/admin/executive/liability-summary", params);
  const cash = raw.summary?.cashSummary;
  const mpos = raw.summary?.mposSummary;
  const cashSummary = {
    expectedAmount: moneyValue(cash?.expectedAmount),
    actualAmount: moneyValue(cash?.actualAmount),
    shortExcessAmount: moneyValue(cash?.shortExcessAmount),
    count: Number(cash?.count ?? 0) || 0
  };
  // Gate only on cash summary. MPOS / worker check.passed are informational.
  const clear = isLiabilityClear(cashSummary);

  return {
    status: String(raw.status ?? "ok"),
    stationCode: String(raw.stationCode ?? params.stationCode).toUpperCase(),
    date: String(raw.date ?? params.date),
    cashSummary,
    mposSummary: {
      amount: moneyValue(mpos?.amount),
      count: Number(mpos?.count ?? 0) || 0
    },
    check: {
      passed: clear,
      nonZeroFields: normalizeNonZeroFields(raw.check?.nonZeroFields)
    },
    isClear: clear
  };
}

type RawRemittanceRow = {
  remittanceCode?: string | null;
  remittanceId?: string | null;
  creationDate?: number | null;
  lastUpdated?: number | null;
  submissionDate?: number | null;
  createdBy?: string | null;
  submittedBy?: string | null;
  status?: string | null;
  expectedAmount?: { unit?: string | null; value?: number | null } | null;
  actualAmount?: { unit?: string | null; value?: number | null } | null;
  paymentMethod?: string | null;
  variance?: { unit?: string | null; value?: number | null } | null;
  ttLink?: string | null;
  stationVariance?: {
    transactionId?: string | null;
    isVerified?: boolean | null;
    stationVarianceList?: Array<{
      amount?: { unit?: string | null; value?: number | null } | null;
      reason?: string | null;
      type?: string | null;
    }> | null;
  } | null;
};

type RawRemittanceSummary = {
  status?: string;
  stationCode?: string;
  date?: string;
  sessionSource?: string | null;
  accountKey?: string | null;
  remittanceTotalCash?: number | { value?: number } | null;
  created?: RawRemittanceRow[];
  createdCount?: number;
  createdTotal?: number | { value?: number } | null;
  submitted?: RawRemittanceRow[];
  submittedCount?: number;
  submittedTotal?: number | { value?: number } | null;
  remittanceCodes?: string[];
  dateRange?: {
    startTime?: number | null;
    endTime?: number | null;
  } | null;
  summary?: {
    status?: string | null;
    mode?: string | null;
    window?: { from?: string | null; to?: string | null } | null;
    sameDayExpectedCashTotal?: number | { value?: number } | null;
    sameDayRemittanceTotalCash?: number | { value?: number } | null;
    sameDayShortAmount?: number | { value?: number } | null;
    finalPendingTotal?: number | { value?: number } | null;
    limitedByRemittanceWindow?: boolean | null;
  } | null;
  ledger?: Array<{
    date?: string | null;
    expectedCashTotal?: number | { value?: number } | null;
    remittanceTotalCash?: number | { value?: number } | null;
    shortAmount?: number | { value?: number } | null;
    carryForwardIn?: number | { value?: number } | null;
    carryForwardOut?: number | { value?: number } | null;
    clearedSameDayAmount?: number | { value?: number } | null;
    forwardedAmount?: number | { value?: number } | null;
    stillPendingAmount?: number | { value?: number } | null;
    clearedFromPriorAmount?: number | { value?: number } | null;
    drivers?: Array<{
      driverName?: string | null;
      tasId?: string | null;
      employeeId?: string | number | null;
      amount?: number | { value?: number } | null;
      shipmentCount?: number | null;
      shipments?: Array<{
        trackingId?: string | null;
        shipmentNo?: string | null;
        pendingAmount?: number | { value?: number } | null;
        keptOnDate?: string | null;
        clearedOnDate?: string | null;
        keptDays?: number | null;
        status?: string | null;
        remittanceId?: string | null;
        remittanceCode?: string | null;
      }> | null;
    }> | null;
  }> | null;
};

function mapRemittanceRow(row: RawRemittanceRow): RemittanceRowNormalized {
  const varianceList = Array.isArray(row.stationVariance?.stationVarianceList)
    ? row.stationVariance.stationVarianceList.map((item) => ({
        amount: moneyValue(item?.amount),
        reason: String(item?.reason ?? "").trim() || "-",
        type: String(item?.type ?? "").trim() || "-"
      }))
    : [];
  return {
    remittanceCode: String(row.remittanceCode ?? "").trim(),
    remittanceId: String(row.remittanceId ?? "").trim(),
    creationDate: typeof row.creationDate === "number" ? row.creationDate : null,
    lastUpdated: typeof row.lastUpdated === "number" ? row.lastUpdated : null,
    submissionDate: typeof row.submissionDate === "number" ? row.submissionDate : null,
    createdBy: row.createdBy == null ? null : String(row.createdBy),
    submittedBy: row.submittedBy == null ? null : String(row.submittedBy),
    status: String(row.status ?? "").trim() || "-",
    expectedAmount: moneyValue(row.expectedAmount),
    actualAmount: moneyValue(row.actualAmount),
    paymentMethod: row.paymentMethod == null ? null : String(row.paymentMethod),
    variance: moneyValue(row.variance),
    ttLink: row.ttLink == null ? null : String(row.ttLink),
    transactionId: row.stationVariance?.transactionId == null ? null : String(row.stationVariance.transactionId),
    isVerified: typeof row.stationVariance?.isVerified === "boolean" ? row.stationVariance.isVerified : null,
    stationVarianceList: varianceList
  };
}

function mapRemittanceLedger(raw: RawRemittanceSummary["ledger"]): RemittanceSummaryNormalized["ledger"] {
  if (!Array.isArray(raw)) return [];
  return raw.map((day) => ({
    date: String(day?.date ?? "").trim(),
    expectedCashTotal: moneyValue(day?.expectedCashTotal),
    remittanceTotalCash: moneyValue(day?.remittanceTotalCash),
    shortAmount: moneyValue(day?.shortAmount),
    carryForwardIn: moneyValue(day?.carryForwardIn),
    carryForwardOut: moneyValue(day?.carryForwardOut),
    clearedSameDayAmount: moneyValue(day?.clearedSameDayAmount),
    forwardedAmount: moneyValue(day?.forwardedAmount),
    stillPendingAmount: moneyValue(day?.stillPendingAmount),
    clearedFromPriorAmount: moneyValue(day?.clearedFromPriorAmount),
    drivers: Array.isArray(day?.drivers)
      ? day.drivers.map((driver) => ({
          driverName: String(driver?.driverName ?? "").trim() || "Unknown driver",
          tasId: driver?.tasId == null ? null : String(driver.tasId),
          employeeId: driver?.employeeId == null || driver.employeeId === "" ? null : String(driver.employeeId),
          amount: moneyValue(driver?.amount),
          shipmentCount: Number(driver?.shipmentCount ?? 0) || 0,
          shipments: Array.isArray(driver?.shipments)
            ? driver.shipments.map((shipment) => ({
                trackingId: String(shipment?.trackingId ?? "").trim() || "-",
                shipmentNo: String(shipment?.shipmentNo ?? "").trim(),
                pendingAmount: moneyValue(shipment?.pendingAmount),
                keptOnDate: shipment?.keptOnDate == null ? null : String(shipment.keptOnDate),
                clearedOnDate: shipment?.clearedOnDate == null ? null : String(shipment.clearedOnDate),
                keptDays: typeof shipment?.keptDays === "number" ? shipment.keptDays : null,
                status: String(shipment?.status ?? "").trim() || "-",
                remittanceId: shipment?.remittanceId == null ? null : String(shipment.remittanceId),
                remittanceCode: shipment?.remittanceCode == null ? null : String(shipment.remittanceCode)
              }))
            : []
        }))
      : []
  }));
}

export async function fetchRemittance(params: {
  stationCode: string;
  date: string;
}): Promise<RemittanceSummaryNormalized> {
  const raw = await postWorker<RawRemittanceSummary>("/api/admin/executive/remittance", params);
  const created = Array.isArray(raw.created) ? raw.created.map(mapRemittanceRow) : [];
  const submitted = Array.isArray(raw.submitted) ? raw.submitted.map(mapRemittanceRow) : [];
  const matchSummary = raw.summary && typeof raw.summary === "object"
    ? {
        status: String(raw.summary.status ?? "").trim().toUpperCase() || "UNKNOWN",
        mode: String(raw.summary.mode ?? "").trim() || "sameDay",
        windowFrom: raw.summary.window?.from == null ? null : String(raw.summary.window.from),
        windowTo: raw.summary.window?.to == null ? null : String(raw.summary.window.to),
        sameDayExpectedCashTotal: moneyValue(raw.summary.sameDayExpectedCashTotal),
        sameDayRemittanceTotalCash: moneyValue(raw.summary.sameDayRemittanceTotalCash),
        sameDayShortAmount: moneyValue(raw.summary.sameDayShortAmount),
        finalPendingTotal: moneyValue(raw.summary.finalPendingTotal),
        limitedByRemittanceWindow: Boolean(raw.summary.limitedByRemittanceWindow)
      }
    : null;
  return {
    status: String(raw.status ?? "ok"),
    stationCode: String(raw.stationCode ?? params.stationCode).toUpperCase(),
    date: String(raw.date ?? params.date),
    sessionSource: raw.sessionSource == null ? null : String(raw.sessionSource),
    accountKey: raw.accountKey == null ? null : String(raw.accountKey),
    remittanceTotalCash: moneyValue(raw.remittanceTotalCash),
    created,
    createdCount: Number(raw.createdCount ?? created.length) || created.length,
    createdTotal: moneyValue(raw.createdTotal),
    submitted,
    submittedCount: Number(raw.submittedCount ?? submitted.length) || submitted.length,
    submittedTotal: moneyValue(raw.submittedTotal),
    remittanceCodes: Array.isArray(raw.remittanceCodes)
      ? raw.remittanceCodes.map((code) => String(code ?? "").trim()).filter(Boolean)
      : [...new Set([...created, ...submitted].map((row) => row.remittanceCode).filter(Boolean))],
    dateRange: {
      startTime: typeof raw.dateRange?.startTime === "number" ? raw.dateRange.startTime : null,
      endTime: typeof raw.dateRange?.endTime === "number" ? raw.dateRange.endTime : null
    },
    matchSummary,
    ledger: mapRemittanceLedger(raw.ledger)
  };
}
