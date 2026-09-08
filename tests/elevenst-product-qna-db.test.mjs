import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL(
  "../supabase/migrations/20260908049000_enable_elevenst_product_qna_cs.sql",
  import.meta.url,
), "utf8");

test("11st Product Q&A migration keeps CS reads and replies outside product registration state", () => {
  assert.match(migration, /p_channel='elevenst'.*p_operation in \('inquiries\.list','inquiries\.reply'\)/s);
  assert.match(migration, /sellerpilot_08049000_ingest_before_elevenst_qna/);
  assert.match(migration, /sellerpilot_08049000_enqueue_reply_before_elevenst_qna/);
  assert.match(migration, /ELEVENST_PRODUCT_QNA_CONTEXT_INVALID/);
  assert.match(migration, /seller_account_key_source not in\(\s*'provider_certified_v1','credential_incarnation_v1'\s*\)/);
  assert.match(migration, /message\.remote_message_id='qna:'\|\|v_brd_info_no\|\|':question'/);
  assert.match(migration, /v_ticket\.reply_context->>'brdInfoNo' is distinct from v_brd_info_no/);
  assert.match(migration, /v_ticket\.reply_context->>'prdNo' is distinct from v_prd_no/);
  assert.match(migration, /serverless_static_egress_policy/);
  assert.doesNotMatch(migration, /product_listings|listing_attempts|listing\.create|listing\.update|seller_product_id/);
});

test("11st Product Q&A migration excludes provider member IDs and limits stored context", () => {
  assert.match(migration, /jsonb_object_keys\(v_context\)/);
  assert.doesNotMatch(migration, /memID|memberId|member_id/);
  assert.match(migration, /octet_length\(v_context::text\)>64000/);
  assert.match(migration, /unsequencedAnswers/);
  assert.match(migration, /provider_timestamp_unavailable/);
});

test("11st reply enqueue remains service-only and history start remains admin-only", () => {
  assert.match(migration, /grant execute on function public\.sellerpilot_service_ingest_inquiries\(uuid,text,jsonb\)\s+to service_role/);
  assert.match(migration, /grant execute on function public\.sellerpilot_enqueue_inquiry_reply_gateway_job\(uuid,text,text,jsonb\)\s+to service_role/);
  assert.match(migration, /grant execute on function public\.sellerpilot_start_inquiry_history_backfill_v4\(text\[\],integer,date\)\s+to authenticated/);
  assert.match(migration, /p_history_days not between 7 and 30/);
  assert.match(migration, /v_expected:=ceil\(p_history_days\/7\.0\)::integer/);
  assert.equal((migration.match(/'provider_certified_v1','credential_incarnation_v1'/g) ?? []).length, 4);
});
