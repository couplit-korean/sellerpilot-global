import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import type { GatewayClaim } from "../lib/channels/gateway-contract";
import {
  gatewayJobCompletionStatus,
  gatewayWorkerCompletionSchema,
} from "../lib/channels/gateway-contract";
import {
  qoo10S1ActivationArgument,
  qoo10S1ActivationBinding,
  qoo10S1ActivationContract,
} from "../lib/channels/qoo10-listing-activation";
import {
  qoo10RollbackUpdateRecoveryArgument,
  qoo10RollbackUpdateRecoveryContract,
} from "../lib/channels/listing-update";
import { executeChannelOperation } from "../lib/channels/operations";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const {
  executeServerlessGatewayProviderJob,
  serverlessGatewayOperationAllowed,
} = await import("../lib/channels/serverless-gateway-provider");

const remoteId = "1217336970";
const categoryCode = "320000542";
const title = "貼り付け式ケーブル整理クリップ6個セット";
const keyword = "No Brand,購入前確認";
const sellerCode = "QA-20260823-CC-001";
const promotionName = "期間限定テスト";
const industrialCode = "8801234567890";
const detailImageUrls = Array.from(
  { length: 8 },
  (_, index) => `https://cdn.example.test/qoo10-detail-${index + 1}.jpg`,
);
const detailHtml = `<section lang="ja-JP"><h1>${title}</h1>${detailImageUrls
  .map((url) => `<img src="${url}">`)
  .join("")}</section>`;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

const marker = {
  status: "allowed",
  contract: qoo10S1ActivationContract,
  listingId: "11111111-1111-4111-8111-111111111111",
  remoteId,
  providerStatus: "S1",
  sourceJobId: "22222222-2222-4222-8222-222222222222",
  verifierJobId: "33333333-3333-4333-8333-333333333333",
  verifierResponseSha256: "4".repeat(64),
  verifierCompletedAt: "2026-08-30T23:40:12.844123+00:00",
  expectedState: {
    categoryCode,
    retailPriceJpy: 1871,
    sellPriceJpy: 1871,
    quantity: 1,
    shippingNo: "806971",
    biContentsNo: 8461402963,
    originType: "2",
    originCode: "CN",
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

for (const timestamp of [
  "2026-08-30T23:40:12Z",
  "2026-08-30T23:40:12.844Z",
  "2026-08-30T23:40:12.844123+00:00",
  "2026-08-31T08:40:12.844123+09:00",
] as const) {
  test(`activation marker accepts strict timezone-bound PostgreSQL timestamp ${timestamp}`, () => {
    assert.notEqual(qoo10S1ActivationBinding(argumentsValue({
      ...marker,
      verifierCompletedAt: timestamp,
    })), null);
  });
}

for (const timestamp of [
  "2026-08-30 23:40:12.844123+00:00",
  "2026-08-30T23:40:12.844123",
  "2026-08-30T23:40:12.844123+0000",
  "2026-08-30T23:40:12.8441234+00:00",
  "2026-02-30T23:40:12.844123+00:00",
  "2026-08-30T24:00:00+00:00",
] as const) {
  test(`activation marker rejects non-canonical or invalid timestamp ${timestamp}`, () => {
    assert.equal(qoo10S1ActivationBinding(argumentsValue({
      ...marker,
      verifierCompletedAt: timestamp,
    })), null);
  });
}

function argumentsValue(markerValue: unknown = marker) {
  return {
    [qoo10S1ActivationArgument]: markerValue,
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ja-JP",
    publicationExpectedFingerprint: "a".repeat(64),
    publicationExpectedImageCount: 8,
    params: {
      ItemCode: remoteId,
      SellerCode: sellerCode,
      SecondSubCat: categoryCode,
      ItemTitle: title,
      Keyword: `${title},${keyword}`,
      RetailPrice: "1871",
      ItemPrice: "1871",
      ItemQty: "1",
      BIContentsNo: "8461402963",
      StandardImage: qoo10Image(),
      ShippingNo: "806971",
      PromotionName: promotionName,
      IndustrialCode: industrialCode,
      ProductionPlaceType: "2",
      ProductionPlace: "CN",
      AdultYN: "N",
      ItemDescription: detailHtml,
    },
  };
}

function qoo10Image(contentId = marker.expectedState.biContentsNo) {
  const value = String(contentId);
  return `https://gd.image-qoo10.jp/li/${value.slice(-3)}/${value.slice(-6, -3)}/${value}.g.jpg`;
}

function readback(status: "S1" | "S2", overrides: Record<string, unknown> = {}) {
  return {
    ItemNo: remoteId,
    ItemStatus: status,
    SellerCode: sellerCode,
    SecondSubCatCd: categoryCode,
    RetailPrice: "1871.0000",
    SellPrice: "1871.0000",
    ItemQty: "1",
    ShippingNo: "806971",
    ItemTitle: title,
    Keyword: keyword,
    PromotionName: promotionName,
    IndustrialCode: industrialCode,
    ProductionPlaceType: "2",
    ProductionPlace: "CN",
    AdultYN: "N",
    ItemDetail: detailHtml,
    ImageUrl: qoo10Image(),
    ...overrides,
  };
}

function qooMethod(input: RequestInfo | URL) {
  return decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1) ?? "");
}

function operation(operation = "listing.activate" as const, args = argumentsValue()) {
  return executeChannelOperation({
    channel: "qoo10",
    operation,
    payload: { api_key: "test-key" },
    arguments: args,
    environment: "production",
  });
}

function languageCaseArguments(caseTitle: string, caseDetailHtml: string, caseKeyword: string) {
  return {
    ...argumentsValue(),
    [qoo10S1ActivationArgument]: {
      ...marker,
      expectedTitle: caseTitle,
      expectedKeyword: caseKeyword,
      expectedDetailHtmlSha256: digest(caseDetailHtml),
    },
    params: {
      ...argumentsValue().params,
      ItemTitle: caseTitle,
      Keyword: `${caseTitle},${caseKeyword}`,
      ItemDescription: caseDetailHtml,
    },
  };
}

function exactVerifierArguments() {
  const sourceJobId = "71000000-0000-4000-8000-000000000001";
  const sourceArguments = {
    ...argumentsValue(),
    [qoo10RollbackUpdateRecoveryArgument]: {
      status: "allowed",
      contract: qoo10RollbackUpdateRecoveryContract,
      listingId: marker.listingId,
      remoteId,
      providerStatus: "S1",
      sourceJobId: marker.sourceJobId,
      expectedState: {
        categoryCode,
        retailPriceJpy: 1871,
        sellPriceJpy: 1871,
        quantity: 1,
        shippingNo: "806971",
        biContentsNo: 8461402963,
      },
    },
  };
  delete sourceArguments[qoo10S1ActivationArgument];
  return {
    sellerpilotReadOnly: true,
    sellerpilotQoo10ExactS1Recovery: "qoo10_exact_s1_verifier_v1",
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ja-JP",
    publicationExpectedFingerprint: "a".repeat(64),
    publicationExpectedImageCount: 8,
    publicationReviewSourceJobId: sourceJobId,
    remoteId,
    market: "JP",
    targetId: "qoo10-japan",
    sellerpilotPublicationSource: {
      contract: "listing_publication_verification_source_v1",
      verificationJobId: "72000000-0000-4000-8000-000000000001",
      sourceJobId,
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
          data: { ResultCode: 0, ResultObject: readback("S1") },
        }],
      },
      sourceFingerprint: "a".repeat(64),
      expectedRemoteId: remoteId,
      expectedLocale: "ja-JP",
      expectedImageCount: 8,
      market: "JP",
      targetId: "qoo10-japan",
    },
  };
}

test("dedicated Qoo10 activation performs exactly one S2 write followed by one exact readback", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; body: Record<string, string> }> = [];
  globalThis.fetch = async (input, init) => {
    const method = qooMethod(input);
    calls.push({ method, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, string> });
    if (method === "ItemsBasic.EditGoodsStatus") return Response.json({ ResultCode: "0", ResultMsg: "SUCCESS" });
    if (method === "ItemsLookup.GetItemDetailInfo") {
      return Response.json({ ResultCode: 0, ResultObject: readback("S2") });
    }
    throw new Error(`unexpected provider method ${method}`);
  };
  try {
    const result = await operation();
    assert.equal(result.ok, true);
    assert.equal(result.operation, "listing.activate");
    assert.equal(result.remoteId, remoteId);
    assert.equal(result.remoteState?.providerStatus, "S2");
    assert.equal(result.remoteState?.visibility, "live");
    assert.equal(result.remoteState?.evidence.sourceJobId, marker.sourceJobId);
    assert.equal(result.remoteState?.evidence.sourceOperation, "listing.update");
    assert.equal(result.remoteState?.evidence.sourceContentVerified, true);
    assert.equal(result.publicationFulfilled, true);
    assert.equal(
      gatewayJobCompletionStatus(result.operation, result.ok, result.steps),
      "succeeded",
    );
    assert.equal(gatewayWorkerCompletionSchema.safeParse({
      jobId: "51000000-0000-4000-8000-000000000001",
      claimToken: "52000000-0000-4000-8000-000000000001",
      status: "succeeded",
      result,
    }).success, true);
    assert.deepEqual(result.steps.map((item) => item.name), [
      "qoo10-s1-activation",
      "qoo10-s1-activation-post-readback",
    ]);
    assert.deepEqual(calls.map((item) => item.method), [
      "ItemsBasic.EditGoodsStatus",
      "ItemsLookup.GetItemDetailInfo",
    ]);
    assert.equal(calls[0]?.body.ItemCode, remoteId);
    assert.equal(calls[0]?.body.Status, "2");
    assert.deepEqual(Object.keys(calls[0]?.body ?? {}).sort(), ["ItemCode", "Status", "returnType"].sort());
    assert.equal(calls[1]?.body.ItemCode, remoteId);
    assert.equal(calls[1]?.body.SellerCode, sellerCode);
    for (const forbidden of ["UpdateGoods", "EditGoodsContents", "SetNewGoods"]) {
      assert.equal(calls.some((item) => item.method.includes(forbidden)), false);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const [name, override] of [
  ["ItemPrice mismatch", { ItemPrice: "999" }],
  ["contradictory SellPrice alias", { SellPrice: "999" }],
  ["ItemQty mismatch", { ItemQty: "2" }],
  ["contradictory Qty alias", { Qty: "2" }],
  ["BIContentsNo mismatch", { BIContentsNo: "8461402964" }],
  ["representative image content mismatch", { StandardImage: qoo10Image(8461402964) }],
  ["contradictory representative image alias", { ImageUrl: qoo10Image(8461402964) }],
  ["promotion name mismatch", { PromotionName: "別のプロモーション" }],
  ["contradictory promotion alias", { PromotionNm: "別のプロモーション" }],
  ["industrial code mismatch", { IndustrialCode: "4901234567890" }],
  ["contradictory industrial code alias", { barcode: "4901234567890" }],
] as const) {
  test(`activation source binding rejects ${name} before any provider call`, async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    const args = argumentsValue();
    args.params = { ...args.params, ...override };
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error("provider call forbidden");
    };
    try {
      const result = await operation("listing.activate", args);
      assert.equal(result.ok, false);
      assert.equal(result.steps[0]?.name, "qoo10-s1-activation-prewrite-fence");
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test("exact S1 recovery verifier hydrates the activation expectation from one fresh GET without asset-binding fallback", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  const sourceJobId = "61000000-0000-4000-8000-000000000001";
  const verifierJobId = "62000000-0000-4000-8000-000000000001";
  const sourceArguments = {
    ...argumentsValue(),
    [qoo10S1ActivationArgument]: undefined,
    [qoo10RollbackUpdateRecoveryArgument]: {
      status: "allowed",
      contract: qoo10RollbackUpdateRecoveryContract,
      listingId: marker.listingId,
      remoteId,
      providerStatus: "S1",
      sourceJobId: marker.sourceJobId,
      expectedState: {
        categoryCode,
        retailPriceJpy: 1871,
        sellPriceJpy: 1871,
        quantity: 1,
        shippingNo: "806971",
        biContentsNo: 8461402963,
      },
    },
  };
  delete sourceArguments[qoo10S1ActivationArgument];
  const verificationArguments = {
    sellerpilotReadOnly: true,
    sellerpilotQoo10ExactS1Recovery: "qoo10_exact_s1_verifier_v1",
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ja-JP",
    publicationExpectedFingerprint: "a".repeat(64),
    publicationExpectedImageCount: 8,
    publicationReviewSourceJobId: sourceJobId,
    remoteId,
    market: "JP",
    targetId: "qoo10-japan",
    sellerpilotPublicationSource: {
      contract: "listing_publication_verification_source_v1",
      verificationJobId: verifierJobId,
      sourceJobId,
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
          data: { ResultCode: 0, ResultObject: readback("S1") },
        }],
      },
      sourceFingerprint: "a".repeat(64),
      expectedRemoteId: remoteId,
      expectedLocale: "ja-JP",
      expectedImageCount: 8,
      market: "JP",
      targetId: "qoo10-japan",
    },
  };
  globalThis.fetch = async (input) => {
    const method = qooMethod(input);
    methods.push(method);
    return Response.json({ ResultCode: 0, ResultObject: readback("S1") });
  };
  try {
    const result = await operation("listing.publication.verify", verificationArguments);
    assert.equal(result.ok, true);
    assert.equal(result.remoteState?.visibility, "non_public");
    assert.equal(result.remoteState?.providerStatus, "S1");
    assert.equal(result.publicationFulfilled, false);
    assert.deepEqual(methods, ["ItemsLookup.GetItemDetailInfo"]);
    assert.deepEqual(result.steps.map((item) => item.name), [
      "GetItemDetailInfo-publication-reverification",
      "qoo10-exact-s1-recovery-verification",
    ]);
    const exact = result.steps[1]?.data;
    assert.equal(exact?.ResultCode, 0);
    assert.deepEqual(exact?.ResultObject, readback("S1"));
    const expected = exact?.sellerpilotQoo10ActivationExpectation as Record<string, unknown>;
    assert.equal(expected.expectedTitle, title);
    assert.equal(expected.expectedKeyword, keyword);
    assert.equal(expected.expectedPromotionName, promotionName);
    assert.equal(expected.expectedIndustrialCode, industrialCode);
    assert.equal(expected.expectedDetailHtmlSha256, digest(detailHtml));
    assert.deepEqual(expected.expectedDetailImageUrls, detailImageUrls);
    const state = exact.remoteState as { evidence?: Record<string, unknown> };
    for (const key of [
      "identityVerified", "statusVerified", "localeVerified", "fingerprintVerified",
      "imageCountVerified", "titleVerified", "descriptionVerified", "languageContentVerified",
      "detailImageCountVerified", "contentDigestVerified", "representativeImageVerified",
      "providerBodyDetailImagesVerified", "sourceFingerprintVerified",
      "sourceContentVerified", "contentVerified",
    ]) assert.equal(state.evidence?.[key], true, key);
    assert.equal(state.evidence?.sourceJobId, sourceJobId);
    assert.equal(state.evidence?.sourceOperation, "listing.update");
    assert.equal(state.evidence?.fingerprintBinding, "source_request_fingerprint_v1");
    assert.equal(state.evidence?.sourceImageDigest, state.evidence?.remoteImageDigest);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const [name, invalidVerifierReadback] of [
  ["missing ResultCode", { ResultObject: readback("S1") }],
  ["null ResultCode", { ResultCode: null, ResultObject: readback("S1") }],
  ["non-exact ResultCode", { ResultCode: "00", ResultObject: readback("S1") }],
  ["whitespace ResultCode", { ResultCode: " 0 ", ResultObject: readback("S1") }],
  ["rejected ResultCode", { ResultCode: "-1", ResultObject: readback("S1") }],
] as const) {
  test(`fresh S1 verifier fails closed with ${name}`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json(invalidVerifierReadback);
    try {
      const result = await operation("listing.publication.verify", exactVerifierArguments());
      assert.equal(result.ok, false);
      assert.equal(result.remoteState, undefined);
      assert.equal(result.steps[0]?.data.sellerpilotExactResultCodeVerified, false);
      assert.equal(result.steps[1]?.data.sellerpilotReconciliationRequired, true);
      assert.equal(result.steps[1]?.data.sellerpilotQoo10ActivationExpectation, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test("activation marker cannot fall through to listing.update and activation cannot run without it", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("provider call forbidden");
  };
  try {
    const update = await operation("listing.update", argumentsValue());
    assert.equal(update.ok, false);
    assert.equal(update.steps[0]?.name, "qoo10-s1-activation-prewrite-fence");
    const missing = await operation("listing.activate", {
      ...argumentsValue(),
      [qoo10S1ActivationArgument]: undefined,
    });
    assert.equal(missing.ok, false);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const [name, activationResponse] of [
  ["missing own ResultCode", { code: 0, ResultMsg: "SUCCESS" }],
  ["non-exact ResultCode", { ResultCode: "00", ResultMsg: "SUCCESS" }],
  ["whitespace ResultCode", { ResultCode: " 0 ", ResultMsg: "SUCCESS" }],
] as const) {
  test(`malformed HTTP 200 activation is ambiguous: ${name}`, async () => {
    const originalFetch = globalThis.fetch;
    const methods: string[] = [];
    globalThis.fetch = async (input) => {
      const method = qooMethod(input);
      methods.push(method);
      if (method === "ItemsBasic.EditGoodsStatus") return Response.json(activationResponse);
      return Response.json({ ResultCode: 0, ResultObject: readback("S1") });
    };
    try {
      const result = await operation();
      assert.equal(result.ok, false);
      assert.deepEqual(methods, ["ItemsBasic.EditGoodsStatus", "ItemsLookup.GetItemDetailInfo"]);
      assert.equal(result.steps[0]?.data.sellerpilotReconciliationRequired, true);
      assert.equal(result.steps[1]?.data.sellerpilotReconciliationRequired, true);
      assert.equal(result.remoteState, undefined);
      assert.equal(gatewayJobCompletionStatus(result.operation, result.ok, result.steps), "reconciliation_required");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test("explicit provider rejection is non-reconciling only after exact S1 content readback", async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = async (input) => {
    const method = qooMethod(input);
    methods.push(method);
    if (method === "ItemsBasic.EditGoodsStatus") {
      return Response.json({ ResultCode: "-101", ResultMsg: "REJECTED" });
    }
    return Response.json({ ResultCode: 0, ResultObject: readback("S1") });
  };
  try {
    const result = await operation();
    assert.equal(result.ok, false);
    assert.deepEqual(methods, ["ItemsBasic.EditGoodsStatus", "ItemsLookup.GetItemDetailInfo"]);
    assert.equal(result.steps[0]?.data.sellerpilotNoWriteConfirmed, true);
    assert.equal(result.steps[0]?.data.sellerpilotReconciliationRequired, undefined);
    assert.equal(result.steps[1]?.ok, true);
    assert.equal(result.steps[1]?.data.sellerpilotReconciliationRequired, undefined);
    assert.equal(result.remoteState?.verified, true);
    assert.equal(result.remoteState?.providerStatus, "S1");
    assert.equal(result.remoteState?.visibility, "non_public");
    assert.equal(result.publicationFulfilled, false);
    assert.equal(
      gatewayJobCompletionStatus(result.operation, result.ok, result.steps),
      "succeeded",
    );
    assert.equal(gatewayWorkerCompletionSchema.safeParse({
      jobId: "51000000-0000-4000-8000-000000000001",
      claimToken: "52000000-0000-4000-8000-000000000001",
      status: "succeeded",
      result,
    }).success, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const [name, getResult] of [
  ["content mismatch", () => Response.json({ ResultCode: 0, ResultObject: readback("S2", { Keyword: "drift" }) })],
  ["title trailing whitespace drift", () => Response.json({ ResultCode: 0, ResultObject: readback("S2", { ItemTitle: `${title} ` }) })],
  ["keyword leading whitespace drift", () => Response.json({ ResultCode: 0, ResultObject: readback("S2", { Keyword: ` ${keyword}` }) })],
  ["promotion drift", () => Response.json({ ResultCode: 0, ResultObject: readback("S2", { PromotionName: "別のプロモーション" }) })],
  ["industrial code drift", () => Response.json({ ResultCode: 0, ResultObject: readback("S2", { IndustrialCode: "4901234567890" }) })],
  ["non-zero retail JPY fraction", () => Response.json({ ResultCode: 0, ResultObject: readback("S2", { RetailPrice: "1871.10" }) })],
  ["non-zero sell JPY fraction", () => Response.json({ ResultCode: 0, ResultObject: readback("S2", { SellPrice: "1871.10" }) })],
  ["fixed-point quantity", () => Response.json({ ResultCode: 0, ResultObject: readback("S2", { ItemQty: "1.0000" }) })],
  ["wrong present BI content id", () => Response.json({ ResultCode: 0, ResultObject: readback("S2", { BIContentsNo: "8461402964" }) })],
  ["readback unavailable", () => Promise.reject(new Error("network unavailable"))],
] as const) {
  test(`accepted activation is reconciled after ${name}`, async () => {
    const originalFetch = globalThis.fetch;
    const methods: string[] = [];
    globalThis.fetch = async (input) => {
      const method = qooMethod(input);
      methods.push(method);
      if (method === "ItemsBasic.EditGoodsStatus") return Response.json({ ResultCode: 0 });
      return getResult();
    };
    try {
      const result = await operation();
      assert.equal(result.ok, false);
      assert.deepEqual(methods, ["ItemsBasic.EditGoodsStatus", "ItemsLookup.GetItemDetailInfo"]);
      assert.equal(methods.filter((method) => method === "ItemsBasic.EditGoodsStatus").length, 1);
      assert.equal(result.steps[1]?.data.sellerpilotReconciliationRequired, true);
      assert.equal(gatewayJobCompletionStatus(result.operation, result.ok, result.steps), "reconciliation_required");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

for (const [name, invalidReadback] of [
  ["missing ResultCode", { ResultObject: readback("S2") }],
  ["null ResultCode", { ResultCode: null, ResultObject: readback("S2") }],
  ["non-exact ResultCode", { ResultCode: "00", ResultObject: readback("S2") }],
  ["whitespace ResultCode", { ResultCode: " 0 ", ResultObject: readback("S2") }],
  ["rejected ResultCode", { ResultCode: "-1", ResultObject: readback("S2") }],
] as const) {
  test(`post-activation GET fails closed with ${name}`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => qooMethod(input) === "ItemsBasic.EditGoodsStatus"
      ? Response.json({ ResultCode: 0 })
      : Response.json(invalidReadback);
    try {
      const result = await operation();
      assert.equal(result.ok, false);
      assert.equal(result.steps[1]?.data.sellerpilotExactResultCodeVerified, false);
      assert.equal(result.steps[1]?.data.sellerpilotReconciliationRequired, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test("post-activation readback rejects contradictory identity aliases", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => qooMethod(input) === "ItemsBasic.EditGoodsStatus"
    ? Response.json({ ResultCode: 0 })
    : Response.json({
        ResultCode: 0,
        ResultObject: readback("S2", { ItemCode: "9999999999" }),
      });
  try {
    const result = await operation();
    assert.equal(result.ok, false);
    assert.equal(result.steps[1]?.data.sellerpilotReconciliationRequired, true);
    const checks = result.steps[1]?.data.sellerpilotActivationContentChecks as Record<string, boolean>;
    assert.equal(checks.uniqueExactItemVerified, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const [name, override] of [
  ["status", { Status: "S1" }],
  ["keyword", { Keywords: "contradictory" }],
  ["promotion", { PromotionNm: "contradictory" }],
  ["industrial code", { barcode: "4901234567890" }],
  ["origin", { OriginCode: "KR" }],
] as const) {
  test(`post-activation readback rejects contradictory ${name} aliases`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => qooMethod(input) === "ItemsBasic.EditGoodsStatus"
      ? Response.json({ ResultCode: 0 })
      : Response.json({ ResultCode: 0, ResultObject: readback("S2", override) });
    try {
      const result = await operation();
      assert.equal(result.ok, false);
      const checks = result.steps[1]?.data.sellerpilotActivationContentChecks as Record<string, boolean>;
      assert.equal(checks.criticalAliasesConsistent, false);
      assert.equal(result.steps[1]?.data.sellerpilotReconciliationRequired, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

for (const [name, sourceKeyword, providerKeyword] of [
  ["middle title removal", `No Brand,${title},購入前確認`, "No Brand,購入前確認"],
  ["whitespace rewrite", `${title}, No Brand,購入前確認`, "No Brand,購入前確認"],
  ["leading whitespace rewrite", ` ${keyword}`, keyword],
  ["trailing whitespace rewrite", `${title},${keyword} `, keyword],
  ["duplicate title removal", `${title},${title},No Brand`, "No Brand"],
  ["empty keyword term preservation", `${title},No Brand,,購入前確認`, "No Brand,,購入前確認"],
  ["keyword whitespace preservation", `${title},No Brand, 購入前確認`, "No Brand, 購入前確認"],
  ["title-only to blank", title, ""],
  ["empty leading-title remainder to blank", `${title},`, ""],
] as const) {
  test(`activation marker rejects ${name}`, async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    const args = argumentsValue({
      ...marker,
      expectedKeyword: providerKeyword,
    });
    args.params.Keyword = sourceKeyword;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error("provider call forbidden");
    };
    try {
      const result = await operation("listing.activate", args);
      assert.equal(result.ok, false);
      assert.equal(result.steps[0]?.name, "qoo10-s1-activation-prewrite-fence");
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test(`fresh verifier rejects ${name}`, async () => {
    const originalFetch = globalThis.fetch;
    const args = exactVerifierArguments();
    const source = args.sellerpilotPublicationSource as {
      sourceArguments: { params: Record<string, unknown> };
    };
    source.sourceArguments.params.Keyword = sourceKeyword;
    globalThis.fetch = async () => Response.json({
      ResultCode: 0,
      ResultObject: readback("S1", { Keyword: providerKeyword }),
    });
    try {
      const result = await operation("listing.publication.verify", args);
      assert.equal(result.ok, false);
      assert.equal(result.steps[1]?.data.sellerpilotQoo10ActivationExpectation, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

for (const [name, override] of [
  ["title trailing whitespace", { ItemTitle: `${title} ` }],
  ["keyword leading whitespace", { Keyword: ` ${keyword}` }],
] as const) {
  test(`fresh verifier rejects ${name}`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({
      ResultCode: 0,
      ResultObject: readback("S1", override),
    });
    try {
      const result = await operation("listing.publication.verify", exactVerifierArguments());
      assert.equal(result.ok, false);
      assert.equal(result.steps[1]?.data.sellerpilotQoo10ActivationExpectation, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

for (const [name, caseTitle, caseDetailHtml] of [
  [
    "English title",
    "Adhesive cable organizer six piece set",
    `<section lang="ja-JP"><p>日本語の商品詳細と使い方を購入前に確認してください。</p>${detailImageUrls.map((url) => `<img src="${url}">`).join("")}</section>`,
  ],
  [
    "English description",
    title,
    `<section lang="ja-JP"><p>This product description contains only English commerce copy and usage details.</p>${detailImageUrls.map((url) => `<img src="${url}">`).join("")}</section>`,
  ],
] as const) {
  test(`activation never invents Japanese language evidence for ${name}`, async () => {
    const originalFetch = globalThis.fetch;
    const caseKeyword = "No Brand,購入前確認";
    const args = languageCaseArguments(caseTitle, caseDetailHtml, caseKeyword);
    globalThis.fetch = async (input) => qooMethod(input) === "ItemsBasic.EditGoodsStatus"
      ? Response.json({ ResultCode: 0 })
      : Response.json({
          ResultCode: 0,
          ResultObject: readback("S2", {
            ItemTitle: caseTitle,
            Keyword: caseKeyword,
            ItemDetail: caseDetailHtml,
          }),
        });
    try {
      const result = await operation("listing.activate", args);
      assert.equal(result.ok, false);
      assert.equal(result.steps[1]?.data.sellerpilotReconciliationRequired, true);
      assert.equal(result.remoteState, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test("serverless matrix exposes activation only for Qoo10 and rejects invalid context before the mutation fence", async () => {
  const channels: GatewayClaim["channel"][] = [
    "qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay", "temu",
  ];
  for (const channel of channels) {
    assert.equal(serverlessGatewayOperationAllowed(channel, "listing.activate"), channel === "qoo10");
  }
  const events: string[] = [];
  const job: GatewayClaim = {
    id: "51000000-0000-4000-8000-000000000001",
    claim_token: "52000000-0000-4000-8000-000000000001",
    credential_id: "53000000-0000-4000-8000-000000000001",
    channel: "qoo10",
    operation: "listing.activate",
    environment: "production",
    request: { arguments: { ...argumentsValue(), params: { ItemCode: remoteId } } },
    credential: { api_key: "private-test-key" },
    attempt_count: 1,
  };
  await assert.rejects(() => executeServerlessGatewayProviderJob({
    job,
    signal: new AbortController().signal,
    hooks: {
      assertLeaseHealthy: async () => { events.push("lease"); },
      beginProviderMutation: async () => { events.push("mutation"); },
      beginCredentialMutation: async () => { events.push("credential"); },
      stageCredentialRefresh: async () => { events.push("refresh"); },
    },
  }), /QOO10_S1_ACTIVATION_SERVER_CONTEXT_REQUIRED/);
  assert.deepEqual(events, []);
});

test("valid serverless activation crosses one mutation fence before its sole write and post-readback", async () => {
  const originalFetch = globalThis.fetch;
  const events: string[] = [];
  const job: GatewayClaim = {
    id: "51000000-0000-4000-8000-000000000001",
    claim_token: "52000000-0000-4000-8000-000000000001",
    credential_id: "53000000-0000-4000-8000-000000000001",
    channel: "qoo10",
    operation: "listing.activate",
    environment: "production",
    request: { arguments: argumentsValue() },
    credential: { api_key: "private-test-key" },
    attempt_count: 1,
  };
  globalThis.fetch = async (input) => {
    const method = qooMethod(input);
    events.push(`provider:${method}`);
    return method === "ItemsBasic.EditGoodsStatus"
      ? Response.json({ ResultCode: 0 })
      : Response.json({ ResultCode: 0, ResultObject: readback("S2") });
  };
  try {
    const result = await executeServerlessGatewayProviderJob({
      job,
      signal: new AbortController().signal,
      hooks: {
        assertLeaseHealthy: async () => { events.push("lease"); },
        beginProviderMutation: async () => { events.push("mutation"); },
        beginCredentialMutation: async () => { throw new Error("unexpected credential mutation"); },
        stageCredentialRefresh: async () => { throw new Error("unexpected credential stage"); },
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(events, [
      "lease",
      "mutation",
      "lease",
      "provider:ItemsBasic.EditGoodsStatus",
      "provider:ItemsLookup.GetItemDetailInfo",
    ]);
    assert.equal(events.filter((event) => event === "mutation").length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
