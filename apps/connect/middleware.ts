import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const preview = request.cookies.get("dropx_connect_preview_account")?.value;
  if (preview && !["GET", "HEAD", "OPTIONS"].includes(request.method) && path !== "/api/connect/owner-preview") {
    return NextResponse.json({ error: "User preview is read-only. Exit preview to make changes." }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
