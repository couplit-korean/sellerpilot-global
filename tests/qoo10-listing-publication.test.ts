import assert from "node:assert/strict";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/operations";
import { qoo10VerifiedListingRemoteState } from "../lib/channels/qoo10-listing-publication";

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

test("Qoo10 live create returns verified_remote_state_v1 only after exact GetItemDetailInfo readback", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (input) => {
    const method = decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1) ?? "");
    methods.push(method);
    if (method === "ItemsBasic.SetNewGoods") {
      return Response.json({ ResultCode: 0, ResultObject: { GdNo: "1234567890" } });
    }
    if (method === "ItemsLookup.GetItemDetailInfo") {
      return Response.json({ ResultCode: 0, ResultObject: readback("S2") });
    }
    return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
  };
  try {
    const operation = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.create",
      payload: { api_key: "test-key" },
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
          AudultYN: "N",
        },
      },
      environment: "production",
    });
    assert.equal(operation.ok, true);
    assert.equal(operation.publicationStateContract, "verified_remote_state_v1");
    assert.equal(operation.publicationIntent, "live");
    assert.equal(operation.publicationFulfilled, true);
    assert.equal(operation.remoteState?.visibility, "live");
    assert.equal(operation.remoteState?.imageCount, 8);
    assert.deepEqual(methods, [
      "ItemsBasic.SetNewGoods",
      "ItemsContents.EditGoodsContents",
      "ItemsLookup.GetItemDetailInfo",
    ]);
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
