import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260907112000_coupang_scoped_publication_gate.sql",
  import.meta.url,
);

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("Coupang scoped gate keeps the global gate and retained receipts untouched", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.doesNotMatch(
    sql,
    /create\s+or\s+replace\s+function\s+sellerpilot_private\.listing_mutation_release_gate_is_effective\(\s*\)/iu,
  );
  assert.doesNotMatch(
    sql,
    /(?:update|delete\s+from)\s+sellerpilot_private\.channel_gateway_jobs/iu,
  );
  assert.doesNotMatch(sql, /66147e5d-0479-4c51-896e-97e782af99e1/iu);
  assert.doesNotMatch(sql, /sellerpilot_service_reserve_and_enqueue_listing_create/iu);
  assert.match(
    sql,
    /opened_channel\s+is\s+null\s+or\s+opened_channel\s+in\s*\(\s*'qoo10',\s*'coupang'\s*\)/iu,
  );
});

test("Qoo10 and Coupang are the only exact-release scoped channels", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const channelPredicate = between(
    sql,
    "create or replace function sellerpilot_private.listing_mutation_release_gate_is_effective(\n  p_channel text",
    "revoke all on function\n  sellerpilot_private.listing_publication_review_violation_count(text)",
  );
  const setter = between(
    sql,
    "create or replace function public.sellerpilot_service_set_listing_channel_mutation_release_gate(",
    "revoke all on function\n  public.sellerpilot_service_set_listing_channel_mutation_release_gate(",
  );

  assert.match(channelPredicate, /when gate\.opened_channel is null then\s+sellerpilot_private\.listing_mutation_release_gate_is_effective\(\)/iu);
  assert.match(channelPredicate, /p_channel = gate\.opened_channel\s+and p_channel in \('qoo10', 'coupang'\)/iu);
  assert.match(channelPredicate, /attested_listing_publication_release_sha\(\s*p_channel\s*\)/iu);
  assert.match(channelPredicate, /active_serverless_runtime_release_sha\(\)/iu);
  assert.match(channelPredicate, /listing_publication_review_violation_count\(\s*p_channel\s*\) = 0/iu);

  assert.match(setter, /p_channel not in \('qoo10', 'coupang'\)/iu);
  assert.match(setter, /v_attested_release is distinct from p_release_sha/iu);
  assert.match(setter, /v_active_runtime_release is distinct from p_release_sha/iu);
  assert.match(setter, /listing_publication_review_violation_count\(p_channel\)/iu);
  assert.match(setter, /where job\.channel = p_channel\s+and job\.operation in/iu);
  assert.match(
    setter,
    /job\.status = 'reconciliation_required'[\s\S]*?p_channel <> 'qoo10'[\s\S]*?qoo10_exact_s1_source_reconciliation_resolved\(job\.id\)[\s\S]*?temu_safe_test_source_reconciliation_resolved\(job\.id\)/iu,
  );
  assert.match(setter, /into v_global_running[\s\S]*?job\.status = 'running'/iu);
  assert.match(setter, /v_global_running <> 0/iu);
  assert.match(setter, /v_queued_or_running <> 0/iu);
  assert.match(setter, /v_reconciliation_required <> 0/iu);
});

test("status exposes exact Coupang evidence and preserves global reconciliation proofs", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const status = between(
    sql,
    "create or replace function public.sellerpilot_service_listing_mutation_release_gate_status()",
    "revoke all on function\n  public.sellerpilot_service_listing_mutation_release_gate_status()",
  );
  const qoo10Reconciliation = between(
    status,
    "'qoo10ReconciliationRequired'",
    "'qoo10EffectiveOpen'",
  );
  const coupangReconciliation = between(
    status,
    "'coupangReconciliationRequired'",
    "'coupangEffectiveOpen'",
  );
  const globalReconciliation = between(
    status,
    "'reconciliationRequired'",
    "from sellerpilot_private.listing_mutation_release_gate gate",
  );

  for (const field of [
    "coupangAdapterReady",
    "coupangAttestedRelease",
    "coupangReleaseConsistent",
    "coupangRuntimeReleaseMatches",
    "coupangReviewViolations",
    "coupangQueuedOrRunning",
    "coupangReconciliationRequired",
    "coupangEffectiveOpen",
    "listingMutationsRunning",
  ]) {
    assert.match(status, new RegExp(`'${field}'`));
  }
  assert.match(qoo10Reconciliation, /qoo10_exact_s1_source_reconciliation_resolved/iu);
  assert.match(qoo10Reconciliation, /temu_safe_test_source_reconciliation_resolved/iu);
  assert.match(coupangReconciliation, /job\.channel = 'coupang'/iu);
  assert.doesNotMatch(coupangReconciliation, /reconciliation_resolved/iu);

  for (const proof of [
    "qoo10_exact_s1_source_reconciliation_resolved",
    "temu_safe_test_source_reconciliation_resolved",
    "unstarted_listing_create_reconciliation_resolved",
    "elevenst_bound_listing_create_reconciliation_resolved",
  ]) {
    assert.match(globalReconciliation, new RegExp(proof));
  }
});
