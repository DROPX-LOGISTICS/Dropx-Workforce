"use server";

import { revalidatePath } from "next/cache";
import { requirePagePermission } from "@/lib/authorization";
import { callMarshWorker, type MarshSessionView } from "@/lib/marsh-worker";

export async function getMarshSessionStatus(): Promise<MarshSessionView> {
  await requirePagePermission("app_settings", "access");
  return callMarshWorker<MarshSessionView>("/api/admin/marsh/session/status");
}

export async function startMarshLogin() {
  await requirePagePermission("app_settings", "edit");
  const result = await callMarshWorker<MarshSessionView>("/api/admin/marsh/session/start", {
    method: "POST",
    body: JSON.stringify({ uploadedBy: "settings-marsh" })
  });
  revalidatePath("/settings/marsh-insurance");
  return result;
}

export async function submitMarshOtp(challengeId: string, otp: string) {
  await requirePagePermission("app_settings", "edit");
  const result = await callMarshWorker<MarshSessionView>("/api/admin/marsh/session/otp", {
    method: "POST",
    body: JSON.stringify({ challengeId, otp })
  });
  revalidatePath("/settings/marsh-insurance");
  return result;
}

export async function ensureMarshSessionAction() {
  await requirePagePermission("app_settings", "edit");
  const result = await callMarshWorker<MarshSessionView & { ok: boolean }>("/api/admin/marsh/session/ensure", {
    method: "POST",
    body: "{}"
  });
  revalidatePath("/settings/marsh-insurance");
  return result;
}

export async function syncMarshEcardsAction() {
  await requirePagePermission("app_settings", "edit");
  return callMarshWorker<{ ok: boolean; uploaded: number; skipped: number; error?: string }>(
    "/api/admin/marsh/ecards/sync",
    { method: "POST", body: "{}" }
  );
}
