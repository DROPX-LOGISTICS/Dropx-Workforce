import { AppShell } from "@/components/app-shell";
import { ImportMasterPanel } from "@/components/import-master-panel";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { ReportImportMaster } from "@/lib/report-import-master";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export default async function ImportMasterPage() {
  const authorization = await requirePagePermission("imports", "access");
  const companyId = requireCompanyId(authorization);
  const result = supabaseAdmin
    ? await supabaseAdmin
      .from("report_import_master")
      .select("id, source_code, name, description, file_types, day_offset, upload_time, frequency, weekday, parser_type, dedupe_fields, is_active, requires_station, station_scope, requires_report_date, report_date_label, date_default_offset")
      .eq("company_id", companyId)
      .neq("parser_type", "performance_target")
      .order("name")
    : { data: null, error: { message: "Supabase service key is not configured." } };

  return (
    <AppShell active="Import Master" pageCode="imports">
      <PageHead
        eyebrow="Master Data"
        title="Import Master"
        subtitle="Configure report names, schedules, accepted files and duplicate rules."
        action={<span className={`status-pill ${isSupabaseAdminConfigured ? "good" : "warn"}`}>{isSupabaseAdminConfigured ? "Connected" : "Database unavailable"}</span>}
      />
      {result.error ? (
        <section className="panel message-panel error"><div className="panel-body"><strong>{result.error.message}</strong></div></section>
      ) : <ImportMasterPanel reports={((result.data ?? []) as ReportImportMaster[]).filter((report) => report.file_types.length > 0)} />}
    </AppShell>
  );
}
