"use client";

import { useEffect, useState } from "react";

export function PortalCheckProgress({
  attemptCount,
  checkLabel,
  nextCheckAt,
  status
}: {
  attemptCount: number;
  checkLabel: string;
  nextCheckAt: string | null;
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
  const active = ["Queued", "Running", "Error"].includes(status) && attemptCount < 3;
  const exhausted = attemptCount >= 3 && status !== "Pass";

  return (
    <div className={`portal-check-progress ${exhausted ? "exhausted" : active ? "active" : ""}`}>
      <div><span>{checkLabel}</span><strong>{status || "Not run"}</strong></div>
      <div><span>Automation attempts</span><strong>{Math.min(attemptCount, 3)} / 3</strong></div>
      <div>
        <span>{active ? "Next update / retry" : exhausted ? "Escalation" : "Result"}</span>
        <strong>{active ? `${minutes}:${String(seconds).padStart(2, "0")}` : exhausted ? "Manager notified" : status === "Pass" ? "Completed" : "Waiting to start"}</strong>
      </div>
      {active ? <div className="portal-progress-track"><i style={{ width: `${Math.max(8, 100 - Math.min(100, remaining / 1800))}%` }} /></div> : null}
    </div>
  );
}
