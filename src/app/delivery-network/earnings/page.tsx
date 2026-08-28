import { AlertTriangle, ArrowRight, BadgeIndianRupee, Calculator, PackageCheck, ShieldCheck, WalletCards } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PendingLink } from "@/components/pending-link";
import { WorkforceLiveRefresh } from "@/components/workforce-live-refresh";
import { hasPermission, requirePagePermission } from "@/lib/authorization";
import { loadWorkforceEarnings, workforceEarningsDateRange } from "@/lib/workforce-earnings";

export const dynamic = "force-dynamic";

function number(value: number, digits = 0) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: digits }).format(value);
}

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
}

function sourceLabel(value: string) {
  return ({ rate_card: "Rate card", mapped_rate: "Mapped rate", imported_payout: "Imported payout", adjustment: "Adjustment", unresolved: "Unresolved" } as Record<string, string>)[value] ?? value;
}

export default async function WorkforceEarningsPage({ searchParams }: { searchParams?: { from?: string; to?: string; view?: string } }) {
  const authorization = await requirePagePermission("workforce_earnings", "access");
  const { from, to } = workforceEarningsDateRange(searchParams);
  const snapshot = await loadWorkforceEarnings(authorization, from, to);
  const view = searchParams?.view === "exceptions" || searchParams?.view === "trace" ? searchParams.view : "summary";

  return (
    <AppShell active="Live Earnings" pageCode="workforce_earnings">
      <section className="wf-finance-hero">
        <div>
          <span>Live earning engine</span>
          <h1>Every shipment to payable earnings</h1>
          <p>Current accruals are rebuilt from shipment counts, date-effective ID mappings, approved rate cards, incentive campaigns and approved adjustments.</p>
          <div className="wf-source-freshness"><i /> {snapshot.latestSourceUpdate ? `Source refreshed ${new Date(snapshot.latestSourceUpdate).toLocaleString("en-IN")}` : "Waiting for a shipment source update"}</div>
        </div>
        <div className="wf-finance-actions">
          <WorkforceLiveRefresh />
          {hasPermission(authorization, "workforce_adjustments", "access") ? <PendingLink className="wf-command-secondary" href="/delivery-network/adjustments">Add exception payment</PendingLink> : null}
          {hasPermission(authorization, "workforce_payroll", "access") ? <PendingLink className="wf-command-primary" href={`/delivery-network/payroll?from=${from}&to=${to}`}>Prepare payroll <ArrowRight size={15} /></PendingLink> : null}
        </div>
      </section>

      <form className="wf-range-bar" method="get">
        <label>From<input defaultValue={from} name="from" type="date" /></label>
        <label>To<input defaultValue={to} name="to" type="date" /></label>
        <input name="view" type="hidden" value={view} />
        <button type="submit">Recalculate view</button>
        <span>Live values are estimates until included in an approved payroll snapshot.</span>
      </form>

      {snapshot.setupRequired ? <section className="panel message-panel"><div className="panel-body"><strong>Finance engine migration pending</strong><p className="subtle">Existing shipment and mapped-rate earnings are visible. Rate cards, incentives, adjustments and payroll storage activate when the committed database migration completes.</p></div></section> : null}
      {snapshot.warnings.length ? <section className="panel message-panel error"><div className="panel-body">{snapshot.warnings.join(" ")}</div></section> : null}

      <section className="wf-finance-kpis">
        <article><span><BadgeIndianRupee size={18} /></span><small>Net accrued</small><strong>{money(snapshot.totalNet)}</strong><em>Live, not yet locked</em></article>
        <article><span><PackageCheck size={18} /></span><small>Delivered</small><strong>{number(snapshot.totalSourceShipments)}</strong><em>{number(snapshot.totalShipments)} mapped · {number(snapshot.sourceRowCount)} daily ID rows</em></article>
        <article><span><Calculator size={18} /></span><small>Base earnings</small><strong>{money(snapshot.totalBase)}</strong><em>Before rewards and changes</em></article>
        <article><span><WalletCards size={18} /></span><small>Rewards &amp; additions</small><strong>{money(snapshot.totalIncentives + snapshot.totalAdjustments)}</strong><em>{money(snapshot.totalDeductions)} deductions</em></article>
        <article className={snapshot.heldWorkers || snapshot.exceptions.length ? "attention" : "healthy"}><span><AlertTriangle size={18} /></span><small>Payroll blockers</small><strong>{number(snapshot.heldWorkers + snapshot.exceptions.length)}</strong><em>{snapshot.readyWorkers} associates ready</em></article>
      </section>

      <nav className="wf-finance-tabs" aria-label="Earnings views">
        <PendingLink className={view === "summary" ? "active" : ""} href={`/delivery-network/earnings?from=${from}&to=${to}`}>Associate summary <strong>{snapshot.summaries.length}</strong></PendingLink>
        <PendingLink className={view === "trace" ? "active" : ""} href={`/delivery-network/earnings?from=${from}&to=${to}&view=trace`}>Daily calculation trace <strong>{snapshot.lines.length}</strong></PendingLink>
        <PendingLink className={view === "exceptions" ? "active" : ""} href={`/delivery-network/earnings?from=${from}&to=${to}&view=exceptions`}>Exceptions <strong>{snapshot.exceptions.length}</strong></PendingLink>
      </nav>

      {view === "summary" ? (
        <section className="wf-finance-panel">
          <header><div><span>Payable register</span><h2>Associate earnings review</h2><p>Holds do not suppress accrued earnings; they prevent the amount from being approved for payout.</p></div>{hasPermission(authorization, "workforce_rate_cards", "access") ? <PendingLink href="/delivery-network/rate-cards">Manage rate cards <ArrowRight size={14} /></PendingLink> : null}</header>
          <div className="table-wrap"><table className="wf-finance-table"><thead><tr><th>Associate</th><th>Station</th><th>Work days</th><th>Shipments</th><th>Base</th><th>Incentive</th><th>Adjustments</th><th>Deductions</th><th>Net</th><th>State</th></tr></thead><tbody>
            {snapshot.summaries.map((summary) => <tr key={summary.workforceId}>
              <td><strong>{summary.workerName}</strong><small>{summary.dropxId} · {summary.providerIds.join(", ") || "No provider ID"}</small></td>
              <td>{summary.stationCode}</td><td>{summary.workDays}</td><td>{number(summary.shipmentCount)}</td>
              <td>{money(summary.baseAmount)}</td><td>{money(summary.incentiveAmount)}</td><td>{money(summary.earningAdjustments)}</td><td>{money(summary.deductions)}</td><td><strong>{money(summary.netAmount)}</strong></td>
              <td><span className={`wf-pay-state ${summary.status}`}>{summary.status}</span>{summary.holdReasons.length ? <small>{summary.holdReasons.join(" · ")}</small> : null}</td>
            </tr>)}
            {!snapshot.summaries.length ? <tr><td className="empty-cell" colSpan={10}>No mapped earnings found for this period.</td></tr> : null}
          </tbody></table></div>
        </section>
      ) : null}

      {view === "trace" ? (
        <section className="wf-finance-panel">
          <header><div><span>Audit trail</span><h2>Line-level calculation trace</h2><p>One row per shipment day or approved adjustment, preserved again when payroll is created.</p></div></header>
          <div className="table-wrap"><table className="wf-finance-table"><thead><tr><th>Date</th><th>Associate</th><th>Provider ID</th><th>Counts</th><th>Source</th><th>Base</th><th>Incentive</th><th>Adjustment</th><th>Net</th><th>State</th></tr></thead><tbody>
            {snapshot.lines.slice(0, 1000).map((line) => <tr key={line.key}>
              <td>{line.workDate}</td><td><strong>{line.workerName}</strong><small>{line.dropxId ?? "Unmapped"} · {line.stationCode}</small></td><td>{line.providerMemberId}</td>
              <td>{number(line.totalDelivery)} delivered<small>{number(line.totalActivity)} activity</small></td><td>{sourceLabel(line.calculationSource)}</td>
              <td>{money(line.baseAmount)}</td><td>{money(line.incentiveAmount)}</td><td>{money(line.adjustmentAmount)}</td><td><strong>{money(line.netAmount)}</strong></td><td><span className={`wf-pay-state ${line.status}`}>{line.status.replaceAll("_", " ")}</span></td>
            </tr>)}
            {!snapshot.lines.length ? <tr><td className="empty-cell" colSpan={10}>No earning lines found.</td></tr> : null}
          </tbody></table></div>
        </section>
      ) : null}

      {view === "exceptions" ? (
        <section className="wf-finance-panel">
          <header><div><span>Control queue</span><h2>Unresolved earning exceptions</h2><p>Resolve every provider ID and rate gap before payroll review.</p></div>{hasPermission(authorization, "provider_mapping", "access") ? <PendingLink href="/delivery-network/rate-mapping">Open mapping worksheet <ArrowRight size={14} /></PendingLink> : null}</header>
          <div className="table-wrap"><table className="wf-finance-table"><thead><tr><th>Date</th><th>Station</th><th>Source person</th><th>Provider ID</th><th>Shipments</th><th>Problem</th><th>Required action</th></tr></thead><tbody>
            {snapshot.exceptions.map((line) => <tr key={line.key}><td>{line.workDate}</td><td>{line.stationCode}</td><td>{line.workerName}</td><td>{line.providerMemberId}</td><td>{number(line.totalDelivery)}</td><td><span className={`wf-pay-state ${line.status}`}>{line.status.replaceAll("_", " ")}</span><small>{line.holdReasons.join(" · ")}</small></td><td>{line.status === "unmapped" ? "Correct the station/provider ID mapping and effective dates" : "Approve an effective rate card or mapped rate"}</td></tr>)}
            {!snapshot.exceptions.length ? <tr><td className="empty-cell" colSpan={7}><ShieldCheck size={16} /> All shipment rows are mapped and rated for this period.</td></tr> : null}
          </tbody></table></div>
        </section>
      ) : null}
    </AppShell>
  );
}
