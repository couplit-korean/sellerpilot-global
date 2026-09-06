import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260906070000_evidence_based_global_publication_gate_counters.sql",
    import.meta.url,
  ),
  "utf8",
);

const predicates = [
  "sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(job.id)",
  "sellerpilot_private.temu_safe_test_source_reconciliation_resolved(job.id)",
  "sellerpilot_private.unstarted_listing_create_reconciliation_resolved(job.id)",
  "sellerpilot_private.elevenst_bound_listing_create_reconciliation_resolved(job.id)",
];

test("keeps the frozen pre-publication-review counter untouched", () => {
  assert.doesNotMatch(
    migration,
    /(create|alter|drop)[\s\S]{0,80}sellerpilot_301100_listing_gate_status_pre_publication_review/i,
  );
  assert.match(
    migration,
    /select public\.sellerpilot_301100_listing_gate_status_pre_publication_review\(\)/,
  );
});

test("never rewrites retained receipts, listings or immutability guards", () => {
  assert.doesNotMatch(migration, /update\s+sellerpilot_private\.channel_gateway_jobs/i);
  assert.doesNotMatch(migration, /delete\s+from\s+sellerpilot_private\./i);
  assert.doesNotMatch(migration, /update\s+sellerpilot_private\.product_listings/i);
  assert.doesNotMatch(migration, /drop\s+trigger/i);
  assert.doesNotMatch(migration, /drop\s+function/i);
  assert.doesNotMatch(migration, /alter\s+table/i);
});

test("applies the identical predicate set to status and gate opening", () => {
  const statusBlock = migration.slice(
    migration.indexOf("'reconciliationRequired', ("),
  );
  const openBlock = migration.slice(
    migration.indexOf("into v_queued_or_running, v_reconciliation_required"),
  );
  for (const predicate of predicates) {
    assert.ok(statusBlock.includes(predicate), `status counter misses ${predicate}`);
    assert.ok(openBlock.includes(predicate), `gate opener misses ${predicate}`);
  }
});

test("still counts listing writes and keeps the queued drain requirement", () => {
  assert.match(
    migration,
    /'listing\.create', 'listing\.update', 'listing\.stop'\n\s*\)\n\s*and job\.status = 'reconciliation_required'/,
  );
  assert.match(migration, /listing mutation jobs must drain before release-gate activation/);
  assert.match(
    migration,
    /listing mutation reconciliations must be resolved before release-gate activation/,
  );
});

test("keeps every gate status key the API schema requires", () => {
  const keys = [
    "contract",
    "open",
    "state",
    "effectiveOpen",
    "openedAt",
    "updatedAt",
    "openedRelease",
    "openedChannel",
    "attestedRelease",
    "activeRuntimeRelease",
    "publicationAdaptersReady",
    "publicationRecheckerReady",
    "publicationReleaseConsistent",
    "runtimeReleaseMatches",
    "orphanPendingReviews",
    "queuedOrRunning",
    "reconciliationRequired",
    "qoo10AdapterReady",
    "qoo10AttestedRelease",
    "qoo10ReleaseConsistent",
    "qoo10RuntimeReleaseMatches",
    "qoo10ReviewViolations",
    "qoo10QueuedOrRunning",
    "qoo10ReconciliationRequired",
    "qoo10EffectiveOpen",
  ];
  for (const key of keys) {
    assert.ok(
      migration.includes(`'${key}'`) || migration.includes(`sellerpilot_301100_`),
      `gate status must still provide ${key}`,
    );
  }
  assert.match(migration, /'reconciliationRequired', \(/);
  assert.match(migration, /'qoo10ReconciliationRequired', \(/);
});

test("the unstarted predicate demands proof that no provider write began", () => {
  const start = migration.indexOf("$unstarted_listing_create$");
  const body = migration.slice(start, migration.indexOf("$unstarted_listing_create$", start + 1));
  assert.match(body, /job\.provider_mutation_started_at is null/);
  assert.match(body, /job\.response_payload is null/);
  assert.match(body, /job\.write_resource_key is null/);
  assert.match(body, /listing\.remote_id is null/);
  assert.match(body, /listing\.provider_resource_id is null/);
  assert.match(body, /job\.operation = 'listing\.create'/);
  assert.match(body, /job\.status = 'reconciliation_required'/);
});

test("the 11st predicate demands the recorded bind and matching remote identity", () => {
  const start = migration.indexOf("$elevenst_bound_listing_create$");
  const body = migration.slice(
    start,
    migration.indexOf("$elevenst_bound_listing_create$", start + 1),
  );
  assert.match(body, /elevenst_cookie_create_get_observations/);
  assert.match(body, /observation\.bound_at is not null/);
  assert.match(body, /observation\.prodmarket_accepted/);
  assert.match(body, /observation\.seller_prd_cd_matched/);
  assert.match(body, /listing\.remote_id = observation\.remote_id/);
  assert.match(body, /listing\.marketplace_sku = observation\.seller_sku/);
  assert.match(body, /job\.status = 'reconciliation_required'/);
});

test("new predicates stay private, definer-safe and unreachable from clients", () => {
  for (const name of [
    "unstarted_listing_create_reconciliation_resolved",
    "elevenst_bound_listing_create_reconciliation_resolved",
  ]) {
    assert.match(
      migration,
      new RegExp(`create or replace function sellerpilot_private\\.${name}`),
    );
    assert.match(
      migration,
      new RegExp(
        `revoke all on function sellerpilot_private\\.${name}\\(uuid\\)\\n  from public, anon, authenticated, service_role;`,
      ),
    );
  }
  const definerCount = migration.match(/security definer/gi) ?? [];
  const searchPathCount = migration.match(/set search_path = ''/g) ?? [];
  assert.ok(definerCount.length >= 2);
  assert.ok(searchPathCount.length >= 2);
});

test("runs as one reviewed transaction", () => {
  assert.match(migration, /^-- Evidence-based global publication gate counters\./);
  assert.match(migration, /\nbegin;\n/);
  assert.match(migration, /\ncommit;\n$/);
});
