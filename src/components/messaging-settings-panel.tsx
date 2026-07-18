"use client";

type MessagingSettingsPanelProps = {
  canEdit: boolean;
  metaStatus: {
    isEnabled: boolean;
    isConfigured: boolean;
  };
};

export function MessagingSettingsPanel({ canEdit, metaStatus }: MessagingSettingsPanelProps) {
  return (
    <div className="whatsapp-settings-stack">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Meta Messaging</h2>
            <p className="subtle">Meta app credentials, WhatsApp profiles, templates, Facebook Messenger, and Instagram DM settings.</p>
          </div>
          <div className="panel-head-actions">
            {metaStatus.isEnabled ? <span className="status-pill good">Enabled</span> : null}
            <a className="button secondary compact" href="/settings/meta">
              Configure
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
