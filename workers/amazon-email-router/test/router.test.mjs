import test from "node:test";
import assert from "node:assert/strict";
import { cleanPreview, firstOnboardingActionLink } from "../src/index.js";

test("keeps previews while ignoring non-invitation Amazon paths", () => {
  const raw = "Click <a href=3D\"https://logistics.amazon.in/invite/abc\">Accept invitation</a>";
  assert.equal(firstOnboardingActionLink(raw), null);
  assert.match(cleanPreview(raw), /Accept invitation/);
});

test("extracts and cleans the Amazon invitation link", () => {
  const raw = "Accept [https://logistics.amazon.in/account-management/invitation?providerId=provider-1]";
  assert.equal(firstOnboardingActionLink(raw), "https://logistics.amazon.in/account-management/invitation?providerId=provider-1");
});

test("extracts a safe IDfy action link", () => {
  assert.equal(firstOnboardingActionLink("Verify at https://verify.idfy.com/session/token)."), "https://verify.idfy.com/session/token");
});

test("ignores unrelated and insecure links", () => {
  assert.equal(firstOnboardingActionLink("https://example.com/tracker"), null);
  assert.equal(firstOnboardingActionLink("http://verify.idfy.com/session/token"), null);
});
