import { NextResponse, type NextRequest } from "next/server";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { profileDocumentBucket } from "@/lib/profile-document-storage";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isWorkforceProfileType, workforceTable } from "@/lib/workforce-profiles";

const attachmentFields = new Set([
  "aadhaar_front_path",
  "aadhaar_back_path",
  "pan_upload_path",
  "dl_front_path",
  "dl_back_path",
  "profile_photo_path"
]);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const authorization = await requirePagePermission("people_review", "access");
    const companyId = requireCompanyId(authorization);
    if (!supabaseAdmin) {
      return NextResponse.json({ error: "Supabase service role key is not configured." }, { status: 500 });
    }

    const profileType = request.nextUrl.searchParams.get("profile_type");
    const id = request.nextUrl.searchParams.get("id");
    const field = request.nextUrl.searchParams.get("field");
    if (!isWorkforceProfileType(profileType) || !id || !field || !attachmentFields.has(field)) {
      return NextResponse.json({ error: "Choose a valid profile attachment." }, { status: 400 });
    }

    const result = await supabaseAdmin
      .from(workforceTable(profileType))
      .select(`location_id, ${field}`)
      .eq("company_id", companyId)
      .eq("id", id)
      .maybeSingle();
    if (result.error) throw new Error(result.error.message);

    const row = result.data as unknown as Record<string, unknown> | null;
    if (!row) {
      return NextResponse.json({ error: "Profile was not found." }, { status: 404 });
    }
    const locationId = String(row.location_id ?? "").trim();
    if (!authorization.hasAllLocationAccess && !authorization.isMasterOwner &&
        (!locationId || !authorization.locationScopeIds.includes(locationId))) {
      return NextResponse.json({ error: "Attachment access denied." }, { status: 403 });
    }

    const storagePath = String(row[field] ?? "").trim();
    if (!storagePath) {
      return NextResponse.json({ error: "Attachment is not available." }, { status: 404 });
    }
    const file = await supabaseAdmin.storage.from(profileDocumentBucket).download(storagePath);
    if (file.error) throw new Error(file.error.message);

    return new NextResponse(file.data, {
      headers: {
        "Content-Disposition": `inline; filename="${safeFilename(storagePath)}"`,
        "Content-Type": file.data.type || "application/octet-stream",
        "Cache-Control": "private, max-age=0, no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load profile attachment." },
      { status: 500 }
    );
  }
}

function safeFilename(path: string) {
  const filename = path.split("/").pop() ?? "profile-attachment";
  return filename.replace(/[\r\n"]/g, "").trim() || "profile-attachment";
}
