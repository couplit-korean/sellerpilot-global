"use client";

import { AlertTriangle, Check, CircleCheck, CirclePause, Code2, LoaderCircle, PackageCheck, RefreshCw, Rocket, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activeChannelKeys, channelCatalog, type ActiveChannelKey } from "../lib/channels/catalog";
import { blockingListingRequirements, inspectListingDraft, listingDraftValue, setListingDraftValue } from "../lib/channels/listing-preflight";
import { qoo10CatalogCode, qoo10ExpiryDate, qoo10PauseParams, qoo10SellerCode } from "../lib/channels/qoo10";
import { createClient } from "../lib/supabase/client";
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
  channel: ActiveChannelKey;
  market: string;
  targetId: string;
  remoteId: string | null;
  status: string;
  lastError: string | null;
};

type ChannelTarget = { targetId: string; displayName: string; marketCode: string; locale: string; language: string; currency: string; status?: string };
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
  const sellerpilotAssets = { galleryImageUrls, detailImageUrls, detailAssetMode: dedicatedDetailReady ? "dedicated" : "legacy_fallback" };
  const localized = context.localizedListings?.find((item) => item.channel === channel && item.market === target?.marketCode);
  const manual = context.manualFields;
  const title = localized?.title || product.name;
  const description = localized?.description || product.description;
  const shortDescription = localized?.shortDescription || product.description.slice(0, 500);
  const marketSku = target ? `${manual.sellerSku || product.sku}-${target.marketCode}`.slice(0, 100) : manual.sellerSku || product.sku;
  if (channel === "qoo10") {
    return {
      sellerpilotAssets,
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
        ProductionPlace: manual.countryOfOrigin,
        AudultYN: "N",
        ContactTel: "",
        StandardImage: sourceImage,
        ItemDescription: `<section><h1>${html(product.name)}</h1><p>${html(product.description)}</p><dl><dt>Material</dt><dd>${html(manual.material)}</dd><dt>Package</dt><dd>${html(manual.packageContents)}</dd></dl></section>`,
        AdditionalOption: "",
        ItemType: "",
        RetailPrice: "0",
        ItemPrice: String(price),
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
    const attributeList = Object.entries(assignment?.providedAttributes ?? {}).map(([attribute_id, original_value_name]) => ({
      attribute_id: Number(attribute_id),
      attribute_value_list: /^\d+$/.test(original_value_name) ? [{ value_id: Number(original_value_name) }] : [{ original_value_name }],
    }));
    const commonProductFields = {
      category_id: Number(assignment?.categoryId ?? 0),
      description: description.slice(0, 3_000),
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
          original_price: price,
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
            Skus: { Sku: [{ SellerSku: marketSku, price: String(price), quantity: String(quantity), package_weight: String(packageFields.weight), package_length: String(packageFields.length), package_width: String(packageFields.width), package_height: String(packageFields.height), package_content: manual.packageContents.slice(0, 255), Status: "inactive", Images: { Image: galleryImageUrls } }] },
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
        items: [{ itemName: product.name, originalPrice: price, salePrice: price, maximumBuyCount: quantity, maximumBuyForPerson: quantity, maximumBuyForPersonPeriod: 1, outboundShippingTimeDay: 3, unitCount: 1, adultOnly: "EVERYONE", taxType: "TAX", parallelImported: "NOT_PARALLEL_IMPORTED", overseasPurchased: "NOT_OVERSEAS_PURCHASED", pccNeeded: false, externalVendorSku: manual.sellerSku || product.sku, barcode: manual.gtinStatus === "HAS_GTIN" ? manual.gtin : "", emptyBarcode: manual.gtinStatus === "NO_GTIN", emptyBarcodeReason: manual.gtinStatus === "NO_GTIN" ? "바코드가 없는 상품" : "", modelNo: manual.sellerSku || product.sku, images: galleryImageUrls.map((url, index) => ({ imageOrder: index, imageType: index === 0 ? "REPRESENTATION" : "DETAIL", vendorPath: url })), notices: [], attributes: categoryAttributes, contents: [{ contentsType: "TEXT", contentDetails: [{ content: product.description, detailType: "TEXT" }] }] }],
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
          name: product.name,
          detailContent: `<section><h1>${html(product.name)}</h1><p>${html(product.description)}</p></section>`,
          images: { representativeImage: { url: "PROGRAM_UPLOAD_PENDING" }, optionalImages: [] },
          salePrice: price,
          stockQuantity: quantity,
          detailAttribute: { minorPurchasable: true, productInfoProvidedNotice: { productInfoProvidedNoticeType: "ETC", etc: { returnCostReason: "상품상세 참조", noRefundReason: "상품상세 참조", qualityAssuranceStandard: "상품상세 참조", compensationProcedure: "상품상세 참조", troubleShootingContents: "상품상세 참조", itemName: product.name.slice(0, 50), modelName: (manual.sellerSku || product.sku).slice(0, 50), certificateDetails: "해당사항 없음", manufacturer: manual.manufacturer.slice(0, 200), customerServicePhoneNumber: "SERVER_MANAGED" } }, afterServiceInfo: { afterServiceTelephoneNumber: "SERVER_MANAGED", afterServiceGuideContent: "SERVER_MANAGED" }, originAreaInfo: { originAreaCode: "04", content: manual.countryOfOrigin }, sellerCodeInfo: { sellerManagementCode: manual.sellerSku || product.sku }, optionInfo: {}, supplementaryProductInfo: {}, purchaseReviewInfo: { purchaseReviewExposure: true } },
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
          price: { basePrice: { amount: String(price), currency: manual.currency || "KRW" } },
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
    inventoryItem: { availability: { shipToLocationAvailability: { quantity } }, condition: manual.condition, product: { title: product.name, description: product.description, imageUrls: galleryImageUrls, brand: manual.brandName, mpn: manual.sellerSku || product.sku, aspects: { ...(assignment?.providedAttributes ?? {}), Material: [manual.material], "Country/Region of Manufacture": [manual.countryOfOrigin] } } },
    offer: { sku: manual.sellerSku || product.sku, marketplaceId: "EBAY_US", format: "FIXED_PRICE", availableQuantity: quantity, categoryId: assignment?.categoryId ?? "", listingDescription: product.description, listingPolicies: { fulfillmentPolicyId: "SERVER_MANAGED", paymentPolicyId: "SERVER_MANAGED", returnPolicyId: "SERVER_MANAGED" }, merchantLocationKey: "SERVER_MANAGED", pricingSummary: { price: { value: String(price), currency: "USD" } } },
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
    galleryImages.length === 0 ? "marketplace thumbnail image" : "",
    assets.detailAssetMode !== "dedicated" || detailImages.length < 4 ? "dedicated marketplace detail images (4)" : "",
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
  if (channel === "lazada") return [...assetRequirements, !Array.isArray(value.imageUrls) || value.imageUrls.length === 0 ? "source imageUrls" : "", json.includes('"package_weight":"0"') || json.includes('"package_weight":""') ? "package size/weight" : ""].filter(Boolean);
  if (channel === "coupang") return [...assetRequirements, json.includes('"displayCategoryCode":0') ? "displayCategoryCode" : "", !json.includes('"vendorPath":"https://') ? "public product image" : ""].filter(Boolean);
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
  const [selectedTargets, setSelectedTargets] = useState<Partial<Record<ActiveChannelKey, ChannelTarget>>>({});
  const [price, setPrice] = useState(2500);
  const [globalBaseUsdPrice, setGlobalBaseUsdPrice] = useState(12.9);
  const [quantity, setQuantity] = useState(1);
  const [currency, setCurrency] = useState("JPY");
  const [packageFields, setPackageFields] = useState<PackageFields>({ weight: 0.35, length: 12, width: 12, height: 10 });
  const [loading, setLoading] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [confirmingChannel, setConfirmingChannel] = useState<ActiveChannelKey | null>(null);
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
      const [contextResponse, credentialsResponse, shopeeTargetsResponse, lazadaTargetsResponse] = await Promise.all([
        fetch(`/api/admin/products/${productId}/publish-context`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" }),
        supabase.rpc("sellerpilot_list_credentials"),
        fetchChannelTargets("shopee", accessToken),
        fetchChannelTargets("lazada", accessToken),
      ]);
      const payload = await contextResponse.json().catch(() => ({ message: "상품 준비 응답을 읽지 못했습니다." })) as PublishContext & { message?: string };
      if (!contextResponse.ok) throw new Error(payload.message ?? "상품 등록 준비 정보를 불러오지 못했습니다.");
      const nextPayload = { ...payload, manualFields: normalizeManualFields(payload), imageSpecs: Array.isArray(payload.imageSpecs) ? payload.imageSpecs : [] };
      const shopeePayload = await shopeeTargetsResponse.json().catch(() => ({ targets: [] })) as { targets?: ChannelTarget[] };
      const lazadaPayload = await lazadaTargetsResponse.json().catch(() => ({ targets: [] })) as { targets?: ChannelTarget[] };
      const shopeeTargets = shopeeTargetsResponse.ok && Array.isArray(shopeePayload.targets) ? shopeePayload.targets : [];
      const lazadaTargets = lazadaTargetsResponse.ok && Array.isArray(lazadaPayload.targets) ? lazadaPayload.targets : [];
      const initialTargets: Partial<Record<ActiveChannelKey, ChannelTarget>> = { shopee: shopeeTargets[0], lazada: lazadaTargets[0] };
      const manual = nextPayload.manualFields;
      const initialPrice = manual.sellingPrice;
      const initialQuantity = manual.stock;
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
      setSelectedTargets(initialTargets);
      setDrafts(buildDraftMap(nextPayload, initialPrice, initialQuantity, initialTargets, initialPackage, manual.currency === "USD" ? initialPrice : globalBaseUsdPriceRef.current));
    } catch (error) {
      notify(error instanceof Error ? error.message : "상품 등록 준비 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [notify, productId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshVersion]);

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
    const credential = activeCredentials.get(channel);
    const target = selectedTargets[channel];
    const assignment = context.assignments.find((item) => item.channel === channel && item.status === "confirmed" && (!target || item.market === target.marketCode));
    if (!credential || !assignment) {
      notify(`${channelCatalog[channel].name} 활성 키와 확정 카테고리를 확인해 주세요.`);
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
    const listingCurrency = target?.currency || currency;
    if (!options.skipConfirm) {
      setConfirmingChannel(channel);
      return false;
    }
    setConfirmingChannel(null);

    setResults((current) => ({ ...current, [channel]: { phase: "running" } }));
    try {
      const accessToken = options.accessToken ?? (await createClient().auth.getSession()).data.session?.access_token;
      if (!accessToken) throw new Error("관리자 로그인이 필요합니다.");
      const idempotencyKey = `listing:${productId}:${channel}:${target?.marketCode ?? "default"}:${await fingerprint({ channelArguments, listingCurrency, price })}`;
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
          price,
          market: target?.marketCode ?? "",
          targetId: target?.targetId ?? "",
          arguments: channelArguments,
        }),
      });
      const payload = await response.json().catch(() => ({ message: "채널 응답을 읽지 못했습니다." })) as { ok?: boolean; message?: string; safeMessage?: string; remoteId?: string; attemptId?: string };
      if (!response.ok || payload.ok !== true) throw Object.assign(new Error(payload.message ?? payload.safeMessage ?? "상품 등록이 실패했습니다."), { attemptId: payload.attemptId });
      setResults((current) => ({ ...current, [channel]: { phase: "succeeded", message: payload.safeMessage, remoteId: payload.remoteId, attemptId: payload.attemptId } }));
      notify(`${channelCatalog[channel].name} 상품 등록 성공 · 원격 ID ${payload.remoteId ?? "응답 확인 필요"}`);
      if (!options.deferRefresh) {
        await load();
        onChanged?.();
      }
      return true;
    } catch (error) {
      const attemptId = error && typeof error === "object" && "attemptId" in error && typeof error.attemptId === "string" ? error.attemptId : undefined;
      const message = error instanceof Error ? error.message : "상품 등록이 실패했습니다.";
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
      return Boolean(credential && assignment && !hasMissingRequired && listing?.status !== "published" && results[channel]?.phase !== "running");
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
      if (!accessToken) throw new Error("관리자 로그인이 필요합니다.");
      const completed = await Promise.all(readyChannels.map((channel) => executeChannel(channel, { skipConfirm: true, accessToken, deferRefresh: true })));
      const succeeded = completed.filter(Boolean).length;
      await load();
      onChanged?.();
      notify(`동시 등록 완료 · 성공 ${succeeded}개 / 확인 필요 ${readyChannels.length - succeeded}개`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "동시 채널 등록을 완료하지 못했습니다.");
    } finally {
      setBulkRunning(false);
    }
  };

  const stopQoo10Listing = async (listing: Listing) => {
    const credential = activeCredentials.get("qoo10");
    if (!credential || !listing.remoteId || !productId) return notify("Qoo10 활성 키와 원격 상품번호를 확인해 주세요.");
    if (!window.confirm(`Qoo10 원격 상품 ${listing.remoteId}를 공식 API의 거래대기 상태로 전환하고 이 상품을 재등록 가능한 상태로 되돌릴까요?`)) return;
    setResults((current) => ({ ...current, qoo10: { phase: "running", message: "Qoo10 거래대기 전환 요청 중" } }));
    try {
      const accessToken = (await createClient().auth.getSession()).data.session?.access_token;
      if (!accessToken) throw new Error("관리자 로그인이 필요합니다.");
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
      if (!response.ok || payload.ok !== true) throw Object.assign(new Error(payload.message ?? payload.safeMessage ?? "Qoo10 판매 중지에 실패했습니다."), { attemptId: payload.attemptId });
      setResults((current) => ({ ...current, qoo10: { phase: "succeeded", message: payload.safeMessage, attemptId: payload.attemptId } }));
      await load();
      onChanged?.();
      notify("Qoo10 상품을 거래대기로 전환했고 올바른 카테고리로 다시 등록할 수 있습니다.");
    } catch (error) {
      setResults((current) => ({ ...current, qoo10: { phase: "failed", message: error instanceof Error ? error.message : "Qoo10 판매 중지에 실패했습니다." } }));
      notify(error instanceof Error ? error.message : "Qoo10 판매 중지에 실패했습니다.");
    }
  };

  const pausePreviousQoo10Remote = async () => {
    const credential = activeCredentials.get("qoo10");
    const remoteId = qoo10CleanupId.trim();
    if (!credential) return notify("Qoo10 활성 키를 확인해 주세요.");
    let params: ReturnType<typeof qoo10PauseParams>;
    try {
      params = qoo10PauseParams(remoteId);
    } catch {
      return notify("정리할 Qoo10 상품번호 9~10자리를 입력해 주세요.");
    }
    if (!window.confirm(`이전 Qoo10 원격 상품 ${remoteId}를 거래대기 상태로 전환합니다. 현재 새 상품은 그대로 판매중으로 유지합니다. 계속할까요?`)) return;
    setResults((current) => ({ ...current, qoo10: { phase: "running", message: `이전 원격 상품 ${remoteId} 거래대기 전환 중` } }));
    try {
      const accessToken = (await createClient().auth.getSession()).data.session?.access_token;
      if (!accessToken) throw new Error("관리자 로그인이 필요합니다.");
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
      if (!response.ok || payload.ok !== true) throw Object.assign(new Error(payload.message ?? payload.safeMessage ?? "Qoo10 거래대기 전환에 실패했습니다."), { attemptId: payload.attemptId });
      setResults((current) => ({ ...current, qoo10: { phase: "succeeded", message: `이전 원격 상품 ${remoteId} 거래대기 전환 요청 완료`, attemptId: payload.attemptId } }));
      setQoo10CleanupId("");
      notify(`이전 Qoo10 원격 상품 ${remoteId}를 거래대기로 전환했습니다.`);
    } catch (error) {
      setResults((current) => ({ ...current, qoo10: { phase: "failed", message: error instanceof Error ? error.message : "Qoo10 거래대기 전환에 실패했습니다." } }));
      notify(error instanceof Error ? error.message : "Qoo10 거래대기 전환에 실패했습니다.");
    }
  };

  if (!productId) return <section className="panel product-publish-workbench disabled"><PackageCheck size={28} /><b>실제 채널 등록은 상품 원장 생성 후 열립니다.</b><small>대표사진 분석을 완료하면 상품 UUID와 채널 등록 초안이 자동으로 연결됩니다.</small></section>;
  if (loading && !context) return <section className="panel product-publish-workbench disabled"><LoaderCircle className="spin" size={26} /><b>상품·카테고리·이미지 원장 확인 중</b></section>;
  if (!context) return <section className="panel product-publish-workbench disabled"><AlertTriangle size={26} /><b>상품 등록 준비 정보를 불러오지 못했습니다.</b><button type="button" onClick={() => void load()}><RefreshCw size={14} />다시 확인</button></section>;

  const marketplaceThumbnailCount = context.generatedImages.filter((item) => (item.id === "square" || item.id === "hero") && item.url).length;
  const dedicatedDetailImageCount = context.generatedImages.filter((item) => item.id.startsWith("detail-") && item.url).length;
  const imagePackageReady = marketplaceThumbnailCount >= 1 && dedicatedDetailImageCount >= 4;

  return <section className="panel product-publish-workbench">
    <div className="publish-workbench-head"><div><span className="panel-kicker">FINAL WRITE PREFLIGHT</span><h3>실제 채널 등록 실행</h3><p>공식 카테고리, 원본 대표사진, 가격·재고와 채널 필수값을 마지막으로 검증한 뒤 준비된 채널을 최대 8개까지 병렬 실행합니다.</p></div><div className="publish-head-actions"><span className="step-chip">FINAL</span><button type="button" className="publish-bulk-execute" disabled={bulkRunning || bulkConfirming} onClick={() => void executeReadyChannels()}>{bulkRunning ? <LoaderCircle className="spin" size={15} /> : <Rocket size={15} />}{bulkRunning ? "동시 등록 중" : bulkConfirming ? "최종 확인 열림" : "최대 8개 동시 등록"}</button></div></div>
    {bulkConfirming && <div className="publish-write-confirmation" role="alertdialog" aria-label="다중 채널 실제 등록 최종 확인"><AlertTriangle size={18} /><div><b>준비된 모든 채널에 실제 상품을 등록합니다.</b><small>채널별 payload와 가격·재고를 최종 확인한 뒤 실행하세요.</small></div><button type="button" className="credential-secondary" onClick={() => setBulkConfirming(false)}>취소</button><button type="button" className="publish-confirm-execute" onClick={() => void executeReadyChannels(true)}>확인 후 동시 등록 실행</button></div>}
    <div className="publish-common-fields">
      <label><span>국가별 판매가 <i>필수</i></span><input required type="number" min="0.01" step="0.01" value={price} onChange={(event) => { const value = Number(event.target.value); priceRef.current = value; setPrice(value); }} /></label>
      <label><span>판매 통화 <i>필수</i></span><input required value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></label>
      <label><span>Shopee 글로벌 기준가 USD <i>필수</i></span><input required type="number" min="0.01" step="0.01" value={globalBaseUsdPrice} onChange={(event) => { const value = Number(event.target.value); globalBaseUsdPriceRef.current = value; setGlobalBaseUsdPrice(value); }} /></label>
      <label><span>재고 <i>필수</i></span><input required type="number" min="1" step="1" value={quantity} onChange={(event) => { const value = Number(event.target.value); quantityRef.current = value; setQuantity(value); }} /></label>
      <label><span>중량 kg <i>필수</i></span><input required type="number" min="0.01" step="0.01" value={packageFields.weight} onChange={(event) => { const next = { ...packageFields, weight: Number(event.target.value) }; packageFieldsRef.current = next; setPackageFields(next); }} /></label>
      <label><span>가로 cm <i>필수</i></span><input required type="number" min="1" step="1" value={packageFields.length} onChange={(event) => { const next = { ...packageFields, length: Number(event.target.value) }; packageFieldsRef.current = next; setPackageFields(next); }} /></label>
      <label><span>세로 cm <i>필수</i></span><input required type="number" min="1" step="1" value={packageFields.width} onChange={(event) => { const next = { ...packageFields, width: Number(event.target.value) }; packageFieldsRef.current = next; setPackageFields(next); }} /></label>
      <label><span>높이 cm <i>필수</i></span><input required type="number" min="1" step="1" value={packageFields.height} onChange={(event) => { const next = { ...packageFields, height: Number(event.target.value) }; packageFieldsRef.current = next; setPackageFields(next); }} /></label>
      <label><span>브랜드 <i>필수</i></span><input required value={context.manualFields.brandName} onChange={(event) => updateProductFact("brandName", event.target.value)} placeholder="브랜드명 또는 No Brand" /></label>
      <label><span>제조사·공급처 <i>필수</i></span><input required value={context.manualFields.manufacturer} onChange={(event) => updateProductFact("manufacturer", event.target.value)} placeholder="실제 제조사 또는 공급처" /></label>
      <label><span>원산지 <i>필수</i></span><input required value={context.manualFields.countryOfOrigin} onChange={(event) => updateProductFact("countryOfOrigin", event.target.value)} placeholder="예: 대한민국" /></label>
      <label><span>재질·성분 <i>필수</i></span><input required value={context.manualFields.material} onChange={(event) => updateProductFact("material", event.target.value)} placeholder="실물·공식 상품정보 기준" /></label>
      <label><span>판매 구성품 <i>필수</i></span><input required value={context.manualFields.packageContents} onChange={(event) => updateProductFact("packageContents", event.target.value)} placeholder="예: 본품 1개" /></label>
      <button type="button" onClick={() => setDrafts(buildDraftMap(context, price, quantity, selectedTargets, packageFields, globalBaseUsdPrice))}><RefreshCw size={14} />공통값으로 초안 갱신</button>
    </div>
    <div className="publish-source-proof"><span><ShieldCheck size={15} /><b>필수값 원장</b>{context.manualFields.sellerSku}</span><span><Check size={15} /><b>마켓 이미지 세트</b>대표 {marketplaceThumbnailCount}장 · 상세 전용 {dedicatedDetailImageCount}/4장</span><span><Check size={15} /><b>등록 직전 보정</b>1200×1200 JPEG · 3MB 이하 · 공개 URL 재검증</span><span><Check size={15} /><b>카테고리 확정</b>{context.assignments.filter((item) => item.status === "confirmed").length}개 채널</span></div>
    {!imagePackageReady && <div className="publish-write-confirmation" role="alert"><AlertTriangle size={18} /><div><b>대표 썸네일과 상세 전용 이미지 4장이 모두 필요합니다.</b><small>이전 4종 생성 상품은 실제 등록을 차단했습니다. 상품 등록 화면에서 AI 상세·썸네일을 다시 생성하면 새 8종 이미지 세트로 교체됩니다.</small></div></div>}
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
      return <article key={channel} className={`publish-channel-card ${result.phase}`}>
        <header><span style={{ background: channels[channel].color }}>{definition.code}</span><div><small>{definition.market}</small><h4>{definition.name}</h4></div><em>{listing?.status === "published" ? "등록 완료" : credential ? assignment ? invalidDraft ? "JSON 확인 필요" : blockingCount ? `필수 보완 ${blockingCount}` : "실행 준비" : channelAssignment?.status === "rejected" ? "카테고리 권한 필요" : "카테고리 필요" : "키 필요"}</em></header>
        {(channel === "shopee" || channel === "lazada") && (availableTargets[channel]?.length ?? 0) > 0 && <label className="publish-market-select"><span>판매 국가·계정</span><select value={target?.marketCode ?? ""} onChange={(event) => { const nextTarget = availableTargets[channel]?.find((item) => item.marketCode === event.target.value); if (!nextTarget) return; const nextTargets = { ...selectedTargets, [channel]: nextTarget }; setSelectedTargets(nextTargets); setCurrency(nextTarget.currency); setDrafts((current) => ({ ...current, [channel]: JSON.stringify(buildChannelArguments(channel, context, price, quantity, nextTarget, packageFields, globalBaseUsdPrice), null, 2) })); }}>{availableTargets[channel]?.map((item) => <option value={item.marketCode} key={`${item.marketCode}-${item.targetId}`}>{item.marketCode} · {item.displayName || item.language} · {item.currency}</option>)}</select></label>}
        {capability.mode === "vendor_docs_required" ? <div className="publish-blocked"><AlertTriangle size={18} /><b>판매자 상세 명세 승인 필요</b><small>{capability.note}</small></div> : <>
          <div className="publish-readiness"><span className={credential ? "ok" : "missing"}>{credential ? <CircleCheck size={14} /> : <AlertTriangle size={14} />}운영 키</span><span className={assignment ? "ok" : "missing"}>{assignment ? <CircleCheck size={14} /> : <AlertTriangle size={14} />}말단 카테고리</span><span className={context.sourceImages[0]?.url ? "ok" : "missing"}>{context.sourceImages[0]?.url ? <CircleCheck size={14} /> : <AlertTriangle size={14} />}원본 대표사진</span><span className={imagePackageReady ? "ok" : "missing"}>{imagePackageReady ? <CircleCheck size={14} /> : <AlertTriangle size={14} />}대표+상세 4장</span></div>
          {channelAssignment?.status === "rejected" && <div className="publish-blocked"><AlertTriangle size={18} /><b>현재 카테고리는 이 판매자 계정에서 등록할 수 없습니다.</b><small>권한을 먼저 승인받거나, 상품과 정확히 일치하면서 판매 권한이 있는 말단 카테고리를 다시 검색·확정해야 합니다. 다른 상품군으로 위장 등록하지 않습니다.</small></div>}
          {nativeMissing.length > 0 && <div className="publish-blocked"><AlertTriangle size={18} /><b>등록 전에 자동 생성·필수값 보완이 필요합니다.</b><small>{nativeMissing.join(", ")}</small></div>}
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
          {listing?.status === "failed" && listing.lastError && <p className="publish-result failed"><b>이전 등록 실패</b> · {listing.lastError}</p>}
          <details><summary><Code2 size={14} />채널 공식 payload 최종 검토</summary><textarea value={drafts[channel] ?? "{}"} onChange={(event) => setDrafts((current) => ({ ...current, [channel]: event.target.value }))} spellCheck={false} /></details>
          {listing?.remoteId && <p className="publish-remote-id"><b>원격 ID</b>{listing.remoteId} · {listing.status}</p>}
          {result.message && <p className={`publish-result ${result.phase}`}>{result.message}{result.attemptId ? <small>작업 ID {result.attemptId}</small> : null}</p>}
          {confirmingChannel === channel && <div className="publish-write-confirmation channel" role="alertdialog" aria-label={`${definition.name} 실제 등록 최종 확인`}><AlertTriangle size={18} /><div><b>{definition.name}{target ? ` ${target.marketCode} · ${target.displayName}` : ""} 운영 계정에 실제 상품 1건을 등록합니다.</b><small>가격 {price.toLocaleString()} {target?.currency || currency} · 재고 {quantity}개</small></div><button type="button" className="credential-secondary" onClick={() => setConfirmingChannel(null)}>취소</button><button type="button" className="publish-confirm-execute" onClick={() => void executeChannel(channel, { skipConfirm: true })}>{definition.name} 실제 등록 실행</button></div>}
          <button type="button" className="publish-execute" disabled={!credential || !assignment || invalidDraft || blockingCount > 0 || result.phase === "running" || listing?.status === "published" || confirmingChannel === channel} onClick={() => void executeChannel(channel)}>{result.phase === "running" ? <LoaderCircle className="spin" size={15} /> : listing?.status === "published" ? <Check size={15} /> : <Rocket size={15} />}{listing?.status === "published" ? "등록 완료" : blockingCount ? `필수 보완 ${blockingCount}개 후 등록` : confirmingChannel === channel ? "최종 확인 열림" : "검증 후 실제 1건 등록"}</button>
          {channel === "qoo10" && listing?.status === "published" && <button type="button" className="credential-secondary" disabled={result.phase === "running"} onClick={() => void stopQoo10Listing(listing)}><CirclePause size={15} />거래대기 전환 후 재등록</button>}
          {channel === "qoo10" && listing?.status === "published" && <label className="qoo10-remote-cleanup"><span>이전 Qoo10 상품 정리</span><input aria-label="정리할 이전 Qoo10 상품번호" inputMode="numeric" value={qoo10CleanupId} onChange={(event) => setQoo10CleanupId(event.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="9~10자리 상품번호" /><button type="button" className="credential-secondary" disabled={result.phase === "running" || !/^\d{9,10}$/.test(qoo10CleanupId)} onClick={() => void pausePreviousQoo10Remote()}><CirclePause size={15} />이전 상품 거래대기</button></label>}
        </>}
      </article>;
    })}</div>
  </section>;
}
