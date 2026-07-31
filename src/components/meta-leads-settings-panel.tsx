"use client";

import { useState } from "react";
import { connectAndTestMetaLeadSync, saveMetaLeadsSettings } from "@/app/settings/meta-leads-actions";
import { SubmitButton } from "@/components/submit-button";

type MetaLeadsSettingsPanelProps = {
  canEdit: boolean;
  settings: {
    is_enabled: boolean;
    meta_app_id: string;
    graph_api_version: string;
    ad_account_id: string;
    page_id: string;
    page_name: string;
    webhook_verify_token: string;
    app_secret_mask: string;
    access_token_mask: string;
    app_secret_configured: boolean;
    access_token_configured: boolean;
    last_synced_at: string | null;
  };
};

export function MetaLeadsSettingsPanel({ canEdit, settings }: MetaLeadsSettingsPanelProps) {
  const [configuring, setConfiguring] = useState(false);
  const [enabled, setEnabled] = useState(settings.is_enabled);

  return (
    <div className="whatsapp-settings-stack">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Meta Leads & Ads</h2>
            <p className="subtle">Meta app credentials, lead form sync, ad account access, and ad visibility.</p>
          </div>
          <div className="panel-head-actions">
            {settings.is_enabled ? <span className="status-pill good">Enabled</span> : null}
            {canEdit && settings.is_enabled && settings.app_secret_configured && settings.access_token_configured ? (
              <form action={connectAndTestMetaLeadSync}>
                <SubmitButton className="button secondary compact" pendingText="Testing Meta">
                  Connect &amp; test
                </SubmitButton>
              </form>
            ) : null}
            <button className="button secondary compact" disabled={!canEdit} onClick={() => setConfiguring(true)} type="button">
              Configure
            </button>
          </div>
        </div>
        <div className="panel-body compact-summary-grid">
          <div>
            <span className="subtle">Page</span>
            <strong>{settings.page_name || settings.page_id || "-"}</strong>
          </div>
          <div>
            <span className="subtle">Ad account</span>
            <strong>{settings.ad_account_id || "-"}</strong>
          </div>
          <div>
            <span className="subtle">Token</span>
            <strong>{settings.access_token_configured ? "Configured" : "Missing"}</strong>
          </div>
          <div>
            <span className="subtle">Last sync</span>
            <strong>{settings.last_synced_at ? new Date(settings.last_synced_at).toLocaleString("en-IN") : "-"}</strong>
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
          <section aria-label="Configure Meta Leads" className="modal-panel wide">
            <div className="panel-head">
              <div>
                <h2>Meta Leads & Ads</h2>
                <p className="subtle">Save the Meta app, page, ad account, and token used for lead sync.</p>
              </div>
              <button className="icon-button" onClick={() => setConfiguring(false)} type="button">x</button>
            </div>
            <form action={saveMetaLeadsSettings}>
              <label className="toggle-field">
                <input checked={enabled} disabled={!canEdit} name="is_enabled" onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />
                <span>Enable Meta lead sync</span>
              </label>
              <div className={`form-grid ${!enabled ? "disabled-form-area soft" : ""}`}>
                <label>Meta App ID
                  <input className="field" defaultValue={settings.meta_app_id} disabled={!canEdit || !enabled} name="meta_app_id" />
                </label>
                <label>Graph API version
                  <input className="field mono" defaultValue={settings.graph_api_version} disabled={!canEdit || !enabled} name="graph_api_version" placeholder="v25.0" />
                </label>
                <label>Ad Account ID
                  <input className="field" defaultValue={settings.ad_account_id} disabled={!canEdit || !enabled} name="ad_account_id" placeholder="act_..." />
                </label>
                <label>Page ID
                  <input className="field" defaultValue={settings.page_id} disabled={!canEdit || !enabled} name="page_id" />
                </label>
                <label>Page name
                  <input className="field" defaultValue={settings.page_name} disabled={!canEdit || !enabled} name="page_name" />
                </label>
                <label>App secret
                  <input className="field mono" defaultValue={settings.app_secret_mask} disabled={!canEdit || !enabled} name="app_secret" />
                  {settings.app_secret_configured ? <small className="field-hint">Configured - leave unchanged to retain.</small> : null}
                </label>
                <label>Access token
                  <input className="field mono" defaultValue={settings.access_token_mask} disabled={!canEdit || !enabled} name="access_token" />
                  {settings.access_token_configured ? <small className="field-hint">Configured - leave unchanged to retain.</small> : null}
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
