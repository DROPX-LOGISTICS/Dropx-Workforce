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
    provider_code: string;
    token_id_configured: boolean;
    token_id_mask: string;
  };
};

const providerOptions = [
  { value: "idspay", label: "IDSPAY" }
];

export function VerificationApiSettingsPanel({ canEdit, settings }: VerificationApiSettingsPanelProps) {
  const [provider, setProvider] = useState(settings.provider_code || "idspay");

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Verification API credentials</h2>
          <p className="subtle">Save provider credentials now. Usage rules can be mapped later.</p>
        </div>
        {settings.api_key_configured && settings.token_id_configured ? <span className="status-pill good">Configured</span> : null}
      </div>

      <form action={saveVerificationApiSettings} className="form-grid three">
        <label>Verification API
          <SearchableSelect
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
              <input className="field mono" defaultValue={settings.api_id} disabled={!canEdit} name="api_id" placeholder="Enter API ID" required />
            </label>
            <label>IDSPAY API key
              <input className="field mono" defaultValue={settings.api_key_mask} disabled={!canEdit} name="api_key" placeholder="Enter API key" type="password" />
              {settings.api_key_configured ? <small className="field-hint">Configured - leave unchanged to retain.</small> : null}
            </label>
            <label>IDSPAY token ID
              <input className="field mono" defaultValue={settings.token_id_mask} disabled={!canEdit} name="token_id" placeholder="Enter token ID" type="password" />
              {settings.token_id_configured ? <small className="field-hint">Configured - leave unchanged to retain.</small> : null}
            </label>
          </>
        ) : null}

        {canEdit ? (
          <div className="form-actions span-3 align-right">
            <SubmitButton>Save settings</SubmitButton>
          </div>
        ) : null}
      </form>
    </section>
  );
}
