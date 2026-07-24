import { NextResponse } from "next/server";
import { getAuthorization, hasPermission } from "@/lib/authorization";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const authorization = await getAuthorization();
  if (!authorization || !hasPermission(authorization, "cod_reports", "access")) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (!supabaseAdmin || !authorization.companyId) return NextResponse.json({ error: "Database unavailable." }, { status: 500 });
  const { data, error } = await supabaseAdmin.from("ops_amazon_scorecards")
    .select("location_id,attachment").eq("company_id", authorization.companyId).eq("id", params.id).maybeSingle();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Report not found." }, { status: 404 });
  if (!authorization.hasAllLocationAccess && (!data.location_id || !authorization.locationScopeIds.includes(data.location_id))) {
    return NextResponse.json({ error: "Location access denied." }, { status: 403 });
  }
  const attachment = data.attachment as { storage_bucket?: string; storage_path?: string; file_name?: string; content_type?: string } | null;
  if (!attachment?.storage_bucket || !attachment.storage_path) return NextResponse.json({ error: "File is unavailable." }, { status: 404 });
  const file = await supabaseAdmin.storage.from(attachment.storage_bucket).download(attachment.storage_path);
  if (file.error) return NextResponse.json({ error: file.error.message }, { status: 500 });
  return new Response(await file.data.arrayBuffer(), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${(attachment.file_name || "amazon-report").replace(/"/g, "")}"`,
      "Content-Type": attachment.content_type || "application/octet-stream"
    }
  });
}
