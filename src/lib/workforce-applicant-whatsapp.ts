import { supabaseAdmin } from "@/lib/supabase-admin";

export const WORKFORCE_APPLICANT_EVENT = "workforce_application_received";
export const WORKFORCE_APPLICANT_TEMPLATE = "job_application_number";

type ApplicantLead = {
  id: string;
  company_id: string;
  full_name: string | null;
  phone: string | null;
  station_code: string | null;
  job_code: string | null;
  wa_new_sent_at?: string | null;
};

function text(value: unknown, fallback = "-") {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 900) || fallback;
}

function recipient(value: string, countryCode: string) {
  const digits = value.replace(/\D/g, "");
  const prefix = countryCode.replace(/\D/g, "") || "91";
  return digits.startsWith(prefix) && digits.length > 10 ? digits : `${prefix}${digits}`;
}

async function log(payload: Record<string, unknown>) {
  if (!supabaseAdmin) return;
  await supabaseAdmin.from("whatsapp_message_logs").insert(payload);
}

export async function sendWorkforceApplicantWhatsApp(lead: ApplicantLead) {
  if (!supabaseAdmin || !lead.phone) return;
  const claimedAt = new Date().toISOString();
  const claim = await supabaseAdmin
    .from("leads")
    .update({ wa_new_sent_at: claimedAt })
    .eq("company_id", lead.company_id)
    .eq("id", lead.id)
    .is("wa_new_sent_at", null)
    .select("id")
    .maybeSingle();
  if (claim.error || !claim.data) return;

  let destination = lead.phone;
  try {
    const [settings, config, contactResult, stationResult, roleResult] = await Promise.all([
      supabaseAdmin.from("whatsapp_settings").select("is_enabled").eq("company_id", lead.company_id).eq("id", true).maybeSingle(),
      supabaseAdmin.from("whatsapp_notification_configs")
        .select("is_enabled,whatsapp_profile_id,template_id,template_name,template_language")
        .eq("company_id", lead.company_id)
        .eq("event_code", WORKFORCE_APPLICANT_EVENT)
        .maybeSingle(),
      lead.station_code
        ? supabaseAdmin.from("recruitment_station_contacts")
          .select("station_name,address,latlong,poc_name,poc_mobile")
          .eq("company_id", lead.company_id)
          .eq("station_code", lead.station_code)
          .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      lead.station_code
        ? supabaseAdmin.from("stations")
          .select("station_name,address,address_line1,address_line2,city,state,latitude,longitude,station_manager_email")
          .eq("company_id", lead.company_id)
          .eq("station_code", lead.station_code)
          .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      lead.job_code
        ? supabaseAdmin.from("lead_job_roles").select("name").eq("company_id", lead.company_id).eq("code", lead.job_code).maybeSingle()
        : Promise.resolve({ data: null, error: null })
    ]);
    if (settings.error) throw new Error(settings.error.message);
    if (config.error) throw new Error(config.error.message);
    if (!settings.data?.is_enabled || !config.data?.is_enabled) {
      await supabaseAdmin.from("leads").update({ wa_new_sent_at: null }).eq("company_id", lead.company_id).eq("id", lead.id);
      await log({ company_id: lead.company_id, event_code: WORKFORCE_APPLICANT_EVENT, recipient: lead.phone, status: "skipped", error_message: "Workforce applicant auto-message is disabled." });
      return;
    }
    if (!config.data.whatsapp_profile_id || !config.data.template_id || !config.data.template_name || !config.data.template_language) {
      throw new Error("Workforce applicant WhatsApp master is incomplete.");
    }

    const [profileResult, tokenResult, templateResult] = await Promise.all([
      supabaseAdmin.from("whatsapp_profiles")
        .select("id,profile_name,phone_number_id,graph_api_version,default_country_code,is_active")
        .eq("company_id", lead.company_id)
        .eq("id", config.data.whatsapp_profile_id)
        .single(),
      supabaseAdmin.rpc("get_whatsapp_profile_access_token", { profile_id: config.data.whatsapp_profile_id }),
      supabaseAdmin.from("whatsapp_template_cache")
        .select("status")
        .eq("company_id", lead.company_id)
        .eq("whatsapp_profile_id", config.data.whatsapp_profile_id)
        .eq("template_id", config.data.template_id)
        .single()
    ]);
    if (profileResult.error) throw new Error(profileResult.error.message);
    if (tokenResult.error) throw new Error(tokenResult.error.message);
    if (templateResult.error) throw new Error(templateResult.error.message);
    if (!profileResult.data.is_active || !tokenResult.data || templateResult.data.status !== "APPROVED") {
      throw new Error("The selected WhatsApp profile or template is not active and approved.");
    }

    const contact = contactResult.data;
    const station = stationResult.data;
    let pocMobile = text(contact?.poc_mobile, "");
    if (!pocMobile && station?.station_manager_email) {
      const manager = await supabaseAdmin.from("profiles")
        .select("mobile,full_name")
        .eq("company_id", lead.company_id)
        .eq("email", station.station_manager_email)
        .maybeSingle();
      if (!manager.error) pocMobile = text(manager.data?.mobile, "");
    }
    const address = text(
      contact?.address ||
      station?.address ||
      [station?.address_line1, station?.address_line2, station?.city, station?.state].filter(Boolean).join(", ") ||
      station?.station_name ||
      contact?.station_name ||
      lead.station_code
    );
    const role = text(roleResult.data?.name || lead.job_code || "the applied role");
    const parameters = [text(lead.full_name, "Candidate"), role, pocMobile || "DropX recruitment team", address];
    destination = recipient(lead.phone, profileResult.data.default_country_code);
    const requestPayload = {
      messaging_product: "whatsapp",
      to: destination,
      type: "template",
      template: {
        name: config.data.template_name,
        language: { code: config.data.template_language },
        components: [{ type: "body", parameters: parameters.map((value) => ({ type: "text", text: value })) }]
      }
    };
    const response = await fetch(`https://graph.facebook.com/${profileResult.data.graph_api_version}/${profileResult.data.phone_number_id}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenResult.data}`, "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload)
    });
    const responsePayload = await response.json() as { messages?: Array<{ id?: string }>; error?: { message?: string } };
    if (!response.ok) throw new Error(responsePayload.error?.message || "Meta rejected the workforce applicant message.");
    await log({
      company_id: lead.company_id,
      event_code: WORKFORCE_APPLICANT_EVENT,
      recipient: destination,
      template_name: config.data.template_name,
      status: "sent",
      provider_message_id: responsePayload.messages?.[0]?.id ?? null,
      request_payload: { lead_id: lead.id, station_code: lead.station_code, job_code: lead.job_code, parameters },
      response_payload: responsePayload
    });
  } catch (error) {
    await supabaseAdmin.from("leads").update({ wa_new_sent_at: null }).eq("company_id", lead.company_id).eq("id", lead.id);
    await log({
      company_id: lead.company_id,
      event_code: WORKFORCE_APPLICANT_EVENT,
      recipient: destination,
      template_name: WORKFORCE_APPLICANT_TEMPLATE,
      status: "failed",
      error_message: error instanceof Error ? error.message : "Unable to send workforce applicant WhatsApp."
    });
  }
}
