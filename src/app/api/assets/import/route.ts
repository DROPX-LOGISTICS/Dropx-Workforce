import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getAuthorization, hasPermission } from "@/lib/authorization";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type SheetRow = Record<string, string | number | boolean | null | undefined>;
const text = (row: SheetRow, key: string) => String(row[key] ?? "").trim();
const normalizedCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9_-]/g, "_");

function isoDate(value: string | number | boolean | null | undefined) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}` : null;
  }
  const date = new Date(String(value));
  return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
}

export async function POST(request: NextRequest) {
  const auth = await getAuthorization();
  if (!auth?.companyId || !hasPermission(auth, "assets", "add") || !supabaseAdmin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.redirect(new URL("/assets?tab=imports&notice=Select+a+file", request.url), 303);
  if (file.size > 10 * 1024 * 1024) return NextResponse.redirect(new URL("/assets?tab=imports&notice=File+must+be+10+MB+or+smaller", request.url), 303);

  const batch = await supabaseAdmin.from("asset_import_batches").insert({ company_id: auth.companyId, file_name: file.name, file_size: file.size, uploaded_by: auth.userId }).select("id").single();
  if (batch.error) return NextResponse.json({ error: batch.error.message }, { status: 500 });
  try {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<SheetRow>(worksheet, { defval: "" });
    if (rows.length > 5000) throw new Error("One upload can contain a maximum of 5,000 assets.");
    const [typeResult, stationResult] = await Promise.all([
      supabaseAdmin.from("asset_types").select("id,code,asset_code_prefix,requires_serial_number").eq("company_id", auth.companyId).eq("is_active", true),
      supabaseAdmin.from("stations").select("id,station_code").eq("company_id", auth.companyId).eq("is_active", true)
    ]);
    if (typeResult.error || stationResult.error) throw new Error(typeResult.error?.message ?? stationResult.error?.message);
    const types = new Map((typeResult.data ?? []).map((item) => [item.code.toUpperCase(), item]));
    const stations = new Map((stationResult.data ?? []).map((item) => [item.station_code.toUpperCase(), item]));
    const results: Array<Record<string, unknown>> = [];
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      try {
        const type = types.get(normalizedCode(text(row, "Type Code")));
        if (!type) throw new Error("Unknown or inactive Type Code");
        const locationCode = normalizedCode(text(row, "Location Code"));
        const location = locationCode ? stations.get(locationCode) : null;
        if (locationCode && !location) throw new Error("Unknown or inactive Location Code");
        if (location && !auth.hasAllLocationAccess && !auth.locationScopeIds.includes(location.id)) throw new Error("Location is outside your access scope");
        const serial = text(row, "Serial Number") || null;
        if (type.requires_serial_number && !serial) throw new Error("Serial Number is required for this type");
        let assetCode = normalizedCode(text(row, "Asset Code (optional)"));
        if (!assetCode) {
          const generated = await supabaseAdmin.rpc("asset_next_code", { p_company_id: auth.companyId, p_prefix: type.asset_code_prefix });
          if (generated.error) throw new Error(generated.error.message);
          assetCode = String(generated.data);
        }
        const condition = (text(row, "Condition") || "good").toLowerCase();
        if (!["new", "good", "fair", "damaged", "unusable"].includes(condition)) throw new Error("Condition must be new, good, fair, damaged or unusable");
        const purchaseValue = text(row, "Purchase Value");
        const insert = await supabaseAdmin.from("assets").insert({ company_id: auth.companyId, asset_type_id: type.id, asset_code: assetCode, barcode_value: assetCode, location_id: location?.id ?? null, manufacturer: text(row, "Manufacturer") || null, model: text(row, "Model") || null, serial_number: serial, purchase_date: isoDate(row["Purchase Date"]), purchase_value: purchaseValue ? Number(purchaseValue) : null, warranty_expiry_date: isoDate(row["Warranty Expiry"]), vendor_name: text(row, "Vendor") || null, purchase_order_number: text(row, "PO Number") || null, invoice_number: text(row, "Invoice Number") || null, condition, notes: text(row, "Notes") || null, created_by: auth.userId, updated_by: auth.userId }).select("id").single();
        if (insert.error) throw new Error(insert.error.message);
        await supabaseAdmin.from("asset_events").insert({ company_id: auth.companyId, asset_id: insert.data.id, event_type: "bulk_imported", to_status: "available", to_condition: condition, to_location_id: location?.id ?? null, actor_user_id: auth.userId, actor_name: auth.fullName || auth.email || "Dashboard user", metadata: { batch_id: batch.data.id, source_row: index + 2 } });
        results.push({ company_id: auth.companyId, batch_id: batch.data.id, row_number: index + 2, asset_id: insert.data.id, outcome: "imported", raw_data: row });
        imported += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to import row";
        const duplicate = message.toLowerCase().includes("duplicate");
        results.push({ company_id: auth.companyId, batch_id: batch.data.id, row_number: index + 2, outcome: duplicate ? "skipped" : "error", error_message: message.slice(0, 1000), raw_data: row });
        if (duplicate) skipped += 1; else errors += 1;
      }
    }
    for (let index = 0; index < results.length; index += 500) {
      const saved = await supabaseAdmin.from("asset_import_rows").insert(results.slice(index, index + 500));
      if (saved.error) throw new Error(saved.error.message);
    }
    await supabaseAdmin.from("asset_import_batches").update({ status: errors || skipped ? "completed_with_errors" : "completed", total_rows: rows.length, imported_rows: imported, skipped_rows: skipped, error_rows: errors, summary: { imported, skipped, errors }, completed_at: new Date().toISOString() }).eq("company_id", auth.companyId).eq("id", batch.data.id);
    return NextResponse.redirect(new URL(`/assets?tab=imports&notice=${encodeURIComponent(`${imported} assets imported, ${skipped} skipped, ${errors} errors.`)}`, request.url), 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed";
    await supabaseAdmin.from("asset_import_batches").update({ status: "failed", summary: { error: message }, completed_at: new Date().toISOString() }).eq("company_id", auth.companyId).eq("id", batch.data.id);
    return NextResponse.redirect(new URL(`/assets?tab=imports&notice=${encodeURIComponent(message)}`, request.url), 303);
  }
}
