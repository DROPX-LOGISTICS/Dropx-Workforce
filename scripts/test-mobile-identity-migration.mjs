import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const repo = new URL("../", import.meta.url).pathname;
const migration = readFileSync(`${repo}supabase/migrations/20260905123000_mobile_identity_onboarding_guard.sql`, "utf8");
const schemaGuardMigration = readFileSync(`${repo}supabase/migrations/20260905131500_schema_safe_onboarding_identity_conflicts.sql`, "utf8");

await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create table companies (id uuid primary key);
  create table designations (id uuid primary key, company_id uuid not null, code text, name text);
  create table employees (id uuid primary key, company_id uuid not null, full_name text, mobile text, designation_id uuid, is_active boolean default true, deleted_at timestamptz);
  create table contractors (id uuid primary key, company_id uuid not null, full_name text, mobile text, designation text, onboarding_status text, is_active boolean default true, deleted_at timestamptz);
  create table workforce (id uuid primary key, company_id uuid not null, full_name text, mobile text, designation text, designation_id uuid, onboarding_status text, approval_required boolean default true, is_active boolean default false, deleted_at timestamptz);
  create table vendors (id uuid primary key, company_id uuid not null, full_name text, mobile text, designation text, onboarding_status text, is_active boolean default true);
  create table workers (id uuid primary key, company_id uuid not null, full_name text, mobile text, designation text, onboarding_status text, is_active boolean default true, deleted_at timestamptz);
  create table workforce_helpers (id uuid primary key, company_id uuid not null, full_name text, mobile text, designation text, onboarding_status text, is_active boolean default true, deleted_at timestamptz);
  create table recruitment_leads (id uuid primary key, company_id uuid not null, normalized_phone text);
  create table recruitment_roles (id uuid primary key, company_id uuid not null, code text, name text);
  create table recruitment_job_requisitions (id uuid primary key, company_id uuid not null, role_id uuid);
  create table recruitment_applications (id uuid primary key, company_id uuid not null, lead_id uuid, requisition_id uuid, status text);
`);

await db.exec(migration);
await db.exec(schemaGuardMigration);

const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const company = uuid(1);
const teamLead = uuid(2);
const deliveryAssociate = uuid(3);
await db.query("insert into companies values ($1)", [company]);
await db.query("insert into designations values ($1,$2,'TL','Team Lead'),($3,$2,'DA','Delivery Associate')", [teamLead, company, deliveryAssociate]);
await db.query("insert into employees values ($1,$2,'Existing person','+91 98765-43210',$3,true,null)", [uuid(10), company, teamLead]);

await assert.rejects(
  db.query("insert into employees values ($1,$2,'Duplicate','9876543210',$3,true,null)", [uuid(11), company, teamLead]),
  /same designation is not allowed/
);
await assert.rejects(
  db.query("insert into contractors values ($1,$2,'Wrong product','9876543210','Delivery Associate','submitted',false,null)", [uuid(12), company]),
  /only a different Workforce engagement/i
);

await db.query("insert into workforce (id,company_id,full_name,mobile,designation,designation_id,onboarding_status,approval_required) values ($1,$2,'Secondary role','9876543210','Delivery Associate',$3,'under_review',true)", [uuid(13), company, deliveryAssociate]);
let workforce = (await db.query("select identity_exception_required, identity_exception_context from workforce where id=$1", [uuid(13)])).rows[0];
assert.equal(workforce.identity_exception_required, true);
assert.equal(workforce.identity_exception_context.reason, "existing_person_different_designation");
await assert.rejects(
  db.query("update workforce set onboarding_status='active', is_active=true where id=$1", [uuid(13)]),
  /explicitly approve/
);
await db.query("update workforce set onboarding_status='active', is_active=true, identity_exception_approved_at=now(), identity_exception_approved_by=$2 where id=$1", [uuid(13), uuid(20)]);
workforce = (await db.query("select onboarding_status from workforce where id=$1", [uuid(13)])).rows[0];
assert.equal(workforce.onboarding_status, "active");

const lead = uuid(30);
const requisition = uuid(31);
await db.query("insert into recruitment_leads values ($1,$2,'9876543210')", [lead, company]);
await db.query("insert into recruitment_roles values ($1,$2,'TL','Team Lead')", [uuid(32), company]);
await db.query("insert into recruitment_job_requisitions values ($1,$2,$3)", [requisition, company, uuid(32)]);
await assert.rejects(
  db.query("insert into recruitment_applications values ($1,$2,$3,$4,'applied')", [uuid(33), company, lead, requisition]),
  /same designation/
);

console.log("PASS: mobile identity migration compiles and enforces same-role blocking, Workforce-only exception approval, and recruitment duplicate prevention.");
await db.close();
