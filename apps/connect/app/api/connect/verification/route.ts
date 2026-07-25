import { NextRequest, NextResponse } from "next/server";

const dashboardUrl =
  process.env.DASHBOARD_URL?.replace(/\/$/, "") ||
  "https://dashboard.dropxlogistics.com";

async function forward(request: NextRequest) {
  const target = new URL("/api/connect/verification", dashboardUrl);
  request.nextUrl.searchParams.forEach((value, key) =>
    target.searchParams.set(key, value)
  );
  const response = await fetch(target, {
    method: request.method,
    cache: "no-store",
    headers: {
      cookie: request.headers.get("cookie") ?? "",
      "content-type": request.headers.get("content-type") ?? "application/json"
    },
    body: request.method === "POST" ? await request.text() : undefined
  });
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" }
  });
}

export const GET = forward;
export const POST = forward;
