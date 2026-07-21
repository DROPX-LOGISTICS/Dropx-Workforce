import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { StatusPill } from "@/components/status-pill";
import { SubmitButton } from "@/components/submit-button";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { saveIdGenerationSetting } from "./actions";

type SettingType = "dropx_id" | "biometric_id";
type ScopeType = "category" | "model" | "location" | "designation";

type SettingRow = {
  id: string;
  setting_type: SettingType;
  scope_type: ScopeType;
  configs: Record<string, GenerationConfig> | null;
  is_active: boolean;
  is_locked: boolean;
};

type GenerationConfig = {
  label?: string | null;
  prefix?: string | null;
  separator?: string | null;
  suffix?: string | null;
  next_serial_no?: number | null;
  serial_digits?: number | null;
};

type OptionRow = {
  id: string;
  code?: string | null;
  name?: string | null;
  station_code?: string | null;
  station_name?: string | null;
};

const categories = [
  { id: "employee", code: "EMP", name: "Employees" },
  { id: "field_executive", code: "FE", name: "Field executives" },
  { id: "vendor", code: "VEN", name: "Vendors" },
  { id: "contractor", code: "CON", name: "Contractors" },
  { id: "worker", code: "WRK", name: "Workers" }
];

const scopeTypes: Array<{ value: ScopeType; label: string }> = [
  { value: "category", label: "Category wise" },
  { value: "model", label: "Model wise" },
  { value: "location", label: "Location wise" },
  { value: "designation", label: "Designation wise" }
];

const settingCards: Array<{ type: SettingType; title: string; subtitle: string; defaultPrefix: string }> = [
  {
    type: "dropx_id",
    title: "DropX ID",
    subtitle: "Configure the worker code used as Employee ID or Field Executive ID.",
    defaultPrefix: "DROPX"
  },
  {
    type: "biometric_id",
    title: "Biometric ID",
    subtitle: "Configure the biometric enrolment ID series.",
    defaultPrefix: ""
  }
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

function defaultConfig(label: string, defaultPrefix: string): GenerationConfig {
  return {
    label,
    prefix: defaultPrefix,
    separator: defaultPrefix ? "" : "",
    suffix: null,
    next_serial_no: 1,
    serial_digits: defaultPrefix ? 3 : 1
  };
}

function formatSample(config: GenerationConfig) {
  const prefix = config.prefix ?? "";
  const separator = config.separator ?? "";
  const suffix = config.suffix ?? "";
  const serial = String(config.next_serial_no ?? 1).padStart(config.serial_digits ?? 3, "0");
  return `${prefix}${prefix ? separator : ""}${serial}${suffix ? `${separator}${suffix}` : ""}`;
}

async function loadData(companyId: string) {
  if (!supabaseAdmin) {
    return {
      designations: [] as OptionRow[],
      error: "Supabase service role key is not configured.",
      locations: [] as OptionRow[],
      models: [] as OptionRow[],
      settings: [] as SettingRow[]
    };
  }
  const [settingsResult, locationsResult, modelsResult, designationsResult] = await Promise.all([
    (supabaseAdmin.from("dropx_id_generation_settings") as any)
      .select("id, setting_type, scope_type, configs, is_active, is_locked")
      .eq("company_id", companyId)
      .order("setting_type"),
    supabaseAdmin.from("stations").select("id, station_code, station_name").eq("company_id", companyId).eq("is_active", true).order("station_code"),
    supabaseAdmin.from("location_models").select("id, code, name").eq("company_id", companyId).eq("is_active", true).order("code"),
    supabaseAdmin.from("designations").select("id, code, name").eq("company_id", companyId).eq("is_active", true).order("code")
  ]);
  const error = settingsResult.error?.message || locationsResult.error?.message || modelsResult.error?.message || designationsResult.error?.message || null;
  return {
    designations: (designationsResult.data ?? []) as OptionRow[],
    error,
    locations: (locationsResult.data ?? []) as OptionRow[],
    models: (modelsResult.data ?? []) as OptionRow[],
    settings: (settingsResult.data ?? []) as SettingRow[]
  };
}

function ConfigRows({
  defaultPrefix,
  options,
  scope,
  setting
}: {
  defaultPrefix: string;
  options: OptionRow[];
  scope: ScopeType;
  setting?: SettingRow;
}) {
  return (
    <div className="id-generation-scope-block">
      <h4>{scopeTypes.find((item) => item.value === scope)?.label}</h4>
      <div className="id-generation-row-head">
        <span>Item</span>
        <span>Prefix</span>
        <span>Separator</span>
        <span>Serial</span>
        <span>Digits</span>
        <span>Suffix</span>
        <span>Sample</span>
      </div>
      {options.map((option) => {
        const label = optionLabel(option);
        const config = setting?.configs?.[option.id] ?? defaultConfig(label, defaultPrefix);
        return (
          <div className="id-generation-row" key={`${scope}-${option.id}`}>
            <input name="row_scope" type="hidden" value={scope} />
            <input name="row_key" type="hidden" value={option.id} />
            <input name="row_label" type="hidden" value={label} />
            <strong>{label}</strong>
            <input className="field" defaultValue={config.prefix ?? ""} name="row_prefix" placeholder="Prefix" />
            <input className="field" defaultValue={config.separator ?? ""} name="row_separator" placeholder="-" />
            <input className="field" defaultValue={config.next_serial_no ?? 1} min={1} name="row_next_serial_no" type="number" />
            <input className="field" defaultValue={config.serial_digits ?? 3} max={12} min={1} name="row_serial_digits" type="number" />
            <input className="field" defaultValue={config.suffix ?? ""} name="row_suffix" placeholder="Optional" />
            <code>{formatSample(config)}</code>
          </div>
        );
      })}
    </div>
  );
}

function SettingCard({
  canEdit,
  defaultPrefix,
  designations,
  locations,
  models,
  setting,
  subtitle,
  title,
  type
}: {
  canEdit: boolean;
  defaultPrefix: string;
  designations: OptionRow[];
  locations: OptionRow[];
  models: OptionRow[];
  setting?: SettingRow;
  subtitle: string;
  title: string;
  type: SettingType;
}) {
  const locked = Boolean(setting?.is_locked);
  const disabled = !canEdit || locked;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          <p className="subtle">{subtitle}</p>
        </div>
        <div className="status-stack">
          <StatusPill status={setting?.is_active === false ? "Inactive" : "Active"} />
          {locked ? <StatusPill status="Locked" /> : <StatusPill status="Editable" />}
        </div>
      </div>
      <div className="panel-body">
        <form action={saveIdGenerationSetting}>
          <input name="setting_type" type="hidden" value={type} />
          <div className="form-grid three">
            <label>Generation method
              <select className="select" defaultValue={setting?.scope_type ?? "category"} disabled={disabled} name="scope_type" required>
                {scopeTypes.map((scope) => <option key={scope.value} value={scope.value}>{scope.label}</option>)}
              </select>
            </label>
            <label>Status
              <select className="select" defaultValue={setting?.is_active === false ? "false" : "true"} disabled={disabled} name="is_active">
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
          </div>

          <div className="id-generation-note">
            Only the selected generation method will be saved. Existing generated IDs lock this setting from further editing.
          </div>

          <ConfigRows defaultPrefix={defaultPrefix} options={categories} scope="category" setting={setting} />
          <ConfigRows defaultPrefix={defaultPrefix} options={models} scope="model" setting={setting} />
          <ConfigRows defaultPrefix={defaultPrefix} options={locations} scope="location" setting={setting} />
          <ConfigRows defaultPrefix={defaultPrefix} options={designations} scope="designation" setting={setting} />

          {locked ? <p className="inline-error">This setting is locked because it has already generated an ID.</p> : null}
          <div className="form-actions align-right">
            <SubmitButton disabled={disabled}>Save {title}</SubmitButton>
          </div>
        </form>
      </div>
    </section>
  );
}

export const dynamic = "force-dynamic";

export default async function DropxIdGenerationSettingsPage() {
  const authorization = await requirePagePermission("app_settings", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.app_settings;
  const { error: flashError, notice } = loadFlash();
  const data = await loadData(companyId);
  const settingByType = new Map(data.settings.map((setting) => [setting.setting_type, setting]));

  return (
    <AppShell active="Settings" pageCode="app_settings">
      <PageHead
        eyebrow="Settings"
        title="ID Generation"
        subtitle="Configure one method for DropX ID and one method for Biometric ID."
      />

      {data.error || flashError || notice ? (
        <section className={`panel message-panel ${data.error || flashError ? "error" : "success"}`}>
          <div className="panel-body">
            <strong>{data.error || flashError ? "Action required" : "Completed"}</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{data.error || flashError || notice}</p>
          </div>
        </section>
      ) : null}

      {settingCards.map((card) => (
        <SettingCard
          canEdit={permission.canAdd || permission.canEdit}
          defaultPrefix={card.defaultPrefix}
          designations={data.designations}
          key={card.type}
          locations={data.locations}
          models={data.models}
          setting={settingByType.get(card.type)}
          subtitle={card.subtitle}
          title={card.title}
          type={card.type}
        />
      ))}
    </AppShell>
  );
}
