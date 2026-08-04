import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { connectSessionCookieName, findConnectAccounts } from "../../../../src/lib/connect-auth";
import { supabaseAdmin } from "../../../../src/lib/supabase-admin";

async function requireFieldExecutive(executiveId: string) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const token = cookies().get(connectSessionCookieName)?.value;
  if (!token) throw new Error("Connect session expired. Please log in again.");
  const sessionHash = createHash("sha256").update(token).digest("hex");
  const session = await supabaseAdmin.from("connect_login_sessions")
    .select("country_code, mobile_number, expires_at, revoked_at")
    .eq("session_hash", sessionHash).maybeSingle();
  if (session.error) throw new Error(session.error.message);
  if (!session.data || session.data.revoked_at || new Date(session.data.expires_at).getTime() < Date.now()) {
    throw new Error("Connect session expired. Please log in again.");
  }
  const account = (await findConnectAccounts(session.data.country_code, session.data.mobile_number))
    .find((item) => item.id === executiveId && item.profileType === "field_executive");
  if (!account) throw new Error("Field workforce profile is not available for this login.");
  return account;
}

export async function GET(request: Request) {
  try {
    const executiveId = new URL(request.url).searchParams.get("executiveId") ?? "";
    const account = await requireFieldExecutive(executiveId);
    const result = await supabaseAdmin!.from("workforce_lifecycle_cases")
      .select("id, case_type, status, requested_effective_date, approved_effective_date, reason_code, reason_details, review_remarks, created_at")
      .eq("company_id", account.companyId).eq("field_executive_id", account.id)
      .order("created_at", { ascending: false });
    if (result.error) throw new Error(result.error.message);
    return NextResponse.json({ ok: true, cases: result.data ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load resignation status." }, { status: 403 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { executiveId?: string; effectiveDate?: string; reasonDetails?: string };
    const account = await requireFieldExecutive(String(body.executiveId ?? ""));
    const effectiveDate = String(body.effectiveDate ?? "").trim();
    const reasonDetails = String(body.reasonDetails ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw new Error("Requested last working date is required.");
    if (effectiveDate < new Date().toISOString().slice(0, 10)) throw new Error("Requested last working date cannot be in the past.");
    if (reasonDetails.length < 5) throw new Error("Provide a clear resignation reason.");
    const profile = await supabaseAdmin!.from("field_executives")
      .select("id, lifecycle_status, location_id")
      .eq("company_id", account.companyId).eq("id", account.id).maybeSingle();
    if (profile.error) throw new Error(profile.error.message);
    if (!profile.data || profile.data.lifecycle_status !== "active") throw new Error("Only active workforce can submit a resignation.");
    const created = await supabaseAdmin!.from("workforce_lifecycle_cases").insert({
      company_id: account.companyId,
      field_executive_id: account.id,
      case_type: "resignation",
      requested_effective_date: effectiveDate,
      reason_code: "voluntary",
      reason_details: reasonDetails,
      initiated_source: "connect"
    }).select("id").single();
    if (created.error) throw new Error(created.error.message);
    const update = await supabaseAdmin!.from("field_executives")
      .update({ lifecycle_status: "resignation_pending", updated_at: new Date().toISOString() })
      .eq("company_id", account.companyId).eq("id", account.id);
    if (update.error) throw new Error(update.error.message);
    const event = await supabaseAdmin!.from("workforce_lifecycle_events").insert({
      company_id: account.companyId,
      lifecycle_case_id: created.data.id,
      field_executive_id: account.id,
      event_code: "resignation_submitted",
      from_status: "active",
      to_status: "submitted",
      source_portal: "connect",
      remarks: reasonDetails
    });
    if (event.error) throw new Error(event.error.message);
    return NextResponse.json({ ok: true, notice: "Resignation submitted to the HO Workforce team." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to submit resignation." }, { status: 400 });
  }
}
