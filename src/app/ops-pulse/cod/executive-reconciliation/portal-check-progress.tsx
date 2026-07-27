"use client";

import { useEffect, useState } from "react";

export function PortalCheckProgress({
  attemptCount,
  checkLabel,
  lastCheckedAt,
  nextCheckAt,
  summary,
  status
}: {
  attemptCount: number;
  checkLabel: string;
  lastCheckedAt?: string | null;
  nextCheckAt: string | null;
  summary?: string | null;
  status: string;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = nextCheckAt ? Math.max(0, new Date(nextCheckAt).getTime() - now) : 0;
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const active = ["Queued", "Running", "Manual Review", "Error"].includes(status) && attemptCount < 3;
  const exhausted = attemptCount >= 3 && !["Pass", "Fail", "Skipped"].includes(status);
  const displayStatus = status === "Fail" && checkLabel.includes("Driver")
    ? "Pending recon found"
    : status === "Pass" && checkLabel.includes("Driver")
      ? "Driver recon cleared"
      : status === "Error"
        ? "Validation unavailable"
        : status === "Manual Review"
          ? "Manual login required"
          : status || "Not run";
  const checkedLabel = lastCheckedAt
    ? new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit" }).format(new Date(lastCheckedAt))
    : "Not checked";

  return (
    <div className={`portal-check-progress ${exhausted ? "exhausted" : active ? "active" : ""}`}>
      <div><span>{checkLabel}</span><strong>{displayStatus}</strong></div>
      <div><span>Automation attempts</span><strong>{Math.min(attemptCount, 3)} / 3</strong></div>
      <div>
        <span>{active ? "Next update / retry" : exhausted ? "Escalation" : "Last checked"}</span>
        <strong>{active ? `${minutes}:${String(seconds).padStart(2, "0")}` : exhausted ? "Manager notified" : checkedLabel}</strong>
      </div>
      {active ? <div className="portal-progress-track"><i style={{ width: `${Math.max(8, 100 - Math.min(100, remaining / 1800))}%` }} /></div> : null}
      {summary ? <p className="portal-check-summary">{summary}</p> : null}
    </div>
  );
}
