import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL("../app/api/admin/products/[id]/elevenst-cookie-create-recovery/route.ts", import.meta.url),
  "utf8",
);

test("cookie 11st recovery route authenticates before parse and stays GET-only toward 11st", () => {
  const auth = route.indexOf("authenticateAdminRequest");
  const parse = route.indexOf("requestSchema.safeParse");
  assert.ok(auth >= 0 && parse > auth);
  assert.match(route, /elevenstCookieCreateRecoveryGetMatches/);
  assert.match(route, /readElevenstSellerProdcode/);
  assert.match(route, /sellerpilot_service_record_elevenst_cookie_create_observation/);
  assert.match(route, /sellerpilot_service_bind_elevenst_cookie_create_observation/);
  assert.doesNotMatch(route, /listing\.create|prodservices\/product|executeChannelOperation/);
  assert.doesNotMatch(route, /method:\s*"(POST|PUT)"/);
  assert.match(route, /cache-control": "no-store/);
});
