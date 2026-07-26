"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Fingerprint, LogIn, LogOut, Paperclip, UserCheck, UserX, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

type Account = { id: string; profileType: string };
type Regularization = {
  id: string;
  requestedInTime: string;
  requestedOutTime: string;
  reasonCode: string;
  remarks: string;
  hasAttachment: boolean;
  status: string;
  reviewRemarks: string;
  createdAt: string;
};
type Row = {
  date: string;
  status: string;
  inTime: string;
  outTime: string;
  workHours: string;
  punchCount: number;
  remark: string;
  regularization: Regularization | null;
};
type Attendance = {
  month: string;
  summary: { present: number; absent: number; misPunch: number };
  rows: Row[];
};

function monthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month: "short", year: "2-digit" })
    .format(new Date(year, month - 1, 1))
    .replace(" ", "-");
}

function shiftMonth(value: string, amount: number) {
  const [year, month] = value.split("-").map(Number);
  const next = new Date(year, month - 1 + amount, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

function minutes(value: string) {
  const match = value.match(/(\d+):(\d+)/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

function dayStatus(row: Row | undefined, future: boolean) {
  if (future || !row) return "off";
  if (row.status === "A") return "absent";
  if (row.remark.toLowerCase().match(/single|missing/)) return "miss";
  return row.status === "P" ? "present" : "off";
}

function emptyAttendanceRow(date: string): Row {
  return {
    date,
    status: "",
    inTime: "",
    outTime: "",
    workHours: "",
    punchCount: 0,
    remark: "",
    regularization: null
  };
}

export function ConnectAttendance({ account }: { account: Account }) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState(currentMonth);
  const [tab, setTab] = useState<"calendar" | "list" | "punches">("calendar");
  const [data, setData] = useState<Attendance | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [regularizing, setRegularizing] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const loadAttendance = useCallback(() => {
    setData(null);
    setError("");
    fetch(`/api/connect/attendance?accountId=${encodeURIComponent(account.id)}&profileType=${encodeURIComponent(account.profileType)}&month=${month}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load attendance.");
        setData(payload);
        setSelected(payload.rows?.find((row: Row) => row.date === new Date().toISOString().slice(0, 10)) ?? payload.rows?.at(-1) ?? null);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load attendance."));
  }, [account.id, account.profileType, month]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance, refreshKey]);

  const rowsByDay = useMemo(() => new Map((data?.rows ?? []).map((row) => [Number(row.date.slice(-2)), row])), [data]);
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(year, monthNumber, 0).getDate();
  const leading = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7;
  const total = (data?.rows ?? []).reduce((sum, row) => sum + minutes(row.workHours), 0);
  const futureMonth = month >= currentMonth;

  return (
    <section className="dx-attendance">
      <div className="dx-title-row">
        <h1>Attendance</h1>
        <div className="dx-month-control">
          <button aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft /></button>
          <strong>{monthLabel(month)}</strong>
          <button aria-label="Next month" disabled={futureMonth} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight /></button>
        </div>
      </div>

      {error ? <div className="dx-alert error">{error}<button onClick={() => setMonth((value) => `${value}`)}>Retry</button></div> : null}
      {!data && !error ? <div className="dx-loader"><span /><small>Loading attendance...</small></div> : null}
      {data ? <>
        <div className="dx-attendance-summary">
          <div><i><UserCheck /></i><span>Present<strong>{data.summary.present}</strong></span></div>
          <div><i><UserX /></i><span>Absent<strong>{data.summary.absent}</strong></span></div>
          <div><i><Clock3 /></i><span>Mis Punch<strong>{data.summary.misPunch}</strong></span></div>
          <p><Clock3 /> Total Hours <strong>{Math.floor(total / 60)}:{String(total % 60).padStart(2, "0")}</strong></p>
        </div>
        <div className="dx-tabs-card">
          <nav>
            {(["calendar", "list", "punches"] as const).map((item) => (
              <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </nav>
          {tab === "calendar" ? <div className="dx-calendar">
            <div className="dx-week">{["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((day) => <span key={day}>{day}</span>)}</div>
            <div className="dx-days">
              {Array.from({ length: leading }).map((_, index) => <span key={`blank-${index}`} />)}
              {Array.from({ length: days }, (_, index) => index + 1).map((day) => {
                const row = rowsByDay.get(day);
                const future = new Date(year, monthNumber - 1, day) > now;
                const date = `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                return <button className={`${dayStatus(row, future)} ${selected?.date === date ? "selected" : ""}`} disabled={future} key={day} onClick={() => !future && setSelected(row ?? emptyAttendanceRow(date))}>{day}</button>;
              })}
            </div>
            <div className="dx-legend"><span className="present">Present</span><span className="absent">Absent</span><span className="miss">Mis Punch</span><span className="off">Off / Future</span></div>
          </div> : null}
          {tab === "list" ? <div className="dx-attendance-list">
            {(data.rows.length ? [...data.rows].reverse() : []).map((row) => <button key={row.date} onClick={() => { setSelected(row); setTab("calendar"); }}>
              <header><strong>{row.date.split("-").reverse().join("/")}</strong><em className={dayStatus(row, false)}>{row.status === "P" ? "Present" : row.status === "A" ? "Absent" : row.status}</em></header>
              <span><small>IN</small>{row.inTime || "--:--"}</span><span><small>OUT</small>{row.outTime || "--:--"}</span><span><small>HRS</small>{row.workHours || "00:00"}</span>
            </button>)}
          </div> : null}
          {tab === "punches" ? <div className="dx-punches">
            {(data.rows.length ? [...data.rows].reverse() : []).flatMap((row) => [
              row.inTime ? <div key={`${row.date}-in`}><Fingerprint /><span>{row.date.split("-").reverse().join("/")}</span><strong>{row.inTime}</strong></div> : null,
              row.outTime ? <div key={`${row.date}-out`}><Fingerprint /><span>{row.date.split("-").reverse().join("/")}</span><strong>{row.outTime}</strong></div> : null
            ])}
          </div> : null}
        </div>
        {tab === "calendar" && selected ? <div className="dx-selected-day">
          <header><div><CalendarDays /><strong>{selected.date.split("-").reverse().join("/")}</strong></div><em className={dayStatus(selected, false)}>{selected.status === "P" ? "Present" : selected.status === "A" ? "Absent" : "No punch"}</em></header>
          <div><span><LogIn /><small>IN</small><strong>{selected.inTime || "--:--"}</strong></span><span><LogOut /><small>OUT</small><strong>{selected.outTime || "--:--"}</strong></span><span><Clock3 /><small>WORK</small><strong>{selected.workHours || "00:00"}</strong></span><span><Fingerprint /><small>PUNCHES</small><strong>{selected.punchCount}</strong></span></div>
          <footer>
            {selected.regularization ? <span className={`dx-request-status ${selected.regularization.status}`}>Regularization {selected.regularization.status}</span> : null}
            {selected.regularization?.status !== "pending" ? <button onClick={() => { setRequestError(""); setRegularizing(true); }}>Regularize</button> : null}
          </footer>
        </div> : null}
      </> : null}
      {regularizing && selected ? <RegularizationSheet
        account={account}
        row={selected}
        onClose={() => setRegularizing(false)}
        onSubmitted={() => {
          setRegularizing(false);
          setRefreshKey((value) => value + 1);
        }}
        error={requestError}
        setError={setRequestError}
      /> : null}
    </section>
  );
}

function RegularizationSheet({
  account,
  row,
  onClose,
  onSubmitted,
  error,
  setError
}: {
  account: Account;
  row: Row;
  onClose: () => void;
  onSubmitted: () => void;
  error: string;
  setError: (message: string) => void;
}) {
  const [inTime, setInTime] = useState(row.regularization?.requestedInTime || row.inTime || "");
  const [outTime, setOutTime] = useState(row.regularization?.requestedOutTime || row.outTime || "");
  const [reason, setReason] = useState(row.regularization?.reasonCode || "");
  const [remarks, setRemarks] = useState(row.regularization?.remarks || "");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const form = new FormData();
      form.set("accountId", account.id);
      form.set("profileType", account.profileType);
      form.set("attendanceDate", row.date);
      form.set("currentInTime", row.inTime);
      form.set("currentOutTime", row.outTime);
      form.set("requestedInTime", inTime);
      form.set("requestedOutTime", outTime);
      form.set("reasonCode", reason);
      form.set("remarks", remarks);
      if (attachment) form.set("attachment", attachment);
      const response = await fetch("/api/connect/attendance", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to submit regularization request.");
      onSubmitted();
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "Unable to submit regularization request.");
    } finally {
      setSaving(false);
    }
  }

  return <>
    <button aria-label="Close regularization" className="dx-sheet-scrim" onClick={onClose} />
    <aside className="dx-regularization-sheet" role="dialog" aria-modal="true" aria-labelledby="regularization-title">
      <header>
        <div><strong id="regularization-title">Attendance regularization</strong><small>Request a correction for this attendance day.</small></div>
        <button aria-label="Close" onClick={onClose}><X /></button>
      </header>
      <form onSubmit={submit}>
        <div className="dx-regularization-day">
          <span><small>DATE</small><strong>{row.date.split("-").reverse().join("/")}</strong></span>
          <em>{row.status === "P" ? "Present" : row.status === "A" ? "Absent" : "No punch"}</em>
        </div>
        <div className="dx-time-grid">
          <label>Requested IN<input required type="time" value={inTime} onChange={(event) => setInTime(event.target.value)} /></label>
          <label>Requested OUT<input required type="time" value={outTime} onChange={(event) => setOutTime(event.target.value)} /></label>
        </div>
        <label>Reason<select required value={reason} onChange={(event) => setReason(event.target.value)}>
          <option value="">Select reason</option>
          <option value="missed_in">Missed IN punch</option>
          <option value="missed_out">Missed OUT punch</option>
          <option value="incorrect_in">Incorrect IN time</option>
          <option value="incorrect_out">Incorrect OUT time</option>
          <option value="other">Other</option>
        </select></label>
        <label>Remarks<textarea required minLength={5} placeholder="Briefly explain the correction" rows={3} value={remarks} onChange={(event) => setRemarks(event.target.value)} /></label>
        <label className="dx-attachment"><Paperclip /><span>{attachment?.name || "Attach supporting file (optional)"}</span><input accept=".jpg,.jpeg,.png,.webp,.pdf" type="file" onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} /></label>
        {error ? <p className="dx-form-error">{error}</p> : null}
        <div className="dx-sheet-actions"><button className="secondary" onClick={onClose} type="button">Cancel</button><button disabled={saving} type="submit">{saving ? "Submitting..." : "Submit request"}</button></div>
      </form>
    </aside>
  </>;
}
