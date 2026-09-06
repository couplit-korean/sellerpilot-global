import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260905014300_retry_qoo10_shipping_s1_after_unclaimed_expiry.sql",
  import.meta.url,
);
const routeUrl = new URL(
  "../app/api/admin/products/[id]/qoo10-shipping-s1-release/route.ts",
  import.meta.url,
);
const identityUrl = new URL(
  "../lib/channels/qoo10-lotte-shipping-s1-identity.ts",
  import.meta.url,
);

const EXPIRED_ACTIVATION = "12eaf867-9ee5-45b1-aed0-b5456bc124a3";
const VERIFIER = "457b4481-0a66-4a76-89a0-884087d0c22e";

function functionBody(sql, signature) {
  const start = sql.indexOf(`create function ${signature}`);
  assert.notEqual(start, -1, `missing ${signature}`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated ${signature}`);
  return sql.slice(start, end + 4);
}

test("expired-before-claim retry preserves prior evidence and permits only one fresh retry", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const retry = functionBody(
    sql,
    "public.sellerpilot_service_retry_qoo10_shipping_s1_direct_reverify",
  );

  assert.match(sql, /Do not rewrite applied history/u);
  assert.ok(sql.includes(EXPIRED_ACTIVATION));
  assert.ok(sql.includes(VERIFIER));
  assert.match(sql, /attempt_count is distinct from 0/u);
  assert.match(sql, /provider_mutation_started_at is not null/u);
  assert.match(sql, /invalidation_reason is distinct from 'expired_before_claim'/u);
  assert.match(sql, /qoo10_shipping_s1_direct_retry_receipts/u);
  assert.match(sql, /failed_activation_job_id uuid not null unique/u);
  assert.match(sql, /qoo10_shipping_s1_one_active_verifier_permit/u);
  assert.match(sql, /where invalidated_at is null/u);
  assert.match(retry, /qoo10_shipping_s1_direct_reverify_expectation_valid/u);
  assert.match(retry, /qoo10_shipping_s1_create_retained_item_matches/u);
  assert.match(retry, /interval '2 minutes'/u);
  assert.match(retry, /direct-retry-1/u);
  assert.match(retry, /schedule_serverless_cs_wakeup/u);
  assert.doesNotMatch(
    retry,
    /(?:^|\n)\s*update sellerpilot_private\.channel_gateway_jobs/u,
  );
  assert.doesNotMatch(
    retry,
    /(?:^|\n)\s*update sellerpilot_private\.qoo10_shipping_s1_observations/u,
  );
  assert.doesNotMatch(retry, /enqueue_qoo10_shipping_s1_verifier/u);
  assert.doesNotMatch(retry, /open_channel_gate/u);
  assert.doesNotMatch(sql, /interval '3 minutes'/u);
});

test("concurrent claimers cannot give the Qoo10 slot to periodic reads while retry is fresh", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /qoo10_shipping_s1_fresh_activation_waiting\(\)/u);
  assert.match(sql, /guard_qoo10_shipping_s1_fresh_activation_slot/u);
  assert.match(sql, /guard_00_qoo10_shipping_s1_fresh_activation_slot/u);
  assert.match(sql, /old\.status = 'queued'/u);
  assert.match(sql, /new\.status = 'running'/u);
  assert.match(sql, /new\.channel = 'qoo10'/u);
  assert.match(
    sql,
    /not sellerpilot_private\.qoo10_shipping_s1_activation_claim_priority\(new\.id\)/u,
  );
  assert.match(sql, /errcode = 'SPC02'/u);
  assert.doesNotMatch(sql, /sellerpilot_183000_claim_serverless_gateway_unsafe/u);
  assert.doesNotMatch(sql, /sellerpilot_11820_claim_gateway_unsafe/u);
  assert.doesNotMatch(sql, /AND\s+sellerpilot_private\.qoo10_shipping_s1_verifier_job_matches/iu);
});

test("admin route exposes only the exact failed activation retry identity", async () => {
  const [route, identity] = await Promise.all([
    readFile(routeUrl, "utf8"),
    readFile(identityUrl, "utf8"),
  ]);

  assert.match(identity, /expiredUnclaimedActivationJobId/u);
  assert.ok(identity.includes(EXPIRED_ACTIVATION));
  assert.match(route, /action: z\.literal\("retry_reverify"\)/u);
  assert.match(route, /sellerpilot_service_retry_qoo10_shipping_s1_direct_reverify/u);
  assert.match(route, /expiredUnclaimedActivationJobId/u);
  assert.match(route, /runWithProviderReadOnlyTransport/u);
  assert.doesNotMatch(route, /process\.env/u);
});
