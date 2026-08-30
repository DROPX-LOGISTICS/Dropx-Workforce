import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import {
  ProviderMappingWorksheet,
  type LocationOption,
  type MappingWorksheetRow,
  type ProviderPendingMappingRow,
  type PaymentMethodOption
} from "@/components/provider-mapping-worksheet";
import { type AuthorizationContext, requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { firstDesignationBusinessCategory } from "@/lib/designation-business-categories";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadWorkforceEarnings, workforceToday } from "@/lib/workforce-earnings";

type LocationRow = {
  id: string;
  station_code: string;
  station_name: string | null;
  provider_id: string | null;
};

type WorkforceRow = {
  id: string;
  full_name: string;
  date_of_join: string;
  location_id: string;
  dropx_id: string | null;
  designation_id: string;
  source_profile_type: string;
  source_profile_id: string;
};

type DeliveryNetworkDesignationRow = {
  id: string;
  code: string;
  name: string;
  designation_category?: unknown;
};

type MappingRow = {
  id: string;
  workforce_id: string | null;
  field_executive_id: string | null;
  employee_id: string | null;
  contractor_id: string | null;
  provider_member_id: string;
  provider_id: string;
  station_id: string | null;
  effective_from: string;
  effective_to: string | null;
  payment_method_id: string | null;
  payment_values: Record<string, number | string> | null;
  pay_type: string;
  delivery_rate: number | string | null;
  pickup_rate: number | string | null;
  mfn_rate: number | string | null;
  mfn_return_rate: number | string | null;
  guarantee_amount: number | string | null;
  guarantee_schedule: string | null;
  fuel_rate: number | string | null;
  reason: string | null;
  status: string;
};

type PaymentMethodRow = {
  id: string;
  code: string;
  name: string;
  payment_method_components?: Array<{
    component_code: string;
    component_type: "amount" | "production";
    label: string;
    sort_order: number;
  }> | null;
};

function amountValue(value: number | string | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function isWorkforceSourceType(value: string) {
  return value === "canonical" || value === "employee" || value === "contractor" || value === "field_executive";
}

function loadFlashMessage() {
  const raw = cookies().get("dropx_provider_mapping_flash")?.value;
  if (!raw) return { error: null as string | null, notice: null as string | null };

  try {
    const parsed = JSON.parse(raw) as { error?: unknown; notice?: unknown };
    return {
      error: typeof parsed.error === "string" ? parsed.error : null,
      notice: typeof parsed.notice === "string" ? parsed.notice : null
    };
  } catch {
    return { error: null, notice: null };
  }
}

async function loadMappingData(authorization: AuthorizationContext) {
  if (!supabaseAdmin) {
    return {
      locations: [] as LocationOption[],
      mappings: [] as MappingWorksheetRow[],
      paymentMethods: [] as PaymentMethodOption[],
      error: "Supabase service role key is not configured."
    };
  }

  const companyId = requireCompanyId(authorization);
  const [locationsResult, workforceResult, designationsResult, mappingsResult, paymentMethodsResult] = await Promise.all([
    supabaseAdmin
      .from("stations")
      .select("id, station_code, station_name, provider_id")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("station_code"),
    supabaseAdmin
      .from("workforce")
      .select("id, full_name, date_of_join, location_id, dropx_id, designation_id, source_profile_type, source_profile_id")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .neq("migration_state", "reclassified")
      .not("dropx_id", "is", null)
      .order("full_name"),
    supabaseAdmin
      .from("designations")
      .select("id, code, name, designation_category:designation_categories!designations_designation_category_id_fkey(id, code, name, people_module, is_active)")
      .eq("company_id", companyId)
      .eq("is_active", true),
    supabaseAdmin
      .from("field_executive_provider_mappings")
      .select(`
        id,
        workforce_id,
        field_executive_id,
        employee_id,
        contractor_id,
        provider_id,
        station_id,
        provider_member_id,
        effective_from,
        effective_to,
        payment_method_id,
        payment_values,
        pay_type,
        delivery_rate,
        pickup_rate,
        mfn_rate,
        mfn_return_rate,
        guarantee_amount,
        guarantee_schedule,
        fuel_rate,
        reason,
        status
      `)
      .eq("company_id", companyId)
      .neq("status", "cancelled")
      .order("effective_from", { ascending: false })
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("payment_methods")
      .select(`
        id,
        code,
        name,
        payment_method_components (
          component_code,
          component_type,
          label,
          sort_order
        )
      `)
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("code")
  ]);

  const paymentMethods = ((paymentMethodsResult.data ?? []) as PaymentMethodRow[]).map((method) => ({
    id: method.id,
    code: method.code,
    name: method.name,
    components: (method.payment_method_components ?? [])
      .slice()
      .sort((first, second) => first.sort_order - second.sort_order)
      .map((component) => ({
        code: component.component_code,
        label: component.label,
        type: component.component_type
      }))
  }));
  const locationRows = (locationsResult.data ?? []) as LocationRow[];
  const locationProviderById = new Map(locationRows.map((location) => [location.id, location.provider_id ?? ""]));
  const locations = locationRows.map((location) => ({
    id: location.id,
    label: location.station_name && location.station_name !== location.station_code
      ? `${location.station_code} - ${location.station_name}`
      : location.station_code,
    providerId: location.provider_id ?? undefined
  }));
  const latestMappingByWorkerKey = new Map<string, MappingRow>();
  ((mappingsResult.data ?? []) as MappingRow[]).forEach((mapping) => {
    const key = mapping.workforce_id
      ? `workforce:${mapping.workforce_id}`
      : mapping.employee_id
      ? `employee:${mapping.employee_id}`
      : mapping.contractor_id
        ? `contractor:${mapping.contractor_id}`
        : `field_executive:${mapping.field_executive_id}`;
    if (!latestMappingByWorkerKey.has(key)) {
      latestMappingByWorkerKey.set(key, mapping);
    }
  });

  const deliveryNetworkDesignations = ((designationsResult.data ?? []) as DeliveryNetworkDesignationRow[])
    .filter((designation) => firstDesignationBusinessCategory(designation.designation_category)?.people_module === "delivery_network");
  const deliveryNetworkDesignationIds = new Set(deliveryNetworkDesignations.map((designation) => designation.id));
  const workers = ((workforceResult.data ?? []) as WorkforceRow[])
    .filter((worker) =>
      isWorkforceSourceType(worker.source_profile_type) &&
      deliveryNetworkDesignationIds.has(worker.designation_id) &&
      Boolean(worker.dropx_id?.trim())
    )
    .map((worker) => ({
      id: worker.id,
      workforceId: worker.id,
      sourceType: "workforce" as const,
      legacySourceType: worker.source_profile_type,
      legacySourceId: worker.source_profile_id,
      fullName: worker.full_name,
      dateOfJoin: worker.date_of_join,
      locationId: worker.location_id,
      dropxId: worker.dropx_id!.trim().toUpperCase()
    }));

  const mappings = workers.map((worker) => {
      const mapping = latestMappingByWorkerKey.get(`workforce:${worker.workforceId}`)
        ?? latestMappingByWorkerKey.get(`${worker.legacySourceType}:${worker.legacySourceId}`);
      const stationId = mapping?.station_id ?? worker.locationId;
      return {
      id: worker.id,
      workforceId: worker.workforceId,
      sourceType: worker.sourceType,
      mappingId: mapping?.id ?? "",
      dropxId: worker.dropxId,
      dropxName: worker.fullName,
      providerMemberId: mapping?.provider_member_id ?? "",
      providerId: mapping?.provider_id ?? locationProviderById.get(stationId) ?? "",
      stationId,
      effectiveFrom: mapping?.effective_from ?? worker.dateOfJoin,
      effectiveTo: mapping?.effective_to ?? "",
      paymentMethodId: mapping?.payment_method_id ?? "",
      paymentValues: Object.fromEntries(Object.entries(mapping?.payment_values ?? {}).map(([key, value]) => [key, amountValue(value)])),
      deliveryRate: amountValue(mapping?.delivery_rate),
      pickupRate: amountValue(mapping?.pickup_rate),
      mfnRate: amountValue(mapping?.mfn_rate),
      mfnReturnRate: amountValue(mapping?.mfn_return_rate),
      guaranteeAmount: amountValue(mapping?.guarantee_amount),
      guaranteeSchedule: mapping?.guarantee_schedule ?? "",
      fuelRate: amountValue(mapping?.fuel_rate),
      reason: mapping?.reason ?? ""
    };
  });

  return {
    locations,
    mappings,
    paymentMethods,
    error: mappingsResult.error?.message || workforceResult.error?.message || designationsResult.error?.message || locationsResult.error?.message || paymentMethodsResult.error?.message || null
  };
}

export async function ProviderMappingPageContent({
  active = "ID & Rate Mapping",
  eyebrow = "Source-of-truth bridge",
  pageCode = "provider_mapping",
  subtitle = "Maintain Delivery Network IDs, provider member IDs, date-effective history, payout methods and partner rates.",
  title = "ID & pay mapping"
}: {
  active?: string;
  eyebrow?: string;
  pageCode?: string;
  subtitle?: string;
  title?: string;
}) {
  const authorization = await requirePagePermission(pageCode, "access");
  const permission = authorization.permissions[pageCode];
  const today = workforceToday();
  const monthStart = `${today.slice(0, 8)}01`;
  const [{ locations, mappings, paymentMethods, error }, earnings] = await Promise.all([
    loadMappingData(authorization),
    loadWorkforceEarnings(authorization, monthStart, today)
  ]);
  const pendingByProviderId = new Map<string, ProviderPendingMappingRow>();
  earnings.lines.filter((line) => line.sourceType === "shipment" && line.status === "unmapped").forEach((line) => {
    const key = `${line.providerId ?? line.providerName}:${line.stationCode}:${line.providerMemberId}`;
    const current = pendingByProviderId.get(key) ?? {
      id: key,
      providerMemberId: line.providerMemberId,
      providerName: line.providerName,
      sourceName: line.workerName,
      stationCode: line.stationCode,
      firstSeen: line.workDate,
      lastSeen: line.workDate,
      dailyRows: 0,
      deliveries: 0,
      reason: line.holdReasons.join(" · ")
    };
    current.firstSeen = current.firstSeen < line.workDate ? current.firstSeen : line.workDate;
    current.lastSeen = current.lastSeen > line.workDate ? current.lastSeen : line.workDate;
    current.dailyRows += 1;
    current.deliveries += line.totalDelivery;
    pendingByProviderId.set(key, current);
  });
  const providerPending = Array.from(pendingByProviderId.values()).sort((left, right) => right.deliveries - left.deliveries || left.providerMemberId.localeCompare(right.providerMemberId));
  const flash = loadFlashMessage();
  const flashError = flash.error;
  const flashNotice = flash.notice;
  const canEditWorksheet = pageCode === "provider_mapping" && (permission.canAdd || permission.canEdit);

  return (
    <AppShell active={active} pageCode={pageCode}>
      <PageHead
        eyebrow={eyebrow}
        title={title}
        subtitle={subtitle}
      />

      {error || flashError || flashNotice ? (
        <section
          className={`panel message-panel ${error || flashError ? "error" : "success"}`}
          id={!error && !flashError && flashNotice ? "provider-mapping-success" : undefined}
        >
          <div className="panel-body">
            <strong>{error || flashError ? "Action required" : "Completed"}</strong>
            <p className="subtle" style={{ marginTop: 6 }}>
              {error ?? flashError ?? flashNotice}
              {error?.includes("field_executive_provider_mappings")
                ? " Run scripts/provider_id_mappings_v1.sql in Supabase SQL Editor."
                : error?.includes("field_executives") ? " Run scripts/field_executives_v1.sql in Supabase SQL Editor." : ""}
            </p>
          </div>
        </section>
      ) : null}

      {(permission.canView || permission.canAdd || permission.canEdit) && !error ? (
        <ProviderMappingWorksheet
          canEdit={canEditWorksheet && !error}
          locations={locations}
          mappings={mappings}
          paymentMethods={paymentMethods}
          providerPending={providerPending}
          providerPendingPeriod={`${monthStart} to ${today}`}
        />
      ) : null}
    </AppShell>
  );
}
