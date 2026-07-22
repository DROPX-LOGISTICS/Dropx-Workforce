"use client";

import { useState } from "react";
import { saveVerificationApiSettings } from "@/app/settings/verification-apis/actions";
import { SearchableSelect } from "@/components/searchable-select";
import { SubmitButton } from "@/components/submit-button";

type VerificationApiSettingsPanelProps = {
  canEdit: boolean;
  settings: {
    api_id: string;
    api_key_configured: boolean;
    api_key_mask: string;
    has_settings: boolean;
    is_enabled: boolean;
    provider_code: string;
    token_id_configured: boolean;
    token_id_mask: string;
  };
};

const providerOptions = [
  { value: "idspay", label: "IDSPAY" }
];

export function VerificationApiSettingsPanel({ canEdit, settings }: VerificationApiSettingsPanelProps) {
  const [editing, setEditing] = useState(!settings.has_settings);
  const [enabled, setEnabled] = useState(settings.is_enabled);
  const [provider, setProvider] = useState(settings.provider_code || "idspay");
  const fieldsEnabled = canEdit && editing && enabled;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Verification API credentials</h2>
          <p className="subtle">Save provider credentials now. Usage rules can be mapped later.</p>
        </div>
        <div className="panel-head-actions">
          {settings.is_enabled ? <span className="status-pill good">Enabled</span> : null}
          {!settings.is_enabled && settings.has_settings ? <span className="status-pill warn">Disabled</span> : null}
          {settings.api_key_configured && settings.token_id_configured ? <span className="status-pill good">Configured</span> : null}
          {canEdit && !editing ? (
            <button className="button secondary compact" onClick={() => setEditing(true)} type="button">Edit</button>
          ) : null}
        </div>
      </div>

      <form action={saveVerificationApiSettings} className="form-grid three">
        <input name="provider_code" type="hidden" value={provider} />
        {!fieldsEnabled ? <input name="api_id" type="hidden" value={settings.api_id} /> : null}
        <label className="toggle-field verification-api-toggle span-3">
          <input
            checked={enabled}
            disabled={!canEdit || !editing}
            name="is_enabled"
            onChange={(event) => setEnabled(event.target.checked)}
            type="checkbox"
          />
          <span>Enable IDSPAY verification API</span>
        </label>

        <label>Verification API
          <SearchableSelect
            disabled={!fieldsEnabled}
            name="provider_code"
            options={providerOptions}
            defaultValue={provider}
            onValueChange={(value) => setProvider(value)}
            placeholder="Select verification API"
            required
          />
        </label>

        {provider === "idspay" ? (
          <>
            <label>IDSPAY API ID
              <input className="field mono" defaultValue={settings.api_id} disabled={!fieldsEnabled} name="api_id" placeholder="Enter API ID" required={enabled} />
            </label>
            <label>IDSPAY API key
              <input className="field mono" defaultValue={settings.api_key_mask} disabled={!fieldsEnabled} name="api_key" placeholder="Enter API key" type="password" />
              {settings.api_key_configured ? <small className="field-hint">Configured - leave unchanged to retain.</small> : null}
            </label>
            <label>IDSPAY token ID
              <input className="field mono" defaultValue={settings.token_id_mask} disabled={!fieldsEnabled} name="token_id" placeholder="Enter token ID" type="password" />
              {settings.token_id_configured ? <small className="field-hint">Configured - leave unchanged to retain.</small> : null}
            </label>
          </>
        ) : null}

        {canEdit && editing ? (
          <div className="form-actions span-3 align-right">
            {settings.has_settings ? <button className="button secondary" onClick={() => {
              setEditing(false);
              setEnabled(settings.is_enabled);
              setProvider(settings.provider_code || "idspay");
            }} type="button">Cancel</button> : null}
            <SubmitButton>Save settings</SubmitButton>
          </div>
        ) : null}
      </form>
    </section>
  );
}
