import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8");
const provider = await readFile(new URL("../lib/channels/provider-listing-runtime.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20260910021500_fence_coupang_create_source_revision.sql", import.meta.url), "utf8");

test("route creates the server-owned complete revision after source and approved-image binding but before fingerprint", () => {
  const source = route.indexOf("bindCoupangCreateSourceIdentity");
  const approved = route.indexOf("bindMarketplaceArgumentsToApprovedDetailManifest", source);
  const decrypt = route.indexOf('sellerpilot_decrypt_credential", {', approved);
  const revision = route.indexOf("bindCoupangCreateSourceRevision", approved);
  const fingerprint = route.indexOf("const baseRequestFingerprint", revision);
  assert.ok(source > 0 && approved > source && decrypt > approved
    && revision > decrypt && fingerprint > revision);
  assert.match(route, /coupang_create_revision_server_owned/);
  assert.match(route.slice(decrypt, fingerprint), /credentialVersion/);
  assert.match(route.slice(decrypt, fingerprint), /credentialFingerprint/);
});

test("provider preparation validates the revision before any Coupang metadata or duplicate GET", () => {
  const gate = provider.indexOf("assertCoupangCreateSourceRevision");
  const prepare = provider.indexOf("prepareCoupangListing", gate);
  assert.ok(gate > 0 && prepare > gate);
});

test("database provider boundary rechecks current product, approved manifest and credential incarnation", () => {
  assert.match(migration, /before update of provider_mutation_started_at/);
  assert.match(migration, /row\.status = 'active'/);
  assert.match(migration, /credentialVersion/);
  assert.match(migration, /credentialFingerprint/);
  assert.match(migration, /detail_page_approved_version is distinct from product\.detail_page_version/);
  assert.match(migration, /approvedManifestDigest/);
  assert.match(migration, /publicationExpectedFingerprint/);
  assert.doesNotMatch(migration, /insert into|update sellerpilot_private\.products|delete from/i);
});
