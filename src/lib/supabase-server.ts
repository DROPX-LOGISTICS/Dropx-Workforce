import { cookies, headers } from "next/headers";
import type { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAuthKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const COOKIE_CHUNK_SIZE = 3000;
const MAX_COOKIE_CHUNKS = 8;

function cookieDomain() {
  const host = headers().get("x-forwarded-host")?.split(":")[0].toLowerCase() ??
    headers().get("host")?.split(":")[0].toLowerCase() ??
    "";

  return host.endsWith("dropxlogistics.com") ? ".dropxlogistics.com" : undefined;
}

export function createServerSupabaseClient(response?: NextResponse, _forceOpsStorage = false) {
  if (!supabaseUrl || !supabaseAuthKey) return null;

  const cookieStore = cookies();
  const host = headers().get("x-forwarded-host")?.split(":")[0].toLowerCase() ??
    headers().get("host")?.split(":")[0].toLowerCase() ??
    "";
  const cookieOptions = {
    domain: cookieDomain(),
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  };

  const getStoredValue = (key: string) => {
    const legacyValue = cookieStore.get(key)?.value;
    if (legacyValue) return legacyValue;

    let value = "";
    for (let index = 0; index < MAX_COOKIE_CHUNKS; index += 1) {
      const chunk = cookieStore.get(`${key}.${index}`)?.value;
      if (!chunk) break;
      value += chunk;
    }
    return value || null;
  };

  const clearStoredValue = (key: string) => {
    cookieStore.set(key, "", { ...cookieOptions, maxAge: 0 });
    response?.cookies.set(key, "", { ...cookieOptions, maxAge: 0 });
    for (let index = 0; index < MAX_COOKIE_CHUNKS; index += 1) {
      cookieStore.set(`${key}.${index}`, "", { ...cookieOptions, maxAge: 0 });
      response?.cookies.set(`${key}.${index}`, "", { ...cookieOptions, maxAge: 0 });
    }
  };

  const setStoredValue = (key: string, value: string) => {
    clearStoredValue(key);
    const chunks = value.match(new RegExp(`.{1,${COOKIE_CHUNK_SIZE}}`, "g")) ?? [];
    chunks.forEach((chunk, index) => {
      cookieStore.set(`${key}.${index}`, chunk, cookieOptions);
      response?.cookies.set(`${key}.${index}`, chunk, cookieOptions);
    });
  };

  return createClient(supabaseUrl, supabaseAuthKey, {
    auth: {
      flowType: "pkce",
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: true,
      storage: {
        getItem: getStoredValue,
        setItem: (key, value) => {
          try {
            setStoredValue(key, value);
          } catch {
            // Middleware refreshes the session before server components render.
          }
        },
        removeItem: (key) => {
          try {
            clearStoredValue(key);
          } catch {
            // Middleware refreshes the session before server components render.
          }
        }
      }
    }
  });
}
