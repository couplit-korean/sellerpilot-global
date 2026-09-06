import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sqlUrl = new URL(
  "../supabase/migrations/20260905014500_allow_exact_qoo10_completion_before_runtime_reactivation.sql",
  import.meta.url,
);
const sql = await readFile(sqlUrl, "utf8");

test("14500 breaks only the exact consumed-activation canary cycle", () => {
  assert.match(sql, /qoo10_shipping_s1_completion_release_is_current/);
  assert.match(sql, /attested_listing_publication_release_sha\('qoo10'\)\s*= p_release_sha/);
  assert.match(sql, /active_serverless_runtime_release_sha\(\) is null/);
  assert.match(sql, /select count\(\*\) = 6 and bool_and\(not job\.active\)/);
  assert.match(sql, /job\.id = 'e09ab646-19ef-4865-a79e-08baef769086'/);
  assert.match(sql, /job\.status = 'running'/);
  assert.match(sql, /job\.provider_mutation_started_at is not null/);
  assert.match(sql, /permit\.consumed_at is not null/);
  assert.match(sql, /retry\.failed_activation_job_id\s*=\s*'12eaf867-9ee5-45b1-aed0-b5456bc124a3'/);
  assert.match(sql, /qoo10_shipping_s1_post_mutation_get_receipts/);
  assert.match(sql, /outcome\.terminal_status = 'succeeded'/);
  assert.match(sql, /listing\.status = 'published'/);
  assert.match(sql, /listing\.provider_status = 'S2'/);
  assert.match(sql, /completion\.job_id = job\.id/);
  assert.match(sql, /listing_mutation_release_gate_is_effective\('qoo10'\)/);
});

test("14500 changes only the GET-completion release predicate", () => {
  assert.match(
    sql,
    /sellerpilot_service_complete_qoo10_shipping_s1_activation_from_get\(uuid,text,jsonb\)/,
  );
  assert.match(
    sql,
    /v_needle constant text :=\s*'or not sellerpilot_private\.qoo10_shipping_s1_release_is_current\(p_release_sha\)'/,
  );
  assert.match(
    sql,
    /v_replacement constant text :=\s*'or not \(sellerpilot_private\.qoo10_shipping_s1_release_is_current\(p_release_sha\) or sellerpilot_private\.qoo10_shipping_s1_completion_release_is_current\(p_release_sha\)\)'/,
  );
  assert.doesNotMatch(sql, /update\s+sellerpilot_private\.channel_gateway_jobs/i);
  assert.doesNotMatch(sql, /EditGoodsStatus/);
  assert.doesNotMatch(sql, /sellerpilot_service_retry_qoo10_shipping_s1_direct_reverify/);
  assert.doesNotMatch(sql, /sellerpilot_service_enqueue_qoo10_shipping_s1_activation/);
});
