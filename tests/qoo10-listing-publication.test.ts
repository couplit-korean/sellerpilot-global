import assert from "node:assert/strict";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/operations";
import {
  normalizeQoo10ListingPublicationReadback,
  qoo10VerifiedListingRemoteState,
} from "../lib/channels/qoo10-listing-publication";

const FINGERPRINT = "a".repeat(64);
const detailHtml = `<section lang="ja-JP"><p>日本語の商品詳細です。</p>${Array.from(
  { length: 8 },
  (_, index) => `<img src="https://cdn.example.test/${index + 1}.jpg">`,
).join("")}</section>`;

function readback(status = "S2") {
  return {
    ItemNo: "1234567890",
    ItemStatus: status,
    ItemTitle: "日本語の商品名",
    SellerCode: "QA-JP-001",
    ItemDetail: detailHtml,
    ImageUrl: "https://cdn.example.test/1.jpg",
  };
}

test("Qoo10 read-only publication helper verifies identity, Japanese locale, fingerprint, and exactly eight detail images", () => {
  const remoteState = qoo10VerifiedListingRemoteState({
    operation: "listing.create",
    remoteId: "1234567890",
    resultObject: readback(),
    expectedSellerCode: "QA-JP-001",
    expectedLocale: "ja-JP",
    expectedFingerprint: FINGERPRINT,
    expectedImageCount: 8,
    verifiedAt: new Date("2026-08-29T20:00:00.000Z"),
  });
  assert.equal(remoteState?.visibility, "live");
  assert.equal(remoteState?.providerStatus, "S2");
  assert.equal(remoteState?.locale, "ja-JP");
  assert.equal(remoteState?.fingerprint, FINGERPRINT);
  assert.equal(remoteState?.imageCount, 8);
  assert.deepEqual(remoteState?.resources, {
    itemCode: "1234567890",
    sellerCode: "QA-JP-001",
    market: "JP",
  });
  assert.equal(remoteState?.evidence.identityVerified, true);
  assert.equal(remoteState?.evidence.localeVerified, true);
  assert.equal(remoteState?.evidence.imageCountVerified, true);
});

test("Qoo10 read-only publication helper fails shut on identity, locale, image-count, or status ambiguity", () => {
  const base = {
    operation: "listing.create" as const,
    remoteId: "1234567890",
    resultObject: readback(),
    expectedSellerCode: "QA-JP-001",
    expectedLocale: "ja-JP",
    expectedFingerprint: FINGERPRINT,
    expectedImageCount: 8,
  };
  assert.equal(qoo10VerifiedListingRemoteState({ ...base, resultObject: { ...readback(), ItemNo: "9999999999" } }), null);
  assert.equal(qoo10VerifiedListingRemoteState({
    ...base,
    resultObject: {
      ...readback(),
      ItemTitle: "English title",
      ItemDetail: detailHtml.replace("日本語の商品詳細です。", "English only").replace('lang="ja-JP"', ""),
    },
  }), null);
  assert.equal(qoo10VerifiedListingRemoteState({ ...base, expectedImageCount: 7 }), null);
  assert.equal(qoo10VerifiedListingRemoteState({ ...base, resultObject: readback("S9") }), null);
});

test("Qoo10 publication diagnostics preserve each passing field when one readback field mismatches", () => {
  const verification = normalizeQoo10ListingPublicationReadback({
    operation: "listing.create",
    remoteId: "1234567890",
    resultObject: readback(),
    expectedSellerCode: "DIFFERENT-SELLER-CODE",
    expectedLocale: "ja-JP",
    expectedFingerprint: FINGERPRINT,
    expectedImageCount: 8,
  });

  assert.equal(verification.remoteState, undefined);
  assert.equal(verification.providerStatus, "S2");
  assert.equal(verification.imageCount, 8);
  assert.deepEqual(verification.checks, {
    identityVerified: true,
    statusVerified: true,
    sellerCodeVerified: false,
    localeVerified: true,
    fingerprintVerified: true,
    imageCountVerified: true,
    sellerAccountIdentityVerified: true,
    categoryVerified: true,
    titleVerified: true,
    shippingVerified: true,
    priceQuantityVerified: true,
    representativeImageVerified: true,
    detailImageDigestVerified: true,
  });
});

test("Qoo10 safe_test create is rejected before any provider request", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({ ResultCode: 0 });
  };
  try {
    const operation = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.create",
      payload: { api_key: "test-key" },
      arguments: {
        publicationIntent: "safe_test",
        publicationStateContract: "verified_remote_state_v1",
        publicationExpectedLocale: "ja-JP",
        publicationExpectedFingerprint: FINGERPRINT,
        publicationExpectedImageCount: 8,
        params: {},
      },
      environment: "production",
    });
    assert.equal(fetchCount, 0);
    assert.equal(operation.ok, false);
    assert.equal(operation.steps[0]?.name, "safe-test-prewrite-fence");
    assert.equal(operation.steps[0]?.data.sellerpilotVerification, "QOO10_PREWRITE_REJECTED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 live create with the remote-state contract rejects a missing server-bound create context before provider access", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({ ResultCode: 0 });
  };
  try {
    const operation = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.create",
      payload: { api_key: "test-key", seller_id: "seller", test_item_code: "1098765432" },
      arguments: {
        publicationIntent: "live",
        publicationStateContract: "verified_remote_state_v1",
        publicationExpectedLocale: "ja-JP",
        publicationExpectedFingerprint: FINGERPRINT,
        publicationExpectedImageCount: 8,
        params: {
          SecondSubCat: "320002604",
          ItemTitle: "日本語の商品名",
          SellerCode: "QA-JP-001",
          StandardImage: "https://cdn.example.test/1.jpg",
          ItemDescription: detailHtml,
          RetailPrice: "0",
          ItemPrice: "2500",
          ItemQty: "1",
          ExpireDate: "2027-12-31",
          ShippingNo: "0",
          AvailableDateType: "0",
          AvailableDateValue: "3",
          AdultYN: "N",
        },
      },
      environment: "production",
    });
    assert.equal(operation.ok, false);
    assert.equal(fetchCount, 0);
    assert.equal(operation.steps[0]?.name, "qoo10-create-contract-preflight");
    assert.equal(operation.steps[0]?.data.sellerpilotVerification, "QOO10_CREATE_CONTRACT_UNVERIFIED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qoo10 stop becomes verified non-public only after Status 1 readback", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (input) => {
    const method = decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1) ?? "");
    methods.push(method);
    if (method === "ItemsLookup.GetItemDetailInfo") {
      return Response.json({ ResultCode: 0, ResultObject: readback("S1") });
    }
    return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
  };
  try {
    const operation = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.stop",
      payload: { api_key: "test-key" },
      arguments: {
        publicationStateContract: "verified_remote_state_v1",
        publicationExpectedLocale: "ja-JP",
        publicationExpectedFingerprint: FINGERPRINT,
        publicationExpectedImageCount: 0,
        params: { ItemCode: "1234567890", Status: "1" },
      },
      environment: "production",
    });
    assert.equal(operation.ok, true);
    assert.equal(operation.publicationFulfilled, true);
    assert.equal(operation.remoteState?.visibility, "non_public");
    assert.equal(operation.remoteState?.providerStatus, "S1");
    assert.deepEqual(methods, ["ItemsBasic.EditGoodsStatus", "ItemsLookup.GetItemDetailInfo"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
