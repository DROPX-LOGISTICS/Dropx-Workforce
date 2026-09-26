import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260926153000_workforce_referral_and_activation_gate.sql", import.meta.url), "utf8");
const [beforeReview, reviewBody = ""] = migration.split("create or replace function public.workforce_review_amazon_provider_candidate");

test("report reconciliation proposes a Provider ID without activating or mapping", () => {
  assert.match(beforeReview, /provider_candidate_status='pending'/);
  assert.doesNotMatch(beforeReview, /set provider_stage='activated'/);
  assert.doesNotMatch(beforeReview, /update public\.workforce set provider_id_status='created'/);
  assert.doesNotMatch(beforeReview, /insert into public\.field_executive_provider_mappings/);
});

test("an explicit scoped review confirms or dismisses the suggestion", () => {
  assert.match(reviewBody, /p_decision not in \('confirm','dismiss'\)/);
  assert.match(reviewBody, /provider_candidate_status='dismissed'/);
  assert.match(reviewBody, /provider_stage='activated'/);
  assert.match(reviewBody, /provider_candidate_status='confirmed'/);
  assert.match(reviewBody, /worker\.location_id=any\(p_locations\)/);
});
