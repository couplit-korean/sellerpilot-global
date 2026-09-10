import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../supabase/migrations/20260910040000_ebay_create_execution_recovery_hardening.sql",
  import.meta.url,
);

test("eBay r5 recovery claim does not require a stored offerId", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /create table if not exists sellerpilot_private\.ebay_create_stage_receipts/u);
  assert.match(sql, /create table if not exists sellerpilot_private\.ebay_create_credential_rebind_receipts/u);
  assert.doesNotMatch(sql, /alter function public\.sellerpilot_claim_channel_gateway_job/u);
  assert.match(
    sql,
    /and exists\(select 1 from sellerpilot_private\.ebay_create_stage_receipts r/u,
  );
  assert.doesNotMatch(
    sql,
    /coalesce\(job\.request_payload#>>'\{arguments,offerId\}', ''\)\s*~\s*'\\^\[A-Za-z0-9\]/u,
  );
  assert.match(sql, /'offerId',\(select o\.provider_resource_id from sellerpilot_private\.ebay_create_stage_outcomes o/u);
  assert.match(sql, /EBAY_CREATE_STAGE_COMMERCE_STALE/u);
});

test("eBay r5 SQL identifiers stay within 63 bytes", async () => {
  const sql = await readFile(migration, "utf8");
  const names = [
    ...sql.matchAll(/\b(?:function|table)\s+(?:if not exists\s+)?(?:public|sellerpilot_private)\.([A-Za-z0-9_]+)/giu),
  ].map((match) => match[1]);
  assert.ok(names.length > 5);
  for (const name of names) assert.ok(Buffer.byteLength(name) <= 63, name);
});
