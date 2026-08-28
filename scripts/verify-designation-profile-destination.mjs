import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
const form = read("src/components/designation-form.tsx");
const list = read("src/components/designation-master-page-content.tsx");
const actions = read("src/app/master/designations/actions.ts");
const migration = read("supabase/migrations/20260828204426_designation_profile_destination.sql");

const routeStart = migration.indexOf("create or replace function public.sync_workforce_legacy_payload");
const routeEnd = migration.indexOf("create or replace function public.resync_workforce_designation_destination");
const routeFunction = routeStart >= 0 && routeEnd > routeStart
  ? migration.slice(routeStart, routeEnd)
  : "";

const checks = [
  [form.includes('name="profile_destination"'), "Designation form must submit profile_destination."],
  [list.includes("<th>Profile destination</th>"), "Designation list must show the profile destination."],
  [actions.includes("profile_destination: destination"), "Designation actions must persist profile_destination."],
  [routeFunction.includes("designation.profile_destination"), "Registration routing must read designation.profile_destination."],
  [!routeFunction.includes("onboarding_categories_value"), "Registration routing must not infer a table from engagement types."],
  [!routeFunction.match(/upper\(designation\.code\)\s+in\s*\(/i), "Registration routing must not contain a designation-code allowlist."]
];

const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);
if (failures.length) {
  console.error(failures.map((message) => `- ${message}`).join("\n"));
  process.exit(1);
}

console.log("Designation profile destination boundary verified.");
