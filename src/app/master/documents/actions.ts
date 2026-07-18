"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

function clean(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

function required(value: FormDataEntryValue | null, field: string) {
  const text = clean(value);
  if (!text) throw new Error(`${field} is required.`);
  return text;
}

function documentsRedirect(params: { error?: string; notice?: string }) {
  cookies().set("dropx_document_master_flash", JSON.stringify(params), {
    httpOnly: true,
    maxAge: 20,
    path: "/master/documents",
    sameSite: "lax"
  });
  redirect("/master/documents");
}

function isNextRedirectError(error: unknown) {
  return typeof (error as { digest?: unknown })?.digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
}

function parseDocument(formData: FormData) {
  const code = required(formData.get("code"), "Document code").toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
  const name = required(formData.get("name"), "Document name");
  const documentModule = clean(formData.get("document_module")) === "business" ? "business" : "fleet";
  const businessScopeModeRaw = clean(formData.get("business_scope_mode"));
  const businessScopeMode = documentModule === "business" && businessScopeModeRaw && ["company", "state", "location", "provider"].includes(businessScopeModeRaw)
    ? businessScopeModeRaw
    : null;
  const docAccessMode = clean(formData.get("doc_access_mode")) === "role_based" ? "role_based" : "all_users";
  const accessRoleIds = Array.from(new Set(formData.getAll("access_role_ids").map((value) => clean(value)).filter(Boolean) as string[]));
  const reminderDaysRaw = clean(formData.get("reminder_days"));
  const reminderDays = reminderDaysRaw ? Number(reminderDaysRaw) : 30;
  if (!Number.isFinite(reminderDays) || reminderDays < 0 || reminderDays > 365) {
    throw new Error("Reminder days must be between 0 and 365.");
  }
  return {
    accessRoleIds: docAccessMode === "role_based" ? accessRoleIds : [],
    payload: {
      code,
      name,
      description: clean(formData.get("description")),
      document_module: documentModule,
      business_scope_mode: businessScopeMode,
      doc_access_mode: docAccessMode,
      enable_scope_access: documentModule === "business" && formData.get("enable_scope_access") === "on",
      requires_expiry: formData.get("requires_expiry") === "on",
      reminder_days: Math.floor(reminderDays),
      is_active: clean(formData.get("status")) === "inactive" ? false : true
    }
  };
}

async function validateRoleIds(companyId: string, roleIds: string[]) {
  if (!roleIds.length) return;
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("id")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .in("id", roleIds);
  if (error) throw new Error(error.message);
  const validIds = new Set((data ?? []).map((role) => role.id));
  const invalidIds = roleIds.filter((id) => !validIds.has(id));
  if (invalidIds.length) throw new Error("One or more selected roles are invalid.");
}

async function saveDocumentTypeRoleAccess(companyId: string, documentTypeId: string, roleIds: string[]) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const deleteResult = await supabaseAdmin
    .from("document_type_role_access")
    .delete()
    .eq("company_id", companyId)
    .eq("document_type_id", documentTypeId);
  if (deleteResult.error) throw new Error(deleteResult.error.message);
  if (!roleIds.length) return;

  const insertResult = await supabaseAdmin
    .from("document_type_role_access")
    .insert(roleIds.map((roleId) => ({
      company_id: companyId,
      document_type_id: documentTypeId,
      role_id: roleId
    })));
  if (insertResult.error) throw new Error(insertResult.error.message);
}

export async function createDocumentType(formData: FormData) {
  const authorization = await requirePagePermission("master_documents", "add");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const { accessRoleIds, payload } = parseDocument(formData);
    await validateRoleIds(companyId, accessRoleIds);
    const { data, error } = await supabaseAdmin
      .from("document_types")
      .insert(withCompany(payload, companyId))
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await saveDocumentTypeRoleAccess(companyId, data.id, accessRoleIds);

    revalidatePath("/master/documents");
    revalidatePath("/business-documents");
    documentsRedirect({ notice: "Document type added." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    documentsRedirect({ error: error instanceof Error ? error.message : "Unable to add document type." });
  }
}

export async function updateDocumentType(formData: FormData) {
  const authorization = await requirePagePermission("master_documents", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const id = required(formData.get("id"), "Document type");
    const { accessRoleIds, payload } = parseDocument(formData);
    await validateRoleIds(companyId, accessRoleIds);

    const existing = await supabaseAdmin
      .from("document_types")
      .select("code")
      .eq("id", id)
      .eq("company_id", companyId)
      .single();
    if (existing.error) throw new Error(existing.error.message);

    const usage = await countDocumentUsage(companyId, existing.data.code);
    if (usage > 0 && payload.code !== existing.data.code) {
      throw new Error("Document code cannot be changed because this document is already used.");
    }

    const { error } = await supabaseAdmin
      .from("document_types")
      .update({ ...payload, code: usage > 0 ? existing.data.code : payload.code, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);
    await saveDocumentTypeRoleAccess(companyId, id, accessRoleIds);

    revalidatePath("/master/documents");
    revalidatePath("/business-documents");
    documentsRedirect({ notice: "Document type updated." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    documentsRedirect({ error: error instanceof Error ? error.message : "Unable to update document type." });
  }
}

async function countDocumentUsage(companyId: string, code: string) {
  if (!supabaseAdmin) return 0;
  const codes = Array.from(new Set([code, code.toUpperCase(), code.toLowerCase()]));
  const [fleetUsage, businessUsage] = await Promise.all([
    supabaseAdmin
      .from("fleet_vehicle_documents")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .in("document_type", codes),
    supabaseAdmin
      .from("business_document_records")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("is_active", true)
      .in("document_type_code", codes)
  ]);
  if (fleetUsage.error && !fleetUsage.error.message.toLowerCase().includes("fleet_vehicle_documents")) throw new Error(fleetUsage.error.message);
  if (businessUsage.error && !businessUsage.error.message.toLowerCase().includes("business_document_records")) throw new Error(businessUsage.error.message);
  return (fleetUsage.count ?? 0) + (businessUsage.count ?? 0);
}

export async function deleteDocumentType(formData: FormData) {
  const authorization = await requirePagePermission("master_documents", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const id = required(formData.get("id"), "Document type");
    const code = required(formData.get("code"), "Document code").toUpperCase().replace(/[^A-Z0-9_]+/g, "_");

    const usage = await countDocumentUsage(companyId, code);
    if (usage > 0) {
      throw new Error(`This document type is used in ${usage} document${usage === 1 ? "" : "s"} and cannot be deleted. Mark it inactive instead.`);
    }

    const { error } = await supabaseAdmin
      .from("document_types")
      .delete()
      .eq("id", id)
      .eq("company_id", companyId);
    if (error) throw new Error(error.message);

    revalidatePath("/master/documents");
    documentsRedirect({ notice: "Document type deleted." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    documentsRedirect({ error: error instanceof Error ? error.message : "Unable to delete document type." });
  }
}

export async function updateDocumentComplianceManager(formData: FormData) {
  const authorization = await requirePagePermission("master_documents", "edit");
  const companyId = requireCompanyId(authorization);
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const complianceManagerUserId = clean(formData.get("compliance_manager_user_id"));
    const fleetManagerUserId = clean(formData.get("fleet_manager_user_id"));

    const selectedUserIds = Array.from(new Set([complianceManagerUserId, fleetManagerUserId].filter(Boolean) as string[]));
    if (selectedUserIds.length) {
      const userResult = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .in("id", selectedUserIds);
      if (userResult.error) throw new Error(userResult.error.message);
      const validIds = new Set((userResult.data ?? []).map((user) => user.id));
      if (complianceManagerUserId && !validIds.has(complianceManagerUserId)) throw new Error("Select an active user as compliance manager.");
      if (fleetManagerUserId && !validIds.has(fleetManagerUserId)) throw new Error("Select an active user as fleet manager.");
    }

    const { error } = await (supabaseAdmin.from("business_document_settings") as any).upsert({
      id: true,
      company_id: companyId,
      compliance_manager_user_id: complianceManagerUserId,
      fleet_manager_user_id: fleetManagerUserId,
      updated_at: new Date().toISOString()
    }, { onConflict: "company_id,id" });
    if (error) throw new Error(error.message);

    revalidatePath("/master/documents");
    revalidatePath("/business-documents");
    documentsRedirect({ notice: "Compliance manager updated." });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    documentsRedirect({ error: error instanceof Error ? error.message : "Unable to update compliance manager." });
  }
}
