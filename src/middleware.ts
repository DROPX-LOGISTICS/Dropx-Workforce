import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAuthKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const COOKIE_CHUNK_SIZE = 3000;
const MAX_COOKIE_CHUNKS = 8;

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname || "/";
  const host = request.headers.get("host")?.split(":")[0].toLowerCase() ?? "";
  const isPlatformAdminHost = host === "admin-panel.dropxlogistics.com";
  const isOpsHost = host === "ops.dropxlogistics.com";
  const isDashboardHost = host === "dashboard.dropxlogistics.com";

  const opsAppUrl = process.env.OPS_APP_URL?.trim();
  if (isDashboardHost && opsAppUrl && (path === "/ops-pulse" || path.startsWith("/ops-pulse/"))) {
    return NextResponse.redirect(new URL(path + request.nextUrl.search, opsAppUrl));
  }

  if (isOpsHost && path === "/") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/ops-pulse";
    return NextResponse.redirect(redirectUrl);
  }

  if (
    isOpsHost &&
    path !== "/login" &&
    !path.startsWith("/ops-pulse") &&
    path !== "/master/cod-master" &&
    !path.startsWith("/api/") &&
    !path.startsWith("/auth/") &&
    !path.startsWith("/_next/") &&
    !path.includes(".")
  ) {
    return NextResponse.redirect(new URL("/", "https://dashboard.dropxlogistics.com"));
  }

  if (request.nextUrl.pathname === "/partner" || request.nextUrl.pathname.startsWith("/partner/")) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = request.nextUrl.pathname.replace(/^\/partner/, "") || "/";
    return NextResponse.redirect(redirectUrl);
  }

  if (!isPlatformAdminHost && path === "/platform-admin") {
    return NextResponse.redirect(new URL("https://admin-panel.dropxlogistics.com/", request.url));
  }

  if (path === "/login" || path.startsWith("/api/") || path.startsWith("/auth/") || path.startsWith("/_next/") || path.includes(".")) {
    return NextResponse.next();
  }

  if (!supabaseUrl || !supabaseAuthKey) {
    return NextResponse.redirect(new URL("/login?error=Authentication%20is%20not%20configured", request.url));
  }

  const response = NextResponse.next();
  const cookieDomain = host.endsWith("dropxlogistics.com") ? ".dropxlogistics.com" : undefined;
  const cookieOptions = {
    domain: cookieDomain,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  };
  const expireCookie = (name: string) => {
    request.cookies.set(name, "");
    response.cookies.set(name, "", { ...cookieOptions, maxAge: 0 });
  };
  const clearStoredValue = (key: string) => {
    expireCookie(key);
    for (let index = 0; index < MAX_COOKIE_CHUNKS; index += 1) expireCookie(`${key}.${index}`);
  };
  const getStoredValue = (key: string) => {
    const legacyValue = request.cookies.get(key)?.value;
    if (legacyValue) return legacyValue;

    let value = "";
    for (let index = 0; index < MAX_COOKIE_CHUNKS; index += 1) {
      const chunk = request.cookies.get(`${key}.${index}`)?.value;
      if (!chunk) break;
      value += chunk;
    }
    return value || null;
  };
  const setStoredValue = (key: string, value: string) => {
    clearStoredValue(key);
    const chunks = value.match(new RegExp(`.{1,${COOKIE_CHUNK_SIZE}}`, "g")) ?? [];
    chunks.forEach((chunk, index) => {
      const name = `${key}.${index}`;
      request.cookies.set(name, chunk);
      response.cookies.set(name, chunk, cookieOptions);
    });
  };
  const supabase = createClient(supabaseUrl, supabaseAuthKey, {
    auth: {
      flowType: "pkce",
      ...(isOpsHost ? { storageKey: "dropx-ops-auth-v3" } : {}),
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: true,
      storage: {
        getItem: getStoredValue,
        setItem: setStoredValue,
        removeItem: clearStoredValue
      }
    }
  });

  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isPlatformAdminHost && path === "/") {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = "/platform-admin";
    return NextResponse.rewrite(rewriteUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|favicon.png|dropx-logo.jpg|dropx-logo.png).*)"]
};
