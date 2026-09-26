"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { normalizeSourcePortal } from "@/lib/amazon-activation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { callWorkforceAmazonWorker, invitationNameParts } from "@/lib/workforce-amazon-worker";

function destination(form: FormData, params: Record<string, string>) {
  const query = new URLSearchParams(params);
  const view = String(form.get("view") ?? "not_onboarded");
  if (["not_onboarded", "onboarded", "in_progress", "idfy", "all"].includes(view)) {
    query.set("view", view);
  }
  return `/delivery-network/amazon-lifecycle?${query}`;
}

export async function refreshAmazonLifecycle(form: FormData) {
  const auth = await requirePagePermission("executive_id_onboarding", "access");
  try {
    if (!supabaseAdmin) throw new Error("Database unavailable.");
    await callWorkforceAmazonWorker("/api/admin/workforce/session/ensure", {
      method: "POST",
      body: JSON.stringify({}),
    });
    await callWorkforceAmazonWorker("/api/admin/amazon/service-areas/sync", { method: "POST", body: "{}" });
    revalidatePath("/delivery-network/amazon-lifecycle");
    redirect(destination(form, { notice: "Amazon portal sync refreshed." }));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(
      destination(form, {
        error: error instanceof Error ? error.message : "Unable to refresh Amazon lifecycle.",
      }),
    );
  }
}

export async function syncIdfyBackground(form: FormData) {
  await requirePagePermission("executive_id_onboarding", "edit");
  try {
    const result = await callWorkforceAmazonWorker<{ insufficiencies?: number }>("/api/admin/idfy/sync", {
      method: "POST",
      body: "{}",
    });
    revalidatePath("/delivery-network/amazon-lifecycle");
    redirect(
      destination(form, {
        notice: `IDfy synced. ${result.insufficiencies ?? 0} insufficiency highlight(s).`,
        view: "idfy",
      }),
    );
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(destination(form, { error: error instanceof Error ? error.message : "IDfy sync failed.", view: "idfy" }));
  }
}

export async function onboardAndInviteAmazon(form: FormData) {
  const auth = await requirePagePermission("executive_id_onboarding", "edit");
  try {
    if (auth.readOnly || !supabaseAdmin) throw new Error("Invitation is unavailable.");
    const workforceId = String(form.get("workforce_id") ?? "");
    const email = String(form.get("amazon_email") ?? "").trim().toLowerCase();
    const stationId = String(form.get("station_id") ?? "");
    const fullName = String(form.get("full_name") ?? "");
    const { firstName, lastName } = invitationNameParts(fullName);

    // Queue for audit trail when station master is ready; always also call worker immediately.
    try {
      await supabaseAdmin.rpc("workforce_queue_amazon_invitation", {
        p_company: requireCompanyId(auth),
        p_actor: auth.userId,
        p_actor_name: auth.fullName || auth.email || "Workforce",
        p_workforce: workforceId,
        p_email: email,
        p_source_portal: normalizeSourcePortal(form.get("source_portal") || "workforce"),
        p_locations: auth.hasAllLocationAccess ? null : auth.locationScopeIds,
      });
    } catch {
      // Station master may not be fully enabled — still allow direct worker invite.
    }

    const result = await callWorkforceAmazonWorker<{ providerId: string; stationMapped: boolean }>(
      "/api/admin/amazon/invite",
      {
        method: "POST",
        body: JSON.stringify({
          workforceId,
          email,
          firstName,
          lastName,
          stationId: stationId || undefined,
          mapStation: true,
        }),
      },
    );

    revalidatePath("/delivery-network/amazon-lifecycle");
    revalidatePath("/delivery-network/id-onboarding");
    redirect(
      destination(form, {
        notice: `Amazon invite sent (${result.providerId})${result.stationMapped ? " and station mapped." : ". Map station if master is incomplete."}`,
      }),
    );
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(
      destination(form, {
        error: error instanceof Error ? error.message : "Unable to onboard on Amazon.",
      }),
    );
  }
}

export async function mapAmazonStation(form: FormData) {
  const auth = await requirePagePermission("executive_id_onboarding", "edit");
  try {
    if (auth.readOnly) throw new Error("Preview mode is read-only.");
    const providerId = String(form.get("provider_id") ?? "").trim();
    const workforceId = String(form.get("workforce_id") ?? "").trim();
    const stationId = String(form.get("station_id") ?? "").trim();
    if (!providerId) throw new Error("Amazon provider id is missing.");
    await callWorkforceAmazonWorker("/api/admin/amazon/map-station", {
      method: "POST",
      body: JSON.stringify({ providerId, workforceId, stationId }),
    });
    revalidatePath("/delivery-network/amazon-lifecycle");
    redirect(destination(form, { notice: "Amazon station settings updated.", view: "in_progress" }));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(
      destination(form, {
        error: error instanceof Error ? error.message : "Unable to map Amazon station.",
      }),
    );
  }
}

export async function tickAmazonInvitationQueue(form: FormData) {
  await requirePagePermission("executive_id_onboarding", "edit");
  try {
    const result = await callWorkforceAmazonWorker<{ processed: number }>("/api/admin/amazon/invitation/tick", {
      method: "POST",
      body: "{}",
    });
    revalidatePath("/delivery-network/amazon-lifecycle");
    redirect(destination(form, { notice: `Processed ${result.processed} queued invitation(s).` }));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(
      destination(form, {
        error: error instanceof Error ? error.message : "Invitation tick failed.",
      }),
    );
  }
}
