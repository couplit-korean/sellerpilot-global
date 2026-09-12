import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("final Studio requires the persisted first-draft quality manifest before reuse", async () => {
  const route = await readFile(new URL("../../app/api/ai/product-studio/route.ts", import.meta.url), "utf8");
  assert.match(route, /firstDraftImageQualityManifestPath\(/);
  assert.match(route, /storage\.from\("sellerpilot-ai"\)\.download\(manifestPath\)/);
  assert.match(route, /validateFirstDraftImageQualityManifest\(\{/);
  assert.match(route, /code: "FIRST_DRAFT_QUALITY_REQUIRED"/);
  assert.match(route, /first_draft_product_facts: firstDraftProductFacts/);
  assert.match(route, /preflight_asset_quality_manifest: firstDraftQualityManifest/);
});

test("the first-draft upload route recomputes the actual image dHash before any upload", async () => {
  const route = await readFile(new URL("../../app/api/ai/worker/first-draft-images/route.ts", import.meta.url), "utf8");
  assert.match(route, /await fingerprintImageAsset\(/);
  assert.match(route, /fingerprint\.visualHash[\s\S]{0,120}entry\.verification\.visualHash/);
  assert.match(route, /createSignedUploadUrl\(entry\.path, \{ upsert: true \}\)/);
  assert.match(route, /storage\.from\(storageBucket\)\.download\(entry\.path\)/);
  const fingerprintIndex = route.indexOf("const fingerprint = await fingerprintImageAsset(");
  const validatedIndex = route.indexOf("validatedAssets.push(", fingerprintIndex);
  const legacyUploadIndex = route.indexOf("for (const { entry, path, bytes, digest, spec } of validatedAssets)", validatedIndex);
  assert.ok(fingerprintIndex > 0 && validatedIndex > fingerprintIndex && legacyUploadIndex > validatedIndex);
});

test("server restore revalidates the persisted first-draft manifest", async () => {
  const server = await readFile(new URL("../../lib/server-product-studio.ts", import.meta.url), "utf8");
  assert.match(server, /preflight_asset_quality_manifest: firstDraftImageQualityManifestSchema\.optional\(\)/);
  assert.match(server, /if \(!hasQualityFacts && !hasQualityManifest\) \{\s+return new Map<AiGeneratedAssetId, ServerStudioAsset>\(\)/);
  assert.match(server, /preflight_asset_quality_incomplete/);
  assert.match(server, /preflight_asset_quality_invalid/);
});
