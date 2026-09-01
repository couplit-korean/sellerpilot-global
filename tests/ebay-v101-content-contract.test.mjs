import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260901173950_rebind_ebay_v101_content_contract.sql",
  import.meta.url,
);

const oldFingerprint =
  "ca16ccbee45665f513bc1a4f1a1420be57dbd9b52f065b1f53e413d7e5d81cd2";
const contentFingerprint =
  "bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231";

test("eBay v101 forward migration rebinds only the exact unbound content permit", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  for (const exactValue of [
    "8b2cbfaf-3854-437d-b381-abfd70291354",
    "800551945442",
    "7ae83178-d335-4b7e-8e35-2f55e905bbde",
    "f78397ec-c387-48ec-b562-64e754d90ac5",
    "BEEF134012FD",
    oldFingerprint,
    contentFingerprint,
    "ebay_exact_v101_content_contract_v1",
    "ABS 플라스틱",
    "ABS Plastic",
    "292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a",
  ]) {
    assert.match(migration, new RegExp(exactValue, "u"));
  }
  assert.match(migration, /v_image_count <> 9/u);
  assert.match(migration, /v_unique_image_count <> 9/u);
  assert.match(migration, /providerTransportImages/u);
  assert.match(migration, /detail_images\.position > 1/u);
  assert.match(migration, /gallery-representative/u);
  assert.match(migration, /approvedSourceSha256/u);
  assert.match(migration, /approvedObjectPath/u);
  assert.match(migration, /providerImageSurface'[\s\S]*'gallery'/u);
  assert.match(migration, /'inventoryImageCount', 9/u);
  assert.match(migration, /'detailImageCount', 8/u);
  assert.match(migration, /'providerMutationCount', 0/u);
  assert.match(migration, /'gatewayJobCount', 0/u);
  assert.match(migration, /update_job_id is null/u);
  assert.match(migration, /bound_at is null/u);
  assert.match(migration, /consumed_at is null/u);
  assert.doesNotMatch(
    migration,
    /insert\s+into\s+sellerpilot_private\.channel_gateway_jobs/iu,
  );
  assert.doesNotMatch(
    migration,
    /update\s+sellerpilot_private\.channel_operation_attempts/iu,
  );
  assert.doesNotMatch(migration, /delete\s+from/iu);
});

test("eBay v101 content arm stays service-only and one-shot after rebind", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(
    migration,
    /current_setting\('request\.jwt\.claim\.role', true\) <> 'service_role'/u,
  );
  assert.match(
    migration,
    /expires_at = v_now \+ interval '5 minutes'/u,
  );
  assert.match(
    migration,
    /not exists \([\s\S]*'ebay_exact_v101_content_contract_rearmed'/u,
  );
  assert.match(
    migration,
    /from public, anon, authenticated, service_role;[\s\S]*grant execute on function[\s\S]*to service_role/u,
  );
  assert.match(
    migration,
    /exact_existing_update_release_is_current\(\s*'ebay', p_release_sha/u,
  );
});
