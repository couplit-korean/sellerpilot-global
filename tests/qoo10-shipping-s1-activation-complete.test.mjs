import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260905014400_allow_qoo10_shipping_s1_activation_complete.sql",
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
const source14200Url = new URL(
  "../supabase/migrations/20260905014200_record_qoo10_shipping_s1_direct_reverify.sql",
  import.meta.url,
);

const ACTIVATION = "e09ab646-19ef-4865-a79e-08baef769086";
const EXPIRED_NO_CALL = "12eaf867-9ee5-45b1-aed0-b5456bc124a3";

function functionBody(sql, signature) {
  const candidates = [
    `create function ${signature}`,
    `create or replace function ${signature}`,
  ];
  const start = candidates
    .map((candidate) => sql.indexOf(candidate))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? -1;
  assert.notEqual(start, -1, `missing ${signature}`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated ${signature}`);
  return sql.slice(start, end + 4);
}

test("14400 skips only shipping permits in the inner generic completion wrapper", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /Do not rewrite applied history/u);
  assert.match(sql, /sellerpilot_133000_complete_gateway_before_temu_publication/u);
  assert.match(sql, /qoo10_shipping_s1_activation_permits permit/u);
  assert.match(sql, /20260905014100 records the shipping-S1 outcome/u);
  assert.match(sql, /record_exact_qoo10_s1_activation_outcome/u);
  assert.match(sql, /exact Qoo10 activation completion was not recorded/u);
  assert.match(sql, /v_occurrences is distinct from 1/u);
  assert.doesNotMatch(sql, /sellerpilot_183000_claim_serverless_gateway_unsafe/u);
  assert.doesNotMatch(sql, /sellerpilot_11820_claim_gateway_unsafe/u);
  assert.doesNotMatch(sql, /open_channel_gate/u);
});

test("GET-only recovery is pinned to the consumed activation and completes through the public transaction", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const recovery = functionBody(
    sql,
    "public.sellerpilot_service_complete_qoo10_shipping_s1_activation_from_get",
  );

  assert.ok(recovery.includes(ACTIVATION));
  assert.ok(recovery.includes(EXPIRED_NO_CALL));
  assert.match(recovery, /status is distinct from 'running'/u);
  assert.match(recovery, /provider_mutation_started_at is null/u);
  assert.match(recovery, /v_permit\.consumed_at is null/u);
  assert.match(recovery, /v_permit\.invalidated_at is not null/u);
  assert.match(recovery, /qoo10_shipping_s1_live_retained_item_matches/u);
  assert.match(recovery, /'providerStatus','S2'/u);
  assert.match(recovery, /observed_shipping_no/u);
  assert.match(recovery, /qoo10_shipping_s1_post_mutation_get_receipts/u);
  assert.match(recovery, /sellerpilot_service_complete_gateway_transaction/u);
  assert.match(recovery, /worker_token\.scope in \('gateway','legacy_combined','serverless_cs'\)/u);
  assert.match(recovery, /greatest\([\s\S]*interval '5 minutes'/u);
  assert.match(recovery, /providerMutationExecuted',false/u);
  assert.doesNotMatch(recovery, /enqueue_/u);
  assert.doesNotMatch(recovery, /EditGoodsStatus/u);
  assert.doesNotMatch(recovery, /insert into sellerpilot_private\.qoo10_shipping_s1_activation_permits/u);
  assert.doesNotMatch(recovery, /update sellerpilot_private\.qoo10_shipping_s1_direct_retry_receipts/u);
  assert.doesNotMatch(recovery, /update sellerpilot_private\.qoo10_shipping_s1_activation_outcomes/u);
});

test("live retained helper requires S2 while the 14200 create-retained helper remains S1", async () => {
  const [sql, source14200] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(source14200Url, "utf8"),
  ]);
  const live = functionBody(
    sql,
    "sellerpilot_private.qoo10_shipping_s1_live_retained_item_matches",
  );
  const retained = functionBody(
    source14200,
    "sellerpilot_private.qoo10_shipping_s1_create_retained_item_matches",
  );

  assert.match(live, /upper\(coalesce\(p_item->>'ItemStatus', p_item->>'Status', ''\)\) = 'S2'/u);
  assert.match(live, /qoo10_shipping_s1_create_retained_item_matches/u);
  assert.match(live, /jsonb_build_object\('ItemStatus','S1','Status','S1'\)/u);
  assert.match(retained, /= 'S1'/u);
  assert.doesNotMatch(retained, /= 'S2'/u);
});

test("admin completion action performs one read-only GET and calls only the pinned GET-complete RPC", async () => {
  const [route, identity] = await Promise.all([
    readFile(routeUrl, "utf8"),
    readFile(identityUrl, "utf8"),
  ]);

  assert.ok(identity.includes(ACTIVATION));
  assert.match(identity, /retryActivationJobId/u);
  assert.match(route, /action: z\.literal\("complete_reverify"\)/u);
  assert.match(route, /activationJobId: z\.string\(\)\.uuid\(\)/u);
  assert.match(route, /activationJobId[\s\S]*retryActivationJobId/u);
  assert.match(route, /runWithProviderReadOnlyTransport/u);
  assert.match(route, /ItemsLookup/u);
  assert.match(route, /GetItemDetailInfo/u);
  assert.match(route, /sellerpilot_service_complete_qoo10_shipping_s1_activation_from_get/u);
  assert.doesNotMatch(route, /EditGoodsStatus/u);
  assert.doesNotMatch(route, /process\.env/u);
});
