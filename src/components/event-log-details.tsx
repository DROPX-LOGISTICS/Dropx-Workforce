"use client";

import { useState } from "react";

export function EventLogDetails({ metadata }: { metadata: unknown }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="button secondary compact" onClick={() => setOpen(true)} type="button">View</button>
    {open ? <div className="modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
      <section aria-label="Event details" aria-modal="true" className="modal-panel verification-api-detail-modal" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <header className="panel-head"><div><h2>Event details</h2><p className="subtle">Safe metadata captured for this event.</p></div><button className="icon-button" onClick={() => setOpen(false)} type="button">x</button></header>
        <div className="panel-body"><pre className="event-log-json">{JSON.stringify(metadata ?? {}, null, 2)}</pre></div>
      </section>
    </div> : null}
  </>;
}
