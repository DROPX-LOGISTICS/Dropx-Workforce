import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { PendingLink } from "@/components/pending-link";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createDropxIdGenerationSetting, updateDropxIdGenerationSetting } from "./actions";

type RuleRow = {
  id: string;
  category: string;
  scope_type: string;
  scope_key: string;
  scope_label: string | null;
  prefix: string | null;
  separator: string;
  suffix: string | null;
  next_serial_no: number;
  serial_digits: number;
  is_active: boolean;
  is_locked: boolean;
};

type OptionRow = {
  id: string;
  code?: string | null;
  name?: string | null;
  station_code?: string | null;
  station_name?: string | null;
};

const categories = [
  { value: "employee", label: "Employees" },
  { value: "field_executive", label: "Field executives" },
  { value: "vendor", label: "Vendors" },
  { value: "contractor", label: "Contractors" },
  { value: "worker", label: "Workers" }
];

const scopeTypes = [
  { value: "category", label: "Category wise" },
  { value: "model", label: "Model wise" },
  { value: "location", label: "Location wise" },
  { value: "designation", label: "Designation wise" }
];

function loadFlash() {
  const raw = cookies().get("dropx_id_generation_flash")?.value;
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

function optionLabel(row: OptionRow) {
  return [row.code ?? row.station_code, row.name ?? row.station_name].filter(Boolean).join(" - ") || row.id;
}

function categoryLabel(value: string) {
  return categories.find((category) => category.value === value)?.label ?? value;
}

function scopeTypeLabel(value: string) {
  return scopeTypes.find((scope) => scope.value === value)?.label ?? value;
}

function formatSample(rule: Pick<RuleRow, "prefix" | "separator" | "suffix" | "next_serial_no" | "serial_digits">) {
  const serial = String(rule.next_serial_no).padStart(rule.serial_digits, "0");
  return `${rule.prefix ?? ""}${rule.prefix ? rule.separator ?? "" : ""}${serial}${rule.suffix ? `${rule.separator ?? ""}${rule.suffix}` : ""}`;
}

function scopeLabel(rule: RuleRow, maps: { designations: Map<string, string>; locations: Map<string, string>; models: Map<string, string> }) {
  if (rule.scope_type === "category") return categoryLabel(rule.scope_key);
  if (rule.scope_label) return rule.scope_label;
  if (rule.scope_type === "designation") return maps.designations.get(rule.scope_key) ?? rule.scope_key;
  if (rule.scope_type === "location") return maps.locations.get(rule.scope_key) ?? rule.scope_key;
  if (rule.scope_type === "model") return maps.models.get(rule.scope_key) ?? rule.scope_key;
  return rule.scope_key;
}

async function loadData(companyId: string) {
  if (!supabaseAdmin) {
    return {
      designations: [] as OptionRow[],
      error: "Supabase service role key is not configured.",
      locations: [] as OptionRow[],
      models: [] as OptionRow[],
      rules: [] as RuleRow[]
    };
  }
  const [rulesResult, locationsResult, modelsResult, designationsResult] = await Promise.all([
    (supabaseAdmin.from("dropx_id_generation_settings") as any)
      .select("id, category, scope_type, scope_key, scope_label, prefix, separator, suffix, next_serial_no, serial_digits, is_active, is_locked")
      .eq("company_id", companyId)
      .order("category")
      .order("scope_type"),
    supabaseAdmin.from("stations").select("id, station_code, station_name").eq("company_id", companyId).eq("is_active", true).order("station_code"),
    supabaseAdmin.from("location_models").select("id, code, name").eq("company_id", companyId).eq("is_active", true).order("code"),
    supabaseAdmin.from("designations").select("id, code, name").eq("company_id", companyId).eq("is_active", true).order("code")
  ]);
  const error = rulesResult.error?.message || locationsResult.error?.message || modelsResult.error?.message || designationsResult.error?.message || null;
  return {
    designations: (designationsResult.data ?? []) as OptionRow[],
    error,
    locations: (locationsResult.data ?? []) as OptionRow[],
    models: (modelsResult.data ?? []) as OptionRow[],
    rules: (rulesResult.data ?? []) as RuleRow[]
  };
}

function RuleForm({
  canEdit,
  designations,
  locations,
  models,
  rule
}: {
  canEdit: boolean;
  designations: OptionRow[];
  locations: OptionRow[];
  models: OptionRow[];
  rule?: RuleRow | null;
}) {
  const action = rule ? updateDropxIdGenerationSetting : createDropxIdGenerationSetting;
  const locked = Boolean(rule?.is_locked);
  const disabled = !canEdit || locked;
  return (
    <form action={action} className="form-grid three">
      {rule ? <input name="id" type="hidden" value={rule.id} /> : null}
      <label>Category
        <select className="select" defaultValue={rule?.category ?? "employee"} disabled={disabled} name="category" required>
          {categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
        </select>
      </label>
      <label>Generation basis
        <select className="select" defaultValue={rule?.scope_type ?? "category"} disabled={disabled} name="scope_type" required>
          {scopeTypes.map((scope) => <option key={scope.value} value={scope.value}>{scope.label}</option>)}
        </select>
      </label>
      <label>Status
        <select className="select" defaultValue={rule?.is_active === false ? "false" : "true"} disabled={disabled} name="is_active">
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </label>
      <label>Model scope
        <select className="select" defaultValue={rule?.scope_type === "model" ? rule.scope_key : ""} disabled={disabled} name="model_id">
          <option value="">Select only for model wise</option>
          {models.map((model) => <option key={model.id} value={model.id}>{optionLabel(model)}</option>)}
        </select>
      </label>
      <label>Location scope
        <select className="select" defaultValue={rule?.scope_type === "location" ? rule.scope_key : ""} disabled={disabled} name="location_id">
          <option value="">Select only for location wise</option>
          {locations.map((location) => <option key={location.id} value={location.id}>{optionLabel(location)}</option>)}
        </select>
      </label>
      <label>Designation scope
        <select className="select" defaultValue={rule?.scope_type === "designation" ? rule.scope_key : ""} disabled={disabled} name="designation_id">
          <option value="">Select only for designation wise</option>
          {designations.map((designation) => <option key={designation.id} value={designation.id}>{optionLabel(designation)}</option>)}
        </select>
      </label>
      <label>Prefix<input className="field" defaultValue={rule?.prefix ?? ""} disabled={disabled} name="prefix" placeholder="DROPX" /></label>
      <label>Separator<input className="field" defaultValue={rule?.separator ?? ""} disabled={disabled} name="separator" placeholder="- or blank" /></label>
      <label>Suffix<input className="field" defaultValue={rule?.suffix ?? ""} disabled={disabled} name="suffix" placeholder="Optional" /></label>
      <label>Starting serial no.<input className="field" defaultValue={rule?.next_serial_no ?? 1} disabled={disabled} min={1} name="next_serial_no" required type="number" /></label>
      <label>Decimal places<input className="field" defaultValue={rule?.serial_digits ?? 3} disabled={disabled} max={12} min={1} name="serial_digits" required type="number" /></label>
      <div className="id-generation-preview">
        <span>Sample</span>
        <strong>{formatSample(rule ?? { prefix: "DROPX", separator: "", suffix: null, next_serial_no: 1, serial_digits: 3 })}</strong>
      </div>
      {locked ? <p className="inline-error span-3">This rule is locked because it has already generated a DropX ID.</p> : null}
      <div className="form-actions span-3 align-right">
        {rule ? <PendingLink className="button secondary" href="/settings/dropx-id-generation">Cancel</PendingLink> : null}
        <SubmitButton disabled={disabled}>{rule ? "Save changes" : "Save rule"}</SubmitButton>
      </div>
    </form>
  );
}

export const dynamic = "force-dynamic";

export default async function DropxIdGenerationSettingsPage({ searchParams }: { searchParams?: { edit?: string } }) {
  const authorization = await requirePagePermission("app_settings", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.app_settings;
  const { error: flashError, notice } = loadFlash();
  const data = await loadData(companyId);
  const editRule = searchParams?.edit ? data.rules.find((rule) => rule.id === searchParams.edit) ?? null : null;
  const maps = {
    designations: new Map(data.designations.map((row) => [row.id, optionLabel(row)])),
    locations: new Map(data.locations.map((row) => [row.id, optionLabel(row)])),
    models: new Map(data.models.map((row) => [row.id, optionLabel(row)]))
  };

  return (
    <AppShell active="Settings" pageCode="app_settings">
      <PageHead
        eyebrow="Settings"
        title="DropX ID Generation"
        subtitle="Configure automatic DropX ID formats by category, model, location, or designation."
      />

      {data.error || flashError || notice ? (
        <section className={`panel message-panel ${data.error || flashError ? "error" : "success"}`}>
          <div className="panel-body">
            <strong>{data.error || flashError ? "Action required" : "Completed"}</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{data.error || flashError || notice}</p>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>{editRule ? "Edit generation rule" : "Add generation rule"}</h2>
            <p className="subtle">Rules are checked as designation, location, model, then category. Once used, a rule is locked.</p>
          </div>
        </div>
        <div className="panel-body">
          <RuleForm canEdit={permission.canAdd || permission.canEdit} designations={data.designations} locations={data.locations} models={data.models} rule={editRule} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Generation rules</h2>
            <p className="subtle">{data.rules.length} configured rules</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Basis</th>
                <th>Scope</th>
                <th>Structure</th>
                <th>Next serial</th>
                <th>Status</th>
                <th>Lock</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.rules.length ? data.rules.map((rule) => (
                <tr key={rule.id}>
                  <td>{categoryLabel(rule.category)}</td>
                  <td>{scopeTypeLabel(rule.scope_type)}</td>
                  <td>{scopeLabel(rule, maps)}</td>
                  <td><strong>{formatSample(rule)}</strong></td>
                  <td>{rule.next_serial_no}</td>
                  <td><StatusPill status={rule.is_active ? "Active" : "Inactive"} /></td>
                  <td>{rule.is_locked ? <StatusPill status="Locked" /> : <StatusPill status="Draft" />}</td>
                  <td>{!rule.is_locked && permission.canEdit ? <PendingLink className="button secondary compact" href={`/settings/dropx-id-generation?edit=${rule.id}`}>Edit</PendingLink> : "-"}</td>
                </tr>
              )) : (
                <tr><td className="empty-cell" colSpan={8}>No DropX ID generation rules added yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
