import { NextResponse } from 'next/server';
import { processBetaVerificationMail } from '@/lib/beta-verification-mail';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { return NextResponse.json(await processBetaVerificationMail()); }
  catch { return NextResponse.json({ error: 'Private verification queue unavailable' }, { status: 503 }); }
}
