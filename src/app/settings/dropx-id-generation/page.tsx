import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { PendingLink } from "@/components/pending-link";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { IdGenerationForm } from "./id-generation-form";

type SettingType = "dropx_id" | "biometric_id";
type ScopeType = "company" | "category" | "model" | "location" | "designation";

type GenerationConfig = {
  label?: string | null;
  prefix?: string | null;
  separator?: string | null;
  suffix?: string | null;
  next_serial_no?: number | null;
  serial_digits?: number | null;
};

type SettingRow = {
  id: string;
  setting_type: SettingType;
  scope_type: ScopeType;
  configs: Record<string, GenerationConfig> | null;
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
  { id: "employee", code: "EMP", name: "Employees" },
  { id: "field_executive", code: "FE", name: "Field executives" },
  { id: "vendor", code: "VEN", name: "Vendors" },
  { id: "contractor", code: "IC", name: "Independent Contractor" },
  { id: "worker", code: "WRK", name: "Workers" }
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

async function loadData(companyId: string) {
  if (!supabaseAdmin) {
    return {
      designations: [] as OptionRow[],
      error: "Supabase service role key is not configured.",
      companyLabel: "Company",
      locations: [] as OptionRow[],
      models: [] as OptionRow[],
      settings: [] as SettingRow[]
    };
  }
  const [settingsResult, companyResult, locationsResult, modelsResult, designationsResult] = await Promise.all([
    (supabaseAdmin.from("dropx_id_generation_settings") as any)
      .select("id, setting_type, scope_type, configs, is_active, is_locked")
      .eq("company_id", companyId)
      .order("setting_type"),
    supabaseAdmin.from("companies").select("name, code").eq("id", companyId).maybeSingle(),
    supabaseAdmin.from("stations").select("id, station_code, station_name").eq("company_id", companyId).eq("is_active", true).order("station_code"),
    supabaseAdmin.from("location_models").select("id, code, name").eq("company_id", companyId).eq("is_active", true).order("code"),
    supabaseAdmin.from("designations").select("id, code, name").eq("company_id", companyId).eq("is_active", true).order("code")
  ]);
  const error = settingsResult.error?.message || companyResult.error?.message || locationsResult.error?.message || modelsResult.error?.message || designationsResult.error?.message || null;
  const companyRow = companyResult.data as { name?: string | null; code?: string | null } | null;
  return {
    designations: (designationsResult.data ?? []) as OptionRow[],
    error,
    companyLabel: companyRow?.name || companyRow?.code || "Company",
    locations: (locationsResult.data ?? []) as OptionRow[],
    models: (modelsResult.data ?? []) as OptionRow[],
    settings: (settingsResult.data ?? []) as SettingRow[]
  };
}

function selectedSettingType(value?: string): SettingType {
  return value === "biometric_id" ? "biometric_id" : "dropx_id";
}

export const dynamic = "force-dynamic";

export default async function DropxIdGenerationSettingsPage({ searchParams }: { searchParams?: { type?: string } }) {
  const authorization = await requirePagePermission("app_settings", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.app_settings;
  const { error: flashError, notice } = loadFlash();
  const data = await loadData(companyId);
  const settingByType = new Map(data.settings.map((setting) => [setting.setting_type, setting]));
  const currentType = selectedSettingType(searchParams?.type);
  const currentCard = settingCards.find((card) => card.type === currentType) ?? settingCards[0];

  return (
    <AppShell active="Settings" pageCode="app_settings">
      <PageHead
        eyebrow="Settings"
        title={`${currentCard.title} Generation`}
        subtitle="Choose one generation method, then configure only that method's structure."
      />

      <div className="id-generation-switch">
        <PendingLink className="button secondary compact" href="/settings/dropx-id-generation?type=dropx_id">DropX ID</PendingLink>
        <PendingLink className="button secondary compact" href="/settings/dropx-id-generation?type=biometric_id">Biometric ID</PendingLink>
      </div>

      {data.error || flashError || notice ? (
        <section className={`panel message-panel ${data.error || flashError ? "error" : "success"}`}>
          <div className="panel-body">
            <strong>{data.error || flashError ? "Action required" : "Completed"}</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{data.error || flashError || notice}</p>
          </div>
        </section>
      ) : null}

      <IdGenerationForm
        canEdit={permission.canAdd || permission.canEdit}
        categories={categories}
        companyLabel={data.companyLabel}
        defaultPrefix={currentCard.defaultPrefix}
        designations={data.designations}
        key={currentCard.type}
        locations={data.locations}
        models={data.models}
        setting={settingByType.get(currentCard.type)}
        subtitle={currentCard.subtitle}
        title={currentCard.title}
        type={currentCard.type}
      />
    </AppShell>
  );
}
