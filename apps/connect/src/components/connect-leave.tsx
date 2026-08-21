"use client";

import { CalendarDays, Clock3 } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { AppAccount } from "./connect-profile-app";

type LeaveTab = "request" | "history";
type LeaveType = { id: string; name: string; code: string; annual_allowance: number; color: string; available: number };
type ApprovalStep = { request_id: string; step_order: number; step_name: string; status: string; decided_at?: string | null };
type LeaveRequest = {
  id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string;
  status: string;
  reviewer_note?: string | null;
  requested_at: string;
  hr_leave_types?: { name: string; code: string; color: string } | null;
  approvalSteps: ApprovalStep[];
};
type LeavePayload = { types: LeaveType[]; requests: LeaveRequest[]; summary: { available: number; pending: number } };

const emptyPayload: LeavePayload = { types: [], requests: [], summary: { available: 0, pending: 0 } };
const statusLabel: Record<string, string> = { pending: "Awaiting approval", approved: "Approved", rejected: "Rejected", returned: "Returned" };

export function ConnectLeave({ account }: { account: AppAccount }) {
  const [tab, setTab] = useState<LeaveTab>("request");
  const [payload, setPayload] = useState<LeavePayload>(emptyPayload);
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/connect/leave?accountId=${encodeURIComponent(account.id)}&profileType=${encodeURIComponent(account.profileType)}`, { cache: "no-store" });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "Unable to load time off.");
      setPayload(next);
      if (!leaveTypeId && next.types?.[0]?.id) setLeaveTypeId(next.types[0].id);
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "Unable to load time off.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [account.id, account.profileType]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/connect/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: account.id, profileType: account.profileType, leaveTypeId, fromDate, toDate, reason })
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "Unable to submit leave request.");
      setNotice("Leave request submitted to your reporting managers.");
      setFromDate(""); setToDate(""); setReason("");
      await load(); setTab("history");
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "Unable to submit leave request.");
    } finally { setSaving(false); }
  }

  const leaveMasterReady = payload.types.length > 0;
  return (
    <section className="dx-leave">
      <h1>Time off</h1>
      <div className="dx-leave-summary">
        <div><i><CalendarDays /></i><span><small>Available days</small><strong>{loading ? "--" : payload.summary.available}</strong></span></div>
        <div><i><Clock3 /></i><span><small>Awaiting approval</small><strong>{loading ? "--" : payload.summary.pending}</strong></span></div>
      </div>

      <div className="dx-leave-card">
        <nav>
          <button className={tab === "request" ? "active" : ""} onClick={() => setTab("request")}>Request time off</button>
          <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>My requests</button>
        </nav>
        {error ? <p className="dx-form-error">{error}</p> : null}
        {notice ? <p className="dx-form-success">{notice}</p> : null}

        {tab === "request" ? (
          <form onSubmit={submit}>
            <label>Leave type
              <select disabled={!leaveMasterReady || saving} onChange={(event) => setLeaveTypeId(event.target.value)} value={leaveTypeId}>
                <option value="">{loading ? "Loading leave types…" : leaveMasterReady ? "Select leave type" : "No leave types configured"}</option>
                {payload.types.map((type) => <option key={type.id} value={type.id}>{type.name} · {type.available} available</option>)}
              </select>
            </label>
            <div className="dx-leave-dates">
              <label>From date<input min={today} onChange={(event) => setFromDate(event.target.value)} type="date" value={fromDate} /></label>
              <label>To date<input min={fromDate || today} onChange={(event) => setToDate(event.target.value)} type="date" value={toDate} /></label>
            </div>
            <label>Reason<textarea onChange={(event) => setReason(event.target.value)} placeholder="Enter reason for time off" rows={4} value={reason} /></label>
            <button className="dx-save" disabled={saving || !leaveMasterReady || !leaveTypeId || !fromDate || !toDate || reason.trim().length < 3} type="submit">
              {saving ? "Submitting…" : "Submit request"}
            </button>
          </form>
        ) : payload.requests.length ? (
          <div className="dx-leave-history">
            {payload.requests.map((item) => (
              <article key={item.id}>
                <div><strong>{item.hr_leave_types?.name ?? "Time off"}</strong><span className={`dx-request-status ${item.status}`}>{statusLabel[item.status] ?? item.status}</span></div>
                <small>{item.start_date} to {item.end_date} · {item.days} day{Number(item.days) === 1 ? "" : "s"}</small>
                <p>{item.reason}</p>
                {item.approvalSteps.length ? <ol>{item.approvalSteps.map((step) => <li key={`${item.id}-${step.step_order}`}>{step.step_name}: {statusLabel[step.status] ?? step.status}</li>)}</ol> : null}
                {item.reviewer_note ? <small>Review note: {item.reviewer_note}</small> : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="dx-leave-empty"><CalendarDays /><strong>No leave requests yet</strong><small>Submitted requests will appear here.</small></div>
        )}
      </div>
    </section>
  );
}
