import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  assertCoupangCreateSourceRevision,
  bindCoupangCreateSourceRevision,
  coupangCreateSourceRevisionArgument,
  coupangCreateTransmissionArgument,
} from "../lib/product-registration/coupang/create-source-revision";
import { buildCoupangCreateOfficialReadEvidence } from
  "../lib/product-registration/coupang/create-official-read-evidence";

const productId = "10000000-0000-4000-8000-000000000001";
const credentialId = "20000000-0000-4000-8000-000000000001";
const officialReadSnapshotId = "30000000-0000-4000-8000-000000000001";
const hash = (digit: number) => String(digit).repeat(64);
const credential = { vendor_id: "A00123456", requested_by: "wing-user" };
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

function officialReadEvidence() {
  return buildCoupangCreateOfficialReadEvidence({
    displayCategoryCode: 59631,
    environment: "production",
    now: new Date(),
    categoryMetadataRead: { code: "SUCCESS", data: { attributes: [] } },
    categoryStatusRead: { code: "SUCCESS", data: true },
    outboundShippingPlacesRead: { code: "SUCCESS", data: { content: [{ id: 12345 }] } },
    returnCentersRead: { code: "SUCCESS", data: { content: [{ id: "RETURN-1" }] } },
  });
}

function argumentsValue() {
  return {
    sellerpilotCoupangBaseSku: "NEW-SKU",
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: "safe_test",
    facts: { coupangOptionRows: [{ skuSuffix: "RED" }] },
    body: {
      displayCategoryCode: 59631,
      sellerProductName: "신규 상품",
      displayProductName: "신규 상품",
      brand: "테스트",
      outboundShippingPlaceCode: 12345,
      returnCenterCode: "RETURN-1",
      deliveryCompanyCode: "HANJIN",
      deliveryChargeType: "NOT_FREE",
      deliveryCharge: 3000,
      returnCharge: 4500,
      items: [{
        itemName: "신규 상품 빨강",
        externalVendorSku: "NEW-SKU-RED",
        salePrice: 12900,
        maximumBuyCount: 9,
        unitCount: 1,
        attributes: [{ attributeTypeName: "색상", attributeValueName: "빨강", exposed: "EXPOSED" }],
        notices: [{ noticeCategoryName: "기타 재화", noticeCategoryDetailName: "품명", content: "신규 상품" }],
      }],
    },
    sellerpilotAssets: {
      approvedDetailPageVersion: 3,
      detailImageManifestDigest: hash(9),
      approvedDetailImagePaths: Array.from({ length: 8 }, (_, i) => `approved/${i}.png`),
      approvedDetailImageSha256s: Array.from({ length: 8 }, (_, i) => hash(i + 1)),
      detailImageRoles: Array.from({ length: 8 }, (_, i) => `section-${i}`),
      detailImageUrls: Array.from({ length: 8 }, (_, i) => `https://signed.example/${i}?token=one`),
    },
  };
}
function publishContext() {
  return {
    product: { id: productId, sku: "NEW-SKU", name: "신규 상품", onHand: 9, costKrw: 8000 },
    manualFields: { sellerSku: "NEW-SKU" },
    assignments: [{ channel: "coupang", categoryId: "59631" }],
    detailPage: { version: 3, approvedVersion: 3, imageManifest: { digest: hash(9) } },
  };
}
function bind(args = argumentsValue()) {
  return bindCoupangCreateSourceRevision({
    argumentsValue: args,
    publishContext: publishContext(),
    productId,
    credentialId,
    credentialVersion: 7,
    credentialFingerprint: "ABCDEF123456",
    credentialEnvironment: "production",
    credentialExpiresAt: "2099-01-01T00:00:00.000Z",
    credential,
    officialReadEvidence: officialReadEvidence(),
    officialReadSnapshotId,
    officialReadSnapshotDigestSha256: hash(8),
    market: "KR",
    targetId: "A00123456",
  });
}

test("Coupang binds every CREATE input surface and credential incarnation to one server revision", () => {
  const bound = bind();
  const revision = bound[coupangCreateSourceRevisionArgument] as Record<string, unknown>;
  assert.equal(revision.contract, "sellerpilot_coupang_create_source_revision_v1");
  assert.equal(revision.productId, productId);
  assert.equal(revision.credentialId, credentialId);
  assert.equal(revision.credentialVersion, 7);
  assert.equal(revision.credentialFingerprint, "ABCDEF123456");
  assert.equal(revision.detailPageVersion, 3);
  assert.equal(revision.officialReadSnapshotId, officialReadSnapshotId);
  assert.equal(revision.officialReadSnapshotDigestSha256, hash(8));
  assert.match(String((revision.officialReadEvidence as Record<string, unknown>).evidenceSha256), /^[a-f0-9]{64}$/);
  assert.match(String(revision.sourceRevisionSha256), /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(revision), /wing-user|A00123456.*wing-user/);
  assert.equal(assertCoupangCreateSourceRevision({
    argumentsValue: bound,
    credentialId,
    environment: "production",
    credential,
  }).sourceRevisionSha256, revision.sourceRevisionSha256);
});

test("signed URL rotation is excluded while approved image identity remains revision-bound", () => {
  const bound = bind();
  const changed = structuredClone(bound);
  (changed.sellerpilotAssets as Record<string, unknown>).detailImageUrls =
    Array.from({ length: 8 }, (_, i) => `https://signed.example/${i}?token=two`);
  assert.doesNotThrow(() => assertCoupangCreateSourceRevision({
    argumentsValue: changed, credentialId, environment: "production", credential,
  }));
  ((changed.sellerpilotAssets as Record<string, unknown>).approvedDetailImageSha256s as string[])[0] = hash(8);
  assert.throws(() => assertCoupangCreateSourceRevision({
    argumentsValue: changed, credentialId, environment: "production", credential,
  }), /COUPANG_CREATE_REVISION_/);
});

test("an immutable image-prepared transmission binds its exact body without weakening the source snapshot", () => {
  const prepared = structuredClone(bind());
  const assets = prepared.sellerpilotAssets as Record<string, unknown>;
  delete assets.detailImageUrls;
  const body = prepared.body as Record<string, unknown>;
  const item = (body.items as Array<Record<string, unknown>>)[0];
  item.images = [{ imageOrder: 0, imageType: "REPRESENTATION", vendorPath: "https://cdn.example/normalized.jpg" }];
  item.contents = [{ contentsType: "IMAGE", contentDetails: [{ content: "https://cdn.example/detail.jpg", detailType: "IMAGE" }] }];
  const source = prepared[coupangCreateSourceRevisionArgument] as Record<string, unknown>;
  prepared[coupangCreateTransmissionArgument] = {
    contract: "sellerpilot_coupang_create_transmission_v1",
    transmissionId: "40000000-0000-4000-8000-000000000001",
    attemptId: "50000000-0000-4000-8000-000000000001",
    sourceSnapshotId: source.officialReadSnapshotId,
    sourceSnapshotDigestSha256: source.officialReadSnapshotDigestSha256,
    transmissionBodySha256: digest(body),
    transmissionDigestSha256: hash(7),
  };
  assert.doesNotThrow(() => assertCoupangCreateSourceRevision({
    argumentsValue: prepared, credentialId, environment: "production", credential,
  }));
  item.salePrice = 13900;
  assert.throws(() => assertCoupangCreateSourceRevision({
    argumentsValue: prepared, credentialId, environment: "production", credential,
  }), /COUPANG_CREATE_REVISION_MISMATCH/);
});

test("official GET evidence tampering or expiry invalidates the bound source revision", () => {
  const tampered = bind();
  const revision = tampered[coupangCreateSourceRevisionArgument] as Record<string, unknown>;
  (revision.officialReadEvidence as Record<string, unknown>).categoryStatusSha256 = "f".repeat(64);
  assert.throws(() => assertCoupangCreateSourceRevision({
    argumentsValue: tampered, credentialId, environment: "production", credential,
  }), /COUPANG_CREATE_REVISION_MISMATCH/);

  const stale = officialReadEvidence();
  stale.observedAt = "2020-01-01T00:00:00.000Z";
  assert.throws(() => bindCoupangCreateSourceRevision({
    argumentsValue: argumentsValue(), publishContext: publishContext(), productId, credentialId,
    credentialVersion: 7, credentialFingerprint: "ABCDEF123456", credentialEnvironment: "production",
    credentialExpiresAt: "2099-01-01T00:00:00.000Z", credential,
    officialReadEvidence: stale, market: "KR", targetId: "A00123456",
    officialReadSnapshotId,
    officialReadSnapshotDigestSha256: hash(8),
  }), /COUPANG_CREATE_OFFICIAL_READ_MISMATCH/);
});

test("durable snapshot identity and digest are server-owned and revision-bound", () => {
  for (const key of [
    "sellerpilotCoupangOfficialReadSnapshotId",
    "sellerpilotCoupangOfficialReadSnapshotDigestSha256",
  ]) {
    const browser = argumentsValue() as Record<string, unknown>;
    browser[key] = key.endsWith("Id") ? officialReadSnapshotId : hash(8);
    assert.throws(() => bind(browser as ReturnType<typeof argumentsValue>), /SERVER_OWNED/u);
  }
  for (const key of ["officialReadSnapshotId", "officialReadSnapshotDigestSha256"]) {
    const changed = bind();
    const revision = changed[coupangCreateSourceRevisionArgument] as Record<string, unknown>;
    revision[key] = key.endsWith("Id")
      ? "40000000-0000-4000-8000-000000000001"
      : hash(7);
    assert.throws(() => assertCoupangCreateSourceRevision({
      argumentsValue: changed,
      credentialId,
      environment: "production",
      credential,
    }), /COUPANG_CREATE_REVISION_MISMATCH/u);
  }
});

test("category, title, option, notice, price, stock, shipping and return drift all fail closed", () => {
  const mutations: Array<(value: ReturnType<typeof argumentsValue>) => void> = [
    (value) => { value.body.displayCategoryCode = 0; },
    (value) => { value.body.sellerProductName = ""; },
    (value) => { value.body.items[0]!.attributes = []; },
    (value) => { value.body.items[0]!.notices = []; },
    (value) => { value.body.items[0]!.salePrice = 0; },
    (value) => { value.body.items[0]!.maximumBuyCount = 0; },
    (value) => { value.body.outboundShippingPlaceCode = 0; },
    (value) => { value.body.returnCenterCode = ""; },
  ];
  for (const mutate of mutations) {
    const value = argumentsValue(); mutate(value);
    assert.throws(() => bind(value), /COUPANG_CREATE_REVISION_/);
  }
});

test("a browser marker, stale credential metadata, source version or seller identity is rejected", () => {
  const browser = argumentsValue();
  (browser as Record<string, unknown>)[coupangCreateSourceRevisionArgument] = {};
  assert.throws(() => bind(browser), /SERVER_OWNED/);
  const expired = argumentsValue();
  assert.throws(() => bindCoupangCreateSourceRevision({
    argumentsValue: expired, publishContext: publishContext(), productId, credentialId,
    credentialVersion: 7, credentialFingerprint: "ABCDEF123456", credentialEnvironment: "production",
    credentialExpiresAt: "2020-01-01T00:00:00.000Z", credential, market: "KR", targetId: "A00123456",
    officialReadEvidence: officialReadEvidence(),
    officialReadSnapshotId,
    officialReadSnapshotDigestSha256: hash(8),
  }), /SOURCE_INVALID/);
  const bound = bind();
  assert.throws(() => assertCoupangCreateSourceRevision({
    argumentsValue: bound, credentialId, environment: "production",
    credential: { vendor_id: "A00999999", requested_by: "wing-user" },
  }), /MISMATCH/);
});
