import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL(
  "../supabase/migrations/20260908061500_enqueue_exact_coupang_post_price_publication_verifier.sql",
  import.meta.url,
), "utf8");
const runtime = await readFile(new URL(
  "../lib/channels/listing-publication-verification.ts",
  import.meta.url,
), "utf8");

const sourceJob = "25adf712-1e9a-432b-8b0d-09cf35a826c5";
const sourceAttempt = "d771421b-f408-4f75-addd-03879393fab8";
const repairJob = "36fcb808-a2f1-42b7-a6c9-264d884f25fb";
const repairAttempt = "05508966-7665-4873-a89b-89fda8ea8a25";
const retiredVerifier = "86d2cb63-d382-4cc9-8153-654cf7ccec80";

test("post-price verifier preserves the shared publication source contract", () => {
  assert.match(runtime, /type SourceOperation = "listing\.create" \| "listing\.update" \| "listing\.activate";/u);
  assert.doesNotMatch(
    runtime,
    /sourceOperation: z\.enum\(\[[^\]]*"price\.update"/u,
  );
  assert.ok(runtime.includes(`const exactCoupangSourceJobId = "${sourceJob}"`));
  assert.match(runtime, /source\.data\.sourceJobId === exactCoupangSourceJobId/u);
  assert.match(runtime, /source\.data\.sourceOperation === "listing\.create"/u);
});

test("post-price execution is GET-only and requires content, price, stock, and sale state", () => {
  const start = runtime.indexOf("sellerpilotCoupangPostPriceVerification" );
  const end = runtime.indexOf("const {\n    source,\n    remoteId,", start);
  assert.ok(start >= 0 && end > start);
  const exactPath = runtime.slice(start, end);
  assert.equal((exactPath.match(/method: "GET"/gu) ?? []).length, 2);
  assert.doesNotMatch(exactPath, /method: "(?:POST|PUT|PATCH|DELETE)"/u);
  assert.match(exactPath, /Number\(vendorData\.salePrice\) === marker\.desiredPrice/u);
  assert.match(exactPath, /Number\(vendorData\.amountInStock\) === 1/u);
  assert.match(exactPath, /vendorData\.onSale === true/u);
  assert.match(exactPath, /observedSellerItemId === marker\.vendorItemId/u);
  assert.match(exactPath, /exactText\(sellerRoot\.productId\) === marker\.productId/u);
  assert.match(exactPath, /exactText\(sellerItems\[0\]\?\.itemId\) === marker\.itemId/u);
  assert.match(exactPath, /sellerRoot\.requested === false/u);
  assert.match(exactPath, /verifiedExecution\(\{/u);
  assert.match(exactPath, /publication-content-verification/u);
  assert.match(exactPath, /providerMutationPerformed: false/u);
});

test("migration binds immutable CREATE and price repair lineages without replaying them", () => {
  for (const id of [sourceJob, sourceAttempt, repairJob, repairAttempt, retiredVerifier]) {
    assert.ok(migration.includes(id), `missing exact lineage ${id}`);
  }
  assert.match(migration, /sourceOperation' is distinct from 'listing\.create'/u);
  assert.doesNotMatch(migration, /sourceOperation' is distinct from 'price\.update'/u);
  assert.match(migration, /publicationReviewSourceJobId', source_job\.id/u);
  assert.match(migration, /source_job_sha256 text not null/u);
  assert.match(migration, /source_attempt_sha256 text not null/u);
  assert.match(migration, /source_listing_sha256 text not null/u);
  assert.match(migration, /price_repair_permit_sha256 text not null/u);
  assert.match(migration, /product_id text not null check \(product_id = '9725220700'\)/u);
  assert.match(migration, /item_id text not null check \(item_id = '29102903416'\)/u);
  for (const hash of [
    "d8918fbe0051ad2a00a83df463f7dda31980a98bca14786fca7d359363e96b85",
    "9c4f70b305305ef649812746c6fb1e5af0b813b3518c70960106cf5d9c3ac2e2",
    "61979aed80b64d9a9ad8ec79945790df51d209b3d0f102d21716f38fe96e8035",
    "d4d4acff0257923b7d6c74fd05a13cf4a09e5c388bb9165a3d64ba9dc9b77130",
    "b2775958aa6083a99a10065e01033cedec63344434d80091a2c5d3cc95ef5f59",
  ]) assert.ok(migration.includes(hash), `missing production predecessor hash ${hash}`);
  for (const hash of [
    "fa88b5c706c7abdef8e40d19d6607237dd268d29ce6c274dcc703a300aa9964c",
    "141fe06760c29c8a6162f30c27b810b08b25c00faea4b4aa179da58fb59fae4e",
    "ff68cbfe6dc283cac95bdaaaa7797477f191c20df1b29d73c7d22009e82e4b0f",
    "e3ad7aa1fcb0e3d2434bd3b112234e1d083d77c51504d4769308f8457d492085",
  ]) assert.ok(migration.includes(hash), `missing wrapper postimage hash ${hash}`);
  assert.match(migration, /installed_definition is distinct from definition/u);
  assert.match(migration, /COUPANG_POST_PRICE_LISTING_GUARD_POSTIMAGE_DRIFT/u);
  assert.match(migration, /COUPANG_POST_PRICE_VERIFIER_POSTIMAGE_DRIFT/u);
  assert.doesNotMatch(
    migration,
    new RegExp(`update\\s+sellerpilot_private\\.channel_gateway_jobs[\\s\\S]{0,500}${sourceJob}`, "iu"),
  );
});

test("completion accepts only four exact verification steps and projects one listing", () => {
  assert.match(migration, /jsonb_array_length\(job\.response_payload->'steps'\) = 4/u);
  for (const step of [
    "seller-product-publication-reverification",
    "vendor-item-publication-reverification",
    "publication-content-verification",
    "post-price-publication-verification",
  ]) {
    assert.ok(migration.includes(step), `missing completion step ${step}`);
  }
  assert.match(migration, /sellerpilotCurrency\}' = run\.currency/u);
  assert.doesNotMatch(migration, /vendor_step#>>'\{data,data,currency\}'/u);
  assert.match(migration, /sellerpilotObservedStock\}' = '1'/u);
  assert.match(migration, /sellerpilotObservedSellerItemId\}' = run\.vendor_item_id/u);
  assert.match(migration, /\{data,data,sellerItemId\}' = run\.vendor_item_id/u);
  assert.match(migration, /\{resources,productId\}' = run\.product_id/u);
  assert.match(migration, /\{resources,itemId\}' = run\.item_id/u);
  assert.match(migration, /\{evidence,providerPublicUrl\}'/u);
  assert.match(migration, /status = 'published'/u);
  assert.match(migration, /failure_class = null/u);
  assert.match(migration, /remote_visibility = 'live'/u);
  assert.match(migration, /marketplace_sku = 'AUTO-780720401E2D4E4EA45F'/u);
  assert.match(
    migration,
    /https:\/\/www\.coupang\.com\/vp\/products\/9725220700\?vendorItemId=96027942778/u,
  );
});

test("migration is install-only until the service enqueue RPC is called", () => {
  const directJobInserts = migration.match(/insert into sellerpilot_private\.channel_gateway_jobs/giu) ?? [];
  assert.equal(directJobInserts.length, 1);
  assert.match(migration, /create function public\.sellerpilot_service_enqueue_exact_coupang_post_price_verifier/u);
  assert.match(migration, /provider_mutation_started_at is null/u);
  assert.match(migration, /oauth_provider_call_started_at is null/u);
  assert.match(migration, /providerMutationPerformed', false/u);
  assert.match(migration, /COUPANG_POST_PRICE_VERIFIER_RELEASE_MISMATCH/u);
  assert.match(migration, /'releaseSha', existing\.release_sha/u);
  assert.match(migration, /listing_after_snapshot jsonb not null/u);
  assert.match(migration, /listing_after_sha256 text not null/u);
  assert.match(migration, /receipt\.listing_after_snapshot = to_jsonb\(listing\)/u);
  assert.equal((migration.match(/^begin;$/gmu) ?? []).length, 1);
  assert.equal((migration.match(/^commit;$/gmu) ?? []).length, 1);
});
