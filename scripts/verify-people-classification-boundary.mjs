import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260831224000_people_worker_classification_reconciliation.sql", import.meta.url), "utf8");
const blockerRepair = readFileSync(new URL("../supabase/migrations/20260831225000_resolve_people_classification_blockers.sql", import.meta.url), "utf8");

const required = [
  "begin;",
  "create or replace function public.reclassify_people_worker",
  "create or replace function public.people_expected_worker_type",
  "PF or ESI evidence",
  "null::public.contractors",
  "null::public.employees",
  "to_jsonb(source_employee)",
  "to_jsonb(source_contractor)",
  "same_uuid_preserved",
  "update public.hr_engagements",
  "hr_worker_classification_reconciliations",
  "array['employees','contractors']",
  "'hr_payroll_run_people'",
  "'D0785'",
  "exception when others",
  "commit;"
];

const forbidden = [
  "insert into public.workforce",
  "update public.workforce",
  "delete from public.workforce",
  "insert into public.vendors",
  "update public.vendors",
  "insert into public.workers",
  "update public.workers",
  "insert into public.field_executives",
  "update public.field_executives",
  "set_designation_register_route"
];

const failures = [
  ...required.filter((token) => !migration.includes(token)).map((token) => `missing ${token}`),
  ...forbidden.filter((token) => migration.toLowerCase().includes(token)).map((token) => `forbidden ${token}`),
  ...[
    "reclassify_people_worker_core",
    "mob_app_device_tokens",
    "contractors_normalize_lifecycle_compat",
    "public.people_worker_classification_audit",
    "exception when others"
  ].filter((token) => !blockerRepair.includes(token)).map((token) => `missing blocker repair ${token}`),
  ...forbidden.filter((token) => blockerRepair.toLowerCase().includes(token)).map((token) => `forbidden blocker repair ${token}`)
];

if (failures.length) {
  console.error(`People classification boundary failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  process.exit(1);
}

console.log("People statutory classification correction is isolated from Workforce/Vendor/Helper registries and preserves payroll snapshots.");
