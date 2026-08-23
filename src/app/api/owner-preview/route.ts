import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { dashboardPreviewCookieName } from "@/lib/authorization";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

async function ownerViewer() {
  const client = createServerSupabaseClient();
  if (!client || !supabaseAdmin) return null;
  const { data } = await client.auth.getUser();
  if (!data.user) return null;
  const profile = await supabaseAdmin.from("profiles").select("id,company_id,full_name,is_master_owner,role_id,is_active").eq("id", data.user.id).maybeSingle();
  if (profile.error || !profile.data?.is_active || !profile.data.company_id) return null;
  const role = profile.data.role_id ? await supabaseAdmin.from("user_roles").select("code").eq("id", profile.data.role_id).maybeSingle() : { data: null };
  const owner = Boolean(profile.data.is_master_owner) || String(role.data?.code ?? "").toUpperCase() === "OWNER" || String(data.user.email ?? "").toLowerCase() === "nisar@dropxlogistics.com";
  return owner ? profile.data : null;
}

const options = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 8 };

export async function GET(request: NextRequest) {
  const viewer = await ownerViewer();
  if (!viewer || !supabaseAdmin) return NextResponse.json({ error: "Owner access is required." }, { status: 403 });
  const profiles = await supabaseAdmin.from("profiles").select("id,full_name,email,role_id,location_scope_ids,is_active").eq("company_id", viewer.company_id).eq("is_active", true).order("full_name");
  if (profiles.error) return NextResponse.json({ error: profiles.error.message }, { status: 500 });
  const roleIds = [...new Set((profiles.data ?? []).map((row) => row.role_id).filter(Boolean))];
  const roles = roleIds.length ? await supabaseAdmin.from("user_roles").select("id,name,code,location_access_mode").in("id", roleIds) : { data: [], error: null };
  if (roles.error) return NextResponse.json({ error: roles.error.message }, { status: 500 });
  const roleById = new Map((roles.data ?? []).map((row) => [row.id, row]));
  const q = request.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const users = (profiles.data ?? []).map((profile) => {
    const role = roleById.get(profile.role_id);
    return { id: profile.id, name: profile.full_name || profile.email || "Dashboard user", email: profile.email || "", role: role?.name || role?.code || "User", scope: role?.location_access_mode === "all_locations" ? "All locations" : `${Array.isArray(profile.location_scope_ids) ? profile.location_scope_ids.length : 0} locations` };
  }).filter((user) => !q || `${user.name} ${user.email} ${user.role}`.toLowerCase().includes(q));
  return NextResponse.json({ users, selectedUserId: cookies().get(dashboardPreviewCookieName)?.value ?? null });
}

export async function POST(request: NextRequest) {
  const viewer = await ownerViewer();
  if (!viewer || !supabaseAdmin) return NextResponse.json({ error: "Owner access is required." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { userId?: unknown };
  const userId = String(body.userId ?? "").trim();
  if (!userId || userId === viewer.id) {
    cookies().set(dashboardPreviewCookieName, "", { ...options, maxAge: 0 });
    return NextResponse.json({ ok: true, preview: false });
  }
  const target = await supabaseAdmin.from("profiles").select("id").eq("id", userId).eq("company_id", viewer.company_id).eq("is_active", true).maybeSingle();
  if (target.error || !target.data) return NextResponse.json({ error: "Choose an active user in your company." }, { status: 400 });
  cookies().set(dashboardPreviewCookieName, userId, options);
  return NextResponse.json({ ok: true, preview: true });
}
