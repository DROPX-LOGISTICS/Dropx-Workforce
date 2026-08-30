import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");
const migrationPattern = /^(\d{14})_(.+)\.sql$/;
const maximumPendingMigrations = Number(process.env.MAX_PENDING_MIGRATIONS ?? "12");
const migrationStartVersion = process.env.SUPABASE_MIGRATION_START_VERSION?.trim() ?? "";

if (migrationStartVersion && !/^\d{14}$/.test(migrationStartVersion)) {
  throw new Error("SUPABASE_MIGRATION_START_VERSION must be a 14-digit migration version.");
}

function localMigrations() {
  const trackedFiles = execFileSync("git", ["ls-files", "--", "supabase/migrations/*.sql"], {
    encoding: "utf8"
  }).trim().split("\n").filter(Boolean);
  const migrations = trackedFiles
    .map((trackedFile) => {
      const fileName = basename(trackedFile);
      const match = migrationPattern.exec(fileName);
      if (!match) return null;
      return {
        fileName,
        name: match[2],
        path: join(migrationsDirectory, fileName),
        version: match[1]
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.version.localeCompare(right.version));

  const versions = new Set();
  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new Error(`Duplicate local migration version: ${migration.version}`);
    }
    versions.add(migration.version);
  }
  return migrations;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function stripOuterTransaction(sql) {
  const match = /^\s*begin\s*;\s*([\s\S]*?)\s*commit\s*;\s*$/i.exec(sql);
  return match ? match[1].trim() : sql.trim();
}

function rowsFromResponse(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["data", "result", "rows"]) {
    if (Array.isArray(payload[key])) return payload[key];
    if (payload[key] && typeof payload[key] === "object") {
      for (const nestedKey of ["data", "result", "rows"]) {
        if (Array.isArray(payload[key][nestedKey])) return payload[key][nestedKey];
      }
    }
  }
  return [];
}

async function managementQuery(query, { readOnly = false } = {}) {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  const projectId = process.env.SUPABASE_PROJECT_ID?.trim();
  if (!accessToken || !projectId) {
    throw new Error("SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_ID are required.");
  }

  const response = await fetch(
    `https://api.supabase.com/v1/projects/${encodeURIComponent(projectId)}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, read_only: readOnly })
    }
  );
  const body = await response.text();
  if (!response.ok) {
    let detail = body;
    try {
      const parsed = JSON.parse(body);
      detail = parsed.message ?? parsed.error ?? parsed.msg ?? body;
    } catch {
      // Keep the response text when the API does not return JSON.
    }
    throw new Error(`Supabase Management API returned ${response.status}: ${String(detail).slice(0, 800)}`);
  }
  return body ? JSON.parse(body) : [];
}

async function remoteMigrationVersions() {
  const tableResult = await managementQuery(
    "select to_regclass('supabase_migrations.schema_migrations')::text as table_name;",
    { readOnly: true }
  );
  const tableRows = rowsFromResponse(tableResult);
  if (!tableRows[0]?.table_name) {
    throw new Error("Remote migration history is missing; refusing to infer or replay the production baseline.");
  }

  const historyResult = await managementQuery(
    "select version::text, coalesce(name, '')::text as name from supabase_migrations.schema_migrations order by version;",
    { readOnly: true }
  );
  const historyRows = rowsFromResponse(historyResult);
  return new Set(historyRows.map((row) => String(row.version ?? "").trim()).filter(Boolean));
}

async function auditDesignationRouting() {
  const result = await managementQuery(
    `select
       company.code::text as company_code,
       count(designation.id)::integer as total_designations,
       count(designation.id) filter (
         where category.people_module = 'delivery_network'
       )::integer as workforce_designations,
       count(designation.id) filter (
         where category.people_module = 'people_hr'
       )::integer as hr_designations,
       count(designation.id) filter (
         where designation.designation_category_id is null
       )::integer as unassigned_designations,
       count(designation.id) filter (
         where designation.designation_category_id is not null
           and category.id is null
       )::integer as unresolved_category_designations
     from public.companies company
     left join public.designations designation
       on designation.company_id = company.id
     left join public.designation_categories category
       on category.id = designation.designation_category_id
      and category.company_id = designation.company_id
     group by company.id, company.code
     having count(designation.id) > 0
     order by company.code;`,
    { readOnly: true }
  );
  const rows = rowsFromResponse(result);
  console.log("Designation routing audit:");
  for (const row of rows) {
    console.log(JSON.stringify({
      companyCode: String(row.company_code ?? ""),
      hrDesignations: Number(row.hr_designations ?? 0),
      totalDesignations: Number(row.total_designations ?? 0),
      unassignedDesignations: Number(row.unassigned_designations ?? 0),
      unresolvedCategoryDesignations: Number(row.unresolved_category_designations ?? 0),
      workforceDesignations: Number(row.workforce_designations ?? 0)
    }));
  }
  if (!rows.length) console.log("No designation rows found in production.");

  const requiredColumns = [
    "app_page_access",
    "designation_category_id",
    "is_field_operations",
    "location_ids",
    "model_ids",
    "onboarding_categories",
    "onboarding_role_ids",
    "portal_permissions",
    "profile_destination",
    "profile_field_rules",
    "provider_ids",
    "registration_category_code"
  ];
  const columnResult = await managementQuery(
    `select required.column_name
     from unnest(array[${requiredColumns.map(sqlLiteral).join(", ")}]) required(column_name)
     left join information_schema.columns column_info
       on column_info.table_schema = 'public'
      and column_info.table_name = 'designations'
      and column_info.column_name = required.column_name
     where column_info.column_name is null
     order by required.column_name;`,
    { readOnly: true }
  );
  const missingColumns = rowsFromResponse(columnResult).map((row) => String(row.column_name ?? "")).filter(Boolean);
  console.log(`Missing designation columns: ${missingColumns.length ? missingColumns.join(", ") : "none"}.`);
}

function migrationQuery(migration) {
  const originalSql = readFileSync(migration.path, "utf8");
  const migrationSql = stripOuterTransaction(originalSql);
  if (!migrationSql) throw new Error(`Migration ${migration.fileName} is empty.`);

  return `begin;
select pg_advisory_xact_lock(hashtext('dropx-workforce-github-migrations'));
${migrationSql}
insert into supabase_migrations.schema_migrations(version, name, statements)
values (
  ${sqlLiteral(migration.version)},
  ${sqlLiteral(migration.name)},
  array[${sqlLiteral(originalSql)}]::text[]
);
commit;`;
}

const mode = process.argv[2] ?? "";
const migrations = localMigrations();

if (mode === "--check") {
  for (const migration of migrations) migrationQuery(migration);
  console.log(`Validated ${migrations.length} committed Supabase migrations.`);
  process.exit(0);
}

if (mode === "--audit") {
  await auditDesignationRouting();
  process.exit(0);
}

if (mode !== "--preview" && mode !== "--apply") {
  throw new Error("Use --check, --preview, --apply, or --audit.");
}

const remoteVersions = await remoteMigrationVersions();
const applicableMigrations = migrationStartVersion
  ? migrations.filter((migration) => migration.version >= migrationStartVersion)
  : migrations;
const pendingMigrations = applicableMigrations.filter((migration) => !remoteVersions.has(migration.version));

console.log(`Remote migration history: ${remoteVersions.size} versions.`);
console.log(`Committed local migrations: ${migrations.length} versions.`);
console.log(`Configured migration baseline: ${migrationStartVersion || "none"}.`);
console.log(`Applicable committed migrations: ${applicableMigrations.length}.`);
console.log(`Pending migrations: ${pendingMigrations.length}.`);
for (const migration of pendingMigrations) console.log(`- ${migration.fileName}`);

if (pendingMigrations.length > maximumPendingMigrations) {
  throw new Error(
    `Refusing to apply ${pendingMigrations.length} migrations; MAX_PENDING_MIGRATIONS is ${maximumPendingMigrations}.`
  );
}

if (mode === "--preview" || !pendingMigrations.length) process.exit(0);

for (const migration of pendingMigrations) {
  await managementQuery(migrationQuery(migration));
  console.log(`Applied ${migration.fileName}.`);
}

const finalRemoteVersions = await remoteMigrationVersions();
const unapplied = pendingMigrations.filter((migration) => !finalRemoteVersions.has(migration.version));
if (unapplied.length) {
  throw new Error(`Migration verification failed for: ${unapplied.map((migration) => migration.fileName).join(", ")}`);
}
console.log(`Verified ${pendingMigrations.length} applied migration(s) in remote history.`);
