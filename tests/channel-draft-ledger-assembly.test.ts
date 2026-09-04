import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChannelArguments,
  buildDraftMap,
  missingNativeValues,
} from "../app/product-publish-workbench";
import {
  qoo10JapaneseListingCopyFromCategory,
} from "../lib/channels/qoo10-japanese-title";
import { listingPublicationLanguageVerified } from "../lib/channels/listing-publication-content";
import { blockingListingRequirements } from "../lib/channels/listing-preflight";

type PublishContext = Parameters<typeof buildChannelArguments>[1];

function cookieContext(): PublishContext {
  return {
    contentMode: "ai_generated",
    product: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      externalCode: "AUTO-COOKIE",
      sku: "AUTO-780720401E2D4E4EA45F",
      name: "롯데 롯샌 파스퇴르 순우유맛 315g (6봉입)",
      description: "판매자가 검수한 과자 상품입니다.",
      sourceUrl: null,
      status: "ready",
    },
    manualFields: {
      productName: "롯데 롯샌 파스퇴르 순우유맛 315g (6봉입)",
      description: "판매자가 검수한 과자 상품입니다.",
      sellerSku: "AUTO-780720401E2D4E4EA45F",
      categoryHint: "과자",
      brandName: "롯데",
      manufacturer: "롯데웰푸드주식회사",
      countryOfOrigin: "대한민국",
      material: "파스퇴르 우유 0.1%, 탈지분유 0.05%, 밀, 대두, 우유, 달걀 함유",
      packageContents: "6봉입",
      condition: "NEW",
      gtinStatus: "NO_GTIN",
      gtin: "",
      sellingPrice: 3190,
      currency: "KRW",
      stock: 1,
      weightKg: 0.4,
      packageLengthCm: 28,
      packageWidthCm: 20,
      packageHeightCm: 7,
    },
    imageSpecs: [],
    assignments: [{
      channel: "qoo10",
      market: "JP",
      categoryId: "300000536",
      categoryPath: ["食品", "スイーツ・お菓子", "洋菓子"],
      providedAttributes: {},
      status: "confirmed",
      confirmedAt: "2026-09-04T00:00:00.000Z",
    }],
    listings: [{
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      channel: "qoo10",
      market: "JP",
      targetId: "",
      remoteId: "1217536689",
      status: "paused",
      lastError: "listing.update 재시도 필요",
      failureClass: "retryable",
      requestedPublicationIntent: "live",
      remoteVisibility: "non_public",
      providerStatus: "S1",
    }],
    sourceImages: [
      { path: "owner/job/input/normalized/0.jpg", url: "https://cdn.example.com/cookie-front.jpg" },
    ],
    generatedImages: [
      { id: "hero", path: "owner/job/output/hero.jpg", url: "https://cdn.example.com/hero.jpg" },
      { id: "square", path: "owner/job/output/square.jpg", url: "https://cdn.example.com/square.jpg" },
    ],
    localizedListings: [],
  };
}

test("Qoo10 category copy is Japanese-only and uses the confirmed leaf", () => {
  const copy = qoo10JapaneseListingCopyFromCategory(
    ["食品", "スイーツ・お菓子", "洋菓子"],
    "롯데 롯샌 파스퇴르 순우유맛 315g (6봉입)",
  );
  assert.ok(copy);
  assert.equal(copy.title, "洋菓子の販売者確認済み商品");
  assert.equal(listingPublicationLanguageVerified("ja-JP", copy.title, "title"), true);
  assert.equal(listingPublicationLanguageVerified("ja-JP", copy.description, "description"), true);
  assert.equal(/\p{Script=Hangul}/u.test(`${copy.title}${copy.description}`), false);
});

test("Qoo10 listing.update still assembles a ledger payload when localization is missing", () => {
  const context = cookieContext();
  const draft = buildChannelArguments(
    "qoo10",
    context,
    3190,
    1,
    undefined,
    { weight: 0.4, length: 28, width: 20, height: 7 },
    12.9,
  ) as {
    params: Record<string, string>;
    sellerpilotAssets: { draftLocalization?: string; galleryImageUrls: string[] };
  };

  assert.equal(draft.sellerpilotAssets.draftLocalization, "missing");
  assert.equal(draft.params.SecondSubCat, "300000536");
  assert.equal(draft.params.ItemTitle, "洋菓子の販売者確認済み商品");
  assert.equal(draft.params.ShippingNo, "0");
  assert.equal(draft.params.AvailableDateType, "0");
  assert.equal(draft.params.AvailableDateValue, "3");
  assert.equal(draft.params.ProductionPlaceType, "2");
  assert.equal(draft.params.ProductionPlace, "KR");
  assert.equal(draft.params.StandardImage.startsWith("https://"), true);
  assert.match(draft.params.ItemDescription, /lang="ja-JP"/);
  assert.equal(/\p{Script=Hangul}/u.test(draft.params.ItemTitle), false);
  assert.deepEqual(
    blockingListingRequirements("qoo10", draft, "listing.update").map((item) => item.key),
    [],
  );
  assert.equal(
    missingNativeValues("qoo10", draft, "listing.update").some((item) => item.includes("dedicated marketplace")),
    false,
  );
});

test("buildDraftMap no longer swallows a Qoo10 update into an empty object", () => {
  const drafts = buildDraftMap(
    cookieContext(),
    3190,
    1,
    {},
    { weight: 0.4, length: 28, width: 20, height: 7 },
    12.9,
  );
  assert.notEqual(drafts.qoo10, "{}");
  const parsed = JSON.parse(drafts.qoo10 ?? "{}") as { params?: { ItemTitle?: string }; sellerpilotDraftError?: string };
  assert.equal(parsed.sellerpilotDraftError, undefined);
  assert.equal(parsed.params?.ItemTitle, "洋菓子の販売者確認済み商品");
});
