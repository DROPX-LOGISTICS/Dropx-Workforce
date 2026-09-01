import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260830170000_company_product_owners.sql");
const canonicalRoleMigration = read("supabase/migrations/20260901223000_finish_canonical_people_designation_roles.sql");
const userActions = read("src/app/users/actions.ts");
const opsAccessRegister = read("src/app/ops-pulse/access/page.tsx");
const navigation = read("src/lib/app-navigation.ts");
const middleware = read("src/middleware.ts");

const protectedTables = [
  "employees",
  "contractors",
  "workforce",
  "person_register_links",
  "payment_requests",
  "payment_request_approvals"
];
const destructivePattern = new RegExp(
  `\\b(?:alter\\s+table|drop\\s+table|truncate(?:\\s+table)?|delete\\s+from|update|insert\\s+into)\\s+(?:public\\.)?(?:${protectedTables.join("|")})\\b`,
  "i"
);
const workforceNavigation = navigation.slice(navigation.indexOf("export const workforceNavItems"));
const liveDataTables = ["employees", "contractors", "workforce", "vendors", "helpers", "attendance_records", "payment_request_approvals"];
const canonicalDestructivePattern = new RegExp(
  `\\b(?:alter\\s+table|drop\\s+table|truncate(?:\\s+table)?|delete\\s+from|update|insert\\s+into)\\s+(?:public\\.)?(?:${liveDataTables.join("|")})\\b`,
  "i"
);

const checks = [
  [migration.trimStart().startsWith("begin;") && migration.trimEnd().endsWith("commit;"), "Migration must be transactional."],
  [!destructivePattern.test(migration), "Migration must not mutate employee, contractor, Workforce, registration-link, or payment workflow tables."],
  [!/@[a-z0-9.-]+\.[a-z]{2,}/i.test(migration) && !migration.includes("configured_owners"), "Product owners must be assigned from the Super Admin Dashboard, never hardcoded in SQL."],
  [migration.includes("company_product_memberships") && migration.includes("source_system = 'legacy_dashboard'"), "Migration must preserve legacy access through additive product memberships."],
  [migration.includes("station_responsibility_assignments") && migration.includes("effective_to"), "Station responsibility replacements must retain effective-dated history."],
  [userActions.includes('from("company_product_memberships")') && !userActions.includes("Workforce user access is add-only"), "Workforce must manage its own users through product memberships."],
  [workforceNavigation.includes("/delivery-network/engagement-types"), "Workforce must own its Engagement Types master."],
  [!workforceNavigation.includes("/master/payment-methods") && !workforceNavigation.includes("/master/payment-heads") && !workforceNavigation.includes("/master/payment-banks"), "Finance masters must not remain in Workforce navigation."],
  [middleware.includes("MOVED_FINANCE_PATHS") && middleware.includes("https://fin.dropxlogistics.com"), "Old Workforce finance-master links must redirect to Finance."],
  [middleware.includes('"/users"') && middleware.includes('"/delivery-network"'), "Workforce user and operating routes must remain available on the Workforce host."],
  [canonicalRoleMigration.trimStart().startsWith("begin;") && canonicalRoleMigration.trimEnd().endsWith("commit;"), "Canonical People-role cutover must be transactional."],
  [!canonicalDestructivePattern.test(canonicalRoleMigration), "Canonical role cutover must not mutate People/Workforce identities, attendance, registration registers, or completed approval history."],
  [canonicalRoleMigration.includes("update public.payment_heads") && canonicalRoleMigration.includes("update public.payment_requests"), "Current and future payment approval routes must move to canonical designation roles together."],
  [canonicalRoleMigration.includes("people_product_access_health") && canonicalRoleMigration.includes("ensure_designation_product_access_defaults"), "Cutover must reconcile memberships and expose a deployment health check."],
  [opsAccessRegister.includes('from("company_product_memberships")') && opsAccessRegister.includes('from("people_portal_access_candidates")'), "OpsPulse access register must use product memberships and current People designations."],
  [!opsAccessRegister.includes('select("id,full_name,email,role_id'), "OpsPulse access register must not display the legacy profile role."]
];

const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length) {
  console.error("Product access cutover verification failed:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log(`Product access cutover verified; ${protectedTables.length} live-flow tables remain untouched.`);
