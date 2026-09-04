"use server";

import { workforceNotificationId } from "@/lib/workforce-notification-key";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { deliverNotificationPush } from "@/lib/firebase-push";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  loadWorkforceCommunicationRecipients,
  type WorkforceCommunicationRecipient,
  type WorkforceRecipientProfileType
} from "@/lib/workforce-communication-recipients";

const returnPath = "/delivery-network/communications/dropx-one";
const internalRoutes = new Set(["", "dashboard", "profile", "attendance", "leave", "settings"]);
const variablePattern = /\{(full_name|dropx_id|biometric_id|category|location|designation)\}/g;

function fail(message: string): never {
  redirect(`${returnPath}?error=${encodeURIComponent(message)}`);
}

function parseRecipients(value: FormDataEntryValue | null) {
  let keys: unknown;
  try {
    keys = JSON.parse(String(value ?? "[]"));
  } catch {
    fail("The recipient selection is invalid");
  }
  if (!Array.isArray(keys)) fail("Select at least one recipient");
  const unique = Array.from(new Set(keys.map((key) => String(key))));
  if (!unique.length) fail("Select at least one recipient");
  if (unique.length > 500) fail("Select no more than 500 recipients at a time");
  return unique;
}

function recipientKey(profileType: WorkforceRecipientProfileType, accountId: string) {
  return `${profileType}:${accountId}`;
}

function applyVariables(template: string, recipient: WorkforceCommunicationRecipient) {
  const values: Record<string, string> = {
    full_name: recipient.name,
    dropx_id: recipient.reference,
    biometric_id: recipient.biometricId,
    category: recipient.category,
    location: recipient.location,
    designation: recipient.designation
  };
  return template.replace(variablePattern, (_, key: string) => values[key] ?? "");
}

function validatedExternalUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function sendWorkforceAppNotification(formData: FormData) {
  const authorization = await requirePagePermission("workforce_communications_app", "add");
  if (!supabaseAdmin) fail("Supabase is not configured");
  if (!authorization.companyId) fail("Select a company before sending");

  const selectedKeys = parseRecipients(formData.get("selectedRecipients"));
  const available = await loadWorkforceCommunicationRecipients(authorization);
  const availableByKey = new Map(available.map((recipient) => [recipientKey(recipient.profileType, recipient.accountId), recipient]));
  const recipients = selectedKeys.map((key) => availableByKey.get(key));
  if (recipients.some((recipient) => !recipient)) fail("One or more recipients are outside the Workforce designation master");
  const resolved = recipients as WorkforceCommunicationRecipient[];

  const titleTemplate = String(formData.get("title") ?? "").trim();
  const bodyTemplate = String(formData.get("body") ?? "").trim();
  const openTarget = String(formData.get("openTarget") ?? "").trim();
  const customUrlTemplate = String(formData.get("customUrl") ?? "").trim();
  if (!titleTemplate || !bodyTemplate) fail("Title and message are required");
  if (titleTemplate.length > 120 || bodyTemplate.length > 1000) fail("Notification text is too long");
  if (openTarget === "custom_url" && !customUrlTemplate) fail("Enter a custom URL");
  if (openTarget !== "custom_url" && !internalRoutes.has(openTarget)) fail("The selected app page is invalid");

  const batchId = String(formData.get("submissionKey") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId)) fail("Reload the composer before sending.");
  const rows = resolved.map((recipient) => {
    const title = applyVariables(titleTemplate, recipient).trim();
    const body = applyVariables(bodyTemplate, recipient).trim();
    const personalizedUrl = openTarget === "custom_url" ? applyVariables(customUrlTemplate, recipient).trim() : "";
    const route = openTarget === "custom_url" ? validatedExternalUrl(personalizedUrl) : openTarget || null;
    if (!title || !body) fail(`The personalized notification for ${recipient.name} is empty`);
    if (title.length > 120 || body.length > 1000) fail(`The personalized notification for ${recipient.name} is too long`);
    if (openTarget === "custom_url" && !route) fail(`The custom URL for ${recipient.name} is invalid`);
    return {
      id: workforceNotificationId(authorization.companyId!, authorization.userId, batchId, recipientKey(recipient.profileType, recipient.accountId)),
      body,
      company_id: authorization.companyId,
      created_by: authorization.userId,
      data: { batchId, surface: "workforce" },
      event_code: "workforce_manual",
      push_status: "not_configured",
      recipient_account_id: recipient.accountId,
      recipient_profile_type: recipient.profileType,
      route,
      title
    };
  });

  const result = await supabaseAdmin
    .from("mob_app_notifications")
    .upsert(rows, { onConflict: "id", ignoreDuplicates: true })
    .select("id, recipient_profile_type, recipient_account_id, title, body, route, data");
  if (result.error) fail(result.error.message);

  const created = result.data ?? [];
  for (let index = 0; index < created.length; index += 25) {
    const batch = created.slice(index, index + 25);
    await Promise.allSettled(batch.map((notification) => deliverNotificationPush({
      id: notification.id,
      companyId: authorization.companyId!,
      profileType: notification.recipient_profile_type,
      accountId: notification.recipient_account_id,
      title: notification.title,
      body: notification.body,
      route: notification.route,
      data: notification.data ?? {}
    })));
  }

  redirect(`${returnPath}?sent=${created.length}`);
}
