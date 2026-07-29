"use client";

import { CalendarDays, Clock3 } from "lucide-react";
import { useState } from "react";

type LeaveTab = "request" | "history";

export function ConnectLeave() {
  const [tab, setTab] = useState<LeaveTab>("request");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");
  const leaveTypes: Array<{ id: string; name: string }> = [];
  const leaveMasterReady = leaveTypes.length > 0;

  return (
    <section className="dx-leave">
      <h1>Leave</h1>

      <div className="dx-leave-summary">
        <div>
          <i><CalendarDays /></i>
          <span><small>Available</small><strong>--</strong></span>
        </div>
        <div>
          <i><Clock3 /></i>
          <span><small>Pending</small><strong>0</strong></span>
        </div>
      </div>

      <div className="dx-leave-card">
        <nav>
          <button className={tab === "request" ? "active" : ""} onClick={() => setTab("request")}>Request leave</button>
          <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>My requests</button>
        </nav>

        {tab === "request" ? (
          <form onSubmit={(event) => event.preventDefault()}>
            <label>
              Leave type
              <select disabled={!leaveMasterReady} value="">
                <option value="">{leaveMasterReady ? "Select leave type" : "No leave types configured"}</option>
                {leaveTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
              </select>
            </label>
            {!leaveMasterReady ? <p>Leave types will appear after Leave Master is configured.</p> : null}

            <div className="dx-leave-dates">
              <label>
                From date
                <input min={new Date().toISOString().slice(0, 10)} onChange={(event) => setFromDate(event.target.value)} type="date" value={fromDate} />
              </label>
              <label>
                To date
                <input min={fromDate || new Date().toISOString().slice(0, 10)} onChange={(event) => setToDate(event.target.value)} type="date" value={toDate} />
              </label>
            </div>

            <label>
              Reason
              <textarea onChange={(event) => setReason(event.target.value)} placeholder="Enter reason for leave" rows={4} value={reason} />
            </label>
            <button className="dx-save" disabled={!leaveMasterReady || !fromDate || !toDate || !reason.trim()} type="submit">Submit request</button>
          </form>
        ) : (
          <div className="dx-leave-empty">
            <CalendarDays />
            <strong>No leave requests yet</strong>
            <small>Submitted requests will appear here.</small>
          </div>
        )}
      </div>
    </section>
  );
}
