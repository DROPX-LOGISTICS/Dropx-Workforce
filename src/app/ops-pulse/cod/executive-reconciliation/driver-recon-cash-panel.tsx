"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { StatusPill } from "@/components/status-pill";
import { moneyValue, type CashReconAssociate, type CashReconRow } from "@/lib/ops-pulse/cash-recon-types";
import {
  driverReconCacheKey,
  readLatestDriverReconCache,
  writeDriverReconCache,
  type DriverReconClientPayload
} from "@/lib/ops-pulse/driver-recon-client-cache";

function currency(value: number) {
  return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function summarizePending(payload: {
  associates?: CashReconAssociate[];
  missingFromDer?: CashReconAssociate[];
  reconciliation?: CashReconRow[];
}) {
  const byId = new Map<string, { id: string; name: string; pending: number }>();

  const upsert = (idRaw: string, nameRaw: string, pendingRaw: number) => {
    const id = String(idRaw ?? "").trim().toUpperCase();
    if (!id || id === "__OTHER__") return;
    const pending = Number(pendingRaw) || 0;
    const name = String(nameRaw ?? "").trim() || id;
    const existing = byId.get(id);
    if (!existing || pending > existing.pending) {
      byId.set(id, { id, name, pending });
    }
  };

  for (const row of [...(payload.associates ?? []), ...(payload.missingFromDer ?? [])]) {
    upsert(row.providerEmployeeId, row.displayName || row.name, Number(row.pendingRecon) || 0);
  }

  if (!byId.size) {
    for (const row of payload.reconciliation ?? []) {
      upsert(
        String(row.driverInfo?.id ?? ""),
        String(row.driverInfo?.name ?? ""),
        moneyValue(row.paymentInfo?.overallPendingRecon)
      );
    }
  }

  const rows = Array.from(byId.values()).sort((a, b) => b.pending - a.pending || a.name.localeCompare(b.name));
  const pendingRows = rows.filter((row) => row.pending > 0.01);
  const pendingAmount = Number(pendingRows.reduce((sum, row) => sum + row.pending, 0).toFixed(2));
  return {
    driverCount: rows.length,
    pendingCount: pendingRows.length,
    pendingAmount,
    pendingRows,
    cleared: pendingRows.length === 0
  };
}

export function DriverReconCashPanel({
  stationCode,
  businessDate,
  locationId,
  canRefresh,
  cashSubmitted
}: {
  stationCode: string;
  businessDate: string;
  locationId: string;
  canRefresh: boolean;
  cashSubmitted: boolean;
}) {
  const cacheKey = useMemo(
    () => driverReconCacheKey({ stationCode, businessDate, locationId, baselineKey: "step2" }),
    [stationCode, businessDate, locationId]
  );
  // Also try the step-1 cache keys that may exist without knowing baselineKey.
  const [payload, setPayload] = useState<DriverReconClientPayload | null>(() =>
    readLatestDriverReconCache({ stationCode, businessDate, locationId })
  );
  const [loading, setLoading] = useState(!payload);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    if (!stationCode || !businessDate || !locationId) return;
    if (!force) {
      const cached = readLatestDriverReconCache({ stationCode, businessDate, locationId });
      if (cached) {
        setPayload(cached);
        setLoading(false);
        setError(null);
        return;
      }
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/ops-pulse/cod/cash-recon/driver-reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stationCode, date: businessDate, locationId, baselineAssociates: [] })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || `Unable to load driver recon (${response.status})`);
      const next: DriverReconClientPayload = {
        drivers: Array.isArray(body.drivers) ? body.drivers : [],
        reconciliation: Array.isArray(body.reconciliation) ? body.reconciliation : [],
        associates: Array.isArray(body.associates) ? body.associates : [],
        missingFromDer: Array.isArray(body.missingFromDer) ? body.missingFromDer : [],
        requiredForCashEntry: Array.isArray(body.requiredForCashEntry) ? body.requiredForCashEntry : [],
        expectedCash: body.expectedCash && typeof body.expectedCash === "object" ? body.expectedCash : null,
        sessionSource: body.sessionSource == null ? null : String(body.sessionSource)
      };
      writeDriverReconCache(cacheKey, next);
      setPayload(next);
      setCheckedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load driver reconciliation.");
    } finally {
      setLoading(false);
    }
  }, [businessDate, cacheKey, locationId, stationCode]);

  useEffect(() => {
    void load(false);
  }, [load]);

  const summary = useMemo(
    () => (payload ? summarizePending(payload) : null),
    [payload]
  );

  const statusLabel = loading
    ? "Loading…"
    : error
      ? "Check failed"
      : !summary
        ? "Not checked"
        : summary.cleared
          ? "Driver recon cleared"
          : `Pending recon · ${summary.pendingCount}`;

  const checkedLabel = checkedAt
    ? new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit" }).format(new Date(checkedAt))
    : payload
      ? "Cached"
      : "Not checked";

  return (
    <div className="driver-recon-cash-panel">
      <div className="portal-check-progress">
        <div>
          <span>Cash recon · Driver reconciliation</span>
          <strong>{statusLabel}</strong>
        </div>
        <div>
          <span>Pending drivers</span>
          <strong>{summary ? summary.pendingCount : "—"}</strong>
        </div>
        <div>
          <span>Pending amount</span>
          <strong>{summary ? `₹${currency(summary.pendingAmount)}` : "—"}</strong>
        </div>
        <div>
          <span>Last checked</span>
          <strong>{loading ? "Checking…" : checkedLabel}</strong>
        </div>
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <StatusPill status={statusLabel} />
        <span className="subtle">
          {payload?.sessionSource ? `Source · ${payload.sessionSource}` : "Uses /api/admin/executive/driver-reconciliation overallPendingRecon"}
        </span>
        <button
          className="button secondary"
          type="button"
          disabled={!canRefresh || loading || !cashSubmitted}
          onClick={() => { void load(true); }}
        >
          {loading ? "Checking…" : cashSubmitted ? "Recheck pending recon" : "Submit cash first"}
        </button>
      </div>

      {error ? (
        <p className="field-error">{error}</p>
      ) : null}

      {summary && summary.pendingRows.length ? (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Associate</th>
                <th>Driver ID</th>
                <th>Pending recon</th>
              </tr>
            </thead>
            <tbody>
              {summary.pendingRows.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.name}</strong></td>
                  <td>{row.id}</td>
                  <td>₹{currency(row.pending)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : summary && !loading ? (
        <p className="subtle" style={{ marginTop: 10 }}>
          No pending recon across {summary.driverCount} driver{summary.driverCount === 1 ? "" : "s"}.
        </p>
      ) : null}
    </div>
  );
}
