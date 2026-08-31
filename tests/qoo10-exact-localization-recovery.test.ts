import assert from "node:assert/strict";
import test from "node:test";
import { gatewayJobCompletionStatus } from "../lib/channels/gateway-contract";
import {
  qoo10ExactForeignPriceCopyPresent,
  qoo10ExactLegacyRomanizedCopyPresent,
  qoo10ExactLocalizationRecoveryIdentity,
  qoo10ExactLocalizedUpdate,
  qoo10ExactTargetCreateForbidden,
  verifyQoo10ExactCurrentS1Readback,
} from "../lib/channels/qoo10-exact-localization-recovery";
import {
  qoo10RollbackUpdateRecoveryArgument,
  qoo10RollbackUpdateRecoveryContract,
} from "../lib/channels/listing-update";
import { executeChannelOperation } from "../lib/channels/operations";

const identity = qoo10ExactLocalizationRecoveryIdentity;
const fingerprint = "a".repeat(64);
const detailImageUrls = Array.from(
  { length: 8 },
  (_, index) => `https://cdn.example.test/qoo10-approved-${index + 1}.jpg`,
);
const detailHtml = `<section lang="ja-JP"><h1>${identity.title}</h1><p>ケーブルをきれいに整理し、購入前にサイズと設置面をご確認ください。</p>${detailImageUrls
  .map((url) => `<img src="${url}">`)
  .join("")}</section>`;
const biContentsNo = 8461402963;
const recoveryBinding = {
  status: "allowed",
  contract: qoo10RollbackUpdateRecoveryContract,
  listingId: "11111111-1111-4111-8111-111111111111",
  remoteId: identity.remoteId,
  providerStatus: "S1",
  sourceJobId: "22222222-2222-4222-8222-222222222222",
  expectedState: {
    categoryCode: identity.categoryCode,
    retailPriceJpy: 1871,
    sellPriceJpy: 1871,
    quantity: 1,
    shippingNo: "806971",
    biContentsNo,
  },
} as const;

function exactArguments(detail = detailHtml) {
  return {
    [qoo10RollbackUpdateRecoveryArgument]: recoveryBinding,
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ja-JP",
    publicationExpectedFingerprint: fingerprint,
    publicationExpectedImageCount: 8,
    params: {
      ItemCode: identity.remoteId,
      SellerCode: identity.sellerSku,
      SecondSubCat: identity.categoryCode,
      ItemTitle: identity.title,
      Keyword: identity.sourceKeyword,
      ProductionPlaceType: "2",
      ProductionPlace: "CN",
      RetailPrice: "1871",
      ShippingNo: "806971",
      AvailableDateType: "0",
      AvailableDateValue: "3",
      AdultYN: "N",
      ItemDescription: detail,
    },
  };
}

function qoo10BiImage(contentId = biContentsNo) {
  const value = String(contentId);
  return `https://gd.image-qoo10.jp/li/${value.slice(-3)}/${value.slice(-6, -3)}/${value}.g.jpg`;
}

function readback(status: "S1" | "S2", overrides: Record<string, unknown> = {}) {
  return {
    ItemNo: identity.remoteId,
    ItemStatus: status,
    SellerCode: identity.sellerSku,
    SecondSubCatCd: identity.categoryCode,
    RetailPrice: "1871.0000",
    SellPrice: "1871.0000",
    ItemQty: "1",
    ShippingNo: "806971",
    ItemTitle: identity.title,
    Keyword: identity.providerKeyword,
    ProductionPlaceType: "2",
    ProductionPlace: "CN",
    AdultYN: "N",
    ItemDetail: detailHtml,
    ImageUrl: qoo10BiImage(),
    ...overrides,
  };
}

function qooMethod(input: RequestInfo | URL) {
  return decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1) ?? "");
}

function operation(argumentsValue = exactArguments()) {
  return executeChannelOperation({
    channel: "qoo10",
    operation: "listing.update",
    payload: { api_key: "private-test-key" },
    arguments: argumentsValue,
    environment: "production",
  });
}

test("exact Qoo10 localization contract accepts only the reviewed Japanese copy and eight distinct HTTPS images", () => {
  assert.equal(qoo10ExactLocalizedUpdate(exactArguments(), identity.remoteId)?.detailImageUrls.length, 8);
  assert.equal(qoo10ExactLocalizedUpdate(exactArguments(), "9999999999"), null);
  assert.equal(qoo10ExactLegacyRomanizedCopyPresent(identity.legacyRomanizedName), true);
  assert.equal(qoo10ExactLegacyRomanizedCopyPresent("keibeul organizer"), true);
  assert.equal(qoo10ExactLegacyRomanizedCopyPresent("色はgeomjeongsaekです。"), true);
  assert.equal(qoo10ExactLegacyRomanizedCopyPresent(identity.title), false);
  assert.equal(qoo10ExactForeignPriceCopyPresent("価格は5000 KRWです。"), true);
  assert.equal(qoo10ExactForeignPriceCopyPresent("価格は₩5,000です。"), true);
  assert.equal(qoo10ExactForeignPriceCopyPresent("가격은 5,000원입니다."), true);
  assert.equal(qoo10ExactForeignPriceCopyPresent("価格は5,000ウォンです。"), true);
  assert.equal(qoo10ExactForeignPriceCopyPresent("販売価格は1,871円です。"), false);

  const legacyDetail = detailHtml.replace(
    "ケーブルをきれいに整理し",
    `${identity.legacyRomanizedName} ケーブルをきれいに整理し`,
  );
  assert.throws(
    () => qoo10ExactLocalizedUpdate(exactArguments(legacyDetail), identity.remoteId),
    /QOO10_EXACT_LOCALIZED_UPDATE_INVALID/,
  );
  for (const residual of ["geomjeongsaek", "5000 KRW", "₩5,000", "5,000원", "5,000ウォン"]) {
    assert.throws(
      () => qoo10ExactLocalizedUpdate(
        exactArguments(detailHtml.replace("購入前に", `${residual} 購入前に`)),
        identity.remoteId,
      ),
      /QOO10_EXACT_LOCALIZED_UPDATE_INVALID/,
      residual,
    );
  }
  const duplicateImageDetail = detailHtml.replace(detailImageUrls[7], detailImageUrls[6]);
  assert.throws(
    () => qoo10ExactLocalizedUpdate(exactArguments(duplicateImageDetail), identity.remoteId),
    /QOO10_EXACT_LOCALIZED_UPDATE_INVALID/,
  );
  assert.throws(
    () => qoo10ExactLocalizedUpdate({
      ...exactArguments(),
      params: { ...exactArguments().params, Keyword: identity.providerKeyword },
    }, identity.remoteId),
    /QOO10_EXACT_LOCALIZED_UPDATE_INVALID/,
  );
  assert.throws(
    () => qoo10ExactLocalizedUpdate({
      ...exactArguments(),
      params: { ...exactArguments().params, SellerCode: "OTHER-SKU" },
    }, identity.remoteId),
    /QOO10_EXACT_LOCALIZED_UPDATE_INVALID/,
  );
});

test("exact Qoo10 duplicate create identities are closed without blocking unrelated products", () => {
  for (const params of [
    { ItemCode: identity.remoteId },
    { SellerCode: identity.sellerSku },
    { SellerCode: `${identity.sellerSku}-R2` },
    { ItemTitle: identity.title, SecondSubCat: identity.categoryCode },
  ]) assert.equal(qoo10ExactTargetCreateForbidden({ params }), true);
  assert.equal(qoo10ExactTargetCreateForbidden({
    params: { SellerCode: "OTHER-SKU", ItemTitle: "別の商品", SecondSubCat: identity.categoryCode },
  }), false);
});

test("exact Qoo10 current-state verifier binds one S1 identity to the unchanged ordered eight images", () => {
  assert.equal(verifyQoo10ExactCurrentS1Readback({
    resultObject: readback("S1"),
    expectedDetailImageUrls: detailImageUrls,
  }).ok, true);
  for (const resultObject of [
    readback("S2"),
    readback("S1", { ItemCode: "9999999999" }),
    readback("S1", { SellerCode: "" }),
    readback("S1", { SecondSubCatCd: "999999999" }),
    readback("S1", { ItemDetail: detailHtml.replace(detailImageUrls[7], "https://cdn.example.test/drift.jpg") }),
    readback("S1", { ItemDetail: detailHtml.replace(
      `${detailImageUrls[6]}"><img src="${detailImageUrls[7]}`,
      `${detailImageUrls[7]}"><img src="${detailImageUrls[6]}`,
    ) }),
    [readback("S1"), readback("S1")],
  ]) assert.equal(verifyQoo10ExactCurrentS1Readback({
    resultObject,
    expectedDetailImageUrls: detailImageUrls,
  }).ok, false);
});

test("exact Qoo10 update performs GET-before-PUT, preserves eight images, and stops at verified S1", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let readbackCount = 0;
  globalThis.fetch = async (input) => {
    const method = qooMethod(input);
    calls.push(method);
    if (method === "ItemsLookup.GetItemDetailInfo") {
      readbackCount += 1;
      const currentLegacyDetail = `<section><p>${identity.legacyRomanizedName}</p>${detailImageUrls
        .map((url) => `<img src="${url}">`)
        .join("")}</section>`;
      return Response.json({
        ResultCode: 0,
        ResultObject: readback("S1", readbackCount === 1
          ? { ItemTitle: identity.legacyRomanizedName, ItemDetail: currentLegacyDetail }
          : {}),
      });
    }
    if (method === "ItemsBasic.UpdateGoods") {
      return Response.json({ ResultCode: 0, ResultObject: { GdNo: identity.remoteId } });
    }
    return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
  };
  try {
    const result = await operation();
    assert.equal(result.ok, false, "S1 does not falsely fulfill the requested live publication intent");
    assert.equal(result.publicationFulfilled, false);
    assert.equal(result.remoteState?.providerStatus, "S1");
    assert.equal(result.remoteState?.visibility, "non_public");
    assert.deepEqual(calls, [
      "ItemsLookup.GetItemDetailInfo",
      "ItemsBasic.UpdateGoods",
      "ItemsContents.EditGoodsContents",
      "ItemsLookup.GetItemDetailInfo",
    ]);
    assert.equal(calls.includes("ItemsBasic.EditGoodsStatus"), false);
    assert.deepEqual(result.steps.map((step) => step.name), [
      "qoo10-exact-current-s1-prewrite-readback",
      "UpdateGoods",
      "EditGoodsContents",
      "qoo10-rollback-pre-activation-readback",
    ]);
    assert.equal(
      gatewayJobCompletionStatus(result.operation, result.ok, result.steps),
      "reconciliation_required",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exact Qoo10 update makes no provider write when current status or approved images drift", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const current of [
      readback("S2"),
      readback("S1", { ItemDetail: detailHtml.replace(detailImageUrls[7], "https://cdn.example.test/drift.jpg") }),
    ]) {
      const calls: string[] = [];
      globalThis.fetch = async (input) => {
        calls.push(qooMethod(input));
        return Response.json({ ResultCode: 0, ResultObject: current });
      };
      const result = await operation();
      assert.equal(result.ok, false);
      assert.deepEqual(calls, ["ItemsLookup.GetItemDetailInfo"]);
      assert.equal(result.steps[0]?.data.sellerpilotNoWriteConfirmed, true);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
