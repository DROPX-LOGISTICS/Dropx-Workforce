"use client";

import { useState } from "react";
import { saveWheelseyeSettings } from "@/app/settings/wheelseye-actions";
import { SubmitButton } from "@/components/submit-button";

type WheelseyeSettingsPanelProps = {
  canEdit: boolean;
  settings: {
    is_enabled: boolean;
    token_configured: boolean;
    token_mask: string;
  };
};

export function WheelseyeSettingsPanel({ canEdit, settings }: WheelseyeSettingsPanelProps) {
  const [configuring, setConfiguring] = useState(false);
  const [enabled, setEnabled] = useState(settings.is_enabled);

  return (
    <div className="whatsapp-settings-stack">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Wheelseye API</h2>
            <p className="subtle">Enable live GPS and maintain the Wheelseye access token.</p>
          </div>
          <div className="panel-head-actions">
            {settings.is_enabled ? <span className="status-pill good">Enabled</span> : null}
            <button className="button secondary compact" disabled={!canEdit} onClick={() => setConfiguring(true)} type="button">
              Configure
            </button>
          </div>
        </div>
      </section>

      {configuring ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfiguring(false);
          }}
        >
          <section aria-label="Configure Wheelseye API" className="modal-panel wide">
            <div className="panel-head">
              <div>
                <h2>Wheelseye API</h2>
                <p className="subtle">Enable Wheelseye live GPS and save the production access token.</p>
              </div>
              <button className="icon-button" onClick={() => setConfiguring(false)} type="button">x</button>
            </div>
            <form action={saveWheelseyeSettings}>
              <label className="toggle-field">
                <input checked={enabled} disabled={!canEdit} name="is_enabled" onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />
                <span>Enable Wheelseye GPS</span>
              </label>
              <div className={`form-grid ${!enabled ? "disabled-form-area" : ""}`}>
                <label>Access token
                  <input
                    className="field mono"
                    defaultValue={settings.token_mask}
                    disabled={!canEdit || !enabled}
                    name="access_token"
                    placeholder="Enter Wheelseye access token"
                  />
                  {settings.token_configured ? <small className="field-hint">Token configured - leave unchanged to retain.</small> : null}
                </label>
              </div>
              {canEdit ? (
                <div className="form-actions modal-actions">
                  <button className="button secondary" onClick={() => setConfiguring(false)} type="button">Cancel</button>
                  <SubmitButton>Save settings</SubmitButton>
                </div>
              ) : null}
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
