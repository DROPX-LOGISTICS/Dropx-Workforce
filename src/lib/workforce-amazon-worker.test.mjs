import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isCanonicalWorkforceId } from "./workforce-amazon-worker.ts";

const source = readFileSync(new URL("./workforce-amazon-worker.ts", import.meta.url), "utf8");

test("Amazon lifecycle rejects worker-generated IDfy keys as Workforce UUIDs", () => {
  assert.equal(isCanonicalWorkforceId("3cf142a1-27d4-4605-8907-ce2e824397d7"), true);
  assert.equal(isCanonicalWorkforceId("idfy:19901162"), false);
  assert.equal(isCanonicalWorkforceId(""), false);
});

test("Amazon lifecycle keeps IDfy-only rows away from associate mutations", () => {
  const page = readFileSync(new URL("../app/delivery-network/amazon-lifecycle/page.tsx", import.meta.url), "utf8");
  assert.match(page, /linkedAssociate && row\.bucket === "not_onboarded"/);
  assert.match(page, /linkedAssociate && row\.amazon\?\.providerId/);
});
