import test from "node:test";
import assert from "node:assert/strict";
import { cleanPreview, firstAmazonLink } from "../src/index.js";

test("extracts a secure Amazon action link from MIME-like content", () => {
  const raw = "Click <a href=3D\"https://logistics.amazon.in/invite/abc\">Accept invitation</a>";
  assert.equal(firstAmazonLink(raw), "https://logistics.amazon.in/invite/abc");
  assert.match(cleanPreview(raw), /Accept invitation/);
});

test("ignores unrelated links", () => {
  assert.equal(firstAmazonLink("https://example.com/tracker"), null);
});
