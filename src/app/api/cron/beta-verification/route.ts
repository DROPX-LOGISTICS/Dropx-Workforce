import { NextResponse } from 'next/server';
import { reconcileBetaIdentities } from '@/lib/beta-identity-reconciliation';
import { processBetaVerificationMail } from '@/lib/beta-verification-mail';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Independent queues: one failing must not prevent the other from progressing.
  const [mail, identity] = await Promise.allSettled([processBetaVerificationMail(), reconcileBetaIdentities()]);
  return NextResponse.json({
    mail: mail.status === 'fulfilled' ? mail.value : { status: 'unavailable' },
    identity: identity.status === 'fulfilled' ? identity.value : { status: 'retry_pending' }
  }, { status: mail.status === 'rejected' || identity.status === 'rejected' ? 503 : 200 });
}
