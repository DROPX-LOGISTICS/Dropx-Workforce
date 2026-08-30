import { AlertTriangle, ArrowRight, BadgeIndianRupee, Calculator, FileDown, PackageCheck, ShieldCheck, WalletCards } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PendingLink } from "@/components/pending-link";
import { WorkforceLiveRefresh } from "@/components/workforce-live-refresh";
import { hasPermission, requirePagePermission } from "@/lib/authorization";
import { loadWorkforceEarnings, workforceEarningsDateRange, workforceToday, type WorkforceEarningLine, type WorkforceEarningSummary } from "@/lib/workforce-earnings";

export const dynamic = "force-dynamic";

type Params = { from?: string; to?: string; view?: string; station?: string; state?: string; source?: string; q?: string; sort?: string };

function number(value: number, digits = 0) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: digits }).format(value);
}

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
}

function sourceLabel(value: string) {
  return ({ rate_card: "Rate card", mapped_rate: "Mapped rate", imported_payout: "Imported payout", adjustment: "Adjustment", unresolved: "Unresolved" } as Record<string, string>)[value] ?? value;
}

function href(params: Params, overrides: Partial<Params> = {}) {
  const query = new URLSearchParams();
  const merged = { ...params, ...overrides };
  Object.entries(merged).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  return `/delivery-network/earnings?${query.toString()}`;
}

function includesSearch(values: Array<string | null | undefined>, search: string) {
  if (!search) return true;
  return values.some((value) => String(value ?? "").toLowerCase().includes(search));
}

function filterLine(line: WorkforceEarningLine, params: Params, search: string) {
  return (!params.station || line.stationCode === params.station)
    && (!params.state || line.status === params.state)
    && (!params.source || line.calculationSource === params.source)
    && includesSearch([line.workerName, line.dropxId, line.providerMemberId, line.providerName, line.stationCode], search);
}

function filterSummary(summary: WorkforceEarningSummary, params: Params, search: string) {
  return (!params.station || summary.stationCode === params.station)
    && (!params.state || summary.status === params.state)
    && (!params.source || summary.lines.some((line) => line.calculationSource === params.source))
    && includesSearch([summary.workerName, summary.dropxId, summary.stationCode, ...summary.providerIds], search);
}

function sortLines(lines: WorkforceEarningLine[], sort: string) {
  return [...lines].sort((left, right) => {
    if (sort === "date-asc") return left.workDate.localeCompare(right.workDate) || left.workerName.localeCompare(right.workerName);
    if (sort === "name-asc") return left.workerName.localeCompare(right.workerName) || right.workDate.localeCompare(left.workDate);
    if (sort === "station-asc") return left.stationCode.localeCompare(right.stationCode) || left.workerName.localeCompare(right.workerName);
    if (sort === "deliveries-desc") return right.totalDelivery - left.totalDelivery || left.workerName.localeCompare(right.workerName);
    if (sort === "net-desc") return right.netAmount - left.netAmount || left.workerName.localeCompare(right.workerName);
    if (sort === "state-asc") return left.status.localeCompare(right.status) || left.workerName.localeCompare(right.workerName);
    return right.workDate.localeCompare(left.workDate) || left.workerName.localeCompare(right.workerName);
  });
}

function sortSummaries(summaries: WorkforceEarningSummary[], sort: string) {
  return [...summaries].sort((left, right) => {
    if (sort === "name-asc") return left.workerName.localeCompare(right.workerName);
    if (sort === "station-asc") return left.stationCode.localeCompare(right.stationCode) || left.workerName.localeCompare(right.workerName);
    if (sort === "deliveries-desc") return right.shipmentCount - left.shipmentCount || left.workerName.localeCompare(right.workerName);
    if (sort === "state-asc") return left.status.localeCompare(right.status) || left.workerName.localeCompare(right.workerName);
    return right.netAmount - left.netAmount || left.workerName.localeCompare(right.workerName);
  });
}

export default async function WorkforceEarningsPage({ searchParams = {} }: { searchParams?: Params }) {
  const authorization = await requirePagePermission("workforce_earnings", "access");
  const { from, to } = workforceEarningsDateRange(searchParams);
  const params: Params = { ...searchParams, from, to };
  const snapshot = await loadWorkforceEarnings(authorization, from, to);
  const view = searchParams.view === "exceptions" || searchParams.view === "trace" ? searchParams.view : "summary";
  const search = String(searchParams.q ?? "").trim().toLowerCase();
  const sort = String(searchParams.sort ?? (view === "summary" ? "net-desc" : "date-desc"));
  const stations = Array.from(new Set(snapshot.lines.map((line) => line.stationCode).filter((value) => value && value !== "-"))).sort();
  const visibleLines = sortLines(snapshot.lines.filter((line) => filterLine(line, params, search)), sort);
  const visibleSummaries = sortSummaries(snapshot.summaries.filter((summary) => filterSummary(summary, params, search)), sort);
  const visibleExceptions = visibleLines.filter((line) => line.status === "unmapped" || line.status === "missing_rate");
  const shipmentLines = visibleLines.filter((line) => line.sourceType === "shipment");
  const visibleWorkerIds = new Set(visibleLines.map((line) => line.workforceId).filter(Boolean));
  const readyWorkerIds = new Set(visibleLines.filter((line) => line.status === "ready").map((line) => line.workforceId).filter(Boolean));
  const heldWorkerIds = new Set(visibleLines.filter((line) => line.status === "hold").map((line) => line.workforceId).filter(Boolean));
  const totalBase = visibleLines.reduce((sum, line) => sum + line.baseAmount, 0);
  const totalIncentives = visibleLines.reduce((sum, line) => sum + line.incentiveAmount, 0);
  const totalAdjustments = visibleLines.reduce((sum, line) => sum + Math.max(line.adjustmentAmount, 0), 0);
  const totalDeductions = visibleLines.reduce((sum, line) => sum + Math.abs(Math.min(line.adjustmentAmount, 0)), 0);
  const totalNet = visibleLines.reduce((sum, line) => sum + line.netAmount, 0);
  const today = workforceToday();
  const monthStart = `${today.slice(0, 8)}01`;
  const exportQuery = new URLSearchParams({ report: view === "summary" ? "payments" : view === "exceptions" ? "exceptions" : "earnings", from, to });
  ["station", "state", "source", "q", "sort"].forEach((key) => {
    const value = params[key as keyof Params];
    if (value) exportQuery.set(key, value);
  });

  return (
    <AppShell active="Live Earnings" pageCode="workforce_earnings">
      <section className="wf-finance-hero">
        <div>
          <span>Live earning engine</span>
          <h1>Every shipment to payable earnings</h1>
          <p>Current accruals are rebuilt from shipment counts, transitioned Workforce ID mappings, approved rate cards, incentive campaigns and approved adjustments.</p>
          <div className="wf-source-freshness"><i /> {snapshot.latestSourceUpdate ? `Source refreshed ${new Date(snapshot.latestSourceUpdate).toLocaleString("en-IN")}` : "Waiting for a shipment source update"}</div>
        </div>
        <div className="wf-finance-actions">
          <WorkforceLiveRefresh />
          <PendingLink className="wf-command-secondary" href="/delivery-network/reports">Reports</PendingLink>
          {hasPermission(authorization, "workforce_adjustments", "access") ? <PendingLink className="wf-command-secondary" href="/delivery-network/adjustments">Add exception payment</PendingLink> : null}
          {hasPermission(authorization, "workforce_payroll", "access") ? <PendingLink className="wf-command-primary" href={`/delivery-network/payroll?from=${from}&to=${to}`}>Prepare payroll <ArrowRight size={15} /></PendingLink> : null}
        </div>
      </section>

      <nav className="wf-period-pills" aria-label="Earnings period shortcuts">
        <PendingLink className={from === today && to === today ? "active" : ""} href={href(params, { from: today, to: today })}>Today</PendingLink>
        <PendingLink className={from === monthStart && to === today ? "active" : ""} href={href(params, { from: monthStart, to: today })}>MTD</PendingLink>
        <PendingLink href={href(params, { from: to, to })}>Selected day</PendingLink>
      </nav>

      <form className="wf-range-bar wf-filter-bar" method="get">
        <label>From<input defaultValue={from} name="from" type="date" /></label>
        <label>To<input defaultValue={to} name="to" type="date" /></label>
        <label>Station<select defaultValue={searchParams.station ?? ""} name="station"><option value="">All stations</option>{stations.map((station) => <option key={station} value={station}>{station}</option>)}</select></label>
        <label>State<select defaultValue={searchParams.state ?? ""} name="state"><option value="">All states</option><option value="ready">Ready</option><option value="hold">Hold</option><option value="missing_rate">Missing rate</option><option value="unmapped">Unmapped</option></select></label>
        <label>Source<select defaultValue={searchParams.source ?? ""} name="source"><option value="">All sources</option><option value="rate_card">Rate card</option><option value="mapped_rate">Mapped rate</option><option value="imported_payout">Imported payout</option><option value="adjustment">Adjustment</option><option value="unresolved">Unresolved</option></select></label>
        <label>Search<input defaultValue={searchParams.q ?? ""} name="q" placeholder="Name, DropX ID, provider ID" type="search" /></label>
        <label>Sort<select defaultValue={sort} name="sort"><option value="net-desc">Net amount high to low</option><option value="date-desc">Newest date</option><option value="date-asc">Oldest date</option><option value="deliveries-desc">Deliveries high to low</option><option value="name-asc">Name A–Z</option><option value="station-asc">Station A–Z</option><option value="state-asc">State</option></select></label>
        <input name="view" type="hidden" value={view} />
        <button type="submit">Apply</button>
        <PendingLink className="wf-filter-reset" href={`/delivery-network/earnings?from=${from}&to=${to}&view=${view}`}>Reset</PendingLink>
      </form>

      {snapshot.setupRequired ? <section className="panel message-panel"><div className="panel-body"><strong>Finance engine migration pending</strong><p className="subtle">Existing shipment and mapped-rate earnings are visible. Rate cards, incentives, adjustments and payroll storage activate when the committed database migration completes.</p></div></section> : null}
      {snapshot.warnings.length ? <section className="panel message-panel error"><div className="panel-body">{snapshot.warnings.join(" ")}</div></section> : null}

      <section className="wf-finance-kpis">
        <article><span><BadgeIndianRupee size={18} /></span><small>Net accrued</small><strong>{money(totalNet)}</strong><em>Filtered live view, not yet locked</em></article>
        <article><span><PackageCheck size={18} /></span><small>Delivered</small><strong>{number(shipmentLines.reduce((sum, line) => sum + line.totalDelivery, 0))}</strong><em>{number(shipmentLines.filter((line) => line.workforceId).reduce((sum, line) => sum + line.totalDelivery, 0))} mapped · {number(shipmentLines.length)} daily ID rows</em></article>
        <article><span><Calculator size={18} /></span><small>Base earnings</small><strong>{money(totalBase)}</strong><em>{visibleWorkerIds.size} associates in view</em></article>
        <article><span><WalletCards size={18} /></span><small>Rewards &amp; additions</small><strong>{money(totalIncentives + totalAdjustments)}</strong><em>{money(totalDeductions)} deductions</em></article>
        <article className={heldWorkerIds.size || visibleExceptions.length ? "attention" : "healthy"}><span><AlertTriangle size={18} /></span><small>Payroll blockers</small><strong>{number(heldWorkerIds.size + visibleExceptions.length)}</strong><em>{readyWorkerIds.size} associates ready</em></article>
      </section>

      <nav className="wf-finance-tabs" aria-label="Earnings views">
        <PendingLink className={view === "summary" ? "active" : ""} href={href(params, { view: undefined })}>Associate summary <strong>{visibleSummaries.length}</strong></PendingLink>
        <PendingLink className={view === "trace" ? "active" : ""} href={href(params, { view: "trace" })}>Daily calculation trace <strong>{visibleLines.length}</strong></PendingLink>
        <PendingLink className={view === "exceptions" ? "active" : ""} href={href(params, { view: "exceptions" })}>Exceptions <strong>{visibleExceptions.length}</strong></PendingLink>
        <a className="wf-tab-export" href={`/api/workforce/reports/export?${exportQuery.toString()}`}><FileDown size={14} /> Download CSV</a>
      </nav>

      {view === "summary" ? (
        <section className="wf-finance-panel">
          <header><div><span>Payable register</span><h2>Associate earnings review</h2><p>Holds do not suppress accrued earnings; they prevent the amount from being approved for payout.</p></div>{hasPermission(authorization, "workforce_rate_cards", "access") ? <PendingLink href="/delivery-network/rate-cards">Manage rate cards <ArrowRight size={14} /></PendingLink> : null}</header>
          <div className="table-wrap"><table className="wf-finance-table"><thead><tr><th>Associate</th><th>Station</th><th>Work days</th><th>Shipments</th><th>Base</th><th>Incentive</th><th>Adjustments</th><th>Deductions</th><th>Net</th><th>State</th></tr></thead><tbody>
            {visibleSummaries.map((summary) => <tr key={summary.workforceId}>
              <td><strong>{summary.workerName}</strong><small>{summary.dropxId} · {summary.providerIds.join(", ") || "No provider ID"}</small></td>
              <td>{summary.stationCode}</td><td>{summary.workDays}</td><td>{number(summary.shipmentCount)}</td>
              <td>{money(summary.baseAmount)}</td><td>{money(summary.incentiveAmount)}</td><td>{money(summary.earningAdjustments)}</td><td>{money(summary.deductions)}</td><td><strong>{money(summary.netAmount)}</strong></td>
              <td><span className={`wf-pay-state ${summary.status}`}>{summary.status}</span>{summary.holdReasons.length ? <small>{summary.holdReasons.join(" · ")}</small> : null}</td>
            </tr>)}
            {!visibleSummaries.length ? <tr><td className="empty-cell" colSpan={10}>No associate earnings match these filters.</td></tr> : null}
          </tbody></table></div>
        </section>
      ) : null}

      {view === "trace" ? (
        <section className="wf-finance-panel">
          <header><div><span>Audit trail</span><h2>Line-level calculation trace</h2><p>Showing {number(Math.min(visibleLines.length, 1000))} of {number(visibleLines.length)} filtered daily rows.</p></div></header>
          <div className="table-wrap"><table className="wf-finance-table"><thead><tr><th>Date</th><th>Associate</th><th>Provider ID</th><th>Counts</th><th>Source</th><th>Base</th><th>Incentive</th><th>Adjustment</th><th>Net</th><th>State</th></tr></thead><tbody>
            {visibleLines.slice(0, 1000).map((line) => <tr key={line.key}>
              <td>{line.workDate}</td><td><strong>{line.workerName}</strong><small>{line.dropxId ?? "Unmapped"} · {line.stationCode}</small></td><td>{line.providerMemberId}</td>
              <td>{number(line.totalDelivery)} delivered<small>{number(line.totalActivity)} activity</small></td><td>{sourceLabel(line.calculationSource)}</td>
              <td>{money(line.baseAmount)}</td><td>{money(line.incentiveAmount)}</td><td>{money(line.adjustmentAmount)}</td><td><strong>{money(line.netAmount)}</strong></td><td><span className={`wf-pay-state ${line.status}`}>{line.status.replaceAll("_", " ")}</span></td>
            </tr>)}
            {!visibleLines.length ? <tr><td className="empty-cell" colSpan={10}>No earning lines match these filters.</td></tr> : null}
          </tbody></table></div>
        </section>
      ) : null}

      {view === "exceptions" ? (
        <section className="wf-finance-panel">
          <header><div><span>Control queue</span><h2>Unresolved earning exceptions</h2><p>Resolve every provider ID and rate gap before payroll review.</p></div>{hasPermission(authorization, "provider_mapping", "access") ? <PendingLink href="/delivery-network/rate-mapping">Open mapping worksheet <ArrowRight size={14} /></PendingLink> : null}</header>
          <div className="table-wrap"><table className="wf-finance-table"><thead><tr><th>Date</th><th>Station</th><th>Source person</th><th>Provider ID</th><th>Shipments</th><th>Problem</th><th>Required action</th></tr></thead><tbody>
            {visibleExceptions.map((line) => <tr key={line.key}><td>{line.workDate}</td><td>{line.stationCode}</td><td>{line.workerName}</td><td>{line.providerMemberId}</td><td>{number(line.totalDelivery)}</td><td><span className={`wf-pay-state ${line.status}`}>{line.status.replaceAll("_", " ")}</span><small>{line.holdReasons.join(" · ")}</small></td><td>{line.status === "unmapped" ? "Correct the station/provider ID mapping and effective dates" : "Approve an effective rate card or mapped rate"}</td></tr>)}
            {!visibleExceptions.length ? <tr><td className="empty-cell" colSpan={7}><ShieldCheck size={16} /> All filtered shipment rows are mapped and rated.</td></tr> : null}
          </tbody></table></div>
        </section>
      ) : null}
    </AppShell>
  );
}
