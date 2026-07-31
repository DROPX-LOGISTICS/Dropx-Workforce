import { NextRequest, NextResponse } from "next/server";
import { getAuthorization, isCompanyOwner } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { dynamicWorkforceTable, isCustomWorkforceCategoryCode, normalizeWorkforceCategoryCode } from "@/lib/dynamic-workforce";
import { profileDocumentBucket } from "@/lib/profile-document-storage";
import { supabaseAdmin } from "@/lib/supabase-admin";

const allowedFields: Record<string, string> = {
  aadhaar_front: "aadhaar_front_path", aadhaar_back: "aadhaar_back_path", pan_upload: "pan_upload_path",
  dl_front: "dl_front_path", dl_back: "dl_back_path", profile_photo: "profile_photo_path"
};

export async function GET(request: NextRequest) {
  const authorization = await getAuthorization();
  if (!authorization || !supabaseAdmin) return NextResponse.redirect(new URL("/login", request.url));
  const companyId = requireCompanyId(authorization);
  const code = normalizeWorkforceCategoryCode(request.nextUrl.searchParams.get("code"));
  const id = String(request.nextUrl.searchParams.get("id") ?? "");
  const column = allowedFields[String(request.nextUrl.searchParams.get("field") ?? "")];
  if (!isCustomWorkforceCategoryCode(code) || !id || !column) return new NextResponse("Invalid document request.", { status: 400 });
  const result = await supabaseAdmin.from(dynamicWorkforceTable(code)).select(`company_id, location_id, ${column}`).eq("id", id).eq("company_id", companyId).maybeSingle();
  if (result.error || !result.data) return new NextResponse("Document not found.", { status: 404 });
  const row = result.data as unknown as Record<string, unknown>;
  if (!isCompanyOwner(authorization) && !authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(String(row.location_id ?? ""))) {
    return new NextResponse("Forbidden.", { status: 403 });
  }
  const path = String(row[column] ?? "");
  if (!path) return new NextResponse("Document not found.", { status: 404 });
  const signed = await supabaseAdmin.storage.from(profileDocumentBucket).createSignedUrl(path, 120);
  if (signed.error || !signed.data?.signedUrl) return new NextResponse("Unable to open document.", { status: 500 });
  return NextResponse.redirect(signed.data.signedUrl);
}
