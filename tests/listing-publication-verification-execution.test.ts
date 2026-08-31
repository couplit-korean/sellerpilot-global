import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { GatewayClaim } from "../lib/channels/gateway-contract";
import type { ActiveChannelKey } from "../lib/channels/catalog";
import {
  listingPublicationLanguageVerified,
  listingPublicationProviderAssetEvidence,
  parseListingPublicationAssetBinding,
  verifyListingPublicationContent,
} from "../lib/channels/listing-publication-content";
import { repairLegacyQoo10JapaneseFallbackTitle } from "../lib/channels/qoo10-japanese-title";
import {
  ebayProviderAccountIdentity,
  shopeeProviderAccountIdentity,
  withLazadaProviderAccountIdentity,
  withProviderAccountIdentity,
} from "../lib/channels/provider-account-identity";
import {
  coupangRequest,
  ebayRequest,
  ebayTradingRequest,
  naverRequest,
  temuRequest,
} from "../lib/channels/protocols";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const { executeServerlessGatewayProviderJob } = await import(
  "../lib/channels/serverless-gateway-provider"
);
const {
  deriveServerlessCsGatewayCredentials,
  runOneServerlessCsGatewayJob,
} = await import("../lib/channels/serverless-cs-gateway");

const JOB_ID = "71000000-0000-4000-8000-000000000001";
const SOURCE_JOB_ID = "72000000-0000-4000-8000-000000000001";
const CLAIM_TOKEN = "73000000-0000-4000-8000-000000000001";
const CREDENTIAL_ID = "74000000-0000-4000-8000-000000000001";
const FINGERPRINT = "c".repeat(64);
const detailDigests = Array.from({ length: 8 }, (_, index) => (index + 1).toString(16).padStart(64, "0"));
const detailUrls = detailDigests.map((digest) =>
  `https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/${digest.slice(0, 2)}/${digest}.jpg`);
const galleryDigest = "f".repeat(64);
const galleryUrl = `https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/ff/${galleryDigest}.jpg`;
const detailRoles = [
  "detail-overview", "detail-context", "detail-package", "detail-feature",
  "detail-contents", "detail-use", "detail-care", "detail-routine",
];

function assetBinding(surface: "detail_content" | "gallery" = "detail_content") {
  const approvedDetailImages = detailUrls.map((publicUrl, index) => ({
    role: detailRoles[index],
    approvedObjectPath: `results/11111111-1111-4111-8111-111111111111/claims/22222222-2222-4222-8222-222222222222/${detailRoles[index]}.png`,
    approvedSourceSha256: (index + 17).toString(16).padStart(64, "0"),
    publicUrl,
    objectPath: `normalized/${detailDigests[index].slice(0, 2)}/${detailDigests[index]}.jpg`,
    contentSha256: detailDigests[index],
  }));
  const galleryIdentity = {
    role: "gallery-representative",
    publicUrl: galleryUrl,
    objectPath: `normalized/ff/${galleryDigest}.jpg`,
    contentSha256: galleryDigest,
  };
  return {
    contract: "sellerpilot_publication_asset_binding_v1" as const,
    approvedDetailPageVersion: 1,
    approvedManifestDigest: "a".repeat(64),
    approvedDetailImages,
    providerImageSurface: surface,
    providerTransportImages: surface === "gallery"
      ? [galleryIdentity, ...approvedDetailImages.slice(0, 7)]
      : approvedDetailImages,
  };
}

function publicationArguments<T extends Record<string, unknown>>(
  value: T,
  surface: "detail_content" | "gallery" = "detail_content",
) {
  return { ...value, sellerpilotPublicationAssetBinding: assetBinding(surface) };
}

function detailHtml(text: string, urls = detailUrls) {
  return `<section><p>${text}</p>${urls.map((url) => `<img src="${url}">`).join("")}</section>`;
}

function sourceContext(input: {
  channel: ActiveChannelKey;
  sourceArguments: Record<string, unknown>;
  providerArguments?: Record<string, unknown>;
  sourceStepName: string;
  sourceStepData: Record<string, unknown>;
  resources: Record<string, unknown>;
  remoteId: string;
  locale: string;
  market: string;
  targetId: string;
}) {
  const publicationAssetBinding = listingPublicationProviderAssetEvidence({
    channel: input.channel,
    remoteId: input.remoteId,
    sourceArguments: input.sourceArguments,
    providerArguments: input.providerArguments ?? input.sourceArguments,
  });
  assert.ok(publicationAssetBinding, `${input.channel} fixture provider binding`);
  return {
    contract: "listing_publication_verification_source_v1" as const,
    verificationJobId: JOB_ID,
    sourceJobId: SOURCE_JOB_ID,
    sourceOperation: "listing.create" as const,
    sourceArguments: input.sourceArguments,
    sourceResponsePayload: {
      steps: [{
        name: input.sourceStepName,
        ok: true,
        status: 200,
        data: input.sourceStepData,
      }],
      remoteState: {
        evidence: { publicationAssetBinding },
        resources: input.resources,
      },
    },
    sourceFingerprint: FINGERPRINT,
    expectedRemoteId: input.remoteId,
    expectedLocale: input.locale,
    expectedImageCount: 8 as const,
    market: input.market,
    targetId: input.targetId,
  };
}

type Fixture = {
  channel: ActiveChannelKey;
  remoteId: string;
  locale: string;
  market: string;
  targetId: string;
  sourceArguments: Record<string, unknown>;
  providerArguments?: Record<string, unknown>;
  sourceStepName: string;
  remoteData: Record<string, unknown>;
  credential: Record<string, unknown>;
  remoteResources?: Record<string, unknown>;
  resources: Record<string, unknown>;
};

const qoo10Data = {
  ResultCode: 0,
  ResultObject: {
    ItemNo: "1234567890",
    ItemStatus: "S2",
    ItemTitle: "日本語で確認された高品質の商品名",
    SellerCode: "QA-JP-001",
    ItemDetail: detailHtml("この商品は品質と使用方法の詳細情報を日本語で説明しています。"),
  },
};
const elevenstProduct = {
  prdNo: "123456789",
  sellerPrdCd: "QA-KR-001",
  prdNm: "한국어로 확인된 고품질 판매 상품명",
  htmlDetail: detailHtml("이 상품은 품질과 사용 방법을 한국어로 자세히 설명한 상품입니다."),
  selStatCd: "103",
  selStatNm: "판매중",
};
const elevenstData = { accepted: true, product: elevenstProduct };
const shopeeItem = {
  item_id: 9001,
  item_status: "NORMAL",
  item_name: "Verified product cup",
  description: "The verified product description with detailed information",
  image: { image_id_list: detailUrls.map((_, index) => `image-${index + 1}`) },
};
const shopeeData = { error: "", response: { item_list: [shopeeItem] } };
const lazadaDescriptionText = "Penerangan produk yang disahkan untuk maklumat terperinci";
const lazadaDescription = detailHtml(lazadaDescriptionText);
const lazadaProviderImages = detailUrls.map((_, index) =>
  `https://my-live.slatic.net/p/provider-image-${index + 1}.jpg`);
const lazadaProviderRepresentative = "https://my-live.slatic.net/p/provider-representative.jpg";
const lazadaProviderDescription = detailHtml(lazadaDescriptionText, lazadaProviderImages);
const lazadaData = {
  code: "0",
  data: {
    item_id: 987654321,
    primary_category: 10100205,
    status: "active",
    images: [lazadaProviderRepresentative, ...lazadaProviderImages.slice(0, 7)],
    attributes: {
      name: "Cawan produk yang disahkan",
      description: lazadaProviderDescription,
    },
    skus: [{
      SkuId: 555001,
      SellerSku: "CAWAN-MY-1",
      price: 14.29,
      quantity: 1,
      special_price: 0,
      Status: "active",
      Images: [lazadaProviderRepresentative, ...lazadaProviderImages.slice(0, 7)],
    }],
  },
};
const coupangContents = [
  {
    contentsType: "TEXT",
    contentDetails: [{ detailType: "TEXT", content: "한국어 상품 상세 정보입니다." }],
  },
  ...detailUrls.map((url) => ({
    contentsType: "IMAGE",
    contentDetails: [{ detailType: "IMAGE", content: url }],
  })),
];
const coupangData = {
  code: "SUCCESS",
  data: {
    sellerProductId: 987654321,
    sellerProductName: "한국어로 확인된 고품질 판매 상품",
    displayProductName: "한국어로 확인된 고품질 판매 상품",
    requested: true,
    statusName: "승인완료",
    items: [{ vendorItemId: 4444, itemName: "한국어로 확인된 고품질 판매 상품", contents: coupangContents }],
  },
};
const smartstoreProviderRepresentative =
  "https://shop-phinf.pstatic.net/20260830_sellerpilot/representative.jpg";
const smartstoreProviderImages = detailUrls.map((_, index) =>
  `https://shop-phinf.pstatic.net/20260830_sellerpilot/detail-${index + 1}.jpg`);
const smartstoreDescriptionText = "한국어 상품 상세 정보입니다.";
const smartstoreProviderDescription = detailHtml(
  smartstoreDescriptionText,
  smartstoreProviderImages,
);
const smartstoreData = {
  originProductNo: 10000001,
  smartstoreChannelProductNo: 20000001,
  originProduct: {
    name: "한국어로 확인된 스마트스토어 판매 상품",
    statusType: "SALE",
    detailContent: smartstoreProviderDescription,
    images: {
      representativeImage: { url: smartstoreProviderRepresentative },
      optionalImages: smartstoreProviderImages.map((url) => ({ url })),
    },
  },
  smartstoreChannelProduct: {
    channelProductNo: 20000001,
    originProductNo: 10000001,
    channelProductName: "한국어로 확인된 스마트스토어 판매 상품",
    channelProductDisplayStatusType: "ON",
  },
};
const ebayOffer = {
  offerId: "offer-123",
  sku: "SELLERPILOT-001",
  marketplaceId: "EBAY_US",
  status: "PUBLISHED",
  listingDescription: detailHtml("The verified product description with detailed information"),
  listing: { listingId: "110000000001", listingStatus: "ACTIVE" },
};
const ebayInventory = {
  product: {
    title: "Verified product item",
    imageUrls: ["https://cdn.example.test/gallery.jpg"],
  },
};
const temuGoodsBasic = {
  externalGoodsId: "TEMU-KR-001",
  goodsName: "한국어로 확인된 테무 판매 상품",
  goodsDesc: "이 상품은 품질과 사용 방법을 한국어로 자세히 설명한 상품입니다.",
  bulletPoints: ["검증된 재질과 구성 정보를 한국어로 안내합니다."],
  goodsCarouselImage: [galleryUrl],
  detailImage: detailUrls,
};
const temuDetailData = {
  success: true,
  result: {
    goodsId: "88000001",
    outGoodsSn: temuGoodsBasic.externalGoodsId,
    goodsName: temuGoodsBasic.goodsName,
    goodsDesc: temuGoodsBasic.goodsDesc,
    bulletPoints: temuGoodsBasic.bulletPoints,
    goodsGallery: {
      goodsCarouselImage: temuGoodsBasic.goodsCarouselImage,
      detailImage: detailUrls,
    },
  },
};

const fixtures: Fixture[] = [
  {
    channel: "qoo10",
    remoteId: "1234567890",
    locale: "ja-JP",
    market: "JP",
    targetId: "JP",
    sourceArguments: publicationArguments({
      publicationIntent: "live",
      publicationStateContract: "verified_remote_state_v1",
      publicationExpectedLocale: "ja-JP",
      publicationExpectedFingerprint: FINGERPRINT,
      publicationExpectedImageCount: 8,
      params: {
        ItemTitle: qoo10Data.ResultObject.ItemTitle,
        SellerCode: "QA-JP-001",
        ItemDescription: qoo10Data.ResultObject.ItemDetail,
      },
    }),
    sourceStepName: "GetItemDetailInfo-publication-readback",
    remoteData: qoo10Data,
    credential: { api_key: "qoo10-key" },
    resources: { itemCode: "1234567890", sellerCode: "QA-JP-001" },
  },
  {
    channel: "elevenst",
    remoteId: "123456789",
    locale: "ko-KR",
    market: "KR",
    targetId: "KR",
    sourceArguments: publicationArguments({
      publicationIntent: "live",
      publicationStateContract: "verified_remote_state_v1",
      publicationExpectedLocale: "ko-KR",
      publicationExpectedFingerprint: FINGERPRINT,
      publicationExpectedImageCount: 8,
      product: {
        prdNm: elevenstProduct.prdNm,
        sellerPrdCd: elevenstProduct.sellerPrdCd,
        htmlDetail: elevenstProduct.htmlDetail,
      },
    }),
    sourceStepName: "product-publication-readback",
    remoteData: elevenstData,
    credential: { api_key: "A".repeat(32) },
    resources: { productNo: "123456789", sellerProductCode: "QA-KR-001" },
  },
  {
    channel: "shopee",
    remoteId: "9001",
    locale: "en-PH",
    market: "PH",
    targetId: "1001",
    sourceArguments: publicationArguments({
      publicationIntent: "live",
      publicationStateContract: "verified_remote_state_v1",
      publicationExpectedLocale: "en-PH",
      publicationExpectedFingerprint: FINGERPRINT,
      publicationExpectedImageCount: 8,
      globalProduct: true,
      merchantId: "2001",
      country: "ph",
      imageUrls: [galleryUrl, ...detailUrls.slice(0, 7)],
      publish: {
        shop_id: 1001,
        shop_region: "PH",
        item: {
          item_name: shopeeItem.item_name,
          description: shopeeItem.description,
          item_status: "NORMAL",
        },
      },
    }, "gallery"),
    providerArguments: {
      publicationIntent: "live",
      publicationStateContract: "verified_remote_state_v1",
      publicationExpectedLocale: "en-PH",
      publicationExpectedFingerprint: FINGERPRINT,
      publicationExpectedImageCount: 8,
      globalProduct: true,
      country: "ph",
      publish: { shop_id: 1001, item: shopeeItem },
      body: shopeeItem,
    },
    sourceStepName: "listing-readback",
    remoteData: shopeeData,
    credential: withProviderAccountIdentity({
      partner_id: "1",
      partner_key: "shopee-secret",
      main_account_id: "3001",
      merchant_id: "2001",
      shop_id: "1001",
      shop_ids: ["1001"],
      access_token: "shopee-access",
      refresh_token: "shopee-refresh",
      access_token_expires_at: "2099-01-01T00:00:00.000Z",
      refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
      shopee_targets: [{
        type: "shop",
        id: "1001",
        access_token: "shopee-access",
        refresh_token: "shopee-refresh",
        access_token_expires_at: "2099-01-01T00:00:00.000Z",
        refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
      }, {
        type: "merchant",
        id: "2001",
        access_token: "shopee-merchant-access",
        refresh_token: "shopee-merchant-refresh",
        access_token_expires_at: "2099-01-01T00:00:00.000Z",
        refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
      }],
    }, shopeeProviderAccountIdentity({ mainAccountId: "3001" })),
    resources: { localItemId: "9001", shopId: "1001", globalItemId: "7001" },
  },
  {
    channel: "lazada",
    remoteId: "987654321",
    locale: "ms-MY",
    market: "MY",
    targetId: "2001",
    sourceArguments: publicationArguments({
      publicationIntent: "live",
      publicationStateContract: "verified_remote_state_v1",
      publicationExpectedLocale: "ms-MY",
      publicationExpectedFingerprint: FINGERPRINT,
      publicationExpectedImageCount: 8,
      country: "my",
      request: {
        Request: {
          Product: {
            PrimaryCategory: "10100205",
            Images: { Image: [galleryUrl, ...detailUrls.slice(0, 7)] },
            Attributes: {
              name: lazadaData.data.attributes.name,
              description: lazadaDescription,
            },
            Skus: { Sku: [{ SellerSku: "CAWAN-MY-1", price: "14.29", quantity: "1", Status: "active" }] },
          },
        },
      },
    }),
    providerArguments: {
      publicationIntent: "live",
      publicationStateContract: "verified_remote_state_v1",
      publicationExpectedLocale: "ms-MY",
      publicationExpectedFingerprint: FINGERPRINT,
      publicationExpectedImageCount: 8,
      country: "my",
      request: {
        Request: {
          Product: {
            PrimaryCategory: "10100205",
            Images: { Image: [lazadaProviderRepresentative, ...lazadaProviderImages.slice(0, 7)] },
            Attributes: {
              name: lazadaData.data.attributes.name,
              description: lazadaProviderDescription,
            },
            Skus: { Sku: [{ SkuId: "555001", SellerSku: "CAWAN-MY-1", price: "14.29", quantity: "1", Status: "active" }] },
          },
        },
      },
    },
    sourceStepName: "listing-readback",
    remoteData: lazadaData,
    credential: withLazadaProviderAccountIdentity({
      app_key: "lazada-app",
      app_secret: "lazada-secret",
      access_token: "lazada-access",
      country: "my",
      access_token_expires_at: "2099-01-01T00:00:00.000Z",
    }, {
      account_platform: "seller_center",
      country_user_info: [{ country: "my", seller_id: "2001", user_id: "3001" }],
    }).payload,
    resources: {
      itemId: "987654321",
      country: "my",
      categoryId: "10100205",
      skuIds: ["555001"],
      sellerSkus: ["CAWAN-MY-1"],
    },
  },
  {
    channel: "coupang",
    remoteId: "987654321",
    locale: "ko-KR",
    market: "KR",
    targetId: "A00012345",
    sourceArguments: publicationArguments({
      publicationIntent: "live",
      publicationStateContract: "verified_remote_state_v1",
      publicationExpectedLocale: "ko-KR",
      publicationExpectedFingerprint: FINGERPRINT,
      publicationExpectedImageCount: 8,
      body: {
        sellerProductName: coupangData.data.sellerProductName,
        displayProductName: coupangData.data.displayProductName,
        items: [{ itemName: coupangData.data.items[0].itemName, contents: coupangContents }],
      },
    }),
    sourceStepName: "seller-product-publication-readback",
    remoteData: coupangData,
    credential: {
      vendor_id: "A00012345",
      access_key: "coupang-access",
      secret_key: "coupang-secret",
      requested_by: "wing-user",
    },
    resources: { sellerProductId: "987654321", vendorItemIds: ["4444"] },
  },
  {
    channel: "smartstore",
    remoteId: "10000001",
    locale: "ko-KR",
    market: "KR",
    targetId: "seller-account",
    sourceArguments: publicationArguments({
      publicationIntent: "live",
      publicationStateContract: "verified_remote_state_v1",
      publicationExpectedLocale: "ko-KR",
      publicationExpectedFingerprint: FINGERPRINT,
      publicationExpectedImageCount: 8,
      body: {
        originProduct: {
          name: smartstoreData.originProduct.name,
          detailContent: detailHtml(smartstoreDescriptionText),
        },
        smartstoreChannelProduct: {
          channelProductName: smartstoreData.smartstoreChannelProduct.channelProductName,
        },
      },
    }),
    providerArguments: publicationArguments({
      publicationIntent: "live",
      publicationStateContract: "verified_remote_state_v1",
      publicationExpectedLocale: "ko-KR",
      publicationExpectedFingerprint: FINGERPRINT,
      publicationExpectedImageCount: 8,
      body: {
        originProduct: {
          name: smartstoreData.originProduct.name,
          detailContent: smartstoreProviderDescription,
          images: smartstoreData.originProduct.images,
        },
        smartstoreChannelProduct: {
          channelProductName: smartstoreData.smartstoreChannelProduct.channelProductName,
        },
      },
    }),
    sourceStepName: "origin-product-publication-readback",
    remoteData: smartstoreData,
    credential: {
      client_id: "naver-client",
      client_secret: "$2a$10$N9qo8uLOickgx2ZMRZoMye",
      token_type: "SELLER",
      account_id: "seller-account",
      access_token: "naver-access",
      access_token_expires_at: "2099-01-01T00:00:00.000Z",
    },
    resources: { originProductNo: "10000001", smartstoreChannelProductNo: "20000001" },
  },
  {
    channel: "temu",
    remoteId: "88000001",
    locale: "ko-KR",
    market: "KR",
    targetId: "KR",
    sourceArguments: publicationArguments({
      publicationIntent: "live",
      publicationStateContract: "verified_remote_state_v1",
      publicationExpectedLocale: "ko-KR",
      publicationExpectedFingerprint: FINGERPRINT,
      publicationExpectedImageCount: 8,
      body: { language: "ko", goodsBasic: temuGoodsBasic, skuList: [] },
    }),
    sourceStepName: "goods-detail-image-readback",
    remoteData: temuDetailData,
    credential: {
      app_key: "temu-app",
      app_secret: "temu-secret",
      access_token: "temu-access",
    },
    resources: { goodsId: "88000001", externalGoodsId: "TEMU-KR-001" },
  },
  {
    channel: "ebay",
    remoteId: "110000000001",
    locale: "en-US",
    market: "US",
    targetId: "EBAY_US",
    sourceArguments: publicationArguments({
      publicationIntent: "live",
      publicationStateContract: "verified_remote_state_v1",
      publicationExpectedLocale: "en-US",
      publicationExpectedFingerprint: FINGERPRINT,
      publicationExpectedImageCount: 8,
      sku: "SELLERPILOT-001",
      inventoryItem: ebayInventory,
      offer: {
        marketplaceId: "EBAY_US",
        listingDescription: ebayOffer.listingDescription,
      },
    }),
    sourceStepName: "offer-publication-readback",
    remoteData: ebayOffer,
    remoteResources: { offerId: "offer-123" },
    credential: withProviderAccountIdentity({
      access_token: "ebay-access",
      access_token_expires_at: "2099-01-01T00:00:00.000Z",
      refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
      marketplace_id: "EBAY_US",
    }, ebayProviderAccountIdentity("QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=")),
    resources: {
      offerId: "offer-123",
      listingId: "110000000001",
      sku: "SELLERPILOT-001",
      marketplaceId: "EBAY_US",
    },
  },
];

function sourceResponse(fixture: Fixture) {
  if (fixture.channel !== "ebay") {
    return sourceContext({
      channel: fixture.channel,
      sourceArguments: fixture.sourceArguments,
      providerArguments: fixture.providerArguments,
      sourceStepName: fixture.sourceStepName,
      sourceStepData: fixture.remoteData,
      resources: fixture.resources,
      remoteId: fixture.remoteId,
      locale: fixture.locale,
      market: fixture.market,
      targetId: fixture.targetId,
    });
  }
  const source = sourceContext({
    channel: fixture.channel,
    sourceArguments: fixture.sourceArguments,
    providerArguments: fixture.providerArguments,
    sourceStepName: "offer-publication-readback",
    sourceStepData: ebayOffer,
    resources: fixture.resources,
    remoteId: fixture.remoteId,
    locale: fixture.locale,
    market: fixture.market,
    targetId: fixture.targetId,
  });
  source.sourceResponsePayload.steps.push({
    name: "inventory-item-publication-readback",
    ok: true,
    status: 200,
    data: ebayInventory,
  });
  return source;
}

function job(fixture: Fixture): GatewayClaim {
  return {
    id: JOB_ID,
    claim_token: CLAIM_TOKEN,
    credential_id: CREDENTIAL_ID,
    channel: fixture.channel,
    operation: "listing.publication.verify",
    environment: "production",
    request: {
      arguments: {
        publicationReviewId: "75000000-0000-4000-8000-000000000001",
        publicationReviewSourceJobId: SOURCE_JOB_ID,
        publicationReviewCheck: 1,
        sellerpilotReadOnly: true,
        remoteId: fixture.remoteId,
        market: fixture.market,
        targetId: fixture.targetId,
        publicationIntent: "live",
        publicationStateContract: "verified_remote_state_v1",
        publicationExpectedLocale: fixture.locale,
        publicationExpectedFingerprint: FINGERPRINT,
        publicationExpectedImageCount: 8,
        remoteResources: fixture.remoteResources ?? {},
        ...(fixture.channel === "shopee" ? { shopId: fixture.targetId } : {}),
        ...(fixture.channel === "lazada" ? { country: fixture.market.toLowerCase() } : {}),
        ...(fixture.channel === "ebay"
          ? { marketplaceId: `EBAY_${fixture.market}`, marketplaceSku: "SELLERPILOT-001" }
          : {}),
        sellerpilotPublicationSource: sourceResponse(fixture),
      },
    },
    credential: structuredClone(fixture.credential),
    attempt_count: 1,
  };
}

function elevenstXml() {
  return `<?xml version="1.0" encoding="UTF-8"?><Product><prdNo>${elevenstProduct.prdNo}</prdNo><sellerPrdCd>${elevenstProduct.sellerPrdCd}</sellerPrdCd><prdNm>${elevenstProduct.prdNm}</prdNm><htmlDetail><![CDATA[${elevenstProduct.htmlDetail}]]></htmlDetail><selStatCd>103</selStatCd><selStatNm>판매중</selStatNm></Product>`;
}

function ebayGetUserXml(eiasToken = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=") {
  return `<?xml version="1.0" encoding="UTF-8"?><GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><User><UserID>sellerpilot-test</UserID><EIASToken>${eiasToken}</EIASToken></User></GetUserResponse>`;
}

function ebayGetItemXml(sku = "SELLERPILOT-001", listingId = "110000000001") {
  return `<?xml version="1.0" encoding="UTF-8"?><GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack><Item><ItemID>${listingId}</ItemID><SKU>${sku}</SKU><Site>US</Site></Item></GetItemResponse>`;
}

test("all eight real provider executors reverify read-only state without opening a provider mutation fence", async () => {
  const originalFetch = globalThis.fetch;
  for (const fixture of fixtures) {
    let providerMutationHooks = 0;
    let credentialMutationHooks = 0;
    let providerWriteRequests = 0;
    const calls: Array<{ method: string; url: string }> = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const ebayTradingCall = new Headers(init?.headers).get("x-ebay-api-call-name") ?? "";
      calls.push({ method, url });
      const isExactQoo10ReadRpc = method === "POST"
        && url.includes("ItemsLookup.GetItemDetailInfo")
        && new URL(url).searchParams.get("method") === "ItemsLookup.GetItemDetailInfo";
      const isExactEbayTradingRead = method === "POST"
        && url.endsWith("/ws/api.dll")
        && ["GetUser", "GetItem"].includes(ebayTradingCall);
      const temuRequestBody = fixture.channel === "temu" && typeof init?.body === "string"
        ? JSON.parse(init.body) as Record<string, unknown>
        : {};
      const isExactTemuRead = method === "POST"
        && [
          "temu.local.goods.list.retrieve",
          "bg.local.goods.publish.status.get",
          "bg.local.goods.detail.query",
        ].includes(String(temuRequestBody.type ?? ""));
      if (method !== "GET" && !isExactQoo10ReadRpc && !isExactEbayTradingRead && !isExactTemuRead) {
        providerWriteRequests += 1;
      }
      if (fixture.channel === "elevenst") {
        return new Response(elevenstXml(), {
          status: 200,
          headers: { "content-type": "application/xml; charset=utf-8" },
        });
      }
      if (fixture.channel === "shopee" && url.includes("/get_global_item_info")) {
        assert.equal(new URL(url).searchParams.get("global_item_id_list"), "7001");
        assert.equal(new URL(url).searchParams.get("merchant_id"), "2001");
        return Response.json({ error: "", response: { global_item_list: [{ global_item_id: 7001 }] } });
      }
      if (fixture.channel === "shopee" && url.includes("/get_published_list")) {
        assert.equal(new URL(url).searchParams.get("global_item_id"), "7001");
        assert.equal(new URL(url).searchParams.get("merchant_id"), "2001");
        return Response.json({ error: "", response: { published_item: [{ shop_id: 1001, item_id: 9001 }] } });
      }
      if (fixture.channel === "shopee" && url.includes("/get_item_base_info")) {
        assert.equal(new URL(url).searchParams.get("shop_id"), "1001");
        assert.equal(new URL(url).searchParams.get("item_id_list"), "9001");
        return Response.json(shopeeData);
      }
      if (fixture.channel === "coupang" && url.includes("/vendor-items/4444/inventories")) {
        return Response.json({ code: "SUCCESS", data: { sellerItemId: 3333, onSale: true } });
      }
      if (fixture.channel === "smartstore" && url.includes("/v2/products/channel-products/")) {
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer naver-access");
        return Response.json({
          originProductNo: smartstoreData.originProductNo,
          smartstoreChannelProductNo: smartstoreData.smartstoreChannelProductNo,
          smartstoreChannelProduct: smartstoreData.smartstoreChannelProduct,
        });
      }
      if (fixture.channel === "ebay" && url.includes("/inventory_item/")) {
        return Response.json(ebayInventory);
      }
      if (fixture.channel === "ebay" && ebayTradingCall === "GetUser") {
        return new Response(ebayGetUserXml(), { status: 200, headers: { "content-type": "text/xml" } });
      }
      if (fixture.channel === "ebay" && ebayTradingCall === "GetItem") {
        assert.match(String(init?.body ?? ""), /<ItemID>110000000001<\/ItemID>/u);
        assert.match(String(init?.body ?? ""), /<SKU>SELLERPILOT-001<\/SKU>/u);
        return new Response(ebayGetItemXml(), { status: 200, headers: { "content-type": "text/xml" } });
      }
      if (fixture.channel === "temu") {
        if (temuRequestBody.type === "temu.local.goods.list.retrieve") {
          return Response.json({
            success: true,
            result: { goodsList: [{ goodsId: "88000001", outGoodsSn: "TEMU-KR-001" }] },
          });
        }
        if (temuRequestBody.type === "bg.local.goods.publish.status.get") {
          return Response.json({
            success: true,
            result: { goodsPublishStatusList: [{ goodsId: "88000001", status: 1, subStatus: 2, statusName: "LIVE" }] },
          });
        }
        if (temuRequestBody.type === "bg.local.goods.detail.query") {
          assert.equal(temuRequestBody.language, "ko");
          return Response.json(temuDetailData);
        }
      }
      return Response.json(fixture.remoteData);
    };
    try {
      const result = await executeServerlessGatewayProviderJob({
        job: job(fixture),
        signal: new AbortController().signal,
        hooks: {
          assertLeaseHealthy: async () => undefined,
          beginProviderMutation: async () => { providerMutationHooks += 1; },
          beginCredentialMutation: async () => { credentialMutationHooks += 1; },
          stageCredentialRefresh: async () => { throw new Error("unexpected credential refresh"); },
        },
      });
      assert.equal(result.operation, "listing.publication.verify", fixture.channel);
      assert.equal(result.ok, true, `${fixture.channel}: ${result.safeMessage}`);
      assert.equal("remoteId" in result ? result.remoteId : undefined, fixture.remoteId, fixture.channel);
      assert.equal("publicationFulfilled" in result ? result.publicationFulfilled : undefined, true, fixture.channel);
      assert.equal("remoteState" in result ? result.remoteState?.imageCount : undefined, 8, fixture.channel);
      assert.equal(
        "remoteState" in result ? result.remoteState?.evidence.languageContentVerified : undefined,
        true,
        fixture.channel,
      );
      assert.equal(
        "remoteState" in result ? result.remoteState?.evidence.titleLanguageVerified : undefined,
        true,
        fixture.channel,
      );
      assert.equal(
        "remoteState" in result ? result.remoteState?.evidence.descriptionLanguageVerified : undefined,
        true,
        fixture.channel,
      );
      assert.equal(
        "remoteState" in result ? result.remoteState?.evidence.contentDigestVerified : undefined,
        true,
        fixture.channel,
      );
      assert.equal(
        "remoteState" in result ? result.remoteState?.evidence.providerImageSurface : undefined,
        fixture.channel === "shopee" ? "gallery" : "detail_content",
        fixture.channel,
      );
      assert.equal(
        "remoteState" in result ? result.remoteState?.evidence.providerBodyDetailImagesVerified : undefined,
        fixture.channel !== "shopee",
        fixture.channel,
      );
      assert.equal(providerMutationHooks, 0, fixture.channel);
      assert.equal(credentialMutationHooks, 0, fixture.channel);
      assert.equal(providerWriteRequests, 0, fixture.channel);
      assert.ok(calls.length >= 1, fixture.channel);
      if (fixture.channel === "smartstore") {
        assert.equal(calls.some((call) => call.url.includes("/oauth2/token")), false);
        assert.ok(calls.every((call) => call.method === "GET"));
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

test("SmartStore publication verification uses only a staged token and never refreshes or retries a 401", async () => {
  const fixture = fixtures.find((item) => item.channel === "smartstore")!;
  const originalFetch = globalThis.fetch;
  for (const expiry of ["missing", "near-expiry"] as const) {
    const verificationJob = job(fixture);
    if (expiry === "missing") {
      delete verificationJob.credential.access_token;
      delete verificationJob.credential.access_token_expires_at;
    } else {
      verificationJob.credential.access_token_expires_at = new Date(Date.now() + 60_000).toISOString();
    }
    let fetchCalls = 0;
    let mutationHooks = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return Response.json({});
    };
    try {
      await assert.rejects(executeServerlessGatewayProviderJob({
        job: verificationJob,
        signal: new AbortController().signal,
        hooks: {
          assertLeaseHealthy: async () => undefined,
          beginProviderMutation: async () => { mutationHooks += 1; },
          beginCredentialMutation: async () => { mutationHooks += 1; },
          stageCredentialRefresh: async () => { mutationHooks += 1; },
        },
      }), /LISTING_PUBLICATION_VERIFY_CREDENTIAL_REFRESH_REQUIRED/);
      assert.equal(fetchCalls, 0, expiry);
      assert.equal(mutationHooks, 0, expiry);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  const unauthorizedJob = job(fixture);
  const calls: Array<{ method: string; url: string; authorization: string | null }> = [];
  let mutationHooks = 0;
  globalThis.fetch = async (input, init) => {
    calls.push({
      method: String(init?.method ?? "GET").toUpperCase(),
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return Response.json({ code: "GW.AUTHN", message: "expired" }, { status: 401 });
  };
  try {
    const result = await executeServerlessGatewayProviderJob({
      job: unauthorizedJob,
      signal: new AbortController().signal,
      hooks: {
        assertLeaseHealthy: async () => undefined,
        beginProviderMutation: async () => { mutationHooks += 1; },
        beginCredentialMutation: async () => { mutationHooks += 1; },
        stageCredentialRefresh: async () => { mutationHooks += 1; },
      },
    });
    assert.equal(result.ok, false);
    assert.deepEqual(calls, [{
      method: "GET",
      url: "https://api.commerce.naver.com/external/v2/products/origin-products/10000001",
      authorization: "Bearer naver-access",
    }]);
    assert.equal(mutationHooks, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SmartStore source publication stages its client-credentials token before listing preparation", async () => {
  const fixture = fixtures.find((item) => item.channel === "smartstore")!;
  const sourceJob = {
    ...job(fixture),
    operation: "listing.update" as const,
    request: { arguments: structuredClone(fixture.sourceArguments) },
    credential: structuredClone(fixture.credential),
  } satisfies GatewayClaim;
  delete sourceJob.credential.access_token;
  delete sourceJob.credential.access_token_expires_at;
  const originalFetch = globalThis.fetch;
  const fetchCalls: string[] = [];
  const staged: Array<Record<string, unknown>> = [];
  let credentialMutationHooks = 0;
  let providerMutationHooks = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    fetchCalls.push(url);
    assert.equal(url, "https://api.commerce.naver.com/external/v1/oauth2/token");
    return Response.json({ access_token: "staged-naver-access", expires_in: 10_800 });
  };
  try {
    await assert.rejects(executeServerlessGatewayProviderJob({
      job: sourceJob,
      signal: new AbortController().signal,
      hooks: {
        assertLeaseHealthy: async () => undefined,
        beginProviderMutation: async () => { providerMutationHooks += 1; },
        beginCredentialMutation: async () => { credentialMutationHooks += 1; },
        stageCredentialRefresh: async (refresh) => { staged.push(refresh.payload); },
      },
    }), /NAVER_REPRESENTATIVE_IMAGE_MISSING/);
    assert.deepEqual(fetchCalls, ["https://api.commerce.naver.com/external/v1/oauth2/token"]);
    assert.equal(credentialMutationHooks, 1);
    assert.equal(providerMutationHooks, 0);
    assert.equal(staged.length, 1);
    assert.equal(staged[0].access_token, "staged-naver-access");
    assert.match(String(staged[0].access_token_expires_at), /^\d{4}-\d{2}-\d{2}T/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopee global re-verification derives the global id from immutable source evidence and requires the official global-to-local map", async () => {
  const fixture = fixtures.find((item) => item.channel === "shopee")!;
  const originalFetch = globalThis.fetch;
  const cases = [
    {
      publishedItems: [{ shop_id: 1001, item_id: 9001 }],
      expectedOk: true,
    },
    {
      publishedItems: [{ shop_id: 1001, item_id: 9002 }],
      expectedOk: false,
    },
    {
      publishedItems: [
        { shop_id: 1001, item_id: 9001 },
        { shop_id: 1001, item_id: 9002 },
      ],
      expectedOk: false,
    },
    {
      publishedItems: [
        { shop_id: 1001, item_id: 9001 },
        { shop_id: 1002, item_id: 9010 },
      ],
      expectedOk: true,
    },
  ];
  for (const testCase of cases) {
    const verificationJob = job(fixture);
    const argumentsValue = verificationJob.request.arguments as Record<string, unknown>;
    argumentsValue.globalItemId = "9999";
    argumentsValue.remoteResources = {
      globalItemId: "9999",
      localItemId: "9998",
      shopId: "1002",
    };
    const observedGlobalIds: string[] = [];
    let mutationHooks = 0;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/global_product/get_global_item_info")) {
        observedGlobalIds.push(url.searchParams.get("global_item_id_list") ?? "");
        assert.equal(url.searchParams.get("merchant_id"), "2001");
        assert.equal(url.searchParams.get("access_token"), "shopee-merchant-access");
        return Response.json({ error: "", response: { global_item_list: [{ global_item_id: 7001 }] } });
      }
      if (url.pathname.endsWith("/global_product/get_published_list")) {
        observedGlobalIds.push(url.searchParams.get("global_item_id") ?? "");
        assert.equal(url.searchParams.get("merchant_id"), "2001");
        assert.equal(url.searchParams.get("access_token"), "shopee-merchant-access");
        return Response.json({
          error: "",
          response: { published_item: testCase.publishedItems },
        });
      }
      if (url.pathname.endsWith("/product/get_item_base_info")) {
        assert.equal(url.searchParams.get("shop_id"), "1001");
        assert.equal(url.searchParams.get("access_token"), "shopee-access");
        assert.equal(url.searchParams.get("item_id_list"), "9001");
        return Response.json(shopeeData);
      }
      throw new Error(`unexpected Shopee verifier request: ${url}`);
    };
    try {
      const result = await executeServerlessGatewayProviderJob({
        job: verificationJob,
        signal: new AbortController().signal,
        hooks: {
          assertLeaseHealthy: async () => undefined,
          beginProviderMutation: async () => { mutationHooks += 1; },
          beginCredentialMutation: async () => { mutationHooks += 1; },
          stageCredentialRefresh: async () => { mutationHooks += 1; },
        },
      });
      assert.deepEqual(observedGlobalIds, ["7001", "7001"]);
      assert.equal(result.ok, testCase.expectedOk);
      assert.equal("remoteState" in result ? Boolean(result.remoteState) : false, testCase.expectedOk);
      assert.equal(mutationHooks, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

test("eBay re-verification attests the token account and immutable offer-SKU-listing tuple through read-only provider calls", async () => {
  const fixture = fixtures.find((item) => item.channel === "ebay")!;
  const originalFetch = globalThis.fetch;
  for (const tradingSku of ["SELLERPILOT-001", "ATTACKER-SKU"]) {
    const verificationJob = job(fixture);
    const argumentsValue = verificationJob.request.arguments as Record<string, unknown>;
    argumentsValue.remoteResources = {
      offerId: "attacker-offer",
      listingId: "999999999999",
      sku: "ATTACKER-SKU",
      marketplaceId: "EBAY_GB",
    };
    let mutationHooks = 0;
    const tradingCalls: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      const callName = new Headers(init?.headers).get("x-ebay-api-call-name") ?? "";
      if (callName === "GetUser") {
        tradingCalls.push(callName);
        return new Response(ebayGetUserXml(), { status: 200 });
      }
      if (callName === "GetItem") {
        tradingCalls.push(callName);
        assert.match(String(init?.body ?? ""), /<ItemID>110000000001<\/ItemID>/u);
        assert.match(String(init?.body ?? ""), /<SKU>SELLERPILOT-001<\/SKU>/u);
        return new Response(ebayGetItemXml(tradingSku), { status: 200 });
      }
      if (url.includes("/sell/inventory/v1/offer/offer-123")) return Response.json(ebayOffer);
      if (url.includes("/sell/inventory/v1/inventory_item/SELLERPILOT-001")) return Response.json(ebayInventory);
      throw new Error(`unexpected eBay verifier request: ${url}`);
    };
    try {
      const result = await executeServerlessGatewayProviderJob({
        job: verificationJob,
        signal: new AbortController().signal,
        hooks: {
          assertLeaseHealthy: async () => undefined,
          beginProviderMutation: async () => { mutationHooks += 1; },
          beginCredentialMutation: async () => { mutationHooks += 1; },
          stageCredentialRefresh: async () => { mutationHooks += 1; },
        },
      });
      assert.deepEqual(tradingCalls, ["GetUser", "GetItem"]);
      assert.equal(result.ok, tradingSku === "SELLERPILOT-001");
      assert.equal("remoteState" in result ? Boolean(result.remoteState) : false, tradingSku === "SELLERPILOT-001");
      assert.equal(mutationHooks, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

test("publication content verification rejects language attributes, duplicates, wrong images, nine images, and content drift", () => {
  const sourceArguments = fixtures[0].sourceArguments;
  const source = sourceResponse(fixtures[0]);
  const valid = verifyListingPublicationContent({
    channel: "qoo10",
    expectedLocale: "ja-JP",
    expectedImageCount: 8,
    remoteId: fixtures[0].remoteId,
    sourceArguments,
    sourceResponsePayload: source.sourceResponsePayload,
    sourceRemotePayload: qoo10Data,
    remotePayload: qoo10Data,
    remoteResources: fixtures[0].resources,
  });
  assert.equal(valid.verified, true);

  const qooItem = qoo10Data.ResultObject;
  const attacks = [
    {
      ...qoo10Data,
      ResultObject: {
        ...qooItem,
        ItemTitle: "한국어 상품명",
        ItemDetail: detailHtml('<span lang="ja-JP">한국어 상품 상세 설명입니다.</span>'),
      },
    },
    {
      ...qoo10Data,
      ResultObject: {
        ...qooItem,
        ItemDetail: detailHtml("日本語の商品詳細情報です。", Array(8).fill(detailUrls[0])),
      },
    },
    {
      ...qoo10Data,
      ResultObject: {
        ...qooItem,
        ItemDetail: detailHtml(
          "日本語の商品詳細情報です。",
          detailUrls.map((_, index) => `https://wrong.example.test/${index + 1}.jpg`),
        ),
      },
    },
    {
      ...qoo10Data,
      ResultObject: {
        ...qooItem,
        ItemDetail: detailHtml("日本語の商品詳細情報です。", [...detailUrls, "https://cdn.example.test/9.jpg"]),
      },
    },
    {
      ...qoo10Data,
      ResultObject: { ...qooItem, ItemTitle: "異なる日本語の商品名" },
    },
    {
      ...qoo10Data,
      ResultObject: {
        ...qooItem,
        ItemDetail: `${qooItem.ItemDetail}<p>購入先 https://phishing.example.test/checkout</p>`,
      },
    },
    {
      ...qoo10Data,
      ResultObject: {
        ...qooItem,
        ItemDetail: `${qooItem.ItemDetail}<a href="https://phishing.example.test/checkout">特別購入リンク</a>`,
      },
    },
  ];
  for (const remotePayload of attacks) {
    assert.equal(verifyListingPublicationContent({
      channel: "qoo10",
      expectedLocale: "ja-JP",
      expectedImageCount: 8,
      remoteId: fixtures[0].remoteId,
      sourceArguments,
      sourceResponsePayload: source.sourceResponsePayload,
      sourceRemotePayload: qoo10Data,
      remotePayload,
      remoteResources: fixtures[0].resources,
    }).verified, false);
  }
});

test("Lazada accepts provider-migrated image URLs only through immutable first-readback evidence", () => {
  const fixture = fixtures.find((item) => item.channel === "lazada")!;
  const source = sourceResponse(fixture);
  const accepted = verifyListingPublicationContent({
    channel: "lazada",
    expectedLocale: fixture.locale,
    expectedImageCount: 8,
    remoteId: fixture.remoteId,
    sourceArguments: fixture.sourceArguments,
    sourceResponsePayload: source.sourceResponsePayload,
    sourceRemotePayload: fixture.remoteData,
    remotePayload: fixture.remoteData,
    remoteResources: fixture.resources,
  });
  assert.equal(accepted.verified, true);
  assert.equal(accepted.detailImageCountVerified, true);
  assert.equal(accepted.representativeImageVerified, true);
  assert.equal(
    accepted.providerImageContract,
    "representative_plus_approved_detail_8_exact_detail_content",
  );

  const drifted = structuredClone(fixture.remoteData);
  const driftedData = drifted.data as Record<string, unknown>;
  const driftedAttributes = driftedData.attributes as Record<string, unknown>;
  driftedAttributes.description = detailHtml(
    "Penerangan produk telah diubah selepas bacaan pertama untuk pembeli",
    lazadaProviderImages,
  );
  const rejected = verifyListingPublicationContent({
    channel: "lazada",
    expectedLocale: fixture.locale,
    expectedImageCount: 8,
    remoteId: fixture.remoteId,
    sourceArguments: fixture.sourceArguments,
    sourceResponsePayload: source.sourceResponsePayload,
    sourceRemotePayload: fixture.remoteData,
    remotePayload: drifted,
    remoteResources: fixture.resources,
  });
  assert.equal(rejected.verified, false);
  assert.equal(rejected.descriptionVerified, false);
  assert.equal(rejected.contentDigestVerified, false);
});

test("Lazada independent execution rejects gallery or SKU images changed after the immutable first readback", async () => {
  const fixture = fixtures.find((item) => item.channel === "lazada")!;
  const attackerUrls = lazadaProviderImages.map((_, index) =>
    `https://attacker.example.test/provider-image-${index + 1}.jpg`);
  const attacks = [
    {
      ...structuredClone(fixture.remoteData),
      data: {
        ...(structuredClone(fixture.remoteData).data as Record<string, unknown>),
        images: attackerUrls,
      },
    },
    {
      ...structuredClone(fixture.remoteData),
      data: {
        ...(structuredClone(fixture.remoteData).data as Record<string, unknown>),
        skus: [{
          ...((structuredClone(fixture.remoteData).data as Record<string, unknown>).skus as Array<Record<string, unknown>>)[0],
          Images: attackerUrls,
        }],
      },
    },
  ];
  const originalFetch = globalThis.fetch;
  try {
    for (const remoteData of attacks) {
      let mutationHooks = 0;
      globalThis.fetch = async () => Response.json(remoteData);
      const result = await executeServerlessGatewayProviderJob({
        job: job(fixture),
        signal: new AbortController().signal,
        hooks: {
          assertLeaseHealthy: async () => undefined,
          beginProviderMutation: async () => { mutationHooks += 1; },
          beginCredentialMutation: async () => { mutationHooks += 1; },
          stageCredentialRefresh: async () => { mutationHooks += 1; },
        },
      });
      assert.equal(result.ok, false);
      assert.equal("remoteState" in result ? Boolean(result.remoteState) : false, false);
      assert.equal("publicationFulfilled" in result ? result.publicationFulfilled : false, false);
      assert.equal(mutationHooks, 0);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("immutable approved source content cannot be replaced by an attacker-controlled first readback baseline", () => {
  const attackerUrls = detailUrls.map((url) => url.replace("sellerpilot.supabase.co", "attacker.example.test"));
  const poisoned = {
    ...qoo10Data,
    ResultObject: {
      ...qoo10Data.ResultObject,
      ItemTitle: "攻撃者が差し替えた商品名",
      ItemDetail: detailHtml("攻撃者が差し替えた商品説明と詳細情報です。", attackerUrls),
    },
  };
  const source = sourceResponse(fixtures[0]);
  const verification = verifyListingPublicationContent({
    channel: "qoo10",
    expectedLocale: "ja-JP",
    expectedImageCount: 8,
    remoteId: fixtures[0].remoteId,
    sourceArguments: fixtures[0].sourceArguments,
    sourceResponsePayload: source.sourceResponsePayload,
    sourceRemotePayload: poisoned,
    remotePayload: poisoned,
    remoteResources: fixtures[0].resources,
  });
  assert.equal(verification.verified, false);
  assert.equal(verification.titleVerified, false);
  assert.equal(verification.descriptionVerified, false);
  assert.equal(verification.approvedManifestDigestVerified, true);
  assert.equal(verification.detailImageCountVerified, false);
  assert.equal(verification.sourceDetailImageCount, 8);
  assert.equal(verification.sourceReadbackDetailImageCount, 8);
});

test("asset binding rejects an attacker host even when every normalized path and digest is self-consistent", () => {
  const malicious = structuredClone(assetBinding());
  for (const image of [...malicious.approvedDetailImages, ...malicious.providerTransportImages]) {
    image.publicUrl = image.publicUrl.replace("sellerpilot.supabase.co", "attacker.example");
  }
  assert.equal(parseListingPublicationAssetBinding(malicious), null);
});

test("every Coupang variant must expose the same ordered eight approved detail images", () => {
  const fixture = fixtures.find((item) => item.channel === "coupang")!;
  const multiVariantSourceArguments = structuredClone(fixture.sourceArguments);
  const sourceBody = multiVariantSourceArguments.body as Record<string, unknown>;
  const sourceItems = sourceBody.items as Array<Record<string, unknown>>;
  sourceItems.push({
    itemName: "한국어로 확인된 두 번째 판매 옵션",
    contents: structuredClone(coupangContents),
  });
  const multiVariantSourceReadback = structuredClone(coupangData);
  multiVariantSourceReadback.data.items.push({
    vendorItemId: 5555,
    itemName: "한국어로 확인된 두 번째 판매 옵션",
    contents: structuredClone(coupangContents),
  });
  const resources = { sellerProductId: "987654321", vendorItemIds: ["4444", "5555"] };
  const source = sourceContext({
    channel: "coupang",
    sourceArguments: multiVariantSourceArguments,
    sourceStepName: fixture.sourceStepName,
    sourceStepData: multiVariantSourceReadback,
    resources,
    remoteId: fixture.remoteId,
    locale: fixture.locale,
    market: fixture.market,
    targetId: fixture.targetId,
  });
  const missingSiblingImages = structuredClone(multiVariantSourceReadback);
  missingSiblingImages.data.items[1] = {
    ...missingSiblingImages.data.items[1],
    contents: [],
  };
  const verification = verifyListingPublicationContent({
    channel: "coupang",
    expectedLocale: "ko-KR",
    expectedImageCount: 8,
    remoteId: fixture.remoteId,
    sourceArguments: multiVariantSourceArguments,
    sourceResponsePayload: source.sourceResponsePayload,
    sourceRemotePayload: multiVariantSourceReadback,
    remotePayload: missingSiblingImages,
    remoteResources: resources,
  });
  assert.equal(verification.verified, false);
  assert.equal(verification.detailImageCountVerified, false);
  assert.equal(verification.descriptionVerified, false);
});

test("buyer-visible titles and provider-assigned identities are exact-bound for Coupang, SmartStore, and eBay", () => {
  const cases = [
    {
      fixture: fixtures.find((item) => item.channel === "coupang")!,
      sourceRemotePayload: coupangData,
      remotePayload: {
        ...coupangData,
        data: { ...coupangData.data, displayProductName: "공격자가 바꾼 노출 상품명" },
      },
      remoteResources: { sellerProductId: "987654321", vendorItemIds: ["4444"] },
    },
    {
      fixture: fixtures.find((item) => item.channel === "smartstore")!,
      sourceRemotePayload: smartstoreData,
      remotePayload: {
        ...smartstoreData,
        smartstoreChannelProduct: {
          ...smartstoreData.smartstoreChannelProduct,
          channelProductName: "공격자가 바꾼 채널 상품명",
        },
      },
      remoteResources: { originProductNo: "10000001", smartstoreChannelProductNo: "20000001" },
    },
    {
      fixture: fixtures.find((item) => item.channel === "ebay")!,
      sourceRemotePayload: { offer: ebayOffer, inventoryItem: ebayInventory },
      remotePayload: { offer: ebayOffer, inventoryItem: ebayInventory },
      remoteResources: {
        offerId: "offer-123",
        listingId: "110000000001",
        sku: "ATTACKER-SKU",
        marketplaceId: "EBAY_US",
      },
    },
  ];
  for (const attack of cases) {
    const source = sourceResponse(attack.fixture);
    const verification = verifyListingPublicationContent({
      channel: attack.fixture.channel,
      expectedLocale: attack.fixture.locale,
      expectedImageCount: 8,
      remoteId: attack.fixture.remoteId,
      sourceArguments: attack.fixture.sourceArguments,
      sourceResponsePayload: source.sourceResponsePayload,
      sourceRemotePayload: attack.sourceRemotePayload,
      remotePayload: attack.remotePayload,
      remoteResources: attack.remoteResources,
    });
    assert.equal(verification.verified, false, attack.fixture.channel);
  }
});

test("single-script-character and single-marker language spoofing fail closed", () => {
  const smartFixture = fixtures.find((item) => item.channel === "smartstore")!;
  const smartSource = structuredClone(smartFixture.sourceArguments);
  const smartBody = smartSource.body as Record<string, unknown>;
  const smartOrigin = smartBody.originProduct as Record<string, unknown>;
  const smartChannel = smartBody.smartstoreChannelProduct as Record<string, unknown>;
  smartOrigin.name = "English product 한";
  smartOrigin.detailContent = detailHtml("This product description is written entirely in English with quality details and information 한");
  smartChannel.channelProductName = smartOrigin.name;
  const smartRemote = {
    ...smartstoreData,
    originProduct: { ...smartstoreData.originProduct, name: smartOrigin.name, detailContent: smartOrigin.detailContent },
    smartstoreChannelProduct: { ...smartstoreData.smartstoreChannelProduct, channelProductName: smartOrigin.name },
  };
  const smartContext = sourceContext({
    channel: "smartstore",
    sourceArguments: smartSource,
    sourceStepName: "origin-product-publication-readback",
    sourceStepData: smartRemote,
    resources: smartFixture.resources,
    remoteId: smartFixture.remoteId,
    locale: smartFixture.locale,
    market: smartFixture.market,
    targetId: smartFixture.targetId,
  });
  const singleMarkerVerification = verifyListingPublicationContent({
    channel: "smartstore",
    expectedLocale: "ko-KR",
    expectedImageCount: 8,
    remoteId: smartFixture.remoteId,
    sourceArguments: smartSource,
    sourceResponsePayload: smartContext.sourceResponsePayload,
    sourceRemotePayload: smartRemote,
    remotePayload: smartRemote,
    remoteResources: smartFixture.resources,
  });
  assert.equal(singleMarkerVerification.languageContentVerified, false);

  const maskedTitleSource = structuredClone(smartFixture.sourceArguments);
  const maskedTitleBody = maskedTitleSource.body as Record<string, unknown>;
  const maskedTitleOrigin = maskedTitleBody.originProduct as Record<string, unknown>;
  const maskedTitleChannel = maskedTitleBody.smartstoreChannelProduct as Record<string, unknown>;
  maskedTitleOrigin.name = "Premium Cable Organizer ABC-100";
  maskedTitleChannel.channelProductName = maskedTitleOrigin.name;
  const maskedTitleRemote = {
    ...smartstoreData,
    originProduct: {
      ...smartstoreData.originProduct,
      name: maskedTitleOrigin.name,
      detailContent: maskedTitleOrigin.detailContent,
    },
    smartstoreChannelProduct: {
      ...smartstoreData.smartstoreChannelProduct,
      channelProductName: maskedTitleOrigin.name,
    },
  };
  const maskedTitleContext = sourceContext({
    channel: "smartstore",
    sourceArguments: maskedTitleSource,
    sourceStepName: "origin-product-publication-readback",
    sourceStepData: maskedTitleRemote,
    resources: smartFixture.resources,
    remoteId: smartFixture.remoteId,
    locale: smartFixture.locale,
    market: smartFixture.market,
    targetId: smartFixture.targetId,
  });
  const maskedTitleVerification = verifyListingPublicationContent({
    channel: "smartstore",
    expectedLocale: "ko-KR",
    expectedImageCount: 8,
    remoteId: smartFixture.remoteId,
    sourceArguments: maskedTitleSource,
    sourceResponsePayload: maskedTitleContext.sourceResponsePayload,
    sourceRemotePayload: maskedTitleRemote,
    remotePayload: maskedTitleRemote,
    remoteResources: smartFixture.resources,
  });
  assert.equal(maskedTitleVerification.titleLanguageVerified, false);
  assert.equal(maskedTitleVerification.descriptionLanguageVerified, true);
  assert.equal(maskedTitleVerification.languageContentVerified, false);

  const ebayFixture = fixtures.find((item) => item.channel === "ebay")!;
  const ebaySource = structuredClone(ebayFixture.sourceArguments);
  const inventory = ebaySource.inventoryItem as Record<string, unknown>;
  (inventory.product as Record<string, unknown>).title = "Artículo español product";
  (ebaySource.offer as Record<string, unknown>).listingDescription = detailHtml(
    "Este artículo tiene una descripción completa con información de calidad para compradores product",
  );
  const remoteOffer = { ...ebayOffer, listingDescription: (ebaySource.offer as Record<string, unknown>).listingDescription };
  const remoteInventory = { product: { ...ebayInventory.product, title: (inventory.product as Record<string, unknown>).title } };
  const ebayContext = sourceContext({
    channel: "ebay",
    sourceArguments: ebaySource,
    sourceStepName: "offer-publication-readback",
    sourceStepData: remoteOffer,
    resources: ebayFixture.resources,
    remoteId: ebayFixture.remoteId,
    locale: ebayFixture.locale,
    market: ebayFixture.market,
    targetId: ebayFixture.targetId,
    providerArguments: ebaySource,
  });
  assert.equal(verifyListingPublicationContent({
    channel: "ebay",
    expectedLocale: "en-US",
    expectedImageCount: 8,
    remoteId: ebayFixture.remoteId,
    sourceArguments: ebaySource,
    sourceResponsePayload: ebayContext.sourceResponsePayload,
    sourceRemotePayload: { offer: remoteOffer, inventoryItem: remoteInventory },
    remotePayload: { offer: remoteOffer, inventoryItem: remoteInventory },
    remoteResources: ebayFixture.resources,
  }).languageContentVerified, false);
});

test("normal concise English and Malay commerce copy passes without weakening isolated-marker attacks", () => {
  assert.equal(listingPublicationLanguageVerified(
    "en-US",
    "Ceramic espresso cup. Premium ceramic espresso cup. Durable glazed finish.",
  ), true);
  assert.equal(listingPublicationLanguageVerified(
    "en-SG",
    "Durable cable organizer clips keep charging cables tidy with an easy adhesive design.",
  ), true);
  assert.equal(listingPublicationLanguageVerified(
    "en-US",
    "Handwoven bamboo storage basket designed for closets and shelves.",
  ), true);
  assert.equal(listingPublicationLanguageVerified(
    "ms-MY",
    "Klip kabel yang tahan lama memastikan kabel kekal kemas dengan reka bentuk pelekat yang mudah digunakan.",
  ), true);
  assert.equal(listingPublicationLanguageVerified(
    "ms-MY",
    "Bakul simpanan buluh ini dianyam dengan tangan untuk kegunaan di dalam almari.",
  ), true);
  assert.equal(listingPublicationLanguageVerified(
    "en-US",
    "Este artículo tiene una descripción completa con información para compradores product item.",
  ), false);
  assert.equal(listingPublicationLanguageVerified(
    "en-US",
    "product item quality qzxwvu asdfgh jklmnb poiuyt rewqas zxcvbn",
  ), false);
  assert.equal(listingPublicationLanguageVerified(
    "en-US",
    "product item quality blorg snazzle frobnicate qwxz plmnr vxzq. tronk skelm prazzle nork.",
  ), false);
  assert.equal(listingPublicationLanguageVerified(
    "en-US",
    "product item quality durable blorg snazzle frobnicate qwxz. tronk skelm prazzle nork.",
  ), false);
  assert.equal(listingPublicationLanguageVerified(
    "ms-MY",
    "Barang ini memiliki deskripsi produk dengan informasi kualitas yang lengkap untuk pembeli.",
  ), false);
  assert.equal(listingPublicationLanguageVerified(
    "en-SG",
    "한국어로 작성된 상품 설명이며 사용법과 품질 정보를 자세히 안내합니다 product item.",
  ), false);
  assert.equal(listingPublicationLanguageVerified(
    "ko-KR",
    `${"가".repeat(30)} ${"a".repeat(60)}`,
  ), false);
  assert.equal(listingPublicationLanguageVerified(
    "th-TH",
    `${"ก".repeat(30)} ${"a".repeat(60)}`,
  ), false);
  assert.equal(listingPublicationLanguageVerified(
    "zh-CN",
    `${"商".repeat(40)} ${"a".repeat(60)}`,
  ), false);
  assert.equal(listingPublicationLanguageVerified(
    "ja-JP",
    "商品詳細説明情報品質使用販売価格配送商品詳細説明情報品質",
  ), false);
  assert.equal(listingPublicationLanguageVerified(
    "ja-JP",
    "商品詳細説明情報品質使用販売価格",
    "title",
  ), false);
  assert.equal(listingPublicationLanguageVerified(
    "ko-KR",
    "튼튼한 케이블 정리 클립으로 충전선을 깔끔하고 안전하게 정리할 수 있습니다.",
  ), true);
  assert.equal(listingPublicationLanguageVerified(
    "th-TH",
    "คลิปจัดสายเคเบิลที่ทนทานช่วยจัดสายชาร์จให้เรียบร้อยและใช้งานง่าย",
  ), true);
  assert.equal(listingPublicationLanguageVerified(
    "zh-CN",
    "耐用的电缆整理夹可以轻松整齐地固定充电线并保持桌面整洁",
  ), true);
  assert.equal(listingPublicationLanguageVerified(
    "ko-KR",
    "Apple AirPods 프로 2세대 무선 이어폰",
    "title",
  ), true);
  assert.equal(listingPublicationLanguageVerified(
    "ja-JP",
    "ケーブル整理クリップ 6個セット",
    "title",
  ), true);
  assert.equal(listingPublicationLanguageVerified(
    "en-US",
    "ACME X100 Durable Cable Organizer",
    "title",
  ), true);
  assert.equal(listingPublicationLanguageVerified(
    "en-US",
    "Handwoven Bamboo Storage Basket",
    "title",
  ), true);
  assert.equal(listingPublicationLanguageVerified(
    "ms-MY",
    "Cawan produk yang disahkan",
    "title",
  ), true);
  assert.equal(listingPublicationLanguageVerified(
    "ms-MY",
    "Bakul Simpanan Buluh Anyaman Tangan",
    "title",
  ), true);
  assert.equal(listingPublicationLanguageVerified(
    "ja-JP",
    "手編みの竹製収納バスケット",
    "title",
  ), true);
  assert.equal(listingPublicationLanguageVerified(
    "ja-JP",
    "手編みの竹製収納バスケットは丈夫で使いやすいです",
    "description",
  ), true);
  assert.equal(listingPublicationLanguageVerified(
    "en-US",
    "Producto con descripción información calidad",
    "title",
  ), false);
  assert.equal(listingPublicationLanguageVerified(
    "ms-MY",
    "Barang Deskripsi Informasi Kualitas",
    "title",
  ), false);
});

test("Qoo10 legacy Japanese fallback repair is strict, reviewed, and seller-title safe", () => {
  const legacyFallback = "buchakhyeong keibeul jeongri keulrip 6gae seteu - 購入前確認";
  assert.equal(listingPublicationLanguageVerified("ja-JP", legacyFallback, "title"), false);

  const reviewedTitle = repairLegacyQoo10JapaneseFallbackTitle(
    legacyFallback,
    "부착형 케이블 정리 클립 6개 세트",
  );
  assert.equal(reviewedTitle, "貼り付け式ケーブル整理クリップ6個セット");
  assert.equal(listingPublicationLanguageVerified("ja-JP", reviewedTitle, "title"), true);

  const alreadyValid = "ケーブル整理クリップ 6個セット";
  assert.equal(repairLegacyQoo10JapaneseFallbackTitle(alreadyValid), alreadyValid);

  const sellerFormatting = "  ＡＢＣ　ケーブルクリップ  ";
  assert.equal(repairLegacyQoo10JapaneseFallbackTitle(sellerFormatting), sellerFormatting);

  const sellerAuthoredHangul = "부착형 케이블 클립 - 購入前確認";
  assert.equal(
    repairLegacyQoo10JapaneseFallbackTitle(sellerAuthoredHangul, "부착형 케이블 정리 클립 6개 세트"),
    sellerAuthoredHangul,
  );

  const unknownProductFallback = repairLegacyQoo10JapaneseFallbackTitle(
    legacyFallback,
    "부착형 케이블 미등록품목 6개 세트",
  );
  assert.match(unknownProductFallback, /^販売者確認済み商品情報・購入前のご案内 - /u);
  assert.equal(listingPublicationLanguageVerified("ja-JP", unknownProductFallback, "title"), true);
});

test("read-only transport blocks mutation methods even on legitimate provider resource paths", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return Response.json({});
  };
  const attempts = [
    {
      fixture: fixtures.find((item) => item.channel === "coupang")!,
      execute: () => coupangRequest({
        payload: fixtures.find((item) => item.channel === "coupang")!.credential,
        method: "PUT",
        path: "/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/987654321",
        body: {},
      }),
    },
    {
      fixture: fixtures.find((item) => item.channel === "smartstore")!,
      execute: () => naverRequest({
        accessToken: "naver-access",
        method: "PUT",
        path: "/v2/products/origin-products/10000001",
        body: {},
      }),
    },
    {
      fixture: fixtures.find((item) => item.channel === "ebay")!,
      execute: () => ebayRequest({
        payload: fixtures.find((item) => item.channel === "ebay")!.credential,
        environment: "production",
        method: "POST",
        path: "/sell/inventory/v1/offer/offer-123/withdraw",
      }),
    },
    {
      fixture: fixtures.find((item) => item.channel === "ebay")!,
      execute: () => ebayTradingRequest({
        payload: fixtures.find((item) => item.channel === "ebay")!.credential,
        environment: "production",
        callName: "AddMemberMessageRTQ",
        marketplaceId: "EBAY_US",
        body: "<?xml version=\"1.0\" encoding=\"utf-8\"?><AddMemberMessageRTQRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\"><ItemID>110000000001</ItemID></AddMemberMessageRTQRequest>",
      }),
    },
    {
      fixture: fixtures.find((item) => item.channel === "temu")!,
      execute: () => temuRequest({
        payload: fixtures.find((item) => item.channel === "temu")!.credential,
        type: "bg.local.goods.sale.status.set",
        arguments: { goodsId: 88000001, onsale: 0, operationType: 1 },
      }),
    },
  ];
  try {
    for (const attempt of attempts) {
      let mutationHooks = 0;
      await assert.rejects(executeServerlessGatewayProviderJob({
        job: job(attempt.fixture),
        signal: new AbortController().signal,
        hooks: {
          assertLeaseHealthy: async () => undefined,
          beginProviderMutation: async () => { mutationHooks += 1; },
          beginCredentialMutation: async () => { mutationHooks += 1; },
          stageCredentialRefresh: async () => undefined,
        },
      }, async () => {
        await attempt.execute();
        throw new Error("mutation transport unexpectedly returned");
      }), /LISTING_PUBLICATION_VERIFY_NON_READ_TRANSPORT_BLOCKED/);
      assert.equal(mutationHooks, 0, attempt.fixture.channel);
    }
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("read-only publication verification never refreshes a near-expiry provider credential", async () => {
  const fixture = fixtures.find((item) => item.channel === "shopee")!;
  const staleJob = job(fixture);
  const staleAt = new Date(Date.now() + 60_000).toISOString();
  staleJob.credential.access_token_expires_at = staleAt;
  staleJob.credential.shopee_targets = (staleJob.credential.shopee_targets as Array<Record<string, unknown>>)
    .map((target) => ({ ...target, access_token_expires_at: staleAt }));
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  let mutationHooks = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return Response.json({});
  };
  try {
    await assert.rejects(executeServerlessGatewayProviderJob({
      job: staleJob,
      signal: new AbortController().signal,
      hooks: {
        assertLeaseHealthy: async () => undefined,
        beginProviderMutation: async () => { mutationHooks += 1; },
        beginCredentialMutation: async () => { mutationHooks += 1; },
        stageCredentialRefresh: async () => { mutationHooks += 1; },
      },
    }), /LISTING_PUBLICATION_VERIFY_CREDENTIAL_REFRESH_REQUIRED/);
    assert.equal(fetchCalls, 0);
    assert.equal(mutationHooks, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("eBay publication verification refuses token refresh before any provider read", async () => {
  const fixture = fixtures.find((item) => item.channel === "ebay")!;
  const staleJob = job(fixture);
  staleJob.credential.access_token_expires_at = new Date(Date.now() + 60_000).toISOString();
  Object.assign(staleJob.credential, {
    client_id: "ebay-client",
    client_secret: "ebay-secret",
    ru_name: "SellerPilot-RuName",
    refresh_token: "ebay-refresh",
  });
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  let mutationHooks = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return Response.json({});
  };
  try {
    await assert.rejects(executeServerlessGatewayProviderJob({
      job: staleJob,
      signal: new AbortController().signal,
      hooks: {
        assertLeaseHealthy: async () => undefined,
        beginProviderMutation: async () => { mutationHooks += 1; },
        beginCredentialMutation: async () => { mutationHooks += 1; },
        stageCredentialRefresh: async () => { mutationHooks += 1; },
      },
    }), /LISTING_PUBLICATION_VERIFY_CREDENTIAL_REFRESH_REQUIRED/);
    assert.equal(fetchCalls, 0);
    assert.equal(mutationHooks, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("publication reverification rejects a missing trusted source context before provider I/O", async () => {
  const fixture = fixtures[0];
  const invalidJob = job(fixture);
  const argumentsValue = invalidJob.request.arguments as Record<string, unknown>;
  delete argumentsValue.sellerpilotPublicationSource;
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  let mutationCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json(qoo10Data);
  };
  try {
    await assert.rejects(executeServerlessGatewayProviderJob({
      job: invalidJob,
      signal: new AbortController().signal,
      hooks: {
        assertLeaseHealthy: async () => undefined,
        beginProviderMutation: async () => { mutationCount += 1; },
        beginCredentialMutation: async () => { mutationCount += 1; },
        stageCredentialRefresh: async () => { mutationCount += 1; },
      },
    }), /LISTING_PUBLICATION_VERIFY_READ_ONLY_CONTEXT_REQUIRED/);
    assert.equal(fetchCount, 0);
    assert.equal(mutationCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the scheduled worker hydrates the immutable source by owned service RPC and executes the real provider verifier", async () => {
  const fixture = fixtures[0];
  const claimedJob = structuredClone(job(fixture));
  delete (claimedJob.request.arguments as Record<string, unknown>).sellerpilotPublicationSource;
  const rpcCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  let claimed = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(qoo10Data);
  try {
    const response = await runOneServerlessCsGatewayJob({
      rpc: async (name, arguments_ = {}) => {
        rpcCalls.push({ name, arguments: arguments_ });
        if (name === "sellerpilot_claim_serverless_gateway_job") {
          if (claimed) return { data: null, error: null };
          claimed = true;
          return { data: claimedJob, error: null };
        }
        if (name === "sellerpilot_touch_serverless_cs_job") {
          return { data: "running", error: null };
        }
        if (name === "sellerpilot_service_listing_publication_verification_source") {
          return { data: sourceResponse(fixture), error: null };
        }
        if (name === "sellerpilot_service_serverless_cs_completion_context") {
          return {
            data: {
              status: "running",
              channel: fixture.channel,
              operation: "listing.publication.verify",
              normalization_timestamp: "2026-08-30T00:00:00.000Z",
              publication_verification_boundary: "2026-08-30T00:00:00.000Z",
            },
            error: null,
          };
        }
        if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
          return { data: { status: "completed" }, error: null };
        }
        return { data: null, error: { code: "unexpected_rpc" } };
      },
    }, deriveServerlessCsGatewayCredentials(
      "scheduled-publication-verification-secret",
    ).gatewayTokenHash);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      status: "succeeded",
      claimed: 1,
      processed: 1,
      jobId: JOB_ID,
      channel: "qoo10",
      operation: "listing.publication.verify",
    });
    const sourceCall = rpcCalls.find(({ name }) =>
      name === "sellerpilot_service_listing_publication_verification_source");
    assert.deepEqual(sourceCall?.arguments, {
      p_token_hash: deriveServerlessCsGatewayCredentials(
        "scheduled-publication-verification-secret",
      ).gatewayTokenHash,
      p_job_id: JOB_ID,
      p_claim_token: CLAIM_TOKEN,
    });
    assert.equal(
      rpcCalls.some(({ name }) => name.includes("begin_serverless_gateway_provider_mutation")),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
