import assert from "node:assert/strict";
import test from "node:test";
import { nextAdminAccessState } from "../app/_auth/admin-access-state";

test("keeps the mounted admin workspace during token refresh sign-in events", () => {
  assert.equal(nextAdminAccessState("admin", "SIGNED_IN", true), "admin");
  assert.equal(nextAdminAccessState("admin", "INITIAL_SESSION", true), "admin");
});

test("uses checking for unresolved sessions and signs out explicitly", () => {
  assert.equal(nextAdminAccessState("signed_out", "SIGNED_IN"), "checking");
  assert.equal(nextAdminAccessState("forbidden", "INITIAL_SESSION"), "checking");
  assert.equal(nextAdminAccessState("error", "SIGNED_IN"), "checking");
  assert.equal(nextAdminAccessState("admin", "SIGNED_OUT"), "signed_out");
  assert.equal(nextAdminAccessState("admin", "SIGNED_IN", false), "checking");
});

test("keeps a bounded verification error until a new sign-in event or explicit retry", () => {
  assert.equal(nextAdminAccessState("error", "TOKEN_REFRESHED"), "error");
  assert.equal(nextAdminAccessState("error", "INITIAL_SESSION"), "checking");
});
