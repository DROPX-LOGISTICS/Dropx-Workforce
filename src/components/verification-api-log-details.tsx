"use client";

import { useState } from "react";

type LogDetails = {
  endpoint: string;
  requestData: unknown;
  responseData: unknown;
};

export function VerificationApiLogDetails({ details }: { details: LogDetails }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="button secondary compact" type="button" onClick={() => setOpen(true)}>
        View
      </button>
      {open ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            aria-label="Verification API call details"
            aria-modal="true"
            className="modal-panel verification-api-detail-modal"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="panel-head">
              <div>
                <h2>API call details</h2>
                <p className="subtle">{details.endpoint}</p>
              </div>
              <button className="icon-button" type="button" aria-label="Close" onClick={() => setOpen(false)}>
                x
              </button>
            </header>
            <div className="verification-api-json-grid">
              <section>
                <h3>Request</h3>
                <pre>{JSON.stringify(details.requestData, null, 2)}</pre>
              </section>
              <section>
                <h3>Provider response</h3>
                <pre>{JSON.stringify(details.responseData, null, 2)}</pre>
              </section>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
