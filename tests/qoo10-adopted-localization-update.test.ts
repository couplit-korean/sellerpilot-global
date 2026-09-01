import assert from "node:assert/strict";
import test from "node:test";

import { gatewayJobCompletionStatus } from "../lib/channels/gateway-contract";
import {
  qoo10ExactAdoptedLiveListingCandidate,
  qoo10ExactAdoptedLocalizationArgument,
  qoo10ExactAdoptedLocalizationContract,
  qoo10ExactLocalizationRecoveryIdentity,
  qoo10ExactLocalizationUpdateArgument,
  qoo10ExactLocalizationUpdateContract,
} from "../lib/channels/qoo10-exact-localization-recovery";
import { executeChannelOperation } from "../lib/channels/operations";

const identity = qoo10ExactLocalizationRecoveryIdentity;
const detailImageUrls = Array.from(
  { length: 8 },
  (_, index) => `https://cdn.example.test/qoo10-adopted-${index + 1}.jpg`,
);
const cleanDetail = `<section lang="ja-JP"><h1>${identity.title}</h1><p>ケーブルをすっきり整理できます。販売価格は1,871円です。</p>${detailImageUrls
  .map((url) => `<img src="${url}">`)
  .join("")}</section>`;
const dirtyDetail = cleanDetail.replace(
  "ケーブルをすっきり",
  "geomjeongsaek buchakhyeong keibeul jeongri keulrip 6gae 5000 KRW ケーブルをすっきり",
);

function representativeImage() {
  const value = String(identity.representativeImageContentId);
  return `https://gd.image-qoo10.jp/li/${value.slice(-3)}/${value.slice(-6, -3)}/${value}.g.jpg`;
}

function readback(detail: string) {
  return {
    ItemNo: identity.remoteId,
    ItemStatus: "S2",
    SellerCode: identity.sellerSku,
    SecondSubCatCd: identity.categoryCode,
    RetailPrice: "1871.0000",
    SellPrice: "1871.0000",
    ItemQty: "1",
    ShippingNo: identity.shippingNo,
    ItemTitle: identity.title,
    Keyword: identity.providerKeyword,
    PromotionName: "販売者が確認した入力だけに基づく商品案内",
    ItemDetail: detail,
    ImageUrl: representativeImage(),
  };
}

function argumentsValue() {
  return {
    [qoo10ExactLocalizationUpdateArgument]: {
      status: "allowed",
      contract: qoo10ExactLocalizationUpdateContract,
      productId: identity.productId,
      listingId: identity.listingId,
      credentialId: identity.credentialId,
      remoteId: identity.remoteId,
      sellerSku: identity.sellerSku,
      releaseSha: "a".repeat(40),
    },
    [qoo10ExactAdoptedLocalizationArgument]: {
      status: "allowed",
      contract: qoo10ExactAdoptedLocalizationContract,
      sourceJobId: "fac9c5c4-940d-4600-88f3-8f97a069dfbf",
      observationSha256: "b".repeat(64),
      prewriteSnapshotSha256: "c".repeat(64),
    },
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ja-JP",
    publicationExpectedFingerprint: "d".repeat(64),
    publicationExpectedImageCount: 8,
    params: {
      ItemCode: identity.remoteId,
      SellerCode: identity.sellerSku,
      SecondSubCat: identity.categoryCode,
      ItemTitle: identity.title,
      Keyword: identity.sourceKeyword,
      PromotionName: identity.promotionName,
      RetailPrice: "1871",
      ItemPrice: "1871",
      ItemQty: "1",
      ShippingNo: identity.shippingNo,
      ItemDescription: cleanDetail,
    },
  };
}

test("already-live candidate is the exact adopted published S2 tuple only", () => {
  const candidate = {
    channel: "qoo10",
    productId: identity.productId,
    credentialId: identity.credentialId,
    listingId: identity.listingId,
    remoteId: identity.remoteId,
    market: "JP",
    targetId: "",
    status: "published",
    failureClass: null,
    requestedPublicationIntent: "live",
    remoteVisibility: "live",
    providerStatus: "S2",
    publishedAt: "2026-09-01T10:45:00Z",
  } as const;
  assert.equal(qoo10ExactAdoptedLiveListingCandidate(candidate), true);
  for (const [field, value] of [
    ["remoteId", "1217336971"],
    ["status", "paused"],
    ["failureClass", "external_action"],
    ["remoteVisibility", "unknown"],
    ["providerStatus", "S1"],
    ["credentialId", "00000000-0000-4000-8000-000000000000"],
  ] as const) {
    assert.equal(qoo10ExactAdoptedLiveListingCandidate({
      ...candidate,
      [field]: value,
    }), false, field);
  }
});

test("adopted localization performs only content cleanup and requires fresh S2 readback", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let readbacks = 0;
  globalThis.fetch = async (input) => {
    const method = decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1) ?? "");
    calls.push(method);
    if (method === "ItemsLookup.GetItemDetailInfo") {
      readbacks += 1;
      return Response.json({
        ResultCode: 0,
        ResultObject: readback(readbacks === 1 ? dirtyDetail : cleanDetail),
      });
    }
    assert.equal(method, "ItemsContents.EditGoodsContents");
    return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
  };
  try {
    const result = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.update",
      payload: { api_key: "private-test-key" },
      arguments: argumentsValue(),
      environment: "production",
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.publicationFulfilled, true);
    assert.equal(result.remoteState?.providerStatus, "S2");
    assert.equal(result.remoteState?.visibility, "live");
    assert.deepEqual(calls, [
      "ItemsLookup.GetItemDetailInfo",
      "ItemsContents.EditGoodsContents",
      "ItemsLookup.GetItemDetailInfo",
    ]);
    assert.equal(calls.includes("ItemsBasic.UpdateGoods"), false);
    assert.equal(calls.includes("ItemsBasic.EditGoodsStatus"), false);
    assert.equal(gatewayJobCompletionStatus(result.operation, result.ok, result.steps), "succeeded");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("missing adopted marker fails before any provider request", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ ResultCode: 0 });
  };
  try {
    const broken = argumentsValue() as Record<string, unknown>;
    broken[qoo10ExactAdoptedLocalizationArgument] = {
      status: "allowed",
      contract: qoo10ExactAdoptedLocalizationContract,
      sourceJobId: "fac9c5c4-940d-4600-88f3-8f97a069dfbf",
      observationSha256: "bad",
      prewriteSnapshotSha256: "c".repeat(64),
    };
    const result = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.update",
      payload: { api_key: "private-test-key" },
      arguments: broken,
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.equal(result.steps[0]?.data.sellerpilotNoWriteConfirmed, true);
    assert.equal(calls, 0, JSON.stringify(result));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an ambiguous content response with no clean readback is quarantined for reconciliation", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const method = decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1) ?? "");
    calls.push(method);
    if (method === "ItemsContents.EditGoodsContents") {
      throw new TypeError("simulated connection loss after provider dispatch");
    }
    return Response.json({
      ResultCode: 0,
      ResultObject: readback(dirtyDetail),
    });
  };
  try {
    const result = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.update",
      payload: { api_key: "private-test-key" },
      arguments: argumentsValue(),
      environment: "production",
    });
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(
      gatewayJobCompletionStatus(result.operation, result.ok, result.steps),
      "reconciliation_required",
    );
    assert.equal(calls[0], "ItemsLookup.GetItemDetailInfo");
    assert.equal(calls[1], "ItemsContents.EditGoodsContents");
    assert.equal(
      calls.filter((method) => method === "ItemsLookup.GetItemDetailInfo").length,
      5,
    );
    assert.equal(calls.includes("ItemsBasic.UpdateGoods"), false);
    assert.equal(calls.includes("ItemsBasic.EditGoodsStatus"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
