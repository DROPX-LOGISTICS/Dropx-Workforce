import { NextResponse } from "next/server";
import { getAuthorization } from "@/lib/authorization";
import { writeEventLog } from "@/lib/event-log";

export async function POST(request: Request) {
  const authorization = await getAuthorization();
  if (!authorization?.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  await writeEventLog({
    companyId: authorization.companyId,
    platform: "dashboard",
    eventCode: String(body.eventCode ?? "ui_action"),
    module: String(body.module ?? "dashboard"),
    action: String(body.action ?? "view"),
    outcome: "info",
    actorType: "dashboard_user",
    actorUserId: authorization.userId,
    actorLabel: authorization.fullName,
    actorIdentifier: authorization.email,
    route: String(body.route ?? ""),
    method: request.method,
    metadata: typeof body.metadata === "object" && body.metadata ? body.metadata as Record<string, unknown> : {},
    request
  });
  return NextResponse.json({ ok: true });
}
