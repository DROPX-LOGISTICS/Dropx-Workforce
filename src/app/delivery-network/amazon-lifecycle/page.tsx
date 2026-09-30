import {loadPartnerOnboardingStates} from "@/lib/partner-onboarding";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { SubmitButton } from "@/components/submit-button";
import { hasPermission, requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { amazonEmailFromPattern } from "@/lib/amazon-activation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { readAllRows } from "@/lib/supabase-pagination";
import { callWorkforceAmazonWorker, isCanonicalWorkforceId, workforceAmazonWorkerConfig } from "@/lib/workforce-amazon-worker";
import {
  mapAmazonStation,
  onboardAndInviteAmazon,
  refreshAmazonLifecycle,
  syncIdfyBackground,
  tickAmazonInvitationQueue,
} from "./actions";

export const dynamic = "force-dynamic";

type LifecycleRow = {
  bucket: "not_onboarded" | "onboarded" | "in_progress";
  dropx: {
    id: string;
    fullName: string;
    email: string | null;
    mobile: string | null;
    stationCode: string | null;
    locationId: string | null;
    onboardingStatus: string | null;
    dropxId: string | null;
  };
  amazon: {
    providerId: string | null;
    transporterId: string | null;
    email: string | null;
    fullName: string | null;
    operationalStatus: string | null;
    onboardingWorkFlowStatus: string | null;
    currentStage: string | null;
    workflowStepsCompleted: number | null;
    workflowStepsCount: number | null;
    serviceAreaIds: string[];
    currentTask: string | null;
  } | null;
  idfy: {
    status: string | null;
    hasInsufficiency: boolean;
    highlight: string | null;
    respondUrl: string | null;
  } | null;
};

type View = "not_onboarded" | "onboarded" | "in_progress" | "idfy" | "all";

const viewLabel: Record<View, string> = {
  not_onboarded: "Not onboarded",
  in_progress: "In progress",
  onboarded: "Onboarded",
  idfy: "IDfy issues",
  all: "All",
};

export default async function AmazonLifecyclePage({
  searchParams = {},
}: {
  searchParams?: { view?: string; notice?: string; error?: string };
}) {
  const auth = await requirePagePermission("executive_id_onboarding", "access");
  const company = requireCompanyId(auth);
  const canEdit = hasPermission(auth, "executive_id_onboarding", "edit") && !auth.readOnly;
  const view = (["not_onboarded", "onboarded", "in_progress", "idfy", "all"].includes(searchParams.view || "")
    ? searchParams.view
    : "not_onboarded") as View;

  const worker = workforceAmazonWorkerConfig();
  let rows: LifecycleRow[] = [];
  let counts = { notOnboarded: 0, onboarded: 0, inProgress: 0, idfyIssues: 0 };
  let workerError = "";

  if (!worker.baseUrl || !worker.adminKey) {
    workerError =
      "Set WORKFORCE_AMAZON_WORKER_URL and WORKFORCE_AMAZON_WORKER_KEY (or ADMIN_API_KEY) to enable live Amazon sync.";
  } else {
    try {
      const payload = await callWorkforceAmazonWorker<{
        rows: LifecycleRow[];
        counts: typeof counts;
      }>("/api/admin/amazon/lifecycle");
      rows = payload.rows ?? [];
      counts = payload.counts ?? counts;
    } catch (error) {
      workerError = error instanceof Error ? error.message : "Unable to load Amazon lifecycle.";
    }
  }

  const settingsResult = supabaseAdmin
    ? await readAllRows(
        supabaseAdmin
          .from("workforce_amazon_station_settings")
          .select("station_id,associate_email_pattern,invitation_enabled,amazon_service_area_id,supervisor_alias")
          .eq("company_id", company),
      )
    : { data: [], error: null };

  const settings = settingsResult.data ?? [];
  const settingsByStation = new Map(settings.map((s) => [s.station_id as string, s]));

  if(supabaseAdmin){
    const linkedWorkforceIds=[...new Set(rows.map(row=>row.dropx.id).filter(isCanonicalWorkforceId))];
    let scoped=supabaseAdmin.from("workforce").select("id").eq("company_id",company).in("id",linkedWorkforceIds.length?linkedWorkforceIds:["00000000-0000-0000-0000-000000000000"]);
    if(!auth.hasAllLocationAccess)scoped=scoped.in("location_id",auth.locationScopeIds.length?auth.locationScopeIds:["00000000-0000-0000-0000-000000000000"]);
    const result=await scoped;if(result.error)throw new Error(result.error.message);
    const permitted=await loadPartnerOnboardingStates(supabaseAdmin,company,(result.data??[]).map(row=>row.id));
    rows=rows.filter(row=>isCanonicalWorkforceId(row.dropx.id)
      ? permitted.get(row.dropx.id)?.adapter==='amazon'
      : auth.hasAllLocationAccess&&Boolean(row.idfy));
    counts={notOnboarded:rows.filter(r=>r.bucket==='not_onboarded').length,onboarded:rows.filter(r=>r.bucket==='onboarded').length,inProgress:rows.filter(r=>r.bucket==='in_progress').length,idfyIssues:rows.filter(r=>r.idfy?.hasInsufficiency).length};
  }else{rows=[];}
  const filtered = rows.filter((row) => {
    if (view === "all") return true;
    if (view === "idfy") return Boolean(row.idfy?.hasInsufficiency);
    return row.bucket === view;
  });
  const tabStyle = (id: View) =>
    view === id ? { background: "#172033", color: "#fff", borderColor: "#172033" } : undefined;

  return (
    <AppShell active="Amazon lifecycle" pageCode="executive_id_onboarding">
      <PageHead
        eyebrow="Delivery network"
        title="Amazon lifecycle"
        subtitle="Associates who finished DropX onboarding, matched against the Amazon portal and IDfy background checks."
        action={
          <div className="component-chip-list">
            <Link className="button secondary compact" href="/delivery-network/amazon-onboarding-settings">
              Station master
            </Link>
            <Link className="button secondary compact" href="/delivery-network/onboarding/associates">
              Associate onboarding
            </Link>
            <Link className="button secondary compact" href="/delivery-network/id-onboarding">
              Activation desk
            </Link>
          </div>
        }
      />

      {searchParams.notice || searchParams.error || workerError ? (
        <section className={`panel message-panel ${searchParams.error || workerError ? "error" : "success"}`}>
          <div className="panel-body">
            <strong>{searchParams.error || workerError ? "Action required" : "Completed"}</strong>
            <p className="subtle" style={{ marginTop: 6 }}>
              {searchParams.error || workerError || searchParams.notice}
            </p>
          </div>
        </section>
      ) : null}

      <section className="performance-summary-grid">
        <article>
          <span>Not onboarded</span>
          <strong>{counts.notOnboarded}</strong>
          <small>Missing on Amazon</small>
        </article>
        <article>
          <span>In progress</span>
          <strong>{counts.inProgress}</strong>
          <small>Invitation / workflow open</small>
        </article>
        <article>
          <span>Onboarded</span>
          <strong>{counts.onboarded}</strong>
          <small>ACTIVE / INACTIVE roster</small>
        </article>
        <article>
          <span>IDfy issues</span>
          <strong>{counts.idfyIssues}</strong>
          <small>Highlighted insufficiencies</small>
        </article>
      </section>

      <section className="panel">
        <div className="panel-body inline-actions" style={{ gap: 8, flexWrap: "wrap" }}>
          <Link className="button secondary compact" style={tabStyle("not_onboarded")} href="?view=not_onboarded">
            Not onboarded ({counts.notOnboarded})
          </Link>
          <Link className="button secondary compact" style={tabStyle("in_progress")} href="?view=in_progress">
            In progress ({counts.inProgress})
          </Link>
          <Link className="button secondary compact" style={tabStyle("onboarded")} href="?view=onboarded">
            Onboarded ({counts.onboarded})
          </Link>
          <Link className="button secondary compact" style={tabStyle("idfy")} href="?view=idfy">
            IDfy issues ({counts.idfyIssues})
          </Link>
          <Link className="button secondary compact" style={tabStyle("all")} href="?view=all">
            All ({rows.length})
          </Link>
          {canEdit ? (
            <>
              <form action={refreshAmazonLifecycle}>
                <input type="hidden" name="view" value={view} />
                <SubmitButton className="button secondary compact" pendingText="Syncing…">
                  Sync Amazon
                </SubmitButton>
              </form>
              <form action={syncIdfyBackground}>
                <input type="hidden" name="view" value="idfy" />
                <SubmitButton className="button secondary compact" pendingText="Syncing IDfy…">
                  Sync IDfy
                </SubmitButton>
              </form>
              <form action={tickAmazonInvitationQueue}>
                <input type="hidden" name="view" value={view} />
                <SubmitButton className="button secondary compact" pendingText="Processing…">
                  Process invite queue
                </SubmitButton>
              </form>
            </>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <div className="table-wrap">
          <table className="onboarding-table">
            <thead>
              <tr>
                <th>Associate</th>
                <th>Station</th>
                <th>Amazon status</th>
                <th>IDfy</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const cfg = row.dropx.locationId ? settingsByStation.get(row.dropx.locationId) : null;
                const inviteEmail = row.dropx.email || "";
                const linkedAssociate = isCanonicalWorkforceId(row.dropx.id);
                return (
                  <tr key={row.dropx.id}>
                    <td>
                      <strong>{row.dropx.fullName}</strong>
                      <small>
                        {row.dropx.dropxId || "DropX ID pending"} · {row.dropx.onboardingStatus}
                      </small>
                    </td>
                    <td>
                      <strong>{row.dropx.stationCode || "—"}</strong>
                      <small>{cfg?.supervisor_alias ? `Supervisor ${cfg.supervisor_alias}` : "Master incomplete"}</small>
                    </td>
                    <td>
                      {row.amazon ? (
                        <>
                          <span
                            className={`status-badge ${
                              row.bucket === "onboarded" ? "success" : row.bucket === "in_progress" ? "warning" : "neutral"
                            }`}
                          >
                            {row.amazon.onboardingWorkFlowStatus ||
                              row.amazon.operationalStatus ||
                              row.bucket}
                          </span>
                          <small>
                            {row.amazon.email || "—"}
                            {row.amazon.currentStage ? ` · ${row.amazon.currentStage}` : ""}
                            {row.amazon.workflowStepsCompleted != null && row.amazon.workflowStepsCount != null
                              ? ` · ${row.amazon.workflowStepsCompleted}/${row.amazon.workflowStepsCount}`
                              : ""}
                          </small>
                        </>
                      ) : (
                        <span className="status-badge warning">Not on Amazon</span>
                      )}
                    </td>
                    <td>
                      {row.idfy?.hasInsufficiency ? (
                        <>
                          <span className="status-badge danger">Insufficiency</span>
                          <small>{row.idfy.highlight}</small>
                          {row.idfy.respondUrl ? (
                            <small>
                              <a href={row.idfy.respondUrl} target="_blank" rel="noreferrer">
                                Open IDfy
                              </a>
                            </small>
                          ) : null}
                        </>
                      ) : row.idfy ? (
                        <span className="status-badge success">{row.idfy.status || "Clear"}</span>
                      ) : (
                        <span className="subtle">—</span>
                      )}
                    </td>
                    <td>
                      {canEdit && linkedAssociate && row.bucket === "not_onboarded" && row.dropx.locationId ? (
                        <form action={onboardAndInviteAmazon} className="inline-actions">
                          <input type="hidden" name="view" value={view} />
                          <input type="hidden" name="workforce_id" value={row.dropx.id} />
                          <input type="hidden" name="station_id" value={row.dropx.locationId || ""} />
                          <input type="hidden" name="full_name" value={row.dropx.fullName} />
                          <input type="hidden" name="amazon_email" value={inviteEmail} />
                          <input type="hidden" name="source_portal" value="workforce" />
                          <SubmitButton className="button compact" pendingText="Inviting…">
                            Onboard & send invitation
                          </SubmitButton>
                        </form>
                      ) : null}
                      {canEdit && linkedAssociate && row.amazon?.providerId && !(row.amazon.serviceAreaIds?.length) ? (
                        <form action={mapAmazonStation} className="inline-actions">
                          <input type="hidden" name="view" value={view} />
                          <input type="hidden" name="workforce_id" value={row.dropx.id} />
                          <input type="hidden" name="provider_id" value={row.amazon.providerId} />
                          <input type="hidden" name="station_id" value={row.dropx.locationId || ""} />
                          <SubmitButton className="button secondary compact" pendingText="Mapping…">
                            Map station
                          </SubmitButton>
                        </form>
                      ) : null}
                      {!linkedAssociate ? <span className="subtle">Match to an associate before Amazon actions</span> : !canEdit ? <span className="subtle">View only</span> : null}
                    </td>
                  </tr>
                );
              })}
              {!filtered.length ? (
                <tr>
                  <td colSpan={5}>
                    No associates in {viewLabel[view]}.
                    {view === "idfy"
                      ? " Run Sync IDfy, then open this tab. Issues only appear here."
                      : " The numbers above are totals. Open the matching tab to see those associates."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
