"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitCodCashCollection } from "./actions";
import { CashSubmissionButton } from "./cash-submission-button";

export function CashSubmissionForm({
  businessDate,
  disabled,
  locationId,
  returnHref,
  stationCode,
  varianceLabel,
  varianceType,
  workerConfigured
}: {
  businessDate: string;
  disabled: boolean;
  locationId: string;
  returnHref: string;
  stationCode: string;
  varianceLabel: string;
  varianceType: "balanced" | "excess" | "short";
  workerConfigured: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || disabled) return;
        const form = event.currentTarget;
        const formData = new FormData(form);
        formData.set("response_mode", "client");
        setError(null);
        setPending(true);
        void (async () => {
          try {
            const result = await submitCodCashCollection(formData);
            if (result && typeof result === "object" && "ok" in result) {
              if (result.ok) {
                const nextHref = result.nextHref || returnHref;
                router.push(nextHref);
                router.refresh();
                return;
              }
              setError(result.error ?? "Unable to submit COD cash.");
              setPending(false);
              return;
            }
            // Legacy redirect path — browser will navigate.
          } catch (err) {
            setError(err instanceof Error ? err.message : "Unable to submit COD cash.");
            setPending(false);
          }
        })();
      }}
    >
      <input type="hidden" name="return_href" value={returnHref} />
      <input type="hidden" name="business_date" value={businessDate} />
      <input type="hidden" name="location_id" value={locationId} />
      <CashSubmissionButton
        disabled={disabled || pending}
        stationCode={stationCode}
        businessDate={businessDate}
        varianceLabel={varianceLabel}
        varianceType={varianceType}
        workerConfigured={workerConfigured}
      />
      {error ? <p className="field-error">{error}</p> : null}
      {pending ? <p className="subtle" style={{ marginTop: 8 }}>Submitting cash and opening deposit step…</p> : null}
    </form>
  );
}
