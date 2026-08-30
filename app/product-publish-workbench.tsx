"use client";

import { AlertTriangle, Check, CircleCheck, CirclePause, Code2, LoaderCircle, PackageCheck, RefreshCw, Rocket, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activeChannelKeys, channelCatalog, type ActiveChannelKey } from "../lib/channels/catalog";
import { elevenstSaleDateRange } from "../lib/channels/elevenst-listing";
import {
  marketplaceChannelDetailImageCount,
  marketplaceGeneratedAssetCount,
  marketplaceMinimumThumbnailCount,
} from "../lib/channels/marketplace-image-contract";
import {
  parseProductDetailImageManifest,
  productDetailImageCount,
} from "../lib/product-detail-image-manifest";
import {
  centralProductEditFieldSupport,
  channelProductEditFieldSupport,
  listingCoreContentForOperation,
  listingWriteOperation,
  prepareListingUpdateArguments,
  productEditFieldKeys,
  productEditRemotePlan,
} from "../lib/channels/listing-update";
import { marketplaceListingCurrency, marketplaceListingPrice, normalizeEbayAspects } from "../lib/channels/listing-normalization";
import {
  buildLazadaKrwMyrPricePolicy,
  lazadaKrwMyrPricePolicyFromArguments,
  type LazadaKrwMyrRateEvidence,
} from "../lib/channels/lazada-price-policy";
import { blockingListingRequirements, inspectListingDraft, listingDraftValue, setListingDraftValue } from "../lib/channels/listing-preflight";
import { channelOperationAvailable, channelOperationRelease } from "../lib/channels/operation-availability";
import { qoo10CatalogCode, qoo10ExpiryDate, qoo10PauseParams, qoo10ProductionPlaceFields, qoo10SellerCode } from "../lib/channels/qoo10";
import {
  buildLocalizedBudgetedPlainDetail,
  buildLocalizedPlainDetail,
  buildLocalizedRichDetail,
  buildLocalizedSectionBulletPoints,
  detailAssetOrderForChannel,
  galleryAssetOrderForChannel,
  localizedImageSeo,
  localizedSeoKeywords,
  normalizedLocalizedDetailSections,
  type LocalizedCreativeListing,
  type LocalizedDetailSection,
  type LocalizedProductClassification,
} from "../lib/marketplace-localized-content";
import { normalizeProductSaleConfiguration, productSaleConfigurations } from "../lib/product-sale-configuration";
import { createClient } from "../lib/supabase/client";
import { fetchChannelTargets } from "./channel-target-client";
import { channels } from "./channel-config";
import { createBoundedRequestSignal, waitForAbortablePromise } from "./operations-snapshot-request-coordinator";
import {
  channelTargetOptionValue,
  executeChannelWritesSequentially,
  isPublicationPendingReviewResponse,
  listingMutationGeneration,
  productEditSupportLabel,
  reconcileQueuedChannelResults,
  workbenchProductContextMatches,
  type WorkbenchChannelResult,
} from "./_publishing/workbench-release-safety";

type CredentialRow = {
  id: string;
  channel: ActiveChannelKey;
  environment: "sandbox" | "production";
  status: string;
};

type Assignment = {
  channel: ActiveChannelKey;
  market: string;
  categoryId: string;
  categoryPath: string[];
  providedAttributes: Record<string, string>;
  status: string;
  confirmedAt: string | null;
};

type Listing = {
  id: string;
  channel: ActiveChannelKey;
  market: string;
  targetId: string;
  remoteId: string | null;
  marketplaceSku?: string | null;
  status: string;
  lastError: string | null;
  failureClass?: "retryable" | "external_action" | null;
  publishedAt?: string | null;
  requestedPublicationIntent?: "safe_test" | "live" | null;
  remoteVisibility?: "unknown" | "non_public" | "pending_review" | "live" | "withdrawn" | "rejected" | null;
  operationAttemptId?: string | null;
};

type ChannelTarget = { targetId: string; displayName: string; marketCode: string; locale: string; language: string; currency: string; status?: string };
const ebayMarketplaceTargets: ChannelTarget[] = [
  { targetId: "EBAY_US", displayName: "United States", marketCode: "US", locale: "en-US", language: "English", currency: "USD" },
  { targetId: "EBAY_GB", displayName: "United Kingdom", marketCode: "GB", locale: "en-GB", language: "English", currency: "GBP" },
  { targetId: "EBAY_DE", displayName: "Deutschland", marketCode: "DE", locale: "de-DE", language: "Deutsch", currency: "EUR" },
  { targetId: "EBAY_AU", displayName: "Australia", marketCode: "AU", locale: "en-AU", language: "English", currency: "AUD" },
  { targetId: "EBAY_CA", displayName: "Canada", marketCode: "CA", locale: "en-CA", language: "English", currency: "CAD" },
  { targetId: "EBAY_FR", displayName: "France", marketCode: "FR", locale: "fr-FR", language: "Français", currency: "EUR" },
  { targetId: "EBAY_IT", displayName: "Italia", marketCode: "IT", locale: "it-IT", language: "Italiano", currency: "EUR" },
  { targetId: "EBAY_ES", displayName: "España", marketCode: "ES", locale: "es-ES", language: "Español", currency: "EUR" },
  { targetId: "EBAY_AT", displayName: "Österreich", marketCode: "AT", locale: "de-AT", language: "Deutsch", currency: "EUR" },
  { targetId: "EBAY_BE", displayName: "België", marketCode: "BE", locale: "nl-BE", language: "Nederlands", currency: "EUR" },
  { targetId: "EBAY_CH", displayName: "Schweiz", marketCode: "CH", locale: "de-CH", language: "Deutsch", currency: "CHF" },
  { targetId: "EBAY_HK", displayName: "Hong Kong", marketCode: "HK", locale: "zh-HK", language: "繁體中文", currency: "HKD" },
  { targetId: "EBAY_IE", displayName: "Ireland", marketCode: "IE", locale: "en-IE", language: "English", currency: "EUR" },
  { targetId: "EBAY_NL", displayName: "Nederland", marketCode: "NL", locale: "nl-NL", language: "Nederlands", currency: "EUR" },
  { targetId: "EBAY_PL", displayName: "Polska", marketCode: "PL", locale: "pl-PL", language: "Polski", currency: "PLN" },
];
type LocalizedListing = LocalizedCreativeListing & { channel: ActiveChannelKey; market: string; locale: string; detailSections?: LocalizedDetailSection[] };
type PackageFields = { weight: number; length: number; width: number; height: number };
const publishContextRequestTimeoutMs = 30_000;
type ManualFields = {
  productName: string;
  description: string;
  sellerSku: string;
  categoryHint: string;
  brandName: string;
  manufacturer: string;
  countryOfOrigin: string;
  material: string;
  packageContents: string;
  condition: "NEW" | "USED" | "REFURBISHED";
  gtinStatus: "HAS_GTIN" | "NO_GTIN";
  gtin: string;
  sellingPrice: number;
  currency: string;
  stock: number;
  weightKg: number;
  packageLengthCm: number;
  packageWidthCm: number;
  packageHeightCm: number;
};

type PublishContext = {
  product: {
    id: string;
    externalCode: string;
    sku: string;
    name: string;
    description: string;
    sourceUrl: string | null;
    status: string;
    classification?: LocalizedProductClassification;
  };
  classification?: LocalizedProductClassification;
  manualFields: ManualFields;
  imageSpecs: Array<{ role: string; width: number; height: number; bytes: number; mediaType: string; fit: string }>;
  assignments: Assignment[];
  listings: Listing[];
  sourceImages: Array<{ path: string; url: string | null }>;
  generatedImages: Array<{ id: string; path: string; url: string | null }>;
  localizedListings: LocalizedListing[];
  detailPage?: {
    version?: number;
    approvedVersion?: number;
    imageManifest?: unknown;
  };
  contentMode?: "ai_generated" | "manual_mvp";
};

type ChannelResult = WorkbenchChannelResult;
type ChannelOperationResponse = {
  ok?: boolean;
  message?: string;
  safeMessage?: string;
  remoteId?: string;
  attemptId?: string;
  listingId?: string;
  inProgress?: boolean;
  retrySafe?: boolean;
  manualRequired?: boolean;
  reconciliationRequired?: boolean;
  publicationPending?: boolean;
  publicationIntent?: "safe_test" | "live";
  publicationFulfilled?: boolean;
  remoteState?: {
    visibility?: "unknown" | "non_public" | "pending_review" | "live" | "withdrawn" | "rejected";
    providerStatus?: string;
    locale?: string;
  };
};
type ConfirmationRequest =
  | { kind: "bulk" }
  | { kind: "channel"; channel: ActiveChannelKey }
  | { kind: "qoo10-stop"; listing: Listing };

const productEditFieldLabels = {
  productName: "상품명",
  description: "설명",
  options: "옵션",
  saleConfiguration: "판매 구성",
  requiredInformation: "필수정보",
  images: "이미지",
  price: "가격",
  inventory: "재고",
} as const;

export function normalizeManualFields(context: PublishContext): ManualFields {
  const value = context.manualFields ?? {} as ManualFields;
  return {
    productName: value.productName || context.product.name,
    description: value.description || context.product.description,
    sellerSku: value.sellerSku || context.product.sku,
    categoryHint: value.categoryHint || context.product.name,
    brandName: value.brandName?.trim() ?? "",
    manufacturer: value.manufacturer || "",
    countryOfOrigin: value.countryOfOrigin || "",
    material: value.material || "",
    packageContents: normalizeProductSaleConfiguration(value.packageContents),
    condition: value.condition || "NEW",
    gtinStatus: value.gtinStatus || "NO_GTIN",
    gtin: value.gtin || "",
    sellingPrice: Number(value.sellingPrice) || 2500,
    currency: value.currency || "JPY",
    stock: Number.isInteger(Number(value.stock)) && Number(value.stock) >= 0 ? Number(value.stock) : 1,
    weightKg: Number(value.weightKg) || 0.35,
    packageLengthCm: Number(value.packageLengthCm) || 12,
    packageWidthCm: Number(value.packageWidthCm) || 12,
    packageHeightCm: Number(value.packageHeightCm) || 10,
  };
}

function uniqueUrls(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim() ?? "").filter((value) => value.startsWith("https://")))];
}

function englishEbayMaterial(value: string) {
  const normalized = value.trim();
  const translations: Record<string, string> = {
    "도자기": "Ceramic",
    "세라믹": "Ceramic",
    "유리": "Glass",
    "스테인리스": "Stainless Steel",
    "스테인리스 스틸": "Stainless Steel",
    "플라스틱": "Plastic",
    "실리콘": "Silicone",
    "나무": "Wood",
    "목재": "Wood",
    "가죽": "Leather",
    "합성가죽": "Faux Leather",
    "면": "Cotton",
    "폴리에스터": "Polyester",
  };
  return translations[normalized] ?? normalized;
}

export function buildChannelArguments(channel: ActiveChannelKey, context: PublishContext, price: number, quantity: number, target: ChannelTarget | undefined, packageFields: PackageFields, globalBaseUsdPrice: number, lazadaMyrRate?: LazadaKrwMyrRateEvidence | null) {
  const assignment = context.assignments.find((item) => item.channel === channel && item.status === "confirmed" && (!target || item.market === target.marketCode));
  const existingListing = context.listings.find((item) => item.channel === channel && (!target || item.market === target.marketCode && item.targetId === target.targetId));
  const operation = listingWriteOperation(existingListing);
  const lazadaPricePolicy = channel === "lazada"
    && operation === "listing.update"
    && context.manualFields.currency.trim().toUpperCase() === "KRW"
    && target?.currency.trim().toUpperCase() === "MYR"
    && lazadaMyrRate
    ? buildLazadaKrwMyrPricePolicy({
        sourcePriceKrw: price,
        rate: lazadaMyrRate,
      })
    : null;
  const channelPrice = lazadaPricePolicy?.targetPriceMyr
    ?? marketplaceListingPrice(channel, price, { globalBaseUsdPrice, targetCurrency: target?.currency });
  const product = context.product;
  const listingMarket = target?.marketCode ?? ({ qoo10: "JP", coupang: "KR", elevenst: "KR", smartstore: "KR", ebay: "US", temu: "KR", shopee: "SG", lazada: "MY" } as const)[channel];
  const localized = context.localizedListings?.find((item) => item.channel === channel && item.market === listingMarket);
  const coreContent = listingCoreContentForOperation({
    operation,
    central: { title: context.manualFields.productName || product.name, description: context.manualFields.description || product.description },
    localized,
  });
  const writeListing: LocalizedListing | undefined = operation === "listing.update"
    ? { ...(localized ?? { channel, market: listingMarket, locale: target?.locale ?? "", keywords: [], title: "", shortDescription: "", description: "" }), ...coreContent }
    : localized;
  const classification = writeListing?.classification ?? context.classification ?? product.classification;
  const localizedDetailSections = normalizedLocalizedDetailSections(writeListing);
  const manualMvp = context.contentMode === "manual_mvp";
  const generatedImage = (id: string) => context.generatedImages.find((item) => item.id === id)?.url;
  const galleryAssetIds = galleryAssetOrderForChannel(channel);
  const galleryImageUrls = uniqueUrls([
    generatedImage(galleryAssetIds[0]),
    ...context.sourceImages.map((item) => item.url),
    ...galleryAssetIds.slice(1).map(generatedImage),
  ]);
  const imageSeo = localizedImageSeo(writeListing, channel, coreContent.title);
  const dedicatedDetailImageRoles = detailAssetOrderForChannel(channel, writeListing);
  const dedicatedDetailImageUrls = dedicatedDetailImageRoles.map(generatedImage);
  const classificationReady = Boolean(classification?.displayName?.trim()
    && classification.evidence?.trim()
    && ["verified", "needs-review"].includes(classification.verificationStatus));
  const dedicatedDetailReady = classificationReady
    && localizedDetailSections.length === marketplaceChannelDetailImageCount
    && dedicatedDetailImageRoles.length === marketplaceChannelDetailImageCount
    && uniqueUrls(dedicatedDetailImageUrls).length === dedicatedDetailImageRoles.length;
  const detailImageUrls = uniqueUrls(manualMvp
    ? galleryImageUrls
    : dedicatedDetailReady
      ? dedicatedDetailImageUrls
      : [generatedImage("portrait"), generatedImage("wide"), generatedImage("hero")]);
  const sourceImage = galleryImageUrls[0] ?? "";
  const sellerpilotAssets = {
    contentMode: manualMvp ? "manual_mvp" : "ai_generated",
    galleryImageUrls,
    detailImageUrls,
    detailImageRoles: dedicatedDetailReady ? imageSeo.detailImageRoles : [],
    detailImageAltTexts: dedicatedDetailReady ? imageSeo.detailImageAltTexts : [],
    thumbnailAltText: imageSeo.thumbnailAltText,
    localizedDetailSections,
    classification,
    detailAssetMode: manualMvp ? "manual_source" : dedicatedDetailReady ? "dedicated" : "legacy_fallback",
    integrationRevision: "marketplace-write-v4-evidence-detail",
  };
  const manual = context.manualFields;
  const { title, description, shortDescription } = coreContent;
  const richDescription = buildLocalizedRichDetail(writeListing, title, description, { classification });
  const plainDescription = buildLocalizedPlainDetail(writeListing, title, description, { classification });
  const shopeePlainDescription = buildLocalizedBudgetedPlainDetail(writeListing, title, description, 3_000, { classification });
  const temuPlainDescription = buildLocalizedBudgetedPlainDetail(writeListing, title, description, 10_000, { classification });
  const temuBulletPoints = buildLocalizedSectionBulletPoints(writeListing, 700);
  const seoKeywords = localizedSeoKeywords(writeListing);
  const marketSku = target ? `${manual.sellerSku || product.sku}-${target.marketCode}`.slice(0, 100) : manual.sellerSku || product.sku;
  if (channel === "qoo10") {
    const productionPlace = qoo10ProductionPlaceFields(manual.countryOfOrigin);
    return {
      sellerpilotAssets: { ...sellerpilotAssets, integrationRevision: "itemscontents-v3-evidence-detail" },
      params: {
        SecondSubCat: assignment?.categoryId ?? "",
        OuterSecondSubCat: "",
        Drugtype: "",
        ManufactureNo: qoo10CatalogCode(assignment?.providedAttributes.ManufactureNo),
        BrandNo: qoo10CatalogCode(assignment?.providedAttributes.BrandNo),
        ItemTitle: title.slice(0, 100),
        PromotionName: shortDescription.slice(0, 20),
        SellerCode: qoo10SellerCode(product.sku, existingListing?.status !== "published" ? existingListing?.remoteId ?? undefined : undefined),
        IndustrialCode: manual.gtinStatus === "HAS_GTIN" ? manual.gtin : "",
        IndustrialCodeType: manual.gtinStatus === "HAS_GTIN" ? "J" : "",
        ...productionPlace,
        AdultYN: "N",
        ContactTel: "",
        StandardImage: sourceImage,
        ItemDescription: richDescription,
        AdditionalOption: "",
        ItemType: "",
        RetailPrice: String(channelPrice),
        ItemPrice: String(channelPrice),
        TaxRate: "S",
        ItemQty: String(quantity),
        ExpireDate: qoo10ExpiryDate(),
        ShippingNo: "0",
        AvailableDateType: "0",
        AvailableDateValue: "3",
        Keyword: seoKeywords.join(",").slice(0, 300),
      },
    };
  }
  if (channel === "shopee") {
    const attributeList = Object.entries(assignment?.providedAttributes ?? {}).map(([attribute_id, original_value_name]) => ({
      attribute_id: Number(attribute_id),
      attribute_value_list: /^\d+$/.test(original_value_name) ? [{ value_id: Number(original_value_name) }] : [{ original_value_name }],
    }));
    const commonProductFields = {
      category_id: Number(assignment?.categoryId ?? 0),
      description: shopeePlainDescription,
      brand: { brand_id: 0, original_brand_name: manual.brandName },
      condition: manual.condition,
      gtin_code: manual.gtinStatus === "HAS_GTIN" ? manual.gtin : "00",
      normal_stock: quantity,
      seller_stock: [{ stock: quantity }],
      image: { image_id_list: [] },
      weight: packageFields.weight,
      dimension: { package_length: packageFields.length, package_width: packageFields.width, package_height: packageFields.height },
      pre_order: { is_pre_order: false, days_to_ship: 1 },
      attribute_list: attributeList,
    };
    const globalSku = `${manual.sellerSku || product.sku}-GLOBAL`.slice(0, 100);
    return {
      sellerpilotAssets,
      globalProduct: true,
      shopId: target?.targetId ?? "",
      country: target?.marketCode.toLowerCase() ?? "",
      imageUrls: galleryImageUrls,
      body: {
        ...commonProductFields,
        original_price: globalBaseUsdPrice,
        global_item_name: title.slice(0, 120),
        global_item_sku: globalSku,
      },
      publish: {
        shop_id: Number(target?.targetId ?? 0),
        shop_region: target?.marketCode ?? "",
        item: {
          ...commonProductFields,
          original_price: channelPrice,
          item_name: title.slice(0, 120),
          item_sku: marketSku,
          item_status: "UNLIST",
          logistic: [],
        },
      },
    };
  }
  if (channel === "lazada") {
    const providedAttributes = Object.fromEntries(
      Object.entries(assignment?.providedAttributes ?? {})
        .filter(([, value]) => value.trim().length > 0),
    );
    return {
      sellerpilotAssets,
      ...(operation === "listing.update" ? {
          sellerpilotLazadaPricePolicyRequired: true,
          ...(lazadaPricePolicy ? { sellerpilotLazadaPricePolicy: lazadaPricePolicy } : {}),
        } : {}),
      country: target?.marketCode.toLowerCase() ?? "my",
      imageUrls: galleryImageUrls,
      request: {
        Request: {
          Product: {
            PrimaryCategory: assignment?.categoryId ?? "",
            Images: { Image: galleryImageUrls },
            // Category metadata contains many empty optional fields and can also
            // repeat core fields such as `name` and `description`. Keep only
            // selected values, then make the listing's verified core content
            // authoritative so an empty category field cannot blank the title.
            Attributes: { ...providedAttributes, name: title.slice(0, 255), description: richDescription, short_description: shortDescription.slice(0, 500), brand: manual.brandName },
            Skus: { Sku: [{ SellerSku: marketSku, price: String(channelPrice), quantity: String(quantity), package_weight: String(packageFields.weight), package_length: String(packageFields.length), package_width: String(packageFields.width), package_height: String(packageFields.height), package_content: title.slice(0, 255), Status: "active", Images: { Image: galleryImageUrls } }] },
          },
        },
      },
    };
  }
  if (channel === "coupang") {
    const categoryAttributes = Object.entries(assignment?.providedAttributes ?? {}).map(([attributeTypeName, attributeValueName]) => ({
      attributeTypeName,
      attributeValueName,
    }));
    return {
      sellerpilotAssets,
      ...(existingListing?.remoteId && existingListing.status !== "published" ? { resumeRemoteId: existingListing.remoteId } : {}),
      facts: {
        material: manual.material,
        packageContents: manual.packageContents,
        countryOfOrigin: manual.countryOfOrigin,
        manufacturer: manual.manufacturer,
        weightKg: packageFields.weight,
        dimensionsCm: [packageFields.length, packageFields.width, packageFields.height],
      },
      body: {
        displayCategoryCode: Number(assignment?.categoryId ?? 0),
        sellerProductName: title.slice(0, 100),
        displayProductName: title.slice(0, 100),
        vendorId: "SERVER_MANAGED",
        saleStartedAt: "",
        saleEndedAt: "",
        brand: manual.brandName,
        generalProductName: manual.categoryHint,
        deliveryMethod: "SEQUENCIAL",
        deliveryCompanyCode: "",
        deliveryChargeType: "FREE",
        deliveryCharge: 0,
        freeShipOverAmount: 0,
        deliveryChargeOnReturn: 0,
        returnCharge: 0,
        outboundShippingPlaceCode: "",
        returnCenterCode: "",
        returnChargeName: "",
        companyContactNumber: "",
        returnZipCode: "",
        returnAddress: "",
        returnAddressDetail: "",
        requested: false,
        items: [{ itemName: title.slice(0, 100), originalPrice: channelPrice, salePrice: channelPrice, maximumBuyCount: quantity, maximumBuyForPerson: quantity, maximumBuyForPersonPeriod: 1, outboundShippingTimeDay: 3, unitCount: 1, adultOnly: "EVERYONE", taxType: "TAX", parallelImported: "NOT_PARALLEL_IMPORTED", overseasPurchased: "NOT_OVERSEAS_PURCHASED", pccNeeded: false, externalVendorSku: manual.sellerSku || product.sku, barcode: manual.gtinStatus === "HAS_GTIN" ? manual.gtin : "", emptyBarcode: manual.gtinStatus === "NO_GTIN", emptyBarcodeReason: manual.gtinStatus === "NO_GTIN" ? "바코드가 없는 상품" : "", modelNo: manual.sellerSku || product.sku, images: galleryImageUrls.map((url, index) => ({ imageOrder: index, imageType: index === 0 ? "REPRESENTATION" : "DETAIL", vendorPath: url })), notices: [], attributes: categoryAttributes, contents: [{ contentsType: "TEXT", contentDetails: [{ content: plainDescription, detailType: "TEXT" }] }] }],
      },
    };
  }
  if (channel === "elevenst") {
    // This exact non-regulated contract has a successful create/readback for
    // the official cable-organizer leaf. Other categories remain intentionally
    // incomplete until their own category metadata is verified.
    const verifiedCableOrganizerContract = assignment?.categoryId === "1341821";
    const notificationItems = verifiedCableOrganizerContract ? [
      { code: "11800", name: title.slice(0, 100) },
      { code: "11905", name: manual.manufacturer },
      { code: "23760413", name: "11번가 판매자 문의 이용" },
      { code: "23759100", name: manual.countryOfOrigin },
      { code: "23756033", name: "해당사항 없음" },
    ] : [];
    const saleDateRange = elevenstSaleDateRange();
    return {
      sellerpilotAssets,
      product: {
        selMthdCd: "01",
        dispCtgrNo: assignment?.categoryId ?? "",
        prdTypCd: "01",
        prdNm: title.slice(0, 100),
        brand: manual.brandName.trim(),
        rmaterialTypCd: "04",
        orgnTypCd: "03",
        orgnNmVal: manual.countryOfOrigin,
        sellerPrdCd: (manual.sellerSku || product.sku).slice(0, 50),
        suplDtyfrPrdClfCd: "01",
        forAbrdBuyClf: "01",
        prdStatCd: manual.condition === "NEW" ? "01" : "02",
        minorSelCnYn: "Y",
        prdImage01: sourceImage,
        prdImage02: galleryImageUrls[1] ?? "",
        prdImage03: galleryImageUrls[2] ?? "",
        prdImage04: galleryImageUrls[3] ?? "",
        htmlDetail: richDescription,
        ProductCertGroup: verifiedCableOrganizerContract ? [
          // This verified non-regulated category has no certificate. Sending a made-up
          // certTypeCd makes 11st validate it as a real certificate and reject it.
          { crtfGrpTypCd: "01", crtfGrpObjClfCd: "03" },
          { crtfGrpTypCd: "02", crtfGrpObjClfCd: "03" },
          { crtfGrpTypCd: "03", crtfGrpObjClfCd: "03" },
          { crtfGrpTypCd: "04", crtfGrpObjClfCd: "05" },
        ] : [],
        selPrdClfCd: "3y:110",
        ...saleDateRange,
        selPrc: String(Math.max(10, Math.round(channelPrice / 10) * 10)),
        prdSelQty: String(quantity),
        dlvCnAreaCd: "01",
        dlvWyCd: "01",
        dlvCstInstBasiCd: "01",
        bndlDlvCnYn: "Y",
        dlvCstPayTypCd: "03",
        rtngdDlvCst: "0",
        exchDlvCst: "0",
        asDetail: "11번가 판매자 문의를 이용해 주세요.",
        rtngExchDetail: "11번가 반품·교환 정책을 확인해 주세요.",
        ProductNotification: { type: verifiedCableOrganizerContract ? "891045" : "", item: notificationItems },
      },
    };
  }
  if (channel === "smartstore") {
    return {
      sellerpilotAssets,
      imageUrls: galleryImageUrls,
      body: {
        originProduct: {
          statusType: "SALE",
          saleType: "NEW",
          leafCategoryId: assignment?.categoryId ?? "",
          name: title,
          detailContent: richDescription,
          images: { representativeImage: { url: "PROGRAM_UPLOAD_PENDING" }, optionalImages: [] },
          salePrice: channelPrice,
          stockQuantity: quantity,
          detailAttribute: { minorPurchasable: true, productInfoProvidedNotice: { productInfoProvidedNoticeType: "ETC", etc: { returnCostReason: "상품상세 참조", noRefundReason: "상품상세 참조", qualityAssuranceStandard: "상품상세 참조", compensationProcedure: "상품상세 참조", troubleShootingContents: "상품상세 참조", itemName: title.slice(0, 50), modelName: (manual.sellerSku || product.sku).slice(0, 50), certificateDetails: "해당사항 없음", manufacturer: manual.manufacturer.slice(0, 200), customerServicePhoneNumber: "SERVER_MANAGED" } }, afterServiceInfo: { afterServiceTelephoneNumber: "SERVER_MANAGED", afterServiceGuideContent: "SERVER_MANAGED" }, originAreaInfo: { originAreaCode: "04", content: manual.countryOfOrigin }, sellerCodeInfo: { sellerManagementCode: manual.sellerSku || product.sku }, optionInfo: {}, supplementaryProductInfo: {}, purchaseReviewInfo: { purchaseReviewExposure: true } },
          customerBenefit: {},
        },
        smartstoreChannelProduct: { naverShoppingRegistration: true, channelProductName: title, channelProductDisplayStatusType: "ON" },
      },
    };
  }
  if (channel === "temu") {
    const externalGoodsId = (manual.sellerSku || product.sku).slice(0, 128);
    return {
      sellerpilotAssets,
      body: {
        language: "ko",
        goodsBasic: {
          externalGoodsId,
          goodsName: title.slice(0, 500),
          extCatName: (assignment?.categoryPath.join(" > ") || manual.categoryHint).slice(0, 500),
          goodsDesc: temuPlainDescription,
          goodsCarouselImage: galleryImageUrls.slice(0, 10),
          detailImage: detailImageUrls.slice(0, 10),
          productType: 1,
          bulletPoints: (temuBulletPoints.length ? temuBulletPoints : [description]).slice(0, 10),
        },
        attributes: [
          { name: "Brand", value: [manual.brandName] },
          { name: "Manufacturer", value: [manual.manufacturer] },
          { name: "Country of origin", value: [manual.countryOfOrigin] },
          { name: "Material", value: [manual.material] },
        ],
        skuList: [{
          externalSkuId: externalGoodsId,
          images: galleryImageUrls.slice(0, 10),
          price: { basePrice: { amount: String(channelPrice), currency: manual.currency || "KRW" } },
          quantity,
          packageInfo: { weight: String(Math.round(packageFields.weight * 1_000)), length: String(packageFields.length), width: String(packageFields.width), height: String(packageFields.height) },
          variations: [{ name: "Type", value: "Standard" }],
          ...(manual.gtinStatus === "HAS_GTIN" && manual.gtin ? { barCode: { barCodeType: "GTIN-14", barCodeId: [manual.gtin] } } : {}),
        }],
      },
    };
  }
  return {
    sellerpilotAssets,
    // eBay Inventory Items and Offers must reference the exact same SKU.
    // Keep it market-specific so a later country listing cannot collide with US.
    sku: marketSku,
    inventoryItem: { availability: { shipToLocationAvailability: { quantity } }, condition: manual.condition, product: { title: title.slice(0, 80), description: richDescription, imageUrls: galleryImageUrls, brand: manual.brandName, mpn: marketSku, aspects: normalizeEbayAspects({ ...(assignment?.providedAttributes ?? {}), Material: englishEbayMaterial(assignment?.providedAttributes.Material || manual.material), "Country/Region of Manufacture": manual.countryOfOrigin }) } },
    offer: { sku: marketSku, marketplaceId: target?.targetId ?? "EBAY_US", format: "FIXED_PRICE", availableQuantity: quantity, categoryId: assignment?.categoryId ?? "", listingDescription: richDescription, listingPolicies: { fulfillmentPolicyId: "SERVER_MANAGED", paymentPolicyId: "SERVER_MANAGED", returnPolicyId: "SERVER_MANAGED" }, merchantLocationKey: "SERVER_MANAGED", pricingSummary: { price: { value: String(channelPrice), currency: target?.currency ?? "USD" } } },
    publish: true,
  };
}

export function missingNativeValues(channel: ActiveChannelKey, value: Record<string, unknown>) {
  const json = JSON.stringify(value);
  const assets = value.sellerpilotAssets && typeof value.sellerpilotAssets === "object" && !Array.isArray(value.sellerpilotAssets)
    ? value.sellerpilotAssets as Record<string, unknown>
    : {};
  const galleryImages = Array.isArray(assets.galleryImageUrls) ? assets.galleryImageUrls.filter(Boolean) : [];
  const detailImages = Array.isArray(assets.detailImageUrls) ? assets.detailImageUrls.filter(Boolean) : [];
  const manualMvp = assets.contentMode === "manual_mvp" && assets.detailAssetMode === "manual_source";
  const assetRequirements = [
    galleryImages.length === 0 ? "marketplace thumbnail image" : "",
    manualMvp
      ? detailImages.length === 0 ? "manual source detail image" : ""
      : assets.detailAssetMode !== "dedicated" || detailImages.length < marketplaceChannelDetailImageCount
        ? `dedicated marketplace detail images (${marketplaceChannelDetailImageCount})`
        : "",
  ].filter(Boolean);
  if (channel === "qoo10") {
    const params = value.params as Record<string, unknown> | undefined;
    return [...assetRequirements, ...["SecondSubCat", "ItemTitle", "StandardImage", "ItemDescription", "ItemPrice", "ItemQty", "ShippingNo", "AvailableDateType", "AvailableDateValue"]
      .filter((key) => params?.[key] === undefined || String(params[key]).trim() === "")];
  }
  if (channel === "shopee") {
    const body = value.body && typeof value.body === "object" && !Array.isArray(value.body) ? value.body as Record<string, unknown> : {};
    const packageWeight = Number(body.weight);
    return [...assetRequirements,
      !String(value.shopId ?? "").trim() ? "shopId" : "",
      !Array.isArray(value.imageUrls) || value.imageUrls.length === 0 ? "source imageUrls" : "",
      !Number.isFinite(packageWeight) || packageWeight <= 0 ? "package weight" : "",
    ].filter(Boolean);
  }
  if (channel === "lazada") return [
    ...assetRequirements,
    !Array.isArray(value.imageUrls) || value.imageUrls.length === 0 ? "source imageUrls" : "",
    json.includes('"package_weight":"0"') || json.includes('"package_weight":""') ? "package size/weight" : "",
    value.sellerpilotLazadaPricePolicyRequired === true
      && !lazadaKrwMyrPricePolicyFromArguments(value)
      ? "verified KRW to MYR price policy"
      : "",
  ].filter(Boolean);
  if (channel === "coupang") return [...assetRequirements, json.includes('"displayCategoryCode":0') ? "displayCategoryCode" : "", !json.includes('"vendorPath":"https://') ? "public product image" : ""].filter(Boolean);
  if (channel === "elevenst") return [...assetRequirements, !json.includes('"prdImage01":"https://') ? "public product image" : "", json.includes('"dispCtgrNo":""') ? "dispCtgrNo" : "", !json.includes('"ProductNotification"') ? "ProductNotification" : ""].filter(Boolean);
  if (channel === "smartstore") return [...assetRequirements, !Array.isArray(value.imageUrls) || value.imageUrls.length === 0 ? "source imageUrls" : "", !json.includes('"originAreaCode":"04"') ? "originAreaInfo" : ""].filter(Boolean);
  if (channel === "temu") return [...assetRequirements, json.includes('"skuList":[]') ? "skuList" : "", json.includes('"images":[]') ? "images" : "", json.includes('"externalGoodsId":""') ? "externalGoodsId" : ""].filter(Boolean);
  return [...assetRequirements, json.includes('"fulfillmentPolicyId":""') ? "business policy IDs" : "", json.includes('"merchantLocationKey":""') ? "merchantLocationKey" : ""].filter(Boolean);
}

function parseDraft(value: string | undefined) {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function fingerprint(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).slice(0, 12).map((item) => item.toString(16).padStart(2, "0")).join("");
}

export async function remoteEditMutationId(value: unknown) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))).slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (item) => item.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function lazadaMyrRateFromSnapshot(value: unknown): LazadaKrwMyrRateEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  const rates = Array.isArray(snapshot.rates) ? snapshot.rates : [];
  const rows = rates.filter((rate): rate is Record<string, unknown> => Boolean(rate && typeof rate === "object" && !Array.isArray(rate)));
  const myrRows = rows.filter((rate) => rate.code === "MYR");
  const myr = myrRows[0];
  const unit = Number(myr?.unit);
  const valueKrw = Number(myr?.value);
  const fetchedAt = typeof snapshot.fetchedAt === "string" ? snapshot.fetchedAt : "";
  const asOf = typeof snapshot.asOf === "string" ? snapshot.asOf : "";
  const frequency = snapshot.frequency === "minute-market" || snapshot.frequency === "daily-reference-fallback"
    ? snapshot.frequency
    : null;
  const source = typeof snapshot.source === "string" ? snapshot.source.trim() : "";
  const sourceUrl = typeof snapshot.sourceUrl === "string" ? snapshot.sourceUrl.trim() : "";
  if (myrRows.length !== 1
      || !Number.isFinite(unit) || unit <= 0
      || !Number.isFinite(valueKrw) || valueKrw <= 0
      || Number.isNaN(new Date(fetchedAt).getTime())
      || Number.isNaN(new Date(asOf).getTime())
      || !frequency || !source || !sourceUrl.startsWith("https://")) return null;
  return {
    krwPerMyr: valueKrw / unit,
    fetchedAt: new Date(fetchedAt).toISOString(),
    asOf: new Date(asOf).toISOString(),
    source,
    sourceUrl,
    frequency,
  };
}

function buildDraftMap(context: PublishContext, price: number, quantity: number, targets: Partial<Record<ActiveChannelKey, ChannelTarget>>, packageFields: PackageFields, globalBaseUsdPrice: number, lazadaMyrRate?: LazadaKrwMyrRateEvidence | null) {
  return Object.fromEntries(activeChannelKeys.map((channel) => [
    channel,
    JSON.stringify(buildChannelArguments(channel, context, price, quantity, targets[channel], packageFields, globalBaseUsdPrice, lazadaMyrRate), null, 2),
  ]));
}

type ProductPublishWorkbenchProps = {
  productId: string | null;
  selectedChannels: string[];
  refreshVersion: number;
  notify: (message: string) => void;
  onChanged?: () => void;
};

export function ProductPublishWorkbench(props: ProductPublishWorkbenchProps) {
  return <ProductPublishWorkbenchSession key={props.productId ?? "no-product"} {...props} />;
}

function ProductPublishWorkbenchSession({ productId, selectedChannels, refreshVersion, notify, onChanged }: ProductPublishWorkbenchProps) {
  const [context, setContext] = useState<PublishContext | null>(null);
  const [credentials, setCredentials] = useState<CredentialRow[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<ActiveChannelKey, string>>>({});
  const [results, setResults] = useState<Partial<Record<ActiveChannelKey, ChannelResult>>>({});
  const [availableTargets, setAvailableTargets] = useState<Partial<Record<"shopee" | "lazada" | "ebay", ChannelTarget[]>>>({});
  const [selectedTargets, setSelectedTargets] = useState<Partial<Record<ActiveChannelKey, ChannelTarget>>>({});
  const [price, setPrice] = useState(2500);
  const [globalBaseUsdPrice, setGlobalBaseUsdPrice] = useState(12.9);
  const [lazadaMyrRate, setLazadaMyrRate] = useState<LazadaKrwMyrRateEvidence | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [currency, setCurrency] = useState("JPY");
  const [packageFields, setPackageFields] = useState<PackageFields>({ weight: 0.35, length: 12, width: 12, height: 10 });
  const [loading, setLoading] = useState(Boolean(productId));
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [confirmingChannel, setConfirmingChannel] = useState<ActiveChannelKey | null>(null);
  const [qoo10StopConfirming, setQoo10StopConfirming] = useState<Listing | null>(null);
  const priceRef = useRef(price);
  const globalBaseUsdPriceRef = useRef(globalBaseUsdPrice);
  const lazadaMyrRateRef = useRef<LazadaKrwMyrRateEvidence | null>(lazadaMyrRate);
  const quantityRef = useRef(quantity);
  const packageFieldsRef = useRef(packageFields);
  const confirmationDialogRef = useRef<HTMLDivElement | null>(null);
  const confirmationOpenerRef = useRef<HTMLElement | null>(null);
  const loadGenerationRef = useRef(0);
  const loadRequestRef = useRef<{ generation: number; controller: AbortController } | null>(null);
  const sessionProductIdRef = useRef(productId);
  const writeRequestControllersRef = useRef(new Set<AbortController>());
  const mutationGenerationRef = useRef(new Map<string, string>());
  const mountedRef = useRef(true);
  const confirmationOpen = bulkConfirming || confirmingChannel !== null || qoo10StopConfirming !== null;
  const centralEditFieldSupport = useMemo(() => centralProductEditFieldSupport(), []);
  const marketplaceThumbnailCount = context?.generatedImages.filter((item) => (item.id === "square" || item.id === "hero") && item.url).length ?? 0;
  const dedicatedDetailImageCount = context?.generatedImages.filter((item) => item.id.startsWith("detail-") && item.url).length ?? 0;
  const manualMvp = context?.contentMode === "manual_mvp";
  const approvedDetailManifest = parseProductDetailImageManifest(context?.detailPage?.imageManifest);
  const approvedDetailPageReady = Boolean(context
    && approvedDetailManifest
    && context.detailPage?.version === context.detailPage?.approvedVersion
    && approvedDetailManifest.images.length === productDetailImageCount
    && approvedDetailManifest.images.every((entry) => context.generatedImages.some((image) => image.id === entry.role && image.path === entry.path && Boolean(image.url))));
  const imagePackageReady = Boolean(context
    && !manualMvp
    && marketplaceThumbnailCount >= marketplaceMinimumThumbnailCount
    && approvedDetailPageReady);
  const imagePackageBlockedMessage = manualMvp
    ? "승인된 상세페이지 이미지 8장이 없는 직접등록 상품은 판매채널 자동 전송을 시작하지 않습니다."
    : `채널 업로드 이미지가 미완료입니다. 대표 ${marketplaceThumbnailCount}/${marketplaceMinimumThumbnailCount}장과 저장·승인된 상세페이지 8/8장을 모두 확인한 뒤 실행해 주세요.`;

  useEffect(() => {
    mountedRef.current = true;
    const writeControllers = writeRequestControllersRef.current;
    const mutationGenerations = mutationGenerationRef.current;
    return () => {
      mountedRef.current = false;
      loadRequestRef.current?.controller.abort(new DOMException("상품 등록 준비 화면이 닫혔습니다.", "AbortError"));
      loadRequestRef.current = null;
      for (const controller of writeControllers) {
        controller.abort(new DOMException("상품 등록 준비 화면이 닫혔습니다.", "AbortError"));
      }
      writeControllers.clear();
      mutationGenerations.clear();
      loadGenerationRef.current += 1;
    };
  }, []);

  const closeConfirmation = useCallback(() => {
    setBulkConfirming(false);
    setConfirmingChannel(null);
    setQoo10StopConfirming(null);
    const opener = confirmationOpenerRef.current;
    confirmationOpenerRef.current = null;
    window.requestAnimationFrame(() => {
      if (opener?.isConnected && !(opener instanceof HTMLButtonElement && opener.disabled)) opener.focus();
    });
  }, []);

  const openConfirmation = useCallback((request: ConfirmationRequest) => {
    confirmationOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBulkConfirming(request.kind === "bulk");
    setConfirmingChannel(request.kind === "channel" ? request.channel : null);
    setQoo10StopConfirming(request.kind === "qoo10-stop" ? request.listing : null);
  }, []);

  useEffect(() => {
    if (!confirmationOpen) return;
    const focusFrame = window.requestAnimationFrame(() => {
      const dialog = confirmationDialogRef.current;
      const preferred = dialog?.querySelector<HTMLButtonElement>(".credential-secondary");
      const fallback = dialog?.querySelector<HTMLButtonElement>("button");
      (preferred ?? fallback ?? dialog)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeConfirmation();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeConfirmation, confirmationOpen]);

  const load = useCallback(async () => {
    loadRequestRef.current?.controller.abort(new DOMException("더 최신 상품 등록 준비 요청으로 교체되었습니다.", "AbortError"));
    if (!productId) {
      loadRequestRef.current = null;
      setContext(null);
      setLoading(false);
      return;
    }
    const requestedProductId = productId;
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    const controller = new AbortController();
    loadRequestRef.current = { generation, controller };
    const bounded = createBoundedRequestSignal(
      controller.signal,
      publishContextRequestTimeoutMs,
      "상품 등록 준비 정보 조회가 30초를 초과했습니다. 다시 확인해 주세요.",
    );
    const isLatestRequest = () => mountedRef.current
      && loadRequestRef.current?.generation === generation
      && sessionProductIdRef.current === requestedProductId;
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: sessionData } = await waitForAbortablePromise(supabase.auth.getSession(), bounded.signal);
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("상품 등록 준비 정보를 보려면 다시 로그인해 주세요.");
      const [contextResponse, credentialsResponse, shopeeTargetsResponse, lazadaTargetsResponse, exchangeRatesResponse] = await Promise.all([
        waitForAbortablePromise(fetch(`/api/admin/products/${productId}/publish-context`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: bounded.signal }), bounded.signal),
        waitForAbortablePromise(supabase.rpc("sellerpilot_list_credentials").abortSignal(bounded.signal), bounded.signal),
        fetchChannelTargets("shopee", accessToken, { signal: bounded.signal }),
        fetchChannelTargets("lazada", accessToken, { signal: bounded.signal }),
        waitForAbortablePromise(
          fetch("/api/exchange-rates", { cache: "no-store", signal: bounded.signal })
            .catch((error) => {
              if (bounded.signal.aborted) throw error;
              return new Response("{}", { status: 502, headers: { "content-type": "application/json" } });
            }),
          bounded.signal,
        ),
      ]);
      const payload = await waitForAbortablePromise(
        contextResponse.json().catch(() => ({ message: "상품 준비 응답을 읽지 못했습니다." })),
        bounded.signal,
      ) as PublishContext & { message?: string };
      if (!contextResponse.ok) throw new Error(payload.message ?? "상품 등록 준비 정보를 불러오지 못했습니다.");
      const nextPayload = { ...payload, manualFields: normalizeManualFields(payload), imageSpecs: Array.isArray(payload.imageSpecs) ? payload.imageSpecs : [] };
      if (nextPayload.product.id !== requestedProductId) {
        throw new Error("요청한 상품과 등록 준비 원장이 일치하지 않습니다.");
      }
      const [shopeePayload, lazadaPayload, exchangeRatesPayload] = await Promise.all([
        waitForAbortablePromise(shopeeTargetsResponse.json().catch(() => ({ targets: [] })), bounded.signal),
        waitForAbortablePromise(lazadaTargetsResponse.json().catch(() => ({ targets: [] })), bounded.signal),
        waitForAbortablePromise(exchangeRatesResponse.json().catch(() => ({})), bounded.signal),
      ]) as [{ targets?: ChannelTarget[] }, { targets?: ChannelTarget[] }, Record<string, unknown>];
      const shopeeTargets = shopeeTargetsResponse.ok && Array.isArray(shopeePayload.targets) ? shopeePayload.targets : [];
      const lazadaTargets = lazadaTargetsResponse.ok && Array.isArray(lazadaPayload.targets) ? lazadaPayload.targets : [];
      const nextLazadaMyrRate = exchangeRatesResponse.ok
        ? lazadaMyrRateFromSnapshot(exchangeRatesPayload)
        : null;
      const initialTargets: Partial<Record<ActiveChannelKey, ChannelTarget>> = { shopee: shopeeTargets[0], lazada: lazadaTargets[0], ebay: ebayMarketplaceTargets[0] };
      const manual = nextPayload.manualFields;
      const initialPrice = manual.sellingPrice;
      const initialQuantity = manual.stock;
      const initialPackage = { weight: manual.weightKg, length: manual.packageLengthCm, width: manual.packageWidthCm, height: manual.packageHeightCm };
      if (!isLatestRequest() || bounded.signal.aborted) return;
      priceRef.current = initialPrice;
      quantityRef.current = initialQuantity;
      packageFieldsRef.current = initialPackage;
      setPrice(initialPrice);
      setQuantity(initialQuantity);
      setCurrency(manual.currency);
      setPackageFields(initialPackage);
      lazadaMyrRateRef.current = nextLazadaMyrRate;
      setLazadaMyrRate(nextLazadaMyrRate);
      if (manual.currency === "USD") {
        globalBaseUsdPriceRef.current = initialPrice;
        setGlobalBaseUsdPrice(initialPrice);
      }
      setContext(nextPayload);
      setCredentials(Array.isArray(credentialsResponse.data) ? credentialsResponse.data as CredentialRow[] : []);
      setAvailableTargets({ shopee: shopeeTargets, lazada: lazadaTargets, ebay: ebayMarketplaceTargets });
      setSelectedTargets(initialTargets);
      setDrafts(buildDraftMap(nextPayload, initialPrice, initialQuantity, initialTargets, initialPackage, manual.currency === "USD" ? initialPrice : globalBaseUsdPriceRef.current, nextLazadaMyrRate));
    } catch (error) {
      if (!isLatestRequest() || controller.signal.aborted) return;
      notify(error instanceof Error ? error.message : "상품 등록 준비 정보를 불러오지 못했습니다.");
    } finally {
      bounded.dispose();
      if (isLatestRequest()) {
        loadRequestRef.current = null;
        setLoading(false);
      }
    }
  }, [notify, productId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshVersion]);

  const queuedResultSignature = useMemo(() => [
    ...Object.entries(results)
      .flatMap(([channel, result]) => result?.phase === "queued"
        ? [`result:${channel}:${result.attemptId ?? "unknown"}:${result.market ?? ""}:${result.targetId ?? ""}`]
        : []),
    ...(context?.listings ?? [])
      .filter((listing) => ["queued", "publishing"].includes(listing.status))
      .map((listing) => `ledger:${listing.channel}:${listing.operationAttemptId ?? "unknown"}:${listing.market}:${listing.targetId}`),
  ].sort().join("|"), [context?.listings, results]);

  const fetchQueuedListings = useCallback(async (requestedProductId: string, parentSignal: AbortSignal) => {
    const bounded = createBoundedRequestSignal(
      parentSignal,
      15_000,
      "상품 등록 진행 상태 확인이 15초를 초과했습니다.",
    );
    try {
      const supabase = createClient();
      const accessToken = (await waitForAbortablePromise(supabase.auth.getSession(), bounded.signal)).data.session?.access_token;
      if (!accessToken) return null;
      const response = await waitForAbortablePromise(fetch(`/api/admin/products/${requestedProductId}/publish-context`, {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal: bounded.signal,
      }), bounded.signal);
      if (!response.ok) return null;
      const payload = await waitForAbortablePromise(
        response.json().catch(() => null),
        bounded.signal,
      ) as { listings?: Listing[] } | null;
      return Array.isArray(payload?.listings) ? payload.listings : null;
    } finally {
      bounded.dispose();
    }
  }, []);

  useEffect(() => {
    if (!queuedResultSignature || !productId) return;
    const requestedProductId = productId;
    const controller = new AbortController();
    let pollCount = 0;
    let timer = 0;
    const isCurrentProduct = () => mountedRef.current
      && !controller.signal.aborted
      && sessionProductIdRef.current === requestedProductId;
    const poll = async () => {
      pollCount += 1;
      const listings = await fetchQueuedListings(requestedProductId, controller.signal).catch(() => null);
      if (!isCurrentProduct()) return;
      if (listings) {
        setContext((current) => current?.product.id === requestedProductId ? { ...current, listings } : current);
        setResults((current) => reconcileQueuedChannelResults(current, listings));
      }
      if (pollCount >= 60) {
        setResults((current) => Object.fromEntries(Object.entries(current).map(([channel, result]) => [
          channel,
          result?.phase === "queued"
            ? { ...result, message: "백그라운드 작업은 계속 보호 중입니다. 등록 진행 현황에서 완료·수동 확인 상태를 확인해 주세요." }
            : result,
        ])));
        return;
      }
      timer = window.setTimeout(() => void poll(), 5_000);
    };
    timer = window.setTimeout(() => void poll(), 3_000);
    return () => {
      controller.abort(new DOMException("상품 등록 진행 상태 확인을 종료했습니다.", "AbortError"));
      window.clearTimeout(timer);
    };
  }, [fetchQueuedListings, productId, queuedResultSignature]);

  const activeCredentials = useMemo(() => new Map(
    credentials
      .filter((item) => item.status === "active" && item.environment === "production")
      .map((item) => [item.channel, item]),
  ), [credentials]);
  const visibleChannels = useMemo(() => activeChannelKeys.filter((channel) => selectedChannels.includes(channel)), [selectedChannels]);

  const updateProductFact = (key: "brandName" | "manufacturer" | "countryOfOrigin" | "material" | "packageContents", value: string) => {
    if (!context) return;
    const nextContext = { ...context, manualFields: { ...context.manualFields, [key]: value } };
    setContext(nextContext);
    setDrafts(buildDraftMap(nextContext, priceRef.current, quantityRef.current, selectedTargets, packageFieldsRef.current, globalBaseUsdPriceRef.current, lazadaMyrRateRef.current));
  };

  const updateManualDraftField = (channel: ActiveChannelKey, path: string[], value: string) => {
    const parsed = parseDraft(drafts[channel]);
    if (!parsed) return;
    setDrafts((current) => ({
      ...current,
      [channel]: JSON.stringify(setListingDraftValue(parsed, path, value), null, 2),
    }));
  };

  const executeChannel = async (channel: ActiveChannelKey, options: { skipConfirm?: boolean; accessToken?: string; deferRefresh?: boolean } = {}) => {
    if (!productId || !context || !workbenchProductContextMatches(productId, context.product.id)) {
      notify("선택한 상품의 등록 준비 정보를 다시 확인해 주세요.");
      return false;
    }
    if (!imagePackageReady) {
      notify(imagePackageBlockedMessage);
      return false;
    }
    const credential = activeCredentials.get(channel);
    const target = selectedTargets[channel];
    const assignment = context.assignments.find((item) => item.channel === channel && item.status === "confirmed" && (!target || item.market === target.marketCode));
    const listing = context.listings.find((item) => item.channel === channel && (!target || item.market === target.marketCode && item.targetId === target.targetId));
    const operation = listingWriteOperation(listing);
    if (listing && ["queued", "publishing"].includes(listing.status)) {
      notify(`${channelCatalog[channel].name} 상품 작업이 이미 백그라운드에서 진행 중입니다.`);
      return false;
    }
    if (listing?.failureClass === "external_action") {
      notify(`${channelCatalog[channel].name} 원격 상태를 수동 확인하기 전에는 새 상품 작업을 실행할 수 없습니다.`);
      return false;
    }
    if (listing?.requestedPublicationIntent === "live" && listing.remoteVisibility === "pending_review") {
      notify(`${channelCatalog[channel].name} 상품은 판매채널 심사 중입니다. 공개 게시가 확인될 때까지 새 등록을 실행하지 않습니다.`);
      return false;
    }
    if (!credential || !assignment) {
      notify(`${channelCatalog[channel].name} 활성 키와 확정 카테고리를 확인해 주세요.`);
      return false;
    }
    if (!channelOperationAvailable(channel, operation)) {
      notify(`${channelCatalog[channel].name} ${operation === "listing.update" ? "상품 콘텐츠 수정" : "상품 등록"}은 원격 식별값과 조회 검증이 완료되기 전까지 실행할 수 없습니다.`);
      return false;
    }
    let channelArguments: Record<string, unknown>;
    try {
      channelArguments = JSON.parse(drafts[channel] ?? "{}") as Record<string, unknown>;
    } catch {
      notify(`${channelCatalog[channel].name} 등록 JSON 형식을 확인해 주세요.`);
      return false;
    }
    const missing = [
      ...missingNativeValues(channel, channelArguments),
      ...blockingListingRequirements(channel, channelArguments).map((item) => item.label),
    ].filter((value, index, values) => values.indexOf(value) === index);
    if (missing.length) {
      notify(`${channelCatalog[channel].name} 필수값 보완: ${missing.join(", ")}`);
      return false;
    }
    if (operation === "listing.update") {
      if (!listing) return false;
      try {
        channelArguments = prepareListingUpdateArguments(channel, channelArguments, listing);
      } catch {
        notify(`${channelCatalog[channel].name} 게시 상품의 원격 ID를 확인하지 못해 수정을 차단했습니다.`);
        return false;
      }
    }
    const listingCurrency = marketplaceListingCurrency(channel, target?.currency);
    const operationPrice = marketplaceListingPrice(channel, price, { globalBaseUsdPrice, targetCurrency: target?.currency });
    const operationMarket = target?.marketCode ?? (channel === "qoo10" ? "JP" : "");
    if (!options.skipConfirm) {
      openConfirmation({ kind: "channel", channel });
      return false;
    }
    closeConfirmation();

    const requestedProductId = productId;
    const writeController = new AbortController();
    writeRequestControllersRef.current.add(writeController);
    const boundedWrite = createBoundedRequestSignal(
      writeController.signal,
      65_000,
      "판매채널 응답 확인이 65초를 초과했습니다. 같은 요청 식별자로 상태를 다시 확인해 주세요.",
    );
    const isCurrentProduct = () => mountedRef.current
      && !writeController.signal.aborted
      && sessionProductIdRef.current === requestedProductId;
    const mutationScope = `${requestedProductId}:${channel}:${listing?.id ?? `create:${operationMarket}:${target?.targetId ?? ""}`}`;
    const retryGeneration = listingMutationGeneration(listing, mutationGenerationRef.current.get(mutationScope));
    mutationGenerationRef.current.set(mutationScope, retryGeneration);
    const publicationIntent = operation === "listing.create"
      ? "live" as const
      : listing?.requestedPublicationIntent;
    const runningResult: ChannelResult = {
      phase: "running",
      operation,
      listingId: listing?.id,
      market: operationMarket,
      targetId: target?.targetId ?? "",
      mutationGeneration: retryGeneration,
    };
    setResults((current) => ({ ...current, [channel]: runningResult }));
    try {
      const accessToken = options.accessToken ?? (await waitForAbortablePromise(createClient().auth.getSession(), boundedWrite.signal)).data.session?.access_token;
      if (!accessToken) throw new Error("관리자 로그인이 필요합니다.");
      const mutationContract = {
        operation,
        publicationIntent,
        market: operationMarket || "default",
        targetId: target?.targetId ?? "",
        channelArguments,
        listingCurrency,
        price: operationPrice,
        retryGeneration,
      };
      const response = operation === "listing.update" && listing
        ? await waitForAbortablePromise(fetch(`/api/admin/products/${requestedProductId}/remote-edit`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
            signal: boundedWrite.signal,
            body: JSON.stringify({
              credentialId: credential.id,
              listingId: listing.id,
              mutationId: await remoteEditMutationId(mutationContract),
              operation,
              confirmWrite: true,
              arguments: channelArguments,
            }),
          }), boundedWrite.signal)
        : await waitForAbortablePromise(fetch("/api/admin/channel-operations", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
            signal: boundedWrite.signal,
            body: JSON.stringify({
              credentialId: credential.id,
              channel,
              operation,
              publicationIntent: "live",
              idempotencyKey: `listing:${requestedProductId}:${channel}:${await fingerprint(mutationContract)}`,
              confirmWrite: true,
              productId: requestedProductId,
              currency: listingCurrency,
              price: operationPrice,
              market: operationMarket,
              targetId: target?.targetId ?? "",
              arguments: channelArguments,
            }),
          }), boundedWrite.signal);
      const payload = await waitForAbortablePromise(
        response.json().catch(() => ({ message: "채널 응답을 읽지 못했습니다." })),
        boundedWrite.signal,
      ) as ChannelOperationResponse;
      if (!isCurrentProduct()) {
        onChanged?.();
        return false;
      }
      if (isPublicationPendingReviewResponse(response.status, payload)) {
        const providerStatus = payload.remoteState?.providerStatus?.trim();
        const providerMessage = payload.safeMessage ?? payload.message;
        const message = `판매채널 접수는 완료됐지만 아직 심사 중${providerStatus ? ` (${providerStatus})` : ""}이며 공개 게시 성공에는 포함되지 않습니다.${providerMessage ? ` · ${providerMessage}` : ""}`;
        setResults((current) => ({
          ...current,
          [channel]: {
            ...runningResult,
            phase: "pending_review",
            message,
            remoteId: payload.remoteId,
            attemptId: payload.attemptId,
            listingId: payload.listingId ?? listing?.id,
          },
        }));
        notify(`${channelCatalog[channel].name}: 심사 대기 · 공개 게시 성공 0건 · ${message}`);
        if (!options.deferRefresh && isCurrentProduct()) {
          await load();
          onChanged?.();
        }
        return false;
      }
      if (response.status === 202 && payload.inProgress === true) {
        const message = payload.message ?? "판매채널 작업이 계속 진행 중입니다. 완료 상태를 확인할 때까지 같은 원격 작업을 다시 실행하지 않습니다.";
        if (!payload.attemptId) {
          const untrackedMessage = `${message} 작업 추적 ID가 없어 자동 완료로 판단하지 않으며, 재시도해도 같은 요청 식별자를 유지합니다.`;
          setResults((current) => ({
            ...current,
            [channel]: { ...runningResult, phase: "failed", message: untrackedMessage },
          }));
          notify(`${channelCatalog[channel].name}: ${untrackedMessage}`);
          if (!options.deferRefresh && isCurrentProduct()) await load();
          onChanged?.();
          return false;
        }
        setResults((current) => ({
          ...current,
          [channel]: {
            ...runningResult,
            phase: "queued",
            message,
            attemptId: payload.attemptId,
            listingId: payload.listingId ?? listing?.id,
          },
        }));
        notify(`${channelCatalog[channel].name}: ${message}`);
        if (!options.deferRefresh && isCurrentProduct()) {
          await load();
          onChanged?.();
        }
        return false;
      }
      if (payload.manualRequired === true || payload.reconciliationRequired === true) {
        const message = payload.message ?? "원격 판매자센터 상태를 수동 확인한 뒤 작업을 조정해야 합니다.";
        setResults((current) => ({ ...current, [channel]: { ...runningResult, phase: "blocked", message, attemptId: payload.attemptId, listingId: payload.listingId ?? listing?.id } }));
        notify(`${channelCatalog[channel].name}: ${message}`);
        if (!options.deferRefresh && isCurrentProduct()) {
          await load();
          onChanged?.();
        }
        return false;
      }
      if (!response.ok || payload.ok !== true) throw Object.assign(new Error(payload.message ?? payload.safeMessage ?? `상품 ${operation === "listing.update" ? "콘텐츠 수정" : "등록"}이 실패했습니다.`), { attemptId: payload.attemptId });
      setResults((current) => ({ ...current, [channel]: { ...runningResult, phase: "succeeded", message: payload.safeMessage, remoteId: payload.remoteId, attemptId: payload.attemptId, listingId: payload.listingId ?? listing?.id } }));
      notify(`${channelCatalog[channel].name} 상품 ${operation === "listing.update" ? "콘텐츠 수정" : "등록"} 성공 · 원격 ID ${payload.remoteId ?? listing?.remoteId ?? "응답 확인 필요"}`);
      if (!options.deferRefresh && isCurrentProduct()) {
        await load();
        onChanged?.();
      }
      return true;
    } catch (error) {
      if (!isCurrentProduct()) {
        onChanged?.();
        return false;
      }
      const attemptId = error && typeof error === "object" && "attemptId" in error && typeof error.attemptId === "string" ? error.attemptId : undefined;
      const message = error instanceof Error ? error.message : `상품 ${operation === "listing.update" ? "콘텐츠 수정" : "등록"}이 실패했습니다.`;
      setResults((current) => ({ ...current, [channel]: { ...runningResult, phase: "failed", message, attemptId } }));
      notify(`${channelCatalog[channel].name}: ${message}`);
      if (!options.deferRefresh && isCurrentProduct()) {
        await load();
        onChanged?.();
      }
      return false;
    } finally {
      boundedWrite.dispose();
      writeRequestControllersRef.current.delete(writeController);
    }
  };

  const executeReadyChannels = async (confirmed = false) => {
    if (bulkRunning) return;
    if (!productId || !context || !workbenchProductContextMatches(productId, context.product.id)) {
      notify("선택한 상품의 등록 준비 정보를 다시 확인해 주세요.");
      return;
    }
    if (!imagePackageReady) {
      notify(imagePackageBlockedMessage);
      return;
    }
    const requestedProductId = productId;
    const readyChannels = visibleChannels.filter((channel) => {
      const credential = activeCredentials.get(channel);
      const target = selectedTargets[channel];
      const assignment = context.assignments.find((item) => item.channel === channel && item.status === "confirmed" && (!target || item.market === target.marketCode));
      const listing = context.listings.find((item) => item.channel === channel && (!target || item.market === target.marketCode && item.targetId === target.targetId));
      const operation = listingWriteOperation(listing);
      const parsedDraft = parseDraft(drafts[channel]);
      const hasMissingRequired = !parsedDraft || blockingListingRequirements(channel, parsedDraft).length > 0 || missingNativeValues(channel, parsedDraft).length > 0;
      const remoteIdentityReady = operation === "listing.create" || Boolean(listing?.remoteId);
      return Boolean(imagePackageReady
        && channelOperationAvailable(channel, operation)
        && credential
        && assignment
        && remoteIdentityReady
        && !hasMissingRequired
        && !["queued", "publishing"].includes(listing?.status ?? "")
        && !(listing?.requestedPublicationIntent === "live" && listing.remoteVisibility === "pending_review")
        && !["queued", "running", "pending_review", "blocked"].includes(results[channel]?.phase ?? "idle")
        && listing?.failureClass !== "external_action");
    }).slice(0, 8);
    if (!readyChannels.length) return notify("활성 키·확정 카테고리·검증된 원격 ID가 모두 준비된 등록·수정 대상 채널이 없습니다.");
    if (!confirmed) {
      openConfirmation({ kind: "bulk" });
      return;
    }
    closeConfirmation();
    setBulkRunning(true);
    try {
      const { data: sessionData } = await createClient().auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("관리자 로그인이 필요합니다.");
      const completed = await executeChannelWritesSequentially(
        readyChannels,
        (channel) => executeChannel(channel, { skipConfirm: true, accessToken, deferRefresh: true }),
      );
      const succeeded = completed.filter(Boolean).length;
      if (sessionProductIdRef.current === requestedProductId) await load();
      onChanged?.();
      if (sessionProductIdRef.current === requestedProductId) {
        notify(`채널 등록·수정 순차 처리 완료 · 공개 게시 성공 ${succeeded}개 / 심사·확인 필요 ${readyChannels.length - succeeded}개`);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "순차 채널 등록을 완료하지 못했습니다.");
    } finally {
      setBulkRunning(false);
    }
  };

  const stopQoo10Listing = async (listing: Listing) => {
    const credential = activeCredentials.get("qoo10");
    if (!productId || !context || !workbenchProductContextMatches(productId, context.product.id)) {
      return notify("선택한 상품의 등록 준비 정보를 다시 확인해 주세요.");
    }
    if (!credential || !listing.remoteId) return notify("Qoo10 활성 키와 원격 상품번호를 확인해 주세요.");
    const requestedProductId = productId;
    const writeController = new AbortController();
    writeRequestControllersRef.current.add(writeController);
    const boundedWrite = createBoundedRequestSignal(
      writeController.signal,
      65_000,
      "Qoo10 판매 중지 응답 확인이 65초를 초과했습니다. 진행 현황을 확인해 주세요.",
    );
    const isCurrentProduct = () => mountedRef.current
      && !writeController.signal.aborted
      && sessionProductIdRef.current === requestedProductId;
    const runningResult: ChannelResult = {
      phase: "running",
      operation: "listing.stop",
      message: "Qoo10 거래대기 전환 요청 중",
      listingId: listing.id,
      market: listing.market,
      targetId: listing.targetId,
    };
    closeConfirmation();
    setResults((current) => ({ ...current, qoo10: runningResult }));
    try {
      const accessToken = (await waitForAbortablePromise(createClient().auth.getSession(), boundedWrite.signal)).data.session?.access_token;
      if (!accessToken) throw new Error("관리자 로그인이 필요합니다.");
      const response = await waitForAbortablePromise(fetch("/api/admin/channel-operations", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        signal: boundedWrite.signal,
        body: JSON.stringify({
          credentialId: credential.id,
          channel: "qoo10",
          operation: "listing.stop",
          idempotencyKey: `listing-stop:${requestedProductId}:qoo10:${listing.id}:${listing.remoteId}:status-1`,
          confirmWrite: true,
          productId: requestedProductId,
          resourceListingId: listing.id,
          market: listing.market,
          targetId: listing.targetId,
          arguments: { params: qoo10PauseParams(listing.remoteId) },
        }),
      }), boundedWrite.signal);
      const payload = await waitForAbortablePromise(
        response.json().catch(() => ({ message: "Qoo10 판매 중지 응답을 읽지 못했습니다." })),
        boundedWrite.signal,
      ) as ChannelOperationResponse;
      if (!isCurrentProduct()) return;
      if (response.status === 202 && payload.inProgress === true) {
        const message = payload.message ?? "Qoo10 거래대기 전환이 백그라운드에서 진행 중입니다.";
        if (!payload.attemptId) {
          const untrackedMessage = `${message} 작업 추적 ID가 없어 자동 완료로 판단하지 않습니다.`;
          setResults((current) => ({ ...current, qoo10: { ...runningResult, phase: "failed", message: untrackedMessage } }));
          notify(untrackedMessage);
          return;
        }
        setResults((current) => ({
          ...current,
          qoo10: {
            ...runningResult,
            phase: "queued",
            message,
            attemptId: payload.attemptId,
            listingId: payload.listingId ?? listing.id,
          },
        }));
        await load();
        onChanged?.();
        notify(message);
        return;
      }
      if (payload.manualRequired === true || payload.reconciliationRequired === true) {
        const message = payload.message ?? "Qoo10 원격 상태를 수동 확인한 뒤 작업을 조정해야 합니다.";
        setResults((current) => ({
          ...current,
          qoo10: {
            ...runningResult,
            phase: "blocked",
            message,
            attemptId: payload.attemptId,
            listingId: payload.listingId ?? listing.id,
          },
        }));
        notify(message);
        return;
      }
      if (!response.ok || payload.ok !== true) throw Object.assign(new Error(payload.message ?? payload.safeMessage ?? "Qoo10 판매 중지에 실패했습니다."), { attemptId: payload.attemptId });
      setResults((current) => ({ ...current, qoo10: {
        ...runningResult,
        phase: "succeeded",
        message: payload.safeMessage,
        attemptId: payload.attemptId,
        listingId: payload.listingId ?? listing.id,
      } }));
      await load();
      onChanged?.();
      notify("Qoo10 상품을 거래대기로 전환했고 올바른 카테고리로 다시 등록할 수 있습니다.");
    } catch (error) {
      if (!isCurrentProduct()) return;
      const attemptId = error && typeof error === "object" && "attemptId" in error && typeof error.attemptId === "string" ? error.attemptId : undefined;
      const message = error instanceof Error ? error.message : "Qoo10 판매 중지에 실패했습니다.";
      setResults((current) => ({ ...current, qoo10: { ...runningResult, phase: "failed", message, attemptId } }));
      notify(message);
    } finally {
      boundedWrite.dispose();
      writeRequestControllersRef.current.delete(writeController);
    }
  };

  if (!productId) return <section className="panel product-publish-workbench disabled"><PackageCheck size={28} /><b>실제 채널 등록은 상품 원장 생성 후 열립니다.</b><small>대표사진 분석을 완료하면 상품 UUID와 채널 등록 초안이 자동으로 연결됩니다.</small></section>;
  if (loading && !context) return <section className="panel product-publish-workbench disabled"><LoaderCircle className="spin" size={26} /><b>상품·카테고리·이미지 원장 확인 중</b></section>;
  if (!context || !workbenchProductContextMatches(productId, context.product.id)) return <section className="panel product-publish-workbench disabled"><AlertTriangle size={26} /><b>상품 등록 준비 정보를 불러오지 못했습니다.</b><button type="button" onClick={() => void load()}><RefreshCw size={14} />다시 확인</button></section>;

  const remoteUpdateChannelCount = visibleChannels.filter((channel) => {
    const target = selectedTargets[channel];
    const listing = context.listings.find((item) => item.channel === channel
      && (!target || item.market === target.marketCode && item.targetId === target.targetId));
    return listingWriteOperation(listing) === "listing.update";
  }).length;

  return <section className="panel product-publish-workbench">
    <div className="publish-workbench-head"><div><span className="panel-kicker">FINAL WRITE PREFLIGHT</span><h3>실제 채널 등록 · 콘텐츠 수정</h3><p>최종 확인한 신규 상품은 실제 판매 공개 의도로 등록하고, 이미 게시된 채널은 검증된 원격 ID를 유지한 채 지원 항목만 수정합니다. Lazada MY 기존 단일 SKU는 원격 ID·SKU·카테고리·통화를 사전 조회한 경우에만 가격·재고를 함께 반영하고 다시 조회하며, 나머지 채널은 가격·재고를 별도 작업으로 유지합니다.</p></div><div className="publish-head-actions"><span className="step-chip">FINAL</span><button type="button" className="publish-bulk-execute" disabled={bulkRunning || bulkConfirming || !imagePackageReady} title={!imagePackageReady ? imagePackageBlockedMessage : undefined} onClick={() => void executeReadyChannels()}>{bulkRunning ? <LoaderCircle className="spin" size={15} /> : <Rocket size={15} />}{bulkRunning ? "채널 순차 처리 중" : bulkConfirming ? "최종 확인 열림" : !imagePackageReady ? "이미지 세트 완료 후 채널 전송" : "선택 채널 등록·콘텐츠 수정"}</button></div></div>
    {bulkConfirming && <div ref={confirmationDialogRef} tabIndex={-1} className="publish-write-confirmation" role="alertdialog" aria-label="다중 채널 실제 등록 콘텐츠 수정 최종 확인"><AlertTriangle size={18} /><div><b>준비된 채널에 실제 상품 등록·콘텐츠 수정을 화면 표시 순서대로 한 채널씩 실행합니다.</b><small>신규 등록은 실제 판매 공개로 요청합니다. 앞 채널의 응답을 확인한 뒤 다음 채널을 실행하며, 심사 대기는 공개 게시 성공으로 집계하지 않습니다.</small></div><button type="button" className="credential-secondary" onClick={closeConfirmation}>취소</button><button type="button" className="publish-confirm-execute" disabled={!imagePackageReady} title={!imagePackageReady ? imagePackageBlockedMessage : undefined} onClick={() => void executeReadyChannels(true)}>확인 후 순차 실행</button></div>}
    {remoteUpdateChannelCount > 0 && <section className="product-edit-handoff" aria-label="중앙 저장과 채널별 원격 반영 순서">
      <header><span><ShieldCheck size={17} /><b>중앙 저장 후 채널별로 따로 반영합니다.</b></span><em>수정 대상 {remoteUpdateChannelCount}개 채널</em></header>
      <ol>
        <li><span>1</span><div><b>중앙 상품 먼저 저장</b><small>상품 상세에서 저장한 등록정보를 중앙 원장에서 다시 불러온 상태입니다.</small></div></li>
        <li><span>2</span><div><b>지원·차단 이유 확인</b><small>채널 카드에서 각 필드의 원격 수정, 일부 수정, 중앙만, 미지원 상태를 확인합니다.</small></div></li>
        <li><span>3</span><div><b>채널마다 별도 실행</b><small>각 카드의 원격 반영 버튼은 지원된 항목만 전송하고 readback으로 확인합니다.</small></div></li>
      </ol>
      <p><AlertTriangle size={15} /><span><b>자동 반영하지 않는 항목</b><small>가격·옵션·판매 구성은 정확한 원격 SKU·통화·옵션 식별값이 검증되기 전에는 성공으로 표시하거나 전송하지 않습니다.</small></span></p>
    </section>}
    <div className="product-edit-draft-scope" role="note"><div><b>채널 전송용 공통 초안</b><small>아래 값을 바꾸면 채널 payload 초안만 갱신됩니다. 중앙 상품을 다시 저장하는 입력란이 아닙니다.</small></div><span>중앙 재저장 아님</span></div>
    <div className="publish-common-fields">
      <label><span>국내 기준 판매가 KRW <i>필수</i></span><input required type="number" min="0.01" step="0.01" value={price} onChange={(event) => { const value = Number(event.target.value); priceRef.current = value; setPrice(value); }} /></label>
      <label><span>판매 통화 <i>필수</i></span><input required value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></label>
      <label><span>글로벌 채널 기준가 USD <i>필수</i></span><input required type="number" min="0.01" step="0.01" value={globalBaseUsdPrice} onChange={(event) => { const value = Number(event.target.value); globalBaseUsdPriceRef.current = value; setGlobalBaseUsdPrice(value); }} /></label>
      <label><span>재고 <i>필수</i></span><input required type="number" min="0" step="1" value={quantity} onChange={(event) => { const value = Number(event.target.value); quantityRef.current = value; setQuantity(value); }} /></label>
      <label><span>중량 kg <i>필수</i></span><input required type="number" min="0.01" step="0.01" value={packageFields.weight} onChange={(event) => { const next = { ...packageFields, weight: Number(event.target.value) }; packageFieldsRef.current = next; setPackageFields(next); }} /></label>
      <label><span>가로 cm <i>필수</i></span><input required type="number" min="1" step="1" value={packageFields.length} onChange={(event) => { const next = { ...packageFields, length: Number(event.target.value) }; packageFieldsRef.current = next; setPackageFields(next); }} /></label>
      <label><span>세로 cm <i>필수</i></span><input required type="number" min="1" step="1" value={packageFields.width} onChange={(event) => { const next = { ...packageFields, width: Number(event.target.value) }; packageFieldsRef.current = next; setPackageFields(next); }} /></label>
      <label><span>높이 cm <i>필수</i></span><input required type="number" min="1" step="1" value={packageFields.height} onChange={(event) => { const next = { ...packageFields, height: Number(event.target.value) }; packageFieldsRef.current = next; setPackageFields(next); }} /></label>
      <label><span>브랜드 <i>필수</i></span><input required value={context.manualFields.brandName} onChange={(event) => updateProductFact("brandName", event.target.value)} placeholder="브랜드명 또는 No Brand" /></label>
      <label><span>제조사·공급처 <i>필수</i></span><input required value={context.manualFields.manufacturer} onChange={(event) => updateProductFact("manufacturer", event.target.value)} placeholder="실제 제조사 또는 공급처" /></label>
      <label><span>원산지 <i>필수</i></span><input required value={context.manualFields.countryOfOrigin} onChange={(event) => updateProductFact("countryOfOrigin", event.target.value)} placeholder="예: 대한민국" /></label>
      <label><span>재질·성분 <i>필수</i></span><input required value={context.manualFields.material} onChange={(event) => updateProductFact("material", event.target.value)} placeholder="실물·공식 상품정보 기준" /></label>
      <label><span>판매 구성 <i>필수</i></span><select required value={context.manualFields.packageContents} onChange={(event) => updateProductFact("packageContents", event.target.value)}><option value="">구성을 선택하세요</option>{productSaleConfigurations.map((configuration) => <option value={configuration.value} key={configuration.value}>{configuration.label}</option>)}</select></label>
      <button type="button" onClick={() => setDrafts(buildDraftMap(context, price, quantity, selectedTargets, packageFields, globalBaseUsdPrice, lazadaMyrRate))}><RefreshCw size={14} />공통값으로 초안 갱신</button>
    </div>
    <div className="publish-source-proof"><span><ShieldCheck size={15} /><b>필수값 원장</b>{context.manualFields.sellerSku}</span><span><Check size={15} /><b>마켓 이미지 세트</b>{manualMvp ? `원본 ${context.sourceImages.filter((item) => item.url).length}장 직접 사용` : `대표 ${marketplaceThumbnailCount}장 · 상세 전용 ${dedicatedDetailImageCount}/${marketplaceChannelDetailImageCount}장`}</span><span><Check size={15} /><b>등록 직전 보정</b>대표 1200×1200 JPEG · 상세 원본 비율 · 각 3MB 이하 · 공개 URL 재검증</span><span><Check size={15} /><b>카테고리 확정</b>{context.assignments.filter((item) => item.status === "confirmed").length}개 채널</span></div>
    {!imagePackageReady && <div className="publish-write-confirmation" role="alert"><AlertTriangle size={18} /><div><b>{manualMvp ? "승인된 상세페이지 이미지 8장이 없습니다." : `채널 업로드 이미지 미완료 · 대표 ${marketplaceThumbnailCount}/${marketplaceMinimumThumbnailCount}장 · 승인 상세 ${approvedDetailManifest?.images.length ?? 0}/${marketplaceChannelDetailImageCount}장`}</b><small>{manualMvp ? "상세페이지 8장 운영 원장이 없는 직접등록 상품은 단일·일괄 채널 전송을 모두 차단합니다." : `마스터 ${marketplaceGeneratedAssetCount}종 이미지 원장은 보존하고, 상세페이지에 선택·저장된 서로 다른 8장만 게시 원장으로 승인해야 합니다.`}</small></div></div>}
    <div className="publish-channel-cards">{visibleChannels.map((channel) => {
      const definition = channelCatalog[channel];
      const credential = activeCredentials.get(channel);
      const target = selectedTargets[channel];
      const channelAssignment = context.assignments.find((item) => item.channel === channel && (!target || item.market === target.marketCode));
      const assignment = context.assignments.find((item) => item.channel === channel && item.status === "confirmed" && (!target || item.market === target.marketCode));
      const listing = context.listings.find((item) => item.channel === channel && (!target || item.market === target.marketCode && item.targetId === target.targetId));
      const result = listing?.failureClass === "external_action"
        ? { phase: "blocked" as const, message: listing.lastError ?? "원격 판매자센터 상태를 수동 확인해야 합니다.", attemptId: listing.operationAttemptId ?? undefined, listingId: listing.id }
        : listing?.requestedPublicationIntent === "live" && listing.remoteVisibility === "pending_review"
          ? { phase: "pending_review" as const, message: "판매채널 심사 대기 중입니다. 공개 상태 readback 전에는 게시 성공으로 집계하거나 다시 등록하지 않습니다.", attemptId: listing.operationAttemptId ?? undefined, listingId: listing.id, remoteId: listing.remoteId ?? undefined }
        : listing && ["queued", "publishing"].includes(listing.status)
          ? { phase: "queued" as const, message: "판매채널 작업이 백그라운드에서 진행 중입니다.", attemptId: listing.operationAttemptId ?? undefined, listingId: listing.id, market: listing.market, targetId: listing.targetId }
          : results[channel] ?? { phase: "idle" as const };
      const operation = listingWriteOperation(listing);
      const remoteUpdate = operation === "listing.update";
      const operationRelease = channelOperationRelease(channel, operation);
      const operationAvailable = operationRelease.available;
      const capability = remoteUpdate ? definition.capabilities.listingUpdate : definition.capabilities.listingCreate;
      const editFieldSupport = remoteUpdate ? channelProductEditFieldSupport(channel) : null;
      const remotePlan = remoteUpdate ? productEditRemotePlan(channel, operationAvailable) : null;
      const remoteListingSupportedFieldLabels = editFieldSupport ? productEditFieldKeys
        .filter((field) => editFieldSupport[field].operation === "listing.update"
          && editFieldSupport[field].state === "supported")
        .map((field) => productEditFieldLabels[field]) : [];
      const remoteListingPartialFieldLabels = editFieldSupport ? productEditFieldKeys
        .filter((field) => editFieldSupport[field].operation === "listing.update"
          && editFieldSupport[field].state === "partial")
        .map((field) => productEditFieldLabels[field]) : [];
      const remotelyWritableListingFieldLabels = [
        ...remoteListingSupportedFieldLabels,
        ...remoteListingPartialFieldLabels,
      ];
      const remoteManualFieldLabels = editFieldSupport ? productEditFieldKeys
        .filter((field) => editFieldSupport[field].state === "blocked")
        .map((field) => productEditFieldLabels[field]) : [];
      const remoteInventorySupport = editFieldSupport?.inventory ?? null;
      const remoteCommerceUpdate = remoteUpdate
        && editFieldSupport?.price.operation === "listing.update"
        && editFieldSupport.inventory.operation === "listing.update";
      const draftObject = parseDraft(drafts[channel]);
      const lazadaFinalPricePolicy = remoteCommerceUpdate && draftObject
        ? lazadaKrwMyrPricePolicyFromArguments(draftObject)
        : null;
      const requirements = draftObject ? inspectListingDraft(channel, draftObject) : [];
      const blockingRequirements = requirements.filter((item) => item.status === "manual");
      const nativeMissing = draftObject ? missingNativeValues(channel, draftObject) : [];
      const blockingCount = blockingRequirements.length + nativeMissing.length;
      const invalidDraft = !draftObject;
      return <article key={channel} className={`publish-channel-card ${result.phase}`}>
        <header><span style={{ background: channels[channel].color }}>{definition.mark}</span><div><small>{definition.market}</small><h4>{definition.name}</h4></div><em>{remoteUpdate ? operationAvailable ? listing?.remoteId ? "콘텐츠 수정 준비" : "원격 ID 필요" : "등록 완료 · 수정 미지원" : credential ? assignment ? invalidDraft ? "JSON 확인 필요" : blockingCount ? `필수 보완 ${blockingCount}` : "등록 준비" : channelAssignment?.status === "rejected" ? "카테고리 권한 필요" : "카테고리 필요" : "키 필요"}</em></header>
        {(channel === "shopee" || channel === "lazada" || channel === "ebay") && (availableTargets[channel]?.length ?? 0) > 0 && <label className="publish-market-select"><span>판매 국가·계정</span><select value={target ? channelTargetOptionValue(target) : ""} onChange={(event) => { const nextTarget = availableTargets[channel]?.find((item) => channelTargetOptionValue(item) === event.target.value); if (!nextTarget) return; const nextTargets = { ...selectedTargets, [channel]: nextTarget }; setSelectedTargets(nextTargets); setCurrency(nextTarget.currency); setDrafts((current) => ({ ...current, [channel]: JSON.stringify(buildChannelArguments(channel, context, price, quantity, nextTarget, packageFields, globalBaseUsdPrice, lazadaMyrRate), null, 2) })); }}>{availableTargets[channel]?.map((item) => <option value={channelTargetOptionValue(item)} key={channelTargetOptionValue(item)}>{item.marketCode} · {item.displayName || item.language} · {item.currency}</option>)}</select>{channel === "ebay" ? <small>eBay 제약상 국가별 SKU로 분리 등록합니다.</small> : null}</label>}
        {!operationAvailable && <div className="publish-blocked" id={`${channel}-remote-blocked-reason`}><AlertTriangle size={18} /><b>{remoteUpdate ? "중앙 저장 · 외부채널 수동 반영 필요" : "판매자 상세 명세 승인 필요"}</b><small>{remoteUpdate ? `${operationRelease.reason} ${remotePlan?.message ?? ""}` : capability.note}</small></div>}
        {editFieldSupport && <section className="product-edit-support-section" aria-label={`${definition.name} 원격 상품 수정 지원 범위`}>
          <header className="product-edit-support-header"><div><b>이 채널의 원격 수정 범위</b><small>중앙 저장과 원격 반영은 분리되며, 일부 지원 필드는 원격 반영 후 수동 확인도 필요합니다.</small></div><span>콘텐츠 완전 {remoteListingSupportedFieldLabels.length} · 일부 {remoteListingPartialFieldLabels.length} · 수동 {remoteManualFieldLabels.length}</span></header>
          <div className="product-edit-support-grid"><div className="remote-edit-support">{productEditFieldKeys.map((field) => { const support = editFieldSupport[field]; const operationLabel = support.operation === "inventory.update" ? "별도 재고 동기화" : support.operation === "price.update" ? "별도 가격 작업" : support.operation === "listing.update" ? "상품 콘텐츠 반영" : "중앙 저장"; return <span className={support.state} title={support.reason} key={field}><b>{productEditFieldLabels[field]}</b><small className="remote-edit-support-state">{productEditSupportLabel(support.state, centralEditFieldSupport[field].state)} · {operationLabel}</small><small className="remote-edit-support-reason product-edit-support-reason">{support.reason}</small></span>; })}</div></div>
          {remoteInventorySupport && <p className={`product-edit-inventory-scope ${remoteInventorySupport.state}`}><PackageCheck size={14} /><span><b>{remoteCommerceUpdate ? `가격·재고는 이 버튼에 포함: ${lazadaFinalPricePolicy ? `${lazadaFinalPricePolicy.sourcePriceKrw.toLocaleString()} KRW → ${lazadaFinalPricePolicy.targetPriceMyr.toFixed(2)} MYR` : "최신 환율 확인 필요"}` : `재고는 이 버튼과 별도: ${remoteInventorySupport.state === "supported" ? "재고 동기화 지원" : "판매자센터 수동 확인"}`}</b><small>{remoteInventorySupport.reason} {remoteCommerceUpdate ? "원격 단일 SKU·카테고리·할인 미적용·단일 창고와 현재 환율을 확인하지 못하면 쓰기 전에 차단합니다." : "아래 상품 콘텐츠 반영 버튼은 재고를 변경하지 않습니다."}</small></span></p>}
          {remoteManualFieldLabels.length > 0 && <p className="product-edit-manual-scope"><AlertTriangle size={14} /><span><b>별도 수동 확인·반영: {remoteManualFieldLabels.join(" · ")}</b><small>일부 지원 필드도 채널 정책 보존 범위를 확인해야 합니다. 이 화면은 수동 확인이 필요한 값을 완전 반영 성공으로 표시하지 않습니다.</small></span></p>}
        </section>}
        {remoteUpdate && !operationAvailable && <button type="button" className="publish-execute product-edit-blocked-action" disabled aria-describedby={`${channel}-remote-blocked-reason`}><ShieldCheck size={15} />원격 반영 차단 · 판매자센터 수동 수정</button>}
        {operationAvailable && <>
          <div className="publish-readiness"><span className={credential ? "ok" : "missing"}>{credential ? <CircleCheck size={14} /> : <AlertTriangle size={14} />}운영 키</span><span className={assignment ? "ok" : "missing"}>{assignment ? <CircleCheck size={14} /> : <AlertTriangle size={14} />}말단 카테고리</span><span className={context.sourceImages[0]?.url ? "ok" : "missing"}>{context.sourceImages[0]?.url ? <CircleCheck size={14} /> : <AlertTriangle size={14} />}원본 대표사진</span><span className={imagePackageReady ? "ok" : "missing"}>{imagePackageReady ? <CircleCheck size={14} /> : <AlertTriangle size={14} />}{manualMvp ? "원본 사진 등록" : `대표+상세 ${marketplaceChannelDetailImageCount}장`}</span></div>
          {channelAssignment?.status === "rejected" && <div className="publish-blocked"><AlertTriangle size={18} /><b>현재 카테고리는 이 판매자 계정에서 등록할 수 없습니다.</b><small>권한을 먼저 승인받거나, 상품과 정확히 일치하면서 판매 권한이 있는 말단 카테고리를 다시 검색·확정해야 합니다. 다른 상품군으로 위장 등록하지 않습니다.</small></div>}
          {nativeMissing.length > 0 && <div className="publish-blocked"><AlertTriangle size={18} /><b>{remoteUpdate ? "수정" : "등록"} 전에 자동 생성·필수값 보완이 필요합니다.</b><small>{nativeMissing.join(", ")}</small></div>}
          {invalidDraft ? <div className="publish-blocked"><AlertTriangle size={18} /><b>채널 JSON 형식 확인 필요</b><small>아래 공식 payload를 올바른 JSON으로 수정해야 필수값 검사가 다시 실행됩니다.</small></div> : <div className="publish-required-fields">
            <div className="publish-required-head"><b>채널 필수 입력 체크</b><small>{blockingRequirements.length ? `${blockingRequirements.length}개 수동 입력 필요` : "모든 입력값 준비"}</small></div>
            <div className="publish-required-list">{requirements.map((item) => <div key={item.key} className={`publish-required-item ${item.status}`} title={item.help}>
              <span>{item.status === "ready" ? <CircleCheck size={14} /> : item.status === "runtime" ? <RefreshCw size={14} /> : <AlertTriangle size={14} />}<b>{item.label}</b><small>{item.source}</small></span>
              <em>{item.status === "ready" ? "확인됨" : item.status === "runtime" ? "API 자동조회" : "수동 입력 필수"}</em>
            </div>)}</div>
            {requirements.some((item) => item.manualPath) && <div className="publish-manual-fields">{requirements.filter((item) => item.manualPath).map((item) => <label key={`${item.key}-input`} className={item.status === "manual" ? "missing" : "ready"}>
              <span>{item.label} <i>필수</i></span>
              <input required value={listingDraftValue(draftObject, item.manualPath!)} placeholder={item.placeholder} onChange={(event) => updateManualDraftField(channel, item.manualPath!, event.target.value)} />
              {item.help && <small>{item.help}</small>}
            </label>)}</div>}
          </div>}
          {assignment && <small className="publish-category-path">{assignment.categoryPath.join(" › ")} · {assignment.categoryId}</small>}
          {listing?.status === "failed" && listing.lastError && <p className={`publish-result ${listing.failureClass === "external_action" ? "blocked" : "failed"}`}><b>{listing.failureClass === "external_action" ? "수동 확인 필요" : "이전 등록 실패"}</b> · {listing.lastError}</p>}
          <details><summary><Code2 size={14} />채널 공식 payload 최종 검토</summary><textarea value={drafts[channel] ?? "{}"} onChange={(event) => setDrafts((current) => ({ ...current, [channel]: event.target.value }))} spellCheck={false} /></details>
          {listing?.remoteId && <p className="publish-remote-id"><b>원격 ID</b>{listing.remoteId} · {listing.status}</p>}
          {result.message && <p className={`publish-result ${result.phase}`}>{result.message}{result.attemptId ? <small>작업 ID {result.attemptId}</small> : null}</p>}
          {confirmingChannel === channel && <div ref={confirmationDialogRef} tabIndex={-1} className="publish-write-confirmation channel" role="alertdialog" aria-label={`${definition.name} 실제 상품 ${remoteUpdate ? "콘텐츠 수정" : "등록"} 최종 확인`}><AlertTriangle size={18} /><div><b>{definition.name}{target ? ` ${target.marketCode} · ${target.displayName}` : ""} 운영 계정의 실제 상품 1건을 {remoteUpdate ? "지원 항목만 원격 반영" : "등록"}합니다.</b><small>{remoteUpdate ? remoteCommerceUpdate ? `원격 ID ${listing?.remoteId ?? "확인 필요"} · ${lazadaFinalPricePolicy ? `${lazadaFinalPricePolicy.sourcePriceKrw.toLocaleString()} KRW 상당 ${lazadaFinalPricePolicy.targetPriceMyr.toFixed(2)} MYR` : "MYR 환율 확인 필요"} · 재고 ${quantity}개 · 단일 SKU 사전조회 후 함께 반영` : `원격 ID ${listing?.remoteId ?? "확인 필요"} · 가격·재고·옵션·판매 구성은 변경하지 않음` : `가격 ${price.toLocaleString()} ${target?.currency || currency} · 재고 ${quantity}개`}</small></div><button type="button" className="credential-secondary" onClick={closeConfirmation}>취소</button><button type="button" className="publish-confirm-execute" disabled={!imagePackageReady} title={!imagePackageReady ? imagePackageBlockedMessage : undefined} onClick={() => void executeChannel(channel, { skipConfirm: true })}>{definition.name} 실제 {remoteUpdate ? "지원 항목만 원격 반영" : "등록"} 실행</button></div>}
          {channel === "qoo10" && qoo10StopConfirming && listing && qoo10StopConfirming.remoteId === listing.remoteId && <div ref={confirmationDialogRef} tabIndex={-1} className="publish-write-confirmation channel" role="alertdialog" aria-label="Qoo10 거래대기 전환 최종 확인"><AlertTriangle size={18} /><div><b>Qoo10 원격 상품 {listing.remoteId}를 거래대기로 전환합니다.</b><small>완전한 이미지 세트로 다시 등록할 수 있도록 현재 등록 상태를 해제합니다.</small></div><button type="button" className="credential-secondary" onClick={closeConfirmation}>취소</button><button type="button" className="publish-confirm-execute" onClick={() => void stopQoo10Listing(qoo10StopConfirming)}>Qoo10 거래대기 전환 실행</button></div>}
          {remoteUpdate && <p className="product-edit-action-scope" id={`${channel}-remote-action-scope`}><ShieldCheck size={14} /><span><b>{definition.name} {remoteCommerceUpdate ? "상품·단일 SKU 지원 항목" : "상품 콘텐츠만"} 별도 원격 반영</b><small>{remotelyWritableListingFieldLabels.length > 0 ? `완전 지원: ${remoteListingSupportedFieldLabels.join(" · ") || "없음"} · 일부 지원: ${remoteListingPartialFieldLabels.join(" · ") || "없음"}` : "검증된 상품 콘텐츠 수정 항목 없음"}. {remoteCommerceUpdate ? "검증된 단일 SKU의 가격·재고를 포함하고 옵션·판매 구성은 변경하지 않습니다." : "가격·재고·옵션·판매 구성은 이 버튼으로 변경하지 않습니다."}</small></span></p>}
          <button type="button" className={`publish-execute${remoteUpdate ? " product-edit-remote-action" : ""}`} aria-describedby={remoteUpdate ? `${channel}-remote-action-scope` : undefined} disabled={!imagePackageReady || !credential || !assignment || invalidDraft || blockingCount > 0 || ["queued", "publishing"].includes(listing?.status ?? "") || result.phase === "queued" || result.phase === "running" || result.phase === "pending_review" || result.phase === "blocked" || (remoteUpdate && !listing?.remoteId) || confirmingChannel === channel} title={!imagePackageReady ? imagePackageBlockedMessage : undefined} onClick={() => void executeChannel(channel)}>{result.phase === "running" ? <LoaderCircle className="spin" size={15} /> : remoteUpdate ? <RefreshCw size={15} /> : <Rocket size={15} />}{result.phase === "queued" ? "백그라운드 진행 중" : result.phase === "pending_review" ? "판매채널 심사 대기" : result.phase === "blocked" ? "수동 확인 후 조정 필요" : !imagePackageReady ? `이미지 세트 완료 후 ${remoteUpdate ? "원격 반영" : "등록"}` : blockingCount ? `필수 보완 ${blockingCount}개 후 ${remoteUpdate ? "원격 반영" : "등록"}` : confirmingChannel === channel ? "최종 확인 열림" : remoteUpdate ? `${definition.name} 지원 항목만 별도 원격 반영` : "검증 후 실제 1건 등록"}</button>
          {channel === "qoo10" && listing?.status === "published" && <button type="button" className="credential-secondary" disabled={["queued", "running", "blocked", "succeeded"].includes(result.phase) || qoo10StopConfirming?.remoteId === listing.remoteId} onClick={() => openConfirmation({ kind: "qoo10-stop", listing })}><CirclePause size={15} />거래대기 전환 후 재등록</button>}
        </>}
      </article>;
    })}</div>
  </section>;
}
