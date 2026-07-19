import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { StatusPill } from "@/components/status-pill";
import { requirePagePermission } from "@/lib/authorization";
import { aiValidationChecklists } from "@/lib/ops-pulse/cod";
import { isSupabaseAdminConfigured } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export default async function AiConnectorPage() {
  await requirePagePermission("ai_connector", "access");
  const apiConfigured = Boolean(process.env.OPENAI_API_KEY);
  const validationEnabled = String(process.env.OPS_AI_VALIDATION_ENABLED ?? "false").toLowerCase() === "true";
  const model = process.env.OPENAI_VALIDATION_MODEL || "gpt-4o-mini";

  return (
    <AppShell active="Settings" pageCode="ai_connector">
      <PageHead
        eyebrow="Configuration"
        title="AI Connector"
        subtitle="Central connector for AI validation of station COD and EOD proof uploads."
        action={<span className={`status-pill ${isSupabaseAdminConfigured ? "good" : "warn"}`}>{isSupabaseAdminConfigured ? "Database connected" : "Database key missing"}</span>}
      />

      <section className="summary-grid">
        <div className="metric-card"><span>Connector</span><strong>{apiConfigured ? "Ready" : "Not set"}</strong><small>OPENAI_API_KEY</small></div>
        <div className="metric-card"><span>Validation</span><strong>{validationEnabled ? "Enabled" : "Paused"}</strong><small>OPS_AI_VALIDATION_ENABLED</small></div>
        <div className="metric-card"><span>Model</span><strong>{model}</strong><small>Used for proof checks</small></div>
        <div className="metric-card"><span>Storage</span><strong>{isSupabaseAdminConfigured ? "Ready" : "Missing"}</strong><small>Supabase service role</small></div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Validation rules</h2>
            <p className="subtle">These are the live rules the AI worker should use when documents are submitted. The worker can be connected after the API key is added in Vercel.</p>
          </div>
          <StatusPill status={apiConfigured && validationEnabled ? "Enabled" : "Manual Review"} />
        </div>
        <div className="panel-body split-grid">
          <div>
            <h3>Daily Submission</h3>
            <ul className="subtle-list">
              {aiValidationChecklists.daily_submission.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <div>
            <h3>COD Submission</h3>
            <ul className="subtle-list">
              {aiValidationChecklists.cod_submission.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
