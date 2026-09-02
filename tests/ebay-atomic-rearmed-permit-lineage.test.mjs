import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260902112000_allow_ebay_atomic_rearmed_permit_lineage.sql",
  import.meta.url,
);

test("eBay atomic rearm keeps the exact failed attempt eligible for generic enqueue", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  for (const exactValue of [
    "a04ed967-a129-43d4-8ce8-af6657af5ef0",
    "3ffaf977-3950-4a74-af02-16b4cd930ac9",
    "16fcd1f9-6c9f-45f7-bb5e-05e3a558f2ea",
    "7ae83178-d335-4b7e-8e35-2f55e905bbde",
    "8b2cbfaf-3854-437d-b381-abfd70291354",
    "800551945442",
    "244042196011",
    "4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e",
  ]) {
    assert.match(migration, new RegExp(exactValue, "u"));
  }
  assert.match(migration, /listing[.]status = 'failed'/u);
  assert.match(migration, /listing[.]failure_class = 'retryable'/u);
  assert.match(migration, /attempt[.]status = 'running'/u);
  assert.match(migration, /permit[.]credential_id <> marker[.]credential_id/u);
  assert.match(migration, /current_credential[.]version > source_credential[.]version/u);
  assert.match(migration, /permit[.]expires_at = permit[.]armed_at \+ interval '5 minutes'/u);
  assert.match(migration, /not exists \([\s\S]*channel_gateway_jobs/u);
  assert.match(migration, /jsonb_agg\([\s\S]*order by ref[.]object_path/u);
  assert.match(
    migration,
    /ebay_exact_no_effect_retry_permit_is_current\([\s\S]*?or sellerpilot_private[.]ebay_exact_atomic_rearmed_permit_is_current/u,
  );
});

test("eBay atomic lineage migration is provider-write free and fail-closed", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.doesNotMatch(
    migration,
    /(?:insert\s+into|update|delete\s+from)\s+sellerpilot_private[.](?:channel_gateway_jobs|channel_operation_attempts|product_listings|exact_existing_update_permits)/iu,
  );
  assert.doesNotMatch(migration, /api[.]ebay[.]com|fetch\s*\(/iu);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/u);
  assert.match(
    migration,
    /revoke all on function[\s\S]*ebay_exact_atomic_rearmed_permit_is_current\(uuid\)[\s\S]*from public, anon, authenticated, service_role/u,
  );
  assert.match(migration, /patch preimage drifted/u);
  assert.match(migration, /patch failed/u);
  assert.match(migration, /postimage invalid/u);
});
