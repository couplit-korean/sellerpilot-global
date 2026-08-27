import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  crossProductSettingAssetIds,
  crossProductSettingComparisonsSchema,
} from "../lib/cross-product-setting-comparisons";

const SOURCE_JOB_A = "11111111-1111-4111-8111-111111111111";
const SOURCE_JOB_B = "22222222-2222-4222-8222-222222222222";
const CLAIM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLAIM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const fileByAsset = {
  portrait: "thumbnail-portrait.png",
  wide: "thumbnail-wide.png",
  "detail-overview": "detail-overview.png",
  "detail-use": "detail-use.png",
  "detail-routine": "detail-routine.png",
  "detail-scale": "detail-scale.png",
  "detail-storage": "detail-storage.png",
  "detail-context": "detail-context.png",
} as const;

function comparisonProduct(sourceJobId: string, claimToken: string, suffix: string) {
  return {
    sourceJobId,
    sceneIdentity: { category: "일반식품", name: `비교 상품 ${suffix}` },
    assets: Object.fromEntries(crossProductSettingAssetIds.map((assetId) => [
      assetId,
      `results/${sourceJobId}/claims/${claimToken}/${fileByAsset[assetId]}`,
    ])),
  };
}

test("cross-product comparison contract requires eight complete, unique setting shots per prior product", () => {
  const products = [
    comparisonProduct(SOURCE_JOB_A, CLAIM_A, "A"),
    comparisonProduct(SOURCE_JOB_B, CLAIM_B, "B"),
  ];
  assert.equal(crossProductSettingComparisonsSchema.safeParse({
    version: 1,
    productCount: 2,
    assetCount: 16,
    products,
  }).success, true);

  const missing = structuredClone(products);
  delete (missing[0].assets as Partial<typeof missing[0]["assets"]>)["detail-context"];
  assert.equal(crossProductSettingComparisonsSchema.safeParse({
    version: 1,
    productCount: 2,
    assetCount: 16,
    products: missing,
  }).success, false);

  const duplicatePath = structuredClone(products);
  duplicatePath[1].assets.portrait = duplicatePath[0].assets.portrait;
  assert.equal(crossProductSettingComparisonsSchema.safeParse({
    version: 1,
    productCount: 2,
    assetCount: 16,
    products: duplicatePath,
  }).success, false);

  assert.equal(crossProductSettingComparisonsSchema.safeParse({
    version: 1,
    productCount: 1,
    assetCount: 16,
    products,
  }).success, false);
  assert.equal(crossProductSettingComparisonsSchema.safeParse({
    version: 1,
    productCount: 2,
    assetCount: 16,
    products: [products[0], { ...products[1], sourceJobId: SOURCE_JOB_A }],
  }).success, false);
});

test("cross-product paths reject wrong filenames, traversal, and oversized product sets", () => {
  const wrongFile = comparisonProduct(SOURCE_JOB_A, CLAIM_A, "wrong-file");
  wrongFile.assets.portrait = `results/${SOURCE_JOB_A}/claims/${CLAIM_A}/hero.png`;
  assert.equal(crossProductSettingComparisonsSchema.safeParse({
    version: 1,
    productCount: 1,
    assetCount: 8,
    products: [wrongFile],
  }).success, false);

  const traversal = comparisonProduct(SOURCE_JOB_A, CLAIM_A, "traversal");
  traversal.assets.wide = `results/${SOURCE_JOB_A}/claims/${CLAIM_A}/../thumbnail-wide.png`;
  assert.equal(crossProductSettingComparisonsSchema.safeParse({
    version: 1,
    productCount: 1,
    assetCount: 8,
    products: [traversal],
  }).success, false);

  const tooMany = Array.from({ length: 9 }, (_, index) => comparisonProduct(
    `${String(index + 1).padStart(8, "0")}-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
    CLAIM_A,
    String(index),
  ));
  assert.equal(crossProductSettingComparisonsSchema.safeParse({
    version: 1,
    productCount: 9,
    assetCount: 72,
    products: tooMany,
  }).success, false);
});

test("worker claim obtains owner-fenced comparison paths and exposes only signed URLs", async () => {
  const [route, migration] = await Promise.all([
    readFile(new URL("../app/api/ai/worker/claim/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260827075654_cross_product_setting_comparisons.sql", import.meta.url), "utf8"),
  ]);

  assert.match(route, /sellerpilot_service_get_cross_product_setting_comparisons/);
  assert.match(route, /p_token_hash: tokenHash/);
  assert.match(route, /p_job_id: jobId/);
  assert.match(route, /p_claim_token: claimToken/);
  assert.match(route, /p_limit_products: 8/);
  assert.match(route, /crossProductSettingComparisonsSchema\.safeParse/);
  assert.match(route, /cross_product_comparison_lookup_failed/);
  assert.match(route, /invalid_cross_product_comparison_contract/);
  assert.match(route, /cross_product_comparison_signing_failed/);
  assert.match(route, /cross_product_comparison_signing_incomplete/);
  assert.match(route, /signedFile\.path === entry\.path/);
  assert.match(route, /signedComparison\.path === expectedPath/);
  assert.equal((route.match(/crossProductComparisons: crossProductPreparation\.comparisons/g) ?? []).length, 2);
  assert.match(route, /if \(job\.kind === "product_asset_regeneration"\)[\s\S]*crossProductSettingAssetIds\.includes\([\s\S]{0,160}assetId[\s\S]{0,160}\)\s*\? await prepareCrossProductComparisons\(\)\s*: \{ comparisons: \[\], failure: null \} as const;[\s\S]*crossProductComparisons: crossProductPreparation\.comparisons/);
  assert.match(route, /\.map\(\(entry\) => \(\{ assetId: entry\.assetId, signedUrl: entry\.signedUrl \}\)\)/);

  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /token\.scope = 'ai'/);
  assert.doesNotMatch(migration, /legacy_combined/);
  assert.match(migration, /job\.kind in \('product_studio', 'product_asset_regeneration'\)/);
  assert.match(migration, /job\.status = 'running'/);
  assert.match(migration, /job\.worker_token_id = v_token_id/);
  assert.match(migration, /job\.claim_token = p_claim_token/);
  assert.match(migration, /job\.lease_expires_at > clock_timestamp\(\)/);
  assert.match(migration, /product\.owner_id = v_owner_id/);
  assert.match(migration, /product\.status <> 'archived'/);
  assert.match(migration, /not product\.demo/);
  assert.match(migration, /product_asset_regeneration/);
  assert.match(migration, /provenance_job\.request_payload->>'source_job_id' = asset\.source_job_id::text/);
  assert.match(migration, /source_product\.owner_id = v_owner_id/);
  assert.match(migration, /source_product\.ai_job_id = v_excluded_source_job_id/);
  assert.match(migration, /product\.ai_job_id <> v_excluded_source_job_id/);
  assert.match(migration, /products_cross_product_comparisons_idx/);
  assert.match(migration, /limit greatest\(32, v_limit \* 8\)/);
  assert.match(migration, /from public, anon, authenticated, service_role/);
  assert.match(migration, /to service_role/);
});
