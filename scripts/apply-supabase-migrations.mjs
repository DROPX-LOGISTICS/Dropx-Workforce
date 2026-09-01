import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

function workflowFailure(error) {
  const message = (error instanceof Error ? error.message : String(error))
    .replaceAll(/\r?\n/g, " ")
    .replaceAll("::", ":")
    .slice(0, 1800);
  console.error(`::error title=Supabase migration failed::${message}`);
}

process.on("uncaughtException", (error) => {
  workflowFailure(error);
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  workflowFailure(error);
  process.exit(1);
});

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

  const classificationResult = await managementQuery(
    `select classification_state::text, count(*)::integer as profiles
     from public.people_worker_classification_audit
     group by classification_state
     order by classification_state;`,
    { readOnly: true }
  );
  const classificationRows = rowsFromResponse(classificationResult);
  console.log("People statutory classification audit:");
  for (const row of classificationRows) {
    console.log(JSON.stringify({
      classificationState: String(row.classification_state ?? ""),
      profiles: Number(row.profiles ?? 0)
    }));
  }
  const wrongSourceCount = classificationRows
    .filter((row) => String(row.classification_state ?? "") === "wrong_source")
    .reduce((total, row) => total + Number(row.profiles ?? 0), 0);

  const reconciliationResult = await managementQuery(
    `select status::text, count(*)::integer as corrections
     from public.hr_worker_classification_reconciliations
     group by status
     order by status;`,
    { readOnly: true }
  );
  const reconciliationRows = rowsFromResponse(reconciliationResult);
  console.log("People statutory reconciliation ledger:");
  for (const row of reconciliationRows) {
    console.log(JSON.stringify({
      corrections: Number(row.corrections ?? 0),
      status: String(row.status ?? "")
    }));
  }
  const blockedCount = reconciliationRows
    .filter((row) => String(row.status ?? "") === "blocked")
    .reduce((total, row) => total + Number(row.corrections ?? 0), 0);
  const blockedReasonResult = await managementQuery(
    `select coalesce(error_message, 'No error recorded')::text as error_message,
            count(*)::integer as corrections
     from public.hr_worker_classification_reconciliations
     where status = 'blocked'
     group by coalesce(error_message, 'No error recorded')
     order by count(*) desc, error_message
     limit 10;`,
    { readOnly: true }
  );
  const blockedReasonRows = rowsFromResponse(blockedReasonResult);
  for (const row of blockedReasonRows) {
    console.log(JSON.stringify({
      blockedReason: String(row.error_message ?? ""),
      corrections: Number(row.corrections ?? 0)
    }));
  }
  const blockedReasonSummary = blockedReasonRows.map((row) => (
    `${Number(row.corrections ?? 0)}x ${String(row.error_message ?? "").replaceAll(/\s+/g, " ").slice(0, 220)}`
  )).join(" | ");

  const projectionResult = await managementQuery(
    `with current_people as (
       select distinct on (engagement.company_id, engagement.id)
              engagement.company_id,
              engagement.id as engagement_id,
              engagement.person_id,
              engagement.worker_type,
              engagement.employee_id,
              engagement.contractor_id,
              assignment.designation_id,
              assignment.department_id,
              assignment.location_id,
              designation.name as designation_name,
              designation.onboarding_categories,
              person.status as person_status,
              employee.designation_id as employee_designation_id,
              employee.people_lifecycle_status as employee_lifecycle_status,
              (employee.id is not null and employee.deleted_at is null) as employee_source_exists,
              (employee.deleted_at is null and employee.is_active) as live_employee,
              contractor.designation as contractor_designation,
              contractor.people_lifecycle_status as contractor_lifecycle_status,
              (contractor.id is not null and contractor.deleted_at is null) as contractor_source_exists,
              (contractor.deleted_at is null and contractor.is_active) as live_contractor
       from public.hr_engagements engagement
       join public.hr_work_assignments assignment
         on assignment.company_id = engagement.company_id
        and assignment.engagement_id = engagement.id
        and assignment.is_primary
        and assignment.effective_from <= timezone('Asia/Kolkata', now())::date
        and (assignment.effective_to is null or assignment.effective_to >= timezone('Asia/Kolkata', now())::date)
       join public.designations designation
         on designation.company_id = assignment.company_id
        and designation.id = assignment.designation_id
        and designation.is_active
       join public.designation_categories category
         on category.company_id = designation.company_id
        and category.id = designation.designation_category_id
        and category.is_active
        and category.people_module = 'people_hr'
       join public.hr_people person
         on person.company_id = engagement.company_id
        and person.id = engagement.person_id
       left join public.employees employee
         on employee.company_id = engagement.company_id
        and employee.id = engagement.employee_id
       left join public.contractors contractor
         on contractor.company_id = engagement.company_id
        and contractor.id = engagement.contractor_id
       where engagement.status = 'active'
       order by engagement.company_id, engagement.id,
                assignment.effective_from desc, assignment.created_at desc
     )
     select count(*)::integer as active_people,
            count(*) filter (
              where person_status <> 'active'
                 or case when worker_type = 'employee'
                   then not coalesce(employee_source_exists, false)
                     or (
                       lower(btrim(coalesce(employee_lifecycle_status, ''))) = 'active'
                       and not coalesce(live_employee, false)
                     )
                     or employee_designation_id is distinct from designation_id
                     or nullif(btrim(coalesce(employee_lifecycle_status, '')), '') is null
                     or not ('employees' = any(coalesce(onboarding_categories, '{}'::text[])))
                   else not coalesce(contractor_source_exists, false)
                     or (
                       lower(btrim(coalesce(contractor_lifecycle_status, ''))) = 'active'
                       and not coalesce(live_contractor, false)
                     )
                     or lower(btrim(coalesce(contractor_designation, ''))) is distinct from lower(btrim(coalesce(designation_name, '')))
                     or nullif(btrim(coalesce(contractor_lifecycle_status, '')), '') is null
                     or not ('contractors' = any(coalesce(onboarding_categories, '{}'::text[])))
                 end
            )::integer as projection_drift
     from current_people;`,
    { readOnly: true }
  );
  const projectionRows = rowsFromResponse(projectionResult);
  const projectionDriftCount = Number(projectionRows[0]?.projection_drift ?? 0);
  console.log("Canonical People source projection audit:");
  console.log(JSON.stringify({
    activePeople: Number(projectionRows[0]?.active_people ?? 0),
    projectionDrift: projectionDriftCount
  }));
  if (projectionDriftCount) {
    const projectionDetailResult = await managementQuery(
      `with current_people as (
         select distinct on (engagement.company_id, engagement.id)
                company.code as company_code,
                engagement.id as engagement_id,
                engagement.worker_type,
                coalesce(employee.employee_code, contractor.dropx_id) as worker_code,
                coalesce(employee.full_name, contractor.full_name) as full_name,
                assignment.designation_id,
                designation.name as designation_name,
                designation.onboarding_categories,
                person.status as person_status,
                employee.designation_id as employee_designation_id,
                employee.people_lifecycle_status as employee_lifecycle_status,
                (employee.id is not null and employee.deleted_at is null) as employee_source_exists,
                (employee.deleted_at is null and employee.is_active) as live_employee,
                contractor.designation as contractor_designation,
                contractor.people_lifecycle_status as contractor_lifecycle_status,
                (contractor.id is not null and contractor.deleted_at is null) as contractor_source_exists,
                (contractor.deleted_at is null and contractor.is_active) as live_contractor
         from public.hr_engagements engagement
         join public.companies company
           on company.id = engagement.company_id
         join public.hr_work_assignments assignment
           on assignment.company_id = engagement.company_id
          and assignment.engagement_id = engagement.id
          and assignment.is_primary
          and assignment.effective_from <= timezone('Asia/Kolkata', now())::date
          and (assignment.effective_to is null or assignment.effective_to >= timezone('Asia/Kolkata', now())::date)
         join public.designations designation
           on designation.company_id = assignment.company_id
          and designation.id = assignment.designation_id
          and designation.is_active
         join public.designation_categories category
           on category.company_id = designation.company_id
          and category.id = designation.designation_category_id
          and category.is_active
          and category.people_module = 'people_hr'
         join public.hr_people person
           on person.company_id = engagement.company_id
          and person.id = engagement.person_id
         left join public.employees employee
           on employee.company_id = engagement.company_id
          and employee.id = engagement.employee_id
         left join public.contractors contractor
           on contractor.company_id = engagement.company_id
          and contractor.id = engagement.contractor_id
         where engagement.status = 'active'
         order by engagement.company_id, engagement.id,
                  assignment.effective_from desc, assignment.created_at desc
       )
       select company_code::text,
              engagement_id::text,
              worker_type::text,
              coalesce(worker_code, '')::text as worker_code,
              coalesce(full_name, '')::text as full_name,
              coalesce(designation_name, '')::text as canonical_designation,
              coalesce(person_status, '')::text as person_status,
              coalesce(employee_lifecycle_status, contractor_lifecycle_status, '')::text as source_lifecycle_status,
              coalesce(employee_designation_id::text, contractor_designation, '')::text as source_designation,
              array_to_string(array_remove(array[
                case when person_status <> 'active' then 'person_not_active' end,
                case when worker_type = 'employee' and not coalesce(employee_source_exists, false) then 'employee_source_missing' end,
                case when worker_type = 'employee' and lower(btrim(coalesce(employee_lifecycle_status, ''))) = 'active' and not coalesce(live_employee, false) then 'active_employee_source_not_live' end,
                case when worker_type = 'employee' and employee_designation_id is distinct from designation_id then 'employee_designation_mismatch' end,
                case when worker_type = 'employee' and nullif(btrim(coalesce(employee_lifecycle_status, '')), '') is null then 'employee_lifecycle_missing' end,
                case when worker_type = 'employee' and not ('employees' = any(coalesce(onboarding_categories, '{}'::text[]))) then 'employee_category_missing' end,
                case when worker_type = 'contractor' and not coalesce(contractor_source_exists, false) then 'contractor_source_missing' end,
                case when worker_type = 'contractor' and lower(btrim(coalesce(contractor_lifecycle_status, ''))) = 'active' and not coalesce(live_contractor, false) then 'active_contractor_source_not_live' end,
                case when worker_type = 'contractor' and lower(btrim(coalesce(contractor_designation, ''))) is distinct from lower(btrim(coalesce(designation_name, ''))) then 'contractor_designation_mismatch' end,
                case when worker_type = 'contractor' and nullif(btrim(coalesce(contractor_lifecycle_status, '')), '') is null then 'contractor_lifecycle_missing' end,
                case when worker_type = 'contractor' and not ('contractors' = any(coalesce(onboarding_categories, '{}'::text[]))) then 'contractor_category_missing' end
              ], null), ', ')::text as drift_reasons
       from current_people
       where person_status <> 'active'
          or case when worker_type = 'employee'
            then not coalesce(employee_source_exists, false)
              or (
                lower(btrim(coalesce(employee_lifecycle_status, ''))) = 'active'
                and not coalesce(live_employee, false)
              )
              or employee_designation_id is distinct from designation_id
              or nullif(btrim(coalesce(employee_lifecycle_status, '')), '') is null
              or not ('employees' = any(coalesce(onboarding_categories, '{}'::text[])))
            else not coalesce(contractor_source_exists, false)
              or (
                lower(btrim(coalesce(contractor_lifecycle_status, ''))) = 'active'
                and not coalesce(live_contractor, false)
              )
              or lower(btrim(coalesce(contractor_designation, ''))) is distinct from lower(btrim(coalesce(designation_name, '')))
              or nullif(btrim(coalesce(contractor_lifecycle_status, '')), '') is null
              or not ('contractors' = any(coalesce(onboarding_categories, '{}'::text[])))
          end
       order by company_code, worker_code, engagement_id;`,
      { readOnly: true }
    );
    console.log("Canonical People projection drift details:");
    for (const row of rowsFromResponse(projectionDetailResult)) {
      console.log(JSON.stringify({
        canonicalDesignation: String(row.canonical_designation ?? ""),
        companyCode: String(row.company_code ?? ""),
        driftReasons: String(row.drift_reasons ?? ""),
        engagementId: String(row.engagement_id ?? ""),
        fullName: String(row.full_name ?? ""),
        personStatus: String(row.person_status ?? ""),
        sourceDesignation: String(row.source_designation ?? ""),
        sourceLifecycleStatus: String(row.source_lifecycle_status ?? ""),
        workerCode: String(row.worker_code ?? ""),
        workerType: String(row.worker_type ?? "")
      }));
    }
  }

  const sujanResult = await managementQuery(
     `with source as (
       select company_id, id, full_name, 'employee'::text as worker_type,
              designation_id as source_designation_id,
              null::text as source_designation_name,
              people_lifecycle_status as source_lifecycle_status,
              (deleted_at is null and is_active) as live
       from public.employees where upper(employee_code) = 'D0785'
       union all
       select company_id, id, full_name, 'contractor'::text,
              null::uuid, designation, people_lifecycle_status,
              (deleted_at is null and is_active)
       from public.contractors where upper(dropx_id) = 'D0785'
     )
     select company.code::text as company_code,
            max(source.full_name)::text as full_name,
            max(source.worker_type) filter (where source.live)::text as live_worker_type,
            count(distinct (source.worker_type, source.id))::integer as source_rows,
            count(distinct (source.worker_type, source.id)) filter (where source.live)::integer as live_source_rows,
            max(person.status)::text as person_status,
            max(source.source_lifecycle_status) filter (where source.live)::text as source_lifecycle_status,
            count(distinct engagement.id) filter (where engagement.status = 'active')::integer as active_engagements,
            count(distinct assignment.id) filter (
              where assignment.is_primary
                and assignment.effective_from <= timezone('Asia/Kolkata', now())::date
                and (assignment.effective_to is null or assignment.effective_to >= timezone('Asia/Kolkata', now())::date)
            )::integer as current_assignments,
            max(assignment.position_title) filter (
              where assignment.is_primary
                and assignment.effective_from <= timezone('Asia/Kolkata', now())::date
                and (assignment.effective_to is null or assignment.effective_to >= timezone('Asia/Kolkata', now())::date)
            )::text as position_title,
            max(designation.name) filter (
              where assignment.is_primary
                and assignment.effective_from <= timezone('Asia/Kolkata', now())::date
                and (assignment.effective_to is null or assignment.effective_to >= timezone('Asia/Kolkata', now())::date)
            )::text as designation_name,
            bool_or(category.people_module = 'people_hr') filter (
              where assignment.is_primary
                and assignment.effective_from <= timezone('Asia/Kolkata', now())::date
                and (assignment.effective_to is null or assignment.effective_to >= timezone('Asia/Kolkata', now())::date)
            ) as people_category,
            bool_or('people' = any(coalesce(designation.portal_scopes, '{}'::text[]))) filter (
              where assignment.is_primary
                and assignment.effective_from <= timezone('Asia/Kolkata', now())::date
                and (assignment.effective_to is null or assignment.effective_to >= timezone('Asia/Kolkata', now())::date)
            ) as people_portal_scope,
            bool_or(coalesce(mapping.is_available, false)) filter (
              where assignment.is_primary
                and assignment.effective_from <= timezone('Asia/Kolkata', now())::date
                and (assignment.effective_to is null or assignment.effective_to >= timezone('Asia/Kolkata', now())::date)
            ) as people_mapping_available,
            bool_or(
              case when source.worker_type = 'employee'
                then source.source_designation_id = assignment.designation_id
                  and 'employees' = any(coalesce(designation.onboarding_categories, '{}'::text[]))
                else lower(btrim(coalesce(source.source_designation_name, ''))) = lower(btrim(coalesce(designation.name, '')))
                  and 'contractors' = any(coalesce(designation.onboarding_categories, '{}'::text[]))
              end
            ) filter (
              where source.live
                and engagement.status = 'active'
                and assignment.is_primary
                and assignment.effective_from <= timezone('Asia/Kolkata', now())::date
                and (assignment.effective_to is null or assignment.effective_to >= timezone('Asia/Kolkata', now())::date)
            ) as source_projection_aligned,
            count(distinct reportee.subject_assignment_id) filter (
              where reportee.relationship_type = 'solid_line'
                and reportee.is_primary
                and reportee.effective_from <= timezone('Asia/Kolkata', now())::date
                and (reportee.effective_to is null or reportee.effective_to >= timezone('Asia/Kolkata', now())::date)
            )::integer as active_reportees
     from public.companies company
     left join source on source.company_id = company.id
     left join public.hr_engagements engagement
       on engagement.company_id = source.company_id
      and (
        (source.worker_type = 'employee' and engagement.worker_type = 'employee' and engagement.employee_id = source.id)
        or
        (source.worker_type = 'contractor' and engagement.worker_type = 'contractor' and engagement.contractor_id = source.id)
      )
     left join public.hr_work_assignments assignment
      on assignment.company_id = engagement.company_id
     and assignment.engagement_id = engagement.id
     left join public.hr_people person
       on person.company_id = engagement.company_id
      and person.id = engagement.person_id
     left join public.designations designation
       on designation.company_id = assignment.company_id
      and designation.id = assignment.designation_id
     left join public.designation_categories category
       on category.company_id = designation.company_id
      and category.id = designation.designation_category_id
     left join public.hr_designation_mappings mapping
       on mapping.company_id = designation.company_id
      and mapping.designation_id = designation.id
     left join public.hr_reporting_relationships reportee
       on reportee.company_id = assignment.company_id
      and reportee.manager_assignment_id = assignment.id
     where exists (
       select 1 from source candidate where candidate.company_id = company.id
     )
     group by company.id, company.code
     order by company.code;`,
    { readOnly: true }
  );
  const sujanRows = rowsFromResponse(sujanResult);
  console.log("D0785 canonical People recovery audit:");
  for (const row of sujanRows) {
    const detail = {
      activeEngagements: Number(row.active_engagements ?? 0),
      activeReportees: Number(row.active_reportees ?? 0),
      companyCode: String(row.company_code ?? ""),
      currentAssignments: Number(row.current_assignments ?? 0),
      designationName: String(row.designation_name ?? ""),
      fullName: String(row.full_name ?? ""),
      liveSourceRows: Number(row.live_source_rows ?? 0),
      liveWorkerType: String(row.live_worker_type ?? ""),
      personStatus: String(row.person_status ?? ""),
      peopleCategory: Boolean(row.people_category),
      peopleMappingAvailable: Boolean(row.people_mapping_available),
      peoplePortalScope: Boolean(row.people_portal_scope),
      positionTitle: String(row.position_title ?? ""),
      sourceLifecycleStatus: String(row.source_lifecycle_status ?? ""),
      sourceProjectionAligned: Boolean(row.source_projection_aligned),
      sourceRows: Number(row.source_rows ?? 0)
    };
    console.log(JSON.stringify(detail));
    console.log(`::notice title=D0785 canonical People audit::${Object.entries(detail).map(([key, value]) => `${key}=${value}`).join(", ")}`);
  }
  const invalidSujan = sujanRows.length !== 1 || sujanRows.some((row) => (
    Number(row.live_source_rows ?? 0) !== 1
    || Number(row.active_engagements ?? 0) !== 1
    || Number(row.current_assignments ?? 0) !== 1
    || Number(row.active_reportees ?? 0) < 1
    || String(row.person_status ?? "") !== "active"
    || !Boolean(row.people_category)
    || !Boolean(row.people_mapping_available)
    || !Boolean(row.source_projection_aligned)
    || !String(row.source_lifecycle_status ?? "").trim()
  ));

  const accessHealthResult = await managementQuery(
    `select health_state::text, count(*)::integer as policies
     from public.people_product_access_health
     where is_enabled
     group by health_state
     order by health_state;`,
    { readOnly: true }
  );
  const accessHealthRows = rowsFromResponse(accessHealthResult);
  console.log("People designation product-access health:");
  for (const row of accessHealthRows) {
    console.log(JSON.stringify({
      healthState: String(row.health_state ?? ""),
      policies: Number(row.policies ?? 0)
    }));
  }
  const unhealthyAccessPolicies = accessHealthRows
    .filter((row) => String(row.health_state ?? "") !== "healthy")
    .reduce((total, row) => total + Number(row.policies ?? 0), 0);

  const membershipDriftResult = await managementQuery(
    `select count(*)::integer as drift
     from public.company_product_memberships membership
     join public.designation_product_access_policies policy
       on policy.company_id = membership.company_id
      and policy.id = membership.designation_policy_id
     where membership.is_active
       and membership.source_system = 'designation_policy'
       and (
         not policy.is_enabled
         or membership.designation_id <> policy.designation_id
         or membership.product_code <> policy.product_code
         or membership.role_id is distinct from policy.default_role_id
       );`,
    { readOnly: true }
  );
  const membershipDrift = Number(rowsFromResponse(membershipDriftResult)[0]?.drift ?? 0);
  console.log(`Designation-managed membership drift: ${membershipDrift}.`);

  if (wrongSourceCount || blockedCount || projectionDriftCount || invalidSujan || unhealthyAccessPolicies || membershipDrift) {
    throw new Error(
      `Production People audit failed: ${wrongSourceCount} wrong-source profile(s), ${blockedCount} blocked correction(s), ${projectionDriftCount} source-projection drift(s), ${unhealthyAccessPolicies} unhealthy designation policy/policies, ${membershipDrift} membership drift row(s), D0785 canonical=${invalidSujan ? "invalid" : "valid"}.${blockedReasonSummary ? ` Blockers: ${blockedReasonSummary}` : ""}`
    );
  }
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
  try {
    await auditDesignationRouting();
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`::error title=Production People audit failed::${message}`);
    process.exit(1);
  }
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
