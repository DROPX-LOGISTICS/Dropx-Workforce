import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://workforce-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";
let responses;
let requests;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  assert.equal(url.hostname, "workforce-test.supabase.co");
  requests.push(url);
  const table = url.pathname.split("/").at(-1);
  assert.ok(Object.hasOwn(responses, table), `Unexpected table: ${table}`);
  const response = responses[table];
  return new Response(JSON.stringify(response), {
    status: Array.isArray(response) ? 200 : 400,
    headers: { "Content-Type": "application/json" }
  });
};
after(() => { globalThis.fetch = originalFetch; });

const { loadWorkforceCommunicationRecipients } = await import("./workforce-communication-recipients.ts");
const authorization = { companyId: "company-1", hasAllLocationAccess: true, locationScopeIds: [] };
const row = (id, overrides = {}) => ({
  id, full_name: id, designation: "Delivery Associate", onboarding_status: "pending",
  is_active: true, ...overrides
});
const missingTable = (table, code = "PGRST205") => ({
  code,
  message: code === "42P01" ? `relation "public.${table}" does not exist`
    : `Could not find the table 'public.${table}' in the schema cache`
});

beforeEach(() => {
  requests = [];
  responses = {
    designations: [
      { code: "DA", name: "Delivery Associate", designation_category: { people_module: "delivery_network" } },
      { code: "HR", name: "HR Associate", designation_category: { people_module: "people_hr" } }
    ],
    workforce: [row("canonical-1", { source_profile_type: "field_executive", source_profile_id: "moved-1" })],
    field_executives: [], contractors: [], vendors: [], workers: [], workforce_identity_links: []
  };
});

test("retired tables do not erase canonical Workforce recipients", async () => {
  for (const code of ["PGRST205", "42P01"]) {
    responses.field_executives = missingTable("field_executives", code);
    responses.workers = missingTable("workers", code);
    const result = await loadWorkforceCommunicationRecipients(authorization);
    assert.deepEqual(result.map(({ accountId, profileType }) => ({ accountId, profileType })), [
      { accountId: "canonical-1", profileType: "workforce" }
    ]);
  }
});

test("pending registrations survive while migrated aliases and People profiles stay excluded", async () => {
  responses.field_executives = [row("pending-1"), row("moved-1"), row("people-1", { designation: "HR Associate" })];
  responses.contractors = [row("contractor-1")];
  responses.workers = [row("worker-1")];
  responses.workforce_identity_links = [
    { legacy_profile_type: "field_executive", legacy_profile_id: "moved-1", target_profile_type: "workforce" }
  ];
  const result = await loadWorkforceCommunicationRecipients(authorization);
  assert.deepEqual(result.map(({ accountId }) => accountId), ["canonical-1", "contractor-1", "pending-1", "worker-1"]);
  for (const id of ["pending-1", "contractor-1"]) {
    assert.equal(result.find(({ accountId }) => accountId === id).compatibilityMode, true);
  }
});

test("required sources, permissions, columns and unrelated missing relations remain errors", async () => {
  for (const table of ["workforce", "contractors", "vendors", "workforce_identity_links", "designations"]) {
    const original = responses[table];
    responses[table] = missingTable(table);
    await assert.rejects(loadWorkforceCommunicationRecipients(authorization), /schema cache/);
    responses[table] = original;
  }
  for (const table of ["field_executives", "workers"]) {
    for (const error of [
      { code: "42501", message: `permission denied for table ${table}` },
      { code: "PGRST204", message: "Could not find a column in the schema cache" },
      missingTable("stations"), missingTable("stations", "42P01")
    ]) {
      responses[table] = error;
      await assert.rejects(loadWorkforceCommunicationRecipients(authorization), { message: error.message });
    }
    responses[table] = [];
  }
});

test("company and location restrictions still apply to all profile queries", async () => {
  responses.field_executives = missingTable("field_executives");
  responses.workers = missingTable("workers");
  for (const locations of [["station-1"], []]) {
    requests = [];
    await loadWorkforceCommunicationRecipients({ ...authorization, hasAllLocationAccess: false, locationScopeIds: locations });
    for (const request of requests) {
      assert.equal(request.searchParams.get("company_id"), "eq.company-1");
      if (["workforce", "field_executives", "contractors", "vendors", "workers"].includes(request.pathname.split("/").at(-1))) {
        assert.equal(request.searchParams.get("location_id"), `in.(${locations[0] ?? "00000000-0000-0000-0000-000000000000"})`);
      }
    }
    const canonical = requests.find((request) => request.pathname.endsWith("/workforce"));
    assert.equal(canonical.searchParams.get("deleted_at"), "is.null");
    assert.equal(canonical.searchParams.get("migration_state"), "neq.reclassified");
  }
});
