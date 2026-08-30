import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260831056500_resume_exact_qoo10_preprovider_job.sql",
  import.meta.url,
);

test("exact Qoo10 pre-provider resume cannot widen enqueue or open the gate", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  for (const exact of [
    "fac9c5c4-940d-4600-88f3-8f97a069dfbf",
    "4402cc76-295b-4e17-8c07-d5d0e9967ce9",
    "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc",
    "ddccde35-9c58-4856-b673-d7aa27ce4220",
    "2b49d081-5188-4a75-9555-e0a6438e8a2b",
    "5fb751b6-0372-4ad3-b238-6670d58b42f9",
    "52c0a26c93a3c377b042b65554234fb559bdab3f",
    "76be7b79b89497d6841fb3fd921b5ffb57036ea3a93029fa8fa84f6440e85799",
    "c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d",
  ]) {
    assert.match(sql, new RegExp(exact));
  }
  assert.match(sql, /request_payload_bytes = 23555/);
  assert.match(sql, /job\.provider_mutation_started_at is null/);
  assert.match(sql, /job\.credential_refresh_started_at is null/);
  assert.match(sql, /job\.response_payload is null/);
  assert.match(sql, /job\.status = 'queued'/);
  assert.match(sql, /job\.status = 'running'/);
  assert.match(sql, /active_job\.status in \([\s\S]*?'reconciliation_required'/);
  assert.doesNotMatch(sql, /create or replace function public\.sellerpilot_service_enqueue_listing_gateway_job/);
  assert.doesNotMatch(sql, /create or replace function public\.sellerpilot_service_set_listing_(?:channel_)?mutation_release_gate/);
  assert.doesNotMatch(sql, /set\s+is_open\s*=\s*true/i);
  assert.doesNotMatch(sql, /insert into sellerpilot_private\.channel_gateway_jobs/i);
});

test("exact resume binds claim ownership and consumes only after provider start", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /old\.status = 'queued'[\s\S]*?new\.status = 'running'/);
  assert.match(sql, /bind_exact_qoo10_preprovider_resume_claim\([\s\S]*?to_jsonb\(old\), to_jsonb\(new\)/);
  assert.match(sql, /p_new - 'status' - 'worker_token_id' - 'claim_token'[\s\S]*?is distinct from[\s\S]*?p_old - 'status'/);
  assert.match(sql, /bound_worker_token_id = v_worker_token_id/);
  assert.match(sql, /bound_claim_token = v_claim_token/);
  assert.match(sql, /permit\.bound_claim_token = p_claim_token/);
  assert.match(sql, /job\.claim_token = p_claim_token/);
  assert.match(sql, /job\.provider_mutation_started_at is not null/);
  assert.match(sql, /set consumed_at = clock_timestamp\(\)/);
  assert.match(sql, /raise exception 'exact Qoo10 resume permit consumption failed'/);
});

test("both local and serverless provider chains retain the exact one-shot fence", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  for (const signature of [
    "sellerpilot_31033000_begin_gateway_provider_mutation_unsafe",
    "sellerpilot_service_begin_gateway_provider_mutation",
    "sellerpilot_31033000_begin_serverless_gateway_mutation_unsafe",
    "sellerpilot_service_begin_serverless_gateway_provider_mutation",
  ]) {
    assert.match(sql, new RegExp(signature));
  }
  assert.ok(
    (sql.match(/exact_qoo10_preprovider_resume_provider_allowed/g) ?? []).length >= 5,
  );
  assert.ok(
    (sql.match(/consume_exact_qoo10_preprovider_resume_provider/g) ?? []).length >= 4,
  );
  assert.match(sql, /grant execute on function[\s\S]*?sellerpilot_service_arm_exact_qoo10_preprovider_resume\(uuid,text\)[\s\S]*?to service_role/);
  assert.doesNotMatch(sql, /grant execute on function[\s\S]*?sellerpilot_service_arm_exact_qoo10_preprovider_resume\(uuid,text\)[\s\S]*?to (?:anon|authenticated)/);
});
