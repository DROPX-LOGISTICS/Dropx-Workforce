import { NextRequest, NextResponse } from "next/server";

const dashboardUrl = process.env.DASHBOARD_URL?.replace(/\/$/, "") || "https://dashboard.dropxlogistics.com";

async function proxy(request: NextRequest, method: "GET" | "POST") {
  const target = new URL("/api/connect/leave", dashboardUrl);
  request.nextUrl.searchParams.forEach((value, key) => target.searchParams.set(key, value));
  const response = await fetch(target, {
    method,
    cache: "no-store",
    headers: {
      cookie: request.headers.get("cookie") ?? "",
      ...(method === "POST" ? { "content-type": "application/json" } : {})
    },
    ...(method === "POST" ? { body: await request.text() } : {})
  });
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" }
  });
}

export async function GET(request: NextRequest) {
  return proxy(request, "GET");
}

export async function POST(request: NextRequest) {
  return proxy(request, "POST");
}
