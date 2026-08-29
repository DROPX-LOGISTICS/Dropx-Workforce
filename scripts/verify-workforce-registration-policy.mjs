import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
const form = read("src/components/designation-form.tsx");
const actions = read("src/app/master/designations/actions.ts");
const connectAuth = read("apps/connect/src/lib/connect-auth.ts");
const connectRoute = read("apps/connect/app/api/connect/field-executive-profile/route.ts");
const policy = read("apps/connect/src/lib/workforce-registration-policy.ts");
const migration = read("supabase/migrations/20260829020000_workforce_registration_policy_master.sql");

const checks = [
  [form.includes('name="registration_category_code"'), "Designation Master must expose a registration policy."],
  [actions.includes("registration_category_code: registrationCategory"), "Designation actions must persist the selected registration policy."],
  [migration.includes("designations_registration_category_fkey") && migration.includes("designations_registration_category_membership_check"), "The database must enforce registration-policy category membership."],
  [policy.includes('.eq("id", designationId)'), "Workforce registration policy must resolve a designation by id."],
  [policy.includes("Registration fields are not defined for this designation in Workforce Master."), "Missing designation field rules must fail closed."],
  [connectRoute.includes("designationId: row.designation_id") && connectRoute.includes("loadWorkforceRegistrationPolicy"), "DropX One must load Workforce rules from designation_id."],
  [connectAuth.includes("registration_category_code") && !connectAuth.includes('profileType === "workforce") return "workforce"'), "DropX One access must use the designation registration policy instead of the physical Workforce table."],
  [!policy.match(/\b(DA|PTDA|ODCD|WISHMASTER)\b/i), "Registration policy must not contain a designation-name or designation-code allowlist."]
];

const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);
if (failures.length) {
  console.error(failures.map((message) => `- ${message}`).join("\n"));
  process.exit(1);
}

console.log("Workforce registration policy boundary verified.");
