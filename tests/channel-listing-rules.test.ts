import assert from "node:assert/strict";
import test from "node:test";
import { buildChannelArguments, missingNativeValues } from "../app/product-publish-workbench";
import { activeChannelKeys, type ActiveChannelKey } from "../lib/channels/catalog";
import {
  detailAssetOrderForChannel,
  galleryAssetOrderForChannel,
  localizedDetailImageRoles,
} from "../lib/marketplace-localized-content";

type PublishContext = Parameters<typeof buildChannelArguments>[1];
type ChannelTarget = Parameters<typeof buildChannelArguments>[4];

const markets: Record<ActiveChannelKey, { market: string; categoryId: string }> = {
  qoo10: { market: "JP", categoryId: "300000536" },
  shopee: { market: "SG", categoryId: "100001" },
  lazada: { market: "MY", categoryId: "12345" },
  coupang: { market: "KR", categoryId: "12345" },
  elevenst: { market: "KR", categoryId: "1341821" },
  smartstore: { market: "KR", categoryId: "50001330" },
  ebay: { market: "US", categoryId: "123" },
  temu: { market: "KR", categoryId: "601099" },
};

const targets: Partial<Record<ActiveChannelKey, ChannelTarget>> = {
  shopee: {
    targetId: "1719148844",
    displayName: "Singapore",
    marketCode: "SG",
    locale: "en-SG",
    language: "English",
    currency: "SGD",
  },
  lazada: {
    targetId: "MY",
    displayName: "Malaysia",
    marketCode: "MY",
    locale: "ms-MY",
    language: "Malay",
    currency: "MYR",
  },
  ebay: {
    targetId: "EBAY_US",
    displayName: "United States",
    marketCode: "US",
    locale: "en-US",
    language: "English",
    currency: "USD",
  },
};

function rulesContext(channel: ActiveChannelKey): PublishContext {
  return {
    contentMode: "ai_generated",
    product: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      externalCode: "RULES-0001",
      sku: "RULES-0001",
      name: "판매자 확인 원본 상품",
      description: "판매자가 실물과 대조해 확인한 원본 상품 설명입니다.",
      sourceUrl: null,
      status: "draft",
    },
    manualFields: {
      productName: "판매자 확인 원본 상품",
      description: "판매자가 실물과 대조해 확인한 원본 상품 설명입니다.",
      sellerSku: "RULES-0001",
      categoryHint: "생활용품",
      brandName: "No Brand",
      manufacturer: "확인한 공급처",
      countryOfOrigin: "대한민국",
      material: "실물 표기 재질",
      packageContents: "상품 1개",
      condition: "NEW",
      gtinStatus: "NO_GTIN",
      gtin: "",
      sellingPrice: 10_000,
      currency: "KRW",
      stock: 3,
      weightKg: 0.2,
      packageLengthCm: 10,
      packageWidthCm: 8,
      packageHeightCm: 4,
    },
    imageSpecs: [],
    assignments: [{
      channel,
      market: markets[channel].market,
      categoryId: markets[channel].categoryId,
      categoryPath: channel === "qoo10"
        ? ["食品", "スイーツ・お菓子", "洋菓子"]
        : ["Home", "Daily goods"],
      providedAttributes: {},
      status: "confirmed",
      confirmedAt: "2026-09-04T00:00:00.000Z",
    }],
    listings: [],
    sourceImages: [
      { path: "owner/job/input/normalized/0.jpg", url: "https://cdn.example.com/front.jpg" },
    ],
    generatedImages: [
      ...["square", "hero", "portrait", "wide"].map((id) => ({
        id,
        path: `owner/job/output/${id}.jpg`,
        url: `https://cdn.example.com/${id}.jpg`,
      })),
      ...localizedDetailImageRoles.map((id) => ({
        id,
        path: `owner/job/output/${id}.jpg`,
        url: `https://cdn.example.com/${id}.jpg`,
      })),
    ],
    localizedListings: [],
    detailData: null,
  };
}

test("every channel draft uses that channel's gallery and dedicated 8-image order", () => {
  for (const channel of activeChannelKeys) {
    const draft = buildChannelArguments(
      channel,
      rulesContext(channel),
      10_000,
      3,
      targets[channel],
      { weight: 0.2, length: 10, width: 8, height: 4 },
      12.9,
    ) as {
      sellerpilotAssets: {
        detailAssetMode: string;
        galleryImageUrls: string[];
        detailImageUrls: string[];
        detailImageRoles: string[];
      };
      sellerpilotDraftError?: string;
    };
    assert.equal(draft.sellerpilotDraftError, undefined, `${channel} draft error`);
    assert.equal(draft.sellerpilotAssets.detailAssetMode, "dedicated", `${channel} image mode`);
    assert.equal(draft.sellerpilotAssets.detailImageUrls.length, 8, `${channel} detail count`);
    assert.deepEqual(
      draft.sellerpilotAssets.detailImageRoles,
      detailAssetOrderForChannel(channel),
      `${channel} detail order`,
    );
    assert.equal(
      draft.sellerpilotAssets.galleryImageUrls[0],
      `https://cdn.example.com/${galleryAssetOrderForChannel(channel)[0]}.jpg`,
      `${channel} thumbnail asset`,
    );
    assert.equal(
      missingNativeValues(channel, draft, "listing.create").some((item) => item.includes("dedicated marketplace")),
      false,
      `${channel} create must accept dedicated generated details`,
    );
  }
});

test("Temu draft sends one carousel image and eight detail images", () => {
  const draft = buildChannelArguments(
    "temu",
    rulesContext("temu"),
    10_000,
    3,
    undefined,
    { weight: 0.2, length: 10, width: 8, height: 4 },
    12.9,
  ) as { body: { goodsBasic: { goodsCarouselImage: string[]; detailImage: string[] } } };
  assert.equal(draft.body.goodsBasic.goodsCarouselImage.length, 1);
  assert.equal(draft.body.goodsBasic.detailImage.length, 8);
});
