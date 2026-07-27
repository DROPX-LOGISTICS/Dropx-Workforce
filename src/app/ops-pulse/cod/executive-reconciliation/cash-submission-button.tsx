"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

export function CashSubmissionButton({
  disabled,
  varianceLabel,
  varianceType
}: {
  disabled: boolean;
  varianceLabel: string;
  varianceType: "balanced" | "excess" | "short";
}) {
  const [confirming, setConfirming] = useState(false);
  const { pending } = useFormStatus();

  if (varianceType === "balanced") {
    return (
      <button className="button" disabled={disabled || pending} type="submit">
        {pending ? "Submitting…" : "Submit cash & run SCC"}
      </button>
    );
  }

  if (!confirming) {
    return (
      <button
        className={varianceType === "short" ? "button danger-button" : "button"}
        disabled={disabled || pending}
        onClick={() => setConfirming(true)}
        type="button"
      >
        Submit with {varianceType}
      </button>
    );
  }

  return (
    <div className={`cash-submit-confirm ${varianceType}`} role="alert">
      <div>
        <strong>{varianceLabel}</strong>
        <span>
          Submission is allowed. The variance will remain open, the manager will be notified, and SCC Driver Reconciliation will run automatically.
        </span>
      </div>
      <div className="form-actions">
        <button className="button ghost" disabled={pending} onClick={() => setConfirming(false)} type="button">
          Go back
        </button>
        <button className="button" disabled={disabled || pending} type="submit">
          {pending ? "Submitting…" : "Confirm & run SCC"}
        </button>
      </div>
    </div>
  );
}
