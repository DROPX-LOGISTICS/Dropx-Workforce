import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { BulkWhatsAppPanel } from "@/components/bulk-whatsapp-panel";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { WhatsAppTemplateComponent } from "@/lib/whatsapp-template";

export const dynamic = "force-dynamic";

type LocationRow = {
  id: string;
  station_code: string;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  mobile: string | null;
  role: string | null;
  location_scope_ids: string[] | null;
  is_active: boolean;
};

type FieldExecutiveRow = {
  id: string;
  full_name: string;
  email: string | null;
  mobile: string;
  designation?: string | null;
  is_active: boolean;
  stations?: { station_code?: string | null } | { station_code?: string | null }[] | null;
};

type CampaignRecipientRow = {
  id: string;
  row_no: number;
  recipient_name: string | null;
  recipient_mobile: string;
  country_code: string | null;
  status: string;
  provider_message_id: string | null;
  error_message: string | null;
  sent_at: string | null;
  updated_at: string | null;
};

type CampaignRow = {
  id: string;
  campaign_code: string;
  whatsapp_profile_id: string | null;
  whatsapp_profile_name: string | null;
  created_at: string;
  total_count: number;
  sent_count: number;
  failed_count: number;
  pending_count: number;
  status: string;
  whatsapp_campaign_recipients?: CampaignRecipientRow[];
};

type WhatsAppProfileRow = {
  id: string;
  profile_name: string;
  phone_number_id: string;
  default_country_code: string;
  is_default: boolean;
  is_active: boolean;
};

function loadFlash() {
  const raw = cookies().get("dropx_bulk_whatsapp_flash")?.value;
  if (!raw) return { error: null as string | null, notice: null as string | null };
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; notice?: unknown };
    return {
      error: typeof parsed.error === "string" ? parsed.error : null,
      notice: typeof parsed.notice === "string" ? parsed.notice : null
    };
  } catch {
    return { error: null, notice: null };
  }
}

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function normalizeMobile(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

async function loadBulkWhatsAppData(companyId: string) {
  const defaults = {
    contacts: [],
    error: null as string | null,
    campaignError: null as string | null,
    templates: [] as Array<{ template_id: string; whatsapp_profile_id: string | null; name: string; language: string; category: string | null; status: string; components: WhatsAppTemplateComponent[] }>,
    campaigns: [] as CampaignRow[],
    profiles: [] as WhatsAppProfileRow[],
    defaultCountryCode: "91",
    whatsAppEnabled: false
  };
  if (!supabaseAdmin) return { ...defaults, error: "Supabase service role key is not configured." };

  const [settings, templates, profiles, senderProfiles, campaignProfiles, fieldExecutives, locations, campaigns] = await Promise.all([
    supabaseAdmin.from("whatsapp_settings").select("is_enabled").eq("company_id", companyId).eq("id", true).maybeSingle(),
    supabaseAdmin.from("whatsapp_template_cache").select("template_id, whatsapp_profile_id, name, language, category, status, components").eq("company_id", companyId).order("name"),
    supabaseAdmin.from("profiles").select("id, full_name, email, mobile, role, location_scope_ids, is_active").eq("company_id", companyId).order("full_name"),
    supabaseAdmin.from("whatsapp_profiles").select("id, profile_name, phone_number_id, default_country_code, is_default, is_active").eq("company_id", companyId).eq("is_active", true).order("profile_name"),
    supabaseAdmin.from("whatsapp_profiles").select("id, profile_name").eq("company_id", companyId),
    supabaseAdmin.from("field_executives").select("id, full_name, email, mobile, designation, is_active, stations (station_code)").eq("company_id", companyId).order("full_name"),
    supabaseAdmin.from("stations").select("id, station_code").eq("company_id", companyId),
    supabaseAdmin
      .from("whatsapp_campaigns")
      .select("id, campaign_code, whatsapp_profile_id, whatsapp_profile_name, created_at, total_count, sent_count, failed_count, pending_count, status, whatsapp_campaign_recipients (id, row_no, recipient_name, recipient_mobile, country_code, status, provider_message_id, error_message, sent_at, updated_at)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(25)
  ]);

  const campaignSetupMissing = campaigns.error?.message?.includes("whatsapp_campaigns") || campaigns.error?.message?.includes("whatsapp_campaign_recipients");
  const error = settings.error?.message || templates.error?.message || profiles.error?.message || senderProfiles.error?.message || campaignProfiles.error?.message || fieldExecutives.error?.message || locations.error?.message || null;
  const locationCodeById = new Map(((locations.data ?? []) as LocationRow[]).map((location) => [location.id, location.station_code]));
  const profileNameById = new Map(((campaignProfiles.data ?? []) as Array<{ id: string; profile_name: string }>).map((profile) => [profile.id, profile.profile_name]));
  const userContacts = ((profiles.data ?? []) as ProfileRow[])
    .filter((profile) => normalizeMobile(profile.mobile))
    .map((profile) => ({
      id: `profile:${profile.id}`,
      source: "User" as const,
      name: profile.full_name || profile.email || "User",
      mobile: normalizeMobile(profile.mobile),
      email: profile.email ?? "",
      location: (profile.location_scope_ids ?? []).map((id) => locationCodeById.get(id)).filter(Boolean).slice(0, 3).join(", "),
      role: profile.role ?? "User",
      designation: profile.role ?? "User",
      status: profile.is_active ? "Active" : "Inactive"
    }));
  const executiveContacts = ((fieldExecutives.data ?? []) as FieldExecutiveRow[])
    .filter((executive) => normalizeMobile(executive.mobile))
    .map((executive) => {
      const station = firstRelation(executive.stations);
      return {
        id: `field_executive:${executive.id}`,
        source: "Field Executive" as const,
        name: executive.full_name,
        mobile: normalizeMobile(executive.mobile),
        email: executive.email ?? "",
        location: station?.station_code ?? "",
        role: executive.designation || "Field Executive",
        designation: executive.designation || "Field Executive",
        status: executive.is_active ? "Active" : "Inactive"
      };
    });

  return {
    contacts: [...userContacts, ...executiveContacts].sort((left, right) => left.name.localeCompare(right.name)),
    error,
    campaignError: campaignSetupMissing ? `${campaigns.error?.message} Run scripts/whatsapp_campaigns_v1.sql in Supabase SQL Editor.` : campaigns.error?.message ?? null,
    campaigns: ((campaigns.data ?? []) as CampaignRow[]).map((campaign) => ({
      ...campaign,
      whatsapp_profile_name: campaign.whatsapp_profile_id ? profileNameById.get(campaign.whatsapp_profile_id) ?? campaign.whatsapp_profile_name : campaign.whatsapp_profile_name,
      whatsapp_campaign_recipients: [...(campaign.whatsapp_campaign_recipients ?? [])].sort((left, right) => left.row_no - right.row_no)
    })),
    templates: (templates.data ?? []) as typeof defaults.templates,
    profiles: (senderProfiles.data ?? []) as WhatsAppProfileRow[],
    defaultCountryCode: ((senderProfiles.data ?? []) as WhatsAppProfileRow[]).find((profile) => profile.is_default)?.default_country_code || "91",
    whatsAppEnabled: Boolean(settings.data?.is_enabled)
  };
}

export default async function BulkWhatsAppPage() {
  const authorization = await requirePagePermission("notifications_whatsapp", "access");
  const companyId = requireCompanyId(authorization);
  const permission = authorization.permissions.notifications_whatsapp;
  const data = await loadBulkWhatsAppData(companyId);
  const flash = loadFlash();

  return (
    <AppShell active="WhatsApp" pageCode="notifications_whatsapp">
      <PageHead
        eyebrow="Notifications"
        title="WhatsApp"
        subtitle="Send WhatsApp template messages in bulk from existing dashboard data or uploaded Excel rows."
      />
      {data.error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Action required</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{data.error}</p>
          </div>
        </section>
      ) : (
        <BulkWhatsAppPanel
          canSend={permission.canAdd || permission.canEdit}
          campaignError={data.campaignError}
          campaigns={data.campaigns}
          contacts={data.contacts}
          defaultCountryCode={data.defaultCountryCode}
          flash={flash}
          profiles={data.profiles}
          templates={data.templates}
          whatsAppEnabled={data.whatsAppEnabled}
        />
      )}
    </AppShell>
  );
}
