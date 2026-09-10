import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL("../app/api/admin/coupang-create-readiness/route.ts", import.meta.url),
  "utf8",
);

test("readiness route accepts the exact UI tuple and strict draft alias", () => {
  for (const field of [
    "productId", "credentialId", "credentialVersion", "categoryId",
    "sourceFingerprint", "market", "targetId", "arguments", "draft",
  ]) {
    assert.match(route, new RegExp(`${field}:`));
  }
  assert.match(route, /\.strict\(\)\.superRefine/);
  assert.match(route, /arguments and draft differ/);
  assert.match(route, /productRegistrationSourceFingerprint\(publishContext\) !== parsed\.data\.sourceFingerprint/);
  assert.match(route, /text\(body\.displayCategoryCode\) !== parsed\.data\.categoryId/);
});

test("route reads the server-owned publish context, approved manifest and exact credential incarnation", () => {
  assert.match(route, /sellerpilot_get_product_publish_context/);
  assert.match(route, /readApprovedExternalDetailPublishContext/);
  assert.match(route, /approvedProductDetailManifestFromPublishContext/);
  assert.match(route, /marketplaceArgumentsForApprovedDetailFingerprint/);
  assert.match(route, /bindCoupangCreateSourceIdentity/);
  assert.match(route, /sellerpilot_list_credentials/);
  assert.match(route, /sellerpilot_decrypt_credential/);
  assert.match(route, /parsed\.data\.credentialVersion !== credentialVersion/);
  assert.match(route, /sellerIdentityReady: true/);
});

test("source builder owns early exit before any optional provider read", () => {
  const builder = route.indexOf("buildCoupangCreateReadinessSource({");
  const metadata = route.indexOf("readCategoryMetadata: async", builder);
  const status = route.indexOf("readCategoryStatus: async", metadata);
  const outbound = route.indexOf("readOutboundShippingPlaces: async", status);
  const returns = route.indexOf("readReturnCenters: async", outbound);
  assert.ok(builder > 0 && metadata > builder && status > metadata
    && outbound > status && returns > outbound);
  assert.match(route, /result\.completeness\.fields\.length !== 19/);
});

test("all four provider readers are enclosed by GET-only transport", () => {
  const start = route.indexOf("runWithProviderReadOnlyTransport");
  const end = route.indexOf("if (result.completeness.fields.length", start);
  const providerBlock = route.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.equal((providerBlock.match(/method: "GET"/g) ?? []).length, 4);
  assert.doesNotMatch(providerBlock, /method: "(?:POST|PUT|PATCH|DELETE)"/);
  assert.match(providerBlock, /category-related-metas\/display-category-codes/);
  assert.match(providerBlock, /display-categories\/\$\{categoryCode\}\/status/);
  assert.match(providerBlock, /shipping-place\/outbound/);
  assert.match(providerBlock, /placeCodes: text\(body\.outboundShippingPlaceCode\)/);
  assert.match(providerBlock, /return\/shipping-places\/center-code/);
  assert.match(providerBlock, /returnCenterCodes: text\(body\.returnCenterCode\)/);
  assert.doesNotMatch(providerBlock, /pageNum|pageSize/);
});

test("response exposes completeness and sanitized choices without seller identity secrets", () => {
  assert.match(route, /completeness: input\.result\.completeness/);
  assert.match(route, /observedTuple: input\.observedTuple/);
  assert.match(route, /autoFillPatches:/);
  assert.match(route, /outboundShippingPlaces: outboundChoices/);
  assert.match(route, /returnCenters: returnCenterChoices/);
  assert.match(route, /credentialRevision: input\.credentialRevision/);
  assert.match(route, /providerWritePerformed: false/);
  assert.match(route, /dbWritePerformed: false/);
  assert.match(route, /jobCreated: false/);

  const responseStart = route.indexOf("function responseBody");
  const handlerStart = route.indexOf("export async function POST", responseStart);
  const responseBlock = route.slice(responseStart, handlerStart);
  assert.doesNotMatch(responseBlock, /access_key|secret_key|vendor_id|requested_by/);
});
