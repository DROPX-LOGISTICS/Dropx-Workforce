import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { activeConnectPreview, connectOwnerCompany, connectPreviewCookieName, connectSessionIdentity, listConnectPreviewAccounts } from "../../../../src/lib/connect-owner-preview";

const options = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 8 };

export async function GET(request: NextRequest) {
  const identity = await connectSessionIdentity();
  const companyId = identity ? await connectOwnerCompany(identity) : null;
  if (!companyId) return NextResponse.json({ error: "Owner access is required." }, { status: 403 });
  const q = request.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const users = (await listConnectPreviewAccounts(companyId)).filter((user) => !q || `${user.name} ${user.reference} ${user.role} ${user.email}`.toLowerCase().includes(q));
  const active = await activeConnectPreview();
  return NextResponse.json({ users, selected: active.account ? `${active.account.profileType}:${active.account.id}` : null });
}

export async function POST(request: NextRequest) {
  const identity = await connectSessionIdentity();
  const companyId = identity ? await connectOwnerCompany(identity) : null;
  if (!companyId) return NextResponse.json({ error: "Owner access is required." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { profileType?: unknown; accountId?: unknown };
  const profileType = String(body.profileType ?? "");
  const accountId = String(body.accountId ?? "");
  if (!profileType || !accountId) {
    cookies().set(connectPreviewCookieName, "", { ...options, maxAge: 0 });
    return NextResponse.json({ ok: true, preview: false });
  }
  const account = (await listConnectPreviewAccounts(companyId)).find((row) => row.profileType === profileType && row.id === accountId);
  if (!account) return NextResponse.json({ error: "Choose an active DropX One account." }, { status: 400 });
  cookies().set(connectPreviewCookieName, `${profileType}:${accountId}:${companyId}`, options);
  return NextResponse.json({ ok: true, preview: true });
}
