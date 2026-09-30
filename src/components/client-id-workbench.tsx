"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock3, Fingerprint, Search, Send, Unplug } from "lucide-react";
import { queueAmazonInvitation } from "@/app/delivery-network/id-onboarding/actions";
import { PendingLink } from "@/components/pending-link";
import { SubmitButton } from "@/components/submit-button";
import type { ClientIdBucket, ClientIdLane } from "@/lib/client-id-workbench";
import type { PartnerOnboardingState } from "@/lib/partner-onboarding";

export type ClientIdWorkbenchRow = {
  id: string;
  workforceId: string;
  name: string;
  dropxId: string;
  biometricId: string;
  mobile: string;
  email: string;
  station: string;
  designation: string;
  provider: string;
  model: string;
  bucket: ClientIdBucket;
  state: PartnerOnboardingState;
  profileHref?: string;
  mappingHref: string;
};

const laneMeta: Record<ClientIdBucket, { label: string; hint: string; icon: typeof Send }> = {
  trigger: { label: "ID trigger", hint: "Request or retry the client invitation", icon: Send },
  progress: { label: "DA In-App onboarding", hint: "Latest imported client step and follow-up", icon: Clock3 },
  bgc: { label: "Need Attention", hint: "Amazon IDfy insufficiencies requiring correction", icon: Fingerprint },
  mapping: { label: "Provider mapping", hint: "Client ID ready; confirmation is pending", icon: Unplug },
  blocked: { label: "Other blockers", hint: "Exceptions requiring Workforce review", icon: AlertTriangle },
};

function shortDate(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00+05:30` : value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

function providerSource(row: ClientIdWorkbenchRow) {
  if (row.state.adapter === "amazon") return row.state.report_date ? "DA In-App" : "Amazon invitation";
  return `${row.provider} workflow`;
}

function PrimaryAction({ row, canTrigger }: { row: ClientIdWorkbenchRow; canTrigger: boolean }) {
  const state = row.state;
  if (row.bucket === "mapping") {
    return <PendingLink className="button compact" href={row.mappingHref}>Confirm mapping <ArrowUpRight size={13} /></PendingLink>;
  }
  if (row.bucket === "trigger" && state.can_trigger && state.adapter === "amazon" && canTrigger) {
    return (
      <form action={queueAmazonInvitation}>
        <input name="return_to_register" type="hidden" value="1" />
        <input name="workforce_id" type="hidden" value={row.workforceId} />
        <input name="amazon_email" type="hidden" value={row.email} />
        <input name="source_portal" type="hidden" value="workforce" />
        <SubmitButton className="button compact" pendingText="Requesting…">
          <Send size={13} /> {state.invitation_status === "failed" ? "Retry Amazon ID" : "Request Amazon ID"}
        </SubmitButton>
      </form>
    );
  }
  if (row.profileHref) return <PendingLink className="button secondary compact" href={row.profileHref}>Open associate</PendingLink>;
  return <span className="subtle">View only</span>;
}

export function ClientIdWorkbench({
  rows,
  activeLane,
  counts,
  canTrigger,
}: {
  rows: ClientIdWorkbenchRow[];
  activeLane: ClientIdLane;
  counts: Record<ClientIdLane, number>;
  canTrigger: boolean;
}) {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("");
  const [station, setStation] = useState("");
  const providers = useMemo(() => [...new Set(rows.map((row) => row.provider).filter(Boolean))].sort(), [rows]);
  const stations = useMemo(() => [...new Set(rows.map((row) => row.station).filter(Boolean))].sort(), [rows]);
  const visibleRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (provider && row.provider !== provider) return false;
      if (station && row.station !== station) return false;
      if (!term) return true;
      return [row.name, row.dropxId, row.biometricId, row.email, row.mobile, row.station, row.designation, row.state.transporter_id]
        .some((value) => String(value ?? "").toLowerCase().includes(term));
    });
  }, [provider, query, rows, station]);

  const laneLinks: Array<[ClientIdLane, string]> = [
    ["all", "All open"],
    ["trigger", "ID trigger"],
    ["progress", "DA In-App"],
    ["bgc", "Need Attention"],
    ["mapping", "Provider mapping"],
    ["blocked", "Other blockers"],
  ];

  return (
    <>
      <section className="wf-client-stage-grid" aria-label="Client ID workflow">
        {(Object.keys(laneMeta) as ClientIdBucket[]).slice(0, 4).map((lane) => {
          const meta = laneMeta[lane];
          const Icon = meta.icon;
          return (
            <PendingLink href={`/delivery-network/onboarding?area=client&status=${lane}`} key={lane} aria-current={activeLane === lane ? "page" : undefined}>
              <span><Icon size={15} /></span>
              <div><strong>{counts[lane]}</strong><b>{meta.label}</b><small>{meta.hint}</small></div>
            </PendingLink>
          );
        })}
      </section>

      <nav className="wf-journey-nav wf-client-tabs" aria-label="Client ID queues">
        {laneLinks.map(([lane, label]) => (
          <PendingLink aria-current={activeLane === lane ? "page" : undefined} href={`/delivery-network/onboarding?area=client&status=${lane}`} key={lane}>
            {label}<strong>{counts[lane]}</strong>
          </PendingLink>
        ))}
      </nav>

      <section className="panel wf-client-workbench">
        <header>
          <div>
            <span className="eyebrow">OPEN DEPENDENCIES</span>
            <h2>{activeLane === "all" ? "Client ID work queue" : laneMeta[activeLane].label}</h2>
            <p>{activeLane === "all" ? "Every approved associate whose client setup is incomplete." : laneMeta[activeLane].hint}</p>
          </div>
          <div className="wf-client-filters">
            <label className="wf-client-search"><Search size={14} /><input aria-label="Search associates" onChange={(event) => setQuery(event.target.value)} placeholder="Search name, ID or email" value={query} /></label>
            <select aria-label="Filter by provider" onChange={(event) => setProvider(event.target.value)} value={provider}><option value="">All providers</option>{providers.map((value) => <option key={value}>{value}</option>)}</select>
            <select aria-label="Filter by station" onChange={(event) => setStation(event.target.value)} value={station}><option value="">All stations</option>{stations.map((value) => <option key={value}>{value}</option>)}</select>
          </div>
        </header>

        <div className="wf-client-list">
          {visibleRows.map((row) => {
            const meta = laneMeta[row.bucket];
            return (
              <article className={`wf-client-row ${row.bucket}`} key={row.id}>
                <div className="wf-client-person">
                  <span className="wf-client-avatar">{row.name.slice(0, 1).toUpperCase()}</span>
                  <div><strong>{row.name}</strong><small>{row.dropxId} · {row.designation}</small></div>
                </div>
                <div className="wf-client-assignment">
                  <strong>{row.provider || "Client not assigned"}</strong>
                  <small>{row.station || "No station"}{row.model ? ` · ${row.model}` : ""}</small>
                </div>
                <div className="wf-client-state">
                  <span className={`status-badge ${row.bucket === "bgc" || row.bucket === "blocked" ? "danger" : row.bucket === "mapping" ? "success" : "warning"}`}>{row.state.label}</span>
                  <small>{providerSource(row)}{row.state.report_date ? ` · ${shortDate(row.state.report_date)}` : ""}</small>
                </div>
                <div className="wf-client-evidence">
                  {row.state.transporter_id ? <><strong>{row.state.transporter_id}</strong><small>Provider ID from latest report</small></> : row.state.due_kind ? <><strong className="wf-overdue">Due since {shortDate(row.state.due_since)}</strong><small>Follow-up is overdue</small></> : <><strong>{meta.label}</strong><small>{row.state.invited_on ? `Invited ${shortDate(row.state.invited_on)}` : "No provider ID received yet"}</small></>}
                </div>
                <div className="wf-client-action"><PrimaryAction canTrigger={canTrigger} row={row} /></div>
                <details className="wf-client-detail">
                  <summary>Details</summary>
                  <div>
                    <p>{row.state.instruction}</p>
                    <dl>
                      <div><dt>Email</dt><dd>{row.email || "—"}</dd></div>
                      <div><dt>Mobile</dt><dd>{row.mobile || "—"}</dd></div>
                      <div><dt>Reported</dt><dd>{shortDate(row.state.reported_on)}</dd></div>
                      <div><dt>Invitation</dt><dd>{shortDate(row.state.invited_on)}</dd></div>
                      <div><dt>DA In-App action</dt><dd>{row.state.action_item || "No imported action yet"}</dd></div>
                      <div><dt>Latest source sync</dt><dd>{shortDate(row.state.report_updated_at)}</dd></div>
                    </dl>
                    {row.profileHref ? <PendingLink href={row.profileHref}>View associate profile <ArrowUpRight size={12} /></PendingLink> : null}
                  </div>
                </details>
              </article>
            );
          })}
          {!visibleRows.length ? <div className="wf-client-empty"><CheckCircle2 size={20} /><strong>No dependency in this queue</strong><span>Change the filters or open another stage.</span></div> : null}
        </div>
      </section>
    </>
  );
}
