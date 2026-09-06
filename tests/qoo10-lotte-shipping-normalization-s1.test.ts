import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { gatewayJobCompletionStatus } from "../lib/channels/gateway-contract";
import {
  bindQoo10RollbackUpdateRecoveryArguments,
  qoo10RollbackUpdateRecoveryArgument,
  qoo10RollbackUpdateRecoveryContract,
} from "../lib/channels/listing-update";
import { executeChannelOperation } from "../lib/channels/operations";
import {
  qoo10LotteShippingS1ExpectedShippingNo,
  qoo10LotteShippingS1Identity,
  qoo10LotteShippingS1OverlayAllowed,
  qoo10LotteShippingS1Target,
  qoo10ShippingS1VerifierArgument,
  qoo10ShippingS1VerifierContract,
} from "../lib/channels/qoo10-lotte-shipping-s1-identity";
import {
  qoo10S1ActivationArgument,
  qoo10S1ActivationArgumentsValid,
  qoo10S1ActivationContract,
} from "../lib/channels/qoo10-listing-activation";
import { normalizeQoo10ListingPublicationReadback } from "../lib/channels/qoo10-listing-publication";

const identity = qoo10LotteShippingS1Identity;
const fingerprint = "a".repeat(64);
const categoryCode = "300000579";
const title = "ロッテ ロッテサンド パスチャーミルク味 315g";
const keyword = "No Brand,購入前確認";
const sellerCode = identity.sellerSku;
const promotionName = "購入前確認";
const industrialCode = "8801069401234";
const retailPriceJpy = 500;
const sellPriceJpy = 500;
const quantity = 1;
const biContentsNo = 8465517811;
const detailImageUrls = Array.from(
  { length: 8 },
  (_, index) => `https://cdn.example.test/lotte-detail-${index + 1}.jpg`,
);
const detailHtml = `<section lang="ja-JP"><h1>${title}</h1>${detailImageUrls
  .map((url) => `<img src="${url}">`)
  .join("")}</section>`;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

const confirmationExpectedState = {
  categoryCode,
  retailPriceJpy,
  sellPriceJpy,
  quantity,
  shippingNo: identity.requestShippingSelector,
  biContentsNo,
} as const;

const recoveryBinding = {
  status: "allowed" as const,
  contract: qoo10RollbackUpdateRecoveryContract,
  listingId: identity.listingId,
  remoteId: identity.remoteId,
  providerStatus: "S1" as const,
  sourceJobId: identity.createJobId,
  expectedState: confirmationExpectedState,
};

function overlayInput(overrides: Partial<{
  listingId: string;
  remoteId: string;
  sourceJobId: string;
  updateJobId: string;
  requestShippingNo: string;
  confirmationShippingNo: string;
  observedShippingNos: readonly (string | null | undefined)[];
}> = {}) {
  return {
    listingId: identity.listingId,
    remoteId: identity.remoteId,
    sourceJobId: identity.createJobId,
    updateJobId: identity.updateJobId,
    requestShippingNo: identity.requestShippingSelector,
    confirmationShippingNo: identity.requestShippingSelector,
    observedShippingNos: [identity.observedShippingNo, identity.observedShippingNo],
    ...overrides,
  };
}

function qoo10Image(contentId = biContentsNo) {
  const value = String(contentId);
  return `https://gd.image-qoo10.jp/li/${value.slice(-3)}/${value.slice(-6, -3)}/${value}.g.jpg`;
}

function readback(status: "S1" | "S2", overrides: Record<string, unknown> = {}) {
  return {
    ItemNo: identity.remoteId,
    ItemStatus: status,
    SellerCode: sellerCode,
    SecondSubCatCd: categoryCode,
    RetailPrice: String(retailPriceJpy),
    SellPrice: String(sellPriceJpy),
    ItemQty: String(quantity),
    ShippingNo: identity.observedShippingNo,
    ItemTitle: title,
    Keyword: keyword,
    PromotionName: promotionName,
    IndustrialCode: industrialCode,
    ProductionPlaceType: "2",
    ProductionPlace: "KR",
    AdultYN: "N",
    ItemDetail: detailHtml,
    ImageUrl: qoo10Image(),
    BIContentsNo: String(biContentsNo),
    ...overrides,
  };
}

function listingUpdateArguments() {
  return {
    [qoo10RollbackUpdateRecoveryArgument]: recoveryBinding,
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ja-JP",
    publicationExpectedFingerprint: fingerprint,
    publicationExpectedImageCount: 8,
    params: {
      ItemCode: identity.remoteId,
      SellerCode: sellerCode,
      SecondSubCat: categoryCode,
      ItemTitle: title,
      Keyword: `${title},${keyword}`,
      ProductionPlaceType: "2",
      ProductionPlace: "KR",
      RetailPrice: String(retailPriceJpy),
      ItemPrice: String(sellPriceJpy),
      ItemQty: String(quantity),
      ShippingNo: identity.requestShippingSelector,
      AvailableDateType: "0",
      AvailableDateValue: "3",
      PromotionName: promotionName,
      IndustrialCode: industrialCode,
      AdultYN: "N",
      ItemDescription: detailHtml,
    },
  };
}

function verifierArguments(options: {
  marker?: "shipping" | "exact";
  requestShippingNo?: string;
  confirmationShippingNo?: string;
  sourceObservedShippingNo?: string;
  listingId?: string;
  remoteId?: string;
  sourceJobId?: string;
  updateJobId?: string;
} = {}) {
  const sourceArguments = {
    ...listingUpdateArguments(),
    [qoo10RollbackUpdateRecoveryArgument]: {
      ...recoveryBinding,
      listingId: options.listingId ?? identity.listingId,
      remoteId: options.remoteId ?? identity.remoteId,
      sourceJobId: options.sourceJobId ?? identity.createJobId,
      expectedState: {
        ...confirmationExpectedState,
        shippingNo: options.confirmationShippingNo ?? identity.requestShippingSelector,
      },
    },
    params: {
      ...listingUpdateArguments().params,
      ItemCode: options.remoteId ?? identity.remoteId,
      ShippingNo: options.requestShippingNo ?? identity.requestShippingSelector,
    },
  };
  const updateJobId = options.updateJobId ?? identity.updateJobId;
  const remoteId = options.remoteId ?? identity.remoteId;
  return {
    sellerpilotReadOnly: true,
    ...(options.marker === "exact"
      ? { sellerpilotQoo10ExactS1Recovery: "qoo10_exact_s1_verifier_v1" }
      : { [qoo10ShippingS1VerifierArgument]: qoo10ShippingS1VerifierContract }),
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ja-JP",
    publicationExpectedFingerprint: fingerprint,
    publicationExpectedImageCount: 8,
    publicationReviewSourceJobId: updateJobId,
    remoteId,
    market: "JP",
    targetId: identity.targetId,
    sellerpilotPublicationSource: {
      contract: "listing_publication_verification_source_v1",
      verificationJobId: "72000000-0000-4000-8000-000000000001",
      sourceJobId: updateJobId,
      sourceOperation: "listing.update",
      sourceArguments,
      sourceResponsePayload: {
        ok: false,
        channel: "qoo10",
        operation: "listing.update",
        remoteId,
        steps: [{
          name: "qoo10-rollback-pre-activation-readback",
          ok: false,
          status: 200,
          data: {
            ResultCode: 0,
            ResultObject: readback("S1", {
              ShippingNo: options.sourceObservedShippingNo ?? identity.observedShippingNo,
            }),
          },
        }],
      },
      sourceFingerprint: fingerprint,
      expectedRemoteId: remoteId,
      expectedLocale: "ja-JP",
      expectedImageCount: 8,
      market: "JP",
      targetId: identity.targetId,
    },
  };
}

function qooMethod(input: RequestInfo | URL) {
  return decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1) ?? "");
}

async function withoutOperationDelays<T>(run: () => Promise<T>) {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, _delay?: number, ...args: unknown[]) => {
    callback(...args);
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  try {
    return await run();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
}

test("Lotte shipping S1 identity is distinct from fac9 and pins the live tuple", () => {
  assert.equal(identity.productId, "1ed4acfc-7603-48ec-a638-241131e59358");
  assert.equal(identity.listingId, "13858f41-78fd-463f-9390-e8f06e71e538");
  assert.equal(identity.remoteId, "1217536689");
  assert.equal(identity.credentialId, "2b49d081-5188-4a75-9555-e0a6438e8a2b");
  assert.equal(identity.createJobId, "687852dc-36de-4049-b170-bdf7839ccf2f");
  assert.equal(identity.updateJobId, "089467c1-cadb-4d31-93a8-d5882c46d753");
  assert.equal(qoo10LotteShippingS1Target(identity.productId, identity.listingId), true);
  assert.equal(qoo10LotteShippingS1Target("ddccde35-9c58-4856-b673-d7aa27ce4220", identity.listingId), false);
  assert.equal(qoo10LotteShippingS1Target(identity.productId, "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc"), false);
});

test("shipping overlay requires selector 0 plus dual observed 806971 on this listing only", () => {
  assert.equal(qoo10LotteShippingS1OverlayAllowed(overlayInput()), true);
  assert.equal(qoo10LotteShippingS1ExpectedShippingNo(overlayInput()), identity.observedShippingNo);
  assert.equal(qoo10LotteShippingS1OverlayAllowed(overlayInput({
    requestShippingNo: identity.observedShippingNo,
  })), false);
  assert.equal(qoo10LotteShippingS1OverlayAllowed(overlayInput({
    confirmationShippingNo: identity.observedShippingNo,
  })), false);
  assert.equal(qoo10LotteShippingS1OverlayAllowed(overlayInput({
    observedShippingNos: [identity.observedShippingNo],
  })), false);
  assert.equal(qoo10LotteShippingS1OverlayAllowed(overlayInput({
    observedShippingNos: [identity.observedShippingNo, "42"],
  })), false);
  assert.equal(qoo10LotteShippingS1OverlayAllowed(overlayInput({
    listingId: "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc",
  })), false);
  assert.equal(
    qoo10LotteShippingS1ExpectedShippingNo(overlayInput({
      observedShippingNos: [identity.observedShippingNo],
    })),
    identity.requestShippingSelector,
  );
});

test("listing.update binder stays fail-closed on confirmation selector 0", () => {
  const bound = bindQoo10RollbackUpdateRecoveryArguments({
    [qoo10RollbackUpdateRecoveryArgument]: {
      ...recoveryBinding,
      expectedState: { ...confirmationExpectedState, shippingNo: identity.observedShippingNo },
    },
    params: {
      ItemCode: "9999999999",
      SecondSubCat: "300000536",
      RetailPrice: "3190",
      ItemPrice: "3190",
      ItemQty: "9",
      ShippingNo: identity.observedShippingNo,
    },
  }, recoveryBinding);
  assert.equal(
    (bound.params as Record<string, unknown>).ShippingNo,
    identity.requestShippingSelector,
  );
  assert.equal(
    (bound[qoo10RollbackUpdateRecoveryArgument] as typeof recoveryBinding).expectedState.shippingNo,
    identity.requestShippingSelector,
  );
});

test("listing.update strict readback does not treat 0 as 806971", () => {
  const publication = normalizeQoo10ListingPublicationReadback({
    operation: "listing.update",
    remoteId: identity.remoteId,
    resultObject: readback("S1"),
    expectedLocale: "ja-JP",
    expectedFingerprint: fingerprint,
    expectedImageCount: 8,
    expectedSellerCode: sellerCode,
    expectedRecovery: {
      ...confirmationExpectedState,
      detailImageUrls,
    },
  });
  assert.equal(publication.checks.shippingVerified, false);
  assert.equal(publication.remoteState, undefined);
});

test("listing.update path still reconciles when remote shipping is the stored group", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (input) => {
    const method = qooMethod(input);
    methods.push(method);
    if (method === "ItemsBasic.UpdateGoods") {
      return Response.json({ ResultCode: 0, ResultObject: { GdNo: identity.remoteId } });
    }
    if (method === "ItemsLookup.GetItemDetailInfo") {
      return Response.json({ ResultCode: 0, ResultObject: readback("S1") });
    }
    return Response.json({ ResultCode: 0, ResultMsg: "SUCCESS" });
  };
  try {
    const result = await withoutOperationDelays(() => executeChannelOperation({
      channel: "qoo10",
      operation: "listing.update",
      payload: { api_key: "test-key" },
      arguments: listingUpdateArguments(),
      environment: "production",
    }));
    assert.equal(result.ok, false);
    assert.equal(gatewayJobCompletionStatus(result.operation, result.ok, result.steps), "reconciliation_required");
    assert.equal(methods.includes("ItemsBasic.UpdateGoods"), true);
    assert.equal(methods.includes("ItemsContents.EditGoodsContents"), true);
    assert.equal(methods.includes("ItemsBasic.EditGoodsStatus"), false);
    assert.equal(
      result.steps.some((step) => step.name === "qoo10-rollback-pre-activation-readback"),
      true,
    );
    const checks = result.steps.find((step) => step.name === "qoo10-rollback-pre-activation-readback")
      ?.data.sellerpilotPublicationChecks as Record<string, boolean> | undefined;
    assert.equal(checks?.shippingVerified, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("read-only shipping S1 verifier overlays 806971 and hydrates activation expectedState", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (input) => {
    methods.push(qooMethod(input));
    return Response.json({ ResultCode: 0, ResultObject: readback("S1") });
  };
  try {
    const result = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.publication.verify",
      payload: { api_key: "test-key" },
      arguments: verifierArguments(),
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(methods, ["ItemsLookup.GetItemDetailInfo"]);
    assert.equal(methods.some((method) => method.includes("UpdateGoods")), false);
    assert.equal(methods.some((method) => method.includes("EditGoodsStatus")), false);
    assert.equal(result.remoteState?.providerStatus, "S1");
    assert.equal(result.remoteState?.visibility, "non_public");
    const expectation = result.steps[1]?.data.sellerpilotQoo10ActivationExpectation as {
      expectedState?: { shippingNo?: string };
    };
    assert.equal(expectation.expectedState?.shippingNo, identity.observedShippingNo);
    assert.equal(
      (result.steps[0]?.data.sellerpilotPublicationChecks as Record<string, boolean>).shippingVerified,
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exact S1 marker on the Lotte tuple also overlays observed shipping", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ ResultCode: 0, ResultObject: readback("S1") });
  try {
    const result = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.publication.verify",
      payload: { api_key: "test-key" },
      arguments: verifierArguments({ marker: "exact" }),
      environment: "production",
    });
    assert.equal(result.ok, true);
    const expectation = result.steps[1]?.data.sellerpilotQoo10ActivationExpectation as {
      expectedState?: { shippingNo?: string };
    };
    assert.equal(expectation.expectedState?.shippingNo, identity.observedShippingNo);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("verifier stays fail-closed without dual observed 806971", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    ResultCode: 0,
    ResultObject: readback("S1"),
  });
  try {
    const result = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.publication.verify",
      payload: { api_key: "test-key" },
      arguments: verifierArguments({
        sourceObservedShippingNo: "42",
      }),
      environment: "production",
    });
    assert.equal(result.ok, false);
    assert.equal(result.steps[1]?.data.sellerpilotQoo10ActivationExpectation, undefined);
    assert.equal(
      (result.steps[0]?.data.sellerpilotPublicationChecks as Record<string, boolean>).shippingVerified,
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("activation marker expectedState shipping 806971 performs one EditGoodsStatus then S2 readback", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  const marker = {
    status: "allowed",
    contract: qoo10S1ActivationContract,
    listingId: identity.listingId,
    remoteId: identity.remoteId,
    providerStatus: "S1",
    sourceJobId: identity.updateJobId,
    verifierJobId: "33333333-3333-4333-8333-333333333333",
    verifierResponseSha256: "4".repeat(64),
    verifierCompletedAt: "2026-09-04T14:40:12.844123+00:00",
    expectedState: {
      categoryCode,
      retailPriceJpy,
      sellPriceJpy,
      quantity,
      shippingNo: identity.observedShippingNo,
      biContentsNo,
      originType: "2",
      originCode: "KR",
      adultYn: "N",
    },
    expectedTitle: title,
    expectedKeyword: keyword,
    expectedPromotionName: promotionName,
    expectedIndustrialCode: industrialCode,
    expectedDetailHtmlSha256: digest(detailHtml),
    expectedDetailImageUrls: detailImageUrls,
    expectedSellerCode: sellerCode,
  } as const;
  const argumentsValue = {
    [qoo10S1ActivationArgument]: marker,
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ja-JP",
    publicationExpectedFingerprint: fingerprint,
    publicationExpectedImageCount: 8,
    params: {
      ...listingUpdateArguments().params,
      ShippingNo: identity.observedShippingNo,
    },
  };
  assert.equal(qoo10S1ActivationArgumentsValid(argumentsValue), true);
  globalThis.fetch = async (input) => {
    const method = qooMethod(input);
    methods.push(method);
    if (method === "ItemsBasic.EditGoodsStatus") {
      return Response.json({ ResultCode: "0", ResultMsg: "SUCCESS" });
    }
    if (method === "ItemsLookup.GetItemDetailInfo") {
      return Response.json({ ResultCode: 0, ResultObject: readback("S2") });
    }
    throw new Error(`unexpected provider method ${method}`);
  };
  try {
    const result = await executeChannelOperation({
      channel: "qoo10",
      operation: "listing.activate",
      payload: { api_key: "test-key" },
      arguments: argumentsValue,
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(result.remoteState?.providerStatus, "S2");
    assert.equal(result.remoteState?.visibility, "live");
    assert.deepEqual(methods, [
      "ItemsBasic.EditGoodsStatus",
      "ItemsLookup.GetItemDetailInfo",
    ]);
    assert.equal(methods.some((method) => method.includes("UpdateGoods")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
