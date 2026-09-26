import test from "node:test";
import assert from "node:assert/strict";
import { amazonEmailFromPattern, isAmazonOnboardingRecord, resolveAmazonActivation, validAmazonEmailPattern } from "./amazon-activation.ts";

test("station email pattern is deterministic and station aware", () => {
  assert.equal(amazonEmailFromPattern("{first_name}.{station_code}@gmail.com", "Aakash Kumar", "KLZA"), "aakash.klza@gmail.com");
  assert.equal(validAmazonEmailPattern("{first_name}.{station_code}@gmail.com"), true);
  assert.equal(validAmazonEmailPattern("{first_name}@gmail.com"), false);
});

test("DA In-App rows are recognized without relying on column order", () => {
  assert.equal(isAmazonOnboardingRecord({ "Email ID": "a@b.com", "Station Code": "KLZA", "Pending Task": "BGC" }), true);
  assert.equal(isAmazonOnboardingRecord({ rabbit_id: "a@b.com", station_code: "KLZA", transporter_id: "20001", action_item: "No Further action required" }), true);
});

test("Amazon completion wording marks the ID active", () => {
  const result = resolveAmazonActivation("", "No Further action required", []);
  assert.equal(result.stage, "activated");
  assert.equal(result.label, "Amazon ID active");
});

test("configured guidance wins and exceptions stay visible", () => {
  const result = resolveAmazonActivation("BGC failed", "", [{ match_text: "bgc failed", stage_code: "failed", instruction: "Correct the submitted BGC details.", priority: 1 }]);
  assert.equal(result.stage, "failed");
  assert.equal(result.instruction, "Correct the submitted BGC details.");
});
