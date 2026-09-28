import assert from "node:assert/strict";
import test from "node:test";
import {
  authOriginFromHeaders,
  authSurfaceOrigin,
  isWorkforceAuthSurface,
  safeAuthNextPath,
  workforceDestination
} from "./auth-surface-routing.ts";

test("Workforce login keeps its OAuth callback on Workforce", () => {
  assert.equal(authOriginFromHeaders(new Headers({
    origin: "https://workforce.dropxlogistics.com",
    "x-forwarded-host": "dashboard.dropxlogistics.com"
  })), "https://workforce.dropxlogistics.com");

  assert.equal(authOriginFromHeaders(new Headers({
    referer: "https://workforce.dropxlogistics.com/login?next=%2F",
    "x-forwarded-host": "dashboard.dropxlogistics.com"
  })), "https://workforce.dropxlogistics.com");
});

test("untrusted origins cannot choose an OAuth callback host", () => {
  assert.equal(authOriginFromHeaders(new Headers({
    origin: "https://malicious.example",
    "x-forwarded-host": "malicious.example"
  })), "http://localhost:3000");
});

test("Workforce callback only returns to Workforce routes", () => {
  assert.equal(isWorkforceAuthSurface("dashboard.dropxlogistics.com", "workforce"), true);
  assert.equal(isWorkforceAuthSurface("dashboard.dropxlogistics.com", "dashboard"), false);
  assert.equal(isWorkforceAuthSurface("workforce.dropxlogistics.com", null), true);
  assert.equal(isWorkforceAuthSurface("admin-panel.dropxlogistics.com", "workforce"), false);
  assert.equal(authSurfaceOrigin("dashboard.dropxlogistics.com", "workforce", "https://dashboard.dropxlogistics.com"), "https://workforce.dropxlogistics.com");
  assert.equal(workforceDestination(""), "/delivery-network");
  assert.equal(workforceDestination("/delivery-network/id-onboarding?view=pending"), "/delivery-network/id-onboarding?view=pending");
  assert.match(workforceDestination("/dashboard"), /^\/unauthorized\?/);
  assert.equal(safeAuthNextPath("https://dashboard.dropxlogistics.com/dashboard"), "");
});
