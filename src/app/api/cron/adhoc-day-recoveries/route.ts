import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { quoteAdhocDayRecovery, type AdhocRecoveryContext } from '@/lib/workforce-adhoc-recovery';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({error: 'Unauthorized'}, {status: 401});
  }
  if (!supabaseAdmin) return NextResponse.json({error: 'Database unavailable'}, {status: 503});
  const candidates = await supabaseAdmin.rpc('workforce_adhoc_recovery_candidates');
  if (candidates.error) return NextResponse.json({error: candidates.error.message}, {status: 503});
  const outcomes: Record<string, number> = {};
  const started = Date.now();
  for (const id of (candidates.data ?? []) as string[]) {
    if (Date.now() - started > 45_000) break;
    let context: AdhocRecoveryContext | null = null;
    try {
      const result = await supabaseAdmin.rpc('workforce_adhoc_recovery_context', {p_request: id});
      if (result.error) throw result.error;
      if (!result.data) continue;
      context = result.data as AdhocRecoveryContext;
      const quote = quoteAdhocDayRecovery(context);
      const saved = await supabaseAdmin.rpc('workforce_finish_adhoc_recovery', {p_request: id, p_hash: context.hash, p_quote: quote});
      if (saved.error) throw saved.error;
      const state = String(saved.data);
      outcomes[state] = (outcomes[state] ?? 0) + 1;
    } catch (error) {
      outcomes.error = (outcomes.error ?? 0) + 1;
      if (context) {
        await supabaseAdmin.rpc('workforce_finish_adhoc_recovery', {p_request: id, p_hash: context.hash,
          p_quote: {state: 'error', reason: 'Recovery calculation needs review; payment remains processed.'}});
      }
      console.error('Adhoc day recovery deferred', id, error instanceof Error ? error.message : String(error));
    }
  }
  return NextResponse.json({outcomes}, {status: outcomes.error ? 500 : 200});
}
