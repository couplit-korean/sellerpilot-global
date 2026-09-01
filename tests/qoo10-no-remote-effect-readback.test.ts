import assert from "node:assert/strict";
import test from "node:test";
import { executeListingPublicationVerification } from "../lib/channels/listing-publication-verification";

const SOURCE_JOB_ID = "71000000-0000-4000-8000-000000000001";
const LEGACY_SOURCE_JOB_ID = "fac9c5c4-940d-4600-88f3-8f97a069dfbf";
const VERIFIER_JOB_ID = "72000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const LISTING_ID = "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc";
const CREDENTIAL_ID = "2b49d081-5188-4a75-9555-e0a6438e8a2b";
const REMOTE_ID = "1217336970";
const SELLER_SKU = "QA-20260823-CC-001";
const FINGERPRINT = "a".repeat(64);
const RELEASE_SHA = "b".repeat(40);
const detailImages = Array.from(
  { length: 8 },
  (_, index) => `https://cdn.example.test/qoo10-no-effect-${index + 1}.jpg`,
);
const detailHtml = `<section lang="ja-JP"><p>${"商品説明".repeat(30)}</p>${detailImages
  .map((url) => `<img src="${url}">`)
  .join("")}</section>`;

function readback() {
  return {
    ItemNo: REMOTE_ID,
    ItemStatus: "S1",
    SellerCode: SELLER_SKU,
    RetailPrice: "1871.0000",
    SellPrice: "1871.0000",
    ItemQty: "1",
    ItemTitle: "貼り付け式ケーブル整理クリップ6個セット",
    ItemDetail: detailHtml,
    ImageUrl: "https://gd.image-qoo10.jp/li/963/402/8461402963.g.jpg",
  };
}

function argumentsValue() {
  const sourceArguments = {
    sellerpilotQoo10ExactLocalization: {
      status: "allowed",
      contract: "qoo10_exact_localization_update_v2",
      productId: PRODUCT_ID,
      listingId: LISTING_ID,
      credentialId: CREDENTIAL_ID,
      remoteId: REMOTE_ID,
      sellerSku: SELLER_SKU,
      releaseSha: RELEASE_SHA,
    },
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ja-JP",
    publicationExpectedFingerprint: FINGERPRINT,
    publicationExpectedImageCount: 8,
    params: {
      ItemCode: REMOTE_ID,
      SellerCode: SELLER_SKU,
      RetailPrice: "1871",
      ItemPrice: "1871",
      ItemQty: "1",
    },
  };
  return {
    sellerpilotReadOnly: true,
    sellerpilotQoo10NoEffectReconciliation:
      "qoo10_exact_no_remote_effect_verifier_v1",
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ja-JP",
    publicationExpectedFingerprint: FINGERPRINT,
    publicationExpectedImageCount: 8,
    publicationReviewSourceJobId: SOURCE_JOB_ID,
    remoteId: REMOTE_ID,
    market: "JP",
    targetId: "",
    sellerpilotPublicationSource: {
      contract: "listing_publication_verification_source_v1",
      verificationJobId: VERIFIER_JOB_ID,
      sourceJobId: SOURCE_JOB_ID,
      sourceOperation: "listing.update",
      sourceArguments,
      sourceResponsePayload: {
        ok: false,
        channel: "qoo10",
        operation: "listing.update",
        remoteId: REMOTE_ID,
        steps: [{
          name: "qoo10-exact-current-s1-prewrite-readback",
          ok: true,
          status: 200,
          data: { ResultCode: 0, ResultObject: readback() },
        }],
      },
      sourceFingerprint: FINGERPRINT,
      expectedRemoteId: REMOTE_ID,
      expectedLocale: "ja-JP",
      expectedImageCount: 8,
      market: "JP",
      targetId: "",
    },
  };
}

function legacyArgumentsValue() {
  const value = argumentsValue();
  const source = value.sellerpilotPublicationSource;
  source.sourceJobId = LEGACY_SOURCE_JOB_ID;
  value.publicationReviewSourceJobId = LEGACY_SOURCE_JOB_ID;
  delete source.sourceArguments.sellerpilotQoo10ExactLocalization;
  delete source.sourceArguments.params.SellerCode;
  delete source.sourceArguments.params.ItemPrice;
  delete source.sourceArguments.params.ItemQty;
  Object.assign(source.sourceArguments.params, {
    SecondSubCat: "320000542",
    ProductionPlaceType: "2",
    ProductionPlace: "CN",
    ShippingNo: "806971",
    AdultYN: "N",
  });
  source.sourceArguments.sellerpilotQoo10RollbackUpdateRecovery = {
    status: "allowed",
    contract: "qoo10_create_rollback_confirmation_v1",
    listingId: LISTING_ID,
    remoteId: REMOTE_ID,
    providerStatus: "S1",
    sourceJobId: "73000000-0000-4000-8000-000000000001",
    expectedState: {
      categoryCode: "320000542",
      retailPriceJpy: 1871,
      sellPriceJpy: 1871,
      quantity: 1,
      shippingNo: "806971",
      biContentsNo: 8461402963,
    },
  };
  return value;
}

function qooMethod(input: RequestInfo | URL) {
  return decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1) ?? "");
}

test("exact no-effect verifier performs one provider GET and captures raw current state without a write", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(qooMethod(input));
    return Response.json({ ResultCode: 0, ResultObject: readback() });
  };
  try {
    const result = await executeListingPublicationVerification({
      channel: "qoo10",
      operation: "listing.publication.verify",
      payload: { api_key: "test-only" },
      arguments: argumentsValue(),
      environment: "production",
    });
    assert.deepEqual(calls, ["ItemsLookup.GetItemDetailInfo"]);
    assert.equal(result.remoteId, REMOTE_ID);
    assert.equal(result.remoteState, undefined);
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0]?.ok, true);
    assert.equal(
      result.steps[0]?.data.sellerpilotVerification,
      "QOO10_EXACT_NO_EFFECT_CURRENT_READBACK_CAPTURED",
    );
    assert.equal(result.steps[0]?.data.sellerpilotNoWriteConfirmed, true);
    assert.deepEqual(result.steps[0]?.data.ResultObject, readback());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("invalid no-effect source binding fails before provider access", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("provider call forbidden");
  };
  try {
    const invalid = argumentsValue();
    const source = invalid.sellerpilotPublicationSource;
    source.sourceArguments.params.ItemQty = "2";
    await assert.rejects(
      executeListingPublicationVerification({
        channel: "qoo10",
        operation: "listing.publication.verify",
        payload: { api_key: "test-only" },
        arguments: invalid,
        environment: "production",
      }),
      /LISTING_PUBLICATION_VERIFY_SOURCE_BINDING_INVALID/,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("legacy fac9 no-effect verifier accepts only its pre-v2 omitted price and quantity shape", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(qooMethod(input));
    return Response.json({ ResultCode: 0, ResultObject: readback() });
  };
  try {
    const result = await executeListingPublicationVerification({
      channel: "qoo10",
      operation: "listing.publication.verify",
      payload: { api_key: "test-only" },
      arguments: legacyArgumentsValue(),
      environment: "production",
    });
    assert.deepEqual(calls, ["ItemsLookup.GetItemDetailInfo"]);
    assert.equal(result.steps[0]?.data.sellerpilotNoWriteConfirmed, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("legacy fac9 no-effect binding rejects v2-only fields or rollback expectation drift before provider access", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("provider call forbidden");
  };
  try {
    const invalidValues = [
      (() => {
        const value = legacyArgumentsValue();
        value.sellerpilotPublicationSource.sourceArguments.params.ItemQty = "1";
        return value;
      })(),
      (() => {
        const value = legacyArgumentsValue();
        const marker = value.sellerpilotPublicationSource.sourceArguments
          .sellerpilotQoo10RollbackUpdateRecovery;
        marker.expectedState.quantity = 2;
        return value;
      })(),
    ];
    for (const invalid of invalidValues) {
      await assert.rejects(
        executeListingPublicationVerification({
          channel: "qoo10",
          operation: "listing.publication.verify",
          payload: { api_key: "test-only" },
          arguments: invalid,
          environment: "production",
        }),
        /LISTING_PUBLICATION_VERIFY_SOURCE_BINDING_INVALID/,
      );
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
