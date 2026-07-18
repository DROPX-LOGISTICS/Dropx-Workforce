"use client";

import { Copy } from "lucide-react";
import { saveWebhookSettings } from "@/app/settings/webhook-actions";
import { SubmitButton } from "@/components/submit-button";

type WebhookSettingsPanelProps = {
  canEdit: boolean;
  webhookUrl: string;
  webhookVerifyToken: string;
};

export function WebhookSettingsPanel({ canEdit, webhookUrl, webhookVerifyToken }: WebhookSettingsPanelProps) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Webhook</h2>
          <p className="subtle">Use this single callback URL for WhatsApp, Facebook Messenger, Instagram, Meta Leads, and future platforms.</p>
        </div>
      </div>
      <form action={saveWebhookSettings} className="panel-body">
        <div className="form-grid">
          <label>Webhook URL
            <div className="copy-field">
              <input className="field mono" readOnly value={webhookUrl} />
              <button className="icon-button" onClick={() => navigator.clipboard?.writeText(webhookUrl)} title="Copy webhook URL" type="button">
                <Copy size={16} />
              </button>
            </div>
          </label>
          <label>Webhook verify token
            <input className="field" defaultValue={webhookVerifyToken} disabled={!canEdit} name="webhook_verify_token" placeholder="Optional verify token" />
          </label>
        </div>
        {canEdit ? (
          <div className="form-actions">
            <SubmitButton>Save settings</SubmitButton>
          </div>
        ) : null}
      </form>
    </section>
  );
}
