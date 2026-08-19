"use client";

import { AlertTriangle, Check, CircleCheck, CirclePause, LoaderCircle, PackageCheck, RefreshCw, Rocket, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activeChannelKeys, channelCatalog, type ActiveChannelKey } from "../lib/channels/catalog";
import { lazadaSkuSaleAttributes, marketplaceListingCurrency, marketplaceListingPrice, normalizeEbayAspects, shopeeLanguageSafeText } from "../lib/channels/listing-normalization";
import { blockingListingRequirements, inspectListingDraft, listingDraftValue, setListingDraftValue } from "../lib/channels/listing-preflight";
import { buildInventoryUpdateArguments, type InventorySyncRun } from "../lib/channels/inventory-sync";
import { qoo10CatalogCode, qoo10ExpiryDate, qoo10PauseParams, qoo10ProductionPlace, qoo10SellerCode } from "../lib/channels/qoo10";
import { createClient } from "../lib/supabase/client";
import { customerFacingCopy, userFacingErrorMessage } from "../lib/user-facing-errors";
import { fetchChannelTargets } from "./channel-target-client";
import { channels } from "./channel-config";

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
  status: string;
  lastError: string | null;
};

type ChannelTarget = { targetId: string; displayName: string; marketCode: string; locale: string; language: string; currency: string; status?: string };
type ChannelTargetsResponse = { credentialId?: string; targets?: ChannelTarget[] };
type LocalizedListing = { channel: "shopee" | "lazada"; market: string; locale: string; title: string; shortDescription: string; description: string; keywords: string[] };
type PackageFields = { weight: number; length: number; width: number; height: number };
type ManualFields = {
  productName: string;
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
    onHand: number;
  };
  manualFields: ManualFields;
  imageSpecs: Array<{ role: string; width: number; height: number; bytes: number; mediaType: string; fit: string }>;
  assignments: Assignment[];
  listings: Listing[];
  sourceImages: Array<{ path: string; url: string | null }>;
  generatedImages: Array<{ id: string; path: string; url: string | null }>;
  localizedListings: LocalizedListing[];
};

type ChannelResult = { phase: "idle" | "running" | "succeeded" | "failed"; message?: string; remoteId?: string; attemptId?: string };

function normalizeManualFields(context: PublishContext): ManualFields {
  const value = context.manualFields ?? {} as ManualFields;
  return {
    productName: value.productName || context.product.name,
    sellerSku: value.sellerSku || context.product.sku,
    categoryHint: value.categoryHint || context.product.name,
    brandName: value.brandName || "No Brand",
    manufacturer: value.manufacturer || "",
    countryOfOrigin: value.countryOfOrigin || "",
    material: value.material || "",
    packageContents: value.packageContents || context.product.name,
    condition: value.condition || "NEW",
    gtinStatus: value.gtinStatus || "NO_GTIN",
    gtin: value.gtin || "",
    sellingPrice: Number(value.sellingPrice) || 2500,
    currency: value.currency || "JPY",
    stock: Math.max(1, Number(value.stock) || 1),
    weightKg: Number(value.weightKg) || 0.35,
    packageLengthCm: Number(value.packageLengthCm) || 12,
    packageWidthCm: Number(value.packageWidthCm) || 12,
    packageHeightCm: Number(value.packageHeightCm) || 10,
  };
}

function html(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character));
}

function uniqueUrls(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim() ?? "").filter((value) => value.startsWith("https://")))];
}

function buildChannelArguments(channel: ActiveChannelKey, context: PublishContext, price: number, quantity: number, target: ChannelTarget | undefined, packageFields: PackageFields, globalBaseUsdPrice: number) {
  const channelPrice = marketplaceListingPrice(channel, price, { globalBaseUsdPrice, targetCurrency: target?.currency });
  const assignment = context.assignments.find((item) => item.channel === channel && item.status === "confirmed" && (!target || item.market === target.marketCode));
  const existingListing = context.listings.find((item) => item.channel === channel && (!target || item.market === target.marketCode && item.targetId === target.targetId));
  const product = context.product;
  const generatedImage = (id: string) => context.generatedImages.find((item) => item.id === id)?.url;
  const galleryImageUrls = uniqueUrls([
    generatedImage("square"),
    ...context.sourceImages.map((item) => item.url),
    generatedImage("hero"),
  ]);
  const dedicatedDetailImageUrls = context.generatedImages
    .filter((item) => item.id.startsWith("detail-"))
    .map((item) => item.url);
  const dedicatedDetailReady = uniqueUrls(dedicatedDetailImageUrls).length >= 4;
  const detailImageUrls = uniqueUrls(dedicatedDetailReady
    ? dedicatedDetailImageUrls
    : [generatedImage("portrait"), generatedImage("wide"), generatedImage("hero")]);
  const sourceImage = galleryImageUrls[0] ?? "";
  const sellerpilotAssets = { galleryImageUrls, detailImageUrls, detailAssetMode: dedicatedDetailReady ? "dedicated" : "legacy_fallback", integrationRevision: "marketplace-write-v3" };
  const localized = context.localizedListings?.find((item) => item.channel === channel && item.market === target?.marketCode)
    ?? (channel === "shopee" ? context.localizedListings?.find((item) => item.channel === "shopee" && item.locale.toLocaleLowerCase().startsWith("en")) : undefined);
  const manual = context.manualFields;
  const title = localized?.title || product.name;
  const description = localized?.description || product.description;
  const shortDescription = localized?.shortDescription || product.description.slice(0, 500);
  const marketSku = target ? `${manual.sellerSku || product.sku}-${target.marketCode}`.slice(0, 100) : manual.sellerSku || product.sku;
  if (channel === "qoo10") {
    return {
      sellerpilotAssets: { ...sellerpilotAssets, integrationRevision: "itemscontents-v1" },
      ...(existingListing?.remoteId && existingListing.status !== "published" ? { resumeRemoteId: existingListing.remoteId } : {}),
      params: {
        SecondSubCat: assignment?.categoryId ?? "",
        OuterSecondSubCat: "",
        Drugtype: "",
        ManufactureNo: qoo10CatalogCode(assignment?.providedAttributes.ManufactureNo),
        BrandNo: qoo10CatalogCode(assignment?.providedAttributes.BrandNo),
        ItemTitle: product.name.slice(0, 200),
        PromotionName: product.description.slice(0, 20),
        SellerCode: qoo10SellerCode(product.sku, existingListing?.status !== "published" ? existingListing?.remoteId ?? undefined : undefined),
        IndustrialCode: manual.gtinStatus === "HAS_GTIN" ? manual.gtin : "",
        ProductionPlace: qoo10ProductionPlace(manual.countryOfOrigin),
        AudultYN: "N",
        ContactTel: "",
        StandardImage: sourceImage,
        ItemDescription: `<section><h1>${html(product.name)}</h1><p>${html(product.description)}</p><dl><dt>Material</dt><dd>${html(manual.material)}</dd><dt>Package</dt><dd>${html(manual.packageContents)}</dd></dl></section>`,
        AdditionalOption: "",
        ItemType: "",
        RetailPrice: "0",
        ItemPrice: String(channelPrice),
        TaxRate: "S",
        ItemQty: String(quantity),
        ExpireDate: qoo10ExpiryDate(),
        ShippingNo: "0",
        AvailableDateType: "0",
        AvailableDateValue: "3",
        Keyword: "",
      },
    };
  }
  if (channel === "shopee") {
    const shopeeCategoryName = assignment?.categoryPath.at(-1) || "General Product";
    const shopeeTitle = shopeeLanguageSafeText(title, `Unbranded ${shopeeCategoryName} Sample Product Not For Sale`);
    const shopeeDescription = shopeeLanguageSafeText(description, `This is a test listing for an unbranded ${shopeeCategoryName} sample product. It is not for sale.`);
    const attributeList = Object.entries(assignment?.providedAttributes ?? {}).map(([attribute_id, original_value_name]) => ({
      attribute_id: Number(attribute_id),
      attribute_value_list: /^\d+$/.test(original_value_name) ? [{ value_id: Number(original_value_name) }] : [{ original_value_name }],
    }));
    const commonProductFields = {
      category_id: Number(assignment?.categoryId ?? 0),
      description: shopeeDescription.slice(0, 3_000),
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
    const reusableGlobalItemId = existingListing?.remoteId && existingListing.status !== "published"
      && !existingListing.lastError?.includes("로컬 상품·재고 재검증")
      ? existingListing.remoteId
      : "";
    return {
      sellerpilotAssets,
      ...(reusableGlobalItemId ? { globalItemId: reusableGlobalItemId } : {}),
      globalProduct: true,
      shopId: target?.targetId ?? "",
      country: target?.marketCode.toLowerCase() ?? "",
      imageUrls: galleryImageUrls,
      body: {
        ...commonProductFields,
        original_price: globalBaseUsdPrice,
        global_item_name: shopeeTitle.slice(0, 120),
        global_item_sku: globalSku,
      },
      publish: {
        shop_id: Number(target?.targetId ?? 0),
        shop_region: target?.marketCode ?? "",
        item: {
          ...commonProductFields,
          original_price: channelPrice,
          item_name: shopeeTitle.slice(0, 120),
          item_sku: marketSku,
          // GlobalProduct create_publish_task accepts the official local item
          // status. Non-standard values can yield a task id that never becomes
          // queryable and later surfaces only as `task not found`.
          item_status: "NORMAL",
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
    const skuSaleAttributes = lazadaSkuSaleAttributes(providedAttributes);
    return {
      sellerpilotAssets,
      ...(existingListing?.remoteId && existingListing.status !== "published" ? { resumeRemoteId: existingListing.remoteId } : {}),
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
            Attributes: { ...providedAttributes, name: title.slice(0, 255), description, short_description: shortDescription.slice(0, 500), brand: manual.brandName },
            Skus: { Sku: [{ saleProp: skuSaleAttributes, SellerSku: marketSku, price: String(channelPrice), quantity: String(quantity), package_weight: String(packageFields.weight), package_length: String(packageFields.length), package_width: String(packageFields.width), package_height: String(packageFields.height), package_content: manual.packageContents.slice(0, 255), Status: "inactive", Images: { Image: galleryImageUrls } }] },
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
        sellerProductName: product.name,
        displayProductName: product.name,
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
        items: [{ itemName: product.name, originalPrice: channelPrice, salePrice: channelPrice, maximumBuyCount: quantity, maximumBuyForPerson: quantity, maximumBuyForPersonPeriod: 1, outboundShippingTimeDay: 3, unitCount: 1, adultOnly: "EVERYONE", taxType: "TAX", parallelImported: "NOT_PARALLEL_IMPORTED", overseasPurchased: "NOT_OVERSEAS_PURCHASED", pccNeeded: false, externalVendorSku: manual.sellerSku || product.sku, barcode: manual.gtinStatus === "HAS_GTIN" ? manual.gtin : "", emptyBarcode: manual.gtinStatus === "NO_GTIN", emptyBarcodeReason: manual.gtinStatus === "NO_GTIN" ? "바코드가 없는 상품" : "", modelNo: manual.sellerSku || product.sku, images: galleryImageUrls.map((url, index) => ({ imageOrder: index, imageType: index === 0 ? "REPRESENTATION" : "DETAIL", vendorPath: url })), notices: [], attributes: categoryAttributes, contents: [{ contentsType: "TEXT", contentDetails: [{ content: product.description, detailType: "TEXT" }] }] }],
      },
    };
  }
  if (channel === "smartstore") {
    const naverAttributes = assignment?.providedAttributes ?? {};
    const certificationInfoId = Number(naverAttributes.NAVER_CHILD_CERTIFICATION_INFO_ID ?? 0);
    const hasChildCertification = Number.isSafeInteger(certificationInfoId) && certificationInfoId > 0;
    const commonNotice = {
      returnCostReason: "상품상세 참조",
      noRefundReason: "상품상세 참조",
      qualityAssuranceStandard: "상품상세 참조",
      compensationProcedure: "상품상세 참조",
      troubleShootingContents: "상품상세 참조",
    };
    const productInfoProvidedNotice = hasChildCertification ? {
      productInfoProvidedNoticeType: "KIDS",
      kids: {
        ...commonNotice,
        itemName: product.name.slice(0, 50),
        modelName: naverAttributes.NAVER_MODEL_NAME.slice(0, 50),
        certificationType: naverAttributes.NAVER_CHILD_CERTIFICATION_TYPE.slice(0, 200),
        size: naverAttributes.NAVER_SIZE.slice(0, 200),
        weight: `${packageFields.weight} kg`,
        color: naverAttributes.NAVER_COLOR.slice(0, 200),
        material: manual.material.slice(0, 200),
        recommendedAge: naverAttributes.NAVER_RECOMMENDED_AGE.slice(0, 30),
        releaseDateText: naverAttributes.NAVER_RELEASE_DATE_TEXT.slice(0, 300),
        manufacturer: manual.manufacturer.slice(0, 200),
        caution: "보호자 감독 아래 사용하고 작은 부품을 삼키지 않도록 주의하세요.",
        warrantyPolicy: "상품상세 참조",
        afterServiceDirector: "판매자 고객센터 참조",
      },
    } : {
      productInfoProvidedNoticeType: "ETC",
      etc: { ...commonNotice, itemName: product.name.slice(0, 50), modelName: (manual.sellerSku || product.sku).slice(0, 50), certificateDetails: "해당사항 없음", manufacturer: manual.manufacturer.slice(0, 200), customerServicePhoneNumber: "SERVER_MANAGED" },
    };
    return {
      sellerpilotAssets,
      imageUrls: galleryImageUrls,
      body: {
        originProduct: {
          statusType: "SALE",
          saleType: "NEW",
          leafCategoryId: assignment?.categoryId ?? "",
          name: product.name,
          detailContent: `<section><h1>${html(product.name)}</h1><p>${html(product.description)}</p></section>`,
          images: { representativeImage: { url: "PROGRAM_UPLOAD_PENDING" }, optionalImages: [] },
          salePrice: channelPrice,
          stockQuantity: quantity,
          detailAttribute: {
            minorPurchasable: true,
            ...(hasChildCertification ? {
              naverShoppingSearchInfo: { modelName: naverAttributes.NAVER_MODEL_NAME.slice(0, 50) },
              productCertificationInfos: [{
                certificationInfoId,
                certificationKindType: "CHILD_CERTIFICATION",
                name: naverAttributes.NAVER_CHILD_CERTIFICATION_AGENCY.slice(0, 200),
                certificationNumber: naverAttributes.NAVER_CHILD_CERTIFICATION_NUMBER.slice(0, 200),
                certificationMark: true,
                companyName: naverAttributes.NAVER_CHILD_CERTIFICATION_COMPANY.slice(0, 200),
              }],
              certificationTargetExcludeContent: { childCertifiedProductExclusionYn: false },
            } : {}),
            productInfoProvidedNotice,
            afterServiceInfo: { afterServiceTelephoneNumber: "SERVER_MANAGED", afterServiceGuideContent: "SERVER_MANAGED" },
            originAreaInfo: { originAreaCode: "04", content: manual.countryOfOrigin },
            sellerCodeInfo: { sellerManagementCode: manual.sellerSku || product.sku },
            optionInfo: {}, supplementaryProductInfo: {}, purchaseReviewInfo: { purchaseReviewExposure: true },
          },
          customerBenefit: {},
        },
        smartstoreChannelProduct: { naverShoppingRegistration: true, channelProductName: product.name, channelProductDisplayStatusType: "ON" },
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
          goodsName: product.name.slice(0, 500),
          extCatName: (assignment?.categoryPath.join(" > ") || manual.categoryHint).slice(0, 500),
          goodsDesc: product.description.slice(0, 10_000),
          goodsCarouselImage: galleryImageUrls.slice(0, 10),
          detailImage: detailImageUrls.slice(0, 10),
          productType: 1,
          bulletPoints: [manual.material, manual.packageContents, `[PROGRAM TEST · NOT FOR SALE] ${product.description}`].filter(Boolean).slice(0, 10),
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
    sku: manual.sellerSku || product.sku,
    inventoryItem: { availability: { shipToLocationAvailability: { quantity } }, condition: manual.condition, product: { title: product.name, description: product.description, imageUrls: galleryImageUrls, brand: manual.brandName, mpn: manual.sellerSku || product.sku, aspects: normalizeEbayAspects({ ...(assignment?.providedAttributes ?? {}), Material: manual.material, "Country/Region of Manufacture": manual.countryOfOrigin }) } },
    offer: { sku: manual.sellerSku || product.sku, marketplaceId: "EBAY_US", format: "FIXED_PRICE", availableQuantity: quantity, categoryId: assignment?.categoryId ?? "", listingDescription: product.description, listingPolicies: { fulfillmentPolicyId: "SERVER_MANAGED", paymentPolicyId: "SERVER_MANAGED", returnPolicyId: "SERVER_MANAGED" }, merchantLocationKey: "SERVER_MANAGED", pricingSummary: { price: { value: String(channelPrice), currency: "USD" } } },
    publish: true,
  };
}

function missingNativeValues(channel: ActiveChannelKey, value: Record<string, unknown>) {
  const json = JSON.stringify(value);
  const assets = value.sellerpilotAssets && typeof value.sellerpilotAssets === "object" && !Array.isArray(value.sellerpilotAssets)
    ? value.sellerpilotAssets as Record<string, unknown>
    : {};
  const galleryImages = Array.isArray(assets.galleryImageUrls) ? assets.galleryImageUrls.filter(Boolean) : [];
  const detailImages = Array.isArray(assets.detailImageUrls) ? assets.detailImageUrls.filter(Boolean) : [];
  const assetRequirements = [
    galleryImages.length === 0 ? "대표사진" : "",
    assets.detailAssetMode !== "dedicated" || detailImages.length < 4 ? "상세 이미지 4장" : "",
  ].filter(Boolean);
  if (channel === "qoo10") {
    const params = value.params as Record<string, unknown> | undefined;
    const requiredValues: Record<string, string> = { SecondSubCat: "카테고리", ItemTitle: "상품명", StandardImage: "대표사진", ItemDescription: "상세 설명", ItemPrice: "판매가", ItemQty: "재고", ShippingNo: "배송비 설정", AvailableDateType: "판매 시작일", AvailableDateValue: "판매 시작일" };
    return [...assetRequirements, ...Object.entries(requiredValues)
      .filter(([key]) => params?.[key] === undefined || String(params[key]).trim() === "")
      .map(([, label]) => label)];
  }
  if (channel === "shopee") {
    const body = value.body && typeof value.body === "object" && !Array.isArray(value.body) ? value.body as Record<string, unknown> : {};
    const packageWeight = Number(body.weight);
    return [...assetRequirements,
      !String(value.shopId ?? "").trim() ? "판매 계정" : "",
      !Array.isArray(value.imageUrls) || value.imageUrls.length === 0 ? "상품 사진" : "",
      !Number.isFinite(packageWeight) || packageWeight <= 0 ? "포장 중량" : "",
    ].filter(Boolean);
  }
  if (channel === "lazada") return [...assetRequirements, !Array.isArray(value.imageUrls) || value.imageUrls.length === 0 ? "상품 사진" : "", json.includes('"package_weight":"0"') || json.includes('"package_weight":""') ? "포장 크기와 중량" : ""].filter(Boolean);
  if (channel === "coupang") return [...assetRequirements, json.includes('"displayCategoryCode":0') ? "최종 카테고리" : "", !json.includes('"vendorPath":"https://') ? "상품 사진" : ""].filter(Boolean);
  if (channel === "smartstore") return [...assetRequirements, !Array.isArray(value.imageUrls) || value.imageUrls.length === 0 ? "상품 사진" : "", !json.includes('"originAreaCode":"04"') ? "원산지" : ""].filter(Boolean);
  if (channel === "temu") return [...assetRequirements, json.includes('"skuList":[]') ? "옵션과 재고" : "", json.includes('"images":[]') ? "상품 사진" : "", json.includes('"externalGoodsId":""') ? "상품 고유번호" : ""].filter(Boolean);
  return [...assetRequirements, json.includes('"fulfillmentPolicyId":""') ? "배송·결제·반품 정책" : "", json.includes('"merchantLocationKey":""') ? "상품 발송지" : ""].filter(Boolean);
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

function buildDraftMap(context: PublishContext, price: number, quantity: number, targets: Partial<Record<ActiveChannelKey, ChannelTarget>>, packageFields: PackageFields, globalBaseUsdPrice: number) {
  return Object.fromEntries(activeChannelKeys.map((channel) => [
    channel,
    JSON.stringify(buildChannelArguments(channel, context, price, quantity, targets[channel], packageFields, globalBaseUsdPrice), null, 2),
  ]));
}

export function ProductPublishWorkbench({ productId, selectedChannels, refreshVersion, notify, onChanged }: {
  productId: string | null;
  selectedChannels: string[];
  refreshVersion: number;
  notify: (message: string) => void;
  onChanged?: () => void;
}) {
  const [context, setContext] = useState<PublishContext | null>(null);
  const [credentials, setCredentials] = useState<CredentialRow[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<ActiveChannelKey, string>>>({});
  const [results, setResults] = useState<Partial<Record<ActiveChannelKey, ChannelResult>>>({});
  const [availableTargets, setAvailableTargets] = useState<Partial<Record<"shopee" | "lazada", ChannelTarget[]>>>({});
  const [targetCredentialIds, setTargetCredentialIds] = useState<Partial<Record<"shopee" | "lazada", string>>>({});
  const [selectedTargets, setSelectedTargets] = useState<Partial<Record<ActiveChannelKey, ChannelTarget>>>({});
  const [price, setPrice] = useState(2500);
  const [globalBaseUsdPrice, setGlobalBaseUsdPrice] = useState(12.9);
  const [quantity, setQuantity] = useState(1);
  const [currency, setCurrency] = useState("JPY");
  const [packageFields, setPackageFields] = useState<PackageFields>({ weight: 0.35, length: 12, width: 12, height: 10 });
  const [loading, setLoading] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [inventoryRunning, setInventoryRunning] = useState(false);
  const [inventoryConfirming, setInventoryConfirming] = useState(false);
  const [inventoryRun, setInventoryRun] = useState<InventorySyncRun | null>(null);
  const [confirmingChannel, setConfirmingChannel] = useState<ActiveChannelKey | null>(null);
  const [qoo10StopConfirming, setQoo10StopConfirming] = useState<Listing | null>(null);
  const [qoo10CleanupConfirming, setQoo10CleanupConfirming] = useState<string | null>(null);
  const [qoo10CleanupId, setQoo10CleanupId] = useState("");
  const priceRef = useRef(price);
  const globalBaseUsdPriceRef = useRef(globalBaseUsdPrice);
  const quantityRef = useRef(quantity);
  const packageFieldsRef = useRef(packageFields);

  const load = useCallback(async () => {
    if (!productId) {
      setContext(null);
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("상품 등록 준비 정보를 보려면 다시 로그인해 주세요.");
      const [contextResponse, credentialsResponse, shopeeTargetsResponse, lazadaTargetsResponse, inventoryResponse] = await Promise.all([
        fetch(`/api/admin/products/${productId}/publish-context`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" }),
        supabase.rpc("sellerpilot_list_credentials"),
        fetchChannelTargets("shopee", accessToken),
        fetchChannelTargets("lazada", accessToken),
        supabase.rpc("sellerpilot_get_inventory_sync", { p_product_id: productId }),
      ]);
      const payload = await contextResponse.json().catch(() => ({ message: "상품 준비 응답을 읽지 못했습니다." })) as PublishContext & { message?: string };
      if (!contextResponse.ok) throw new Error(payload.message ?? "상품 등록 준비 정보를 불러오지 못했습니다.");
      const nextPayload = { ...payload, manualFields: normalizeManualFields(payload), imageSpecs: Array.isArray(payload.imageSpecs) ? payload.imageSpecs : [] };
      const shopeePayload = await shopeeTargetsResponse.json().catch(() => ({ targets: [] })) as ChannelTargetsResponse;
      const lazadaPayload = await lazadaTargetsResponse.json().catch(() => ({ targets: [] })) as ChannelTargetsResponse;
      const shopeeTargets = shopeeTargetsResponse.ok && Array.isArray(shopeePayload.targets) ? shopeePayload.targets : [];
      const lazadaTargets = lazadaTargetsResponse.ok && Array.isArray(lazadaPayload.targets) ? lazadaPayload.targets : [];
      const initialTargets: Partial<Record<ActiveChannelKey, ChannelTarget>> = { shopee: shopeeTargets[0], lazada: lazadaTargets[0] };
      const manual = nextPayload.manualFields;
      const initialPrice = manual.sellingPrice;
      const initialQuantity = Math.max(0, Number(nextPayload.product.onHand ?? manual.stock) || 0);
      const initialPackage = { weight: manual.weightKg, length: manual.packageLengthCm, width: manual.packageWidthCm, height: manual.packageHeightCm };
      priceRef.current = initialPrice;
      quantityRef.current = initialQuantity;
      packageFieldsRef.current = initialPackage;
      setPrice(initialPrice);
      setQuantity(initialQuantity);
      setCurrency(manual.currency);
      setPackageFields(initialPackage);
      if (manual.currency === "USD") {
        globalBaseUsdPriceRef.current = initialPrice;
        setGlobalBaseUsdPrice(initialPrice);
      }
      setContext(nextPayload);
      setCredentials(Array.isArray(credentialsResponse.data) ? credentialsResponse.data as CredentialRow[] : []);
      setAvailableTargets({ shopee: shopeeTargets, lazada: lazadaTargets });
      setTargetCredentialIds({ shopee: shopeePayload.credentialId, lazada: lazadaPayload.credentialId });
      setSelectedTargets(initialTargets);
      setInventoryRun(inventoryResponse.data && typeof inventoryResponse.data === "object" && !Array.isArray(inventoryResponse.data)
        ? inventoryResponse.data as InventorySyncRun
        : null);
      setDrafts(buildDraftMap(nextPayload, initialPrice, initialQuantity, initialTargets, initialPackage, manual.currency === "USD" ? initialPrice : globalBaseUsdPriceRef.current));
    } catch (error) {
      notify(userFacingErrorMessage(error, "상품 등록 준비 정보를 불러오지 못했습니다. 다시 시도해 주세요."));
    } finally {
      setLoading(false);
    }
  }, [notify, productId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshVersion]);

  const activeCredentials = useMemo(() => {
    const byChannel = new Map<ActiveChannelKey, CredentialRow>();
    for (const item of credentials) {
      if (item.status === "active" && item.environment === "production" && !byChannel.has(item.channel)) byChannel.set(item.channel, item);
    }
    for (const channel of ["shopee", "lazada"] as const) {
      const credentialId = targetCredentialIds[channel];
      const credential = credentialId ? credentials.find((item) => item.id === credentialId && item.channel === channel && item.status === "active" && item.environment === "production") : undefined;
      if (credential) byChannel.set(channel, credential);
    }
    return byChannel;
  }, [credentials, targetCredentialIds]);
  const visibleChannels = useMemo(() => activeChannelKeys.filter((channel) => selectedChannels.includes(channel)), [selectedChannels]);

  const updateProductFact = (key: "brandName" | "manufacturer" | "countryOfOrigin" | "material" | "packageContents", value: string) => {
    if (!context) return;
    const nextContext = { ...context, manualFields: { ...context.manualFields, [key]: value } };
    setContext(nextContext);
    setDrafts(buildDraftMap(nextContext, priceRef.current, quantityRef.current, selectedTargets, packageFieldsRef.current, globalBaseUsdPriceRef.current));
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
    if (!context || !productId) return false;
    if (!Number.isInteger(quantity) || quantity < 1) {
      notify("새 상품 등록 재고는 1개 이상이어야 합니다. 품절 전파는 ‘등록 채널 재고 맞추기’를 사용해 주세요.");
      return false;
    }
    const credential = activeCredentials.get(channel);
    const target = selectedTargets[channel];
    const assignment = context.assignments.find((item) => item.channel === channel && item.status === "confirmed" && (!target || item.market === target.marketCode));
    if (!credential || !assignment) {
      notify(`${channelCatalog[channel].name} 연결 상태와 선택한 카테고리를 확인해 주세요.`);
      return false;
    }
    let channelArguments: Record<string, unknown>;
    try {
      channelArguments = JSON.parse(drafts[channel] ?? "{}") as Record<string, unknown>;
    } catch {
      notify(`${channelCatalog[channel].name} 등록 정보를 다시 준비해 주세요.`);
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
    const listingCurrency = marketplaceListingCurrency(channel, target?.currency);
    const operationPrice = marketplaceListingPrice(channel, price, { globalBaseUsdPrice, targetCurrency: target?.currency });
    if (!options.skipConfirm) {
      setConfirmingChannel(channel);
      return false;
    }
    setConfirmingChannel(null);

    setResults((current) => ({ ...current, [channel]: { phase: "running" } }));
    try {
      const accessToken = options.accessToken ?? (await createClient().auth.getSession()).data.session?.access_token;
      if (!accessToken) throw new Error("로그인이 만료되었습니다. 다시 로그인해 주세요.");
      const existingListing = context.listings.find((item) => item.channel === channel && (!target || item.market === target.marketCode && item.targetId === target.targetId));
      const retryNonce = existingListing?.status === "failed" ? crypto.randomUUID() : "";
      const idempotencyKey = `listing:${productId}:${channel}:${target?.marketCode ?? "default"}:${await fingerprint({ channelArguments, listingCurrency, price: operationPrice, retryNonce })}`;
      const response = await fetch("/api/admin/channel-operations", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          credentialId: credential.id,
          channel,
          operation: "listing.create",
          idempotencyKey,
          confirmWrite: true,
          productId,
          currency: listingCurrency,
          price: operationPrice,
          market: target?.marketCode ?? "",
          targetId: target?.targetId ?? "",
          arguments: channelArguments,
        }),
      });
      const payload = await response.json().catch(() => ({ message: "채널 응답을 읽지 못했습니다." })) as { ok?: boolean; message?: string; safeMessage?: string; remoteId?: string; attemptId?: string };
      if (!response.ok || payload.ok !== true) throw Object.assign(new Error(userFacingErrorMessage(payload.message ?? payload.safeMessage, "상품을 등록하지 못했습니다. 입력 정보를 확인하고 다시 시도해 주세요.")), { attemptId: payload.attemptId });
      setResults((current) => ({ ...current, [channel]: { phase: "succeeded", message: userFacingErrorMessage(payload.safeMessage, `${channelCatalog[channel].name} 상품 등록이 완료됐습니다.`), remoteId: payload.remoteId, attemptId: payload.attemptId } }));
      notify(`${channelCatalog[channel].name} 상품 등록이 완료됐습니다. 상품 번호 ${payload.remoteId ?? "확인 중"}`);
      if (!options.deferRefresh) {
        await load();
        onChanged?.();
      }
      return true;
    } catch (error) {
      const attemptId = error && typeof error === "object" && "attemptId" in error && typeof error.attemptId === "string" ? error.attemptId : undefined;
      const message = userFacingErrorMessage(error, "상품을 등록하지 못했습니다. 입력 정보를 확인하고 다시 시도해 주세요.");
      setResults((current) => ({ ...current, [channel]: { phase: "failed", message, attemptId } }));
      notify(`${channelCatalog[channel].name}: ${message}`);
      return false;
    }
  };

  const executeReadyChannels = async (confirmed = false) => {
    if (!context || !productId || bulkRunning) return;
    const readyChannels = visibleChannels.filter((channel) => {
      if (channelCatalog[channel].capabilities.listingCreate.mode === "vendor_docs_required") return false;
      const credential = activeCredentials.get(channel);
      const target = selectedTargets[channel];
      const assignment = context.assignments.find((item) => item.channel === channel && item.status === "confirmed" && (!target || item.market === target.marketCode));
      const listing = context.listings.find((item) => item.channel === channel && (!target || item.market === target.marketCode && item.targetId === target.targetId));
      const parsedDraft = parseDraft(drafts[channel]);
      const hasMissingRequired = !parsedDraft || blockingListingRequirements(channel, parsedDraft).length > 0 || missingNativeValues(channel, parsedDraft).length > 0;
      return Boolean(quantity >= 1 && credential && assignment && !hasMissingRequired && listing?.status !== "published" && results[channel]?.phase !== "running");
    }).slice(0, 8);
    if (!readyChannels.length) return notify("활성 키와 확정 카테고리가 모두 준비된 미등록 채널이 없습니다.");
    if (!confirmed) {
      setBulkConfirming(true);
      return;
    }
    setBulkConfirming(false);
    setBulkRunning(true);
    try {
      const { data: sessionData } = await createClient().auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("로그인이 만료되었습니다. 다시 로그인해 주세요.");
      const completed = await Promise.all(readyChannels.map((channel) => executeChannel(channel, { skipConfirm: true, accessToken, deferRefresh: true })));
      const succeeded = completed.filter(Boolean).length;
      await load();
      onChanged?.();
      notify(`동시 등록 완료 · 성공 ${succeeded}개 / 확인 필요 ${readyChannels.length - succeeded}개`);
    } catch (error) {
      notify(userFacingErrorMessage(error, "여러 판매 채널 등록을 완료하지 못했습니다. 다시 시도해 주세요."));
    } finally {
      setBulkRunning(false);
    }
  };

  const executeInventorySync = async (confirmed = false) => {
    if (!context || !productId || inventoryRunning) return;
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99_999_999) {
      return notify("재고는 0 이상의 정수로 입력해 주세요.");
    }
    const publishedListings = context.listings.filter((listing) => listing.status === "published" && listing.remoteId);
    if (!publishedListings.length) return notify("먼저 한 개 이상의 판매 채널에 상품을 등록해 주세요.");

    const prepared = new Map<string, { credential: CredentialRow; arguments: Record<string, unknown> }>();
    try {
      for (const listing of publishedListings) {
        const credential = activeCredentials.get(listing.channel);
        if (!credential) throw new Error(`${channelCatalog[listing.channel].name} 연결 정보가 없어 재고 맞추기를 시작할 수 없습니다.`);
        const target = listing.channel === "shopee" || listing.channel === "lazada"
          ? availableTargets[listing.channel]?.find((item) => item.targetId === listing.targetId && item.marketCode === listing.market)
          : undefined;
        if ((listing.channel === "shopee" || listing.channel === "lazada") && !target) {
          throw new Error(`${channelCatalog[listing.channel].name} ${listing.market} 판매 계정을 다시 확인해 주세요.`);
        }
        const listingDraft = buildChannelArguments(
          listing.channel,
          context,
          price,
          quantity,
          target,
          packageFields,
          globalBaseUsdPrice,
        );
        prepared.set(listing.id, {
          credential,
          arguments: buildInventoryUpdateArguments({
            channel: listing.channel,
            remoteId: listing.remoteId!,
            quantity,
            productSku: context.product.sku,
            market: listing.market,
            targetId: listing.targetId,
            draft: listingDraft,
          }),
        });
      }
    } catch (error) {
      const message = error instanceof Error && error.message.includes("SINGLE_SKU_REQUIRED")
        ? "옵션이 여러 개인 상품은 옵션별 재고를 먼저 입력해야 합니다. 총재고를 각 옵션에 복제하지 않았습니다."
        : userFacingErrorMessage(error, "채널별 재고 정보를 준비하지 못했습니다.");
      return notify(message);
    }
    if (!confirmed) {
      setInventoryConfirming(true);
      return;
    }

    setInventoryConfirming(false);
    setInventoryRunning(true);
    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("로그인이 만료되었습니다. 다시 로그인해 주세요.");
      const syncKey = `inventory:${productId}:${quantity}:${crypto.randomUUID()}`;
      const { data: startData, error: startError } = await supabase.rpc("sellerpilot_start_inventory_sync", {
        p_product_id: productId,
        p_on_hand: quantity,
        p_idempotency_key: syncKey,
      });
      if (startError || !startData || typeof startData !== "object" || Array.isArray(startData)) {
        throw new Error(startError?.message || "재고 맞추기를 시작하지 못했습니다.");
      }
      const run = startData as InventorySyncRun;
      setInventoryRun(run);
      const completed = await Promise.all(run.tasks.map(async (task) => {
        const plan = prepared.get(task.listingId);
        if (!plan) return false;
        const response = await fetch("/api/admin/channel-operations", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            credentialId: plan.credential.id,
            channel: task.channel,
            operation: "inventory.update",
            idempotencyKey: `inventory:${run.runId}:${task.id}:verified-v1`,
            confirmWrite: true,
            productId,
            market: task.market,
            targetId: task.targetId,
            inventorySyncRunId: run.runId,
            inventorySyncItemId: task.id,
            arguments: plan.arguments,
          }),
        });
        const payload = await response.json().catch(() => ({ message: "재고 변경 응답을 읽지 못했습니다." })) as { ok?: boolean; message?: string; safeMessage?: string };
        if (!response.ok || payload.ok !== true) {
          notify(`${channelCatalog[task.channel].name}: ${userFacingErrorMessage(payload.message ?? payload.safeMessage, "재고를 맞추지 못했습니다. 잠시 후 다시 시도해 주세요.")}`);
          return false;
        }
        return true;
      }));
      const { data: completedRun } = await supabase.rpc("sellerpilot_get_inventory_sync", { p_product_id: productId });
      const latest = completedRun && typeof completedRun === "object" && !Array.isArray(completedRun)
        ? completedRun as InventorySyncRun
        : run;
      setInventoryRun(latest);
      await load();
      onChanged?.();
      const succeeded = completed.filter(Boolean).length;
      notify(`재고 맞추기 완료 · 성공 ${succeeded}개 / 확인 필요 ${completed.length - succeeded}개`);
    } catch (error) {
      notify(userFacingErrorMessage(error, "재고를 모든 판매 채널에 반영하지 못했습니다. 다시 시도해 주세요."));
    } finally {
      setInventoryRunning(false);
    }
  };

  const stopQoo10Listing = async (listing: Listing) => {
    const credential = activeCredentials.get("qoo10");
    if (!credential || !listing.remoteId || !productId) return notify("Qoo10 연결 상태와 상품 번호를 확인해 주세요.");
    setQoo10StopConfirming(null);
    setResults((current) => ({ ...current, qoo10: { phase: "running", message: "Qoo10 거래대기 전환 요청 중" } }));
    try {
      const accessToken = (await createClient().auth.getSession()).data.session?.access_token;
      if (!accessToken) throw new Error("로그인이 만료되었습니다. 다시 로그인해 주세요.");
      const response = await fetch("/api/admin/channel-operations", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          credentialId: credential.id,
          channel: "qoo10",
          operation: "listing.stop",
          idempotencyKey: `listing-stop:${productId}:qoo10:${listing.remoteId}:status-1`,
          confirmWrite: true,
          productId,
          currency,
          price,
          market: listing.market,
          targetId: listing.targetId,
          arguments: { params: qoo10PauseParams(listing.remoteId) },
        }),
      });
      const payload = await response.json().catch(() => ({ message: "Qoo10 판매 중지 응답을 읽지 못했습니다." })) as { ok?: boolean; message?: string; safeMessage?: string; attemptId?: string };
      if (!response.ok || payload.ok !== true) throw Object.assign(new Error(userFacingErrorMessage(payload.message ?? payload.safeMessage, "Qoo10 판매 상태를 변경하지 못했습니다.")), { attemptId: payload.attemptId });
      setResults((current) => ({ ...current, qoo10: { phase: "succeeded", message: userFacingErrorMessage(payload.safeMessage, "Qoo10 판매 상태를 변경했습니다."), attemptId: payload.attemptId } }));
      await load();
      onChanged?.();
      notify("Qoo10 상품을 거래대기로 전환했고 올바른 카테고리로 다시 등록할 수 있습니다.");
    } catch (error) {
      const message = userFacingErrorMessage(error, "Qoo10 판매 상태를 변경하지 못했습니다. 다시 시도해 주세요.");
      setResults((current) => ({ ...current, qoo10: { phase: "failed", message } }));
      notify(message);
    }
  };

  const requestPausePreviousQoo10Remote = () => {
    const remoteId = qoo10CleanupId.trim();
    if (!/^\d{9,10}$/.test(remoteId)) return notify("정리할 Qoo10 상품번호 9~10자리를 입력해 주세요.");
    setQoo10CleanupConfirming(remoteId);
  };

  const pausePreviousQoo10Remote = async (remoteId: string) => {
    const credential = activeCredentials.get("qoo10");
    if (!credential) return notify("Qoo10 연결 상태를 확인해 주세요.");
    let params: ReturnType<typeof qoo10PauseParams>;
    try {
      params = qoo10PauseParams(remoteId);
    } catch {
      return notify("정리할 Qoo10 상품번호 9~10자리를 입력해 주세요.");
    }
    setQoo10CleanupConfirming(null);
    setResults((current) => ({ ...current, qoo10: { phase: "running", message: `이전 상품 ${remoteId}의 판매 상태를 변경하고 있습니다.` } }));
    try {
      const accessToken = (await createClient().auth.getSession()).data.session?.access_token;
      if (!accessToken) throw new Error("로그인이 만료되었습니다. 다시 로그인해 주세요.");
      const response = await fetch("/api/admin/channel-operations", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          credentialId: credential.id,
          channel: "qoo10",
          operation: "listing.stop",
          idempotencyKey: `qoo10-remote-pause:${remoteId}:status-1`,
          confirmWrite: true,
          arguments: { params },
        }),
      });
      const payload = await response.json().catch(() => ({ message: "Qoo10 거래대기 전환 응답을 읽지 못했습니다." })) as { ok?: boolean; message?: string; safeMessage?: string; attemptId?: string };
      if (!response.ok || payload.ok !== true) throw Object.assign(new Error(userFacingErrorMessage(payload.message ?? payload.safeMessage, "Qoo10 판매 상태를 변경하지 못했습니다.")), { attemptId: payload.attemptId });
      setResults((current) => ({ ...current, qoo10: { phase: "succeeded", message: `이전 상품 ${remoteId}를 거래대기 상태로 변경했습니다.`, attemptId: payload.attemptId } }));
      setQoo10CleanupId("");
      notify(`이전 Qoo10 상품 ${remoteId}를 거래대기로 전환했습니다.`);
    } catch (error) {
      const message = userFacingErrorMessage(error, "Qoo10 판매 상태를 변경하지 못했습니다. 다시 시도해 주세요.");
      setResults((current) => ({ ...current, qoo10: { phase: "failed", message } }));
      notify(message);
    }
  };

  if (!productId) return <section className="panel product-publish-workbench disabled"><PackageCheck size={28} /><b>상품 분석을 완료하면 판매 채널에 등록할 수 있습니다.</b><small>대표사진과 상품 정보를 분석해 등록에 필요한 내용을 먼저 준비해 주세요.</small></section>;
  if (loading && !context) return <section className="panel product-publish-workbench disabled"><LoaderCircle className="spin" size={26} /><b>상품 등록 정보를 확인하는 중</b></section>;
  if (!context) return <section className="panel product-publish-workbench disabled"><AlertTriangle size={26} /><b>상품 등록 준비 정보를 불러오지 못했습니다.</b><button type="button" onClick={() => void load()}><RefreshCw size={14} />다시 확인</button></section>;

  const marketplaceThumbnailCount = context.generatedImages.filter((item) => (item.id === "square" || item.id === "hero") && item.url).length;
  const dedicatedDetailImageCount = context.generatedImages.filter((item) => item.id.startsWith("detail-") && item.url).length;
  const imagePackageReady = marketplaceThumbnailCount >= 1 && dedicatedDetailImageCount >= 4;

  return <section className="panel product-publish-workbench">
    <div className="publish-workbench-head"><div><span className="panel-kicker">3단계</span><h3>판매 채널에 등록하기</h3><p>상품 이미지, 카테고리, 가격, 재고와 필수 정보를 마지막으로 확인한 뒤 준비된 판매 채널에 등록합니다.</p></div><div className="publish-head-actions"><span className="step-chip">3 / 3</span><button type="button" className="credential-secondary" disabled={inventoryRunning || inventoryConfirming} onClick={() => void executeInventorySync()}>{inventoryRunning ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{inventoryRunning ? "재고 확인 중" : inventoryConfirming ? "마지막 확인" : "등록 채널 재고 맞추기"}</button><button type="button" className="publish-bulk-execute" disabled={bulkRunning || bulkConfirming} onClick={() => void executeReadyChannels()}>{bulkRunning ? <LoaderCircle className="spin" size={15} /> : <Rocket size={15} />}{bulkRunning ? "등록 중" : bulkConfirming ? "마지막 확인" : "준비된 채널에 등록"}</button></div></div>
    {bulkConfirming && <div className="publish-write-confirmation" role="alertdialog" aria-label="여러 판매 채널 등록 최종 확인"><AlertTriangle size={18} /><div><b>준비된 모든 판매 채널에 상품을 등록합니다.</b><small>가격과 재고, 필수 정보를 한 번 더 확인해 주세요.</small></div><button type="button" className="credential-secondary" onClick={() => setBulkConfirming(false)}>취소</button><button type="button" className="publish-confirm-execute" onClick={() => void executeReadyChannels(true)}>확인하고 등록</button></div>}
    {inventoryConfirming && <div className="publish-write-confirmation" role="alertdialog" aria-label="전체 판매 채널 재고 변경 최종 확인"><AlertTriangle size={18} /><div><b>등록된 모든 판매 채널의 판매 가능 재고를 {quantity}개로 맞춥니다.</b><small>각 채널에 반영한 뒤 수량이 정확히 일치하는지 다시 확인합니다.</small></div><button type="button" className="credential-secondary" onClick={() => setInventoryConfirming(false)}>취소</button><button type="button" className="publish-confirm-execute" onClick={() => void executeInventorySync(true)}>확인하고 재고 맞추기</button></div>}
    {inventoryRun && <div className={`publish-result inventory-sync-result ${inventoryRun.status === "succeeded" ? "succeeded" : inventoryRun.status === "failed" || inventoryRun.status === "partial" ? "failed" : "running"}`} role="status" aria-live="polite">
      <div className="inventory-sync-summary"><b>최근 재고 맞추기</b><span>{inventoryRun.status === "succeeded" ? "전체 채널 확인 완료" : inventoryRun.status === "partial" ? "일부 채널 재확인 필요" : inventoryRun.status === "failed" ? "채널 확인 필요" : "처리 중"} · 성공 {inventoryRun.succeededCount}/{inventoryRun.totalCount}</span></div>
      <div className="inventory-sync-tasks" aria-label="채널별 재고 반영 결과">
        {inventoryRun.tasks.map((task) => <div key={task.id} className={`inventory-sync-task ${task.status}`}>
          <span className="channel-code">{channelCatalog[task.channel].code}</span>
          <span><b>{channelCatalog[task.channel].name}</b><small>{task.status === "succeeded" ? `${task.quantity}개 반영 확인` : task.status === "failed" ? userFacingErrorMessage(task.safeMessage, "재고 반영 결과를 확인하지 못했습니다. 다시 시도해 주세요.") : "판매 채널에 반영 중"}</small></span>
          <em>{task.status === "succeeded" ? "완료" : task.status === "failed" ? "재확인" : "진행 중"}</em>
        </div>)}
      </div>
    </div>}
    <div className="publish-common-fields">
      <label><span>판매가(원) <i>필수</i></span><input required type="number" min="0.01" step="0.01" value={price} onChange={(event) => { const value = Number(event.target.value); priceRef.current = value; setPrice(value); }} /></label>
      <label><span>판매 통화 <i>필수</i></span><input required value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></label>
      <label><span>해외 판매 기준가(달러) <i>필수</i></span><input required type="number" min="0.01" step="0.01" value={globalBaseUsdPrice} onChange={(event) => { const value = Number(event.target.value); globalBaseUsdPriceRef.current = value; setGlobalBaseUsdPrice(value); }} /></label>
      <label><span>재고 <i>필수</i></span><input required type="number" min="0" step="1" value={quantity} onChange={(event) => { const value = Number(event.target.value); quantityRef.current = value; setQuantity(value); }} /></label>
      <label><span>중량 kg <i>필수</i></span><input required type="number" min="0.01" step="0.01" value={packageFields.weight} onChange={(event) => { const next = { ...packageFields, weight: Number(event.target.value) }; packageFieldsRef.current = next; setPackageFields(next); }} /></label>
      <label><span>가로 cm <i>필수</i></span><input required type="number" min="1" step="1" value={packageFields.length} onChange={(event) => { const next = { ...packageFields, length: Number(event.target.value) }; packageFieldsRef.current = next; setPackageFields(next); }} /></label>
      <label><span>세로 cm <i>필수</i></span><input required type="number" min="1" step="1" value={packageFields.width} onChange={(event) => { const next = { ...packageFields, width: Number(event.target.value) }; packageFieldsRef.current = next; setPackageFields(next); }} /></label>
      <label><span>높이 cm <i>필수</i></span><input required type="number" min="1" step="1" value={packageFields.height} onChange={(event) => { const next = { ...packageFields, height: Number(event.target.value) }; packageFieldsRef.current = next; setPackageFields(next); }} /></label>
      <label><span>브랜드 <i>필수</i></span><input required value={context.manualFields.brandName} onChange={(event) => updateProductFact("brandName", event.target.value)} placeholder="브랜드명 또는 No Brand" /></label>
      <label><span>제조사·공급처 <i>필수</i></span><input required value={context.manualFields.manufacturer} onChange={(event) => updateProductFact("manufacturer", event.target.value)} placeholder="실제 제조사 또는 공급처" /></label>
      <label><span>원산지 <i>필수</i></span><input required value={context.manualFields.countryOfOrigin} onChange={(event) => updateProductFact("countryOfOrigin", event.target.value)} placeholder="예: 대한민국" /></label>
      <label><span>재질·성분 <i>필수</i></span><input required value={context.manualFields.material} onChange={(event) => updateProductFact("material", event.target.value)} placeholder="실물·공식 상품정보 기준" /></label>
      <label><span>판매 구성품 <i>필수</i></span><input required value={context.manualFields.packageContents} onChange={(event) => updateProductFact("packageContents", event.target.value)} placeholder="예: 본품 1개" /></label>
      <button type="button" onClick={() => setDrafts(buildDraftMap(context, price, quantity, selectedTargets, packageFields, globalBaseUsdPrice))}><RefreshCw size={14} />입력값 다시 적용</button>
    </div>
    <div className="publish-source-proof"><span><ShieldCheck size={15} /><b>상품 정보</b>{context.manualFields.sellerSku}</span><span><Check size={15} /><b>상품 이미지</b>대표 {marketplaceThumbnailCount}장 · 상세 {dedicatedDetailImageCount}/4장</span><span><Check size={15} /><b>이미지 자동 최적화</b>판매 채널 규격에 맞게 준비</span><span><Check size={15} /><b>카테고리</b>{context.assignments.filter((item) => item.status === "confirmed").length}개 채널 확인</span></div>
    {!imagePackageReady && <div className="publish-write-confirmation" role="alert"><AlertTriangle size={18} /><div><b>대표 이미지와 상세 이미지 4장이 모두 필요합니다.</b><small>상품 이미지 · 상세페이지에서 이미지를 다시 만들면 필요한 이미지가 자동으로 준비됩니다.</small></div></div>}
    <div className="publish-channel-cards">{visibleChannels.map((channel) => {
      const definition = channelCatalog[channel];
      const credential = activeCredentials.get(channel);
      const target = selectedTargets[channel];
      const channelAssignment = context.assignments.find((item) => item.channel === channel && (!target || item.market === target.marketCode));
      const assignment = context.assignments.find((item) => item.channel === channel && item.status === "confirmed" && (!target || item.market === target.marketCode));
      const listing = context.listings.find((item) => item.channel === channel && (!target || item.market === target.marketCode && item.targetId === target.targetId));
      const result = results[channel] ?? { phase: "idle" as const };
      const capability = definition.capabilities.listingCreate;
      const draftObject = parseDraft(drafts[channel]);
      const requirements = draftObject ? inspectListingDraft(channel, draftObject) : [];
      const blockingRequirements = requirements.filter((item) => item.status === "manual");
      const nativeMissing = draftObject ? missingNativeValues(channel, draftObject) : [];
      const blockingCount = blockingRequirements.length + nativeMissing.length;
      const invalidDraft = !draftObject;
      const confirmationCurrency = marketplaceListingCurrency(channel, target?.currency);
      const confirmationPrice = marketplaceListingPrice(channel, price, { globalBaseUsdPrice, targetCurrency: target?.currency });
      return <article key={channel} className={`publish-channel-card ${result.phase}`}>
        <header><span style={{ background: channels[channel].color }}>{definition.code}</span><div><small>{customerFacingCopy(definition.market)}</small><h4>{definition.name}</h4></div><em>{listing?.status === "published" ? "등록 완료" : credential ? assignment ? invalidDraft ? "등록 정보 확인 필요" : blockingCount ? `필수 정보 ${blockingCount}개` : "등록 준비 완료" : channelAssignment?.status === "rejected" ? "카테고리 확인 필요" : "카테고리 필요" : "채널 연결 필요"}</em></header>
        {(channel === "shopee" || channel === "lazada") && (availableTargets[channel]?.length ?? 0) > 0 && <label className="publish-market-select"><span>판매 국가·계정</span><select value={target?.marketCode ?? ""} onChange={(event) => { const nextTarget = availableTargets[channel]?.find((item) => item.marketCode === event.target.value); if (!nextTarget) return; const nextTargets = { ...selectedTargets, [channel]: nextTarget }; setSelectedTargets(nextTargets); setCurrency(nextTarget.currency); setDrafts((current) => ({ ...current, [channel]: JSON.stringify(buildChannelArguments(channel, context, price, quantity, nextTarget, packageFields, globalBaseUsdPrice), null, 2) })); }}>{availableTargets[channel]?.map((item) => <option value={item.marketCode} key={`${item.marketCode}-${item.targetId}`}>{item.marketCode} · {item.displayName || item.language} · {item.currency}</option>)}</select></label>}
        {capability.mode === "vendor_docs_required" ? <div className="publish-blocked" role="alert"><AlertTriangle size={18} /><b>판매 채널의 추가 승인이 필요합니다</b><small>채널 연결 화면에서 승인 상태를 확인한 뒤 다시 시도해 주세요.</small></div> : <>
          <div className="publish-readiness"><span className={credential ? "ok" : "missing"}>{credential ? <CircleCheck size={14} /> : <AlertTriangle size={14} />}채널 연결</span><span className={assignment ? "ok" : "missing"}>{assignment ? <CircleCheck size={14} /> : <AlertTriangle size={14} />}카테고리</span><span className={context.sourceImages[0]?.url ? "ok" : "missing"}>{context.sourceImages[0]?.url ? <CircleCheck size={14} /> : <AlertTriangle size={14} />}대표사진</span><span className={imagePackageReady ? "ok" : "missing"}>{imagePackageReady ? <CircleCheck size={14} /> : <AlertTriangle size={14} />}상세 이미지 4장</span></div>
          {channelAssignment?.status === "rejected" && <div className="publish-blocked" role="alert"><AlertTriangle size={18} /><b>현재 카테고리는 이 판매자 계정에서 사용할 수 없습니다</b><small>판매 권한을 확인하거나 상품에 맞는 다른 최종 카테고리를 선택해 주세요.</small></div>}
          {nativeMissing.length > 0 && <div className="publish-blocked" role="alert"><AlertTriangle size={18} /><b>등록 전에 필요한 정보를 확인해 주세요</b><small>{nativeMissing.join(", ")}</small></div>}
          {invalidDraft ? <div className="publish-blocked"><AlertTriangle size={18} /><b>등록 정보를 다시 준비해 주세요</b><small>위의 ‘입력값 다시 적용’을 눌러 등록 정보를 새로 준비할 수 있습니다.</small></div> : <div className="publish-required-fields">
            <div className="publish-required-head"><b>채널 필수 입력 체크</b><small>{blockingRequirements.length ? `${blockingRequirements.length}개 수동 입력 필요` : "모든 입력값 준비"}</small></div>
            <div className="publish-required-list">{requirements.map((item) => <div key={item.key} className={`publish-required-item ${item.status}`} title={item.help}>
              <span>{item.status === "ready" ? <CircleCheck size={14} /> : item.status === "runtime" ? <RefreshCw size={14} /> : <AlertTriangle size={14} />}<b>{item.label}</b><small>{item.source}</small></span>
              <em>{item.status === "ready" ? "확인됨" : item.status === "runtime" ? "자동 확인" : "직접 입력 필요"}</em>
            </div>)}</div>
            {requirements.some((item) => item.manualPath) && <div className="publish-manual-fields">{requirements.filter((item) => item.manualPath).map((item) => <label key={`${item.key}-input`} className={item.status === "manual" ? "missing" : "ready"}>
              <span>{item.label} <i>필수</i></span>
              <input required value={listingDraftValue(draftObject, item.manualPath!)} placeholder={item.placeholder} onChange={(event) => updateManualDraftField(channel, item.manualPath!, event.target.value)} />
              {item.help && <small>{item.help}</small>}
            </label>)}</div>}
          </div>}
          {assignment && <small className="publish-category-path">{assignment.categoryPath.join(" › ")} · {assignment.categoryId}</small>}
          {listing?.status === "failed" && listing.lastError && <p className="publish-result failed" role="alert"><b>이전 등록 확인 필요</b> · {userFacingErrorMessage(listing.lastError, "상품 등록을 완료하지 못했습니다. 필수 정보를 확인하고 다시 시도해 주세요.")}</p>}
          {listing?.remoteId && <p className="publish-remote-id"><b>상품 번호</b>{listing.remoteId}</p>}
          {result.message && <p className={`publish-result ${result.phase}`} role={result.phase === "failed" ? "alert" : "status"}>{userFacingErrorMessage(result.message, result.phase === "failed" ? "상품 등록을 완료하지 못했습니다. 다시 시도해 주세요." : "상품 등록이 완료됐습니다.")}</p>}
          {confirmingChannel === channel && <div className="publish-write-confirmation channel" role="alertdialog" aria-label={`${definition.name} 상품 등록 최종 확인`}><AlertTriangle size={18} /><div><b>{definition.name}{target ? ` ${target.marketCode} · ${target.displayName}` : ""} 판매 계정에 상품 1건을 등록합니다.</b><small>판매가 {confirmationPrice.toLocaleString()} {confirmationCurrency} · 재고 {quantity}개</small></div><button type="button" className="credential-secondary" onClick={() => setConfirmingChannel(null)}>취소</button><button type="button" className="publish-confirm-execute" onClick={() => void executeChannel(channel, { skipConfirm: true })}>{definition.name}에 등록</button></div>}
          {channel === "qoo10" && qoo10StopConfirming && listing && qoo10StopConfirming.remoteId === listing.remoteId && <div className="publish-write-confirmation channel" role="alertdialog" aria-label="Qoo10 거래대기 전환 최종 확인"><AlertTriangle size={18} /><div><b>Qoo10 상품 {listing.remoteId}를 거래대기로 전환합니다.</b><small>새 이미지와 카테고리로 다시 등록할 수 있도록 현재 판매 상태를 변경합니다.</small></div><button type="button" className="credential-secondary" onClick={() => setQoo10StopConfirming(null)}>취소</button><button type="button" className="publish-confirm-execute" onClick={() => void stopQoo10Listing(qoo10StopConfirming)}>거래대기로 변경</button></div>}
          <button type="button" className="publish-execute" disabled={!credential || !assignment || invalidDraft || blockingCount > 0 || quantity < 1 || result.phase === "running" || listing?.status === "published" || confirmingChannel === channel} onClick={() => void executeChannel(channel)}>{result.phase === "running" ? <LoaderCircle className="spin" size={15} /> : listing?.status === "published" ? <Check size={15} /> : <Rocket size={15} />}{listing?.status === "published" ? "등록 완료" : quantity < 1 ? "등록 재고 1개 이상 필요" : blockingCount ? `필수 정보 ${blockingCount}개 입력 후 등록` : confirmingChannel === channel ? "마지막 확인" : "이 채널에 등록"}</button>
          {channel === "qoo10" && listing?.status === "published" && <button type="button" className="credential-secondary" disabled={result.phase === "running" || qoo10StopConfirming?.remoteId === listing.remoteId} onClick={() => setQoo10StopConfirming(listing)}><CirclePause size={15} />거래대기 전환 후 재등록</button>}
          {channel === "qoo10" && listing?.status === "published" && <label className="qoo10-remote-cleanup"><span>이전 Qoo10 상품 정리</span><input aria-label="정리할 이전 Qoo10 상품번호" inputMode="numeric" value={qoo10CleanupId} onChange={(event) => setQoo10CleanupId(event.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="9~10자리 상품번호" /><button type="button" className="credential-secondary" disabled={result.phase === "running" || !/^\d{9,10}$/.test(qoo10CleanupId)} onClick={requestPausePreviousQoo10Remote}><CirclePause size={15} />이전 상품 거래대기</button></label>}
          {channel === "qoo10" && qoo10CleanupConfirming && <div className="publish-write-confirmation channel" role="alertdialog" aria-label="이전 Qoo10 상품 거래대기 최종 확인"><AlertTriangle size={18} /><div><b>이전 Qoo10 상품 {qoo10CleanupConfirming}를 거래대기로 전환합니다.</b><small>현재 새 상품은 판매중 상태를 그대로 유지합니다.</small></div><button type="button" className="credential-secondary" onClick={() => setQoo10CleanupConfirming(null)}>취소</button><button type="button" className="publish-confirm-execute" onClick={() => void pausePreviousQoo10Remote(qoo10CleanupConfirming)}>거래대기로 변경</button></div>}
        </>}
      </article>;
    })}</div>
  </section>;
}
