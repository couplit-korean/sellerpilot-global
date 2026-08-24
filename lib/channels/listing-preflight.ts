import type { ActiveChannelKey } from "./catalog";

export type ListingRequirementStatus = "ready" | "manual" | "runtime";

export type ListingRequirement = {
  key: string;
  label: string;
  source: "상품 정보" | "카테고리" | "판매자 계정";
  status: ListingRequirementStatus;
  manualPath?: string[];
  placeholder?: string;
  help?: string;
};

type RequirementSpec = Omit<ListingRequirement, "status"> & {
  path?: Array<string | number>;
  test?: (draft: Record<string, unknown>) => boolean;
  runtime?: boolean;
};

const unknownValue = /^(?:seller confirmation required|unknown|not provided|n\/a|미기재|미확인|확인 필요|판매자 확인 필요)$/i;

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

const sharedImage = (path: Array<string | number>): RequirementSpec => ({
  key: "images",
  label: "공개 상품 이미지",
  source: "상품 정보",
  path,
  help: "채널 작업자가 공식 이미지 API 규격으로 다시 업로드합니다.",
});

const specs: Record<ActiveChannelKey, RequirementSpec[]> = {
  qoo10: [
    { key: "category", label: "Qoo10 말단 카테고리", source: "카테고리", path: ["params", "SecondSubCat"] },
    { key: "title", label: "상품명", source: "상품 정보", path: ["params", "ItemTitle"] },
    { key: "origin", label: "원산지", source: "상품 정보", path: ["params", "ProductionPlace"] },
    sharedImage(["params", "StandardImage"]),
    { key: "price", label: "판매가", source: "상품 정보", test: positive(["params", "ItemPrice"]) },
    { key: "stock", label: "재고", source: "상품 정보", test: positive(["params", "ItemQty"]) },
    { key: "shipping", label: "배송비 코드", source: "판매자 계정", test: (draft) => valueAt(draft, ["params", "ShippingNo"]) !== undefined, help: "0은 Qoo10 무료배송 코드로 유효합니다." },
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
    { key: "return", label: "반품지·택배사·반품비", source: "판매자 계정", runtime: true, help: "WING 반품지 API의 실제 주소와 요금을 사용합니다." },
    { key: "notices", label: "카테고리 고시정보", source: "카테고리", runtime: true, help: "쿠팡 카테고리 메타 API에서 필수 고시 항목을 생성합니다." },
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
    { key: "certification", label: "인증·허가 정보", source: "카테고리", path: ["product", "ProductCertGroup"], help: "카테고리에 맞는 인증 대상 여부와 인증 정보를 확인해 주세요." },
    { key: "shipping", label: "배송·반품 설정", source: "판매자 계정", test: (draft) => meaningful(valueAt(draft, ["product", "dlvWyCd"])) && meaningful(valueAt(draft, ["product", "dlvCstInstBasiCd"])) && meaningful(valueAt(draft, ["product", "rtngExchDetail"])) },
  ],
  smartstore: [
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
    { key: "category", label: "Temu 카테고리", source: "카테고리", path: ["body", "goodsBasic", "extCatName"] },
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
    { key: "fulfillment-policy", label: "배송 정책 ID", source: "판매자 계정", runtime: true, path: ["offer", "listingPolicies", "fulfillmentPolicyId"], manualPath: ["offer", "listingPolicies", "fulfillmentPolicyId"], placeholder: "자동조회 실패 시 fulfillmentPolicyId", help: "eBay Account API에서 자동 조회하며 필요하면 Seller Hub 값을 직접 입력할 수 있습니다." },
    { key: "payment-policy", label: "결제 정책 ID", source: "판매자 계정", runtime: true, path: ["offer", "listingPolicies", "paymentPolicyId"], manualPath: ["offer", "listingPolicies", "paymentPolicyId"], placeholder: "자동조회 실패 시 paymentPolicyId" },
    { key: "return-policy", label: "반품 정책 ID", source: "판매자 계정", runtime: true, path: ["offer", "listingPolicies", "returnPolicyId"], manualPath: ["offer", "listingPolicies", "returnPolicyId"], placeholder: "자동조회 실패 시 returnPolicyId" },
    { key: "location", label: "재고 위치 키", source: "판매자 계정", runtime: true, path: ["offer", "merchantLocationKey"], manualPath: ["offer", "merchantLocationKey"], placeholder: "자동조회 실패 시 merchantLocationKey", help: "eBay Inventory API에서 자동 조회하며 필요하면 등록된 위치 키를 직접 입력할 수 있습니다." },
  ],
};

export function inspectListingDraft(channel: ActiveChannelKey, draft: Record<string, unknown>) {
  return specs[channel].map<ListingRequirement>((spec) => ({
    key: spec.key,
    label: spec.label,
    source: spec.source,
    status: spec.runtime && (!spec.path || valueAt(draft, spec.path) === "SERVER_MANAGED")
      ? "runtime"
      : (spec.test ? spec.test(draft) : meaningful(valueAt(draft, spec.path ?? []))) ? "ready" : "manual",
    manualPath: spec.manualPath,
    placeholder: spec.placeholder,
    help: spec.help,
  }));
}

export function setListingDraftValue(draft: Record<string, unknown>, path: string[], value: string) {
  const clone = structuredClone(draft);
  let current: Record<string, unknown> = clone;
  path.forEach((part, index) => {
    if (index === path.length - 1) {
      current[part] = value;
      return;
    }
    const next = current[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  });
  return clone;
}

export function listingDraftValue(draft: Record<string, unknown>, path: string[]) {
  const value = valueAt(draft, path);
  return value === null || value === undefined || value === "SERVER_MANAGED" ? "" : String(value);
}

export function blockingListingRequirements(channel: ActiveChannelKey, draft: Record<string, unknown>) {
  return inspectListingDraft(channel, draft).filter((item) => item.status === "manual");
}
