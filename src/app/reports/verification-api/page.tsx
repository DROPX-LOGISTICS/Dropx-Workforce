import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHead } from "@/components/page-head";
import { StatusPill } from "@/components/status-pill";
import { VerificationApiLogDetails } from "@/components/verification-api-log-details";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

type SearchParams = {
  from?: string;
  kind?: string;
  page?: string;
  profile_type?: string;
  result?: string;
  search?: string;
  source?: string;
  to?: string;
};

type AuditRow = {
  id: string;
  provider_code: string;
  verification_kind: string;
  endpoint: string;
  source: string;
  profile_type: string | null;
  account_code: string | null;
  profile_name: string | null;
  actor_label: string | null;
  request_data: unknown;
  response_data: unknown;
  http_status: number | null;
  is_success: boolean;
  result_code: string | null;
  result_message: string | null;
  duration_ms: number | null;
  created_at: string;
};

const pageSize = 50;

const kindOptions = [
  ["", "All API types"],
  ["pan", "PAN"],
  ["pan_aadhaar", "PAN Aadhaar link"],
  ["dl", "Driving licence"],
  ["vehicle", "Vehicle RC"],
  ["bank", "Bank account"],
  ["pf_uan", "PF UAN"]
];

const sourceOptions = [
  ["", "All sources"],
  ["dashboard", "Dashboard"],
  ["dropx_one_android", "DropX One Android"],
  ["dropx_one_web", "DropX One Web"]
];

const profileOptions = [
  ["", "All categories"],
  ["employee", "Employee"],
  ["field_executive", "Field executive"],
  ["contractor", "Independent contractor"],
  ["vendor", "Vendor"],
  ["worker", "Worker"]
];

function clean(value: string | undefined) {
  return String(value ?? "").trim();
}

function safePage(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function safeDate(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function labelFor(options: string[][], value: string) {
  return options.find(([key]) => key === value)?.[1] ?? value.replaceAll("_", " ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata"
  }).format(new Date(value));
}

function paginationHref(searchParams: SearchParams, page: number) {
  const params = new URLSearchParams();
  Object.entries(searchParams).forEach(([key, value]) => {
    if (value && key !== "page") params.set(key, value);
  });
  params.set("page", String(page));
  return `/reports/verification-api?${params.toString()}`;
}

function isMissingAuditTable(message: string) {
  const value = message.toLowerCase();
  return value.includes("verification_api_audit_logs") &&
    (value.includes("does not exist") || value.includes("schema cache"));
}

export const dynamic = "force-dynamic";

export default async function VerificationApiReportPage({
  searchParams = {}
}: {
  searchParams?: SearchParams;
}) {
  const authorization = await requirePagePermission("verification_api_reports", "access");
  const companyId = requireCompanyId(authorization);
  const page = safePage(searchParams.page);
  const from = safeDate(searchParams.from);
  const to = safeDate(searchParams.to);
  const kind = clean(searchParams.kind);
  const source = clean(searchParams.source);
  const profileType = clean(searchParams.profile_type);
  const result = clean(searchParams.result);
  const search = clean(searchParams.search).replace(/[,%()]/g, " ");

  let rows: AuditRow[] = [];
  let total = 0;
  let error: string | null = null;

  if (!supabaseAdmin) {
    error = "Supabase service role key is not configured.";
  } else {
    let query = supabaseAdmin
      .from("verification_api_audit_logs")
      .select(
        "id, provider_code, verification_kind, endpoint, source, profile_type, account_code, profile_name, actor_label, request_data, response_data, http_status, is_success, result_code, result_message, duration_ms, created_at",
        { count: "exact" }
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (from) query = query.gte("created_at", `${from}T00:00:00+05:30`);
    if (to) query = query.lte("created_at", `${to}T23:59:59.999+05:30`);
    if (kind) query = query.eq("verification_kind", kind);
    if (source) query = query.eq("source", source);
    if (profileType) query = query.eq("profile_type", profileType);
    if (result === "success") query = query.eq("is_success", true);
    if (result === "failed") query = query.eq("is_success", false);
    if (search) {
      query = query.or(
        `account_code.ilike.%${search}%,profile_name.ilike.%${search}%,actor_label.ilike.%${search}%,result_message.ilike.%${search}%`
      );
    }

    const response = await query.range((page - 1) * pageSize, page * pageSize - 1);
    if (response.error) {
      error = response.error.message;
    } else {
      rows = (response.data ?? []) as AuditRow[];
      total = response.count ?? rows.length;
    }
  }

  const successCount = rows.filter((row) => row.is_success).length;
  const failedCount = rows.length - successCount;
  const averageDuration = rows.length
    ? Math.round(rows.reduce((sum, row) => sum + (row.duration_ms ?? 0), 0) / rows.length)
    : 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <AppShell active="Verification API" pageCode="verification_api_reports">
      <PageHead
        eyebrow="Reports"
        title="Verification API"
        subtitle="Review every verification request from Dashboard and DropX One, including the account, API payload, provider response, and outcome."
      />

      {error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>{isMissingAuditTable(error) ? "Database setup needed" : "Unable to load report"}</strong>
            <p className="subtle" style={{ marginTop: 6 }}>
              {error}
              {isMissingAuditTable(error)
                ? " Run scripts/verification_api_audit_logs_v1.sql in Supabase SQL Editor, then refresh."
                : ""}
            </p>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <form action="/reports/verification-api" className="verification-api-report-filters" method="get">
          <label>From<input className="field" defaultValue={from} name="from" type="date" /></label>
          <label>To<input className="field" defaultValue={to} name="to" type="date" /></label>
          <label>API type
            <select className="field" defaultValue={kind} name="kind">
              {kindOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>Source
            <select className="field" defaultValue={source} name="source">
              {sourceOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>Category
            <select className="field" defaultValue={profileType} name="profile_type">
              {profileOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>Result
            <select className="field" defaultValue={result} name="result">
              <option value="">All results</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <label className="verification-api-report-search">Search
            <input className="field" defaultValue={searchParams.search ?? ""} name="search" placeholder="DropX ID, name, user, or message" />
          </label>
          <div className="verification-api-filter-actions">
            <button className="button" type="submit">Apply filters</button>
            <Link className="button secondary" href="/reports/verification-api">Clear</Link>
          </div>
        </form>
      </section>

      <section className="grid metrics verification-api-metrics">
        <div className="metric-card"><span>Filtered calls</span><strong>{total}</strong><small>Across all matching pages</small></div>
        <div className="metric-card"><span>Visible success</span><strong>{successCount}</strong><small>On this page</small></div>
        <div className="metric-card"><span>Visible failed</span><strong>{failedCount}</strong><small>On this page</small></div>
        <div className="metric-card"><span>Average response</span><strong>{averageDuration} ms</strong><small>On this page</small></div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>API trigger history</h2>
            <p className="subtle">{total} matching records. Newest calls are shown first.</p>
          </div>
        </div>
        <div className="table-wrap verification-api-report-table">
          <table>
            <thead>
              <tr>
                <th>Date and time</th>
                <th>API</th>
                <th>API for</th>
                <th>User / account</th>
                <th>Triggered from</th>
                <th>Result</th>
                <th>Response</th>
                <th>Time</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.created_at)}</td>
                  <td>
                    <strong>{labelFor(kindOptions, row.verification_kind)}</strong>
                    <small>{row.provider_code.toUpperCase()}</small>
                  </td>
                  <td>
                    <strong>{row.profile_name || "-"}</strong>
                    <small>{labelFor(profileOptions, row.profile_type ?? "")}</small>
                  </td>
                  <td>
                    <strong>{row.account_code || "-"}</strong>
                    <small>{row.actor_label || "-"}</small>
                  </td>
                  <td>{labelFor(sourceOptions, row.source)}</td>
                  <td>
                    <StatusPill status={row.is_success ? "Success" : "Failed"} />
                    <small>HTTP {row.http_status ?? "-"}</small>
                  </td>
                  <td>
                    <span>{row.result_message || "-"}</span>
                    {row.result_code ? <small>Code: {row.result_code}</small> : null}
                  </td>
                  <td>{row.duration_ms == null ? "-" : `${row.duration_ms} ms`}</td>
                  <td>
                    <VerificationApiLogDetails details={{
                      endpoint: row.endpoint,
                      requestData: row.request_data,
                      responseData: row.response_data
                    }} />
                  </td>
                </tr>
              ))}
              {!rows.length && !error ? (
                <tr><td className="empty-cell" colSpan={9}>No verification API calls match these filters.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {totalPages > 1 ? (
          <nav className="verification-api-pagination" aria-label="Verification API report pages">
            {page > 1 ? <Link className="button secondary compact" href={paginationHref(searchParams, page - 1)}>Previous</Link> : <span />}
            <span>Page {page} of {totalPages}</span>
            {page < totalPages ? <Link className="button secondary compact" href={paginationHref(searchParams, page + 1)}>Next</Link> : <span />}
          </nav>
        ) : null}
      </section>
    </AppShell>
  );
}
