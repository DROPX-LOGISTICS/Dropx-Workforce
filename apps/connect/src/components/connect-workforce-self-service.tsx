"use client";

import { BadgeIndianRupee, BarChart3, CalendarDays, CircleHelp, HandCoins, BookOpenCheck } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { AppAccount } from "./connect-profile-app";
import { ConnectLeave } from "./connect-leave";

type View = "payments" | "advances" | "roster" | "performance" | "reports" | "rate_card" | "connect";
type FinanceTab = "live" | "payments" | "advances" | "rate_card";
type Payload = { records: Array<Record<string, any>>; error?: string };
type Update = { id: string; title: string; body: string; created_at: string };

const labels: Record<View, { eyebrow: string; title: string }> = {
  payments: { eyebrow: "WORKFORCE PAY", title: "Payments" },
  advances: { eyebrow: "FINANCIAL SUPPORT", title: "Advances" },
  roster: { eyebrow: "WORK SCHEDULE", title: "Associate Rostering" },
  performance: { eyebrow: "WORK SUMMARY", title: "Performance" },
  reports: { eyebrow: "MY REPORTS", title: "Earnings & delivery report" },
  rate_card: { eyebrow: "COMMERCIAL POLICY", title: "My Rate Card" },
  connect: { eyebrow: "WORKFORCE CONNECT", title: "Get support" }
};

function money(value: unknown) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

function date(value: unknown) {
  const text = String(value ?? "");
  if (!text) return "-";
  const parsed = new Date(text.length === 10 ? `${text}T00:00:00` : text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toLocaleDateString("en-IN");
}

function relation(value: unknown) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export function ConnectWorkforceSelfService({ account, view }: { account: AppAccount; view: View }) {
  const [financeTab, setFinanceTab] = useState<FinanceTab>("live");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [connectTab, setConnectTab] = useState<"updates" | "team" | "speak_up">("updates");
  const [updates, setUpdates] = useState<Update[]>([]);

  const dataView: View = view === "payments" ? (financeTab === "live" ? "performance" : financeTab) : view;

  useEffect(() => {
    setPayload(null);
    setError("");
    const query = new URLSearchParams({ accountId: account.id, profileType: account.profileType, view: dataView });
    fetch(`/api/connect/workforce-self-service?${query}`)
      .then(async (response) => {
        const next = await response.json() as Payload;
        if (!response.ok) throw new Error(next.error || `Unable to load ${labels[dataView].title.toLowerCase()}.`);
        setPayload(next);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load this page."));
  }, [account.id, account.profileType, dataView]);

  useEffect(() => {
    if (view !== "connect") return;
    const query = new URLSearchParams({ accountId: account.id, profileType: account.profileType });
    fetch(`/api/connect/notifications?${query}`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : { notifications: [] })
      .then((next: { notifications?: Update[] }) => setUpdates(next.notifications ?? []))
      .catch(() => setUpdates([]));
  }, [account.id, account.profileType, view]);

  const totals = useMemo(() => (payload?.records ?? []).reduce((sum, row) => ({
    shipments: sum.shipments + Number(row.shipment_count ?? row.shipments ?? 0),
    activities: sum.activities + Number(row.activity_count ?? row.activities ?? 0),
    net: sum.net + Number(row.net_amount ?? row.netAmount ?? 0)
  }), { shipments: 0, activities: 0, net: 0 }), [payload]);

  const Icon = dataView === "payments" ? BadgeIndianRupee : dataView === "advances" ? HandCoins : dataView === "roster" ? CalendarDays : dataView === "performance" || dataView === "reports" ? BarChart3 : dataView === "rate_card" ? BookOpenCheck : CircleHelp;

  async function submitConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/connect/workforce-self-service", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: account.id, profileType: account.profileType, category: form.get("category"), subject: form.get("subject"), detail: form.get("detail") })
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "Unable to submit Connect request.");
      event.currentTarget.reset();
      setPayload((current) => current ? { ...current, records: [next.request, ...current.records] } : current);
      setNotice("Request submitted. Operations will respond in this thread.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to submit Connect request."); }
    finally { setSending(false); }
  }

  return <section className="dx-workforce-self-service">
    <header className="dx-workforce-page-hero"><i><Icon /></i><div><small>{labels[view].eyebrow}</small><h1>{labels[view].title}</h1><p>{account.reference || account.name}</p></div></header>
    {view === "payments" ? <nav className="dx-workforce-subnav" aria-label="Payment sections">
      <button className={financeTab === "live" ? "active" : ""} onClick={() => setFinanceTab("live")} type="button">Live earnings</button>
      <button className={financeTab === "payments" ? "active" : ""} onClick={() => setFinanceTab("payments")} type="button">Statements</button>
      <button className={financeTab === "advances" ? "active" : ""} onClick={() => setFinanceTab("advances")} type="button">Advances</button>
      <button className={financeTab === "rate_card" ? "active" : ""} onClick={() => setFinanceTab("rate_card")} type="button">Rate card</button>
    </nav> : null}
    {!payload && !error ? <div className="dx-loader fullscreen"><span /><small>Loading {labels[dataView].title.toLowerCase()}...</small></div> : null}
    {error ? <div className="dx-alert error">{error}</div> : null}

    {payload && dataView === "payments" ? <>
      <div className="dx-workforce-money-summary"><span><small>Published pay</small><strong>{money(totals.net)}</strong></span><span><small>Payment periods</small><strong>{payload.records.length}</strong></span></div>
      <div className="dx-workforce-records">{payload.records.map((row) => <article key={row.id}><header><span><strong>{row.run?.run_number || "Payroll"}</strong><small>{date(row.run?.period_start)} – {date(row.run?.period_end)}</small></span><em className={row.run?.status === "paid" ? "paid" : ""}>{row.run?.status || row.status}</em></header><dl><div><dt>Base</dt><dd>{money(row.baseAmount)}</dd></div><div><dt>Incentives</dt><dd>{money(row.incentiveAmount)}</dd></div><div><dt>Deductions</dt><dd>{money(row.deductionAmount)}</dd></div><div><dt>Net pay</dt><dd>{money(row.netAmount)}</dd></div></dl></article>)}</div>
    </> : null}

    {payload && dataView === "advances" ? <div className="dx-workforce-records">{payload.records.map((row) => <article key={row.id}><header><span><strong>{row.requestNumber || "Advance request"}</strong><small>{date(row.requestedAt)}</small></span><em>{String(row.status).replaceAll("_", " ")}</em></header><dl><div><dt>Requested</dt><dd>{money(row.requestedAmount)}</dd></div><div><dt>Approved</dt><dd>{money(row.approvedAmount)}</dd></div><div><dt>Recovered</dt><dd>{money(row.recoveredAmount)}</dd></div></dl>{row.reason ? <p>{row.reason}</p> : null}</article>)}</div> : null}

    {payload && dataView === "roster" ? <><div className="dx-workforce-records">{payload.records.map((row) => { const shift = relation(row.hr_shifts) as Record<string, any> | null; return <article key={row.id}><header><span><strong>{shift?.name || shift?.code || "Assigned shift"}</strong><small>{date(row.effective_from)} – {row.effective_to ? date(row.effective_to) : "Current"}</small></span><em>Rostered</em></header><dl><div><dt>Start</dt><dd>{String(shift?.start_time || "-").slice(0, 5)}</dd></div><div><dt>End</dt><dd>{String(shift?.end_time || "-").slice(0, 5)}</dd></div><div><dt>Break</dt><dd>{Number(shift?.break_minutes || 0)} min</dd></div></dl>{row.notes ? <p>{row.notes}</p> : null}</article>; })}</div>{(account.pageAccess ?? []).includes("leave") ? <section className="dx-workforce-leave"><h2>Time off</h2><ConnectLeave account={account} /></section> : null}</> : null}

    {payload && (dataView === "performance" || dataView === "reports") ? <>
      <div className="dx-workforce-money-summary"><span><small>{dataView === "performance" && view === "payments" ? "Estimated live earnings" : "Published shipments"}</small><strong>{dataView === "performance" && view === "payments" ? money(totals.net) : totals.shipments}</strong></span><span><small>Total activities</small><strong>{totals.activities}</strong></span></div>
      <div className="dx-workforce-records">{payload.records.map((row) => <article key={row.id}><header><span><strong>{row.provider_name || "Work activity"}</strong><small>{date(row.work_date)}</small></span><em>{row.calculation_source?.replaceAll("_", " ")}</em></header><dl><div><dt>Shipments</dt><dd>{row.shipment_count}</dd></div><div><dt>Activities</dt><dd>{row.activity_count}</dd></div><div><dt>Incentives</dt><dd>{money(row.incentive_amount)}</dd></div><div><dt>{dataView === "performance" && view === "payments" ? "Estimated value" : "Published value"}</dt><dd>{money(row.net_amount)}</dd></div></dl></article>)}</div>
    </> : null}

    {payload && dataView === "rate_card" ? <div className="dx-workforce-records">{payload.records.map((row) => <article key={row.id}><header><span><strong>{row.name}</strong><small>{date(row.effective_from)} – {row.effective_to ? date(row.effective_to) : "Current"}</small></span><em>{String(row.pay_type).replaceAll("_", " ")}</em></header><dl><div><dt>Delivery / activity</dt><dd>{money(row.delivery_rate)}</dd></div><div><dt>Return</dt><dd>{money(row.return_rate)}</dd></div><div><dt>Fuel</dt><dd>{money(row.fuel_rate)}</dd></div><div><dt>Guarantee</dt><dd>{money(row.guarantee_amount || row.fixed_amount)}</dd></div></dl>{row.notes ? <p>{row.notes}</p> : null}</article>)}</div> : null}

    {payload && dataView === "connect" ? <>
      <nav className="dx-workforce-subnav" aria-label="Workforce Connect Centre">
        <button className={connectTab === "updates" ? "active" : ""} onClick={() => setConnectTab("updates")} type="button">Updates</button>
        <button className={connectTab === "team" ? "active" : ""} onClick={() => setConnectTab("team")} type="button">Workforce team</button>
        <button className={connectTab === "speak_up" ? "active" : ""} onClick={() => setConnectTab("speak_up")} type="button">Speak Up</button>
      </nav>
      {connectTab === "updates" ? <div className="dx-workforce-records">{updates.map((update) => <article key={update.id}><header><span><strong>{update.title}</strong><small>{date(update.created_at)}</small></span><em>Update</em></header><p>{update.body}</p></article>)}</div> : null}
      {connectTab === "updates" && !updates.length ? <div className="dx-workforce-empty"><CircleHelp /><strong>No company updates yet</strong><small>Important station, incentive and payment updates will appear here.</small></div> : null}
      {connectTab === "team" ? <><form className="dx-workforce-connect-form" onSubmit={submitConnect}><label>What do you need help with?<select name="category" defaultValue="payment"><option value="payment">Payment or advance</option><option value="provider_id">Provider ID or mapping</option><option value="route_roster">Route or roster</option><option value="document">Document or profile</option><option value="other">Other</option></select></label><label>Subject<input name="subject" minLength={3} maxLength={160} placeholder="Briefly describe the issue" required /></label><label>Details<textarea name="detail" minLength={10} maxLength={2000} placeholder="Add the relevant date, provider ID, route or document details" required rows={4} /></label><button disabled={sending} type="submit">{sending ? "Sending…" : "Message Workforce team"}</button></form>{notice ? <div className="dx-alert success">{notice}</div> : null}<div className="dx-workforce-records">{payload.records.filter((row) => row.category !== "speak_up").map((row) => <article key={row.id}><header><span><strong>{row.subject}</strong><small>{date(row.created_at)} · {String(row.category).replaceAll("_", " ")}</small></span><em className={row.status === "resolved" ? "paid" : ""}>{String(row.status).replaceAll("_", " ")}</em></header><p>{row.detail}</p>{row.responder_note ? <p><strong>Workforce team:</strong> {row.responder_note}</p> : null}</article>)}</div></> : null}
      {connectTab === "speak_up" ? <><form className="dx-workforce-connect-form" onSubmit={submitConnect}><input name="category" type="hidden" value="speak_up" /><label>What happened?<input name="subject" minLength={3} maxLength={160} placeholder="Brief title for your report" required /></label><label>Tell us what you observed<textarea name="detail" minLength={10} maxLength={2000} placeholder="Include only the facts needed to review the concern." required rows={4} /></label><button disabled={sending} type="submit">{sending ? "Submitting…" : "Submit Speak Up report"}</button></form>{notice ? <div className="dx-alert success">{notice}</div> : null}<div className="dx-workforce-records">{payload.records.filter((row) => row.category === "speak_up").map((row) => <article key={row.id}><header><span><strong>{row.subject}</strong><small>{date(row.created_at)} · Speak Up</small></span><em className={row.status === "resolved" ? "paid" : ""}>{String(row.status).replaceAll("_", " ")}</em></header><p>{row.detail}</p>{row.responder_note ? <p><strong>Review team:</strong> {row.responder_note}</p> : null}</article>)}</div></> : null}
    </> : null}

    {payload && !payload.records.length && dataView !== "connect" ? <div className="dx-workforce-empty"><Icon /><strong>No published {labels[dataView].title.toLowerCase()} yet</strong><small>This page will update when the responsible team publishes data for your account.</small></div> : null}
  </section>;
}
