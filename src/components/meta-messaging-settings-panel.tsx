"use client";

import { useState } from "react";
import { saveMetaMessagingSettings } from "@/app/settings/meta-messaging-actions";
import { SubmitButton } from "@/components/submit-button";

type MetaMessagingSettingsPanelProps = {
  canEdit: boolean;
  showWhatsAppCard?: boolean;
  settings: {
    is_facebook_enabled: boolean;
    is_instagram_enabled: boolean;
    meta_app_id: string;
    graph_api_version: string;
    webhook_verify_token: string;
    facebook_page_id: string;
    facebook_page_name: string;
    instagram_business_account_id: string;
    instagram_connected_page_id: string;
    app_secret_mask: string;
    page_access_token_mask: string;
    app_secret_configured: boolean;
    page_access_token_configured: boolean;
  };
  whatsAppStatus?: {
    isEnabled: boolean;
    isConfigured: boolean;
  };
};

export function MetaMessagingSettingsPanel({ canEdit, settings, showWhatsAppCard = true, whatsAppStatus }: MetaMessagingSettingsPanelProps) {
  const [configuring, setConfiguring] = useState<"app" | "facebook" | "instagram" | null>(null);
  const [facebookEnabled, setFacebookEnabled] = useState(settings.is_facebook_enabled);
  const [instagramEnabled, setInstagramEnabled] = useState(settings.is_instagram_enabled);

  return (
    <div className="whatsapp-settings-stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">Configuration</div>
          <h1>Meta Messaging</h1>
          <p className="subtle" style={{ marginTop: 6 }}>
            Meta app credentials and platform settings for WhatsApp, Pages/Messenger, and Instagram.
          </p>
        </div>
        <div className="panel-head-actions">
          <a className="button secondary" href="/settings/messaging">Back</a>
          <button className="button secondary" disabled={!canEdit} onClick={() => setConfiguring("app")} type="button">
            Configure
          </button>
        </div>
      </div>

      {showWhatsAppCard ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>WhatsApp</h2>
              <p className="subtle">Sender profiles, templates, and WhatsApp notification rules.</p>
          </div>
          <div className="panel-head-actions">
              {whatsAppStatus?.isEnabled ? <span className="status-pill good">Enabled</span> : null}
              <a className="button secondary compact" href="/settings/meta?platform=whatsapp">
                Configure
              </a>
            </div>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Pages / Messenger</h2>
            <p className="subtle">Facebook Page inbox settings for Messenger conversations.</p>
          </div>
          <div className="panel-head-actions">
            {settings.is_facebook_enabled ? <span className="status-pill good">Enabled</span> : null}
            <a className="button secondary compact" aria-disabled={!canEdit} href="/settings/meta?platform=facebook">
              Configure
            </a>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Instagram</h2>
            <p className="subtle">Instagram DM settings using the connected Meta business account.</p>
          </div>
          <div className="panel-head-actions">
            {settings.is_instagram_enabled ? <span className="status-pill good">Enabled</span> : null}
            <a className="button secondary compact" aria-disabled={!canEdit} href="/settings/meta?platform=instagram">
              Configure
            </a>
          </div>
        </div>
      </section>

      {configuring ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfiguring(null);
          }}
        >
          <section aria-label="Configure Meta Messaging" className="modal-panel wide">
            <div className="panel-head">
              <div>
                <h2>{configuring === "app" ? "Meta app" : configuring === "facebook" ? "Pages / Messenger" : "Instagram"}</h2>
                <p className="subtle">
                  {configuring === "app"
                    ? "Configure Meta app credentials used by Messenger and Instagram APIs."
                    : configuring === "facebook"
                      ? "Configure Facebook Page Messenger access."
                      : "Configure Instagram DM access."}
                </p>
              </div>
              <button className="icon-button" onClick={() => setConfiguring(null)} type="button">x</button>
            </div>
            <form action={saveMetaMessagingSettings}>
              {configuring !== "facebook" ? <input name="is_facebook_enabled" type="hidden" value={settings.is_facebook_enabled ? "on" : ""} /> : null}
              {configuring !== "instagram" ? <input name="is_instagram_enabled" type="hidden" value={settings.is_instagram_enabled ? "on" : ""} /> : null}

              {configuring === "app" ? (
                <div className="form-grid">
                  <label>Meta App ID
                    <input className="field" defaultValue={settings.meta_app_id} disabled={!canEdit} name="meta_app_id" placeholder="Enter Meta app ID" />
                  </label>
                  <label>Graph API version
                    <input className="field mono" defaultValue={settings.graph_api_version} disabled={!canEdit} name="graph_api_version" placeholder="v25.0" />
                  </label>
                  <label>App secret
                    <input className="field mono" defaultValue={settings.app_secret_mask} disabled={!canEdit} name="app_secret" placeholder="Enter Meta app secret" />
                    {settings.app_secret_configured ? <small className="field-hint">Configured - leave unchanged to retain.</small> : null}
                  </label>
                </div>
              ) : null}

              {configuring === "facebook" ? (
                <>
                  <label className="toggle-field">
                    <input checked={facebookEnabled} disabled={!canEdit} name="is_facebook_enabled" onChange={(event) => setFacebookEnabled(event.target.checked)} type="checkbox" />
                    <span>Enable Facebook messages</span>
                  </label>
                  <div className={`form-grid ${!facebookEnabled ? "disabled-form-area soft" : ""}`}>
                    <label>Page ID
                      <input className="field" defaultValue={settings.facebook_page_id} disabled={!canEdit || !facebookEnabled} name="facebook_page_id" placeholder="Facebook Page ID" />
                    </label>
                    <label>Page name
                      <input className="field" defaultValue={settings.facebook_page_name} disabled={!canEdit || !facebookEnabled} name="facebook_page_name" placeholder="Display name" />
                    </label>
                    <label>Page access token
                      <input className="field mono" defaultValue={settings.page_access_token_mask} disabled={!canEdit || !facebookEnabled} name="page_access_token" placeholder="Enter Page access token" />
                      {settings.page_access_token_configured ? <small className="field-hint">Configured - leave unchanged to retain.</small> : null}
                    </label>
                  </div>
                </>
              ) : null}

              {configuring === "instagram" ? (
                <>
                  <label className="toggle-field">
                    <input checked={instagramEnabled} disabled={!canEdit} name="is_instagram_enabled" onChange={(event) => setInstagramEnabled(event.target.checked)} type="checkbox" />
                    <span>Enable Instagram messages</span>
                  </label>
                  <div className={`form-grid ${!instagramEnabled ? "disabled-form-area soft" : ""}`}>
                    <label>Instagram business account ID
                      <input className="field" defaultValue={settings.instagram_business_account_id} disabled={!canEdit || !instagramEnabled} name="instagram_business_account_id" placeholder="IG business account ID" />
                    </label>
                    <label>Connected Page ID
                      <input className="field" defaultValue={settings.instagram_connected_page_id} disabled={!canEdit || !instagramEnabled} name="instagram_connected_page_id" placeholder="Facebook Page linked to Instagram" />
                    </label>
                    <label>Page access token
                      <input className="field mono" defaultValue={settings.page_access_token_mask} disabled={!canEdit || !instagramEnabled} name="page_access_token" placeholder="Enter Page access token" />
                      {settings.page_access_token_configured ? <small className="field-hint">Configured - leave unchanged to retain.</small> : null}
                    </label>
                  </div>
                </>
              ) : null}

              {canEdit ? (
                <div className="form-actions modal-actions">
                  <button className="button secondary" onClick={() => setConfiguring(null)} type="button">Cancel</button>
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
