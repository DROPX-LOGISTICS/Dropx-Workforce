import { AppShell } from "@/components/app-shell";
import { BulkWhatsAppPanel } from "@/components/bulk-whatsapp-panel";
import type { Campaign } from "@/components/campaign-report";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { loadWorkforceCommunicationRecipients } from "@/lib/workforce-communication-recipients";
import type { WhatsAppTemplateComponent } from "@/lib/whatsapp-template";

export const dynamic = "force-dynamic";

type WhatsAppProfile = {
  id: string;
  profile_name: string;
  phone_number_id: string;
  default_country_code: string;
  is_default: boolean;
  is_active: boolean;
};

type WhatsAppTemplate = {
  template_id: string;
  whatsapp_profile_id: string | null;
  name: string;
  language: string;
  category: string | null;
  status: string;
  components: WhatsAppTemplateComponent[];
};

export default async function WorkforceWhatsAppPage() {
  const authorization = await requirePagePermission("workforce_communications_whatsapp", "access");
  const recipients = await loadWorkforceCommunicationRecipients(authorization);
  const permission = authorization.permissions.workforce_communications_whatsapp;
  const companyId = authorization.companyId!;

  if (!supabaseAdmin) {
    return (
      <AppShell active="WhatsApp" pageCode="workforce_communications_whatsapp">
        <PageHead eyebrow="Workforce communications" title="WhatsApp" subtitle="Send approved WhatsApp templates to Workforce recipients." />
        <section className="panel message-panel error"><div className="panel-body"><strong>Action required</strong><p className="subtle">Supabase service role key is not configured.</p></div></section>
      </AppShell>
    );
  }

  const [settings, templates, profiles, campaignProfiles, campaigns] = await Promise.all([
    supabaseAdmin.from("whatsapp_settings").select("is_enabled").eq("company_id", companyId).eq("id", true).maybeSingle(),
    supabaseAdmin.from("whatsapp_template_cache").select("template_id, whatsapp_profile_id, name, language, category, status, components").eq("company_id", companyId).order("name"),
    supabaseAdmin.from("whatsapp_profiles").select("id, profile_name, phone_number_id, default_country_code, is_default, is_active").eq("company_id", companyId).eq("is_active", true).order("profile_name"),
    supabaseAdmin.from("whatsapp_profiles").select("id, profile_name").eq("company_id", companyId),
    supabaseAdmin
      .from("whatsapp_campaigns")
      .select("id, campaign_code, whatsapp_profile_id, whatsapp_profile_name, created_at, total_count, sent_count, failed_count, pending_count, status, whatsapp_campaign_recipients (id, row_no, recipient_name, recipient_mobile, country_code, status, provider_message_id, error_message, sent_at, updated_at)")
      .eq("company_id", companyId)
      .eq("source_mode", "workforce")
      .order("created_at", { ascending: false })
      .limit(25)
  ]);
  const error = settings.error ?? templates.error ?? profiles.error ?? campaignProfiles.error;
  const profileNameById = new Map((campaignProfiles.data ?? []).map((profile) => [profile.id, profile.profile_name]));
  const campaignRows = (campaigns.data ?? []) as unknown as Campaign[];
  const workforceCampaigns = campaignRows.map((campaign) => ({
    ...campaign,
    whatsapp_profile_name: campaign.whatsapp_profile_id
      ? profileNameById.get(campaign.whatsapp_profile_id) ?? campaign.whatsapp_profile_name
      : campaign.whatsapp_profile_name,
    whatsapp_campaign_recipients: [...(campaign.whatsapp_campaign_recipients ?? [])].sort((left, right) => left.row_no - right.row_no)
  }));
  const contacts = recipients.map((recipient) => ({
    id: `${recipient.profileType}:${recipient.accountId}`,
    source: "Workforce",
    name: recipient.name,
    mobile: recipient.mobile,
    country_code: recipient.countryCode,
    email: recipient.email,
    dropx_id: recipient.reference,
    location: recipient.location,
    provider: recipient.provider,
    model: recipient.model,
    role: recipient.designation,
    designation: recipient.designation,
    status: recipient.status
  }));
  const senderProfiles = (profiles.data ?? []) as WhatsAppProfile[];

  return (
    <AppShell active="WhatsApp" pageCode="workforce_communications_whatsapp">
      <PageHead
        eyebrow="Workforce communications"
        title="WhatsApp"
        subtitle="Send approved templates only to profiles classified as Workforce. HR users and uploaded recipient files are excluded."
      />
      {error ? (
        <section className="panel message-panel error"><div className="panel-body"><strong>Action required</strong><p className="subtle">{error.message}</p></div></section>
      ) : (
        <BulkWhatsAppPanel
          allowExcelUpload={false}
          canSend={permission.canAdd || permission.canEdit}
          campaignError={campaigns.error?.message ?? null}
          campaigns={workforceCampaigns}
          contacts={contacts}
          defaultCountryCode={senderProfiles.find((profile) => profile.is_default)?.default_country_code || "91"}
          flash={{ error: null, notice: null }}
          profiles={senderProfiles}
          surface="workforce"
          templates={(templates.data ?? []) as WhatsAppTemplate[]}
          whatsAppEnabled={Boolean(settings.data?.is_enabled)}
        />
      )}
    </AppShell>
  );
}
