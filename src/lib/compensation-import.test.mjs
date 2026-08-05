import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  matchCompensationRows,
  normalizeCompensationId,
  parseCompensationWorkbook
} from "./compensation-import.ts";

function workbookBytes(rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  return new Uint8Array(XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }));
}

test("normalizes DropX IDs without using designation or name", () => {
  assert.equal(normalizeCompensationId("  dropx522 "), "DROPX522");
});
test("parses employee salary by EmpCode and validates the salary totals", () => {
  const parsed = parseCompensationWorkbook(workbookBytes([
    ["EmpCode", "Name", "Designation", "Basic", "HRA", "Conveyance/LTA", "Special", "Food", "Communication", "Other", "Total", "PF", "ESI", "CTC", "CTC/YR"],
    ["dropx522", "Wrong display name", "Ignored designation", 10000, 5000, 1600, 1000, 500, 400, 1500, 20000, 1200, 0, 21200, 254400]
  ]), "employee_salary");
  assert.equal(parsed.kind, "employee_salary");
  assert.equal(parsed.rows[0].dropxId, "DROPX522");
  assert.equal(parsed.rows[0].ctc, 21200);
  assert.deepEqual(parsed.issues, []);
});

test("blocks a duplicate DropX ID in the same file", () => {
  const parsed = parseCompensationWorkbook(workbookBytes([
    ["DropX ID", "Full name", "Location", "Remuneration"],
    ["H1001", "One", "ERSE", 15000],
    ["h1001", "Different", "GNTF", 16000]
  ]), "contractor_remuneration");
  assert.equal(parsed.issues.length, 1);
  assert.match(parsed.issues[0].message, /duplicated/i);
});

test("matches only the DropX ID and reports create or update", () => {
  const parsed = parseCompensationWorkbook(workbookBytes([
    ["DropX ID", "Full name", "Location", "Remuneration"],
    ["H1001", "Spreadsheet name is ignored", "Wrong location", 15000]
  ]), "contractor_remuneration");
  const matched = matchCompensationRows(parsed, [{ id: "person-1", dropxId: "h1001", fullName: "Database Name", isActive: true }], new Set(["person-1"]));
  assert.equal(matched.canCommit, true);
  assert.equal(matched.matches[0].fullName, "Database Name");
  assert.equal(matched.matches[0].action, "update");
});

test("blocks missing, duplicate database, and inactive identities", () => {
  const parsed = parseCompensationWorkbook(workbookBytes([
    ["DropX ID", "Remuneration"],
    ["H1001", 15000],
    ["H2002", 12000],
    ["H3003", 11000]
  ]), "contractor_remuneration");
  const result = matchCompensationRows(parsed, [
    { id: "a", dropxId: "H1001", fullName: "Duplicate one", isActive: true },
    { id: "b", dropxId: "h1001", fullName: "Duplicate two", isActive: true },
    { id: "c", dropxId: "H2002", fullName: "Inactive", isActive: false }
  ]);
  assert.equal(result.canCommit, false);
  assert.equal(result.issues.length, 3);
  assert.ok(result.matches.every((row) => row.action === "blocked"));
});
