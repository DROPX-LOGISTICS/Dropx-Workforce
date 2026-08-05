import * as XLSX from "xlsx";

export const compensationImportKinds = ["employee_salary", "contractor_remuneration"] as const;
export type CompensationImportKind = (typeof compensationImportKinds)[number];

export type CompensationImportIssue = {
  rowNumber: number | null;
  dropxId: string | null;
  message: string;
};

export type EmployeeSalaryImportRow = {
  rowNumber: number;
  dropxId: string;
  basic: number;
  hra: number;
  conveyanceLta: number;
  special: number;
  food: number;
  communication: number;
  other: number;
  pf: number;
  esi: number;
  gross: number;
  ctc: number;
  yearlyCtc: number;
};

export type ContractorRemunerationImportRow = {
  rowNumber: number;
  dropxId: string;
  remuneration: number;
};

export type ParsedCompensationImport =
  | { kind: "employee_salary"; rows: EmployeeSalaryImportRow[]; issues: CompensationImportIssue[] }
  | { kind: "contractor_remuneration"; rows: ContractorRemunerationImportRow[]; issues: CompensationImportIssue[] };

export type CompensationPerson = {
  id: string;
  dropxId: string | null;
  fullName: string;
  isActive: boolean;
};

export type CompensationMatchedRow = {
  rowNumber: number;
  dropxId: string;
  personId: string | null;
  fullName: string | null;
  amount: number;
  action: "create" | "update" | "blocked";
};

export const compensationImportHeadCodes = [
  "CTC",
  "BASIC_SALARY",
  "HRA",
  "LTA",
  "SPA",
  "FOOD_ALLOWANCE",
  "COMMUNICATION_ALLOWANCE",
  "OTA",
  "EPF_C",
  "ESI_C"
] as const;

const MAX_ROWS = 500;
const MONEY_TOLERANCE = 0.1;

export function normalizeCompensationId(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeHeader(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function money(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) / 100 : Number.NaN;
  const cleaned = String(value ?? "").trim().replace(/[₹,\s]/g, "");
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : Number.NaN;
}

function closeMoney(left: number, right: number) {
  return Math.abs(left - right) <= MONEY_TOLERANCE;
}

function workbookRows(bytes: Uint8Array) {
  const workbook = XLSX.read(bytes, { type: "array", cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("The workbook does not contain a worksheet.");
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: false });
  if (rows.length < 2) throw new Error("The workbook does not contain any compensation rows.");
  if (rows.length - 1 > MAX_ROWS) throw new Error(`A compensation upload can contain at most ${MAX_ROWS} rows.`);
  return rows;
}

function columns(header: unknown[], required: Record<string, string[]>) {
  const normalized = header.map(normalizeHeader);
  const result: Record<string, number> = {};
  for (const [field, accepted] of Object.entries(required)) {
    const index = normalized.findIndex((value) => accepted.includes(value));
    if (index < 0) throw new Error(`Required column “${accepted[0]}” is missing.`);
    result[field] = index;
  }
  return result;
}

function addNumberIssue(
  issues: CompensationImportIssue[],
  rowNumber: number,
  dropxId: string,
  label: string,
  value: number,
  positive = false
) {
  if (!Number.isFinite(value)) {
    issues.push({ rowNumber, dropxId: dropxId || null, message: `${label} must be a valid amount.` });
  } else if (positive ? value <= 0 : value < 0) {
    issues.push({ rowNumber, dropxId: dropxId || null, message: `${label} ${positive ? "must be greater than zero" : "cannot be negative"}.` });
  }
}

function duplicateIssues(rows: Array<{ rowNumber: number; dropxId: string }>, issues: CompensationImportIssue[]) {
  const seen = new Map<string, number>();
  for (const row of rows) {
    if (!row.dropxId) continue;
    const firstRow = seen.get(row.dropxId);
    if (firstRow) {
      issues.push({
        rowNumber: row.rowNumber,
        dropxId: row.dropxId,
        message: `DropX ID is duplicated in rows ${firstRow} and ${row.rowNumber}.`
      });
    } else {
      seen.set(row.dropxId, row.rowNumber);
    }
  }
}

function parseEmployeeRows(rows: unknown[][]): ParsedCompensationImport {
  const index = columns(rows[0], {
    dropxId: ["empcode", "employeecode", "dropxid"],
    basic: ["basic"],
    hra: ["hra"],
    conveyanceLta: ["conveyancelta", "lta", "conveyance"],
    special: ["special", "specialallowance"],
    food: ["food", "foodallowance"],
    communication: ["communication", "communicationallowance"],
    other: ["other", "otherallowance"],
    gross: ["total", "gross", "grosssalary"],
    pf: ["pf", "employerpf"],
    esi: ["esi", "employeresi"],
    ctc: ["ctc", "monthlyctc"],
    yearlyCtc: ["ctcyr", "yearlyctc", "annualctc"]
  });
  const issues: CompensationImportIssue[] = [];
  const parsed = rows.slice(1).flatMap<EmployeeSalaryImportRow>((row, offset) => {
    const rowNumber = offset + 2;
    const dropxId = normalizeCompensationId(row[index.dropxId]);
    const values = {
      basic: money(row[index.basic]),
      hra: money(row[index.hra]),
      conveyanceLta: money(row[index.conveyanceLta]),
      special: money(row[index.special]),
      food: money(row[index.food]),
      communication: money(row[index.communication]),
      other: money(row[index.other]),
      gross: money(row[index.gross]),
      pf: money(row[index.pf]),
      esi: money(row[index.esi]),
      ctc: money(row[index.ctc]),
      yearlyCtc: money(row[index.yearlyCtc])
    };
    const isBlank = !dropxId && Object.values(values).every((value) => value === 0);
    if (isBlank) return [];
    if (!dropxId) issues.push({ rowNumber, dropxId: null, message: "EmpCode / DropX ID is required." });
    for (const [field, label] of [
      ["basic", "Basic"], ["hra", "HRA"], ["conveyanceLta", "Conveyance/LTA"],
      ["special", "Special"], ["food", "Food"], ["communication", "Communication"],
      ["other", "Other"], ["gross", "Total"], ["pf", "PF"], ["esi", "ESI"],
      ["yearlyCtc", "CTC/YR"]
    ] as const) addNumberIssue(issues, rowNumber, dropxId, label, values[field]);
    addNumberIssue(issues, rowNumber, dropxId, "CTC", values.ctc, true);
    if (Object.values(values).every(Number.isFinite)) {
      const calculatedGross = values.basic + values.hra + values.conveyanceLta + values.special + values.food + values.communication + values.other;
      const calculatedCtc = calculatedGross + values.pf + values.esi;
      if (!closeMoney(values.gross, calculatedGross)) {
        issues.push({ rowNumber, dropxId: dropxId || null, message: `Total ${values.gross.toFixed(2)} does not match salary components ${calculatedGross.toFixed(2)}.` });
      }
      if (!closeMoney(values.ctc, calculatedCtc)) {
        issues.push({ rowNumber, dropxId: dropxId || null, message: `CTC ${values.ctc.toFixed(2)} does not match Total + PF + ESI ${calculatedCtc.toFixed(2)}.` });
      }
      if (values.yearlyCtc > 0 && !closeMoney(values.yearlyCtc, values.ctc * 12)) {
        issues.push({ rowNumber, dropxId: dropxId || null, message: `CTC/YR ${values.yearlyCtc.toFixed(2)} does not match monthly CTC × 12.` });
      }
    }
    return [{ rowNumber, dropxId, ...values }];
  });
  if (!parsed.length) throw new Error("The workbook does not contain any employee salary rows.");
  duplicateIssues(parsed, issues);
  return { kind: "employee_salary", rows: parsed, issues };
}

function parseContractorRows(rows: unknown[][]): ParsedCompensationImport {
  const index = columns(rows[0], {
    dropxId: ["dropxid", "contractorid", "empcode"],
    remuneration: ["remuneration", "baseamount", "monthlyremuneration"]
  });
  const issues: CompensationImportIssue[] = [];
  const parsed = rows.slice(1).flatMap<ContractorRemunerationImportRow>((row, offset) => {
    const rowNumber = offset + 2;
    const dropxId = normalizeCompensationId(row[index.dropxId]);
    const remuneration = money(row[index.remuneration]);
    if (!dropxId && remuneration === 0) return [];
    if (!dropxId) issues.push({ rowNumber, dropxId: null, message: "DropX ID is required." });
    addNumberIssue(issues, rowNumber, dropxId, "Remuneration", remuneration, true);
    return [{ rowNumber, dropxId, remuneration }];
  });
  if (!parsed.length) throw new Error("The workbook does not contain any contractor remuneration rows.");
  duplicateIssues(parsed, issues);
  return { kind: "contractor_remuneration", rows: parsed, issues };
}

export function parseCompensationWorkbook(bytes: Uint8Array, kind: CompensationImportKind): ParsedCompensationImport {
  const rows = workbookRows(bytes);
  return kind === "employee_salary" ? parseEmployeeRows(rows) : parseContractorRows(rows);
}

export function matchCompensationRows(
  parsed: ParsedCompensationImport,
  people: CompensationPerson[],
  alreadyConfiguredIds: Set<string> = new Set()
) {
  const issues: CompensationImportIssue[] = [...parsed.issues];
  const peopleByCode = new Map<string, CompensationPerson[]>();
  for (const person of people) {
    const code = normalizeCompensationId(person.dropxId);
    if (!code) continue;
    peopleByCode.set(code, [...(peopleByCode.get(code) ?? []), person]);
  }
  const sourceRows: Array<{ rowNumber: number; dropxId: string; amount: number }> = parsed.kind === "employee_salary"
    ? parsed.rows.map((row) => ({ rowNumber: row.rowNumber, dropxId: row.dropxId, amount: row.ctc }))
    : parsed.rows.map((row) => ({ rowNumber: row.rowNumber, dropxId: row.dropxId, amount: row.remuneration }));
  const matches = sourceRows.map<CompensationMatchedRow>((row) => {
    const candidates = peopleByCode.get(row.dropxId) ?? [];
    const amount = row.amount;
    if (candidates.length !== 1) {
      issues.push({
        rowNumber: row.rowNumber,
        dropxId: row.dropxId || null,
        message: candidates.length ? "More than one company record has this DropX ID." : "No company record matches this DropX ID."
      });
      return { rowNumber: row.rowNumber, dropxId: row.dropxId, personId: null, fullName: null, amount, action: "blocked" };
    }
    const person = candidates[0];
    if (!person.isActive) {
      issues.push({ rowNumber: row.rowNumber, dropxId: row.dropxId, message: `${person.fullName} is inactive.` });
    }
    return {
      rowNumber: row.rowNumber,
      dropxId: row.dropxId,
      personId: person.id,
      fullName: person.fullName,
      amount,
      action: person.isActive ? (alreadyConfiguredIds.has(person.id) ? "update" : "create") : "blocked"
    };
  });
  return { matches, issues, canCommit: issues.length === 0 };
}
