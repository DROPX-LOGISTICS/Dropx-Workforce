import 'server-only';
import nodemailer from 'nodemailer';
import { supabaseAdmin } from '@/lib/supabase-admin';

export function verificationMailBody(candidate: { full_name: string; alias_email: string }, reference: string, address: Record<string, string>) {
  return [
    'Hello IDfy Operations,', '', 'The candidate has submitted the following corrected current residential address and requested address re-verification.', '',
    `Candidate: ${candidate.full_name}`, `Invited Amazon email: ${candidate.alias_email}`, `IDfy profile/reference: ${reference}`, '',
    `House / flat / building: ${address.house}`, `Road / street: ${address.road}`, `Area / locality: ${address.locality}`, `Landmark: ${address.landmark}`, `City: ${address.city}`, `State: ${address.state}`, `PIN: ${address.pin}`, `Reachable contact: +91${address.mobile}`, '',
    'Please arrange address re-verification using these updated details and share the request reference and outcome. This is the address the candidate confirms they currently live at.', '', 'DropX Logistics'
  ].join('\n');
}

export async function processBetaVerificationMail() {
  const db = supabaseAdmin;
  if (!db) throw new Error('Private beta database unavailable');
  const queued = await db.from('workforce_beta_verification_cases').select('id,company_id,candidate_id').eq('kind', 'address').eq('mail_status', 'queued').eq('status', 'awaiting_idfy').not('response_at', 'is', null).order('mail_requested_at').limit(5);
  if (queued.error) throw new Error('Private re-verification queue unavailable');
  let sent = 0, held = 0;
  for (const item of queued.data ?? []) {
    const cfg = await db.from('workforce_beta_verification_settings').select('sender_email,recipients').eq('company_id', item.company_id).maybeSingle();
    const sender = cfg.data?.sender_email;
    // Dedicated sender credentials only: never alter or silently use the global
    // notification mailbox. Passwords are environment secrets, not candidate data.
    if (cfg.error || sender !== 'nisar@dropxlogistics.com' || process.env.BETA_IDFY_SMTP_USER?.toLowerCase() !== sender || !process.env.BETA_IDFY_SMTP_PASSWORD || !process.env.BETA_IDFY_SMTP_HOST) {
      await db.from('workforce_beta_verification_cases').update({ last_error: 'Sender mailbox nisar@dropxlogistics.com needs authenticated configuration. Your response is saved; offboarding is stopped.' }).eq('id', item.id).eq('company_id', item.company_id).eq('mail_status', 'queued');
      held++; continue;
    }
    const recipients = (cfg.data?.recipients ?? []) as string[];
    if (recipients.length !== 2 || !recipients.includes('support@idfy.com') || !recipients.includes('amazon@idfyops.com')) { held++; continue; }
    const candidate = await db.from('workforce_amazon_email_pilot_candidates').select('full_name,alias_email').eq('id', item.candidate_id).eq('company_id', item.company_id).is('closed_at', null).maybeSingle();
    if (candidate.error || !candidate.data) { held++; continue; }
    const claim = await db.rpc('workforce_beta_claim_mail', { p_company: item.company_id, p_case: item.id });
    if (claim.error || !claim.data?.token) { held++; continue; }
    const token = claim.data.token;
    const snapshot = claim.data.snapshot;
    try {
      if (snapshot.identity_email?.toLowerCase() !== candidate.data.alias_email.toLowerCase() || !snapshot.idfy_profile_id) throw new Error('Candidate reference needs review');
      const port = Number(process.env.BETA_IDFY_SMTP_PORT || 587);
      const transport = nodemailer.createTransport({ host: process.env.BETA_IDFY_SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465, auth: { user: sender, pass: process.env.BETA_IDFY_SMTP_PASSWORD }, connectionTimeout: 8000, socketTimeout: 15000 });
      const messageId = `<beta-idfy-${token}@dropxlogistics.com>`;
      const result = await transport.sendMail({ from: sender, to: recipients, subject: `Address re-verification | IDfy ${snapshot.idfy_profile_id} | ${candidate.data.full_name}`, messageId, text: verificationMailBody(candidate.data, snapshot.idfy_profile_id, claim.data.case.current_address) });
      if ((result.rejected?.length ?? 0) > 0 || (result.accepted?.length ?? 0) !== 2) throw new Error('Delivery needs review; do not resend until the mailbox is checked');
      const saved = await db.from('workforce_beta_verification_cases').update({ mail_status: 'sent', mail_id: messageId, mail_sent_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq('company_id', item.company_id).eq('id', item.id).eq('claim_token', token).eq('mail_status', 'sending');
      if (saved.error) throw new Error('Mail accepted; local delivery state needs reconciliation');
      await db.from('workforce_beta_verification_events').insert({ company_id: item.company_id, candidate_id: item.candidate_id, case_id: item.id, event: 'address_email_sent', detail: { messageId, sender, recipients } });
      sent++;
    } catch {
      // SMTP can accept a message before a timeout. Ambiguous attempts are held
      // for reconciliation, never automatically retried and duplicated.
      await db.from('workforce_beta_verification_cases').update({ mail_status: 'delivery_review', last_error: 'Delivery could not be confirmed. Check the sender mailbox before retrying.', updated_at: new Date().toISOString() }).eq('company_id', item.company_id).eq('id', item.id).eq('claim_token', token);
      held++;
    }
  }
  return { sent, held };
}
