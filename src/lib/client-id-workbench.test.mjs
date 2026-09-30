import test from "node:test";
import assert from "node:assert/strict";
import { clientIdBucket, isClientIdReadiness } from "./client-id-workbench.ts";

const partner = (changes = {}) => ({
  stage: "invitation_sent",
  action_item: null,
  label: "Invitation sent · ID setup pending",
  instruction: "Complete onboarding",
  can_trigger: false,
  ...changes,
});

test("mapping dependencies remain in Client ID until a user confirms the provider mapping", () => {
  assert.equal(clientIdBucket(partner({ stage: "mapping_pending" }), { phase: "mapping" }), "mapping");
  assert.equal(isClientIdReadiness({ phase: "mapping" }), true);
});

test("only explicit IDfy or insufficiency evidence enters the BGC insufficiency desk", () => {
  assert.equal(clientIdBucket(partner({ stage: "background_check", action_item: "Complete video verification" }), { phase: "partner" }), "progress");
  assert.equal(clientIdBucket(partner({ stage: "exception", action_item: "IDFY insufficiency: PAN image unclear" }), { phase: "partner" }), "bgc");
});

test("ready and failed invitations stay in the visible trigger desk", () => {
  assert.equal(clientIdBucket(partner({ stage: "id_creation_pending", can_trigger: true }), { phase: "partner" }), "trigger");
  assert.equal(clientIdBucket(partner({ stage: "invitation_failed", can_trigger: true }), { phase: "partner" }), "trigger");
});

test("DA In-App workflow stages remain in progress while non-BGC exceptions are blocked", () => {
  assert.equal(clientIdBucket(partner({ stage: "learning", action_item: "Complete NSDA course" }), { phase: "partner" }), "progress");
  assert.equal(clientIdBucket(partner({ stage: "exception", action_item: "Email rejected by client" }), { phase: "partner" }), "blocked");
});

