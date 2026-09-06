import type { ActiveChannelKey } from "./catalog";
import { smartstoreIndicationUnits } from "./smartstore-unit-capacity";
import {
  elevenstProcessedFoodCategoryId,
  elevenstProcessedFoodNotificationFields,
} from "./elevenst-listing";

export type ListingRequirementStatus = "ready" | "manual" | "runtime";

export type ListingRequirement = {
  key: string;
  label: string;
  source: "상품 정보" | "카테고리" | "판매자 계정";
  status: ListingRequirementStatus;
  manualPath?: string[];
  inputType?: "boolean" | "number";
  placeholder?: string;
  help?: string;
};

type RequirementSpec = Omit<ListingRequirement, "status"> & {
  path?: Array<string | number>;
  test?: (draft: Record<string, unknown>) => boolean;
  runtime?: boolean;
  applies?: (draft: Record<string, unknown>) => boolean;
};

const unknownValue = /^(?:server_managed|seller confirmation required|unknown|not provided|n\/a|tbd|알\s*수\s*없음|모름|미정|미기재|미확인|확인\s*필요|판매자\s*확인\s*필요)$/iu;

function valueAt(value: unknown, path: Array<string | number>) {
  return path.reduce<unknown>((current, part) => {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    return (current as Record<string | number, unknown>)[part];
  }, value);
}

function meaningful(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (typeof value === "string") return value.trim().length > 0 && !unknownValue.test(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined;
}

function meaningfulIncludingZero(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0;
  return meaningful(value);
}

function positive(path: Array<string | number>) {
  return (draft: Record<string, unknown>) => Number(valueAt(draft, path)) > 0;
}

function positiveFields(draft: Record<string, unknown>, paths: Array<Array<string | number>>) {
  return paths.every((path) => Number(valueAt(draft, path)) > 0);
}

function itemHasAttribute(draft: Record<string, unknown>, name: string) {
  const attributes = valueAt(draft, ["body", "attributes"]);
  if (!Array.isArray(attributes)) return false;
  const match = attributes.find((item) => item && typeof item === "object" && String((item as Record<string, unknown>).name).toLowerCase() === name.toLowerCase());
  const values = match && typeof match === "object" ? (match as Record<string, unknown>).value : undefined;
  return Array.isArray(values) && values.some(meaningful);
}

const coupangPlaceholderNotice = /^(?:상품\s*상세\s*참조|상세(?:페이지)?\s*참조|상품정보\s*참조)$/iu;

function coupangMeaningfulNoticeContent(value: unknown) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  return text.length > 0 && !unknownValue.test(text) && !coupangPlaceholderNotice.test(text);
}

export type CoupangNoticeEnvelope = {
  noticeCategoryName: string;
  details: Record<string, string>;
};

export function parseCoupangNoticeEnvelope(value: unknown): CoupangNoticeEnvelope | null {
  let parsed = value;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || !keys.includes("noticeCategoryName") || !keys.includes("details")) {
    return null;
  }
  const noticeCategoryName = coupangMeaningfulNoticeContent(record.noticeCategoryName)
    ? String(record.noticeCategoryName).trim()
    : "";
  if (!noticeCategoryName) return null;
  if (!record.details || typeof record.details !== "object" || Array.isArray(record.details)) {
    return null;
  }
  const details: Record<string, string> = {};
  for (const [key, content] of Object.entries(record.details as Record<string, unknown>)) {
    const name = key.trim();
    if (!name || !coupangMeaningfulNoticeContent(content) || Object.hasOwn(details, name)) return null;
    details[name] = String(content).trim();
  }
  return Object.keys(details).length > 0 ? { noticeCategoryName, details } : null;
}

function coupangNativeNoticesConfirmed(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return false;
  const categories = new Set<string>();
  for (const notice of value) {
    if (!notice || typeof notice !== "object") return false;
    const row = notice as Record<string, unknown>;
    const noticeCategoryName = coupangMeaningfulNoticeContent(row.noticeCategoryName)
      ? String(row.noticeCategoryName).trim()
      : "";
    const noticeCategoryDetailName = coupangMeaningfulNoticeContent(row.noticeCategoryDetailName)
      ? String(row.noticeCategoryDetailName).trim()
      : "";
    if (!noticeCategoryName || !noticeCategoryDetailName || !coupangMeaningfulNoticeContent(row.content)) {
      return false;
    }
    categories.add(noticeCategoryName);
  }
  return categories.size === 1;
}

function coupangNoticesConfirmed(draft: Record<string, unknown>) {
  return Boolean(parseCoupangNoticeEnvelope(valueAt(draft, ["facts", "noticeContent"])))
    || coupangNativeNoticesConfirmed(valueAt(draft, ["body", "items", 0, "notices"]));
}

const sharedImage = (path: Array<string | number>): RequirementSpec => ({
  key: "images",
  label: "공개 상품 이미지",
  source: "상품 정보",
  path,
  help: "채널 작업자가 공식 이미지 API 규격으로 다시 업로드합니다.",
});

function elevenstNotificationValue(draft: Record<string, unknown>, code: string) {
  const items = valueAt(draft, ["product", "ProductNotification", "item"]);
  if (!Array.isArray(items)) return undefined;
  const item = items.find((candidate) => candidate && typeof candidate === "object"
    && String((candidate as Record<string, unknown>).code) === code);
  return item && typeof item === "object" ? (item as Record<string, unknown>).name : undefined;
}

const elevenstFoodExplicitConfirmationCodes = new Set(["176398001", "23757260", "23757095", "23756754"]);
const elevenstProcessedFoodRequirements: RequirementSpec[] = elevenstProcessedFoodNotificationFields.map((field) => ({
  key: `food-notice-${field.code}`,
  label: `가공식품 고시 · ${field.label}`,
  source: "카테고리",
  applies: (draft) => String(valueAt(draft, ["product", "dispCtgrNo"])) === elevenstProcessedFoodCategoryId,
  test: (draft) => meaningful(elevenstNotificationValue(draft, field.code)),
  help: elevenstFoodExplicitConfirmationCodes.has(field.code)
    ? `추정하지 않습니다. 카테고리 속성 notification:${field.code}에 판매자가 확인한 확정값을 입력해 주세요.`
    : `카테고리 속성 notification:${field.code}에 확정값을 입력해 주세요.`,
}));

const smartstoreCapacityPath = ["body", "originProduct", "detailAttribute", "unitCapacity"];
const smartstoreCapacityAmounts = ["totalCapacityValue", "unitCapacity", "indicationUnit"];
function smartstoreCapacity(draft: Record<string, unknown>) {
  const value = valueAt(draft, smartstoreCapacityPath);
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
const capacityAmountsApply = (draft: Record<string, unknown>) => {
  const value = smartstoreCapacity(draft);
  return value.unitPriceYn !== false || smartstoreCapacityAmounts.some((key) => Object.hasOwn(value, key));
};

export function isSmartstoreCapacityPath(path: string[]) {
  return path.length === 5 && smartstoreCapacityPath.every((part, index) => path[index] === part)
    && ["unitPriceYn", ...smartstoreCapacityAmounts].includes(path[4]);
}

/** Only these provider fields use typed inputs; other channels keep their existing setter contract. */
export function setSmartstoreCapacityDraftValue(draft: Record<string, unknown>, path: string[], value: string) {
  if (!isSmartstoreCapacityPath(path)) throw new Error("SMARTSTORE_CAPACITY_PATH_INVALID");
  const clone = setListingDraftValue(draft, path, value);
  const capacity = smartstoreCapacity(clone);
  const key = path[4];
  if (value === "") delete capacity[key];
  else if (key === "unitPriceYn" && ["true", "false"].includes(value)) capacity[key] = value === "true";
  else if (["totalCapacityValue", "unitCapacity"].includes(key) && /^\d+(?:\.\d+)?$/.test(value)) capacity[key] = Number(value);
  return clone;
}

/** UI boundary: malformed JSON containers stay untouched and return an actionable message. */
export function editSmartstoreCapacityDraftValue(draft: Record<string, unknown>, path: string[], value: string):
  { ok: true; draft: Record<string, unknown> } | { ok: false; message: string } {
  try {
    return { ok: true, draft: setSmartstoreCapacityDraftValue(draft, path, value) };
  } catch {
    return { ok: false, message: "단위가격 JSON 구조를 확인해 주세요. ‘채널 공식 payload 최종 검토’에서 body.originProduct.detailAttribute.unitCapacity를 객체로 수정한 뒤 입력해 주세요. 기존 입력은 보존했습니다." };
  }
}

export function isCoupangWeightPath(path: string[]) {
  return path.length === 2 && path[0] === "facts" && path[1] === "weightAttribute";
}

/** Confirmed net weight never follows the shipping/package mass during common edits. */
export function preserveCoupangWeightDraft(current: Record<string, unknown>, next: Record<string, unknown>) {
  const facts = current.facts;
  if (!facts || typeof facts !== "object" || Array.isArray(facts) || !Object.hasOwn(facts, "weightAttribute")) return next;
  const clone = structuredClone(next);
  if (!clone.facts || typeof clone.facts !== "object" || Array.isArray(clone.facts)) throw new Error("COUPANG_WEIGHT_CONTAINER_INVALID");
  (clone.facts as Record<string, unknown>).weightAttribute = structuredClone((facts as Record<string, unknown>).weightAttribute);
  return clone;
}

/** Preserve exact JSON types, including invalid values, so rebuilding never silently repairs an approval input. */
export function preserveSmartstoreCapacityDraft(current: Record<string, unknown>, next: Record<string, unknown>) {
  const currentDetail = valueAt(current, smartstoreCapacityPath.slice(0, -1));
  if (!currentDetail || typeof currentDetail !== "object" || !Object.hasOwn(currentDetail, "unitCapacity")) return next;
  const clone = structuredClone(next);
  const nextDetail = valueAt(clone, smartstoreCapacityPath.slice(0, -1));
  if (!nextDetail || typeof nextDetail !== "object" || Array.isArray(nextDetail)) throw new Error("SMARTSTORE_CAPACITY_CONTAINER_INVALID");
  (nextDetail as Record<string, unknown>).unitCapacity = structuredClone((currentDetail as Record<string, unknown>).unitCapacity);
  return clone;
}

const smartstoreCapacityRequirements: RequirementSpec[] = [
  { key: "unit-price-enabled", label: "단위가격 표시 여부", source: "카테고리", inputType: "boolean",
    manualPath: [...smartstoreCapacityPath, "unitPriceYn"],
    test: (draft) => { const value = smartstoreCapacity(draft); return typeof value.unitPriceYn === "boolean"
      && (value.unitPriceYn || !smartstoreCapacityAmounts.some((key) => Object.hasOwn(value, key))); },
    help: "대상 여부를 확인해 선택하세요. 필수 카테고리는 비대상으로 전송할 수 없습니다. 비대상은 수량·단위를 비워야 합니다. 등록 직전 공식 카테고리로 다시 검증합니다." },
  { key: "unit-total-capacity", label: "판매단위의 총용량", source: "상품 정보", inputType: "number",
    manualPath: [...smartstoreCapacityPath, "totalCapacityValue"], applies: capacityAmountsApply,
    test: (draft) => { const value = smartstoreCapacity(draft).totalCapacityValue; return typeof value === "number" && Number.isFinite(value)
      && value >= 0.001 && value <= 999_999_999 && /^\d+(?:\.\d{1,3})?$/.test(String(value)); },
    help: "실제 판매 구성 전체의 용량을 입력하세요. 배송중량이나 묶음 수에서 추정하지 않습니다. 소수 셋째 자리까지 입력할 수 있습니다." },
  { key: "unit-display-capacity", label: "단위가격 기준량", source: "카테고리", inputType: "number",
    manualPath: [...smartstoreCapacityPath, "unitCapacity"], applies: capacityAmountsApply,
    test: (draft) => { const value = smartstoreCapacity(draft).unitCapacity; return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 999; },
    help: "상품군에 적용되는 기준량을 확인해 입력하세요. 1~999의 정수이며 기본값을 자동 적용하지 않습니다." },
  { key: "unit-indication", label: "용량 단위", source: "카테고리",
    manualPath: [...smartstoreCapacityPath, "indicationUnit"], applies: capacityAmountsApply,
    test: (draft) => { const value = smartstoreCapacity(draft).indicationUnit; return typeof value === "string" && (smartstoreIndicationUnits as readonly string[]).includes(value); },
    help: `공식 단위 중 상품에 맞는 값을 입력하세요: ${smartstoreIndicationUnits.join(", ")}` },
];

const specs: Record<ActiveChannelKey, RequirementSpec[]> = {
  qoo10: [
    { key: "category", label: "Qoo10 말단 카테고리", source: "카테고리", path: ["params", "SecondSubCat"] },
    {
      key: "title",
      label: "Qoo10 일본어 상품명",
      source: "상품 정보",
      path: ["params", "ItemTitle"],
      manualPath: ["params", "ItemTitle"],
      placeholder: "洋菓子の販売者確認済み商品",
      help: "Qoo10 Japan은 한글이 없는 일본어 상품명이 필요합니다. 확정 카테고리 일본어명으로 채웠으면 확인해 주세요.",
    },
    { key: "retail-price", label: "Qoo10 정가", source: "상품 정보", test: (draft) => meaningfulIncludingZero(valueAt(draft, ["params", "RetailPrice"])) },
    { key: "origin-type", label: "Qoo10 원산지 유형", source: "상품 정보", test: (draft) => ["1", "2", "3"].includes(String(valueAt(draft, ["params", "ProductionPlaceType"]))) },
    { key: "origin", label: "원산지", source: "상품 정보", path: ["params", "ProductionPlace"] },
    sharedImage(["params", "StandardImage"]),
    { key: "price", label: "판매가", source: "상품 정보", test: positive(["params", "ItemPrice"]) },
    { key: "stock", label: "재고", source: "상품 정보", test: positive(["params", "ItemQty"]) },
    {
      key: "shipping",
      label: "배송비 코드",
      source: "판매자 계정",
      test: (draft) => valueAt(draft, ["params", "ShippingNo"]) !== undefined,
      manualPath: ["params", "ShippingNo"],
      placeholder: "0",
      help: "QSM 배송비 코드입니다. 0은 Qoo10 무료배송 코드로 유효합니다.",
    },
    {
      key: "available-date-type",
      label: "출고 가능일 유형",
      source: "판매자 계정",
      test: (draft) => meaningfulIncludingZero(valueAt(draft, ["params", "AvailableDateType"])),
      manualPath: ["params", "AvailableDateType"],
      placeholder: "0",
      help: "Qoo10 지정 enum입니다. 0이 일반 출고입니다.",
    },
    {
      key: "available-date-value",
      label: "출고 가능일",
      source: "판매자 계정",
      test: (draft) => meaningfulIncludingZero(valueAt(draft, ["params", "AvailableDateValue"])),
      manualPath: ["params", "AvailableDateValue"],
      placeholder: "3",
      help: "출고 가능일 유형과 짝이 맞아야 합니다. 유형 0은 일수입니다.",
    },
  ],
  shopee: [
    { key: "shop", label: "승인 Shop ID", source: "판매자 계정", path: ["shopId"] },
    { key: "category", label: "Shopee 말단 카테고리", source: "카테고리", path: ["body", "category_id"] },
    { key: "title", label: "글로벌 상품명", source: "상품 정보", path: ["body", "global_item_name"] },
    { key: "description", label: "상품 설명", source: "상품 정보", path: ["body", "description"] },
    { key: "brand", label: "브랜드", source: "상품 정보", path: ["body", "brand", "original_brand_name"] },
    sharedImage(["imageUrls"]),
    { key: "price", label: "글로벌 기준가", source: "상품 정보", test: positive(["body", "original_price"]) },
    { key: "stock", label: "재고", source: "상품 정보", test: positive(["body", "normal_stock"]) },
    { key: "package", label: "포장 중량·규격", source: "상품 정보", test: (draft) => positiveFields(draft, [["body", "weight"], ["body", "dimension", "package_length"], ["body", "dimension", "package_width"], ["body", "dimension", "package_height"]]) },
    { key: "logistics", label: "활성 물류 채널", source: "판매자 계정", runtime: true, help: "등록 직전 Shopee 계정의 활성 물류 채널을 자동 조회합니다." },
  ],
  lazada: [
    { key: "market", label: "승인 판매 국가", source: "판매자 계정", path: ["country"] },
    { key: "category", label: "Lazada 말단 카테고리", source: "카테고리", path: ["request", "Request", "Product", "PrimaryCategory"] },
    { key: "title", label: "상품명", source: "상품 정보", path: ["request", "Request", "Product", "Attributes", "name"] },
    { key: "description", label: "상품 설명", source: "상품 정보", path: ["request", "Request", "Product", "Attributes", "description"] },
    { key: "brand", label: "브랜드", source: "상품 정보", path: ["request", "Request", "Product", "Attributes", "brand"] },
    sharedImage(["imageUrls"]),
    { key: "sku", label: "판매자 SKU", source: "상품 정보", path: ["request", "Request", "Product", "Skus", "Sku", 0, "SellerSku"] },
    { key: "price", label: "판매가", source: "상품 정보", test: positive(["request", "Request", "Product", "Skus", "Sku", 0, "price"]) },
    { key: "stock", label: "재고", source: "상품 정보", test: positive(["request", "Request", "Product", "Skus", "Sku", 0, "quantity"]) },
    { key: "package", label: "포장 내용·중량·규격", source: "상품 정보", test: (draft) => meaningful(valueAt(draft, ["request", "Request", "Product", "Skus", "Sku", 0, "package_content"])) && positiveFields(draft, [["request", "Request", "Product", "Skus", "Sku", 0, "package_weight"], ["request", "Request", "Product", "Skus", "Sku", 0, "package_length"], ["request", "Request", "Product", "Skus", "Sku", 0, "package_width"], ["request", "Request", "Product", "Skus", "Sku", 0, "package_height"]]) },
  ],
  coupang: [
    { key: "category", label: "쿠팡 노출 카테고리", source: "카테고리", path: ["body", "displayCategoryCode"] },
    { key: "title", label: "상품명", source: "상품 정보", path: ["body", "sellerProductName"] },
    { key: "brand", label: "브랜드", source: "상품 정보", path: ["body", "brand"] },
    { key: "manufacturer", label: "제조사·공급처", source: "상품 정보", path: ["facts", "manufacturer"] },
    { key: "origin", label: "원산지", source: "상품 정보", path: ["facts", "countryOfOrigin"] },
    { key: "material", label: "재질·성분", source: "상품 정보", path: ["facts", "material"] },
    { key: "image", label: "대표 이미지", source: "상품 정보", path: ["body", "items", 0, "images", 0, "vendorPath"] },
    { key: "price", label: "판매가", source: "상품 정보", test: positive(["body", "items", 0, "salePrice"]) },
    { key: "stock", label: "구매 가능 수량", source: "상품 정보", test: positive(["body", "items", 0, "maximumBuyCount"]) },
    { key: "outbound", label: "사용 가능 국내 출고지", source: "판매자 계정", runtime: true, help: "WING 출고지 API에서 사용 가능 상태를 확인합니다." },
    { key: "return", label: "반품지·택배사·반품비", source: "판매자 계정", runtime: true, help: "WING 반품지 API의 실제 주소와 요금을 사용합니다. 계약 택배사·반품비가 없으면 추정하지 않고 등록 전에 차단합니다." },
    {
      key: "notices",
      label: "카테고리 고시정보",
      source: "카테고리",
      test: coupangNoticesConfirmed,
      manualPath: ["facts", "noticeContent"],
      placeholder: "{\"noticeCategoryName\":\"고시군\",\"details\":{\"항목명\":\"판매자 확인값\"}}",
      help: "고시는 JSON 객체만 허용합니다. noticeCategoryName과 details의 항목별 확정값이 필요하고, 한 문장을 모든 필드에 복사하지 않습니다. 상품상세 참조나 스칼라 문자열은 준비 완료가 아닙니다.",
    },
    {
      key: "certification",
      label: "인증·허가 정보",
      source: "카테고리",
      runtime: true,
      manualPath: ["facts", "certificationEvidence"],
      placeholder: "필수 인증코드",
      help: "카테고리 메타에서 필수 인증이 확인되면 판매자 확인 코드가 필요합니다. 문서화되지 않은 dataType은 면책이 아니며, 코드 없이 빈 인증을 만들지 않습니다.",
    },
    {
      key: "weight-attribute",
      label: "판매단위의 확정 순중량",
      source: "상품 정보",
      runtime: true,
      manualPath: ["facts", "weightAttribute"],
      placeholder: "포장에서 확인한 순중량과 단위",
      help: "판매 구성의 순중량을 단위와 함께 입력하세요. 배송·포장 중량으로 추정하지 않습니다. 필수 여부는 공식 카테고리에서 확인하며, 정확한 중량을 모르면 입력하지 않습니다.",
    },
    {
      key: "quantity-attribute",
      label: "수량·구성 속성",
      source: "상품 정보",
      runtime: true,
      manualPath: ["facts", "quantityAttribute"],
      placeholder: "예: 6개",
      help: "카테고리 필수 수량 속성은 판매자가 확인한 값만 사용합니다. 1개처럼 추정하지 않고, 필수가 아니면 메타 조회로 통과합니다.",
    },
  ],
  elevenst: [
    { key: "category", label: "11번가 말단 카테고리", source: "카테고리", path: ["product", "dispCtgrNo"] },
    { key: "title", label: "상품명", source: "상품 정보", path: ["product", "prdNm"] },
    { key: "brand", label: "브랜드", source: "상품 정보", path: ["product", "brand"] },
    { key: "origin", label: "원산지", source: "상품 정보", path: ["product", "orgnNmVal"] },
    sharedImage(["product", "prdImage01"]),
    { key: "description", label: "상세 설명", source: "상품 정보", path: ["product", "htmlDetail"] },
    { key: "price", label: "판매가", source: "상품 정보", test: positive(["product", "selPrc"]) },
    { key: "stock", label: "재고", source: "상품 정보", test: positive(["product", "prdSelQty"]) },
    { key: "sale-period", label: "판매 시작·종료일", source: "상품 정보", test: (draft) => meaningful(valueAt(draft, ["product", "aplBgnDy"])) && meaningful(valueAt(draft, ["product", "aplEndDy"])) },
    { key: "notice", label: "상품정보제공고시", source: "카테고리", path: ["product", "ProductNotification", "type"] },
    ...elevenstProcessedFoodRequirements,
    { key: "certification", label: "인증·허가 정보", source: "카테고리", path: ["product", "ProductCertGroup"], help: "카테고리에 맞는 인증 대상 여부와 인증 정보를 확인해 주세요." },
    { key: "shipping", label: "배송·반품 설정", source: "판매자 계정", test: (draft) => meaningful(valueAt(draft, ["product", "dlvWyCd"])) && meaningful(valueAt(draft, ["product", "dlvCstInstBasiCd"])) && meaningful(valueAt(draft, ["product", "rtngExchDetail"])) },
  ],
  smartstore: [
    ...smartstoreCapacityRequirements,
    { key: "category", label: "스마트스토어 말단 카테고리", source: "카테고리", path: ["body", "originProduct", "leafCategoryId"] },
    { key: "title", label: "상품명", source: "상품 정보", path: ["body", "originProduct", "name"] },
    { key: "description", label: "상세 설명", source: "상품 정보", path: ["body", "originProduct", "detailContent"] },
    sharedImage(["imageUrls"]),
    { key: "price", label: "판매가", source: "상품 정보", test: positive(["body", "originProduct", "salePrice"]) },
    { key: "stock", label: "재고", source: "상품 정보", test: positive(["body", "originProduct", "stockQuantity"]) },
    { key: "origin", label: "원산지", source: "상품 정보", path: ["body", "originProduct", "detailAttribute", "originAreaInfo", "content"] },
    { key: "minor-purchasable", label: "미성년자 구매 가능 여부", source: "상품 정보", test: (draft) => typeof valueAt(draft, ["body", "originProduct", "detailAttribute", "minorPurchasable"]) === "boolean", help: "일반 상품은 true, 성인 카테고리 상품은 false가 필요합니다." },
    { key: "provided-notice", label: "상품정보제공고시", source: "상품 정보", path: ["body", "originProduct", "detailAttribute", "productInfoProvidedNotice", "productInfoProvidedNoticeType"], help: "상품군 유형과 필수 고시 항목을 채널 payload에 포함합니다." },
    { key: "display-status", label: "스마트스토어 전시 상태", source: "상품 정보", test: (draft) => ["ON", "SUSPENSION"].includes(String(valueAt(draft, ["body", "smartstoreChannelProduct", "channelProductDisplayStatusType"]))), help: "상품 등록에는 ON 또는 SUSPENSION만 허용됩니다." },
    { key: "phone", label: "스토어 A/S 전화번호", source: "판매자 계정", runtime: true, help: "Vault의 실제 스마트스토어 A/S 번호를 등록 직전에 적용합니다." },
    { key: "uploaded-image", label: "네이버 이미지 업로드", source: "판매자 계정", runtime: true, help: "원본 이미지를 Commerce API로 업로드한 URL로 교체합니다." },
  ],
  temu: [
    {
      key: "category",
      label: "Temu 말단 카테고리 ID",
      source: "카테고리",
      test: (draft) => /^[1-9]\d*$/u.test(String(valueAt(draft, ["body", "goodsBasic", "extCatName"]) ?? "").trim()),
      help: "Temu V3가 추천 카테고리로 대체하지 않도록 확정된 말단 카테고리 ID를 전송합니다.",
    },
    {
      key: "shipping-template",
      label: "Temu 배송 템플릿 ID 또는 이름",
      source: "판매자 계정",
      path: ["body", "goodsBasic", "costTemplate"],
      manualPath: ["body", "goodsBasic", "costTemplate"],
      placeholder: "Temu Seller Centre의 배송 템플릿 ID 또는 정확한 이름",
      help: "비워 두면 스토어 기본 템플릿이 자동 적용되므로 exact QA 등록에서는 명시적으로 확인해야 합니다.",
    },
    { key: "title", label: "상품명", source: "상품 정보", path: ["body", "goodsBasic", "goodsName"] },
    { key: "description", label: "상품 설명", source: "상품 정보", path: ["body", "goodsBasic", "goodsDesc"] },
    { key: "external-id", label: "외부 상품·SKU ID", source: "상품 정보", path: ["body", "goodsBasic", "externalGoodsId"] },
    sharedImage(["body", "goodsBasic", "goodsCarouselImage"]),
    { key: "brand", label: "브랜드", source: "상품 정보", test: (draft) => itemHasAttribute(draft, "Brand") },
    { key: "manufacturer", label: "제조사", source: "상품 정보", test: (draft) => itemHasAttribute(draft, "Manufacturer") },
    { key: "origin", label: "원산지", source: "상품 정보", test: (draft) => itemHasAttribute(draft, "Country of origin") },
    { key: "material", label: "재질·성분", source: "상품 정보", test: (draft) => itemHasAttribute(draft, "Material") },
    { key: "price", label: "판매가·통화", source: "상품 정보", test: (draft) => meaningful(valueAt(draft, ["body", "skuList", 0, "price", "basePrice", "currency"])) && Number(valueAt(draft, ["body", "skuList", 0, "price", "basePrice", "amount"])) > 0 },
    { key: "stock", label: "재고", source: "상품 정보", test: positive(["body", "skuList", 0, "quantity"]) },
    { key: "package", label: "포장 중량·규격", source: "상품 정보", test: (draft) => positiveFields(draft, [["body", "skuList", 0, "packageInfo", "weight"], ["body", "skuList", 0, "packageInfo", "length"], ["body", "skuList", 0, "packageInfo", "width"], ["body", "skuList", 0, "packageInfo", "height"]]) },
  ],
  ebay: [
    { key: "category", label: "eBay 말단 카테고리", source: "카테고리", path: ["offer", "categoryId"] },
    { key: "title", label: "상품명", source: "상품 정보", path: ["inventoryItem", "product", "title"] },
    { key: "description", label: "상품 설명", source: "상품 정보", path: ["inventoryItem", "product", "description"] },
    sharedImage(["inventoryItem", "product", "imageUrls"]),
    { key: "price", label: "판매가", source: "상품 정보", test: positive(["offer", "pricingSummary", "price", "value"]) },
    { key: "stock", label: "재고", source: "상품 정보", test: positive(["offer", "availableQuantity"]) },
    { key: "fulfillment-policy", label: "배송 정책 ID", source: "판매자 계정", path: ["offer", "listingPolicies", "fulfillmentPolicyId"], manualPath: ["offer", "listingPolicies", "fulfillmentPolicyId"], placeholder: "Seller Hub fulfillmentPolicyId", help: "Seller Hub에서 이 상품에 적용할 배송 정책을 확인해 직접 입력해 주세요." },
    { key: "payment-policy", label: "결제 정책 ID", source: "판매자 계정", path: ["offer", "listingPolicies", "paymentPolicyId"], manualPath: ["offer", "listingPolicies", "paymentPolicyId"], placeholder: "Seller Hub paymentPolicyId", help: "Seller Hub에서 이 상품에 적용할 결제 정책을 확인해 직접 입력해 주세요." },
    { key: "return-policy", label: "반품 정책 ID", source: "판매자 계정", path: ["offer", "listingPolicies", "returnPolicyId"], manualPath: ["offer", "listingPolicies", "returnPolicyId"], placeholder: "Seller Hub returnPolicyId", help: "Seller Hub에서 이 상품에 적용할 반품 정책을 확인해 직접 입력해 주세요." },
    { key: "location", label: "재고 위치 키", source: "판매자 계정", path: ["offer", "merchantLocationKey"], manualPath: ["offer", "merchantLocationKey"], placeholder: "Seller Hub merchantLocationKey", help: "Seller Hub에 미리 등록한 실제 Inventory Location 키를 직접 입력해 주세요." },
  ],
};

export function inspectListingDraft(
  channel: ActiveChannelKey,
  draft: Record<string, unknown>,
  operation: "listing.create" | "listing.update" = "listing.create",
) {
  const operationSpecs = channel === "ebay" && operation === "listing.update"
    ? specs[channel].filter((spec) => ["title", "description", "images"].includes(spec.key))
    : channel === "smartstore" && operation === "listing.update"
      ? specs[channel].filter((spec) => [
        "category",
        "title",
        "description",
        "images",
        "origin",
        "uploaded-image",
      ].includes(spec.key))
      : specs[channel];
  return operationSpecs
    .filter((spec) => !spec.applies || spec.applies(draft))
    .map<ListingRequirement>((spec) => ({
    key: spec.key,
    label: spec.label,
    source: spec.source,
    status: spec.runtime && (!spec.path || valueAt(draft, spec.path) === "SERVER_MANAGED")
      ? "runtime"
      : (spec.test ? spec.test(draft) : meaningful(valueAt(draft, spec.path ?? []))) ? "ready" : "manual",
    manualPath: spec.manualPath,
    inputType: spec.inputType,
    placeholder: spec.placeholder,
    help: spec.help,
  }));
}

export function setListingDraftValue(draft: Record<string, unknown>, path: string[], value: string) {
  const invalid = () => { throw new Error("LISTING_DRAFT_PATH_INVALID"); };
  const isRecord = (input: unknown): input is Record<string, unknown> => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return false;
    const prototype = Object.getPrototypeOf(input);
    return prototype === Object.prototype || prototype === null;
  };
  const isIndex = (part: string) => /^(0|[1-9]\d*)$/.test(part)
    && Number.isSafeInteger(Number(part)) && Number(part) < 0xffff_ffff;
  if (!isRecord(draft) || !Array.isArray(path) || !path.length) return invalid();
  if (typeof value !== "string") throw new Error("LISTING_DRAFT_VALUE_INVALID");
  // Validate the entire path before cloning or assigning. Never traverse an
  // inherited property, prototype key, blank token or noncanonical index.
  for (const part of path) {
    if (typeof part !== "string" || !part.trim() || part !== part.trim()
        || ["__proto__", "prototype", "constructor"].includes(part)
        || (!Number.isNaN(Number(part)) && !isIndex(part))) return invalid();
  }
  const clone = structuredClone(draft);
  let current: Record<string, unknown> | unknown[] = clone;
  for (let index = 0; index < path.length; index += 1) {
    const part = path[index];
    if (Array.isArray(current)) {
      // Only existing indices or one contiguous append are supported. No sparse
      // growth, array length mutation, or arbitrary named array properties.
      if (!isIndex(part) || Number(part) > current.length
          || (Number(part) < current.length && !Object.hasOwn(current, part))) return invalid();
    } else if (!isRecord(current) || isIndex(part)) {
      // A numeric-keyed object is not an array; do not silently repair/drop it.
      return invalid();
    }
    const container = current as Record<string, unknown>;
    if (index === path.length - 1) {
      container[part] = value;
      return clone;
    }
    const nextMustBeArray = isIndex(path[index + 1]);
    const next = Object.hasOwn(container, part) ? container[part] : undefined;
    if (next === undefined || next === null) {
      container[part] = nextMustBeArray ? [] : {};
    } else if (nextMustBeArray ? !Array.isArray(next) : !isRecord(next)) {
      // Refuse to erase a primitive, array or non-JSON container on descent.
      return invalid();
    }
    current = container[part] as Record<string, unknown> | unknown[];
  }
  return invalid();
}

export function listingDraftValue(draft: Record<string, unknown>, path: string[]) {
  const value = valueAt(draft, path);
  return value === null || value === undefined || value === "SERVER_MANAGED" ? "" : String(value);
}

export function blockingListingRequirements(
  channel: ActiveChannelKey,
  draft: Record<string, unknown>,
  operation: "listing.create" | "listing.update" = "listing.create",
) {
  return inspectListingDraft(channel, draft, operation).filter((item) => item.status === "manual");
}
