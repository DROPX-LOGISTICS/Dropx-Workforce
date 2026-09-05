import assert from "node:assert/strict";
import test from "node:test";
import {
  assertOnboardingIdentityAllowed,
  identityExceptionEventMetadata,
  parseOnboardingIdentityEvaluation
} from "./onboarding-identity.ts";

const match = {
  source_type: "employees",
  source_id: "person-1",
  display_name: "Existing Person",
  designation_id: "designation-1",
  designation_code: "SSA",
  designation_name: "Station Support Associate",
  profile_status: "active"
};

test("same mobile and designation is always rejected", () => {
  const evaluation = parseOnboardingIdentityEvaluation({ normalized_mobile: "9999999999", exact_matches: [match] });
  assert.throws(
    () => assertOnboardingIdentityAllowed(evaluation, { allowDifferentWorkforceDesignation: true }),
    /same designation cannot be registered twice/i
  );
});

test("different designation is rejected outside Workforce", () => {
  const evaluation = parseOnboardingIdentityEvaluation({ normalized_mobile: "9999999999", other_matches: [match] });
  assert.throws(
    () => assertOnboardingIdentityAllowed(evaluation, { allowDifferentWorkforceDesignation: false }),
    /requires lifecycle approval/i
  );
});

test("different Workforce designation is retained as approval evidence", () => {
  const evaluation = parseOnboardingIdentityEvaluation({ normalized_mobile: "9999999999", other_matches: [match] });
  assert.doesNotThrow(() => assertOnboardingIdentityAllowed(evaluation, { allowDifferentWorkforceDesignation: true }));
  assert.deepEqual(identityExceptionEventMetadata(evaluation), {
    identity_exception_required: true,
    identity_exception_reason: "existing_person_different_designation",
    existing_profiles: [{
      source_type: "employees",
      source_id: "person-1",
      display_name: "Existing Person",
      designation_code: "SSA",
      designation_name: "Station Support Associate",
      profile_status: "active"
    }]
  });
});
