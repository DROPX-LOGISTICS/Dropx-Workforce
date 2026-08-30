"use client";

import { BadgeIndianRupee, BarChart3, CalendarDays, HandCoins } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AppAccount } from "./connect-profile-app";

type View = "payments" | "advances" | "roster" | "performance";
type Payload = { records: Array<Record<string, any>>; error?: string };

const labels: Record<View, { eyebrow: string; title: string }> = {
  payments: { eyebrow: "WORKFORCE PAY", title: "Payments" },
  advances: { eyebrow: "FINANCIAL SUPPORT", title: "Advances" },
  roster: { eyebrow: "WORK SCHEDULE", title: "Associate Rostering" },
  performance: { eyebrow: "WORK SUMMARY", title: "Performance" }
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
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setPayload(null);
    setError("");
    const query = new URLSearchParams({ accountId: account.id, profileType: account.profileType, view });
    fetch(`/api/connect/workforce-self-service?${query}`)
      .then(async (response) => {
        const next = await response.json() as Payload;
        if (!response.ok) throw new Error(next.error || `Unable to load ${labels[view].title.toLowerCase()}.`);
        setPayload(next);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load this page."));
  }, [account.id, account.profileType, view]);

  const totals = useMemo(() => (payload?.records ?? []).reduce((sum, row) => ({
    shipments: sum.shipments + Number(row.shipment_count ?? row.shipments ?? 0),
    activities: sum.activities + Number(row.activity_count ?? row.activities ?? 0),
    net: sum.net + Number(row.net_amount ?? row.netAmount ?? 0)
  }), { shipments: 0, activities: 0, net: 0 }), [payload]);

  const Icon = view === "payments" ? BadgeIndianRupee : view === "advances" ? HandCoins : view === "roster" ? CalendarDays : BarChart3;

  return <section className="dx-workforce-self-service">
    <header className="dx-workforce-page-hero"><i><Icon /></i><div><small>{labels[view].eyebrow}</small><h1>{labels[view].title}</h1><p>{account.reference || account.name}</p></div></header>
    {!payload && !error ? <div className="dx-loader fullscreen"><span /><small>Loading {labels[view].title.toLowerCase()}...</small></div> : null}
    {error ? <div className="dx-alert error">{error}</div> : null}

    {payload && view === "payments" ? <>
      <div className="dx-workforce-money-summary"><span><small>Published net pay</small><strong>{money(totals.net)}</strong></span><span><small>Payment periods</small><strong>{payload.records.length}</strong></span></div>
      <div className="dx-workforce-records">{payload.records.map((row) => <article key={row.id}><header><span><strong>{row.run?.run_number || "Payroll"}</strong><small>{date(row.run?.period_start)} – {date(row.run?.period_end)}</small></span><em className={row.run?.status === "paid" ? "paid" : ""}>{row.run?.status || row.status}</em></header><dl><div><dt>Base</dt><dd>{money(row.baseAmount)}</dd></div><div><dt>Incentives</dt><dd>{money(row.incentiveAmount)}</dd></div><div><dt>Deductions</dt><dd>{money(row.deductionAmount)}</dd></div><div><dt>Net pay</dt><dd>{money(row.netAmount)}</dd></div></dl></article>)}</div>
    </> : null}

    {payload && view === "advances" ? <div className="dx-workforce-records">{payload.records.map((row) => <article key={row.id}><header><span><strong>{row.requestNumber || "Advance request"}</strong><small>{date(row.requestedAt)}</small></span><em>{String(row.status).replaceAll("_", " ")}</em></header><dl><div><dt>Requested</dt><dd>{money(row.requestedAmount)}</dd></div><div><dt>Approved</dt><dd>{money(row.approvedAmount)}</dd></div><div><dt>Recovered</dt><dd>{money(row.recoveredAmount)}</dd></div></dl>{row.reason ? <p>{row.reason}</p> : null}</article>)}</div> : null}

    {payload && view === "roster" ? <div className="dx-workforce-records">{payload.records.map((row) => { const shift = relation(row.hr_shifts) as Record<string, any> | null; return <article key={row.id}><header><span><strong>{shift?.name || shift?.code || "Assigned shift"}</strong><small>{date(row.effective_from)} – {row.effective_to ? date(row.effective_to) : "Current"}</small></span><em>Rostered</em></header><dl><div><dt>Start</dt><dd>{String(shift?.start_time || "-").slice(0, 5)}</dd></div><div><dt>End</dt><dd>{String(shift?.end_time || "-").slice(0, 5)}</dd></div><div><dt>Break</dt><dd>{Number(shift?.break_minutes || 0)} min</dd></div></dl>{row.notes ? <p>{row.notes}</p> : null}</article>; })}</div> : null}

    {payload && view === "performance" ? <>
      <div className="dx-workforce-money-summary"><span><small>Published shipments</small><strong>{totals.shipments}</strong></span><span><small>Total activities</small><strong>{totals.activities}</strong></span></div>
      <div className="dx-workforce-records">{payload.records.map((row) => <article key={row.id}><header><span><strong>{row.provider_name || "Work activity"}</strong><small>{date(row.work_date)}</small></span><em>{row.calculation_source?.replaceAll("_", " ")}</em></header><dl><div><dt>Shipments</dt><dd>{row.shipment_count}</dd></div><div><dt>Activities</dt><dd>{row.activity_count}</dd></div><div><dt>Published value</dt><dd>{money(row.net_amount)}</dd></div></dl></article>)}</div>
    </> : null}

    {payload && !payload.records.length ? <div className="dx-workforce-empty"><Icon /><strong>No published {labels[view].title.toLowerCase()} yet</strong><small>This page will update when the responsible team publishes data for your account.</small></div> : null}
  </section>;
}
