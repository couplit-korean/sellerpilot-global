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

const supportedNoticeCodes = new Set(["11800", "11905", "23760413", "23759100", "23756033"]);
const supportedCertificationGroups = new Set(["01:03", "02:03", "03:03", "04:05"]);
const placeholderValue = /^(?:알\s*수\s*없음|모름|미정|unknown|n\/?a|none|null|undefined|-+)$/iu;

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

function validateProductNotification(product: Record<string, unknown>) {
  const notification = object(product.ProductNotification, "ProductNotification");
  if (Object.keys(notification).some((key) => !["type", "item"].includes(key))) {
    throw new Error("ELEVENST_NOTICE_CONTRACT_UNVERIFIED");
  }
  if (text(notification, "type", 20) !== "891045") throw new Error("ELEVENST_NOTICE_CONTRACT_UNVERIFIED");
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
 * Validate only the 11st simple, non-regulated general-product contract that
 * has an observed successful create/readback path. Category-specific options,
 * certifications, notices, and delivery modes stay blocked until their exact
 * provider metadata is supplied; this function never fills those values in.
 */
export function validateElevenstListingProduct(value: unknown): Record<string, unknown> {
  const product = object(value, "product");
  const unknownField = Object.keys(product).find((field) => !supportedProductFields.has(field));
  if (unknownField) throw new Error(`ELEVENST_PRODUCT_FIELD_UNVERIFIED:${unknownField}`);

  exactCode(product, "selMthdCd", ["01"]);
  const categoryId = text(product, "dispCtgrNo", 20);
  if (!/^\d{7,12}$/u.test(categoryId)) throw new Error("ELEVENST_CONTRACT_FIELD_INVALID:dispCtgrNo");
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
  validateProductNotification(product);

  return product;
}
