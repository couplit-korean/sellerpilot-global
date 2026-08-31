/**
 * Client-safe same-product and price-normalization contracts.
 *
 * Keep this module free of provider clients, credentials, Node-only imports,
 * and network calls. The admin UI may import it directly.
 */

export const COMPETITOR_MATCHER_VERSION = "strict-2026-08-31-v3" as const;
export const COMPETITOR_PRICE_FRESHNESS_MS = 24 * 60 * 60 * 1_000;

export type CompetitorMatchTier = "exact" | "probable" | "rejected";
export type CompetitorInventoryStatus = "in_stock" | "out_of_stock" | "unknown";
export type CompetitorPackageType = "single" | "bundle";
export type CompetitorContentType = "main" | "refill" | "sample";
export type CompetitorProductCondition = "new" | "used" | "refurbished";
export type CompetitorPurchaseType = "one_time" | "subscription" | "rental";

export type CompetitorQuantity = {
  value: number;
  unit: string;
};

export type CompetitorVariantOptions = {
  flavor?: string;
  color?: string;
  size?: string;
  generation?: string;
  compatibleModel?: string;
  option?: string;
};

export type CompetitorVerifiedAlias = {
  attribute: "brand" | "productName" | "manufacturerPartNumber" | "modelNumber";
  value: string;
  source: string;
};

/** Serializable, seller-confirmed reference facts. Missing fields stay unknown. */
export type CompetitorProductIdentity = {
  productName: string;
  brand?: string;
  manufacturer?: string;
  packageContents?: string;
  gtins?: readonly string[];
  manufacturerPartNumber?: string;
  modelNumber?: string;
  specification?: CompetitorQuantity;
  itemCount?: number;
  totalQuantity?: CompetitorQuantity;
  packageType?: CompetitorPackageType;
  contentType?: CompetitorContentType;
  condition?: CompetitorProductCondition;
  purchaseType?: CompetitorPurchaseType;
  options?: CompetitorVariantOptions;
  verifiedAliases?: readonly CompetitorVerifiedAlias[];
};

/** Provider-observed facts. Absence never means that a value matched. */
export type CompetitorCandidateIdentity = {
  productName?: string;
  brand?: string;
  manufacturer?: string;
  packageContents?: string;
  gtins?: readonly string[];
  manufacturerPartNumber?: string;
  modelNumber?: string;
  specification?: CompetitorQuantity;
  itemCount?: number;
  totalQuantity?: CompetitorQuantity;
  packageType?: CompetitorPackageType;
  contentType?: CompetitorContentType;
  condition?: CompetitorProductCondition;
  purchaseType?: CompetitorPurchaseType;
  options?: CompetitorVariantOptions;
};

export type CompetitorMatchEvidence = {
  code: string;
  attribute: string;
  expected?: string;
  actual?: string;
  source?: string;
};

export type CompetitorMatchAssessment = {
  matcherVersion: typeof COMPETITOR_MATCHER_VERSION;
  matchTier: CompetitorMatchTier;
  matchScore: number;
  matchEvidence: CompetitorMatchEvidence[];
  mismatchEvidence: CompetitorMatchEvidence[];
};

export type CompetitorPriceComponentInput =
  | { status: "known"; amount: number; currency: string; krwAmount?: number | null }
  | { status: "unknown"; amount?: null; currency: string; krwAmount?: null };

export type CompetitorPriceComponent =
  | { status: "known"; amount: number; currency: string; krwAmount: number | null }
  | { status: "unknown"; amount: null; currency: string; krwAmount: null };

export type CompetitorPriceComponentsInput = {
  itemPrice: CompetitorPriceComponentInput;
  requiredOptionSurcharge: CompetitorPriceComponentInput;
  shipping: CompetitorPriceComponentInput;
  taxAndDuty: CompetitorPriceComponentInput;
  /** A positive, confirmed amount subtracted from the other components. */
  discount: CompetitorPriceComponentInput;
};

export type CompetitorPriceComponents = {
  [Key in keyof CompetitorPriceComponentsInput]: CompetitorPriceComponent;
};

export type CompetitorExchangeRate = {
  provider: string;
  quotedAt: string;
  rate: number;
  fromCurrency: string;
  toCurrency: "KRW";
};

export type CompetitorTotalPurchasePrice = {
  amount: number;
  currency: string;
  krwAmount: number | null;
};

export type CompetitorUnitPrice = {
  amount: number;
  currency: string;
  krwAmount: number | null;
  quantity: CompetitorQuantity;
};

export type CompetitorNormalizedPrice = {
  priceComponents: CompetitorPriceComponents;
  totalPurchasePrice: CompetitorTotalPurchasePrice | null;
  exchangeRate: CompetitorExchangeRate | null;
  unitPrice: CompetitorUnitPrice | null;
};

export type CompetitorObservationProvenance = {
  provider: string;
  marketplace: string;
  externalId: string;
  url: string;
  collectedAt: string;
};

export type CompetitorPriceObservationV3Fields = CompetitorMatchAssessment & CompetitorNormalizedPrice & {
  canonicalUrl: string;
  provenance: CompetitorObservationProvenance[];
  observedAt: string;
  inventoryStatus: CompetitorInventoryStatus;
};

export type CompetitorCandidateV3Input = {
  provider: string;
  marketplace: string;
  externalId: string;
  title: string;
  url: string;
  price: number;
  currency: string;
  identity?: CompetitorCandidateIdentity;
  priceComponents?: CompetitorPriceComponentsInput;
  exchangeRate?: CompetitorExchangeRate | null;
  observedAt?: string;
  inventoryStatus?: CompetitorInventoryStatus;
  provenance?: CompetitorObservationProvenance[];
};

type NormalizedQuantity = CompetitorQuantity & {
  dimension: "mass" | "volume" | "length" | "count" | "storage";
};

const quantityUnitDefinitions: ReadonlyArray<{
  dimension: NormalizedQuantity["dimension"];
  canonicalUnit: string;
  factor: number;
  aliases: readonly string[];
}> = [
  { dimension: "mass", canonicalUnit: "g", factor: 1_000, aliases: ["kg", "kilogram", "kilograms", "킬로그램", "キログラム", "公斤", "千克"] },
  { dimension: "mass", canonicalUnit: "g", factor: 1, aliases: ["g", "gram", "grams", "그램", "グラム", "克"] },
  { dimension: "mass", canonicalUnit: "g", factor: 0.001, aliases: ["mg", "milligram", "milligrams", "밀리그램", "ミリグラム", "毫克"] },
  { dimension: "volume", canonicalUnit: "ml", factor: 1_000, aliases: ["l", "liter", "liters", "litre", "litres", "리터", "リットル", "公升", "升"] },
  { dimension: "volume", canonicalUnit: "ml", factor: 1, aliases: ["ml", "milliliter", "milliliters", "millilitre", "millilitres", "밀리리터", "ミリリットル", "毫升"] },
  { dimension: "length", canonicalUnit: "mm", factor: 1_000, aliases: ["m", "meter", "meters", "metre", "metres", "미터", "メートル"] },
  { dimension: "length", canonicalUnit: "mm", factor: 10, aliases: ["cm", "centimeter", "centimeters", "센티미터", "センチメートル"] },
  { dimension: "length", canonicalUnit: "mm", factor: 1, aliases: ["mm", "millimeter", "millimeters", "밀리미터", "ミリメートル"] },
  { dimension: "storage", canonicalUnit: "mb", factor: 1 / 1_024, aliases: ["kb", "kib"] },
  { dimension: "storage", canonicalUnit: "mb", factor: 1, aliases: ["mb", "mib"] },
  { dimension: "storage", canonicalUnit: "mb", factor: 1_024, aliases: ["gb", "gib"] },
  { dimension: "storage", canonicalUnit: "mb", factor: 1_048_576, aliases: ["tb", "tib"] },
  {
    dimension: "count",
    canonicalUnit: "count",
    factor: 1,
    aliases: [
      "count", "unit", "units", "item", "items", "piece", "pieces", "pc", "pcs", "ea", "pack", "packs",
      "개", "개입", "입", "팩", "세트", "묶음", "병", "個", "個入", "本", "瓶", "パック", "セット",
    ],
  },
];

const quantityUnitLookup = new Map(quantityUnitDefinitions.flatMap((definition) => (
  definition.aliases.map((alias) => [normalizeLooseText(alias).replaceAll(" ", ""), definition] as const)
)));
const explicitQuantityUnitPattern = [...quantityUnitLookup.keys()]
  .sort((left, right) => right.length - left.length)
  .map(escapeRegExp)
  .join("|");

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function normalizeLooseText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function compactText(value: unknown) {
  return normalizeLooseText(value).replaceAll(" ", "");
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizedCurrency(value: unknown) {
  const currency = String(value ?? "").trim().toLocaleUpperCase();
  if (!/^[A-Z]{3}$/u.test(currency)) throw new RangeError("INVALID_COMPETITOR_CURRENCY");
  return currency;
}

function rounded(value: number) {
  return Number(value.toFixed(6));
}

function normalizedIsoInstant(value: unknown) {
  const timestamp = String(value ?? "").trim();
  const milliseconds = Date.parse(timestamp);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : "";
}

export function normalizeCompetitorQuantity(quantity: CompetitorQuantity | null | undefined): NormalizedQuantity | null {
  if (!quantity || !finitePositive(quantity.value)) return null;
  const key = normalizeLooseText(quantity.unit).replaceAll(" ", "");
  const definition = quantityUnitLookup.get(key);
  if (!definition) return null;
  return {
    dimension: definition.dimension,
    value: rounded(quantity.value * definition.factor),
    unit: definition.canonicalUnit,
  };
}

function sameQuantity(left: CompetitorQuantity | null | undefined, right: CompetitorQuantity | null | undefined) {
  const normalizedLeft = normalizeCompetitorQuantity(left);
  const normalizedRight = normalizeCompetitorQuantity(right);
  if (!normalizedLeft || !normalizedRight || normalizedLeft.dimension !== normalizedRight.dimension) return false;
  const tolerance = Math.max(0.000_001, Math.abs(normalizedLeft.value) * 0.000_001);
  return Math.abs(normalizedLeft.value - normalizedRight.value) <= tolerance;
}

function parseLocalizedNumber(value: string) {
  const compact = value.replace(/\s+/gu, "");
  const comma = compact.lastIndexOf(",");
  const dot = compact.lastIndexOf(".");
  let normalized = compact;
  if (comma >= 0 && dot >= 0) normalized = comma > dot ? compact.replaceAll(".", "").replace(",", ".") : compact.replaceAll(",", "");
  else if (comma >= 0) normalized = compact.replace(",", ".");
  const parsed = Number(normalized);
  return finitePositive(parsed) ? parsed : null;
}

function explicitQuantities(value: string) {
  const normalized = String(value ?? "").normalize("NFKC").toLocaleLowerCase();
  const quantities: NormalizedQuantity[] = [];
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(\\d[\\d.,]*)\\s*(${explicitQuantityUnitPattern})(?![\\p{L}\\p{N}])`, "giu");
  for (const match of normalized.matchAll(pattern)) {
    const amount = parseLocalizedNumber(match[1] ?? "");
    if (amount === null) continue;
    const unit = normalizeLooseText(match[2] ?? "").replaceAll(" ", "");
    const quantity = normalizeCompetitorQuantity({ value: amount, unit });
    if (quantity && !quantities.some((candidate) => candidate.dimension === quantity.dimension && candidate.value === quantity.value)) quantities.push(quantity);
  }
  return quantities;
}

function explicitItemCount(value: string) {
  const normalized = String(value ?? "").normalize("NFKC").toLocaleLowerCase();
  const countQuantity = explicitQuantities(normalized).find((quantity) => quantity.dimension === "count");
  if (countQuantity && Number.isInteger(countQuantity.value)) return countQuantity.value;
  const patterns = [
    /(?:^|[^\d])\d[\d.,]*\s*(?:kg|g|mg|l|ml)\s*[x×*]\s*(\d{1,4})(?!\d)/iu,
    /(?:^|[^\d])(\d{1,4})\s*[x×*]\s*\d[\d.,]*\s*(?:kg|g|mg|l|ml)(?![\p{L}\p{N}])/iu,
    /\b(?:set|pack|lot)\s+of\s+(\d{1,4})\b/iu,
    /(?:^|[^\d])(\d{1,4})\s*(?:本|瓶|個|개|병)(?=\s*(?:セット|세트|묶음|組|入り|입|$))/iu,
  ];
  for (const pattern of patterns) {
    const count = Number(normalized.match(pattern)?.[1]);
    if (Number.isInteger(count) && count > 0) return count;
  }
  const bonus = normalized.match(/(?<!\d)(\d{1,3})\s*\+\s*(\d{1,3})(?!\d)/u);
  if (bonus) return Number(bonus[1]) + Number(bonus[2]);
  return null;
}

function explicitSpecification(value: string) {
  return explicitQuantities(value).find((quantity) => quantity.dimension !== "count") ?? null;
}

function multipliedQuantity(quantity: CompetitorQuantity | null, count: number | null) {
  const normalized = normalizeCompetitorQuantity(quantity);
  if (!normalized || !count || !Number.isInteger(count) || count <= 0) return null;
  return { value: rounded(normalized.value * count), unit: normalized.unit } satisfies CompetitorQuantity;
}

function explicitPackageType(value: string, count: number | null): CompetitorPackageType | undefined {
  const normalized = normalizeLooseText(value);
  if ((count ?? 0) > 1
      || /(?:^|\s)(?:bundle|multipack|multi pack|set of|pack of|묶음|세트|번들|セット|セット品|まとめ買い|组合装|組合裝)(?:\s|$)/iu.test(normalized)
      || /\d+\s*\+\s*\d+/u.test(normalized)
      || /\d{1,4}\s*(?:本|瓶|個|개|병)\s*(?:セット|세트|묶음|組|入り|입)/iu.test(normalized)) return "bundle";
  if (count === 1 || /(?:^|\s)(?:single|single item|단품|낱개|単品)(?:\s|$)/iu.test(normalized)) return "single";
  return undefined;
}

function explicitContentType(value: string): CompetitorContentType | undefined {
  const normalized = normalizeLooseText(value);
  if (/(?:^|\s)(?:refill|refil|리필|詰め替え|リフィル|补充装|補充裝)(?:\s|$)/iu.test(normalized)) return "refill";
  if (/(?:^|\s)(?:sample|tester|trial size|샘플|테스터|サンプル|小样|小樣)(?:\s|$)/iu.test(normalized)) return "sample";
  if (/(?:^|\s)(?:main product|full size|본품|정품 본품|現品)(?:\s|$)/iu.test(normalized)) return "main";
  return undefined;
}

function explicitCondition(value: string): CompetitorProductCondition | undefined {
  const normalized = normalizeLooseText(value);
  if (/(?:^|\s)(?:refurbished|refurb|remanufactured|renewed|certified renewed|seller renewed|리퍼|리퍼비시|재생품|整備済み)(?:\s|$)/iu.test(normalized)) return "refurbished";
  if (/(?:^|\s)(?:used|pre owned|second hand|open box|opened box|box opened|display model|floor model|customer return|returned item|중고|개봉품|전시상품|전시품|반품상품|반품품|中古|開封済み|展示品|返品)(?:\s|$)/iu.test(normalized)) return "used";
  if (/(?:^|\s)(?:brand new|new item|new in box|new sealed|factory sealed|unopened|새상품|새제품|신품|미개봉|新品|未開封)(?:\s|$)/iu.test(normalized)) return "new";
  return undefined;
}

function explicitPurchaseType(value: string): CompetitorPurchaseType | undefined {
  const normalized = normalizeLooseText(value);
  if (/(?:^|\s)(?:subscription|subscribe|정기구독|구독|定期便)(?:\s|$)/iu.test(normalized)) return "subscription";
  if (/(?:^|\s)(?:rental|rent|렌탈|대여|レンタル)(?:\s|$)/iu.test(normalized)) return "rental";
  if (/(?:^|\s)(?:one time purchase|일시불|일반구매|通常購入)(?:\s|$)/iu.test(normalized)) return "one_time";
  return undefined;
}

function normalizedGtins(values: readonly string[] | undefined) {
  // A bare 8–14 digit run in a marketplace title may be a seller SKU, model,
  // order number, or marketing token. GTIN exactness therefore requires a
  // structured provider identity field; title digits are never promoted to a
  // verified identifier.
  return [...new Set((values ?? [])
    .map((value) => String(value).replace(/\D/gu, ""))
    .filter((value) => /^\d{8,14}$/u.test(value)))];
}

function aliasesFor(identity: CompetitorProductIdentity, attribute: CompetitorVerifiedAlias["attribute"], canonical: string | undefined) {
  const aliases = (identity.verifiedAliases ?? [])
    .filter((alias) => alias.attribute === attribute && alias.source.trim() && alias.value.trim())
    .map((alias) => alias.value);
  return [...new Set([canonical ?? "", ...aliases].map(normalizeLooseText).filter(Boolean))];
}

function containsIdentityPhrase(value: string, phrase: string) {
  const normalizedValue = normalizeLooseText(value);
  const normalizedPhrase = normalizeLooseText(phrase);
  if (!normalizedPhrase) return false;
  if (/^[\p{Script=Latin}\p{N} ]+$/u.test(normalizedPhrase)) return ` ${normalizedValue} `.includes(` ${normalizedPhrase} `);
  return compactText(value).includes(compactText(phrase));
}

function exactOrContainedAlias(value: string | undefined, title: string, aliases: string[]) {
  const normalizedValue = normalizeLooseText(value);
  // A provider-structured fact wins over title text. Otherwise a listing could
  // report model XM5 in its structured field while mentioning XM6 in the title
  // and incorrectly pass the exact-model path. Expanded structured values such
  // as "Sony WH-1000XM6 Headphones" may still contain the confirmed alias.
  if (normalizedValue) {
    return aliases.some((alias) => normalizedValue === alias || containsIdentityPhrase(value ?? "", alias));
  }
  return aliases.some((alias) => containsIdentityPhrase(title, alias));
}

function tokenSimilarity(reference: string, candidate: string) {
  const ignored = new Set(["the", "and", "with", "for", "상품", "제품", "정품", "공식", "new", "新品"]);
  const referenceTokens = [...new Set(normalizeLooseText(reference).split(" ").filter((token) => token.length >= 2 && !ignored.has(token) && !/^\d/u.test(token)))];
  const candidateTokens = new Set(normalizeLooseText(candidate).split(" "));
  if (referenceTokens.length < 2) return 0;
  return referenceTokens.filter((token) => candidateTokens.has(token) || compactText(candidate).includes(compactText(token))).length / referenceTokens.length;
}

function explicitLatinModelTokens(value: string) {
  return [...new Set((value.normalize("NFKC").match(/[A-Za-z0-9][A-Za-z0-9._-]{2,39}/gu) ?? [])
    .filter((token) => /[A-Za-z]/u.test(token) && /\d/u.test(token))
    .filter((token) => !/^\d+(?:ml|l|g|kg|mg|oz|lb|cm|mm|gb|tb|mah|w|v|hz|khz|pack|pc|pcs)$/iu.test(token))
    .map((token) => token.toLocaleUpperCase()))];
}

type ResolvedIdentity = CompetitorCandidateIdentity & {
  specification?: CompetitorQuantity;
  itemCount?: number;
  totalQuantity?: CompetitorQuantity;
};

function resolveReferenceIdentity(identity: CompetitorProductIdentity): ResolvedIdentity & { productName: string } {
  const text = `${identity.productName} ${identity.packageContents ?? ""}`.trim();
  const specification = normalizeCompetitorQuantity(identity.specification) ?? explicitSpecification(text) ?? undefined;
  const itemCount = finitePositive(identity.itemCount) && Number.isInteger(identity.itemCount)
    ? identity.itemCount
    : explicitItemCount(identity.packageContents ?? identity.productName) ?? undefined;
  const totalQuantity = normalizeCompetitorQuantity(identity.totalQuantity) ?? multipliedQuantity(specification ?? null, itemCount ?? null) ?? undefined;
  return {
    ...identity,
    specification,
    itemCount,
    totalQuantity,
    packageType: identity.packageType ?? explicitPackageType(identity.packageContents ?? "", itemCount ?? null),
    contentType: identity.contentType ?? explicitContentType(identity.packageContents ?? ""),
  };
}

function resolveCandidateIdentity(candidate: { title: string; identity?: CompetitorCandidateIdentity }): ResolvedIdentity {
  const identity = candidate.identity ?? {};
  const text = `${identity.productName ?? ""} ${identity.packageContents ?? ""} ${candidate.title}`.trim();
  const specification = normalizeCompetitorQuantity(identity.specification) ?? explicitSpecification(text) ?? undefined;
  const itemCount = finitePositive(identity.itemCount) && Number.isInteger(identity.itemCount)
    ? identity.itemCount
    : explicitItemCount(text) ?? undefined;
  const totalQuantity = normalizeCompetitorQuantity(identity.totalQuantity) ?? multipliedQuantity(specification ?? null, itemCount ?? null) ?? undefined;
  return {
    ...identity,
    specification,
    itemCount,
    totalQuantity,
    packageType: identity.packageType ?? explicitPackageType(text, itemCount ?? null),
    contentType: identity.contentType ?? explicitContentType(text),
    condition: identity.condition ?? explicitCondition(text),
    purchaseType: identity.purchaseType ?? explicitPurchaseType(text),
  };
}

function displayQuantity(value: CompetitorQuantity | undefined) {
  const normalized = normalizeCompetitorQuantity(value);
  return normalized ? `${normalized.value}${normalized.unit}` : "";
}

function addMismatch(
  mismatches: CompetitorMatchEvidence[],
  attribute: string,
  expected: unknown,
  actual: unknown,
  code = `${attribute}_mismatch`,
  source = "provider",
) {
  const evidence = { code, attribute, expected: String(expected), actual: String(actual), source };
  if (!mismatches.some((item) => (
    item.code === evidence.code
    && item.attribute === evidence.attribute
    && item.expected === evidence.expected
    && item.actual === evidence.actual
  ))) mismatches.push(evidence);
}

const optionAttributes = ["flavor", "color", "size", "generation", "compatibleModel", "option"] as const;

const accessoryCategoryTerms = {
  protective_case: [
    "case", "cover", "sleeve", "pouch", "hard shell", "protective shell", "bumper",
    "케이스", "커버", "파우치", "하드 쉘", "하드쉘", "보호 쉘", "범퍼",
    "ケース", "カバー", "ポーチ", "ハードシェル", "保護シェル", "バンパー",
  ],
  screen_protection: [
    "screen protector", "screen protection film", "protective film", "tempered glass",
    "액정 보호필름", "액정보호필름", "화면 보호필름", "강화유리",
    "スクリーンプロテクター", "保護フィルム", "強化ガラス",
  ],
  power_part: [
    "battery", "batteries", "battery pack", "power pack",
    "배터리", "밧데리", "건전지", "전지팩",
    "バッテリー", "電池", "バッテリーパック",
  ],
  audio_wear_part: [
    "earcup", "earcups", "ear cup", "ear cups", "ear pad", "ear pads", "ear cushion", "ear cushions",
    "이어컵", "이어 컵", "이어패드", "이어 패드", "이어쿠션", "이어 쿠션",
    "イヤーカップ", "イヤーパッド", "イヤークッション",
  ],
  compatibility_part: [
    "compatible", "compatible with", "replacement", "replacement part", "spare part", "add on", "add-on",
    "호환", "호환용", "교체용", "부품", "추가 구성품",
    "互換", "対応", "交換用", "交換部品", "部品", "アドオン",
  ],
  accessory: [
    "accessory", "accessories", "adapter", "charger", "charging cable", "strap", "holder", "stand", "mount",
    "액세서리", "어댑터", "충전기", "충전 케이블", "케이블", "스트랩", "거치대",
    "アクセサリー", "アダプター", "充電器", "充電ケーブル", "ケーブル", "ストラップ", "スタンド", "マウント",
  ],
} as const;

function detectedAccessoryCategories(value: string) {
  const categories = new Set<string>();
  for (const [category, terms] of Object.entries(accessoryCategoryTerms)) {
    if (terms.some((term) => containsIdentityPhrase(value, term))) categories.add(category);
  }
  // English "case" can describe packaging ("case of 12"), not a protective
  // accessory. Keep that explicit packaging construction out of this fence.
  const normalized = normalizeLooseText(value);
  if (/(?:^|\s)(?:cases?\s+of\s+\d{1,4}|\d{1,4}\s*-?\s*cases?)(?:\s|$)/iu.test(normalized)) {
    categories.delete("protective_case");
  }
  return categories;
}

const detectableOptionAliases = {
  flavor: {
    cherry: ["cherry", "체리", "チェリー", "樱桃", "櫻桃"],
    strawberry: ["strawberry", "딸기", "ストロベリー", "草莓"],
    vanilla: ["vanilla", "바닐라", "バニラ", "香草"],
    chocolate: ["chocolate", "choco", "초콜릿", "초코", "チョコ", "巧克力"],
    grape: ["grape", "포도", "グレープ", "葡萄"],
    lemon: ["lemon", "레몬", "レモン", "柠檬", "檸檬"],
    lime: ["lime", "라임", "ライム"],
    orange: ["orange", "오렌지", "オレンジ"],
    apple: ["apple", "사과", "アップル", "苹果", "蘋果"],
    peach: ["peach", "복숭아", "ピーチ"],
    mango: ["mango", "망고", "マンゴー"],
    mint: ["mint", "민트", "ミント"],
  },
  color: {
    black: ["black", "블랙", "검정", "ブラック", "黑色", "黒"],
    white: ["white", "화이트", "흰색", "ホワイト", "白色", "白"],
    red: ["red", "레드", "빨강", "レッド", "红色", "赤"],
    blue: ["blue", "블루", "파랑", "ブルー", "蓝色", "青"],
    green: ["green", "그린", "초록", "グリーン", "绿色", "緑"],
    pink: ["pink", "핑크", "ピンク", "粉色"],
    gold: ["gold", "골드", "ゴールド", "金色"],
    silver: ["silver", "실버", "シルバー", "银色", "銀色"],
  },
  size: {
    small: ["size s", "small", "스몰", "소형", "s 사이즈", "sサイズ"],
    medium: ["size m", "medium", "미디엄", "중형", "m 사이즈", "mサイズ"],
    large: ["size l", "large", "라지", "대형", "l 사이즈", "lサイズ"],
    xlarge: ["size xl", "extra large", "엑스라지", "xl 사이즈", "xlサイズ"],
  },
} as const;

function canonicalDetectableOption(attribute: "flavor" | "color" | "size", value: string) {
  for (const [canonical, aliases] of Object.entries(detectableOptionAliases[attribute]) as Array<[string, readonly string[]]>) {
    if (aliases.some((alias) => normalizeLooseText(alias) === normalizeLooseText(value))) return canonical;
  }
  return "";
}

function detectedOptions(attribute: "flavor" | "color" | "size", value: string) {
  // Korean marketplace titles frequently concatenate "블루투스" with the
  // product noun. It names the Bluetooth protocol, not a blue color option.
  // Mask only this verified protocol term; an isolated 블루/blue token still
  // remains valid color evidence.
  const searchableValue = attribute === "color"
    ? value.replace(/블루\s*투스/giu, " ").replace(/ブルー\s*トゥース/giu, " ")
    : value;
  return (Object.entries(detectableOptionAliases[attribute]) as Array<[string, readonly string[]]>).flatMap(([canonical, aliases]) => (
    aliases.some((alias) => containsIdentityPhrase(searchableValue, alias)) ? [canonical] : []
  ));
}

function canonicalNumericSize(value: string) {
  const normalized = String(value ?? "").normalize("NFKC").toLocaleLowerCase().trim();
  const match = normalized.match(/^(?:(?:size|사이즈|サイズ|us|uk|eu|jp|kr)\s*[:#-]?\s*)?(\d{1,3}(?:\.\d{1,2})?)(?:\s*mm)?$/iu);
  if (!match) return "";
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : "";
}

function detectedNumericSizes(value: string) {
  const normalized = String(value ?? "").normalize("NFKC").toLocaleLowerCase();
  const sizes = new Set<string>();
  const rangePatterns = [
    /(?:^|[^\p{L}\p{N}])(?:sizes?|사이즈|サイズ|us|uk|eu|jp|kr)\s*[:#-]?\s*(\d{1,3}(?:\.\d{1,2})?)\s*[-~～/]\s*(\d{1,3}(?:\.\d{1,2})?)(?![\p{L}\p{N}])/giu,
    /(?:^|[^\p{L}\p{N}-])(\d{1,3}(?:\.\d{1,2})?)\s*[-~～/]\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:mm\s*)?(?:sizes?|사이즈|サイズ)(?![\p{L}\p{N}])/giu,
  ];
  for (const pattern of rangePatterns) {
    for (const match of normalized.matchAll(pattern)) {
      for (const value of [match[1], match[2]]) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) sizes.add(String(parsed));
      }
    }
  }
  const patterns = [
    /(?:^|[^\p{L}\p{N}])(?:sizes?|사이즈|サイズ|us|uk|eu|jp|kr)\s*[:#-]?\s*(\d{1,3}(?:\.\d{1,2})?)(?:\s*mm)?(?![\p{L}\p{N}])/giu,
    /(?:^|[^\p{L}\p{N}-])(\d{1,3}(?:\.\d{1,2})?)\s*(?:mm\s*)?(?:sizes?|사이즈|サイズ)(?![\p{L}\p{N}])/giu,
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) sizes.add(String(parsed));
    }
  }
  return [...sizes];
}

export function assessCompetitorMatch(
  referenceInput: CompetitorProductIdentity,
  candidate: { title: string; identity?: CompetitorCandidateIdentity },
): CompetitorMatchAssessment {
  const reference = resolveReferenceIdentity(referenceInput);
  const observed = resolveCandidateIdentity(candidate);
  const matchEvidence: CompetitorMatchEvidence[] = [];
  const mismatchEvidence: CompetitorMatchEvidence[] = [];
  let score = 0;

  const referenceGtins = normalizedGtins(reference.gtins);
  const candidateGtins = normalizedGtins(observed.gtins);
  const matchingGtin = referenceGtins.find((gtin) => candidateGtins.includes(gtin));
  if (referenceGtins.length && candidateGtins.length && !matchingGtin) {
    addMismatch(mismatchEvidence, "gtin", referenceGtins.join(","), candidateGtins.join(","));
  } else if (matchingGtin) {
    matchEvidence.push({ code: "gtin_exact", attribute: "gtin", expected: matchingGtin, actual: matchingGtin, source: observed.gtins?.length ? "provider_structured" : "listing_title" });
    score += 100;
  }

  const brandAliases = aliasesFor(referenceInput, "brand", reference.brand);
  const brandMatched = Boolean(reference.brand && exactOrContainedAlias(observed.brand, candidate.title, brandAliases));
  if (reference.brand && observed.brand && !brandMatched) addMismatch(mismatchEvidence, "brand", reference.brand, observed.brand);
  else if (brandMatched) {
    matchEvidence.push({ code: "brand_exact", attribute: "brand", expected: reference.brand, actual: observed.brand ?? candidate.title, source: observed.brand ? "provider_structured" : "listing_title" });
    score += 20;
  }

  const nameAliases = aliasesFor(referenceInput, "productName", reference.productName);
  const productNameMatched = exactOrContainedAlias(observed.productName, candidate.title, nameAliases);
  const nameSimilarity = tokenSimilarity(reference.productName, observed.productName ?? candidate.title);
  if (productNameMatched) {
    matchEvidence.push({ code: "product_name_exact", attribute: "productName", expected: reference.productName, actual: observed.productName ?? candidate.title, source: observed.productName ? "provider_structured" : "listing_title" });
    score += 35;
  } else if (nameSimilarity >= 0.6) {
    matchEvidence.push({ code: "product_name_similar", attribute: "productName", expected: reference.productName, actual: observed.productName ?? candidate.title, source: "listing_title" });
    score += 20;
  }

  const referenceAccessoryCategories = detectedAccessoryCategories(`${referenceInput.productName} ${referenceInput.packageContents ?? ""}`);
  const candidateAccessoryCategories = detectedAccessoryCategories(`${candidate.title} ${candidate.identity?.productName ?? ""} ${candidate.identity?.packageContents ?? ""}`);
  const unexpectedAccessoryCategories = [...candidateAccessoryCategories]
    .filter((category) => !referenceAccessoryCategories.has(category));
  if (unexpectedAccessoryCategories.length > 0) {
    addMismatch(
      mismatchEvidence,
      "productType",
      "main_product",
      unexpectedAccessoryCategories.sort().join(","),
      "accessory_product_mismatch",
      "listing_title",
    );
  }

  const mpnAliases = aliasesFor(referenceInput, "manufacturerPartNumber", reference.manufacturerPartNumber);
  const normalizedObservedMpn = normalizeLooseText(observed.manufacturerPartNumber);
  const mpnMatched = Boolean(reference.manufacturerPartNumber && exactOrContainedAlias(observed.manufacturerPartNumber, candidate.title, mpnAliases));
  if (reference.manufacturerPartNumber && observed.manufacturerPartNumber && !mpnMatched) {
    addMismatch(mismatchEvidence, "manufacturerPartNumber", reference.manufacturerPartNumber, observed.manufacturerPartNumber, "mpn_mismatch");
  } else if (mpnMatched) {
    matchEvidence.push({ code: "mpn_exact", attribute: "manufacturerPartNumber", expected: reference.manufacturerPartNumber, actual: observed.manufacturerPartNumber ?? candidate.title, source: normalizedObservedMpn ? "provider_structured" : "listing_title" });
    score += 45;
  }

  const modelAliases = aliasesFor(referenceInput, "modelNumber", reference.modelNumber);
  const modelMatched = Boolean(reference.modelNumber && exactOrContainedAlias(observed.modelNumber, candidate.title, modelAliases));
  if (reference.modelNumber && observed.modelNumber && !modelMatched) addMismatch(mismatchEvidence, "modelNumber", reference.modelNumber, observed.modelNumber, "model_mismatch");
  else if (reference.modelNumber && !observed.modelNumber && !modelMatched) {
    const referenceModels = explicitLatinModelTokens(reference.modelNumber);
    const titleModels = explicitLatinModelTokens(candidate.title);
    if (referenceModels.length > 0 && titleModels.length > 0) {
      addMismatch(mismatchEvidence, "modelNumber", reference.modelNumber, titleModels.join(","), "model_title_mismatch", "listing_title");
    }
  }
  else if (modelMatched) {
    matchEvidence.push({ code: "model_exact", attribute: "modelNumber", expected: reference.modelNumber, actual: observed.modelNumber ?? candidate.title, source: observed.modelNumber ? "provider_structured" : "listing_title" });
    score += 35;
  }

  if (reference.manufacturer && observed.manufacturer) {
    if (normalizeLooseText(reference.manufacturer) !== normalizeLooseText(observed.manufacturer)) addMismatch(mismatchEvidence, "manufacturer", reference.manufacturer, observed.manufacturer);
    else matchEvidence.push({ code: "manufacturer_exact", attribute: "manufacturer", expected: reference.manufacturer, actual: observed.manufacturer, source: "provider_structured" });
  }

  const quantityPairs: Array<[string, CompetitorQuantity | undefined, CompetitorQuantity | undefined]> = [
    ["specification", reference.specification, observed.specification],
    ["totalQuantity", reference.totalQuantity, observed.totalQuantity],
  ];
  for (const [attribute, expected, actual] of quantityPairs) {
    if (expected && actual && !sameQuantity(expected, actual)) addMismatch(mismatchEvidence, attribute, displayQuantity(expected), displayQuantity(actual));
    else if (expected && actual) {
      matchEvidence.push({ code: `${attribute}_exact`, attribute, expected: displayQuantity(expected), actual: displayQuantity(actual), source: candidate.identity?.[attribute as "specification" | "totalQuantity"] ? "provider_structured" : "listing_title" });
      score += attribute === "specification" ? 10 : 5;
    }
  }

  if (reference.itemCount && observed.itemCount && reference.itemCount !== observed.itemCount) addMismatch(mismatchEvidence, "itemCount", reference.itemCount, observed.itemCount, "pack_count_mismatch");
  else if (reference.itemCount && observed.itemCount) {
    matchEvidence.push({ code: "item_count_exact", attribute: "itemCount", expected: String(reference.itemCount), actual: String(observed.itemCount), source: candidate.identity?.itemCount ? "provider_structured" : "listing_title" });
    score += 5;
  }

  for (const attribute of ["packageType", "contentType", "condition", "purchaseType"] as const) {
    const expected = reference[attribute];
    const actual = observed[attribute];
    if (expected && actual && expected !== actual) addMismatch(mismatchEvidence, attribute, expected, actual);
    else if (expected && actual) {
      matchEvidence.push({ code: `${attribute}_exact`, attribute, expected, actual, source: candidate.identity?.[attribute] ? "provider_structured" : "listing_title" });
      score += 3;
    }
  }

  for (const attribute of optionAttributes) {
    const expected = reference.options?.[attribute];
    if (!expected) continue;
    const actual = observed.options?.[attribute];
    const detectableAttribute = attribute === "flavor" || attribute === "color" || attribute === "size" ? attribute : null;
    const expectedCanonical = detectableAttribute ? canonicalDetectableOption(detectableAttribute, expected) : "";
    const titleOptions = detectableAttribute ? detectedOptions(detectableAttribute, candidate.title) : [];
    const expectedNumericSize = attribute === "size" ? canonicalNumericSize(expected) : "";
    const titleNumericSizes = attribute === "size" ? detectedNumericSizes(candidate.title) : [];
    const matchedInTitle = !actual && (
      containsIdentityPhrase(candidate.title, expected)
      || Boolean(expectedCanonical && titleOptions.includes(expectedCanonical))
      || Boolean(expectedNumericSize && titleNumericSizes.includes(expectedNumericSize))
    );
    const explicitTitleConflict = (Boolean(expectedCanonical) && titleOptions.length > 0
        && (!titleOptions.includes(expectedCanonical) || new Set(titleOptions).size > 1))
      || (Boolean(expectedNumericSize) && titleNumericSizes.length > 0
        && (!titleNumericSizes.includes(expectedNumericSize) || titleNumericSizes.length > 1));
    const titleOptionEvidence = [...new Set([...titleOptions, ...titleNumericSizes])].join(",");
    if (actual && normalizeLooseText(expected) !== normalizeLooseText(actual)) addMismatch(mismatchEvidence, attribute, expected, actual, "option_mismatch");
    else if (explicitTitleConflict) addMismatch(mismatchEvidence, attribute, expected, titleOptionEvidence, "option_mismatch", "listing_title");
    else if (actual || matchedInTitle) {
      matchEvidence.push({ code: "option_exact", attribute, expected, actual: actual ?? expected, source: actual ? "provider_structured" : "listing_title" });
      score += 4;
    }
  }

  // Structured provider fields do not get to conceal an explicit conflicting
  // claim in the listing title. Only facts that the title states directly are
  // checked here; an absent title fact remains unknown and is never inferred.
  const titleSpecification = explicitSpecification(candidate.title) ?? undefined;
  const titleQuantities = explicitQuantities(candidate.title).filter((quantity) => quantity.dimension !== "count");
  const titleItemCount = explicitItemCount(candidate.title) ?? undefined;
  const titleTotalQuantity = multipliedQuantity(titleSpecification ?? null, titleItemCount ?? null) ?? undefined;
  const explicitTitleFacts = {
    specification: titleSpecification,
    itemCount: titleItemCount,
    totalQuantity: titleTotalQuantity,
    packageType: explicitPackageType(candidate.title, titleItemCount ?? null),
    contentType: explicitContentType(candidate.title),
    condition: explicitCondition(candidate.title),
    purchaseType: explicitPurchaseType(candidate.title),
  };
  for (const [attribute, expected, actual] of [
    ["specification", reference.specification, explicitTitleFacts.specification],
    ["totalQuantity", reference.totalQuantity, explicitTitleFacts.totalQuantity],
  ] as const) {
    if (expected && actual && !sameQuantity(expected, actual)) {
      addMismatch(mismatchEvidence, attribute, displayQuantity(expected), displayQuantity(actual), `${attribute}_title_mismatch`, "listing_title");
    }
  }
  const expectedTitleQuantities = [reference.specification, reference.totalQuantity]
    .filter((quantity): quantity is CompetitorQuantity => Boolean(quantity))
    .filter((quantity, index, quantities) => quantities.findIndex((candidate) => sameQuantity(candidate, quantity)) === index);
  for (const actual of titleQuantities) {
    const sameDimensionExpected = expectedTitleQuantities.filter((expected) => (
      normalizeCompetitorQuantity(expected)?.dimension === actual.dimension
    ));
    if (sameDimensionExpected.length > 0 && !sameDimensionExpected.some((expected) => sameQuantity(expected, actual))) {
      addMismatch(
        mismatchEvidence,
        "specification",
        sameDimensionExpected.map(displayQuantity).join(","),
        displayQuantity(actual),
        "title_quantity_conflict",
        "listing_title",
      );
    }
  }
  if (reference.itemCount && explicitTitleFacts.itemCount && reference.itemCount !== explicitTitleFacts.itemCount) {
    addMismatch(mismatchEvidence, "itemCount", reference.itemCount, explicitTitleFacts.itemCount, "pack_count_title_mismatch", "listing_title");
  }
  for (const attribute of ["packageType", "contentType", "condition", "purchaseType"] as const) {
    const expected = reference[attribute];
    const actual = explicitTitleFacts[attribute];
    if (expected && actual && expected !== actual) {
      addMismatch(mismatchEvidence, attribute, expected, actual, `${attribute}_title_mismatch`, "listing_title");
    }
  }

  if (mismatchEvidence.length > 0) {
    return {
      matcherVersion: COMPETITOR_MATCHER_VERSION,
      matchTier: "rejected",
      matchScore: Math.min(49, Math.max(0, score)),
      matchEvidence,
      mismatchEvidence,
    };
  }

  if (matchingGtin) {
    return { matcherVersion: COMPETITOR_MATCHER_VERSION, matchTier: "exact", matchScore: 100, matchEvidence, mismatchEvidence };
  }
  const referenceOptions = optionAttributes.filter((attribute) => Boolean(reference.options?.[attribute]));
  const optionsComplete = referenceOptions.every((attribute) => matchEvidence.some((evidence) => evidence.code === "option_exact" && evidence.attribute === attribute));
  const confirmedCriticalAttributesComplete = (!reference.specification || Boolean(observed.specification && sameQuantity(reference.specification, observed.specification)))
    && (!reference.itemCount || reference.itemCount === observed.itemCount)
    && (!reference.totalQuantity || Boolean(observed.totalQuantity && sameQuantity(reference.totalQuantity, observed.totalQuantity)))
    && (!reference.packageType || reference.packageType === observed.packageType)
    && (!reference.contentType || reference.contentType === observed.contentType)
    && (!reference.condition || reference.condition === observed.condition)
    && (!reference.purchaseType || reference.purchaseType === observed.purchaseType)
    && optionsComplete;
  if (brandMatched && (mpnMatched || modelMatched) && confirmedCriticalAttributesComplete) {
    return { matcherVersion: COMPETITOR_MATCHER_VERSION, matchTier: "exact", matchScore: Math.min(99, Math.max(94, score)), matchEvidence, mismatchEvidence };
  }

  const descriptiveExact = brandMatched
    && productNameMatched
    && Boolean(reference.specification && observed.specification && sameQuantity(reference.specification, observed.specification))
    && Boolean(reference.itemCount && observed.itemCount && reference.itemCount === observed.itemCount)
    && (!reference.totalQuantity || Boolean(observed.totalQuantity && sameQuantity(reference.totalQuantity, observed.totalQuantity)))
    && referenceOptions.length > 0
    && confirmedCriticalAttributesComplete;
  if (descriptiveExact) {
    return { matcherVersion: COMPETITOR_MATCHER_VERSION, matchTier: "exact", matchScore: Math.min(93, Math.max(88, score)), matchEvidence, mismatchEvidence };
  }

  if (matchEvidence.length === 0) {
    mismatchEvidence.push({
      code: "insufficient_identity_evidence",
      attribute: "identity",
      expected: reference.productName,
      actual: candidate.title,
      source: "listing_title",
    });
    return { matcherVersion: COMPETITOR_MATCHER_VERSION, matchTier: "rejected", matchScore: 0, matchEvidence, mismatchEvidence };
  }
  return {
    matcherVersion: COMPETITOR_MATCHER_VERSION,
    matchTier: "probable",
    matchScore: Math.min(87, Math.max(50, score)),
    matchEvidence,
    mismatchEvidence,
  };
}

function normalizedComponent(component: CompetitorPriceComponentInput, currency: string): Omit<CompetitorPriceComponent, "krwAmount"> {
  if (normalizedCurrency(component.currency) !== currency) throw new RangeError("MIXED_COMPETITOR_CURRENCIES");
  if (component.status === "unknown") return { status: "unknown", amount: null, currency };
  if (typeof component.amount !== "number" || !Number.isFinite(component.amount) || component.amount < 0) throw new RangeError("INVALID_COMPETITOR_PRICE_COMPONENT");
  return { status: "known", amount: rounded(component.amount), currency };
}

export function normalizeCompetitorPrice(input: {
  priceComponents: CompetitorPriceComponentsInput;
  exchangeRate?: CompetitorExchangeRate | null;
  unitQuantity?: CompetitorQuantity | null;
}): CompetitorNormalizedPrice {
  const currency = normalizedCurrency(input.priceComponents.itemPrice.currency);
  const rawComponents = Object.fromEntries(Object.entries(input.priceComponents).map(([key, value]) => (
    [key, normalizedComponent(value, currency)]
  ))) as { [Key in keyof CompetitorPriceComponentsInput]: Omit<CompetitorPriceComponent, "krwAmount"> };

  let exchangeRate: CompetitorExchangeRate | null = null;
  if (currency !== "KRW" && input.exchangeRate) {
    const fromCurrency = normalizedCurrency(input.exchangeRate.fromCurrency);
    const toCurrency = normalizedCurrency(input.exchangeRate.toCurrency);
    const quotedAt = normalizedIsoInstant(input.exchangeRate.quotedAt);
    if (fromCurrency !== currency || toCurrency !== "KRW" || !finitePositive(input.exchangeRate.rate) || !input.exchangeRate.provider.trim() || !quotedAt) {
      throw new RangeError("INVALID_COMPETITOR_EXCHANGE_RATE");
    }
    exchangeRate = {
      provider: input.exchangeRate.provider.trim().slice(0, 200),
      quotedAt,
      rate: input.exchangeRate.rate,
      fromCurrency,
      toCurrency: "KRW",
    };
  }

  const toKrw = (amount: number) => currency === "KRW" ? rounded(amount) : exchangeRate ? rounded(amount * exchangeRate.rate) : null;
  const priceComponents = Object.fromEntries(Object.entries(rawComponents).map(([key, component]) => (
    component.status === "known" && component.amount !== null
      ? [key, { ...component, krwAmount: toKrw(component.amount) }]
      : [key, { ...component, krwAmount: null }]
  ))) as CompetitorPriceComponents;

  const allKnown = Object.values(priceComponents).every((component) => component.status === "known");
  let totalPurchasePrice: CompetitorTotalPurchasePrice | null = null;
  if (allKnown) {
    const itemPrice = priceComponents.itemPrice.amount ?? 0;
    const option = priceComponents.requiredOptionSurcharge.amount ?? 0;
    const shipping = priceComponents.shipping.amount ?? 0;
    const taxAndDuty = priceComponents.taxAndDuty.amount ?? 0;
    const discount = priceComponents.discount.amount ?? 0;
    const amount = rounded(itemPrice + option + shipping + taxAndDuty - discount);
    if (amount > 0) totalPurchasePrice = { amount, currency, krwAmount: toKrw(amount) };
  }

  const quantity = normalizeCompetitorQuantity(input.unitQuantity);
  const unitPrice = totalPurchasePrice && quantity
    ? {
        amount: rounded(totalPurchasePrice.amount / quantity.value),
        currency,
        krwAmount: totalPurchasePrice.krwAmount === null ? null : rounded(totalPurchasePrice.krwAmount / quantity.value),
        // The amount is the price of exactly one normalized base unit (for
        // example 1 g or 1 ml), not the price of the full source quantity.
        quantity: { value: 1, unit: quantity.unit },
      }
    : null;
  return { priceComponents, totalPurchasePrice, exchangeRate, unitPrice };
}

export function knownCompetitorPriceComponent(amount: number, currency: string): CompetitorPriceComponentInput {
  return { status: "known", amount, currency: normalizedCurrency(currency) };
}

export function unknownCompetitorPriceComponent(currency: string): CompetitorPriceComponentInput {
  return { status: "unknown", amount: null, currency: normalizedCurrency(currency) };
}

export function canonicalCompetitorUrl(value: unknown) {
  try {
    const url = new URL(String(value ?? "").trim());
    if (!/^https?:$/u.test(url.protocol) || url.username || url.password) return "";
    url.protocol = url.protocol.toLocaleLowerCase();
    url.hostname = url.hostname.toLocaleLowerCase().replace(/\.$/u, "");
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|gclid|fbclid|ref|referrer|source|campaign)$/iu.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString().slice(0, 4_000);
  } catch {
    return "";
  }
}

function rawCandidatePriceComponents(candidate: CompetitorCandidateV3Input): CompetitorPriceComponentsInput {
  if (candidate.priceComponents) return candidate.priceComponents;
  const currency = normalizedCurrency(candidate.currency);
  // Legacy provider `price` is only a listed item price. It does not prove a
  // zero required-option surcharge, free shipping, zero import tax, or stock.
  // Keep every unreported required component unknown so the observation cannot
  // enter lowest-total-price calculations until a provider confirms them.
  return {
    itemPrice: knownCompetitorPriceComponent(candidate.price, currency),
    requiredOptionSurcharge: unknownCompetitorPriceComponent(currency),
    shipping: unknownCompetitorPriceComponent(currency),
    taxAndDuty: unknownCompetitorPriceComponent(currency),
    discount: unknownCompetitorPriceComponent(currency),
  };
}

export function enrichCompetitorCandidateV3<T extends CompetitorCandidateV3Input>(
  reference: CompetitorProductIdentity,
  candidate: T,
  collectedAt = new Date().toISOString(),
): T & CompetitorPriceObservationV3Fields {
  const observedAt = normalizedIsoInstant(candidate.observedAt) || normalizedIsoInstant(collectedAt) || new Date().toISOString();
  const assessment = assessCompetitorMatch(reference, candidate);
  const candidateIdentity = resolveCandidateIdentity(candidate);
  const unitQuantity = candidateIdentity.totalQuantity ?? candidateIdentity.specification ?? null;
  const normalizedPrice = normalizeCompetitorPrice({
    priceComponents: rawCandidatePriceComponents(candidate),
    exchangeRate: candidate.exchangeRate,
    unitQuantity,
  });
  const canonicalUrl = canonicalCompetitorUrl(candidate.url);
  const fallbackProvenance: CompetitorObservationProvenance = {
    provider: candidate.provider,
    marketplace: candidate.marketplace,
    externalId: candidate.externalId,
    url: candidate.url,
    collectedAt: observedAt,
  };
  return {
    ...candidate,
    ...assessment,
    ...normalizedPrice,
    canonicalUrl,
    // Always retain the source that produced this observation, even if an
    // upstream approved provider already attached additional provenance.
    provenance: mergedProvenance([fallbackProvenance], candidate.provenance ?? []),
    observedAt,
    inventoryStatus: candidate.inventoryStatus ?? "unknown",
  };
}

function mergedProvenance(left: CompetitorObservationProvenance[], right: CompetitorObservationProvenance[]) {
  const merged = new Map<string, CompetitorObservationProvenance>();
  for (const item of [...left, ...right]) {
    const key = `${item.provider}:${item.marketplace}:${item.externalId}:${canonicalCompetitorUrl(item.url) || item.url}`;
    const current = merged.get(key);
    if (!current || Date.parse(item.collectedAt) > Date.parse(current.collectedAt)) merged.set(key, item);
  }
  return [...merged.values()];
}

function preferredObservation<T extends CompetitorCandidateV3Input & CompetitorPriceObservationV3Fields>(left: T, right: T) {
  const tierRank: Record<CompetitorMatchTier, number> = { exact: 3, probable: 2, rejected: 1 };
  if (tierRank[left.matchTier] !== tierRank[right.matchTier]) return tierRank[left.matchTier] > tierRank[right.matchTier] ? left : right;
  const leftTotal = left.totalPurchasePrice?.krwAmount;
  const rightTotal = right.totalPurchasePrice?.krwAmount;
  if (finitePositive(leftTotal) !== finitePositive(rightTotal)) return finitePositive(leftTotal) ? left : right;
  const leftTime = Date.parse(left.observedAt);
  const rightTime = Date.parse(right.observedAt);
  if (leftTime !== rightTime) return leftTime > rightTime ? left : right;
  if (finitePositive(leftTotal) && finitePositive(rightTotal) && leftTotal !== rightTotal) return leftTotal < rightTotal ? left : right;
  return left;
}

function deduplicateCompetitorObservationsByScope<T extends CompetitorCandidateV3Input & CompetitorPriceObservationV3Fields>(
  items: readonly T[],
  sameProviderOnly: boolean,
) {
  const deduplicated: T[] = [];
  for (const item of items) {
    const canonicalUrl = item.canonicalUrl || canonicalCompetitorUrl(item.url);
    const index = deduplicated.findIndex((existing) => (
      (!sameProviderOnly || existing.provider === item.provider)
      && (
        (existing.marketplace === item.marketplace
          && Boolean(existing.externalId)
          && existing.externalId.toLocaleLowerCase() === item.externalId.toLocaleLowerCase())
        || (Boolean(canonicalUrl) && (existing.canonicalUrl || canonicalCompetitorUrl(existing.url)) === canonicalUrl)
      )
    ));
    if (index < 0) {
      deduplicated.push({ ...item, canonicalUrl });
      continue;
    }
    const existing = deduplicated[index];
    const preferred = preferredObservation(existing, item);
    deduplicated[index] = {
      ...preferred,
      canonicalUrl: preferred.canonicalUrl || canonicalUrl,
      provenance: mergedProvenance(existing.provenance, item.provenance),
    };
  }
  return deduplicated;
}

/** Display-level dedupe: equivalent observations may merge across providers. */
export function deduplicateCompetitorObservations<T extends CompetitorCandidateV3Input & CompetitorPriceObservationV3Fields>(items: readonly T[]) {
  return deduplicateCompetitorObservationsByScope(items, false);
}

/**
 * Persistence-level dedupe: collapse retries from one provider without ever
 * merging a different provider's raw fields into the preferred observation.
 */
export function deduplicateCompetitorSourceObservations<T extends CompetitorCandidateV3Input & CompetitorPriceObservationV3Fields>(items: readonly T[]) {
  return deduplicateCompetitorObservationsByScope(items, true);
}

export type CompetitorLowestPriceIneligibilityReason =
  | "match_not_exact"
  | "not_in_stock"
  | "snapshot_time_unknown"
  | "snapshot_stale"
  | "total_purchase_price_unavailable"
  | "krw_conversion_unavailable";

export function competitorLowestPriceEligibility(
  observation: Pick<CompetitorPriceObservationV3Fields, "matchTier" | "inventoryStatus" | "observedAt" | "totalPurchasePrice"> & { checkedAt?: string },
  options: { now?: Date | string | number; maxAgeMs?: number } = {},
) {
  const reasons: CompetitorLowestPriceIneligibilityReason[] = [];
  if (observation.matchTier !== "exact") reasons.push("match_not_exact");
  if (observation.inventoryStatus !== "in_stock") reasons.push("not_in_stock");
  const observedAt = Date.parse(observation.observedAt || observation.checkedAt || "");
  const now = options.now instanceof Date ? options.now.getTime() : options.now === undefined ? Date.now() : new Date(options.now).getTime();
  const maxAgeMs = options.maxAgeMs ?? COMPETITOR_PRICE_FRESHNESS_MS;
  if (!Number.isFinite(observedAt) || !Number.isFinite(now) || !finitePositive(maxAgeMs) || observedAt > now + 60_000) reasons.push("snapshot_time_unknown");
  else if (now - observedAt > maxAgeMs) reasons.push("snapshot_stale");
  if (!observation.totalPurchasePrice || !finitePositive(observation.totalPurchasePrice.amount)) reasons.push("total_purchase_price_unavailable");
  else if (!finitePositive(observation.totalPurchasePrice.krwAmount)) reasons.push("krw_conversion_unavailable");
  return { eligible: reasons.length === 0, reasons };
}

export function lowestEligibleCompetitorPrice<T extends Parameters<typeof competitorLowestPriceEligibility>[0]>(
  observations: readonly T[],
  options: Parameters<typeof competitorLowestPriceEligibility>[1] = {},
) {
  return observations
    .filter((observation) => competitorLowestPriceEligibility(observation, options).eligible)
    .sort((left, right) => (left.totalPurchasePrice?.krwAmount ?? Number.POSITIVE_INFINITY) - (right.totalPurchasePrice?.krwAmount ?? Number.POSITIVE_INFINITY))[0] ?? null;
}

export type CompetitorPriceFollowExclusion =
  | "competitor_price_unavailable"
  | "target_margin_not_met"
  | "margin_floor_breached";

export type CompetitorPriceSuggestion = {
  suggestedPrice: number;
  targetMarginPrice: number;
  marginFloorPrice: number;
  competitorFollowPrice: number | null;
  followsCompetitor: boolean;
  exclusionReason: CompetitorPriceFollowExclusion | null;
};

function roundedUp(value: number, increment: number) {
  return Math.ceil((value - Number.EPSILON) / increment) * increment;
}

export function suggestCompetitorAwarePrice(input: {
  productCost: number;
  fulfillmentShipping: number;
  taxAndDuty: number;
  channelFeeRate: number;
  targetMarginRate: number;
  minimumMarginRate: number;
  competitorTotalPurchasePrice?: number | null;
  undercutAmount?: number;
  roundingIncrement?: number;
}): CompetitorPriceSuggestion {
  const nonNegative = [input.productCost, input.fulfillmentShipping, input.taxAndDuty, input.undercutAmount ?? 0];
  if (nonNegative.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new RangeError("INVALID_PRICE_SUGGESTION_INPUT");
  if (![input.channelFeeRate, input.targetMarginRate, input.minimumMarginRate].every((value) => Number.isFinite(value) && value >= 0 && value < 1)) throw new RangeError("INVALID_PRICE_SUGGESTION_RATE");
  if (input.minimumMarginRate > input.targetMarginRate) throw new RangeError("MINIMUM_MARGIN_EXCEEDS_TARGET");
  const targetDivisor = 1 - input.channelFeeRate - input.targetMarginRate;
  const floorDivisor = 1 - input.channelFeeRate - input.minimumMarginRate;
  if (targetDivisor <= 0 || floorDivisor <= 0) throw new RangeError("UNACHIEVABLE_PRICE_SUGGESTION_RATE");
  const roundingIncrement = input.roundingIncrement ?? 1;
  if (!finitePositive(roundingIncrement)) throw new RangeError("INVALID_PRICE_ROUNDING_INCREMENT");
  const fixedCosts = input.productCost + input.fulfillmentShipping + input.taxAndDuty;
  const targetMarginPrice = roundedUp(fixedCosts / targetDivisor, roundingIncrement);
  const marginFloorPrice = roundedUp(fixedCosts / floorDivisor, roundingIncrement);
  const competitorPrice = input.competitorTotalPurchasePrice;
  if (!finitePositive(competitorPrice)) {
    return {
      suggestedPrice: targetMarginPrice,
      targetMarginPrice,
      marginFloorPrice,
      competitorFollowPrice: null,
      followsCompetitor: false,
      exclusionReason: "competitor_price_unavailable",
    };
  }
  const competitorFollowPrice = roundedUp(Math.max(0, competitorPrice - (input.undercutAmount ?? 0)), roundingIncrement);
  if (competitorFollowPrice < marginFloorPrice) {
    return {
      suggestedPrice: targetMarginPrice,
      targetMarginPrice,
      marginFloorPrice,
      competitorFollowPrice,
      followsCompetitor: false,
      exclusionReason: "margin_floor_breached",
    };
  }
  if (competitorFollowPrice < targetMarginPrice) {
    return {
      suggestedPrice: targetMarginPrice,
      targetMarginPrice,
      marginFloorPrice,
      competitorFollowPrice,
      followsCompetitor: false,
      exclusionReason: "target_margin_not_met",
    };
  }
  return {
    suggestedPrice: competitorFollowPrice,
    targetMarginPrice,
    marginFloorPrice,
    competitorFollowPrice,
    followsCompetitor: true,
    exclusionReason: null,
  };
}
