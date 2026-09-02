import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260902101500_bind_ebay_exact_server_representative.sql",
  import.meta.url,
);
const recoveryUrl = new URL(
  "../lib/channels/ebay-exact-existing-qa-recovery.ts",
  import.meta.url,
);
const helperUrl = new URL(
  "../lib/server-ebay-exact-representative.ts",
  import.meta.url,
);
const routeUrl = new URL(
  "../app/api/admin/channel-operations/route.ts",
  import.meta.url,
);

const sourcePath =
  "results/334631fe-0095-4ea8-a20a-16971f6ca71a/claims/eee7b548-62e7-4175-bd54-deb426da6c06/thumbnail-square.png";
const sourceSha =
  "1be297f0103147951dbb3e7167cd87362f9cf12efe5be2dfa26cd0ed9b918753";
const priorFingerprint =
  "acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef";
const baseFingerprint =
  "8eeb374c49a1e4ec6a3d95c55e407993d8a5938dbc77d4f0c7d33b290cfd5591";
const requestFingerprint =
  "4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e";

test("eBay server-owned representative constants are exact across code and the forward fence", async () => {
  const [migration, recovery, helper, route] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(recoveryUrl, "utf8"),
    readFile(helperUrl, "utf8"),
    readFile(routeUrl, "utf8"),
  ]);

  for (const exact of [
    sourcePath,
    sourceSha,
    priorFingerprint,
    requestFingerprint,
  ]) {
    assert.match(migration, new RegExp(exact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  }
  assert.match(recovery, new RegExp(baseFingerprint, "u"));
  assert.match(recovery, new RegExp(requestFingerprint, "u"));
  assert.match(recovery, new RegExp(sourcePath.replaceAll(".", "\\."), "u"));
  assert.match(recovery, new RegExp(sourceSha, "u"));
  assert.match(helper, /createHash\("sha256"\)\.update\(bytes\)\.digest\("hex"\)/u);
  assert.match(helper, /approvedGalleryImagePaths: \[sourceObjectPath\]/u);
  assert.match(helper, /approvedGalleryImageSha256s: \[sourceSha256\]/u);

  const detail = route.indexOf(
    "effectiveArguments = bindMarketplaceArgumentsToApprovedDetailManifest(",
  );
  const representative = route.indexOf(
    "const representative = await bindEbayExactRepresentativeFromStorage(",
  );
  const fingerprint = route.indexOf(
    "const manifestFingerprintArguments = approvedDetailBinding",
  );
  assert.ok(detail >= 0 && representative > detail && fingerprint > representative);
});

test("the forward migration is apply-only, dynamic-credential, and fail-closed", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /ebay_exact_current_credential_is_valid/u);
  assert.match(migration, /ref\.canonical_public_url ~/u);
  assert.match(migration, /permit\.request_fingerprint is distinct from/u);
  assert.match(migration, /creates no permit or job and never calls eBay/u);
  assert.doesNotMatch(
    migration,
    /742773ae-e2ce-4b06-99d2-7c6eb541af03|f78397ec-c387-48ec-b562-64e754d90ac5/u,
  );
  assert.doesNotMatch(migration, /credential\.version\s*=\s*(101|105)/u);
  assert.doesNotMatch(
    migration,
    /insert\s+into\s+sellerpilot_private\.(?:exact_existing_update_permits|channel_gateway_jobs|operation_attempts)/iu,
  );
  assert.doesNotMatch(
    migration,
    /update\s+sellerpilot_private\.(?:exact_existing_update_permits|channel_gateway_jobs|operation_attempts)/iu,
  );
  assert.doesNotMatch(migration, /fetch\s*\(|api\.ebay\.com/iu);
  assert.match(
    migration,
    /revoke all on function[\s\S]*from public, anon, authenticated, service_role/u,
  );
  assert.match(
    migration,
    /grant execute on function[\s\S]*to service_role/u,
  );
});
