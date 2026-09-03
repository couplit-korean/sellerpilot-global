import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { gatewayJobCompletionStatus } from "../lib/channels/gateway-contract";
import {
  bindQoo10ExactAdoptedCommerceArguments,
  qoo10ExactAdoptedJapaneseDetailBase,
  qoo10ExactAdoptedLocalizedDetailSections,
  qoo10ExactAdoptedLiveListingCandidate,
  qoo10ExactAdoptedLocalizationArgument,
  qoo10ExactAdoptedLocalizationContract,
  qoo10ExactLocalizedUpdate,
  qoo10ExactLocalizationRecoveryIdentity,
  qoo10ExactLocalizationUpdateArgument,
  qoo10ExactLocalizationUpdateContract,
  verifyQoo10ExactAdoptedLiveReadback,
} from "../lib/channels/qoo10-exact-localization-recovery";
import {
  applyPreparedQoo10Images,
  buildListingPublicationAssetBinding,
  qoo10RollbackRecoveryPreservesRepresentativeImage,
} from "../lib/channels/marketplace-images";
import { executeChannelOperation } from "../lib/channels/operations";
import { bindMarketplaceArgumentsToApprovedDetailManifest } from "../lib/server-product-detail-manifest";

const identity = qoo10ExactLocalizationRecoveryIdentity;
const detailImageUrls = [
  "002c35dfc480660d5eab429ef9491357b06f7e317539365fadffeb8a186cc3e0",
  "04f2523967867f7f0c218c635beb34571aec4f97b80cb24adae9d8e5edf994db",
  "3800dcf97c2814ebe961bd8bd30d53dda7ff0d6b1a9f73a7fed929dea1fe92ac",
  "641856cd5eff810194e0b5c14309e099c0c716f3643b8f68377bfe6baca521b8",
  "7fe0ed3832f3bff882b576c6709e7a201a8b2c18b4905dd8b5bbdc3ce5bbcf5e",
  "cc9af9f4c99383fd159395b5a13289b4b268f548d8f5ccb391c6672af2914410",
  "e6972e812b95d38ccb08026cc16573660d532012951c54bcbd9aa57807c907c3",
  "fae4e55b17604528d3f1b14a471b2a72c0856b1bb0e1dc7a324388a9066684a2",
].map((digest) => (
  `https://sqaoqucxakebqkiygdxb.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/${digest.slice(0, 2)}/${digest}.jpg`
));
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

function extractSqlFunction(source: string, signature: string) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const bodyStart = source.indexOf("as $$", start);
  assert.notEqual(bodyStart, -1);
  const end = source.indexOf("$$;", bodyStart + 5);
  assert.notEqual(end, -1);
  return source.slice(start, end + 3);
}

test("server-owned adopted content uses the approved eight-role Japanese contract", () => {
  const bound = bindQoo10ExactAdoptedCommerceArguments({
    untouched: "preserved",
    sellerpilotAssets: {
      detailImageRoles: ["detail-context"],
      localizedDetailSections: [{ type: "use", body: "short" }],
    },
    params: {
      ItemCode: "attacker-item",
      ItemPrice: "999999",
      ItemQty: "999",
      StandardImage: "https://attacker.example/replace.jpg",
      ItemDescription: cleanDetail,
    },
  });
  const params = bound.params as Record<string, unknown>;
  const assets = bound.sellerpilotAssets as Record<string, unknown>;
  const sections = assets.localizedDetailSections as Array<Record<string, unknown>>;

  assert.equal(bound.untouched, "preserved");
  assert.equal(params.ItemCode, identity.remoteId);
  assert.equal(params.SellerCode, identity.sellerSku);
  assert.equal(params.SecondSubCat, identity.categoryCode);
  assert.equal(params.ItemTitle, identity.title);
  assert.equal(params.RetailPrice, String(identity.priceJpy));
  assert.equal(params.ItemPrice, String(identity.priceJpy));
  assert.equal(params.ItemQty, String(identity.quantity));
  assert.equal(params.ShippingNo, identity.shippingNo);
  assert.equal(params.ItemDescription, qoo10ExactAdoptedJapaneseDetailBase());
  assert.doesNotMatch(String(params.ItemDescription), /<img\b/iu);
  assert.equal(Object.hasOwn(params, "StandardImage"), false);
  assert.deepEqual(sections, qoo10ExactAdoptedLocalizedDetailSections());
  assert.deepEqual(sections.map((section) => section.type), [
    "overview", "feature", "howto", "proof",
    "contents", "routine", "care", "spec",
  ]);
  assert.deepEqual(sections.map((section) => section.imageAsset), [
    "detail-overview", "detail-feature", "detail-use", "detail-package",
    "detail-contents", "detail-routine", "detail-care", "detail-dimensions",
  ]);
  assert.equal(new Set(sections.map((section) => section.type)).size, 8);
  assert.equal(new Set(sections.map((section) => section.imageAsset)).size, 8);
  for (const section of sections) {
    assert.ok(String(section.heading).length >= 4);
    assert.ok(String(section.body).length >= 60, String(section.imageAsset));
    assert.ok(String(section.body).length <= 700, String(section.imageAsset));
    assert.ok(String(section.buyerQuestion).length >= 8);
    assert.ok(String(section.evidence).length >= 10);
    assert.ok(String(section.imageAltText).length >= 1);
  }
});

test("the manifest-bound postimage preserves the representative and exact commerce tuple", () => {
  const serverOwned = bindQoo10ExactAdoptedCommerceArguments(argumentsValue());
  const roles = qoo10ExactAdoptedLocalizedDetailSections()
    .map((section) => section.imageAsset);
  const routeArguments = bindMarketplaceArgumentsToApprovedDetailManifest(
    serverOwned,
    {
      version: 1,
      manifest: {
        contract: "sellerpilot_detail_image_manifest_v2",
        algorithm: "sha256",
        digest: "a".repeat(64),
        images: roles.map((role, index) => ({
          role,
          path: `results/334631fe-0095-4ea8-a20a-16971f6ca71a/claims/eee7b548-62e7-4175-bd54-deb426da6c06/${role}.png`,
          sourceSha256: String(index + 1).repeat(64).slice(0, 64),
        })),
      },
    },
    detailImageUrls,
  );
  const prepared = applyPreparedQoo10Images(
    routeArguments,
    ["https://attacker.example/replace.jpg"],
    detailImageUrls,
  );
  const params = prepared.params as Record<string, unknown>;
  const localized = qoo10ExactLocalizedUpdate(prepared, identity.remoteId, true);

  assert.equal(qoo10RollbackRecoveryPreservesRepresentativeImage("qoo10", prepared), true);
  assert.equal(Object.hasOwn(params, "StandardImage"), false);
  assert.equal(params.ItemCode, identity.remoteId);
  assert.equal(params.SellerCode, identity.sellerSku);
  assert.equal(params.SecondSubCat, identity.categoryCode);
  assert.equal(params.ItemTitle, identity.title);
  assert.equal(params.ShippingNo, identity.shippingNo);
  assert.equal(params.ItemPrice, String(identity.priceJpy));
  assert.equal(params.ItemQty, String(identity.quantity));
  assert.equal(localized?.detailImageUrls.length, 8);
  assert.deepEqual(localized?.detailImageUrls, detailImageUrls);
});

test("the real manifest-bound prepared postimage passes both production SQL validators", async () => {
  const serverOwned = bindQoo10ExactAdoptedCommerceArguments(argumentsValue());
  const roles = qoo10ExactAdoptedLocalizedDetailSections()
    .map((section) => section.imageAsset);
  const routeArguments = bindMarketplaceArgumentsToApprovedDetailManifest(
    serverOwned,
    {
      version: 1,
      manifest: {
        contract: "sellerpilot_detail_image_manifest_v2",
        algorithm: "sha256",
        digest: "a".repeat(64),
        images: roles.map((role, index) => ({
          role,
          path: `results/334631fe-0095-4ea8-a20a-16971f6ca71a/claims/eee7b548-62e7-4175-bd54-deb426da6c06/${role}.png`,
          sourceSha256: String(index + 1).repeat(64).slice(0, 64),
        })),
      },
    },
    detailImageUrls,
  );
  const prepared = applyPreparedQoo10Images(
    routeArguments,
    [],
    detailImageUrls,
    qoo10ExactAdoptedLocalizedDetailSections().map((section) => section.imageAltText),
    roles,
  );
  prepared.sellerpilotPublicationAssetBinding = buildListingPublicationAssetBinding({
    approvedDetailPageVersion: 1,
    approvedManifestDigest: "a".repeat(64),
    approvedDetailRoles: roles,
    approvedDetailImagePaths: roles.map((role) => (
      `results/334631fe-0095-4ea8-a20a-16971f6ca71a/claims/eee7b548-62e7-4175-bd54-deb426da6c06/${role}.png`
    )),
    approvedDetailImageSha256s: roles.map((_, index) => (
      String(index + 1).repeat(64).slice(0, 64)
    )),
    approvedDetailImageUrls: detailImageUrls,
    providerImageSurface: "detail_content",
    providerTransportRoles: roles,
    providerTransportUrls: detailImageUrls,
  });
  assert.ok(prepared.sellerpilotPublicationAssetBinding);
  assert.ok(Buffer.byteLength(JSON.stringify({ arguments: prepared }), "utf8") < 128_000);
  const exactSource = await readFile(new URL(
    "../supabase/migrations/20260831144000_generalize_qoo10_exact_localization_s1_activation.sql",
    import.meta.url,
  ), "utf8");
  const adoptedSource = await readFile(new URL(
    "../supabase/migrations/20260901173500_fence_exact_qoo10_adopted_localization_update.sql",
    import.meta.url,
  ), "utf8");
  const parserSource = await readFile(new URL(
    "../supabase/migrations/20260831056700_recover_exact_qoo10_s1_activation.sql",
    import.meta.url,
  ), "utf8");
  const db = new PGlite();
  try {
    await db.exec("create schema sellerpilot_private");
    for (const signature of [
      "create function sellerpilot_private.qoo10_exact_hex_codepoint(",
      "create function sellerpilot_private.qoo10_exact_decode_html(",
      "create function sellerpilot_private.qoo10_exact_detail_image_urls(",
    ]) await db.exec(extractSqlFunction(parserSource, signature));
    await db.exec(extractSqlFunction(
      exactSource,
      "create function sellerpilot_private.qoo10_exact_localization_v2_arguments_valid(",
    ));
    await db.exec(extractSqlFunction(
      adoptedSource,
      "create function sellerpilot_private.qoo10_exact_adopted_localization_arguments_valid(",
    ));
    const result = await db.query<{ value: boolean }>(
      "select sellerpilot_private.qoo10_exact_adopted_localization_arguments_valid($1::jsonb,$2,$3,$4) value",
      [JSON.stringify(prepared), "a".repeat(40), "b".repeat(64), "c".repeat(64)],
    );
    assert.equal(result.rows[0]?.value, true);
  } finally {
    await db.close();
  }
});

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

test("postwrite readback accepts only the exact transmitted buyer-visible detail text", () => {
  const exact = verifyQoo10ExactAdoptedLiveReadback({
    resultObject: readback(cleanDetail),
    expectedDetailImageUrls: detailImageUrls,
    expectedDetailHtml: cleanDetail,
    phase: "postwrite",
  });
  assert.equal(exact.ok, true, JSON.stringify(exact));
  assert.equal(exact.checks.exactBuyerVisibleDetailPreserved, true);

  for (const [name, detail] of [
    ["different clean Japanese", cleanDetail.replace(
      "ケーブルをすっきり整理できます。販売価格は1,871円です。",
      "承認されていない別の日本語説明です。",
    )],
    ["truncated clean Japanese", cleanDetail.replace(
      "ケーブルをすっきり整理できます。販売価格は1,871円です。",
      "ケーブルを整理します。",
    )],
  ] as const) {
    const verification = verifyQoo10ExactAdoptedLiveReadback({
      resultObject: readback(detail),
      expectedDetailImageUrls: detailImageUrls,
      expectedDetailHtml: cleanDetail,
      phase: "postwrite",
    });
    assert.equal(
      verification.checks.approvedEightImagesPreserved,
      true,
      name,
    );
    assert.equal(verification.checks.exactBuyerVisibleDetailPreserved, false, name);
    assert.equal(verification.ok, false, name);
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

test("a clean but different Japanese readback is quarantined for reconciliation", async () => {
  const originalFetch = globalThis.fetch;
  const differentDetail = cleanDetail.replace(
    "ケーブルをすっきり整理できます。販売価格は1,871円です。",
    "承認されていない別の日本語説明です。",
  );
  let readbacks = 0;
  globalThis.fetch = async (input) => {
    const method = decodeURIComponent(new URL(String(input)).pathname.split("/").at(-1) ?? "");
    if (method === "ItemsLookup.GetItemDetailInfo") {
      readbacks += 1;
      return Response.json({
        ResultCode: 0,
        ResultObject: readback(readbacks === 1 ? dirtyDetail : differentDetail),
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
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(
      gatewayJobCompletionStatus(result.operation, result.ok, result.steps),
      "reconciliation_required",
    );
    const postwrite = result.steps.find(
      (candidate) => candidate.name === "qoo10-exact-adopted-localization-postwrite-readback",
    );
    const checks = postwrite?.data.sellerpilotExactAdoptedChecks as
      | Record<string, unknown>
      | undefined;
    assert.equal(checks?.approvedEightImagesPreserved, true);
    assert.equal(checks?.exactBuyerVisibleDetailPreserved, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
