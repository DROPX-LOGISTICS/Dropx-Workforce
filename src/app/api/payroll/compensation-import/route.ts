import { createHash } from "node:crypto";
import { getAuthorization, isCompanyOwner } from "@/lib/authorization";
import {
  compensationImportHeadCodes,
  compensationImportKinds,
  matchCompensationRows,
  parseCompensationWorkbook,
  type CompensationImportIssue,
  type CompensationImportKind,
  type CompensationPerson,
  type ParsedCompensationImport
} from "@/lib/compensation-import";
import { requireCompanyId } from "@/lib/company-scope";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FILE_PATTERN = /\.(xlsx|xls|csv)$/i;

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function validDate(value: string) {
  return DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function isKind(value: string): value is CompensationImportKind {
  return compensationImportKinds.includes(value as CompensationImportKind);
}

function relation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

async function loadPeople(companyId: string, kind: CompensationImportKind): Promise<CompensationPerson[]> {
  if (!supabaseAdmin) return [];
  const pageSize = 1000;
  const people: CompensationPerson[] = [];
  let offset = 0;
  if (kind === "employee_salary") {
    while (true) {
      const result = await supabaseAdmin
        .from("employees")
        .select("id, employee_code, full_name, is_active")
        .eq("company_id", companyId)
        .order("id")
        .range(offset, offset + pageSize - 1);
      if (result.error) throw new Error(result.error.message);
      const page = result.data ?? [];
      people.push(...page.map((person) => ({
        id: person.id,
        dropxId: person.employee_code,
        fullName: person.full_name,
        isActive: Boolean(person.is_active)
      })));
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    return people;
  }
  while (true) {
    const result = await supabaseAdmin
      .from("contractors")
      .select("id, dropx_id, full_name, is_active")
      .eq("company_id", companyId)
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (result.error) throw new Error(result.error.message);
    const page = result.data ?? [];
    people.push(...page.map((person) => ({
      id: person.id,
      dropxId: person.dropx_id,
      fullName: person.full_name,
      isActive: Boolean(person.is_active)
    })));
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return people;
}

async function loadConfiguredIds(companyId: string, kind: CompensationImportKind, personIds: string[]) {
  const configured = new Set<string>();
  if (!supabaseAdmin || !personIds.length) return configured;
  for (let index = 0; index < personIds.length; index += 100) {
    const chunk = personIds.slice(index, index + 100);
    if (kind === "employee_salary") {
      const result = await supabaseAdmin
        .from("hr_employee_salary_assignments")
        .select("employee_id")
        .eq("company_id", companyId)
        .is("effective_to", null)
        .in("employee_id", chunk);
      if (result.error) throw new Error(result.error.message);
      (result.data ?? []).forEach((row) => configured.add(row.employee_id));
    } else {
      const result = await supabaseAdmin
        .from("hr_contractor_pay_profiles")
        .select("contractor_id")
        .eq("company_id", companyId)
        .is("effective_to", null)
        .in("contractor_id", chunk);
      if (result.error) throw new Error(result.error.message);
      (result.data ?? []).forEach((row) => configured.add(row.contractor_id));
    }
  }
  return configured;
}

async function employeeConfigurationIssues(companyId: string): Promise<CompensationImportIssue[]> {
  if (!supabaseAdmin) return [{ rowNumber: null, dropxId: null, message: "Database configuration is unavailable." }];
  const configuration = await supabaseAdmin
    .from("hr_salary_configurations")
    .select("id, code, name, is_active")
    .eq("company_id", companyId)
    .eq("code", "SALARY_IMPORT")
    .eq("is_active", true)
    .maybeSingle();
  if (configuration.error) throw new Error(configuration.error.message);
  if (!configuration.data) {
    return [{ rowNumber: null, dropxId: null, message: "The Salary Import configuration is not available in Payroll Master." }];
  }
  const items = await supabaseAdmin
    .from("hr_salary_configuration_items")
    .select("is_enabled, hr_payroll_heads(code)")
    .eq("company_id", companyId)
    .eq("configuration_id", configuration.data.id)
    .eq("is_enabled", true);
  if (items.error) throw new Error(items.error.message);
  const codes = new Set((items.data ?? []).map((item) => String(relation(item.hr_payroll_heads)?.code ?? "").toUpperCase()));
  const missing = compensationImportHeadCodes.filter((code) => !codes.has(code));
  return missing.length
    ? [{ rowNumber: null, dropxId: null, message: `Salary Import is missing Payroll Master components: ${missing.join(", ")}.` }]
    : [];
}

function rpcRows(parsed: ParsedCompensationImport) {
  if (parsed.kind === "employee_salary") {
    return parsed.rows.map((row) => ({
      dropx_id: row.dropxId,
      basic: row.basic,
      hra: row.hra,
      conveyance_lta: row.conveyanceLta,
      special: row.special,
      food: row.food,
      communication: row.communication,
      other: row.other,
      pf: row.pf,
      esi: row.esi,
      gross: row.gross,
      ctc: row.ctc,
      yearly_ctc: row.yearlyCtc
    }));
  }
  return parsed.rows.map((row) => ({ dropx_id: row.dropxId, remuneration: row.remuneration }));
}

export async function POST(request: Request) {
  try {
    const authorization = await getAuthorization();
    if (!authorization) return errorResponse("Sign in to use compensation imports.", 401);
    if (!isCompanyOwner(authorization)) return errorResponse("Only an owner can preview or apply compensation imports.", 403);
    if (!supabaseAdmin) return errorResponse("Database configuration is unavailable.", 503);
    const companyId = requireCompanyId(authorization);
    const form = await request.formData();
    const kindValue = String(form.get("kind") ?? "");
    const mode = String(form.get("mode") ?? "preview");
    const effectiveFrom = String(form.get("effective_from") ?? "");
    const file = form.get("file");
    if (!isKind(kindValue)) return errorResponse("Select a valid compensation import type.", 400);
    if (!validDate(effectiveFrom)) return errorResponse("Select a valid effective date.", 400);
    if (mode !== "preview" && mode !== "commit") return errorResponse("Select preview or commit mode.", 400);
    if (!(file instanceof File) || !file.name || !file.size) return errorResponse("Choose a compensation workbook.", 400);
    if (!FILE_PATTERN.test(file.name)) return errorResponse("Upload an Excel or CSV workbook.", 400);
    if (file.size > MAX_FILE_BYTES) return errorResponse("The workbook must be 3 MB or smaller.", 413);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileSha256 = createHash("sha256").update(bytes).digest("hex");
    const parsed = parseCompensationWorkbook(bytes, kindValue);
    const people = await loadPeople(companyId, kindValue);
    const initialMatch = matchCompensationRows(parsed, people);
    const personIds = initialMatch.matches.flatMap((row) => row.personId ? [row.personId] : []);
    const configuredIds = await loadConfiguredIds(companyId, kindValue, personIds);
    const matched = matchCompensationRows(parsed, people, configuredIds);
    const issues = [...matched.issues];

    if (kindValue === "employee_salary") issues.push(...await employeeConfigurationIssues(companyId));

    const priorImport = await supabaseAdmin
      .from("hr_compensation_imports")
      .select("id, created_at, row_count")
      .eq("company_id", companyId)
      .eq("import_kind", kindValue)
      .eq("file_sha256", fileSha256)
      .eq("effective_from", effectiveFrom)
      .maybeSingle();
    if (priorImport.error) throw new Error(priorImport.error.message);
    if (priorImport.data) {
      issues.push({ rowNumber: null, dropxId: null, message: "This exact workbook was already imported for the selected effective date." });
    }

    const preview = {
      kind: kindValue,
      fileName: file.name,
      fileSha256,
      effectiveFrom,
      totalRows: parsed.rows.length,
      matchedRows: matched.matches.filter((row) => row.personId).length,
      createRows: matched.matches.filter((row) => row.action === "create").length,
      updateRows: matched.matches.filter((row) => row.action === "update").length,
      canCommit: issues.length === 0,
      issues,
      rows: matched.matches,
      matchRule: kindValue === "employee_salary" ? "employees.employee_code only" : "contractors.dropx_id only"
    };

    if (mode === "preview") {
      return Response.json(preview, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (issues.length) {
      return Response.json({ ...preview, error: "Resolve every blocked row and preview the workbook again before importing." }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
    }

    const applied = await supabaseAdmin.rpc("hr_apply_compensation_import", {
      p_company_id: companyId,
      p_import_kind: kindValue,
      p_effective_from: effectiveFrom,
      p_file_name: file.name.slice(0, 240),
      p_file_sha256: fileSha256,
      p_rows: rpcRows(parsed),
      p_actor_user_id: authorization.userId
    });
    if (applied.error) {
      const conflict = /already imported|duplicate/i.test(applied.error.message);
      return errorResponse(applied.error.message, conflict ? 409 : 400);
    }
    return Response.json({
      ...preview,
      canCommit: false,
      importId: applied.data,
      message: kindValue === "employee_salary"
        ? `${parsed.rows.length} employee salary records were imported.`
        : `${parsed.rows.length} contractor remuneration records were imported.`
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Unable to process the compensation workbook.", 500);
  }
}
