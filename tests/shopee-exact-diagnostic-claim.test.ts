import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const JOB_ID = "e3ef63f5-cd39-4883-898c-60399dbf449c";
const SHOP_ID = "1719148844";
const RECON_CREATE = "99d3b370-4ac6-4007-8bc3-b863c2badd17";
const RECON_SUGGEST = "34401d1f-a99b-487a-a7a6-3f2feafd81ae";
const RECON_ORDERS = "94301837-08b6-4fc1-9a64-29a82f4f143f";

const migrationUrl = new URL(
  "../supabase/migrations/20260905011000_claim_exact_queued_shopee_diagnostic.sql",
  import.meta.url,
);
const scriptUrl = new URL(
  "../scripts/shopee-exact-diagnostic-once.mjs",
  import.meta.url,
);
const identityUrl = new URL(
  "../lib/channels/shopee-exact-diagnostic-identity.ts",
  import.meta.url,
);

test("exact Shopee diagnostic claim SQL is fail-closed to one queued GET job", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /create function public\.sellerpilot_claim_exact_shopee_diagnostic_job\(/);
  assert.match(migration, new RegExp(JOB_ID));
  assert.match(migration, /j\.channel = 'shopee'/);
  assert.match(migration, /j\.operation = 'diagnostic\.test'/);
  assert.match(migration, /j\.status = 'queued'/);
  assert.match(migration, /j\.provider_mutation_started_at is null/);
  assert.match(migration, /p_job_id is distinct from/);
  assert.match(migration, /for update of j, c skip locked/);
  assert.match(migration, /where j\.id = v_job_id/);
  assert.doesNotMatch(migration, /with expired as \(/);
  assert.doesNotMatch(migration, /sellerpilot_claim_channel_gateway_job/);
  assert.doesNotMatch(migration, /status = 'cancelled'/);
  assert.doesNotMatch(migration, new RegExp(RECON_CREATE));
  assert.doesNotMatch(migration, new RegExp(RECON_SUGGEST));
  assert.doesNotMatch(migration, new RegExp(RECON_ORDERS));
  assert.doesNotMatch(migration, /listing\.create/);
  assert.doesNotMatch(migration, /oauth\.exchange/);
  assert.match(migration, /revoke all on function public\.sellerpilot_claim_exact_shopee_diagnostic_job/);
});

test("exact Shopee diagnostic worker script never uses generic claim", async () => {
  const [script, identity] = await Promise.all([
    readFile(scriptUrl, "utf8"),
    readFile(identityUrl, "utf8"),
  ]);
  assert.match(identity, new RegExp(JOB_ID));
  assert.match(identity, new RegExp(SHOP_ID));
  assert.match(script, /sellerpilot_claim_exact_shopee_diagnostic_job/);
  assert.match(script, /\/api\/v2\/shop\/get_shop_info/);
  assert.match(script, /acceptSignedRequestBinding: true/);
  assert.match(script, /\/api\/channel-gateway\/worker\/complete/);
  assert.doesNotMatch(script, /\/api\/channel-gateway\/worker\/claim"/);
  assert.doesNotMatch(script, /sellerpilot_claim_channel_gateway_job/);
  assert.doesNotMatch(script, /gateway:worker:once/);
  assert.doesNotMatch(script, /--gateway-only/);
  assert.doesNotMatch(script, /ensureShopeeAccessToken/);
  assert.doesNotMatch(script, /access_token\/get/);
  assert.doesNotMatch(script, /listing\.create/);
  assert.doesNotMatch(script, new RegExp(RECON_CREATE));
});
