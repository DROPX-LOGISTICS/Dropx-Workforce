"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";

function authOriginFromHeaders(requestHeaders: Headers) {
  const allowedOrigins = new Set([
    "https://dashboard.dropxlogistics.com",
    "https://admin-panel.dropxlogistics.com"
  ]);
  const originHeader = requestHeaders.get("origin");
  if (originHeader && allowedOrigins.has(originHeader)) return originHeader;

  const refererHeader = requestHeaders.get("referer");
  if (refererHeader) {
    try {
      const refererUrl = new URL(refererHeader);
      const refererOrigin = refererUrl.origin;
      if (allowedOrigins.has(refererOrigin)) return refererOrigin;
    } catch {
      // Ignore malformed referer values and fall back to forwarded headers.
    }
  }

  const forwardedHost = requestHeaders.get("x-forwarded-host");
  if (forwardedHost) {
    const forwardedProto = requestHeaders.get("x-forwarded-proto") ?? "https";
    return `${forwardedProto}://${forwardedHost}`;
  }

  return "http://localhost:3000";
}

function safeNextPath(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text || !text.startsWith("/") || text.startsWith("//")) return "";

  try {
    const parsed = new URL(text, "https://dashboard.dropxlogistics.com");
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "";
  }
}

export async function signInWithGoogle(formData: FormData) {
  const supabase = createServerSupabaseClient();
  if (!supabase) redirect("/login?error=Authentication%20is%20not%20configured");

  const requestHeaders = headers();
  const origin = authOriginFromHeaders(requestHeaders);
  const nextPath = safeNextPath(formData.get("next"));
  const callbackUrl = new URL("/auth/callback", origin);
  if (nextPath) callbackUrl.searchParams.set("next", nextPath);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl.toString(),
      queryParams: {
        prompt: "select_account"
      }
    }
  });

  if (error || !data.url) {
    redirect(`/login?error=${encodeURIComponent(error?.message ?? "Unable to start Google login")}`);
  }

  redirect(data.url);
}

export async function signOut() {
  const supabase = createServerSupabaseClient();
  if (supabase) await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
