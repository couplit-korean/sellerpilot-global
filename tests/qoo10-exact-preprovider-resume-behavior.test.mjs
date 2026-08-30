import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260831056500_resume_exact_qoo10_preprovider_job.sql",
  import.meta.url,
);

test("exact Qoo10 begin coalesces only the consumed permit's bound claim", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const allowedStart = sql.indexOf(
    "create function sellerpilot_private.exact_qoo10_preprovider_resume_provider_allowed(",
  );
  const consumeStart = sql.indexOf(
    "create function sellerpilot_private.consume_exact_qoo10_preprovider_resume_provider(",
  );
  const triggerStart = sql.indexOf(
    "create or replace function sellerpilot_private.block_closed_listing_mutation_claim()",
  );
  assert.ok(allowedStart >= 0 && consumeStart > allowedStart && triggerStart > consumeStart);

  const allowed = sql.slice(allowedStart, consumeStart);
  const consume = sql.slice(consumeStart, triggerStart);
  assert.match(allowed, /permit\.bound_claim_token = p_claim_token/);
  assert.match(allowed, /permit\.bound_worker_token_id = job\.worker_token_id/);
  assert.match(allowed, /job\.provider_mutation_started_at is null[\s\S]*?permit\.consumed_at is null/);
  assert.match(allowed, /job\.provider_mutation_started_at is not null[\s\S]*?permit\.consumed_at is not null/);
  assert.match(allowed, /permit\.consumed_at >= job\.provider_mutation_started_at/);

  assert.match(consume, /set consumed_at = clock_timestamp\(\)/);
  assert.match(consume, /permit\.bound_claim_token = p_claim_token/);
  assert.match(consume, /permit\.bound_worker_token_id = job\.worker_token_id/);
  assert.match(consume, /permit\.consumed_at is not null/);
  assert.match(consume, /job\.claim_token = p_claim_token/);
  assert.doesNotMatch(consume, /set\s+bound_claim_token\s*=/);
});
