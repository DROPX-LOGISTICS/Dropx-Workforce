import { supabaseAdmin } from "@/lib/supabase-admin";

export const WEBHOOK_COMPANY_HEADER = "x-dropx-webhook-company-id";
export const WEBHOOK_COMPANY_KEY_HEADER = "x-dropx-webhook-company-key";

export function webhookCompanyId(request: Request) {
  return request.headers.get(WEBHOOK_COMPANY_HEADER);
}

export function webhookCompanyKey(request: Request) {
  return request.headers.get(WEBHOOK_COMPANY_KEY_HEADER);
}

export async function findCompanyByWebhookKey(webhookKey: string) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const result = await supabaseAdmin
    .from("companies")
    .select("id, code, name, is_active")
    .eq("webhook_key", webhookKey)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data?.id || !result.data.is_active) return null;
  return result.data;
}

export function withWebhookCompanyHeader(request: Request, companyId: string) {
  const headers = new Headers(request.headers);
  headers.set(WEBHOOK_COMPANY_HEADER, companyId);
  return new Request(request, { headers });
}
