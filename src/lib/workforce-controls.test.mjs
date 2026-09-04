import assert from "node:assert/strict";
import test from "node:test";
import { assertWorkforceLocationAccess, canonicalAttendanceIdentity, isFieldActive, providerClearanceStatus } from "./workforce-controls.ts";
import { authorizeCampaignWorker, campaignWorkerHeaders } from "./workforce-campaign-worker.ts";
import { scopeWorkforceCampaigns } from "./workforce-campaign-scope.ts";

test("both the current record and its destination must belong to the operator", () => {
  const actor = { hasAllLocationAccess: false, locationScopeIds: ["A"] };
  assertWorkforceLocationAccess(actor, "A", "A");
  for (const ids of [["B", "A"], ["A", "B"], [null, "A"]]) assert.throws(() => assertWorkforceLocationAccess(actor, ...ids), /station access/);
  assertWorkforceLocationAccess({ ...actor, hasAllLocationAccess: true }, "A", "B");
});

test("negative or unknown provider status never implies clearance", () => {
  for (const status of ["inactive", "incomplete", "not cleared", "not active", "unknown", ""]) assert.equal(providerClearanceStatus(status), "pending");
  for (const status of ["active", "Complete", "cleared", " Done "]) assert.equal(providerClearanceStatus(status), "cleared");
});

test("attendance resolves aliases to one Workforce person and rejects People identities", () => {
  const identities = new Map([["workforce:canonical", "canonical"], ["contractor:legacy", "canonical"], ["employee:person", "canonical"]]);
  assert.equal(canonicalAttendanceIdentity({ profile_type: "workforce", account_id: "canonical" }, identities), "canonical");
  assert.equal(canonicalAttendanceIdentity({ profile_type: "contractor", account_id: "legacy" }, identities), "canonical");
  assert.equal(canonicalAttendanceIdentity({ profile_type: "employee", account_id: "person" }, identities), null);
  assert.equal(canonicalAttendanceIdentity({ profile_type: "workforce", account_id: "outside" }, identities), null);
  assert.equal(isFieldActive({ is_active: true, onboarding_status: "pending" }), false);
  assert.equal(isFieldActive({ is_active: true, onboarding_status: "active" }), true);
});

test("worker requests require configured cron authentication or an untampered campaign signature", () => {
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY, oldCron = process.env.CRON_SECRET;
  try {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-worker-signing-key";
    delete process.env.CRON_SECRET;
    const url = "https://workforce.example/api/whatsapp/process-campaigns";
    assert.equal(authorizeCampaignWorker(new Request(url)), null);
    const headers = campaignWorkerHeaders("00000000-0000-4000-8000-000000000001");
    assert.equal(authorizeCampaignWorker(new Request(url, { headers })).campaignId, headers["x-workforce-campaign"]);
    assert.equal(authorizeCampaignWorker(new Request(url, { headers: { ...headers, "x-workforce-campaign": "00000000-0000-4000-8000-000000000002" } })), null);
    assert.equal(authorizeCampaignWorker(new Request(url, { headers: { ...headers, "x-workforce-worker-time": "1" } })), null);
    process.env.CRON_SECRET = "cron-test";
    assert.deepEqual(authorizeCampaignWorker(new Request(url, { headers: { authorization: "Bearer cron-test" } })), { campaignId: null });
  } finally {
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
    if (oldCron === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = oldCron;
  }
});

test("scoped campaign history removes foreign recipients and recomputes visible counts", () => {
  const campaigns = [{ id: "campaign", total_count: 2, sent_count: 1, pending_count: 1, whatsapp_campaign_recipients: [
    { id: "in", source_id: "workforce:A", status: "sent" }, { id: "out", source_id: "workforce:B", status: "pending", recipient_mobile: "hidden" }
  ] }];
  const result = scopeWorkforceCampaigns(campaigns, [{ profileType: "workforce", accountId: "A" }], false);
  assert.equal(result[0].total_count, 1);
  assert.equal(result[0].pending_count, 0);
  assert.deepEqual(result[0].whatsapp_campaign_recipients.map(row => row.id), ["in"]);
  assert.equal(scopeWorkforceCampaigns(campaigns, [], false).length, 0);
});

 test("a notification retry reuses the inbox ID without crossing actors or recipients", async () => {
  const { workforceNotificationId } = await import("./workforce-notification-key.ts");
  const id = workforceNotificationId("company", "actor", "batch", "recipient");
  assert.equal(id, workforceNotificationId("company", "actor", "batch", "recipient"));
  assert.notEqual(id, workforceNotificationId("company", "other", "batch", "recipient"));
  assert.notEqual(id, workforceNotificationId("company", "actor", "batch", "other"));
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
});
