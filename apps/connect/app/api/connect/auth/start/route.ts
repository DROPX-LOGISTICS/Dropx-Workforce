import { NextResponse } from "next/server";
import { findConnectAccounts, normalizeConnectMobile } from "@/lib/connect-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

function loginErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("schema cache") || message.includes("does not exist") || message.includes("relation")) {
    return "We’re updating the account service. Please try again in a moment.";
  }
  return "We couldn’t check this mobile number right now. Please try again shortly.";
}

export async function POST(request: Request) {
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const body = await request.json().catch(() => ({})) as { mobile?: unknown; countryCode?: unknown };
    const { countryCode, mobile } = normalizeConnectMobile(body.mobile, body.countryCode);
    if (!mobile || mobile.length < 7) {
      return NextResponse.json({ error: "Enter a valid mobile number." }, { status: 400 });
    }

    const accounts = await findConnectAccounts(countryCode, mobile);
    if (!accounts.length) {
      return NextResponse.json({ error: "No active account found for this mobile number." }, { status: 404 });
    }

    const pinResult = await supabaseAdmin
      .from("connect_user_pins")
      .select("id, locked_until, reset_required")
      .eq("country_code", countryCode)
      .eq("mobile_number", mobile)
      .maybeSingle();
    if (pinResult.error) throw new Error(pinResult.error.message);

    return NextResponse.json({
      ok: true,
      mode: pinResult.data && !pinResult.data.reset_required ? "pin" : "setup",
      accounts
    });
  } catch (error) {
    console.error("DropX One login lookup failed", error);
    return NextResponse.json({ error: loginErrorMessage(error) }, { status: 503 });
  }
}
