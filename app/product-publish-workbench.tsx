"use client";

import { AlertTriangle, Check, CircleCheck, Code2, LoaderCircle, PackageCheck, RefreshCw, Rocket, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activeChannelKeys, channelCatalog, type ActiveChannelKey } from "../lib/channels/catalog";
import { createClient } from "../lib/supabase/client";
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
  assignments: Assignment[];
  listings: Listing[];
  sourceImages: Array<{ path: string; url: string | null }>;
  generatedImages: Array<{ id: string; path: string; url: string | null }>;
  localizedListings: LocalizedListing[];
};

type ChannelResult = { phase: "idle" | "running" | "succeeded" | "failed"; message?: string; remoteId?: string; attemptId?: string };

function html(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character));
}

function qoo10Expiry() {
  const year = new Date().getUTCFullYear() + 1;
  return `${year}-12-31`;
}

function buildChannelArguments(channel: ActiveChannelKey, context: PublishContext, price: number, quantity: number, target: ChannelTarget | undefined, packageFields: PackageFields, globalBaseUsdPrice: number) {
  const assignment = context.assignments.find((item) => item.channel === channel && item.status === "confirmed" && (!target || item.market === target.marketCode));
  const product = context.product;
  const sourceImage = context.sourceImages[0]?.url ?? "";
  const localized = context.localizedListings?.find((item) => item.channel === channel && item.market === target?.marketCode);
  const title = localized?.title || product.name;
  const description = localized?.description || product.description;
  const shortDescription = localized?.shortDescription || product.description.slice(0, 500);
  const marketSku = target ? `${product.sku}-${target.marketCode}`.slice(0, 100) : product.sku;
  const imageUrls = [...context.sourceImages, ...context.generatedImages].map((item) => item.url).filter((url): url is string => Boolean(url));
  if (channel === "qoo10") {
    return {
      params: {
        SecondSubCat: assignment?.categoryId ?? "",
        OuterSecondSubCat: "",
        Drugtype: "",
        ManufactureNo: "",
        BrandNo: "",
        ItemTitle: product.name.slice(0, 200),
        PromotionName: product.description.slice(0, 20),
        SellerCode: product.sku.slice(0, 200),
        IndustrialCode: "",
        ProductionPlace: "韓国",
        AudultYN: "N",
        ContactTel: "",
        StandardImage: sourceImage,
        ItemDescription: `<section><h1>${html(product.name)}</h1><p>${html(product.description)}</p></section>`,
        AdditionalOption: "",
        ItemType: "",
        RetailPrice: "0",
        ItemPrice: String(price),
        TaxRate: "S",
        ItemQty: String(quantity),
        ExpireDate: qoo10Expiry(),
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
      brand: { brand_id: 0, original_brand_name: "No Brand" },
      condition: "NEW",
      normal_stock: quantity,
      seller_stock: [{ stock: quantity }],
      image: { image_id_list: [] },
      weight: packageFields.weight,
      dimension: { package_length: packageFields.length, package_width: packageFields.width, package_height: packageFields.height },
      pre_order: { is_pre_order: false, days_to_ship: 1 },
      attribute_list: attributeList,
    };
    const globalSku = `${product.sku}-GLOBAL`.slice(0, 100);
    return {
      globalProduct: true,
      shopId: target?.targetId ?? "",
      country: target?.marketCode.toLowerCase() ?? "",
      imageUrls,
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
    return {
      country: target?.marketCode.toLowerCase() ?? "my",
      imageUrls,
      request: {
        Request: {
          Product: {
            PrimaryCategory: assignment?.categoryId ?? "",
            Images: { Image: [] },
            Attributes: { name: title.slice(0, 255), description, short_description: shortDescription.slice(0, 500), brand: "No Brand", ...(assignment?.providedAttributes ?? {}) },
            Skus: { Sku: [{ SellerSku: marketSku, price: String(price), quantity: String(quantity), package_weight: String(packageFields.weight), package_length: String(packageFields.length), package_width: String(packageFields.width), package_height: String(packageFields.height), package_content: title.slice(0, 255), Status: "inactive", Images: { Image: [] } }] },
          },
        },
      },
    };
  }
  if (channel === "coupang") {
    return {
      body: {
        displayCategoryCode: Number(assignment?.categoryId ?? 0),
        sellerProductName: product.name,
        displayedProductName: product.name,
        vendorId: "SERVER_MANAGED",
        saleStartedAt: "",
        saleEndedAt: "",
        brand: "",
        generalProductName: product.name,
        deliveryMethod: "SEQUENCIAL",
        deliveryCompanyCode: "",
        deliveryChargeType: "FREE",
        deliveryCharge: 0,
        freeShipOverAmount: 0,
        deliveryChargeOnReturn: 0,
        returnCharge: 0,
        outboundShippingPlaceCode: "",
        returnCenterCode: "",
        returnCenterName: "",
        companyContactNumber: "",
        returnZipCode: "",
        returnAddress: "",
        returnAddressDetail: "",
        requested: true,
        items: [{ itemName: product.name, originalPrice: price, salePrice: price, maximumBuyCount: quantity, maximumBuyForPerson: quantity, maximumBuyForPersonPeriod: 1, outboundShippingTimeDay: 3, unitCount: 1, adultOnly: "EVERYONE", taxType: "TAX", parallelImported: "NOT_PARALLEL_IMPORTED", overseasPurchased: "NOT_OVERSEAS_PURCHASED", pccNeeded: false, externalVendorSku: product.sku, barcode: "", emptyBarcode: true, emptyBarcodeReason: "상품 확인 필요", modelNo: product.sku, images: [{ imageOrder: 0, imageType: "REPRESENTATION", vendorPath: sourceImage }], notices: [], attributes: [], contents: [{ contentsType: "TEXT", contentDetails: [{ content: product.description, detailType: "TEXT" }] }] }],
      },
    };
  }
  if (channel === "smartstore") {
    return {
      body: {
        originProduct: {
          statusType: "SALE",
          saleType: "NEW",
          leafCategoryId: assignment?.categoryId ?? "",
          name: product.name,
          detailContent: `<section><h1>${html(product.name)}</h1><p>${html(product.description)}</p></section>`,
          images: { representativeImage: { url: "NAVER_UPLOADED_IMAGE_URL_REQUIRED" }, optionalImages: [] },
          salePrice: price,
          stockQuantity: quantity,
          deliveryInfo: {},
          detailAttribute: { afterServiceInfo: {}, originAreaInfo: {}, sellerCodeInfo: { sellerManagementCode: product.sku }, optionInfo: {}, supplementaryProductInfo: {}, purchaseReviewInfo: { purchaseReviewExposure: true } },
          customerBenefit: {},
        },
        smartstoreChannelProduct: { naverShoppingRegistration: true, channelProductName: product.name },
      },
    };
  }
  return {
    sku: product.sku,
    inventoryItem: { availability: { shipToLocationAvailability: { quantity } }, condition: "NEW", product: { title: product.name, description: product.description, imageUrls: sourceImage ? [sourceImage] : [], aspects: assignment?.providedAttributes ?? {} } },
    offer: { sku: product.sku, marketplaceId: "EBAY_US", format: "FIXED_PRICE", availableQuantity: quantity, categoryId: assignment?.categoryId ?? "", listingDescription: product.description, listingPolicies: { fulfillmentPolicyId: "", paymentPolicyId: "", returnPolicyId: "" }, merchantLocationKey: "", pricingSummary: { price: { value: String(price), currency: "USD" } } },
    publish: true,
  };
}

function missingNativeValues(channel: ActiveChannelKey, value: Record<string, unknown>) {
  const json = JSON.stringify(value);
  if (channel === "qoo10") {
    const params = value.params as Record<string, unknown> | undefined;
    return ["SecondSubCat", "ItemTitle", "StandardImage", "ItemDescription", "ItemPrice", "ItemQty", "ShippingNo", "AvailableDateType", "AvailableDateValue"]
      .filter((key) => params?.[key] === undefined || String(params[key]).trim() === "");
  }
  if (channel === "shopee") return [!String(value.shopId ?? "").trim() ? "shopId" : "", !Array.isArray(value.imageUrls) || value.imageUrls.length === 0 ? "source imageUrls" : "", json.includes('"weight":0') ? "package weight" : ""].filter(Boolean);
  if (channel === "lazada") return [!Array.isArray(value.imageUrls) || value.imageUrls.length === 0 ? "source imageUrls" : "", json.includes('"package_weight":"0"') || json.includes('"package_weight":""') ? "package size/weight" : ""].filter(Boolean);
  if (channel === "coupang") return ["outboundShippingPlaceCode", "returnCenterCode", "notices", "category attributes"].filter((key) => json.includes(`"${key}":""`) || json.includes(`"${key}":[]`));
  if (channel === "smartstore") return [json.includes("NAVER_UPLOADED_IMAGE_URL_REQUIRED") ? "Naver uploaded image" : "", json.includes('"deliveryInfo":{}') ? "deliveryInfo" : "", json.includes('"afterServiceInfo":{}') ? "afterServiceInfo/originAreaInfo" : ""].filter(Boolean);
  return [json.includes('"fulfillmentPolicyId":""') ? "business policy IDs" : "", json.includes('"merchantLocationKey":""') ? "merchantLocationKey" : ""].filter(Boolean);
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
        fetch("/api/admin/channel-targets?channel=shopee", { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" }),
        fetch("/api/admin/channel-targets?channel=lazada", { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" }),
      ]);
      const payload = await contextResponse.json().catch(() => ({ message: "상품 준비 응답을 읽지 못했습니다." })) as PublishContext & { message?: string };
      if (!contextResponse.ok) throw new Error(payload.message ?? "상품 등록 준비 정보를 불러오지 못했습니다.");
      const shopeePayload = await shopeeTargetsResponse.json().catch(() => ({ targets: [] })) as { targets?: ChannelTarget[] };
      const lazadaPayload = await lazadaTargetsResponse.json().catch(() => ({ targets: [] })) as { targets?: ChannelTarget[] };
      const shopeeTargets = shopeeTargetsResponse.ok && Array.isArray(shopeePayload.targets) ? shopeePayload.targets : [];
      const lazadaTargets = lazadaTargetsResponse.ok && Array.isArray(lazadaPayload.targets) ? lazadaPayload.targets : [];
      const initialTargets: Partial<Record<ActiveChannelKey, ChannelTarget>> = { shopee: shopeeTargets[0], lazada: lazadaTargets[0] };
      setContext(payload);
      setCredentials(Array.isArray(credentialsResponse.data) ? credentialsResponse.data as CredentialRow[] : []);
      setAvailableTargets({ shopee: shopeeTargets, lazada: lazadaTargets });
      setSelectedTargets(initialTargets);
      setDrafts(buildDraftMap(payload, priceRef.current, quantityRef.current, initialTargets, packageFieldsRef.current, globalBaseUsdPriceRef.current));
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

  const executeChannel = async (channel: ActiveChannelKey) => {
    if (!context || !productId) return;
    const credential = activeCredentials.get(channel);
    const target = selectedTargets[channel];
    const assignment = context.assignments.find((item) => item.channel === channel && item.status === "confirmed" && (!target || item.market === target.marketCode));
    if (!credential || !assignment) return notify(`${channelCatalog[channel].name} 활성 키와 확정 카테고리를 확인해 주세요.`);
    let channelArguments: Record<string, unknown>;
    try {
      channelArguments = JSON.parse(drafts[channel] ?? "{}") as Record<string, unknown>;
    } catch {
      return notify(`${channelCatalog[channel].name} 등록 JSON 형식을 확인해 주세요.`);
    }
    const missing = missingNativeValues(channel, channelArguments);
    if (missing.length) return notify(`${channelCatalog[channel].name} 필수값 보완: ${missing.join(", ")}`);
    const listingCurrency = target?.currency || currency;
    const confirmed = window.confirm(`${channelCatalog[channel].name}${target ? ` ${target.marketCode} · ${target.displayName}` : ""} 운영 계정에 실제 상품 1건을 등록합니다. 가격 ${price.toLocaleString()} ${listingCurrency}, 재고 ${quantity}개가 맞습니까?`);
    if (!confirmed) return;

    setResults((current) => ({ ...current, [channel]: { phase: "running" } }));
    try {
      const { data: sessionData } = await createClient().auth.getSession();
      const accessToken = sessionData.session?.access_token;
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
      await load();
      onChanged?.();
    } catch (error) {
      const attemptId = error && typeof error === "object" && "attemptId" in error && typeof error.attemptId === "string" ? error.attemptId : undefined;
      const message = error instanceof Error ? error.message : "상품 등록이 실패했습니다.";
      setResults((current) => ({ ...current, [channel]: { phase: "failed", message, attemptId } }));
      notify(`${channelCatalog[channel].name}: ${message}`);
    }
  };

  if (!productId) return <section className="panel product-publish-workbench disabled"><PackageCheck size={28} /><b>실제 채널 등록은 상품 원장 생성 후 열립니다.</b><small>대표사진 분석을 완료하면 상품 UUID와 채널 등록 초안이 자동으로 연결됩니다.</small></section>;
  if (loading && !context) return <section className="panel product-publish-workbench disabled"><LoaderCircle className="spin" size={26} /><b>상품·카테고리·이미지 원장 확인 중</b></section>;
  if (!context) return <section className="panel product-publish-workbench disabled"><AlertTriangle size={26} /><b>상품 등록 준비 정보를 불러오지 못했습니다.</b><button type="button" onClick={() => void load()}><RefreshCw size={14} />다시 확인</button></section>;

  return <section className="panel product-publish-workbench">
    <div className="publish-workbench-head"><div><span className="panel-kicker">FINAL WRITE PREFLIGHT</span><h3>실제 채널 등록 실행</h3><p>공식 카테고리, 원본 대표사진, 가격·재고와 채널 필수값을 마지막으로 검증한 뒤 운영 API에 1건씩 등록합니다.</p></div><span className="step-chip">FINAL</span></div>
    <div className="publish-common-fields"><label><span>국가별 판매가</span><input type="number" min="0" step="0.01" value={price} onChange={(event) => { const value = Number(event.target.value); priceRef.current = value; setPrice(value); }} /></label><label><span>판매 통화</span><input value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></label><label><span>Shopee 글로벌 기준가 USD</span><input type="number" min="0.01" step="0.01" value={globalBaseUsdPrice} onChange={(event) => { const value = Number(event.target.value); globalBaseUsdPriceRef.current = value; setGlobalBaseUsdPrice(value); }} /></label><label><span>재고</span><input type="number" min="0" step="1" value={quantity} onChange={(event) => { const value = Number(event.target.value); quantityRef.current = value; setQuantity(value); }} /></label><label><span>중량 kg</span><input type="number" min="0.01" step="0.01" value={packageFields.weight} onChange={(event) => { const next = { ...packageFields, weight: Number(event.target.value) }; packageFieldsRef.current = next; setPackageFields(next); }} /></label><label><span>가로 cm</span><input type="number" min="1" step="1" value={packageFields.length} onChange={(event) => { const next = { ...packageFields, length: Number(event.target.value) }; packageFieldsRef.current = next; setPackageFields(next); }} /></label><label><span>세로 cm</span><input type="number" min="1" step="1" value={packageFields.width} onChange={(event) => { const next = { ...packageFields, width: Number(event.target.value) }; packageFieldsRef.current = next; setPackageFields(next); }} /></label><label><span>높이 cm</span><input type="number" min="1" step="1" value={packageFields.height} onChange={(event) => { const next = { ...packageFields, height: Number(event.target.value) }; packageFieldsRef.current = next; setPackageFields(next); }} /></label><button type="button" onClick={() => setDrafts(buildDraftMap(context, price, quantity, selectedTargets, packageFields, globalBaseUsdPrice))}><RefreshCw size={14} />공통값으로 초안 갱신</button></div>
    <div className="publish-source-proof"><span><ShieldCheck size={15} /><b>상품 원장</b>{context.product.sku}</span><span><Check size={15} /><b>원본 이미지</b>{context.sourceImages.length}장</span><span><Check size={15} /><b>카테고리 확정</b>{context.assignments.filter((item) => item.status === "confirmed").length}개 채널</span></div>
    <div className="publish-channel-cards">{visibleChannels.map((channel) => {
      const definition = channelCatalog[channel];
      const credential = activeCredentials.get(channel);
      const target = selectedTargets[channel];
      const assignment = context.assignments.find((item) => item.channel === channel && item.status === "confirmed" && (!target || item.market === target.marketCode));
      const listing = context.listings.find((item) => item.channel === channel && (!target || item.market === target.marketCode && item.targetId === target.targetId));
      const result = results[channel] ?? { phase: "idle" as const };
      const capability = definition.capabilities.listingCreate;
      return <article key={channel} className={`publish-channel-card ${result.phase}`}>
        <header><span style={{ background: channels[channel].color }}>{definition.code}</span><div><small>{definition.market}</small><h4>{definition.name}</h4></div><em>{listing?.status === "published" ? "등록 완료" : credential ? assignment ? "실행 준비" : "카테고리 필요" : "키 필요"}</em></header>
        {(channel === "shopee" || channel === "lazada") && (availableTargets[channel]?.length ?? 0) > 0 && <label className="publish-market-select"><span>판매 국가·계정</span><select value={target?.marketCode ?? ""} onChange={(event) => { const nextTarget = availableTargets[channel]?.find((item) => item.marketCode === event.target.value); if (!nextTarget) return; const nextTargets = { ...selectedTargets, [channel]: nextTarget }; setSelectedTargets(nextTargets); setCurrency(nextTarget.currency); setDrafts((current) => ({ ...current, [channel]: JSON.stringify(buildChannelArguments(channel, context, price, quantity, nextTarget, packageFields, globalBaseUsdPrice), null, 2) })); }}>{availableTargets[channel]?.map((item) => <option value={item.marketCode} key={`${item.marketCode}-${item.targetId}`}>{item.marketCode} · {item.displayName || item.language} · {item.currency}</option>)}</select></label>}
        {capability.mode === "vendor_docs_required" ? <div className="publish-blocked"><AlertTriangle size={18} /><b>판매자 상세 명세 승인 필요</b><small>{capability.note}</small></div> : <>
          <div className="publish-readiness"><span className={credential ? "ok" : "missing"}>{credential ? <CircleCheck size={14} /> : <AlertTriangle size={14} />}운영 키</span><span className={assignment ? "ok" : "missing"}>{assignment ? <CircleCheck size={14} /> : <AlertTriangle size={14} />}말단 카테고리</span><span className={context.sourceImages[0]?.url ? "ok" : "missing"}>{context.sourceImages[0]?.url ? <CircleCheck size={14} /> : <AlertTriangle size={14} />}원본 대표사진</span></div>
          {assignment && <small className="publish-category-path">{assignment.categoryPath.join(" › ")} · {assignment.categoryId}</small>}
          <details><summary><Code2 size={14} />채널 공식 payload 최종 검토</summary><textarea value={drafts[channel] ?? "{}"} onChange={(event) => setDrafts((current) => ({ ...current, [channel]: event.target.value }))} spellCheck={false} /></details>
          {listing?.remoteId && <p className="publish-remote-id"><b>원격 ID</b>{listing.remoteId} · {listing.status}</p>}
          {result.message && <p className={`publish-result ${result.phase}`}>{result.message}{result.attemptId ? <small>작업 ID {result.attemptId}</small> : null}</p>}
          <button type="button" className="publish-execute" disabled={!credential || !assignment || result.phase === "running" || listing?.status === "published"} onClick={() => void executeChannel(channel)}>{result.phase === "running" ? <LoaderCircle className="spin" size={15} /> : listing?.status === "published" ? <Check size={15} /> : <Rocket size={15} />}{listing?.status === "published" ? "등록 완료" : "검증 후 실제 1건 등록"}</button>
        </>}
      </article>;
    })}</div>
  </section>;
}
