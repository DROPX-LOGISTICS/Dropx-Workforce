import { NextRequest, NextResponse } from "next/server";

const dashboardUrl =
  process.env.DASHBOARD_URL?.replace(/\/$/, "") ||
  "https://dashboard.dropxlogistics.com";

export async function GET(request: NextRequest) {
  const target = new URL("/api/connect/attendance", dashboardUrl);
  request.nextUrl.searchParams.forEach((value, key) =>
    target.searchParams.set(key, value)
  );
  const response = await fetch(target, {
    cache: "no-store",
    headers: { cookie: request.headers.get("cookie") ?? "" }
  });
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" }
  });
}

export async function POST(request: NextRequest) {
  const target = new URL("/api/connect/attendance", dashboardUrl);
  const contentType = request.headers.get("content-type") ?? "";
  const response = await fetch(target, {
    method: "POST",
    cache: "no-store",
    headers: {
      cookie: request.headers.get("cookie") ?? "",
      ...(contentType ? { "content-type": contentType } : {})
    },
    body: await request.arrayBuffer()
  });
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" }
  });
}
