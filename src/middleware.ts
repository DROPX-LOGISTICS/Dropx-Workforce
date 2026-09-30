import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { withAuthDeadline, isTemporaryAuthError, MiddlewareAuthTimeout } from "./lib/middleware-auth-deadline";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAuthKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const COOKIE_CHUNK_SIZE = 3000;
const MAX_COOKIE_CHUNKS = 8;
const ENCODED_COOKIE_PREFIX = "b64-";
const CLEAN_OPS_ROOTS = ["/daily-submission", "/performance", "/capacity", "/service-network", "/field-executive", "/cod", "/reports", "/client", "/access", "/unauthorized"];
const MOVED_OPS_PAYMENT_PATHS = [
  "/payments/expense-request",
  "/payments/requests",
  "/payments/approvals",
  "/payments/report"
];
const WORKFORCE_ROOTS = [
  "/delivery-network",
  "/users",
  "/unauthorized"
];
const MOVED_FINANCE_PATHS = ["/master/payment-banks", "/master/payment-heads"];
const WORKFORCE_EXACT_PATHS = new Set(["/", "/settings/amazon-onboarding", "/master/payment-methods"]);

function cleanOpsPath(path: string) {
  if (path === "/ops-pulse") return "/";
  return path.startsWith("/ops-pulse/") ? path.slice("/ops-pulse".length) : path;
}

function isCleanOpsPath(path: string) {
  return path === "/" || CLEAN_OPS_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}

function isMovedOpsPaymentPath(path: string) {
  return MOVED_OPS_PAYMENT_PATHS.some((root) => path === root || path.startsWith(`${root}/`));
}

function isWorkforcePath(path: string) {
  return WORKFORCE_EXACT_PATHS.has(path) || WORKFORCE_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}

function isAssetPath(path: string) {
  return /\.[a-z0-9]{2,8}$/i.test(path);
}

function isPublicOpsInstallAsset(path: string) {
  return path === "/manifest.webmanifest" ||
    path === "/sw.js" ||
    path.startsWith("/opspulse/") ||
    path.startsWith("/downloads/") ||
    path.startsWith("/.well-known/");
}

function encodeCookieValue(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return ENCODED_COOKIE_PREFIX + btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeCookieValue(value: string) {
  if (!value.startsWith(ENCODED_COOKIE_PREFIX)) return value;
  const encoded = value.slice(ENCODED_COOKIE_PREFIX.length)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname || "/";
  const previewUserId = request.cookies.get("dropx_portal_preview_v1")?.value;
  const connectPreview = request.cookies.get("dropx_connect_preview_account")?.value;
  if ((previewUserId || connectPreview) && !["GET", "HEAD", "OPTIONS"].includes(request.method) && path !== "/api/owner-preview") {
    return NextResponse.json({ error: "User preview is read-only. Exit preview to make changes." }, { status: 403 });
  }
  const host = request.headers.get("host")?.split(":")[0].toLowerCase() ?? "";
  const isPlatformAdminHost = host === "admin-panel.dropxlogistics.com";
  const isOpsHost = host === "ops.dropxlogistics.com";
  const isWorkforceHost = host === "workforce.dropxlogistics.com" ||
    host.startsWith("workforce-") ||
    (host.endsWith(".vercel.app") && host.includes("workforce"));
  const isDashboardHost = host === "dashboard.dropxlogistics.com";
  const isSharedOpsPath = path === "/fleet" || path.startsWith("/fleet/") ||
    path === "/business-documents" || path.startsWith("/business-documents/");

  if (isWorkforceHost && MOVED_FINANCE_PATHS.some((root) => path === root || path.startsWith(`${root}/`))) {
    const financeBase = process.env.FINANCE_APP_URL?.trim() || "https://fin.dropxlogistics.com";
    return NextResponse.redirect(new URL(path + request.nextUrl.search, financeBase));
  }

  const opsAppUrl = process.env.OPS_APP_URL?.trim();
  if (isDashboardHost && opsAppUrl && (path === "/ops-pulse" || path.startsWith("/ops-pulse/"))) {
    return NextResponse.redirect(new URL(cleanOpsPath(path) + request.nextUrl.search, opsAppUrl));
  }

  if (isOpsHost && (path === "/ops-pulse" || path.startsWith("/ops-pulse/"))) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = cleanOpsPath(path);
    return NextResponse.redirect(redirectUrl);
  }

  if (isOpsHost && path.startsWith("/payments/") && !isMovedOpsPaymentPath(path)) {
    return NextResponse.redirect(new URL(path + request.nextUrl.search, "https://dashboard.dropxlogistics.com"));
  }

  if (
    isOpsHost &&
    path !== "/login" &&
    !isCleanOpsPath(path) &&
    !isMovedOpsPaymentPath(path) &&
    !isSharedOpsPath &&
    !path.startsWith("/cps") &&
    !path.startsWith("/master/") &&
    !path.startsWith("/users") &&
    !path.startsWith("/api/") &&
    !path.startsWith("/auth/") &&
    !path.startsWith("/_next/") &&
    !isPublicOpsInstallAsset(path) &&
    !isAssetPath(path)
  ) {
    const deniedUrl = request.nextUrl.clone();
    deniedUrl.pathname = "/unauthorized";
    deniedUrl.search = "";
    deniedUrl.searchParams.set("reason", "surface");
    deniedUrl.searchParams.set("requested", path);
    return NextResponse.redirect(deniedUrl);
  }

  if (
    isWorkforceHost &&
    path !== "/login" &&
    !isWorkforcePath(path) &&
    !path.startsWith("/api/") &&
    !path.startsWith("/auth/") &&
    !path.startsWith("/_next/") &&
    !isPublicOpsInstallAsset(path) &&
    !isAssetPath(path)
  ) {
    const deniedUrl = request.nextUrl.clone();
    deniedUrl.pathname = "/unauthorized";
    deniedUrl.search = "";
    deniedUrl.searchParams.set("reason", "surface");
    deniedUrl.searchParams.set("requested", path);
    return NextResponse.redirect(deniedUrl);
  }

  if (request.nextUrl.pathname === "/partner" || request.nextUrl.pathname.startsWith("/partner/")) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = request.nextUrl.pathname.replace(/^\/partner/, "") || "/";
    return NextResponse.redirect(redirectUrl);
  }

  if (!isPlatformAdminHost && path === "/platform-admin") {
    return NextResponse.redirect(new URL("https://admin-panel.dropxlogistics.com/", request.url));
  }

  if (path === "/login" || path.startsWith("/api/") || path.startsWith("/auth/") || path.startsWith("/_next/") || isPublicOpsInstallAsset(path) || isAssetPath(path)) {
    return NextResponse.next();
  }

  if (!supabaseUrl || !supabaseAuthKey) {
    return NextResponse.redirect(new URL("/login?error=Authentication%20is%20not%20configured", request.url));
  }

  const response = NextResponse.next();
  const cookieDomain = host.endsWith("dropxlogistics.com") ? ".dropxlogistics.com" : undefined;
  const cookieOptions = {
    ...(isOpsHost ? {} : { domain: cookieDomain }),
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
    if (legacyValue) {
      try { return decodeCookieValue(legacyValue); }
      catch { clearStoredValue(key); return null; }
    }

    let value = "";
    for (let index = 0; index < MAX_COOKIE_CHUNKS; index += 1) {
      const chunk = request.cookies.get(`${key}.${index}`)?.value;
      if (!chunk) break;
      value += chunk;
    }
    try { return value ? decodeCookieValue(value) : null; }
    catch { clearStoredValue(key); return null; }
  };
  const setStoredValue = (key: string, value: string) => {
    clearStoredValue(key);
    const encodedValue = encodeCookieValue(value);
    const chunks = encodedValue.match(new RegExp(`.{1,${COOKIE_CHUNK_SIZE}}`, "g")) ?? [];
    chunks.forEach((chunk, index) => {
      const name = `${key}.${index}`;
      request.cookies.set(name, chunk);
      response.cookies.set(name, chunk, cookieOptions);
    });
  };
  const copyAuthCookies = (target: NextResponse) => {
    response.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
    target.headers.set("Cache-Control", "private, no-store");
    return target;
  };
  const unavailable = () => {
    const portalName = isWorkforceHost ? "Workforce" : isOpsHost ? "OpsPulse" : isPlatformAdminHost ? "Control Center" : "DropX";
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="5">
  <title>${portalName} · Reconnecting</title>
  <style>
    :root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f7fb;color:#172033}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 70% 15%,#fff0e8 0,transparent 32%),#f5f7fb}
    main{width:min(440px,100%);background:#fff;border:1px solid #e5e9f1;border-radius:18px;padding:28px;box-shadow:0 18px 50px rgba(23,32,51,.09)}
    .brand{display:flex;align-items:center;gap:10px;margin-bottom:28px;font-size:14px;font-weight:750}.mark{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:#f05a2a;color:#fff}
    .status{display:inline-flex;align-items:center;gap:8px;color:#a94220;background:#fff3ed;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:700}.dot{width:7px;height:7px;border-radius:50%;background:#f05a2a;box-shadow:0 0 0 5px #ffe0d3}
    h1{font-size:24px;line-height:1.2;letter-spacing:-.03em;margin:18px 0 10px}p{font-size:14px;line-height:1.6;color:#657087;margin:0}.safe{margin-top:16px;padding:12px 14px;border-radius:12px;background:#f7f9fc;color:#465169;font-size:13px}
    a{display:flex;justify-content:center;margin-top:22px;padding:11px 16px;border-radius:10px;background:#172033;color:#fff;text-decoration:none;font-size:14px;font-weight:700}small{display:block;text-align:center;margin-top:12px;color:#8a94a7;font-size:11px}
  </style>
</head>
<body><main>
  <div class="brand"><span class="mark">DX</span><span>DropX ${portalName}</span></div>
  <span class="status"><span class="dot"></span>Reconnecting securely</span>
  <h1>We’re restoring your connection</h1>
  <p>Session verification is taking longer than expected. This page will retry automatically.</p>
  <div class="safe">Your session and current work are safe. You will stay inside ${portalName}.</div>
  <a href="">Retry now</a><small>Automatic retry in 5 seconds</small>
</main></body></html>`;
    return copyAuthCookies(new NextResponse(html, {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Retry-After": "5",
        "X-DropX-Auth-State": "temporarily-unavailable",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
      }
    }));
  };
  const authStarted = Date.now();
  let authResult;
  try {
    authResult = await withAuthDeadline(async (signal) => {
      const supabase = createClient(supabaseUrl, supabaseAuthKey, {
        global: { fetch: (input, init) => fetch(input, { ...init, signal }) },
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
      // getClaims verifies the signed access token against Supabase's cached
      // public JWKS. Unlike getUser, it does not put the Auth user endpoint in
      // the hot path for every protected page request when asymmetric signing
      // keys are enabled.
      return await supabase.auth.getClaims();
    });
  } catch (error) {
    console.error("[middleware-auth] verification unavailable", {
      reason: error instanceof MiddlewareAuthTimeout ? "deadline" : "unexpected_error",
      elapsedMs: Date.now() - authStarted
    });
    return unavailable();
  }
  const { data, error } = authResult;
  if (isTemporaryAuthError(error)) {
    console.error("[middleware-auth] verification unavailable", { reason: "upstream", status: error?.status, elapsedMs: Date.now() - authStarted });
    return unavailable();
  }
  if (!data?.claims?.sub) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return copyAuthCookies(NextResponse.redirect(loginUrl));
  }

  if (isPlatformAdminHost && path === "/") {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = "/platform-admin";
    return copyAuthCookies(NextResponse.rewrite(rewriteUrl, { request: { headers: request.headers } }));
  }


  if (isWorkforceHost && path === "/") {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = "/delivery-network";
    return copyAuthCookies(NextResponse.rewrite(rewriteUrl, { request: { headers: request.headers } }));
  }

  if (isOpsHost && isCleanOpsPath(path)) {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = path === "/" ? "/ops-pulse" : `/ops-pulse${path}`;
    return copyAuthCookies(NextResponse.rewrite(rewriteUrl, { request: { headers: request.headers } }));
  }

  return copyAuthCookies(NextResponse.next({ request: { headers: request.headers } }));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|favicon.png|dropx-logo.jpg|dropx-logo.png).*)"]
};
