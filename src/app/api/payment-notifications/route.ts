import { NextResponse } from "next/server";
import { getAuthorization } from "@/lib/authorization";
import { emptyPaymentNotificationSnapshot, loadPaymentNotificationSnapshot } from "@/lib/payment-notification-counts";

export const dynamic = "force-dynamic";

export async function GET() {
  const authorization = await getAuthorization();
  if (!authorization) {
    return NextResponse.json(emptyPaymentNotificationSnapshot(), { status: 401 });
  }

  const snapshot = await loadPaymentNotificationSnapshot(authorization);
  return NextResponse.json(snapshot);
}
