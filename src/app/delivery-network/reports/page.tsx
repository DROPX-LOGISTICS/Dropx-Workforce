import { FileDown } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PendingLink } from "@/components/pending-link";
import { requirePagePermission } from "@/lib/authorization";
import { loadWorkforceCommunicationRecipients } from "@/lib/workforce-communication-recipients";
import { loadWorkforceEarnings, workforceEarningsDateRange } from "@/lib/workforce-earnings";

export const dynamic = "force-dynamic";

type Params = { report?: string; from?: string; to?: string; station?: string; state?: string; q?: string; sort?: string };
type Report = "earnings" | "payments" | "associates" | "exceptions";

function number(value: number) { return new Intl.NumberFormat("en-IN").format(value); }
function money(value: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value); }
function mask(value: string) { return value ? `•••• ${value.slice(-4)}` : "Missing"; }
function match(values: unknown[], q: string) { return !q || values.some((value) => String(value ?? "").toLowerCase().includes(q)); }
function queryHref(params: Params, report: Report) {
  const query = new URLSearchParams();
  Object.entries({ ...params, report }).forEach(([key, value]) => { if (value) query.set(key, value); });
  return `/delivery-network/reports?${query.toString()}`;
}

export default async function WorkforceReportsPage({ searchParams = {} }: { searchParams?: Params }) {
  const authorization = await requirePagePermission("workforce_earnings", "access");
  const { from, to } = workforceEarningsDateRange(searchParams);
  const report: Report = ["payments", "associates", "exceptions"].includes(searchParams.report ?? "") ? searchParams.report as Report : "earnings";
  const [snapshot, associates] = await Promise.all([
    loadWorkforceEarnings(authorization, from, to),
    loadWorkforceCommunicationRecipients(authorization)
  ]);
  const q = String(searchParams.q ?? "").trim().toLowerCase();
  const station = String(searchParams.station ?? "");
  const state = String(searchParams.state ?? "").toLowerCase();
  const sort = String(searchParams.sort ?? (report === "earnings" || report === "exceptions" ? "date-desc" : "name-asc"));
  const lines = snapshot.lines.filter((line) => (!station || line.stationCode === station) && (!state || line.status === state) && match([line.workerName, line.dropxId, line.providerMemberId, line.providerName], q));
  const exceptions = lines.filter((line) => ["unmapped", "missing_rate"].includes(line.status));
  const payments = snapshot.summaries.filter((row) => (!station || row.stationCode === station) && (!state || row.status === state) && match([row.workerName, row.dropxId, ...row.providerIds], q));
  const people = associates.filter((row) => (!station || row.location === station) && (!state || row.status.toLowerCase() === state) && match([row.name, row.reference, row.mobile, row.email, row.designation], q));
  const compare = <T extends { workerName?: string; name?: string; stationCode?: string; location?: string; netAmount?: number; workDate?: string }>(left: T, right: T) => {
    if (sort === "value-desc") return Number(right.netAmount ?? 0) - Number(left.netAmount ?? 0);
    if (sort === "station-asc") return String(left.stationCode ?? left.location ?? "").localeCompare(String(right.stationCode ?? right.location ?? ""));
    if (sort === "date-desc") return String(right.workDate ?? "").localeCompare(String(left.workDate ?? ""));
    return String(left.workerName ?? left.name ?? "").localeCompare(String(right.workerName ?? right.name ?? ""));
  };
  lines.sort(compare); exceptions.sort(compare); payments.sort(compare); people.sort(compare);
  const stations = Array.from(new Set([...snapshot.lines.map((line) => line.stationCode), ...associates.map((row) => row.location)].filter(Boolean))).sort();
  const exportQuery = new URLSearchParams({ report, from, to });
  ["station", "state", "q", "sort"].forEach((key) => { const value = searchParams[key as keyof Params]; if (value) exportQuery.set(key, value); });

  return <AppShell active="Reports" pageCode="workforce_earnings">
    <section className="wf-finance-hero compact"><div><span>Workforce reporting</span><h1>Operational and payout reports</h1><p>Download date-level earnings, payment registers, Workforce profile status and the exception queue from the isolated Workforce source of truth.</p></div><div className="wf-finance-actions"><a className="wf-command-primary" href={`/api/workforce/reports/export?${exportQuery.toString()}`}><FileDown size={15} /> Download CSV</a></div></section>

    <nav className="wf-finance-tabs" aria-label="Workforce reports">
      <PendingLink className={report === "earnings" ? "active" : ""} href={queryHref({ ...searchParams, from, to }, "earnings")}>Daily earnings <strong>{lines.length}</strong></PendingLink>
      <PendingLink className={report === "payments" ? "active" : ""} href={queryHref({ ...searchParams, from, to }, "payments")}>Payment register <strong>{payments.length}</strong></PendingLink>
      <PendingLink className={report === "associates" ? "active" : ""} href={queryHref({ ...searchParams, from, to }, "associates")}>Associate profiles <strong>{people.length}</strong></PendingLink>
      <PendingLink className={report === "exceptions" ? "active" : ""} href={queryHref({ ...searchParams, from, to }, "exceptions")}>Mapping &amp; rate exceptions <strong>{exceptions.length}</strong></PendingLink>
    </nav>

    <form className="wf-range-bar wf-filter-bar" method="get">
      <input name="report" type="hidden" value={report} />
      <label>From<input defaultValue={from} name="from" type="date" /></label><label>To<input defaultValue={to} name="to" type="date" /></label>
      <label>Station<select defaultValue={station} name="station"><option value="">All stations</option>{stations.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Status<select defaultValue={state} name="state"><option value="">All statuses</option>{report === "associates" ? <><option value="active">Active</option><option value="pending">Pending</option><option value="submitted">Submitted</option></> : <><option value="ready">Ready</option><option value="hold">Hold</option><option value="missing_rate">Missing rate</option><option value="unmapped">Unmapped</option></>}</select></label>
      <label>Search<input defaultValue={searchParams.q ?? ""} name="q" placeholder="Name, DropX ID, provider ID" type="search" /></label>
      <label>Sort<select defaultValue={sort} name="sort"><option value="name-asc">Name A–Z</option><option value="date-desc">Newest date</option><option value="station-asc">Station A–Z</option><option value="value-desc">Value high to low</option></select></label>
      <button type="submit">Apply</button><PendingLink className="wf-filter-reset" href={`/delivery-network/reports?report=${report}&from=${from}&to=${to}`}>Reset</PendingLink>
    </form>

    {snapshot.warnings.length ? <section className="panel message-panel error"><div className="panel-body">{snapshot.warnings.join(" ")}</div></section> : null}

    {report === "earnings" ? <section className="wf-finance-panel"><header><div><span>Date-level report</span><h2>Daily earnings and activity</h2><p>One auditable row per associate, provider ID and work date.</p></div></header><div className="table-wrap"><table className="wf-finance-table"><thead><tr><th>Date</th><th>Associate</th><th>Station</th><th>Provider</th><th>Provider ID</th><th>Delivered</th><th>Base</th><th>Incentive</th><th>Adjustment</th><th>Net</th><th>Status</th></tr></thead><tbody>{lines.slice(0, 2000).map((line) => <tr key={line.key}><td>{line.workDate}</td><td><strong>{line.workerName}</strong><small>{line.dropxId ?? "No DropX ID"}</small></td><td>{line.stationCode}</td><td>{line.providerName}</td><td>{line.providerMemberId}</td><td>{number(line.totalDelivery)}</td><td>{money(line.baseAmount)}</td><td>{money(line.incentiveAmount)}</td><td>{money(line.adjustmentAmount)}</td><td><strong>{money(line.netAmount)}</strong></td><td><span className={`wf-pay-state ${line.status}`}>{line.status.replaceAll("_", " ")}</span></td></tr>)}{!lines.length ? <tr><td className="empty-cell" colSpan={11}>No daily earnings match these filters.</td></tr> : null}</tbody></table></div></section> : null}

    {report === "payments" ? <section className="wf-finance-panel"><header><div><span>Payment report</span><h2>Associate payout register</h2><p>Bank details are masked on screen and included in the authorized CSV export.</p></div></header><div className="table-wrap"><table className="wf-finance-table"><thead><tr><th>Associate</th><th>Station</th><th>Provider IDs</th><th>Work days</th><th>Delivered</th><th>Gross</th><th>Deductions</th><th>Net</th><th>Bank account</th><th>IFSC</th><th>Status</th></tr></thead><tbody>{payments.map((row) => <tr key={row.workforceId}><td><strong>{row.workerName}</strong><small>{row.dropxId}</small></td><td>{row.stationCode}</td><td>{row.providerIds.join(", ") || "-"}</td><td>{row.workDays}</td><td>{number(row.shipmentCount)}</td><td>{money(row.grossAmount)}</td><td>{money(row.deductions)}</td><td><strong>{money(row.netAmount)}</strong></td><td>{mask(row.bankAccountNo)}</td><td>{row.ifscCode || "Missing"}</td><td><span className={`wf-pay-state ${row.status}`}>{row.status}</span><small>{row.holdReasons.join(" · ")}</small></td></tr>)}{!payments.length ? <tr><td className="empty-cell" colSpan={11}>No payment rows match these filters.</td></tr> : null}</tbody></table></div></section> : null}

    {report === "associates" ? <section className="wf-finance-panel"><header><div><span>Profile report</span><h2>Workforce associate data and status</h2><p>Canonical and compatibility-mode profiles are reported from the Workforce-owned register.</p></div></header><div className="table-wrap"><table className="wf-finance-table"><thead><tr><th>Associate</th><th>DropX ID</th><th>Designation</th><th>Station</th><th>Provider</th><th>Model</th><th>Mobile</th><th>Email</th><th>Profile source</th><th>Status</th></tr></thead><tbody>{people.map((row) => <tr key={`${row.profileType}:${row.accountId}`}><td><strong>{row.name}</strong></td><td>{row.reference || "Pending"}</td><td>{row.designation}</td><td>{row.location || "-"}</td><td>{row.provider || "-"}</td><td>{row.model || "-"}</td><td>{row.mobile ? `+${row.countryCode} ${row.mobile}` : "-"}</td><td>{row.email || "-"}</td><td>{row.compatibilityMode ? "Protected legacy link" : "Canonical Workforce"}</td><td><span className={`wf-pay-state ${row.status.toLowerCase()}`}>{row.status}</span></td></tr>)}{!people.length ? <tr><td className="empty-cell" colSpan={10}>No Workforce profiles match these filters.</td></tr> : null}</tbody></table></div></section> : null}

    {report === "exceptions" ? <section className="wf-finance-panel"><header><div><span>Action report</span><h2>Mapping and rate exceptions</h2><p>Every row here blocks a complete earnings calculation for its work date.</p></div><PendingLink href="/delivery-network/rate-mapping">Open mapping worksheet</PendingLink></header><div className="table-wrap"><table className="wf-finance-table"><thead><tr><th>Date</th><th>Station</th><th>Source name</th><th>Provider</th><th>Provider ID</th><th>Delivered</th><th>Status</th><th>Reason</th></tr></thead><tbody>{exceptions.map((line) => <tr key={line.key}><td>{line.workDate}</td><td>{line.stationCode}</td><td>{line.workerName}</td><td>{line.providerName}</td><td>{line.providerMemberId}</td><td>{number(line.totalDelivery)}</td><td><span className={`wf-pay-state ${line.status}`}>{line.status.replaceAll("_", " ")}</span></td><td>{line.holdReasons.join(" · ")}</td></tr>)}{!exceptions.length ? <tr><td className="empty-cell" colSpan={8}>No mapping or rate exceptions match these filters.</td></tr> : null}</tbody></table></div></section> : null}
  </AppShell>;
}
