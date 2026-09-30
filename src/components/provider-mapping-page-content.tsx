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
import { hasWorkforcePaymentIdentity } from "@/lib/workforce-register-designations";
import { componentRuleLabel, type PaymentComponentRule } from "@/lib/payment-component-rules";

type LocationRow = {
  id: string;
  station_code: string;
  station_name: string | null;
  provider_id: string | null;
  providers?: { name?: string | null } | Array<{ name?: string | null }> | null;
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
  updated_at: string;
};

type PaymentMethodRow = {
  id: string;
  code: string;
  name: string;
  payment_method_components?: Array<{
    payment_field_id: string;
    component_code: string;
    component_type: "amount" | "production";
    label: string;
    sort_order: number;
  }> | null;
  workforce_payment_method_designations?: Array<{ designation_id: string }> | null;
};

function amountValue(value: number | string | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
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

async function loadMappingData(authorization: AuthorizationContext, workforceId?: string) {
  if (!supabaseAdmin) {
    return {
      locations: [] as LocationOption[],
      mappings: [] as MappingWorksheetRow[],
      paymentMethods: [] as PaymentMethodOption[],
      error: "Supabase service role key is not configured."
    };
  }

  const companyId = requireCompanyId(authorization);
  const [locationsResult, workforceResult, designationsResult, mappingsResult, paymentMethodsResult, paymentSourcesResult] = await Promise.all([
    supabaseAdmin
      .from("stations")
      .select("id, station_code, station_name, provider_id, providers (name)")
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
        status,
        updated_at
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
          payment_field_id,
          component_code,
          component_type,
          label,
          sort_order
        ),
        workforce_payment_method_designations (
          designation_id
        )
      `)
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("code"),
    supabaseAdmin.from("workforce_payment_method_component_sources")
      .select("payment_method_id,payment_field_id,source_of_truth,calculation_basis,source_metric,minimum_units").eq("company_id",companyId)
  ]);

  if (!authorization.hasAllLocationAccess) {
    locationsResult.data = (locationsResult.data ?? []).filter((row) => authorization.locationScopeIds.includes(row.id));
    workforceResult.data = (workforceResult.data ?? []).filter((row) => authorization.locationScopeIds.includes(row.location_id));
    const visibleWorkforce = new Set((workforceResult.data ?? []).map((row) => row.id));
    mappingsResult.data = (mappingsResult.data ?? []).filter((row) => visibleWorkforce.has(row.workforce_id) && (!row.station_id || authorization.locationScopeIds.includes(row.station_id)));
  }
  const deliveryNetworkDesignations = ((designationsResult.data ?? []) as DeliveryNetworkDesignationRow[])
    .filter((designation) => firstDesignationBusinessCategory(designation.designation_category)?.people_module === "delivery_network");
  const deliveryNetworkDesignationIds = new Set(deliveryNetworkDesignations.map((designation) => designation.id));
  const designationById = new Map(deliveryNetworkDesignations.map((designation) => [designation.id, designation]));
  const sourceByComponent=new Map((paymentSourcesResult.data??[]).map(row=>[`${row.payment_method_id}:${row.payment_field_id}`,row]));
  const paymentMethods = ((paymentMethodsResult.data ?? []) as PaymentMethodRow[]).map((method) => ({
    id: method.id,
    code: method.code,
    name: method.name,
    designationIds: (method.workforce_payment_method_designations ?? []).map((rule) => rule.designation_id),
    designationCodes: (method.workforce_payment_method_designations ?? []).map((rule) => designationById.get(rule.designation_id)?.code).filter((code): code is string => Boolean(code)),
    components: (method.payment_method_components ?? [])
      .slice()
      .sort((first, second) => first.sort_order - second.sort_order)
      .map((component) => {
        const rule=sourceByComponent.get(`${method.id}:${component.payment_field_id}`);
        return {code:component.component_code,label:component.label,type:component.component_type,
          ruleLabel:rule?componentRuleLabel({sourceOfTruth:rule.source_of_truth as PaymentComponentRule["sourceOfTruth"],calculationBasis:rule.calculation_basis as PaymentComponentRule["calculationBasis"],sourceMetric:rule.source_metric as PaymentComponentRule["sourceMetric"],minimumUnits:rule.minimum_units}):"Earning rule required"};
      })
  }));
  const locationRows = (locationsResult.data ?? []) as LocationRow[];
  const locationProviderById = new Map(locationRows.map((location) => [location.id, location.provider_id ?? ""]));
  const locations = locationRows.map((location) => ({
    id: location.id,
    label: location.station_name && location.station_name !== location.station_code
      ? `${location.station_code} - ${location.station_name}`
      : location.station_code,
    providerId: location.provider_id ?? undefined,
    providerName: (Array.isArray(location.providers) ? location.providers[0]?.name : location.providers?.name) ?? "Unassigned client"
  }));
  const mappingHistoryByWorkerKey = new Map<string, MappingRow[]>();
  ((mappingsResult.data ?? []) as MappingRow[]).forEach((mapping) => {
    const key = mapping.workforce_id
      ? `workforce:${mapping.workforce_id}`
      : mapping.employee_id
      ? `employee:${mapping.employee_id}`
      : mapping.contractor_id
        ? `contractor:${mapping.contractor_id}`
        : `field_executive:${mapping.field_executive_id}`;
    mappingHistoryByWorkerKey.set(key, [...(mappingHistoryByWorkerKey.get(key) ?? []), mapping]);
  });

  const workers = ((workforceResult.data ?? []) as WorkforceRow[])
    .filter((worker) => hasWorkforcePaymentIdentity(worker, deliveryNetworkDesignationIds))
    .map((worker) => ({
      id: worker.id,
      workforceId: worker.id,
      sourceType: "workforce" as const,
      legacySourceType: worker.source_profile_type,
      legacySourceId: worker.source_profile_id,
      fullName: worker.full_name,
      dateOfJoin: worker.date_of_join,
      locationId: worker.location_id,
      dropxId: worker.dropx_id!.trim().toUpperCase(),
      designationId: worker.designation_id,
      designationCode: designationById.get(worker.designation_id)?.code ?? "",
      designationName: designationById.get(worker.designation_id)?.name ?? ""
    }));

  const mappings = workers.map((worker) => {
      const history = [
        ...(mappingHistoryByWorkerKey.get(`workforce:${worker.workforceId}`) ?? []),
        ...(mappingHistoryByWorkerKey.get(`${worker.legacySourceType}:${worker.legacySourceId}`) ?? [])
      ].filter((period, index, all) => all.findIndex((candidate) => candidate.id === period.id) === index)
        .sort((first, second) => second.effective_from.localeCompare(first.effective_from));
      const mapping = history[0];
      const stationId = mapping?.station_id ?? worker.locationId;
      const paymentPeriods = mapping ? history.filter((period) =>
        period.provider_id === mapping.provider_id
        && period.provider_member_id === mapping.provider_member_id
        && period.station_id === mapping.station_id
      ).map((period) => ({
        id: period.id,
        providerMemberId: period.provider_member_id,
        effectiveFrom: period.effective_from,
        effectiveTo: period.effective_to ?? "",
        paymentMethodId: period.payment_method_id ?? "",
        paymentValues: Object.fromEntries(Object.entries(period.payment_values ?? {}).filter(([key]) => !key.startsWith("DROPX_")).map(([key, value]) => [key, amountValue(value as number|string|null)])),
        payType: period.pay_type,
        reason: period.reason ?? "",
        updatedAt: period.updated_at
      })) : [];
      return {
      id: worker.id,
      workforceId: worker.workforceId,
      sourceType: worker.sourceType,
      mappingId: mapping?.id ?? "",
      dropxId: worker.dropxId,
      dropxName: worker.fullName,
      designationId: worker.designationId,
      designationCode: worker.designationCode,
      designationName: worker.designationName,
      providerMemberId: mapping?.provider_member_id ?? "",
      providerId: mapping?.provider_id ?? locationProviderById.get(stationId) ?? "",
      stationId,
      effectiveFrom: mapping?.effective_from ?? worker.dateOfJoin,
      effectiveTo: mapping?.effective_to ?? "",
      paymentMethodId: mapping?.payment_method_id ?? "",
      paymentValues: Object.fromEntries(Object.entries(mapping?.payment_values ?? {}).filter(([key])=>!key.startsWith("DROPX_")).map(([key, value]) => [key, amountValue(value as number|string|null)])),
      deliveryRate: amountValue(mapping?.delivery_rate),
      pickupRate: amountValue(mapping?.pickup_rate),
      mfnRate: amountValue(mapping?.mfn_rate),
      mfnReturnRate: amountValue(mapping?.mfn_return_rate),
      guaranteeAmount: amountValue(mapping?.guarantee_amount),
      guaranteeSchedule: mapping?.guarantee_schedule ?? "",
      fuelRate: amountValue(mapping?.fuel_rate),
      reason: mapping?.reason ?? "",
      paymentPeriods
    };
  });

  return {
    locations,
    mappings: workforceId ? mappings.filter((row) => row.workforceId === workforceId) : mappings,
    paymentMethods,
    error: mappingsResult.error?.message || workforceResult.error?.message || designationsResult.error?.message || locationsResult.error?.message || paymentMethodsResult.error?.message || paymentSourcesResult.error?.message || null
  };
}

export async function ProviderMappingPageContent({
  active = "ID & Rate Mapping",
  eyebrow = "Source-of-truth bridge",
  pageCode = "provider_mapping",
  subtitle = "Maintain Delivery Network IDs, provider member IDs, date-effective history, payout methods and partner rates.",
  title = "ID & pay mapping", embedded = false, workforceId, initialStation
}: {
  active?: string;
  eyebrow?: string;
  pageCode?: string;
  subtitle?: string;
  title?: string;
  embedded?: boolean;
  workforceId?: string;
  initialStation?: string;
}) {
  const authorization = await requirePagePermission(pageCode, "access");
  const permission = authorization.permissions[pageCode];
  const today = workforceToday();
  const monthStart = `${today.slice(0, 8)}01`;
  const { locations, mappings, paymentMethods, error: mappingError } = await loadMappingData(authorization, workforceId);
  const orphanResult = !embedded && supabaseAdmin ? await supabaseAdmin.rpc("workforce_unmapped_provider_ids", {p_company:requireCompanyId(authorization),p_locations:authorization.hasAllLocationAccess?null:authorization.locationScopeIds}) : {data:[],error:null};
  const error=mappingError || (orphanResult.error ? `Unmapped provider IDs could not be loaded: ${orphanResult.error.message}` : null);
  const providerPending:ProviderPendingMappingRow[]=(orphanResult.data??[]).map((row:any)=>({id:`${row.provider_id}:${row.station_code}:${row.provider_member_id}`,providerMemberId:row.provider_member_id,providerName:row.provider_name,sourceName:row.source_name||"",stationCode:row.station_code,firstSeen:row.first_seen,lastSeen:row.last_seen,dailyRows:Number(row.daily_rows),deliveries:Number(row.deliveries),reason:"Provider ID from shipment imports has no confirmed DropX mapping."}));
  const matchKey=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,"");
  for(const pending of providerPending){const candidates=mappings.filter(row=>matchKey(row.dropxName)===matchKey(pending.sourceName)&&locations.find(location=>location.id===row.stationId)?.label.split(" - ")[0]===pending.stationCode);if(candidates.length===1){pending.suggestedWorkforceId=candidates[0].workforceId;pending.suggestedDropxId=candidates[0].dropxId;pending.suggestedName=candidates[0].dropxName;}}
  const flash = loadFlashMessage();
  const flashError = flash.error;
  const flashNotice = flash.notice;
  const canEditWorksheet = pageCode === "provider_mapping" && (permission.canAdd || permission.canEdit);

  const content = <>
      {!embedded ?
      <PageHead
        eyebrow={eyebrow}
        title={title}
        subtitle={subtitle}
      /> : null}

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
          embedded={embedded}
          initialStation={locations.find(location=>location.id===initialStation || location.label.split(' - ')[0]===initialStation)?.id ?? ''}
          canEdit={canEditWorksheet && !error}
          locations={locations}
          mappings={workforceId ? mappings.filter(row=>row.workforceId===workforceId) : mappings}
          paymentMethods={paymentMethods}
          providerPending={providerPending}
          providerPendingPeriod="All imported shipment history"
        />
      ) : null}
    </>;
  return embedded ? content : <AppShell active={active} pageCode={pageCode}>{content}</AppShell>;
}
