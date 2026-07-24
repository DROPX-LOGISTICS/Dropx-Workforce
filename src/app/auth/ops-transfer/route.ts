import { NextRequest, NextResponse } from "next/server";
import { readOpsAuthTransfer } from "@/lib/ops-auth-transfer";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const loginUrl = new URL("/login", request.url);
  const response = NextResponse.redirect(new URL("/ops-pulse", request.url));

  try {
    const token = request.nextUrl.searchParams.get("token");
    if (!token) throw new Error("Missing Ops authentication transfer.");
    const session = readOpsAuthTransfer(token);
    const supabase = createServerSupabaseClient(response);
    if (!supabase) throw new Error("Authentication is not configured.");
    const { data, error } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token
    });
    if (error) throw error;
    if (!data.session) throw new Error("Ops session was not created.");

    const storedSession = JSON.stringify(data.session);
    const chunks = storedSession.match(/.{1,3000}/g) ?? [];
    for (let index = 0; index < 8; index += 1) {
      response.cookies.set(`dropx-ops-auth-v3.${index}`, chunks[index] ?? "", {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
        maxAge: chunks[index] ? 60 * 60 * 24 * 30 : 0
      });
    }
    response.cookies.set("dropx_ops_auth_return", "", {
      domain: ".dropxlogistics.com",
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 0
    });
    return response;
  } catch (error) {
    loginUrl.searchParams.set(
      "error",
      error instanceof Error ? error.message : "Unable to complete Ops authentication."
    );
    return NextResponse.redirect(loginUrl);
  }
}
