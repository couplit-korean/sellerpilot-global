export function elevenstSaleDateRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const year = Number(value("year"));
  const month = Number(value("month"));
  const day = Number(value("day"));
  const pad = (number: number) => String(number).padStart(2, "0");
  const startDate = `${year}/${pad(month)}/${pad(day)}`;
  // 11st's 3y:110 period is inclusive, so its required end is start + 3 years - 1 day.
  const end = new Date(Date.UTC(year + 3, month - 1, day - 1));
  const endDate = `${end.getUTCFullYear()}/${pad(end.getUTCMonth() + 1)}/${pad(end.getUTCDate())}`;

  return {
    aplBgnDy: startDate,
    aplEndDy: endDate,
  };
}

const supportedProductFields = new Set([
  "selMthdCd",
  "dispCtgrNo",
  "prdTypCd",
  "prdNm",
  "brand",
  "rmaterialTypCd",
  "orgnTypCd",
  "orgnNmVal",
  "sellerPrdCd",
  "suplDtyfrPrdClfCd",
  "forAbrdBuyClf",
  "prdStatCd",
  "minorSelCnYn",
  "prdImage01",
  "prdImage02",
  "prdImage03",
  "prdImage04",
  "htmlDetail",
  "ProductCertGroup",
  "selPrdClfCd",
  "aplBgnDy",
  "aplEndDy",
  "selPrc",
  "prdSelQty",
  "dlvCnAreaCd",
  "dlvWyCd",
  "dlvCstInstBasiCd",
  "bndlDlvCnYn",
  "dlvCstPayTypCd",
  "rtngdDlvCst",
  "exchDlvCst",
  "asDetail",
  "rtngExchDetail",
  "ProductNotification",
]);

const generalProductNoticeCodes = new Set(["11800", "11905", "23760413", "23759100", "23756033"]);
const supportedCertificationGroups = new Set(["01:03", "02:03", "03:03", "04:05"]);
const verifiedSimpleListingCategoryId = "1341821";
export const elevenstProcessedFoodCategoryId = "1346631";
export const elevenstProcessedFoodNoticeType = "891031";
export const elevenstProcessedFoodProductNameNoticeCode = "176317774";
export const elevenstProcessedFoodNotificationFields = [
  { code: "176400445", label: "생산자 및 소재지 (수입품의 경우 생산자, 수입자 및 제조국)" },
  { code: "176398001", label: "제조연월일, 소비기한 또는 품질유지기한" },
  { code: "42154823", label: "수입식품 해당 시 수입신고 문구" },
  { code: "23757260", label: "유전자변형식품 표시" },
  { code: "23757095", label: "영양성분" },
  { code: "176312674", label: "소비자안전을 위한 주의사항" },
  { code: elevenstProcessedFoodProductNameNoticeCode, label: "제품명" },
  { code: "23756754", label: "소비자상담 관련 전화번호" },
  { code: "23757245", label: "원재료명 (원산지 포함) 및 함량" },
  { code: "42155152", label: "포장단위별 내용물의 용량(중량), 수량" },
  { code: "23757000", label: "식품의 유형" },
] as const;
const processedFoodNoticeCodes = new Set(elevenstProcessedFoodNotificationFields.map((field) => field.code));
const placeholderValue = /^(?:알\s*수\s*없음|모름|미정|미기재|미확인|확인\s*필요|판매자\s*확인\s*필요|tbd|unknown|not\s*provided|n\/?a|none|null|undefined|-+)$/iu;

export const elevenstListingUpdateFields = [
  "prdNm",
  "brand",
  "orgnNmVal",
  "prdStatCd",
  "prdImage01",
  "prdImage02",
  "prdImage03",
  "prdImage04",
  "htmlDetail",
  "asDetail",
  "rtngExchDetail",
  "ProductNotification",
] as const;

const elevenstListingUpdateFieldSet = new Set<string>(elevenstListingUpdateFields);

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`ELEVENST_CONTRACT_OBJECT_REQUIRED:${field}`);
  }
  return value as Record<string, unknown>;
}

function text(product: Record<string, unknown>, field: string, max: number) {
  const value = product[field];
  if (typeof value !== "string") throw new Error(`ELEVENST_CONTRACT_FIELD_REQUIRED:${field}`);
  const normalized = value.trim();
  const containsControlCharacter = [...normalized].some((character) => {
    const code = character.charCodeAt(0);
    return (code <= 31 && ![9, 10, 13].includes(code)) || code === 127;
  });
  if (!normalized || normalized.length > max || containsControlCharacter) {
    throw new Error(`ELEVENST_CONTRACT_FIELD_INVALID:${field}`);
  }
  return normalized;
}

function knownText(product: Record<string, unknown>, field: string, max: number) {
  const value = text(product, field, max);
  if (placeholderValue.test(value)) throw new Error(`ELEVENST_CONTRACT_PLACEHOLDER_REJECTED:${field}`);
  return value;
}

function exactCode(product: Record<string, unknown>, field: string, allowed: readonly string[]) {
  const value = text(product, field, 20);
  if (!allowed.includes(value)) throw new Error(`ELEVENST_CONTRACT_CODE_UNVERIFIED:${field}`);
  return value;
}

function integerText(product: Record<string, unknown>, field: string, input: { min: number; max: number; multipleOf?: number }) {
  const value = text(product, field, 30);
  if (!/^\d+$/u.test(value)) throw new Error(`ELEVENST_CONTRACT_FIELD_INVALID:${field}`);
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < input.min || numeric > input.max || (input.multipleOf && numeric % input.multipleOf !== 0)) {
    throw new Error(`ELEVENST_CONTRACT_FIELD_INVALID:${field}`);
  }
  return numeric;
}

function dateValue(product: Record<string, unknown>, field: string) {
  const value = text(product, field, 10);
  const match = /^(\d{4})\/(\d{2})\/(\d{2})$/u.exec(value);
  if (!match) throw new Error(`ELEVENST_CONTRACT_FIELD_INVALID:${field}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`ELEVENST_CONTRACT_FIELD_INVALID:${field}`);
  }
  return date;
}

function httpsImage(product: Record<string, unknown>, field: string, required: boolean) {
  const raw = product[field];
  if (!required && (raw === undefined || raw === null || raw === "")) return;
  const value = text(product, field, 2_000);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`ELEVENST_CONTRACT_FIELD_INVALID:${field}`);
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw new Error(`ELEVENST_CONTRACT_FIELD_INVALID:${field}`);
  }
}

function validateCertificationGroups(product: Record<string, unknown>) {
  const groups = product.ProductCertGroup;
  if (!Array.isArray(groups) || groups.length !== supportedCertificationGroups.size) {
    throw new Error("ELEVENST_CERTIFICATION_CONTRACT_UNVERIFIED");
  }
  const seen = new Set<string>();
  for (const rawGroup of groups) {
    const group = object(rawGroup, "ProductCertGroup");
    if (Object.keys(group).some((key) => !["crtfGrpTypCd", "crtfGrpObjClfCd"].includes(key))) {
      throw new Error("ELEVENST_CERTIFICATION_CONTRACT_UNVERIFIED");
    }
    const key = `${text(group, "crtfGrpTypCd", 2)}:${text(group, "crtfGrpObjClfCd", 2)}`;
    if (!supportedCertificationGroups.has(key) || seen.has(key)) {
      throw new Error("ELEVENST_CERTIFICATION_CONTRACT_UNVERIFIED");
    }
    seen.add(key);
  }
}

function validateProductNotification(product: Record<string, unknown>, categoryId: string) {
  const notification = object(product.ProductNotification, "ProductNotification");
  if (Object.keys(notification).some((key) => !["type", "item"].includes(key))) {
    throw new Error("ELEVENST_NOTICE_CONTRACT_UNVERIFIED");
  }
  const processedFood = categoryId === elevenstProcessedFoodCategoryId;
  const expectedType = processedFood ? elevenstProcessedFoodNoticeType : "891045";
  const supportedNoticeCodes = processedFood ? processedFoodNoticeCodes : generalProductNoticeCodes;
  if (text(notification, "type", 20) !== expectedType) throw new Error("ELEVENST_NOTICE_CONTRACT_UNVERIFIED");
  const items = notification.item;
  if (!Array.isArray(items) || items.length !== supportedNoticeCodes.size) {
    throw new Error("ELEVENST_NOTICE_CONTRACT_UNVERIFIED");
  }
  const seen = new Set<string>();
  for (const rawItem of items) {
    const item = object(rawItem, "ProductNotification.item");
    if (Object.keys(item).some((key) => !["code", "name"].includes(key))) {
      throw new Error("ELEVENST_NOTICE_CONTRACT_UNVERIFIED");
    }
    const code = text(item, "code", 20);
    knownText(item, "name", 1_000);
    if (!supportedNoticeCodes.has(code) || seen.has(code)) throw new Error("ELEVENST_NOTICE_CONTRACT_UNVERIFIED");
    seen.add(code);
  }
}

/**
 * Validate the exact contracts verified from 11st metadata: the simple
 * non-regulated general-product leaf 1341821 and processed-food leaf 1346631.
 * Other category-specific options, certifications, notices, and delivery modes
 * remain blocked until their exact provider metadata is supplied.
 */
export function validateElevenstListingProduct(value: unknown, shippingSource?: unknown): Record<string, unknown> {
  if (shippingSource !== undefined) assertElevenstListingShippingSource(shippingSource);
  const product = object(value, "product");
  const unknownField = Object.keys(product).find((field) => !supportedProductFields.has(field));
  if (unknownField) throw new Error(`ELEVENST_PRODUCT_FIELD_UNVERIFIED:${unknownField}`);

  exactCode(product, "selMthdCd", ["01"]);
  const categoryId = text(product, "dispCtgrNo", 20);
  if (!/^\d{7,12}$/u.test(categoryId)) throw new Error("ELEVENST_CONTRACT_FIELD_INVALID:dispCtgrNo");
  if (![verifiedSimpleListingCategoryId, elevenstProcessedFoodCategoryId].includes(categoryId)) {
    throw new Error("ELEVENST_CATEGORY_CONTRACT_UNVERIFIED");
  }
  exactCode(product, "prdTypCd", ["01"]);
  knownText(product, "prdNm", 100);
  knownText(product, "brand", 100);
  exactCode(product, "rmaterialTypCd", ["04"]);
  exactCode(product, "orgnTypCd", ["03"]);
  knownText(product, "orgnNmVal", 200);
  knownText(product, "sellerPrdCd", 50);
  exactCode(product, "suplDtyfrPrdClfCd", ["01"]);
  exactCode(product, "forAbrdBuyClf", ["01"]);
  exactCode(product, "prdStatCd", ["01", "02"]);
  exactCode(product, "minorSelCnYn", ["Y"]);

  httpsImage(product, "prdImage01", true);
  httpsImage(product, "prdImage02", false);
  httpsImage(product, "prdImage03", false);
  httpsImage(product, "prdImage04", false);
  knownText(product, "htmlDetail", 1_000_000);
  validateCertificationGroups(product);

  exactCode(product, "selPrdClfCd", ["3y:110"]);
  const start = dateValue(product, "aplBgnDy");
  const end = dateValue(product, "aplEndDy");
  const expectedEnd = new Date(Date.UTC(start.getUTCFullYear() + 3, start.getUTCMonth(), start.getUTCDate() - 1));
  if (end.getTime() !== expectedEnd.getTime()) throw new Error("ELEVENST_CONTRACT_SALE_PERIOD_INVALID");
  integerText(product, "selPrc", { min: 10, max: 999_999_990, multipleOf: 10 });
  integerText(product, "prdSelQty", { min: 1, max: 999_999 });

  exactCode(product, "dlvCnAreaCd", ["01"]);
  exactCode(product, "dlvWyCd", ["01"]);
  exactCode(product, "dlvCstInstBasiCd", ["01"]);
  exactCode(product, "bndlDlvCnYn", ["Y"]);
  exactCode(product, "dlvCstPayTypCd", ["03"]);
  integerText(product, "rtngdDlvCst", { min: 0, max: 9_999_990 });
  integerText(product, "exchDlvCst", { min: 0, max: 9_999_990 });
  knownText(product, "asDetail", 1_000);
  knownText(product, "rtngExchDetail", 1_000);
  validateProductNotification(product, categoryId);

  return product;
}

/**
 * Source facts are internal metadata, never new 11st XML fields. Only the
 * existing zero-fee contract is verified. Do not erase a paid/unknown fee to
 * make that contract pass, or infer a paid contract from the provider codes.
 */
export function assertElevenstListingShippingSource(value: unknown): void {
  const source = object(value, "sellerpilotAssets.shipping");
  const raw = source.shippingFeeKrw;
  const fee = (typeof raw === "number" || typeof raw === "string")
    && String(raw).trim() !== "" ? Number(raw) : NaN;
  if (!Number.isSafeInteger(fee) || fee < 0) {
    throw new Error("ELEVENST_SHIPPING_SOURCE_FEE_REQUIRED");
  }
  if (fee !== 0) {
    throw new Error(`ELEVENST_PAID_SHIPPING_CONTRACT_UNVERIFIED:SHIPPING_FEE_KRW:${fee}`);
  }
}

export function elevenstShippingContractErrorMessage(code: string): string | undefined {
  if (code === "ELEVENST_SHIPPING_SOURCE_FEE_REQUIRED") {
    return "입력 배송비 KRW를 확인하세요. 미입력·잘못된 배송비를 무료배송으로 처리하지 않습니다.";
  }
  const paid = /^ELEVENST_PAID_SHIPPING_CONTRACT_UNVERIFIED:SHIPPING_FEE_KRW:(\d{1,16})$/u.exec(code);
  if (paid) {
    return `입력 배송비 ${paid[1]} KRW는 현재 검증된 무료배송 계약과 일치하지 않습니다. 입력값을 보존하고 공식 유료배송 필드·권한 확인 전 등록·수정을 중단하세요.`;
  }
  return undefined;
}

/** Bind only the server-read product facts, never a browser's claimed fee. */
export function bindElevenstAuthoritativeShippingSource(
  argumentsValue: Record<string, unknown>,
  publishContextValue: unknown,
  expectedProductId: string,
): Record<string, unknown> {
  const context = object(publishContextValue, "publishContext");
  const product = object(context.product, "publishContext.product");
  if (!expectedProductId || product.id !== expectedProductId) {
    throw new Error("ELEVENST_SHIPPING_SOURCE_PRODUCT_MISMATCH");
  }
  const manual = object(context.manualFields, "publishContext.manualFields");
  const source = {
    shippingFeeKrw: manual.shippingFeeKrw,
    shippingRule: manual.shippingRule,
    packagingRule: manual.packagingRule,
  };
  // Validate before returning anything that could be fingerprinted or enqueued.
  assertElevenstListingShippingSource(source);
  const next = structuredClone(argumentsValue);
  const assets = next.sellerpilotAssets && typeof next.sellerpilotAssets === "object" && !Array.isArray(next.sellerpilotAssets)
    ? next.sellerpilotAssets as Record<string, unknown> : {};
  const shipping = assets.shipping && typeof assets.shipping === "object" && !Array.isArray(assets.shipping)
    ? assets.shipping as Record<string, unknown> : {};
  next.sellerpilotAssets = { ...assets, shipping: { ...shipping, ...source } };
  return next;
}

/** Use at both create/update execution boundaries, before any provider read/write. */
export function validateElevenstListingArguments(value: unknown): Record<string, unknown> {
  const args = object(value, "arguments");
  // Legacy immutable requests contain only the native product. Keep their
  // verified contract unchanged; absence is NOT evidence that a fee was zero.
  // Callers with stored source facts must bind those facts before this check.
  if (Object.hasOwn(args, "sellerpilotAssets")) {
    const assets = object(args.sellerpilotAssets, "sellerpilotAssets");
    if (Object.hasOwn(assets, "shipping")) assertElevenstListingShippingSource(assets.shipping);
  }
  return validateElevenstListingProduct(args.product);
}

export function elevenstListingUpdatePatchFromProduct(value: unknown) {
  const product = object(value, "product");
  return Object.fromEntries(elevenstListingUpdateFields.flatMap((field) =>
    Object.hasOwn(product, field) && product[field] !== undefined
      ? [[field, structuredClone(product[field])]]
      : []));
}

export function mergeElevenstListingUpdateProduct(snapshotValue: unknown, patchValue: unknown, shippingSource?: unknown) {
  const snapshot = validateElevenstListingProduct(structuredClone(snapshotValue), shippingSource);
  const patch = object(patchValue, "productPatch");
  const unknownField = Object.keys(patch).find((field) => !elevenstListingUpdateFieldSet.has(field));
  if (unknownField) throw new Error(`ELEVENST_UPDATE_FIELD_UNVERIFIED:${unknownField}`);
  if (!Object.keys(patch).length) throw new Error("ELEVENST_UPDATE_CONTENT_REQUIRED");
  return validateElevenstListingProduct({ ...structuredClone(snapshot), ...structuredClone(patch) });
}

export function elevenstListingUpdateProjection(value: unknown) {
  const product = object(value, "product");
  return Object.fromEntries(elevenstListingUpdateFields.flatMap((field) =>
    Object.hasOwn(product, field) && product[field] !== undefined
      ? [[field, structuredClone(product[field])]]
      : []));
}
