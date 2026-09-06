import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../scripts/elevenst-cookie-create-bind-once.mjs", import.meta.url),
  "utf8",
);

test("11st one-shot binder GET-verifies before exact receipt and bind RPCs", () => {
  const readAt = source.indexOf("readElevenstSellerProdcode");
  const matchAt = source.lastIndexOf("elevenstCookieCreateRecoveryGetMatches");
  const recordAt = source.indexOf("sellerpilot_service_record_elevenst_cookie_create_observation");
  const bindAt = source.indexOf("sellerpilot_service_bind_elevenst_cookie_create_observation");
  assert.ok(readAt >= 0 && matchAt > readAt && recordAt > matchAt && bindAt > recordAt);
  assert.match(source, /sellerpilot_service_get_elevenst_cookie_create_recovery_status/);
  assert.match(source, /payload\.api_key = ""/);
  assert.doesNotMatch(source, /listing\.create|sellerpilot_claim_channel_gateway_job|channel_gateway_jobs[\s\S]*update/i);
  assert.doesNotMatch(source, /console\.log\([^\n]*(apiKey|serviceRole|managementToken)/);
});
