export const dynamic = "force-dynamic";

import crypto from "crypto";
import { getAuthorization, hasPermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

const bucket = "report-import-staging";

function safeFileName(value: unknown) {
  return String(value ?? "report").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-120);
}

export async function POST(request: Request) {
  if (!supabaseAdmin) return Response.json({ error: "Supabase service key is not configured." }, { status: 500 });
  const authorization = await getAuthorization();
  if (!authorization) return Response.json({ error: "Login required." }, { status: 401 });
  if (!hasPermission(authorization, "imports", "add") && !hasPermission(authorization, "imports", "edit")) {
    return Response.json({ error: "Report import permission denied." }, { status: 403 });
  }
  const companyId = requireCompanyId(authorization);
  const body = await request.json().catch(() => ({}));
  const size = Number(body.size ?? 0);
  if (!Number.isFinite(size) || size <= 0 || size > 100 * 1024 * 1024) {
    return Response.json({ error: "The report must be between 1 byte and 100 MB." }, { status: 400 });
  }
  const path = `${companyId}/${authorization.userId}/${crypto.randomUUID()}-${safeFileName(body.fileName)}`;
  let signed = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(path);
  if (signed.error && /(bucket.*not found|related resource does not exist)/i.test(signed.error.message)) {
    const created = await supabaseAdmin.storage.createBucket(bucket, {
      fileSizeLimit: 100 * 1024 * 1024,
      public: false
    });
    if (created.error && !/already exists/i.test(created.error.message)) {
      return Response.json({ error: created.error.message }, { status: 500 });
    }
    signed = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(path);
  }
  if (signed.error || !signed.data) {
    return Response.json({ error: signed.error?.message ?? "Unable to prepare the report upload." }, { status: 500 });
  }
  return Response.json({ bucket, path: signed.data.path, token: signed.data.token });
}
