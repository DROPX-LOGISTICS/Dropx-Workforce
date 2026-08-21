"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePagePermission, type AuthorizationContext } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

const CONDITIONS = new Set(["new", "good", "fair", "damaged", "unusable"]);
const STATUSES = new Set(["available", "issued", "in_audit", "in_repair", "damaged", "lost", "retired", "disposed"]);

function clean(formData: FormData, key: string, required = true) {
  const result = String(formData.get(key) ?? "").trim();
  if (required && !result) throw new Error(`${key.replaceAll("_", " ")} is required.`);
  return result || null;
}

function actor(auth: AuthorizationContext) {
  return auth.fullName || auth.email || "Dashboard user";
}

async function assertScopedLocation(auth: AuthorizationContext, companyId: string, locationId: string | null) {
  if (!locationId) return;
  if (!auth.hasAllLocationAccess && !auth.locationScopeIds.includes(locationId)) throw new Error("You do not have access to this asset location.");
  const result = await supabaseAdmin!.from("stations").select("id").eq("company_id", companyId).eq("id", locationId).eq("is_active", true).maybeSingle();
  if (!result.data) throw new Error("Asset location is unavailable.");
}

async function uploadEvidence(params: { auth: AuthorizationContext; companyId: string; assetId: string; assignmentId?: string | null; auditItemId?: string | null; file: File | null; type: string }) {
  if (!params.file || params.file.size === 0) return;
  if (!params.file.type.startsWith("image/") && params.file.type !== "application/pdf") throw new Error("Evidence must be an image or PDF.");
  if (params.file.size > 10 * 1024 * 1024) throw new Error("Evidence must be 10 MB or smaller.");
  const safeName = params.file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const path = `${params.companyId}/${params.assetId}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  const uploaded = await supabaseAdmin!.storage.from("asset-evidence").upload(path, await params.file.arrayBuffer(), { contentType: params.file.type, upsert: false });
  if (uploaded.error) throw new Error(uploaded.error.message);
  const saved = await supabaseAdmin!.from("asset_attachments").insert({
    company_id: params.companyId,
    asset_id: params.assetId,
    assignment_id: params.assignmentId ?? null,
    audit_item_id: params.auditItemId ?? null,
    attachment_type: params.type,
    file_name: params.file.name,
    content_type: params.file.type,
    file_size: params.file.size,
    storage_path: path,
    uploaded_by: params.auth.userId
  });
  if (saved.error) throw new Error(saved.error.message);
}

function finish(tab: string, notice: string) {
  revalidatePath("/assets");
  revalidatePath("/people/all");
  redirect(`/assets?tab=${tab}&notice=${encodeURIComponent(notice)}`);
}

export async function createAsset(formData: FormData) {
  const auth = await requirePagePermission("assets", "add");
  const companyId = requireCompanyId(auth);
  if (!supabaseAdmin) throw new Error("Database connection is unavailable.");
  const typeId = clean(formData, "asset_type_id")!;
  const locationId = clean(formData, "location_id", false);
  await assertScopedLocation(auth, companyId, locationId);
  const typeResult = await supabaseAdmin.from("asset_types").select("id,asset_code_prefix,requires_serial_number").eq("company_id", companyId).eq("id", typeId).eq("is_active", true).maybeSingle();
  if (!typeResult.data) throw new Error("Asset type is unavailable.");
  const serialNumber = clean(formData, "serial_number", false);
  if (typeResult.data.requires_serial_number && !serialNumber) throw new Error("Serial number is required for this asset type.");
  let assetCode = clean(formData, "asset_code", false)?.toUpperCase();
  if (!assetCode) {
    const generated = await supabaseAdmin.rpc("asset_next_code", { p_company_id: companyId, p_prefix: typeResult.data.asset_code_prefix });
    if (generated.error) throw new Error(generated.error.message);
    assetCode = String(generated.data);
  }
  const purchaseValue = clean(formData, "purchase_value", false);
  const inserted = await supabaseAdmin.from("assets").insert({
    company_id: companyId,
    asset_type_id: typeId,
    asset_code: assetCode,
    barcode_value: assetCode,
    location_id: locationId,
    manufacturer: clean(formData, "manufacturer", false),
    model: clean(formData, "model", false),
    serial_number: serialNumber,
    purchase_order_number: clean(formData, "purchase_order_number", false),
    invoice_number: clean(formData, "invoice_number", false),
    purchase_date: clean(formData, "purchase_date", false),
    purchase_value: purchaseValue ? Number(purchaseValue) : null,
    warranty_expiry_date: clean(formData, "warranty_expiry_date", false),
    vendor_name: clean(formData, "vendor_name", false),
    condition: clean(formData, "condition") ?? "good",
    notes: clean(formData, "notes", false),
    created_by: auth.userId,
    updated_by: auth.userId
  }).select("id").single();
  if (inserted.error) throw new Error(inserted.error.message);
  await supabaseAdmin.from("asset_events").insert({ company_id: companyId, asset_id: inserted.data.id, event_type: "created", to_status: "available", to_condition: clean(formData, "condition") ?? "good", to_location_id: locationId, actor_user_id: auth.userId, actor_name: actor(auth) });
  await uploadEvidence({ auth, companyId, assetId: inserted.data.id, file: formData.get("evidence") as File | null, type: "purchase_document" });
  finish("inventory", `Asset ${assetCode} created.`);
}

export async function updateAsset(formData: FormData) {
  const auth = await requirePagePermission("assets", "edit");
  const companyId = requireCompanyId(auth);
  if (!supabaseAdmin) throw new Error("Database connection is unavailable.");
  const id = clean(formData, "asset_id")!;
  const locationId = clean(formData, "location_id", false);
  await assertScopedLocation(auth, companyId, locationId);
  const existing = await supabaseAdmin.from("assets").select("id,status,condition,location_id").eq("company_id", companyId).eq("id", id).maybeSingle();
  if (!existing.data) throw new Error("Asset was not found.");
  const status = clean(formData, "status")!;
  const condition = clean(formData, "condition")!;
  if (!STATUSES.has(status) || !CONDITIONS.has(condition)) throw new Error("Invalid asset status or condition.");
  if (existing.data.status === "issued" && status !== "issued") throw new Error("Return or replace the active assignment instead of changing an issued asset directly.");
  const result = await supabaseAdmin.from("assets").update({ status, condition, location_id: locationId, notes: clean(formData, "notes", false), updated_by: auth.userId, updated_at: new Date().toISOString() }).eq("company_id", companyId).eq("id", id);
  if (result.error) throw new Error(result.error.message);
  await supabaseAdmin.from("asset_events").insert({ company_id: companyId, asset_id: id, event_type: "updated", from_status: existing.data.status, to_status: status, from_condition: existing.data.condition, to_condition: condition, from_location_id: existing.data.location_id, to_location_id: locationId, reason: clean(formData, "notes", false), actor_user_id: auth.userId, actor_name: actor(auth) });
  await uploadEvidence({ auth, companyId, assetId: id, file: formData.get("evidence") as File | null, type: condition === "damaged" || condition === "unusable" ? "damage" : "asset_update" });
  finish("inventory", "Asset updated and logged.");
}

export async function issueAsset(formData: FormData) {
  const auth = await requirePagePermission("assets", "edit");
  const companyId = requireCompanyId(auth);
  if (!supabaseAdmin) throw new Error("Database connection is unavailable.");
  const assetId = clean(formData, "asset_id")!;
  const employeeId = clean(formData, "employee_id")!;
  const employee = await supabaseAdmin.from("employees").select("id,location_id").eq("company_id", companyId).eq("id", employeeId).eq("is_active", true).maybeSingle();
  if (!employee.data) throw new Error("Employee is unavailable.");
  await assertScopedLocation(auth, companyId, employee.data.location_id);
  const result = await supabaseAdmin.rpc("asset_issue", { p_company_id: companyId, p_asset_id: assetId, p_employee_id: employeeId, p_location_id: employee.data.location_id, p_expected_return_date: clean(formData, "expected_return_date", false), p_issue_condition: clean(formData, "issue_condition") ?? "good", p_notes: clean(formData, "notes", false), p_actor: auth.userId, p_actor_name: actor(auth) });
  if (result.error) throw new Error(result.error.message);
  await uploadEvidence({ auth, companyId, assetId, assignmentId: String(result.data), file: formData.get("evidence") as File | null, type: "issue_acknowledgement" });
  finish("assignments", "Asset issued to employee.");
}

export async function returnAsset(formData: FormData) {
  const auth = await requirePagePermission("assets", "edit");
  const companyId = requireCompanyId(auth);
  if (!supabaseAdmin) throw new Error("Database connection is unavailable.");
  const assignmentId = clean(formData, "assignment_id")!;
  const assignment = await supabaseAdmin.from("asset_assignments").select("asset_id,location_id").eq("company_id", companyId).eq("id", assignmentId).eq("status", "issued").maybeSingle();
  if (!assignment.data) throw new Error("Active assignment was not found.");
  await assertScopedLocation(auth, companyId, assignment.data.location_id);
  const result = await supabaseAdmin.rpc("asset_return", { p_company_id: companyId, p_assignment_id: assignmentId, p_return_condition: clean(formData, "return_condition") ?? "good", p_asset_status: clean(formData, "asset_status") ?? "available", p_notes: clean(formData, "notes", false), p_actor: auth.userId, p_actor_name: actor(auth) });
  if (result.error) throw new Error(result.error.message);
  await uploadEvidence({ auth, companyId, assetId: assignment.data.asset_id, assignmentId, file: formData.get("evidence") as File | null, type: "return_evidence" });
  finish("assignments", "Asset return recorded.");
}

export async function transferAsset(formData: FormData) {
  const auth = await requirePagePermission("assets", "edit");
  const companyId = requireCompanyId(auth);
  if (!supabaseAdmin) throw new Error("Database connection is unavailable.");
  const employeeId = clean(formData, "employee_id")!;
  const employee = await supabaseAdmin.from("employees").select("location_id").eq("company_id", companyId).eq("id", employeeId).eq("is_active", true).maybeSingle();
  if (!employee.data) throw new Error("New employee is unavailable.");
  await assertScopedLocation(auth, companyId, employee.data.location_id);
  const result = await supabaseAdmin.rpc("asset_transfer", { p_company_id: companyId, p_assignment_id: clean(formData, "assignment_id"), p_employee_id: employeeId, p_location_id: employee.data.location_id, p_notes: clean(formData, "notes", false), p_actor: auth.userId, p_actor_name: actor(auth) });
  if (result.error) throw new Error(result.error.message);
  finish("assignments", "Asset transferred with a complete custody trail.");
}

export async function replaceAsset(formData: FormData) {
  const auth = await requirePagePermission("assets", "edit");
  const companyId = requireCompanyId(auth);
  if (!supabaseAdmin) throw new Error("Database connection is unavailable.");
  const result = await supabaseAdmin.rpc("asset_replace", { p_company_id: companyId, p_assignment_id: clean(formData, "assignment_id"), p_replacement_asset_id: clean(formData, "replacement_asset_id"), p_old_asset_status: clean(formData, "old_asset_status") ?? "in_repair", p_old_condition: clean(formData, "old_condition") ?? "damaged", p_notes: clean(formData, "notes", false), p_actor: auth.userId, p_actor_name: actor(auth) });
  if (result.error) throw new Error(result.error.message);
  finish("assignments", "Replacement issued and both asset histories updated.");
}

export async function createAudit(formData: FormData) {
  const auth = await requirePagePermission("assets", "add");
  const companyId = requireCompanyId(auth);
  if (!supabaseAdmin) throw new Error("Database connection is unavailable.");
  const locationId = clean(formData, "location_id", false);
  const scopeType = locationId ? "location" : "company";
  if (scopeType === "company" && !auth.hasAllLocationAccess) throw new Error("Company-wide audits require all-location access.");
  await assertScopedLocation(auth, companyId, locationId);
  const generated = await supabaseAdmin.rpc("asset_next_code", { p_company_id: companyId, p_prefix: "AUD" });
  if (generated.error) throw new Error(generated.error.message);
  let expected = supabaseAdmin.from("assets").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("is_active", true).neq("status", "disposed");
  if (locationId) expected = expected.eq("location_id", locationId);
  const countResult = await expected;
  const inserted = await supabaseAdmin.from("asset_audit_sessions").insert({ company_id: companyId, audit_number: generated.data, scope_type: scopeType, location_id: locationId, title: clean(formData, "title"), scheduled_for: clean(formData, "scheduled_for", false), status: "in_progress", expected_count: countResult.count ?? 0, started_by: auth.userId, started_at: new Date().toISOString(), notes: clean(formData, "notes", false), created_by: auth.userId }).select("id").single();
  if (inserted.error) throw new Error(inserted.error.message);
  revalidatePath("/assets");
  redirect(`/assets?tab=audits&audit=${inserted.data.id}&notice=${encodeURIComponent("Audit started. Scan the first asset.")}`);
}

export async function recordAuditItem(formData: FormData) {
  const auth = await requirePagePermission("assets", "edit");
  const companyId = requireCompanyId(auth);
  if (!supabaseAdmin) throw new Error("Database connection is unavailable.");
  const auditId = clean(formData, "audit_id")!;
  const method = clean(formData, "capture_method")!;
  const result = await supabaseAdmin.rpc("asset_record_audit_item", { p_company_id: companyId, p_session_id: auditId, p_scanned_code: clean(formData, "scanned_code"), p_capture_method: method, p_observed_location_id: clean(formData, "observed_location_id", false), p_observed_status: clean(formData, "observed_status", false), p_observed_condition: clean(formData, "observed_condition", false), p_manual_reason: clean(formData, "manual_reason", false), p_notes: clean(formData, "notes", false), p_actor: auth.userId, p_actor_name: actor(auth) });
  if (result.error) throw new Error(result.error.message);
  const item = await supabaseAdmin.from("asset_audit_items").select("asset_id").eq("company_id", companyId).eq("id", result.data).single();
  if (item.data?.asset_id) await uploadEvidence({ auth, companyId, assetId: item.data.asset_id, auditItemId: String(result.data), file: formData.get("evidence") as File | null, type: "audit_evidence" });
  revalidatePath("/assets");
  redirect(`/assets?tab=audits&audit=${auditId}&notice=${encodeURIComponent("Audit observation saved.")}`);
}

export async function completeAudit(formData: FormData) {
  const auth = await requirePagePermission("assets", "edit");
  const companyId = requireCompanyId(auth);
  if (!supabaseAdmin) throw new Error("Database connection is unavailable.");
  const auditId = clean(formData, "audit_id")!;
  const result = await supabaseAdmin.rpc("asset_complete_audit", { p_company_id: companyId, p_session_id: auditId, p_actor: auth.userId });
  if (result.error) throw new Error(result.error.message);
  finish("audits", "Audit completed. Missing and damaged counts are finalized.");
}
