import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../supabase/migrations/20260905011100_fix_shopee_exact_claim_vault_cast.sql", import.meta.url),
  "utf8",
);

test("Shopee exact claimant casts Vault plaintext JSON and remains one-job scoped", () => {
  assert.match(migration, /create or replace function public\.sellerpilot_claim_exact_shopee_diagnostic_job/);
  assert.match(migration, /\(d\.decrypted_secret::jsonb\)->>'shop_id'/);
  assert.match(migration, /\(d\.decrypted_secret::jsonb\)->'shopee_targets'/);
  assert.match(migration, /e3ef63f5-cd39-4883-898c-60399dbf449c/);
  assert.match(migration, /j\.operation = 'diagnostic\.test'/);
  assert.match(migration, /j\.status = 'queued'/);
  assert.doesNotMatch(migration, /sellerpilot_claim_channel_gateway_job\s*\(/);
  assert.doesNotMatch(migration, /oauth\.exchange|listing\.create|listing\.update/);
});
