import type { ActiveChannelKey } from "./catalog";

export function isNonSaleTestListing(value: string) {
  return /(?:\bapi[\s_-]*test\b|\bqa[\s_-]*\d|\bnot\s+for\s+sale\b|업로드\s*테스트|판매\s*금지|비매품)/iu.test(value);
}

const lazadaCountryDomains: Record<string, string> = {
  ID: "www.lazada.co.id",
  MY: "www.lazada.com.my",
  PH: "www.lazada.com.ph",
  SG: "www.lazada.sg",
  TH: "www.lazada.co.th",
  VN: "www.lazada.vn",
};

export function marketplaceListingPresentation(
  channel: ActiveChannelKey,
  remoteId: string,
  productName: string,
  targetMarketCode = "",
) {
  const nonSaleTest = isNonSaleTestListing(productName);
  if (channel === "qoo10") return {
    badge: "판매 등록 확인",
    button: "등록 확인됨",
    remoteLabel: "Qoo10 상품 번호",
    url: `https://www.qoo10.jp/g/${encodeURIComponent(remoteId)}`,
    note: "상품 페이지 주소가 발급되었습니다.",
  };
  if (channel === "ebay") return {
    badge: "판매 등록 확인",
    button: "등록 확인됨",
    remoteLabel: "eBay 상품 번호",
    url: `https://www.ebay.com/itm/${encodeURIComponent(remoteId)}`,
    note: "공개 상품 페이지까지 발행된 번호입니다.",
  };
  if (channel === "lazada") {
    const domain = lazadaCountryDomains[targetMarketCode.toUpperCase()] ?? lazadaCountryDomains.MY;
    return {
      badge: nonSaleTest ? "테스트 비활성 등록" : "판매 활성 등록",
      button: nonSaleTest ? "비활성 등록 완료" : "활성 등록 완료",
      remoteLabel: "Lazada 상품 번호",
      url: `https://${domain}/products/i${encodeURIComponent(remoteId)}.html`,
      note: nonSaleTest ? "판매금지 테스트 상품이라 노출하지 않았습니다." : "활성 상태로 등록하고 채널에서 다시 조회했습니다.",
    };
  }
  if (channel === "coupang") return {
    badge: nonSaleTest ? "테스트 임시저장" : "판매 승인 요청",
    button: nonSaleTest ? "임시저장 완료" : "승인 요청 완료",
    remoteLabel: "쿠팡 판매자상품 번호",
    url: undefined,
    note: nonSaleTest ? "판매금지 테스트 상품이라 승인 요청하지 않았습니다." : "쿠팡 승인 뒤 공개 상품 주소가 발급됩니다.",
  };
  if (channel === "smartstore") return {
    badge: "판매 등록·재조회 확인",
    button: "등록 확인됨",
    remoteLabel: "스마트스토어 원상품 번호",
    url: undefined,
    note: "공개 주소가 아닌 원상품 관리 번호입니다.",
  };
  if (channel === "shopee") return {
    badge: "판매 등록·재조회 확인",
    button: "등록 확인됨",
    remoteLabel: "Shopee 상품 번호",
    url: undefined,
    note: "연결된 판매 국가의 상품을 다시 조회해 확인했습니다.",
  };
  return {
    badge: "판매 등록·재조회 확인",
    button: "등록 확인됨",
    remoteLabel: "Temu 상품 번호",
    url: undefined,
    note: "상품 상태와 이미지를 채널에서 다시 조회해 확인했습니다.",
  };
}

export function normalizeTenWonAmount(value: unknown) {
  const amount = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(amount) || amount <= 0) return value;
  const normalized = Math.max(10, Math.ceil(amount / 10) * 10);
  return typeof value === "string" ? String(normalized) : normalized;
}

export function naverUnitCapacity(exceptionalCategories: unknown, defaults: {
  totalCapacityValue?: number;
  unitCapacity?: number;
  indicationUnit?: string;
} = {}) {
  const required = Array.isArray(exceptionalCategories)
    && exceptionalCategories.some((value) => String(value).toUpperCase() === "UNIT_PRICE");
  if (!required) return { unitPriceYn: false };
  return {
    unitPriceYn: true,
    totalCapacityValue: defaults.totalCapacityValue ?? 500,
    unitCapacity: defaults.unitCapacity ?? 100,
    indicationUnit: defaults.indicationUnit ?? "g",
  };
}

const usdCurrencyReference: Record<string, number> = {
  USD: 1,
  JPY: 145,
  SGD: 1.3,
  MYR: 4.5,
  PHP: 56,
  VND: 25_000,
  THB: 32,
  TWD: 30,
  BRL: 5.4,
  MXN: 18.7,
  IDR: 16_000,
  EUR: 0.86,
};

export function marketplaceListingCurrency(channel: ActiveChannelKey, targetCurrency?: string) {
  if (targetCurrency?.trim()) return targetCurrency.trim().toUpperCase();
  if (channel === "qoo10") return "JPY";
  if (channel === "ebay") return "USD";
  return "KRW";
}

function globalMarketplacePrice(usdPrice: number, currency: string) {
  const converted = usdPrice * (usdCurrencyReference[currency] ?? 1);
  if (["JPY", "KRW", "VND", "IDR"].includes(currency)) return Math.max(1, Math.ceil(converted));
  return Math.max(0.01, Math.ceil(converted * 100) / 100);
}

export function marketplaceListingPrice(channel: ActiveChannelKey, price: number, options?: {
  globalBaseUsdPrice?: number;
  targetCurrency?: string;
}) {
  if (channel === "coupang" || channel === "smartstore") return Number(normalizeTenWonAmount(price));
  if (channel === "temu") return price;
  const usdPrice = Number(options?.globalBaseUsdPrice);
  if (!Number.isFinite(usdPrice) || usdPrice <= 0) return price;
  return globalMarketplacePrice(usdPrice, marketplaceListingCurrency(channel, options?.targetCurrency));
}

export function replaceMarketplaceImageUrls(value: unknown, replacements: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") {
    let output = value;
    for (const [source, target] of replacements) output = output.replaceAll(source, target);
    return output;
  }
  if (Array.isArray(value)) return value.map((item) => replaceMarketplaceImageUrls(item, replacements));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => [key, replaceMarketplaceImageUrls(item, replacements)]));
}

export function normalizeLazadaSizeChartImages(value: unknown, fallbackImageUrl: string): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeLazadaSizeChartImages(item, fallbackImageUrl));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const normalizedKey = key.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
    if (normalizedKey.includes("sizechart") && fallbackImageUrl) return [key, fallbackImageUrl];
    return [key, normalizeLazadaSizeChartImages(item, fallbackImageUrl)];
  }));
}

export function isLazadaBrandEnumerationError(value: unknown) {
  const detail = JSON.stringify(value ?? "");
  return /CHK_CATPROP_CPV_NOT_ENUM|not included in the dropdown list/i.test(detail)
    && /p-20000|brand/i.test(detail);
}

export function lazadaSkuSaleAttributes(attributes: Record<string, string>) {
  return Object.fromEntries(Object.entries(attributes).filter(([key, value]) => {
    const normalizedKey = key.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
    // These values must be nested under the SKU `saleProp` node. Lazada error
    // messages prefix the API name with an internal numeric id, but that prefix
    // is diagnostic metadata and is not a valid XML element name.
    return value.trim().length > 0
      && ["color", "colorfamily", "size", "units"].includes(normalizedKey);
  }));
}

export function shopeeLanguageSafeText(value: string, fallback: string) {
  const normalized = value.trim();
  return normalized && /^[\x20-\x7e]+$/u.test(normalized) ? normalized : fallback.trim();
}

type CoupangAttributeMetadata = {
  dataType?: unknown;
  basicUnit?: unknown;
  usableUnits?: unknown;
};

export function normalizeCoupangAttributeValue(metadata: CoupangAttributeMetadata | undefined, value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw || String(metadata?.dataType ?? "").toUpperCase() !== "NUMBER") return raw;
  const usableUnits = Array.isArray(metadata?.usableUnits)
    ? metadata.usableUnits.map(String).map((unit) => unit.trim()).filter((unit) => unit && unit !== "없음")
    : [];
  const basicUnit = String(metadata?.basicUnit ?? "").trim();
  // Some Coupang category metadata exposes a display-only basic unit that is
  // not accepted as a buying-option unit. Prefer it only when the usable-unit
  // list also permits it; otherwise choose the first explicitly usable unit.
  const basicUnitIsUsable = basicUnit && basicUnit !== "없음"
    && (!usableUnits.length || usableUnits.includes(basicUnit));
  const unit = basicUnitIsUsable ? basicUnit : usableUnits[0] ?? "";
  if (!unit || usableUnits.some((candidate) => raw.endsWith(candidate))) return raw;
  const numeric = raw.match(/^([-+]?\d+(?:\.\d+)?)(?:\s*[^\d.]+)?$/u)?.[1];
  return `${numeric ?? "1"}${unit}`;
}

type ShopeeAttributeValue = { value_id?: unknown; name?: unknown; display_value_name?: unknown; original_value_name?: unknown };
type ShopeeAttributeMetadata = {
  attribute_id?: unknown;
  name?: unknown;
  display_attribute_name?: unknown;
  is_mandatory?: unknown;
  mandatory?: unknown;
  mandatory_region?: unknown;
  attribute_info?: { mandatory_region?: unknown };
  attribute_value_list?: unknown;
};

function shopeeWords(value: unknown) {
  return String(value ?? "").toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1)
    .map((word) => word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word);
}

export function mergeShopeeRequiredAttributes(
  existing: unknown,
  metadata: ShopeeAttributeMetadata[],
  productHint: string,
  options: { fillEnumerated?: boolean; implicitRequired?: Record<string, true | string>; marketCode?: string } = {},
) {
  const attributes = Array.isArray(existing)
    ? existing.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))).map((item) => structuredClone(item))
    : [];
  const supplied = new Set(attributes.map((item) => Number(item.attribute_id)).filter(Number.isSafeInteger));
  const hintWords = shopeeWords(productHint);
  const autoFilled: string[] = [];
  const unresolved: string[] = [];
  for (const attribute of metadata) {
    const label = String(attribute.display_attribute_name ?? attribute.name ?? attribute.attribute_id ?? "").trim();
    const normalizedLabel = label.toLocaleLowerCase();
    const implicitValue = Object.entries(options.implicitRequired ?? {})
      .find(([name]) => name.toLocaleLowerCase() === normalizedLabel)?.[1];
    const mandatoryRegion = attribute.mandatory_region ?? attribute.attribute_info?.mandatory_region;
    const requiredRegions = Array.isArray(mandatoryRegion)
      ? mandatoryRegion.map(String).map((value) => value.toUpperCase())
      : [];
    const requiredForMarket = !requiredRegions.length || !options.marketCode
      || requiredRegions.includes(options.marketCode.toUpperCase());
    const required = requiredForMarket && (attribute.is_mandatory === true || attribute.is_mandatory === 1 || attribute.is_mandatory === "1"
      || attribute.mandatory === true || attribute.mandatory === 1 || attribute.mandatory === "1");
    const attributeId = Number(attribute.attribute_id);
    const values = Array.isArray(attribute.attribute_value_list)
      ? attribute.attribute_value_list.filter((item): item is ShopeeAttributeValue => Boolean(item && typeof item === "object" && !Array.isArray(item)))
      : [];
    const shouldFill = required || implicitValue !== undefined || (options.fillEnumerated === true && values.length > 0);
    if (!shouldFill || !Number.isSafeInteger(attributeId) || attributeId <= 0 || supplied.has(attributeId)) continue;
    const ranked = values
      .map((value, index) => {
        const name = String(value.display_value_name ?? value.original_value_name ?? value.name ?? "").trim();
        const words = shopeeWords(name);
        const matches = words.filter((word) => hintWords.some((hint) => hint === word || hint.includes(word) || word.includes(hint))).length;
        const fallbackPenalty = /^(?:other|others|기타|其他)$/iu.test(name) ? 1 : 0;
        return { value, name, score: matches * 100 - fallbackPenalty, index };
      })
      .filter((item) => Number.isSafeInteger(Number(item.value.value_id)) && Number(item.value.value_id) > 0)
      .sort((left, right) => right.score - left.score || left.index - right.index);
    const selected = typeof implicitValue === "string"
      ? ranked.find((item) => item.name.toLocaleLowerCase() === implicitValue.toLocaleLowerCase()) ?? ranked[0]
      : ranked[0];
    if (!selected && typeof implicitValue === "string" && implicitValue.trim()) {
      attributes.push({
        attribute_id: attributeId,
        attribute_value_list: [{ value_id: 0, original_value_name: implicitValue.trim(), value_unit: "" }],
      });
      supplied.add(attributeId);
      autoFilled.push(`${label}: ${implicitValue.trim()}`);
      continue;
    }
    if (!selected && required) {
      unresolved.push(label);
      continue;
    }
    if (!selected) continue;
    attributes.push({ attribute_id: attributeId, attribute_value_list: [{ value_id: Number(selected.value.value_id) }] });
    supplied.add(attributeId);
    autoFilled.push(`${label}: ${selected.name || selected.value.value_id}`);
  }
  return { attributes, autoFilled, unresolved };
}

export function shopeeNeedsShelfLife(categoryId: number, productHint: string) {
  return [100782, 100797, 100824, 100892, 100944].includes(categoryId)
    || /(?:coffee|noodle|pasta|rice|food|grocery|fish\s*oil|omega|vitamin|supplement|capsule|softgel|skincare|skin\s*care|facial\s*(?:toner|mist)|cosmetic|커피|면|파스타|쌀|식품|어유|오메가|비타민|건강식품|영양제|스킨케어|화장품|화장수)/iu.test(productHint);
}

const ebayCountryNames = new Map([
  ["대한민국", "Korea, South"],
  ["한국", "Korea, South"],
  ["south korea", "Korea, South"],
  ["republic of korea", "Korea, South"],
  ["중국", "China"],
  ["일본", "Japan"],
  ["미국", "United States"],
]);

export function normalizeEbayAspects(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).flatMap(([name, raw]) => {
    const list = (Array.isArray(raw) ? raw : [raw]).map((value) => String(value ?? "").trim()).filter(Boolean);
    if (!list.length) return [];
    const normalized = name === "Country/Region of Manufacture"
      ? list.map((value) => ebayCountryNames.get(value.toLocaleLowerCase()) ?? value)
      : list;
    return [[name, [...new Set(normalized)]]];
  }));
}
