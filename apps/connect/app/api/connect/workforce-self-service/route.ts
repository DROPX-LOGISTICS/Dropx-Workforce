import { NextRequest, NextResponse } from "next/server";

const workforceUrl = process.env.WORKFORCE_URL?.replace(/\/$/, "") || "https://workforce.dropxlogistics.com";

export async function GET(request: NextRequest) {
  const target = new URL("/api/connect/workforce-self-service", workforceUrl);
  request.nextUrl.searchParams.forEach((value, key) => target.searchParams.set(key, value));
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
  const target = new URL("/api/connect/workforce-self-service", workforceUrl);
  const response = await fetch(target, {
    method: "POST",
    cache: "no-store",
    headers: { cookie: request.headers.get("cookie") ?? "", "content-type": "application/json" },
    body: await request.text()
  });
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" }
  });
}
