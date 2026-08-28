import { cookies } from "next/headers";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  Route,
  Search,
  ShieldCheck
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { saveDesignationRoute, updateRegisterMaster } from "./actions";

type RegisterRow = {
  id: string;
  code: string;
  name: string;
  table_name: string;
  profile_type: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
};

type DesignationRow = {
  id: string;
  code: string;
  name: string;
  designation_category_id: string | null;
  is_active: boolean;
};

type DesignationCategoryRow = {
  id: string;
  name: string;
  people_module: string;
};

type RouteRow = {
  id: string;
  designation_id: string;
  register_id: string | null;
  registration_enabled: boolean;
  reconciliation_status: string;
  last_reconciled_at: string | null;
  last_reconciliation: {
    moved?: number;
    retained?: number;
    failed?: number;
    failure_samples?: Array<{
      source_register?: string;
      source_profile_id?: string;
      error?: string;
    }>;
  } | null;
};

type CountRow = {
  designation_id: string;
  table_name: string;
  total_count: number;
  active_count: number;
};

type LegacyHelperRow = {
  designation: string | null;
  is_active: boolean;
};

const routingPath = "/delivery-network/designation-routing";

function loadFlash() {
  const raw = cookies().get("dropx_workforce_designation_routing_flash")?.value;
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

function formatDate(value: string | null) {
  if (!value) return "Not run";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function registerLabel(tableName: string) {
  const labels: Record<string, string> = {
    contractors: "Contractors",
    employees: "Employees",
    field_executives: "Field executives",
    vendors: "Vendors",
    workforce: "Workforce",
    workforce_helpers: "Helpers",
    workers: "Workers"
  };
  return labels[tableName] ?? tableName.replaceAll("_", " ");
}

export const dynamic = "force-dynamic";

export default async function WorkforceDesignationRoutingPage({
  searchParams
}: {
  searchParams?: { q?: string; status?: string };
}) {
  const authorization = await requirePagePermission("designations", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.designations;
  const flash = loadFlash();

  const [registerResult, designationResult, categoryResult, routeResult, countResult, helperResult] = supabaseAdmin
    ? await Promise.all([
      supabaseAdmin
        .from("workforce_register_master")
        .select("id, code, name, table_name, profile_type, description, is_active, sort_order")
        .eq("company_id", companyId)
        .order("sort_order"),
      supabaseAdmin
        .from("designations")
        .select("id, code, name, designation_category_id, is_active")
        .eq("company_id", companyId)
        .order("name"),
      supabaseAdmin
        .from("designation_categories")
        .select("id, name, people_module")
        .eq("company_id", companyId),
      supabaseAdmin
        .from("designation_register_routes")
        .select("id, designation_id, register_id, registration_enabled, reconciliation_status, last_reconciled_at, last_reconciliation")
        .eq("company_id", companyId),
      supabaseAdmin.rpc("designation_register_counts", { p_company_id: companyId }),
      supabaseAdmin
        .from("workforce_helpers")
        .select("designation, is_active")
        .eq("company_id", companyId)
    ])
    : [
      { data: null, error: { message: "Supabase service role key is not configured." } },
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null }
    ];

  const error = registerResult.error?.message || designationResult.error?.message || categoryResult.error?.message || routeResult.error?.message || countResult.error?.message || helperResult.error?.message || null;
  const workforceRegisterTables = new Set(["workforce", "vendors", "workers", "workforce_helpers"]);
  const registers = ((registerResult.data ?? []) as RegisterRow[]).filter((register) =>
    workforceRegisterTables.has(register.table_name)
  );
  const categoryRows = (categoryResult.data ?? []) as DesignationCategoryRow[];
  const categories = new Map(categoryRows.map((row) => [row.id, row.name]));
  const workforceCategoryIds = new Set(
    categoryRows.filter((row) => row.people_module === "delivery_network").map((row) => row.id)
  );
  const routes = new Map(((routeResult.data ?? []) as RouteRow[]).map((route) => [route.designation_id, route]));
  const registerById = new Map(registers.map((register) => [register.id, register]));
  const query = String(searchParams?.q ?? "").trim().toLowerCase();
  const requestedStatus = String(searchParams?.status ?? "all");
  const statusFilter = ["all", "mapped", "unmapped", "review"].includes(requestedStatus) ? requestedStatus : "all";
  const workforceDesignations = ((designationResult.data ?? []) as DesignationRow[]).filter((designation) =>
    Boolean(designation.designation_category_id && workforceCategoryIds.has(designation.designation_category_id))
  );
  const countsByDesignation = new Map<string, CountRow[]>();
  ((countResult.data ?? []) as CountRow[]).forEach((row) => {
    countsByDesignation.set(row.designation_id, [...(countsByDesignation.get(row.designation_id) ?? []), row]);
  });
  const legacyHelpers = (helperResult.data ?? []) as LegacyHelperRow[];
  workforceDesignations.forEach((designation) => {
    const matchingHelpers = legacyHelpers.filter((helper) => {
      const value = String(helper.designation ?? "").trim().toLowerCase();
      return value === designation.code.trim().toLowerCase() || value === designation.name.trim().toLowerCase();
    });
    if (!matchingHelpers.length) return;
    const currentRows = countsByDesignation.get(designation.id) ?? [];
    if (currentRows.some((row) => row.table_name === "workforce_helpers")) return;
    countsByDesignation.set(designation.id, [
      ...currentRows,
      {
        designation_id: designation.id,
        table_name: "workforce_helpers",
        total_count: matchingHelpers.length,
        active_count: matchingHelpers.filter((helper) => helper.is_active).length
      }
    ]);
  });
  const designations = workforceDesignations.filter((designation) => {
    const route = routes.get(designation.id);
    const mapped = Boolean(route?.register_id);
    if (statusFilter === "mapped" && !mapped) return false;
    if (statusFilter === "unmapped" && mapped) return false;
    if (statusFilter === "review" && !["needs_review", "failed"].includes(route?.reconciliation_status ?? "")) return false;
    return `${designation.code} ${designation.name} ${categories.get(designation.designation_category_id ?? "") ?? ""}`.toLowerCase().includes(query);
  });
  const unmappedCount = workforceDesignations.filter((designation) => !routes.get(designation.id)?.register_id).length;
  const mappedCount = workforceDesignations.length - unmappedCount;
  const reviewCount = workforceDesignations.filter((designation) => (
    ["needs_review", "failed"].includes(routes.get(designation.id)?.reconciliation_status ?? "")
  )).length;
  const totalProfileCount = Array.from(countsByDesignation.values()).reduce((total, rows) => (
    total + rows.reduce((rowTotal, row) => rowTotal + Number(row.total_count), 0)
  ), 0);

  return (
    <AppShell active="Designation Routing" pageCode="designations">
      <PageHead
        eyebrow="Workforce Master"
        title="Designation Routing"
        subtitle="Choose where every Workforce designation is stored. The same rule controls new onboarding and safely reconciles existing records."
      />

      {error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Routing Master is not ready</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{error}</p>
          </div>
        </section>
      ) : null}

      {!error && (flash.error || flash.notice) ? (
        <section className={`panel message-panel ${flash.error ? "error" : "success"}`}>
          <div className="panel-body">
            <strong>{flash.error ? "Action required" : "Completed"}</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{flash.error ?? flash.notice}</p>
          </div>
        </section>
      ) : null}

      {!error ? (
        <>
          <section className="wf-routing-health" aria-label="Routing health">
            <article><span><Route size={16} /></span><div><small>Mapped roles</small><strong>{mappedCount}<i>/ {workforceDesignations.length}</i></strong></div></article>
            <article><span><Database size={16} /></span><div><small>Profiles tracked</small><strong>{totalProfileCount}</strong></div></article>
            <article className={unmappedCount ? "warning" : "success"}><span>{unmappedCount ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}</span><div><small>Unmapped</small><strong>{unmappedCount}</strong></div></article>
            <article className={reviewCount ? "warning" : "success"}><span>{reviewCount ? <AlertTriangle size={16} /> : <ShieldCheck size={16} />}</span><div><small>Needs review</small><strong>{reviewCount}</strong></div></article>
          </section>

          <section className="wf-routing-destinations">
            <header>
              <div>
                <small>Destination master</small>
                <h2>Available Workforce registers</h2>
                <p>Display names can be changed here; physical table keys remain protected.</p>
              </div>
              <span><ShieldCheck size={14} /> Workforce-only</span>
            </header>
            <div>
              {registers.map((register) => (
                <form action={updateRegisterMaster} className="wf-register-card" key={register.id}>
                  <input name="register_id" type="hidden" value={register.id} />
                  <span className="wf-register-icon"><Database size={16} /></span>
                  <label>
                    <small>{register.code}</small>
                    <input
                      aria-label={`${register.code} register display name`}
                      className="field"
                      defaultValue={register.name}
                      name="name"
                      readOnly={!permission.canEdit}
                      required
                    />
                  </label>
                  <p>{register.description ?? `Profiles stored in ${register.table_name}.`}</p>
                  <footer>
                    <span>{register.table_name}</span>
                    <label className="wf-switch"><input defaultChecked={register.is_active} disabled={!permission.canEdit} name="is_active" type="checkbox" /><i /> Active</label>
                    {permission.canEdit ? <SubmitButton className="button secondary compact" pendingText="Saving">Save</SubmitButton> : null}
                  </footer>
                </form>
              ))}
            </div>
          </section>

          <section className="wf-routing-workspace">
            <header className="wf-routing-toolbar">
              <div>
                <small>Designation rules</small>
                <h2>Route roles to their register</h2>
                <p>{designations.length} of {workforceDesignations.length} roles shown</p>
              </div>
              <form action={routingPath} className="master-toolbar">
                <label className="wf-routing-search"><Search size={15} /><input aria-label="Search designations" className="field" defaultValue={searchParams?.q ?? ""} name="q" placeholder="Search designation" /></label>
                <select aria-label="Filter by routing status" className="select" defaultValue={statusFilter} name="status">
                  <option value="all">All statuses</option>
                  <option value="mapped">Mapped</option>
                  <option value="unmapped">Unmapped</option>
                  <option value="review">Needs review</option>
                </select>
                <button className="button secondary compact" type="submit">Filter</button>
              </form>
            </header>
            <div className="wf-route-list">
              {designations.length ? designations.map((designation) => {
                    const route = routes.get(designation.id);
                    const register = route?.register_id ? registerById.get(route.register_id) : null;
                    const currentCounts = (countsByDesignation.get(designation.id) ?? []).filter((row) => Number(row.total_count) > 0);
                    const reconciliation = route?.last_reconciliation ?? {};
                    const failureSamples = reconciliation.failure_samples ?? [];
                    return (
                      <article className="wf-route-card" key={designation.id}>
                        <header>
                          <div className="wf-route-title">
                            <span>{designation.code}</span>
                            <div><strong>{designation.name}</strong><small>{categories.get(designation.designation_category_id ?? "") ?? "Uncategorised"}</small></div>
                          </div>
                          <span className={designation.is_active ? "wf-role-state active" : "wf-role-state"}>{designation.is_active ? "Active" : "Inactive"}</span>
                        </header>

                        <div className="wf-route-flow">
                          <section className="wf-route-source">
                            <small>1 · Current footprint</small>
                          {currentCounts.length ? (
                            <div className="routing-record-stack">
                              {currentCounts.map((row) => (
                                <span className="routing-record-count" key={row.table_name}>
                                  <strong>{registerLabel(row.table_name)}</strong>
                                  <small>{Number(row.total_count)} profiles · {Number(row.active_count)} active</small>
                                </span>
                              ))}
                            </div>
                          ) : <span className="routing-empty">No existing profiles</span>}
                          </section>

                          <ArrowRight className="wf-route-arrow" size={17} />

                          <section className="wf-route-target">
                            <small>2 · Canonical destination</small>
                          <form action={saveDesignationRoute} className="routing-target-form" id={`route-${designation.id}`}>
                            <input name="designation_id" type="hidden" value={designation.id} />
                            <select aria-label={`Canonical destination for ${designation.name}`} className="select" defaultValue={route?.register_id ?? ""} disabled={!permission.canEdit} name="register_id">
                              <option value="">Unmapped — registration blocked</option>
                              {registers.filter((item) => item.is_active || item.id === route?.register_id).map((item) => (
                                <option key={item.id} value={item.id}>{item.name}</option>
                              ))}
                            </select>
                            <label className="wf-switch"><input defaultChecked={Boolean(route?.registration_enabled)} disabled={!permission.canEdit} name="registration_enabled" type="checkbox" /><i /> Accept new registrations</label>
                          </form>
                          <p>{register ? `New profiles are written to ${register.name}.` : "Choose a destination before onboarding this role."}</p>
                          </section>

                          <ArrowRight className="wf-route-arrow" size={17} />

                          <section className="wf-route-health">
                            <small>3 · Cutover health</small>
                          <div className="routing-reconciliation">
                            <StatusPill status={(route?.reconciliation_status ?? "unmapped").replaceAll("_", " ")} />
                            <small>{formatDate(route?.last_reconciled_at ?? null)}</small>
                            {route?.last_reconciled_at ? (
                              <span className="routing-result">
                                <strong>{reconciliation.moved ?? 0}</strong> moved
                                <i aria-hidden="true">·</i>
                                <strong className={(reconciliation.failed ?? 0) > 0 ? "has-failures" : ""}>{reconciliation.failed ?? 0}</strong> failed
                              </span>
                            ) : null}
                            {failureSamples.length ? (
                              <details className="routing-failure-details">
                                <summary>View failure reason</summary>
                                {failureSamples.slice(0, 2).map((failure, index) => (
                                  <p key={`${failure.source_register ?? "source"}-${failure.source_profile_id ?? index}`}>
                                    <strong>{registerLabel(failure.source_register ?? "record")}</strong>
                                    <span>{failure.error ?? "Reconciliation failed."}</span>
                                  </p>
                                ))}
                              </details>
                            ) : null}
                          </div>
                          </section>
                        </div>

                        <footer>
                          <p><ShieldCheck size={14} /> Existing IDs, invitations and saved drafts are retained during reconciliation.</p>
                          {permission.canEdit ? (
                            <SubmitButton
                              className="button compact"
                              confirmDescription="Existing profiles are reconciled into the selected register. IDs, invitations, drafts and verification history remain attached."
                              confirmMessage={`Save the route for ${designation.name} and reconcile its existing records?`}
                              confirmSubmitText="Save and reconcile"
                              confirmTitle="Confirm register routing"
                              form={`route-${designation.id}`}
                              pendingText="Reconciling"
                            >
                              Save route & reconcile
                            </SubmitButton>
                          ) : null}
                        </footer>
                      </article>
                    );
                  }) : (
                    <div className="wf-route-empty"><Search size={18} /><strong>No matching designations</strong><p>Try another search or status filter.</p></div>
                  )}
            </div>
          </section>
        </>
      ) : null}
    </AppShell>
  );
}
