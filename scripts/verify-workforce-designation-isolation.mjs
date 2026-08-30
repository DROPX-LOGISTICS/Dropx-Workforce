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
