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
  categoryId: string;
  categoryPath: string[];
  providedAttributes: Record<string, string>;
  status: string;
  confirmedAt: string | null;
};

type Listing = {
  channel: ActiveChannelKey;
  remoteId: string | null;
  status: string;
  lastError: string | null;
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
  assignments: Assignment[];
  listings: Listing[];
  sourceImages: Array<{ path: string; url: string | null }>;
  generatedImages: Array<{ id: string; path: string; url: string | null }>;
};

type ChannelResult = { phase: "idle" | "running" | "succeeded" | "failed"; message?: string; remoteId?: string; attemptId?: string };

function html(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character));
}

function qoo10Expiry() {
  const year = new Date().getUTCFullYear() + 1;
  return `${year}-12-31`;
}

function buildChannelArguments(channel: ActiveChannelKey, context: PublishContext, price: number, quantity: number) {
  const assignment = context.assignments.find((item) => item.channel === channel && item.status === "confirmed");
  const product = context.product;
  const sourceImage = context.sourceImages[0]?.url ?? "";
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
    return {
      shopId: "",
      body: {
        category_id: Number(assignment?.categoryId ?? 0),
        item_name: product.name,
        description: product.description,
        item_sku: product.sku,
        original_price: price,
        normal_stock: quantity,
        image: { image_id_list: [] },
        weight: 0,
        dimension: { package_length: 0, package_width: 0, package_height: 0 },
        logistic_info: [],
        attribute_list: Object.entries(assignment?.providedAttributes ?? {}).map(([attribute_id, original_value_name]) => ({
          attribute_id: Number(attribute_id),
          attribute_value_list: [{ original_value_name }],
        })),
      },
    };
  }
  if (channel === "lazada") {
    return {
      request: {
        Product: {
          PrimaryCategory: assignment?.categoryId ?? "",
          SPUId: "",
          AssociatedSku: "",
          Attributes: { name: product.name, description: product.description, brand: "No Brand" },
          Skus: { Sku: [{ SellerSku: product.sku, price: String(price), quantity: String(quantity), package_weight: "", package_length: "", package_width: "", package_height: "", Images: { Image: [] } }] },
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
  if (channel === "shopee") return [!String(value.shopId ?? "").trim() ? "shopId" : "", json.includes('"image_id_list":[]') ? "Shopee image_id_list" : "", json.includes('"logistic_info":[]') ? "Shopee logistic_info" : ""].filter(Boolean);
  if (channel === "lazada") return [json.includes('"Images":{"Image":[]}') ? "Lazada migrated image" : "", json.includes('"package_weight":""') ? "package size/weight" : ""].filter(Boolean);
  if (channel === "coupang") return ["outboundShippingPlaceCode", "returnCenterCode", "notices", "category attributes"].filter((key) => json.includes(`"${key}":""`) || json.includes(`"${key}":[]`));
  if (channel === "smartstore") return [json.includes("NAVER_UPLOADED_IMAGE_URL_REQUIRED") ? "Naver uploaded image" : "", json.includes('"deliveryInfo":{}') ? "deliveryInfo" : "", json.includes('"afterServiceInfo":{}') ? "afterServiceInfo/originAreaInfo" : ""].filter(Boolean);
  return [json.includes('"fulfillmentPolicyId":""') ? "business policy IDs" : "", json.includes('"merchantLocationKey":""') ? "merchantLocationKey" : ""].filter(Boolean);
}

async function fingerprint(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).slice(0, 12).map((item) => item.toString(16).padStart(2, "0")).join("");
}

function buildDraftMap(context: PublishContext, price: number, quantity: number) {
  return Object.fromEntries(activeChannelKeys.map((channel) => [
    channel,
    JSON.stringify(buildChannelArguments(channel, context, price, quantity), null, 2),
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
  const [price, setPrice] = useState(2500);
  const [quantity, setQuantity] = useState(1);
  const [currency, setCurrency] = useState("JPY");
  const [loading, setLoading] = useState(false);
  const priceRef = useRef(price);
  const quantityRef = useRef(quantity);

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
      const [contextResponse, credentialsResponse] = await Promise.all([
        fetch(`/api/admin/products/${productId}/publish-context`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" }),
        supabase.rpc("sellerpilot_list_credentials"),
      ]);
      const payload = await contextResponse.json().catch(() => ({ message: "상품 준비 응답을 읽지 못했습니다." })) as PublishContext & { message?: string };
      if (!contextResponse.ok) throw new Error(payload.message ?? "상품 등록 준비 정보를 불러오지 못했습니다.");
      setContext(payload);
      setCredentials(Array.isArray(credentialsResponse.data) ? credentialsResponse.data as CredentialRow[] : []);
      setDrafts(buildDraftMap(payload, priceRef.current, quantityRef.current));
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
    const assignment = context.assignments.find((item) => item.channel === channel && item.status === "confirmed");
    if (!credential || !assignment) return notify(`${channelCatalog[channel].name} 활성 키와 확정 카테고리를 확인해 주세요.`);
    let channelArguments: Record<string, unknown>;
    try {
      channelArguments = JSON.parse(drafts[channel] ?? "{}") as Record<string, unknown>;
    } catch {
      return notify(`${channelCatalog[channel].name} 등록 JSON 형식을 확인해 주세요.`);
    }
    const missing = missingNativeValues(channel, channelArguments);
    if (missing.length) return notify(`${channelCatalog[channel].name} 필수값 보완: ${missing.join(", ")}`);
    const confirmed = window.confirm(`${channelCatalog[channel].name} 운영 계정에 실제 상품 1건을 등록합니다. 가격 ${price.toLocaleString()} ${currency}, 재고 ${quantity}개가 맞습니까?`);
    if (!confirmed) return;

    setResults((current) => ({ ...current, [channel]: { phase: "running" } }));
    try {
      const { data: sessionData } = await createClient().auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("관리자 로그인이 필요합니다.");
      const idempotencyKey = `listing:${productId}:${channel}:${await fingerprint({ channelArguments, currency, price })}`;
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
          currency,
          price,
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
    <div className="publish-common-fields"><label><span>판매가</span><input type="number" min="0" step="1" value={price} onChange={(event) => { const value = Number(event.target.value); priceRef.current = value; setPrice(value); }} /></label><label><span>통화</span><input value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></label><label><span>재고</span><input type="number" min="0" step="1" value={quantity} onChange={(event) => { const value = Number(event.target.value); quantityRef.current = value; setQuantity(value); }} /></label><button type="button" onClick={() => setDrafts(buildDraftMap(context, price, quantity))}><RefreshCw size={14} />공통값으로 초안 갱신</button></div>
    <div className="publish-source-proof"><span><ShieldCheck size={15} /><b>상품 원장</b>{context.product.sku}</span><span><Check size={15} /><b>원본 이미지</b>{context.sourceImages.length}장</span><span><Check size={15} /><b>카테고리 확정</b>{context.assignments.filter((item) => item.status === "confirmed").length}개 채널</span></div>
    <div className="publish-channel-cards">{visibleChannels.map((channel) => {
      const definition = channelCatalog[channel];
      const credential = activeCredentials.get(channel);
      const assignment = context.assignments.find((item) => item.channel === channel && item.status === "confirmed");
      const listing = context.listings.find((item) => item.channel === channel);
      const result = results[channel] ?? { phase: "idle" as const };
      const capability = definition.capabilities.listingCreate;
      return <article key={channel} className={`publish-channel-card ${result.phase}`}>
        <header><span style={{ background: channels[channel].color }}>{definition.code}</span><div><small>{definition.market}</small><h4>{definition.name}</h4></div><em>{listing?.status === "published" ? "등록 완료" : credential ? assignment ? "실행 준비" : "카테고리 필요" : "키 필요"}</em></header>
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
