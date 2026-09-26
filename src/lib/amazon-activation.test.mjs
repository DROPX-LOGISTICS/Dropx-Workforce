import test from "node:test";
import assert from "node:assert/strict";
import { amazonEmailFromPattern, isAmazonOnboardingRecord, resolveAmazonActivation, validAmazonEmailPattern } from "./amazon-activation.ts";

test("station email pattern is deterministic and station aware", () => {
  assert.equal(amazonEmailFromPattern("{first_name}.{station_code}@gmail.com", "Aakash Kumar", "KLZA"), "aakash.klza@gmail.com");
  assert.equal(validAmazonEmailPattern("{first_name}.{station_code}@gmail.com"), true);
  assert.equal(validAmazonEmailPattern("{first_name}@gmail.com"), false);
});

test("DANAP rows are recognized without relying on column order", () => {
  assert.equal(isAmazonOnboardingRecord({ "Email ID": "a@b.com", "Station Code": "KLZA", "Pending Task": "BGC" }), true);
});

test("configured guidance wins and exceptions stay visible", () => {
  const result = resolveAmazonActivation("BGC failed", "", [{ match_text: "bgc failed", stage_code: "failed", instruction: "Correct the submitted BGC details.", priority: 1 }]);
  assert.equal(result.stage, "failed");
  assert.equal(result.instruction, "Correct the submitted BGC details.");
});
