import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260831057000_retire_stale_qoo10_s1_verifier.sql",
  import.meta.url,
);

const oldVerifierJobId = "ea191079-3016-4851-9f0c-4ce4281c1364";
const sourceJobId = "fac9c5c4-940d-4600-88f3-8f97a069dfbf";
const listingId = "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc";
const credentialId = "2b49d081-5188-4a75-9555-e0a6438e8a2b";

async function migrationSql() {
  return readFile(migrationUrl, "utf8");
}

function position(sql, pattern, message) {
  const index = typeof pattern === "string" ? sql.indexOf(pattern) : sql.search(pattern);
  assert.ok(index >= 0, message ?? `missing ${String(pattern)}`);
  return index;
}

test("57000 pins the exact stale verifier, receipt, and immutable run evidence", async () => {
  const sql = await migrationSql();

  for (const exact of [
    oldVerifierJobId,
    sourceJobId,
    "4402cc76-295b-4e17-8c07-d5d0e9967ce9",
    listingId,
    credentialId,
    "1217336970",
    "76be7b79b89497d6841fb3fd921b5ffb57036ea3a93029fa8fa84f6440e85799",
    "e7704614d8de834910f0ef69e49a9d2952c53b6ce66574552eb4d79c81146657",
    "2cc89af533c1620ed011ef0627d460bac55187d2647d3542602e0ef488b1ba43",
    "c3891de7dfafed37bc3c027d25468ea1e778b69173db56e8a7a4ed10264f4624",
    "0f946a9e9235b5a76543b4b8b37777799e4ffa023c509db23ff848a97bbdfef3",
    "98d556a6de7b1adc8be91b87fc133eece7698fe9897991fb6dc57fbe0e4ee993",
    "8c9072a7901e6aef3f113354d2ab5eb85176e3fc69da28805384be5f06e278ce",
    "24f77db892cc3e115fe8ee042ca3f7d10c1fa01916824d5fdbffa523505e1001",
    "eaee02055c8a65db7b5cd20481fe87946fd3fd5c",
    "2026-08-31T01:43:55.624114+00:00",
  ]) {
    assert.ok(sql.includes(exact), `missing exact production anchor ${exact}`);
  }

  for (const byteLength of [35120, 662, 32714, 142, 337, 911]) {
    assert.match(
      sql,
      new RegExp(`(?:octet_length|bytes?)[\\s\\S]{0,120}${byteLength}`),
      `exact evidence byte length ${byteLength} must be checked`,
    );
  }

  for (const [table, variable] of [
    ["channel_gateway_jobs", "v_old_job_before"],
    ["gateway_completion_receipts", "v_receipt_before"],
    ["qoo10_exact_s1_verifier_runs", "v_run_before"],
  ]) {
    assert.match(
      sql,
      new RegExp(`select\\s+to_jsonb\\([^)]*\\)\\s+into\\s+strict\\s+${variable}[\\s\\S]{0,160}${table}`, "i"),
    );
    assert.match(sql, new RegExp(`digest\\(${variable}::text,\\s*'sha256'\\)`, "i"));
  }
});

test("57000 distinguishes a clean install no-op from partial production anchors", async () => {
  const sql = await migrationSql();
  const cleanFence = position(
    sql,
    /if\s+v_source_count\s*=\s*0[\s\S]*?v_prior_audit_count\s*=\s*0\s+then/i,
  );
  assert.ok(position(sql.slice(cleanFence), /return\s*;/i) >= 0);
  const partialFence = position(
    sql,
    /if\s+v_history_table\s+is\s+null[\s\S]*?v_prior_audit_count\s*<>\s*0[\s\S]*?then/i,
  );
  assert.ok(position(
    sql.slice(partialFence),
    /raise exception 'exact Qoo10 verifier retirement anchors are partial or drifted'/i,
  ) >= 0);

  for (const [table, variable] of [
    ["channel_gateway_jobs", "v_source_count"],
    ["channel_operation_attempts", "v_source_attempt_count"],
    ["gateway_completion_receipts", "v_receipt_count"],
    ["qoo10_exact_s1_verifier_runs", "v_run_count"],
    ["qoo10_exact_s1_observations", "v_evidence_count"],
    ["qoo10_exact_s1_activation_permits", "v_evidence_count"],
    ["qoo10_exact_s1_activation_outcomes", "v_evidence_count"],
    ["listing_publication_reviews", "v_review_count"],
    ["product_listings", "v_listing_count"],
    ["products", "v_product_count"],
    ["channel_credentials", "v_credential_count"],
    ["operation_audit", "v_prior_audit_count"],
  ]) {
    assert.match(
      sql,
      new RegExp(
        `(?:${table}[\\s\\S]{0,1600}${variable}|${variable}[\\s\\S]{0,1600}${table})`,
        "i",
      ),
    );
  }

  assert.match(sql, /supabase_migrations\.schema_migrations/i);
  for (const version of ["20260831056700", "20260831056800", "20260831056900"]) {
    assert.ok(sql.includes(version));
  }
  assert.match(sql, /pg_get_functiondef/i);
  assert.match(sql, /pg_get_indexdef/i);
  assert.match(sql, /pg_get_triggerdef/i);
  assert.ok((sql.match(/'[a-f0-9]{32}'/g) ?? []).length >= 3);
});

test("57000 serializes the one-shot repair before locking exact rows", async () => {
  const sql = await migrationSql();
  assert.match(sql, /^\s*begin\s*;/im);
  assert.match(sql, /set local lock_timeout = '5s'/i);
  assert.match(sql, /set local statement_timeout = '30s'/i);

  const advisory = position(sql, /pg_advisory_xact_lock\(193674993,\s*821065042\)/);
  const lockStart = position(sql, /lock table\s+sellerpilot_private\.channel_gateway_jobs/i);
  const lockEnd = position(sql, /in share row exclusive mode/i);
  assert.ok(advisory < lockStart && lockStart < lockEnd);
  const lockClause = sql.slice(lockStart, lockEnd);
  for (const table of [
    "channel_gateway_jobs",
    "channel_operation_attempts",
    "gateway_completion_receipts",
    "qoo10_exact_s1_verifier_runs",
    "qoo10_exact_s1_observations",
    "qoo10_exact_s1_activation_permits",
    "qoo10_exact_s1_activation_outcomes",
    "listing_publication_reviews",
    "product_listings",
    "products",
    "channel_credentials",
    "operation_audit",
  ]) {
    assert.ok(lockClause.includes(`sellerpilot_private.${table}`));
  }

  const oldRowLock = position(
    sql,
    /where\s+job\.id\s*=\s*c_old_verifier_job_id[\s\S]{0,80}for update/i,
  );
  const sourceRowLock = position(
    sql,
    /where\s+job\.id\s*=\s*c_source_job_id[\s\S]{0,80}for update/i,
  );
  const mutation = position(sql, /update\s+sellerpilot_private\.channel_gateway_jobs/i);
  assert.ok(lockEnd < oldRowLock && lockEnd < sourceRowLock);
  assert.ok(oldRowLock < mutation && sourceRowLock < mutation);
});

test("57000 rejects leases, provider boundaries, writes, and prior exact evidence", async () => {
  const sql = await migrationSql();
  for (const boundary of [
    "v_old_job_before->>'status' <> 'reconciliation_required'",
    "v_old_job_before->>'channel' <> 'qoo10'",
    "v_old_job_before->>'operation' <> 'listing.publication.verify'",
    "v_old_job_before->>'environment' <> 'production'",
    "v_old_job_before->'attempt_id' <> 'null'::jsonb",
    "v_old_job_before->'worker_token_id' <> 'null'::jsonb",
    "v_old_job_before->'claim_token' <> 'null'::jsonb",
    "v_old_job_before->'lease_expires_at' <> 'null'::jsonb",
    "v_old_job_before->'provider_mutation_started_at' <> 'null'::jsonb",
    "v_old_job_before->'oauth_provider_call_started_at' <> 'null'::jsonb",
    "v_old_job_before->'credential_refresh_started_at' <> 'null'::jsonb",
  ]) {
    assert.ok(sql.includes(boundary), `missing boundary ${boundary}`);
  }

  assert.match(sql, /qoo10_exact_s1_source_is_current\(\)/i);
  assert.match(sql, /attested_listing_publication_release_sha\('qoo10'\)/i);
  assert.match(sql, /active_serverless_runtime_release_sha\(\)/i);
  assert.match(sql, /v_attested_release_sha\s+is\s+distinct\s+from\s+v_runtime_release_sha/i);
  assert.match(sql, /qoo10_exact_s1_release_is_current\(\s*v_runtime_release_sha\s*\)/i);
  assert.match(sql, /v_evidence_count\s*<>\s*0/i);
  assert.match(sql, /v_review_count\s*<>\s*0/i);
  assert.match(sql, /job\.status\s+in\s*\('queued','running'\)/i);
  assert.match(sql, /job\.status\s*=\s*'reconciliation_required'[\s\S]{0,160}<>\s*2/i);
  assert.match(sql, /job\.id\s+not\s+in\s*\(c_source_job_id,c_old_verifier_job_id\)/i);
});

test("57000 changes only stale status and updated_at while preserving evidence", async () => {
  const sql = await migrationSql();
  const updates = [...sql.matchAll(
    /update\s+sellerpilot_private\.channel_gateway_jobs(?:\s+\w+)?\s+set\s+([\s\S]*?)\s+where\b/gi,
  )];
  assert.equal(updates.length, 1);
  assert.match(updates[0][1], /status\s*=\s*'failed'/i);
  assert.match(updates[0][1], /updated_at\s*=\s*clock_timestamp\(\)/i);
  assert.doesNotMatch(
    updates[0][1],
    /error_message|response_payload|completed_at|started_at|attempt_id|attempt_count|claim_token|worker_token|lease|provider|credential|request_/i,
  );
  assert.match(
    sql,
    /update\s+sellerpilot_private\.channel_gateway_jobs\s+job[\s\S]{0,220}where\s+job\.id\s*=\s*c_old_verifier_job_id/i,
  );
  assert.match(sql, /if\s+not\s+found\s+then[\s\S]{0,180}lost row ownership/i);
  assert.match(
    sql,
    /\(v_old_job_after\s*-\s*'status'\s*-\s*'updated_at'\)\s+is\s+distinct\s+from\s+\(v_old_job_before\s*-\s*'status'\s*-\s*'updated_at'\)/i,
  );
  for (const immutable of [
    "v_source_after is distinct from v_source_before",
    "v_receipt_after is distinct from v_receipt_before",
    "v_run_after is distinct from v_run_before",
    "v_listing_after is distinct from v_listing_before",
    "v_product_after is distinct from v_product_before",
    "v_credential_after is distinct from v_credential_before",
  ]) {
    assert.ok(sql.includes(immutable));
  }
  assert.doesNotMatch(
    sql,
    /update\s+sellerpilot_private\.(?:gateway_completion_receipts|qoo10_exact_s1_verifier_runs|qoo10_exact_s1_observations|qoo10_exact_s1_activation_permits|qoo10_exact_s1_activation_outcomes|listing_publication_reviews)/i,
  );
});

test("57000 atomically enqueues exactly one fresh read-only verifier", async () => {
  const sql = await migrationSql();
  const enqueueCalls = [...sql.matchAll(
    /v_enqueue_result\s*:=\s*public\.sellerpilot_service_enqueue_exact_qoo10_s1_verifier\s*\(/gi,
  )];
  assert.equal(enqueueCalls.length, 1);
  assert.ok(position(sql, /update\s+sellerpilot_private\.channel_gateway_jobs/i) < enqueueCalls[0].index);
  assert.match(
    sql,
    /sellerpilot_service_enqueue_exact_qoo10_s1_verifier\s*\(\s*c_source_job_id\s*,\s*v_release_sha\s*\)/i,
  );
  assert.match(sql, /v_enqueue_result->>'contract'\s+is\s+distinct\s+from[\s\S]{0,60}'qoo10_exact_s1_verifier_v1'/i);
  assert.match(sql, /v_enqueue_result->>'sourceJobId'\s+is\s+distinct\s+from\s+c_source_job_id::text/i);
  assert.match(sql, /v_enqueue_result->'reused'\s+is\s+distinct\s+from\s+'false'::jsonb/i);
  assert.match(sql, /v_new_verifier_job_id\s+in\s*\(c_source_job_id,c_old_verifier_job_id\)/i);
  assert.match(sql, /qoo10_exact_s1_verifier_job_matches\(job\)/i);
  assert.match(sql, /job\.status\s*=\s*'queued'/i);
  assert.match(sql, /job\.attempt_id\s+is\s+null/i);
  assert.match(sql, /job\.provider_mutation_started_at\s+is\s+null/i);
  assert.match(sql, /run\.release_sha\s*=\s*v_release_sha/i);
  assert.match(sql, /run\.contract\s*=\s*'qoo10_exact_s1_verifier_v1'/i);
});

test("57000 records one payload-free audit and cannot call provider or wake paths", async () => {
  const sql = await migrationSql();
  assert.equal((sql.match(/insert\s+into\s+sellerpilot_private\.operation_audit/gi) ?? []).length, 1);
  for (const key of [
    "qoo10_s1_verifier_retired_for_recheck",
    "qoo10_exact_s1_verifier_retirement_v1",
    "retiredVerifierJobId",
    "freshVerifierJobId",
    "sourceJobId",
    "releaseSha",
    "providerMutationStarted",
    "providerCallReplayed",
  ]) {
    assert.ok(sql.includes(key));
  }
  assert.match(sql, /'providerMutationStarted',false/i);
  assert.match(sql, /'providerCallReplayed',false/i);
  assert.doesNotMatch(sql, /'(?:requestPayload|responsePayload|accessToken|refreshToken|secret|authorization)'\s*,/i);
  for (const forbidden of [
    /sellerpilot_service_complete_(?:serverless_)?gateway_job\s*\(/i,
    /sellerpilot_service_begin_(?:serverless_)?gateway_provider_mutation\s*\(/i,
    /sellerpilot_service_complete_gateway_job_with_context\s*\(/i,
    /schedule_serverless_cs_wakeup\s*\(/i,
    /(?:net|extensions)\.http_(?:get|post|request)\s*\(/i,
    /pg_notify\s*\(/i,
    /insert\s+into\s+sellerpilot_private\.channel_gateway_jobs/i,
    /insert\s+into\s+sellerpilot_private\.qoo10_exact_s1_verifier_runs/i,
    /set\s+is_open\s*=\s*true/i,
  ]) {
    assert.doesNotMatch(sql, forbidden);
  }
});

test("57000 is one-shot and reruns or partial post-states fail atomically", async () => {
  const sql = await migrationSql();
  assert.match(
    sql,
    /migration\.version\s*=\s*'20260831057000'[\s\S]{0,180}raise exception 'exact Qoo10 verifier retirement migration history drifted'/i,
  );
  assert.match(sql, /v_prior_audit_count\s*<>\s*0[\s\S]{0,180}anchors are partial or drifted/i);
  assert.match(sql, /v_old_job_count\s*<>\s*1/i);
  assert.match(sql, /v_old_job_before->>'status'\s*<>\s*'reconciliation_required'/i);
  assert.equal((sql.match(/^\s*begin\s*;/gim) ?? []).length, 1);
  assert.equal((sql.match(/^\s*commit\s*;/gim) ?? []).length, 1);
  assert.doesNotMatch(sql, /exception\s+when\s+others\s+then\s+(?:null|return)/i);
  assert.doesNotMatch(sql, /(?:insert|update|delete)[\s\S]{0,120}supabase_migrations\.schema_migrations/i);
});
