import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const checks = [
  {
    file: "src/components/designation-master-page-content.tsx",
    required: [
      'peopleModule: "delivery_network"',
      '.eq("designation_category.people_module", peopleModule)',
      'const createAction = createWorkforceDesignation'
    ],
    forbidden: ["createPeopleDesignation", "createDesignation;"]
  },
  {
    file: "src/app/master/designations/page.tsx",
    required: ['redirect("/delivery-network/designations")'],
    forbidden: ["DesignationMasterPageContent"]
  },
  {
    file: "src/app/people/designations/page.tsx",
    required: ["notFound()"],
    forbidden: ["DesignationMasterPageContent"]
  },
  {
    file: "src/app/master/designations/actions.ts",
    required: ['peopleModule: "delivery_network"'],
    forbidden: ["allDesignationScope", "peopleDesignationScope", "createPeopleDesignation"]
  },
  {
    file: "src/app/master/workforce-categories/page.tsx",
    required: ['category.code !== "employees"', 'category.code !== "field_executives"'],
    forbidden: ['subtitle="Configure employee, contractor']
  },
  {
    file: "src/lib/workforce-communication-recipients.ts",
    required: ['.from("workforce")'],
    forbidden: ['.from("employees")', '"employee", employee.id']
  },
  {
    file: "src/middleware.ts",
    required: ['const WORKFORCE_ROOTS = [', 'isWorkforceHost &&', '!isWorkforcePath(path)'],
    forbidden: []
  },
  {
    file: "supabase/migrations/20260830220000_verified_legacy_workforce_cleanup.sql",
    required: [
      "preview_legacy_workforce_alias_cleanup",
      "purge_verified_legacy_workforce_aliases",
      "a registration draft has no canonical Workforce copy",
      "pg_advisory_xact_lock"
    ],
    forbidden: []
  }
];

const violations = [];
for (const check of checks) {
  const source = read(check.file);
  for (const text of check.required) if (!source.includes(text)) violations.push(`${check.file}: missing ${text}`);
  for (const text of check.forbidden) if (source.includes(text)) violations.push(`${check.file}: forbidden ${text}`);
}

if (violations.length) {
  console.error("Workforce designation isolation failed:\n" + violations.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log(`Workforce designation isolation verified across ${checks.length} runtime files.`);
