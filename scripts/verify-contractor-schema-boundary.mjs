import { readFileSync } from "node:fs";

const targets = [
  "src/app/field-executive/actions.ts",
  "src/components/field-executive-page-content.tsx",
  "src/components/scoped-designation-fields.tsx",
  "src/app/people/workforce-lifecycle/actions.ts",
  "src/app/people/workforce-lifecycle/page.tsx",
  "apps/connect/app/api/connect/field-executive-profile/route.ts",
  "apps/connect/src/components/connect-profile-app.tsx"
];

const forbidden = [
  { label: "removed contractor vehicle column", pattern: /\bvehicle_type\b/i },
  { label: "removed Bike/Van upload instruction", pattern: /Bike\/Van for DA\/PTDA/i },
  { label: "removed hardcoded vehicle helper", pattern: /field-executive-vehicle/i }
];

const violations = [];

for (const file of targets) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  for (const rule of forbidden) {
    if (rule.pattern.test(source)) violations.push(`${file}: ${rule.label}`);
  }
}

if (violations.length) {
  console.error("Contractor schema boundary check failed:\n" + violations.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log(`Contractor schema boundary verified across ${targets.length} runtime files.`);
