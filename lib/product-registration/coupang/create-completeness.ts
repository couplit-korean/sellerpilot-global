import {
  hasValidCoupangProductIdentifier,
  hasValidCoupangPurchaseOption,
} from "./create-required-fields";
import { compileCoupangOptionItems } from "./option-items";
import { hasRetiredProductRecovery } from "../../channels/retired-product-recovery";

export const coupangCreateCompletenessContract =
  "sellerpilot_coupang_create_completeness_v1" as const;

export type CoupangCreateCompletenessStatus =
  | "resolved"
  | "manual_required"
  | "provider_read_required"
  | "blocked";

export type CoupangCreateCompletenessSource =
  | "publish_context.confirmed_assignment"
  | "publish_context.product"
  | "seller_confirmed.body"
  | "seller_confirmed.option_rows"
  | "provider.category_metadata"
  | "provider.category_status"
  | "provider.outbound_shipping_places"
  | "provider.return_centers"
  | "approved_detail_manifest"
  | "server.active_credential_revision";

export type CoupangCreateCompletenessKey =
  | "create_lineage"
  | "category"
  | "title"
  | "brand"
  | "options"
  | "external_vendor_sku"
  | "price"
  | "stock"
  | "unit"
  | "attributes"
  | "notices"
  | "certifications"
  | "outbound_shipping_place"
  | "return_center"
  | "carrier"
  | "fees"
  | "representative_image"
  | "approved_detail_images"
  | "credential_revision";

export type CoupangCreateCompletenessField = {
  key: CoupangCreateCompletenessKey;
  label: string;
  status: CoupangCreateCompletenessStatus;
  fieldPaths: string[];
  allowedSources: CoupangCreateCompletenessSource[];
  selectedSource: CoupangCreateCompletenessSource | null;
  message: string;
};

export type CoupangCreateCompletenessInput = {
  /** Full CREATE arguments except that `body` below is authoritative. */
  source: unknown;
  body: unknown;
  publishContext: unknown;
  categoryMetadataRead?: unknown;
  categoryStatusRead?: unknown;
  outboundShippingPlacesRead?: unknown;
  returnCentersRead?: unknown;
  credentialRevision?: unknown;
  officialReadEvidence?: unknown;
  environment?: "sandbox" | "production";
  now?: Date;
};

export type CoupangCreateCompletenessResult = {
  contract: typeof coupangCreateCompletenessContract;
  channel: "coupang";
  operation: "listing.create";
  fields: CoupangCreateCompletenessField[];
  counts: Record<CoupangCreateCompletenessStatus, number>;
  blockingFieldKeys: CoupangCreateCompletenessKey[];
  overallStatus: CoupangCreateCompletenessStatus;
  canBindCreateSourceRevision: boolean;
};

export type CoupangCreateRevisionCandidate = {
  argumentsValue: Record<string, unknown>;
  publishContext: Record<string, unknown>;
  credentialRevision: Record<string, unknown>;
  officialReadEvidence: Record<string, unknown>;
  completeness: CoupangCreateCompletenessResult;
};

type Row = Record<string, unknown>;
type ProviderRead =
  | { state: "missing"; data: null }
  | { state: "failed"; data: null }
  | { state: "success"; data: unknown };

const sha256 = /^[a-f0-9]{64}$/u;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const koreanPlaceholder = /(?:상품\s*상세\s*참조|상세(?:\s*페이지)?\s*참조|확인\s*필요|미확인|미정)/iu;
const exactPlaceholder = /^(?:unknown|not provided|n\/?a|tbd|todo|placeholder|server_managed)$/iu;

function row(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Row
    : null;
}

function rows(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is Row => Boolean(row(candidate)))
    : [];
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function positiveInteger(value: unknown): boolean {
  const parsed = typeof value === "number" ? value : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0;
}

function nonNegativeMoney(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function positiveMoney(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function usable(value: unknown): boolean {
  return value === true || value === 1
    || ["TRUE", "Y", "YES", "1"].includes(text(value).toUpperCase());
}

function containsPlaceholder(value: unknown): boolean {
  return text(value) !== ""
    && (koreanPlaceholder.test(text(value)) || exactPlaceholder.test(text(value)));
}

function providerRead(value: unknown): ProviderRead {
  if (value === undefined || value === null) return { state: "missing", data: null };
  const outer = row(value);
  if (!outer) return { state: "failed", data: null };
  const transportResponse = row(outer.response);
  if (transportResponse && transportResponse.ok !== true) {
    return { state: "failed", data: null };
  }
  if (outer.ok === false || outer.error) return { state: "failed", data: null };
  if (typeof outer.code === "string" && outer.code !== "SUCCESS") {
    return { state: "failed", data: null };
  }
  return { state: "success", data: Object.hasOwn(outer, "data") ? outer.data : outer };
}

function nestedRows(value: unknown): Row[] {
  let current: unknown = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (Array.isArray(current)) return rows(current);
    const currentRow = row(current);
    if (!currentRow) return [];
    if (Array.isArray(currentRow.content)) return rows(currentRow.content);
    if (!Object.hasOwn(currentRow, "data")) return [];
    current = currentRow.data;
  }
  return [];
}

function metadataRow(value: unknown): Row | null {
  let current: unknown = value;
  for (let depth = 0; depth < 4; depth += 1) {
    const currentRow = row(current);
    if (!currentRow) return null;
    if (Array.isArray(currentRow.attributes)
      || Array.isArray(currentRow.noticeCategories)
      || Array.isArray(currentRow.certifications)) return currentRow;
    if (!Object.hasOwn(currentRow, "data")) return null;
    current = currentRow.data;
  }
  return null;
}

function categoryStatus(value: unknown): boolean | null {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current === "boolean") return current;
    const currentRow = row(current);
    if (!currentRow || !Object.hasOwn(currentRow, "data")) return null;
    current = currentRow.data;
  }
  return null;
}

function field(
  key: CoupangCreateCompletenessKey,
  label: string,
  status: CoupangCreateCompletenessStatus,
  fieldPaths: string[],
  allowedSources: CoupangCreateCompletenessSource[],
  selectedSource: CoupangCreateCompletenessSource | null,
  message: string,
): CoupangCreateCompletenessField {
  return { key, label, status, fieldPaths, allowedSources, selectedSource, message };
}

function readDependentField(input: {
  key: CoupangCreateCompletenessKey;
  label: string;
  read: ProviderRead;
  paths: string[];
  sources: CoupangCreateCompletenessSource[];
  selectedSource?: CoupangCreateCompletenessSource;
  complete: boolean;
  invalid?: boolean;
  missingMessage: string;
  invalidMessage: string;
}): CoupangCreateCompletenessField {
  if (input.read.state === "missing") {
    return field(input.key, input.label, "provider_read_required", input.paths,
      input.sources, null, "쿠팡의 현재 공식 값을 먼저 조회해 주세요.");
  }
  if (input.read.state === "failed" || input.invalid) {
    return field(input.key, input.label, "blocked", input.paths,
      input.sources, null, input.invalidMessage);
  }
  if (!input.complete) {
    return field(input.key, input.label, "manual_required", input.paths,
      input.sources, null, input.missingMessage);
  }
  return field(input.key, input.label, "resolved", input.paths,
    input.sources, input.selectedSource ?? input.sources.at(-1) ?? null, "현재 값이 확인됐습니다.");
}

function confirmedCoupangAssignment(context: Row | null): Row | null {
  return rows(context?.assignments).find((candidate) =>
    text(candidate.channel).toLowerCase() === "coupang"
    && text(candidate.status).toLowerCase() === "confirmed"
    && (!text(candidate.market) || text(candidate.market).toUpperCase() === "KR")) ?? null;
}

function mandatory(value: unknown): boolean {
  return text(value).toUpperCase() === "MANDATORY";
}

function preferredKoreanAddress(value: unknown): Row | null {
  const addresses = rows(value);
  const korean = addresses.filter((address) => text(address.countryCode).toUpperCase() === "KR");
  return korean.find((address) => text(address.addressType).toUpperCase().includes("ROADNAME"))
    ?? korean.find((address) => text(address.addressType).toUpperCase() === "JIBUN")
    ?? korean[0]
    ?? null;
}

function noticeEnvelopeAligned(source: Row | null, items: Row[]): boolean {
  const raw = row(source?.facts)?.noticeContent;
  if (raw === undefined || raw === null
    || ((typeof raw === "string" || typeof raw === "number") && text(raw) === "")) return true;
  const envelope = row(raw) ?? parsedConfirmation(raw);
  const categoryName = text(envelope?.noticeCategoryName);
  const details = row(envelope?.details);
  if (!categoryName || !details || !Object.keys(details).length) return false;
  return items.every((item) => {
    const notices = rows(item.notices);
    return Object.entries(details).every(([detailName, content]) => notices.some((notice) =>
      text(notice.noticeCategoryName) === categoryName
      && text(notice.noticeCategoryDetailName) === detailName
      && text(notice.content) === text(content)));
  });
}

function selectedReturnCenter(returnCenters: Row[], body: Row | null): Row | null {
  const requested = text(body?.returnCenterCode);
  if (!requested) return null;
  return returnCenters.find((candidate) =>
    usable(candidate.usable)
    && preferredKoreanAddress(candidate.placeAddresses)
    && text(candidate.returnCenterCode) === requested) ?? null;
}

function returnFee(center: Row | null): number | null {
  if (!center) return null;
  const amounts = new Set<number>();
  for (const key of [
    "returnFee02kg", "returnFee05kg", "returnFee10kg", "returnFee20kg",
    "vendorCreditFee02kg", "vendorCreditFee05kg",
    "vendorCashFee02kg", "vendorCashFee05kg",
  ] as const) {
    const amount = Number(center[key]);
    if (Number.isFinite(amount) && amount > 0) amounts.add(amount);
  }
  return amounts.size === 1 ? [...amounts][0]! : null;
}

function ambiguousReturnFee(center: Row | null): boolean {
  if (!center) return false;
  const amounts = new Set<number>();
  for (const key of [
    "returnFee02kg", "returnFee05kg", "returnFee10kg", "returnFee20kg",
    "vendorCreditFee02kg", "vendorCreditFee05kg",
    "vendorCashFee02kg", "vendorCashFee05kg",
  ] as const) {
    const amount = Number(center[key]);
    if (Number.isFinite(amount) && amount > 0) amounts.add(amount);
  }
  return amounts.size > 1;
}

function validShippingFeeContract(
  source: Row | null,
  body: Row | null,
  providerReturnFee: number | null,
): boolean {
  const type = text(body?.deliveryChargeType);
  const deliveryFee = body?.deliveryCharge;
  const threshold = body?.freeShipOverAmount;
  const returnCharge = body?.returnCharge;
  const shippingFee = row(row(source?.sellerpilotAssets)?.shipping)?.shippingFeeKrw;
  if (!["FREE", "NOT_FREE", "CONDITIONAL_FREE"].includes(type)
    || !nonNegativeMoney(deliveryFee)
    || !nonNegativeMoney(shippingFee)
    || Number(shippingFee) !== Number(deliveryFee)
    || !positiveMoney(returnCharge)) return false;
  if (type === "FREE" && Number(deliveryFee) !== 0) return false;
  if (type !== "FREE" && Number(deliveryFee) <= 0) return false;
  if (type === "CONDITIONAL_FREE"
    && (!positiveMoney(threshold) || Number(threshold) < 100 || Number(threshold) % 100 !== 0)) return false;
  if (providerReturnFee !== null && Number(returnCharge) !== providerReturnFee) return false;
  const chargedOnReturn = body?.deliveryChargeOnReturn;
  return nonNegativeMoney(chargedOnReturn);
}

function optionSnapshot(value: unknown) {
  return rows(value).map((item) => ({
    itemName: text(item.itemName),
    externalVendorSku: text(item.externalVendorSku),
    barcode: text(item.barcode),
    emptyBarcode: item.emptyBarcode === true,
    emptyBarcodeReason: text(item.emptyBarcodeReason),
    modelNo: text(item.modelNo),
    salePrice: item.salePrice,
    originalPrice: item.originalPrice,
    maximumBuyCount: item.maximumBuyCount,
    maximumBuyForPerson: item.maximumBuyForPerson,
    unitCount: item.unitCount,
    purchaseOptions: rows(item.attributes).filter((attribute) =>
      text(attribute.exposed).toUpperCase() !== "NONE").map((attribute) => ({
        name: text(attribute.attributeTypeName),
        value: text(attribute.attributeValueName),
      })),
  }));
}

function optionSourceAligned(source: Row | null, body: Row | null, baseSellerSku: string): boolean {
  const optionRows = row(source?.facts)?.coupangOptionRows;
  if (!Array.isArray(optionRows) || optionRows.length === 0) return true;
  try {
    const compiled = compileCoupangOptionItems(body ?? {}, optionRows, baseSellerSku);
    return JSON.stringify(optionSnapshot(compiled.items)) === JSON.stringify(optionSnapshot(body?.items));
  } catch {
    return false;
  }
}

function contradictoryShippingFeeContract(body: Row | null, providerReturnFee: number | null): boolean {
  const type = text(body?.deliveryChargeType);
  const deliveryFee = body?.deliveryCharge;
  const threshold = body?.freeShipOverAmount;
  if (type && !["FREE", "NOT_FREE", "CONDITIONAL_FREE"].includes(type)) return true;
  if (type === "FREE" && typeof deliveryFee === "number" && deliveryFee !== 0) return true;
  if (["NOT_FREE", "CONDITIONAL_FREE"].includes(type)
    && typeof deliveryFee === "number" && deliveryFee <= 0) return true;
  if (type === "CONDITIONAL_FREE" && typeof threshold === "number" && threshold <= 0) return true;
  return Boolean(providerReturnFee !== null && positiveMoney(body?.returnCharge)
    && Number(body?.returnCharge) !== providerReturnFee);
}

function parsedConfirmation(value: unknown): Row | null {
  if (row(value)) return row(value);
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return row(JSON.parse(value));
  } catch {
    return null;
  }
}

function validLeadTimeContract(source: Row | null, items: Row[]): boolean {
  const shipping = row(row(source?.sellerpilotAssets)?.shipping);
  const shippingRule = text(shipping?.shippingRule);
  const confirmation = parsedConfirmation(shipping?.coupangLeadTimeConfirmation);
  if (!shippingRule || !confirmation
    || confirmation.source !== "coupang-wing"
    || text(confirmation.shippingRule) !== shippingRule
    || confirmation.orderDateAndCalendarConfirmed !== true
    || confirmation.approvedPromiseMatched !== true
    || confirmation.sameDayShipping !== false
    || !positiveInteger(confirmation.outboundShippingTimeDay)) return false;
  return items.length > 0 && items.every((item) =>
    item.outboundShippingTimeDay === confirmation.outboundShippingTimeDay);
}

function itemValues(items: Row[], key: string) {
  return items.map((item) => item[key]);
}

function allNonPlaceholderText(values: unknown[]) {
  return values.length > 0 && values.every((value) => text(value) && !containsPlaceholder(value));
}

function metadataDependentFields(
  metadataReadValue: ProviderRead,
  items: Row[],
  source: Row | null,
): Pick<Record<CoupangCreateCompletenessKey, CoupangCreateCompletenessField>,
  "options" | "attributes" | "notices" | "certifications"> {
  const sources: CoupangCreateCompletenessSource[] = [
    "provider.category_metadata", "seller_confirmed.body",
  ];
  if (metadataReadValue.state === "missing") {
    const unresolved = (key: CoupangCreateCompletenessKey, label: string, paths: string[]) =>
      field(key, label, "provider_read_required", paths, sources, null,
        "카테고리 메타데이터를 먼저 조회해 주세요.");
    return {
      options: unresolved("options", "구매 옵션", ["body.items[*].attributes"]),
      attributes: unresolved("attributes", "카테고리 속성", ["body.items[*].attributes"]),
      notices: unresolved("notices", "상품 고시", ["body.items[*].notices"]),
      certifications: unresolved("certifications", "인증정보", ["body.items[*].certifications"]),
    };
  }
  const metadata = metadataReadValue.state === "success"
    ? metadataRow(metadataReadValue.data)
    : null;
  if (!metadata) {
    const blocked = (key: CoupangCreateCompletenessKey, label: string, paths: string[]) =>
      field(key, label, "blocked", paths, sources, null,
        "쿠팡 카테고리 메타데이터 응답이 실패했거나 해석할 수 없습니다.");
    return {
      options: blocked("options", "구매 옵션", ["body.items[*].attributes"]),
      attributes: blocked("attributes", "카테고리 속성", ["body.items[*].attributes"]),
      notices: blocked("notices", "상품 고시", ["body.items[*].notices"]),
      certifications: blocked("certifications", "인증정보", ["body.items[*].certifications"]),
    };
  }
  const metadataAttributes = rows(metadata.attributes);
  const mandatorySingles = metadataAttributes
    .filter((candidate) => mandatory(candidate.required)
      && ["", "NONE"].includes(text(candidate.groupNumber || "NONE").toUpperCase())
      && text(candidate.exposed).toUpperCase() === "EXPOSED")
    .map((candidate) => text(candidate.attributeTypeName))
    .filter(Boolean);
  const mandatoryGroups = new Map<string, string[]>();
  for (const candidate of metadataAttributes.filter((attribute) => mandatory(attribute.required)
    && !["", "NONE"].includes(text(attribute.groupNumber).toUpperCase())
    && text(attribute.exposed).toUpperCase() === "EXPOSED")) {
    const group = text(candidate.groupNumber);
    const name = text(candidate.attributeTypeName);
    if (group && name) mandatoryGroups.set(group, [...(mandatoryGroups.get(group) ?? []), name]);
  }
  const itemAttributes = items.map((item) => rows(item.attributes));
  const attributesInvalid = itemAttributes.some((attributes) => attributes.some((attribute) =>
    !text(attribute.attributeTypeName) || !text(attribute.attributeValueName)
    || containsPlaceholder(attribute.attributeValueName)));
  const requiredAttributesComplete = items.length > 0 && itemAttributes.every((attributes) => {
    const supplied = new Set(attributes.flatMap((attribute) =>
      text(attribute.attributeTypeName) && text(attribute.attributeValueName)
        ? [text(attribute.attributeTypeName)] : []));
    return mandatorySingles.every((name) => supplied.has(name))
      && [...mandatoryGroups.values()].every((names) => names.some((name) => supplied.has(name)));
  });
  const exposedOptionsComplete = items.length > 0 && items.every((item) =>
    hasValidCoupangPurchaseOption(item) && hasValidCoupangProductIdentifier(item));
  const optionsInvalid = attributesInvalid || items.some((item) =>
    containsPlaceholder(item.barcode) || containsPlaceholder(item.modelNo)
    || containsPlaceholder(item.emptyBarcodeReason));
  const viableNoticeCategories = rows(metadata.noticeCategories).filter((category) =>
    rows(category.noticeCategoryDetailNames).some((detail) => mandatory(detail.required)));
  const itemNotices = items.map((item) => rows(item.notices));
  const noticeStates = itemNotices.map((notices) => {
    if (!viableNoticeCategories.length) return { complete: false, invalid: true };
    if (notices.some((notice) => !text(notice.noticeCategoryDetailName)
      || !text(notice.content) || containsPlaceholder(notice.content))) {
      return { complete: false, invalid: true };
    }
    const suppliedCategories = new Set(notices.map((notice) => text(notice.noticeCategoryName)).filter(Boolean));
    if (suppliedCategories.size > 1) return { complete: false, invalid: true };
    const suppliedCategory = [...suppliedCategories][0] ?? "";
    const selectedCategory = viableNoticeCategories.length === 1
      ? viableNoticeCategories[0]
      : viableNoticeCategories.find((category) =>
        text(category.noticeCategoryName) === suppliedCategory);
    if (!selectedCategory
      || (suppliedCategory && suppliedCategory !== text(selectedCategory.noticeCategoryName))) {
      return { complete: false, invalid: Boolean(suppliedCategory) };
    }
    const officialDetails = rows(selectedCategory.noticeCategoryDetailNames);
    const officialNames = new Set(officialDetails.map((detail) =>
      text(detail.noticeCategoryDetailName)).filter(Boolean));
    if (notices.some((notice) => !officialNames.has(text(notice.noticeCategoryDetailName)))) {
      return { complete: false, invalid: true };
    }
    const supplied = new Set(notices.map((notice) => text(notice.noticeCategoryDetailName)));
    return {
      complete: officialDetails.filter((detail) => mandatory(detail.required))
        .every((detail) => supplied.has(text(detail.noticeCategoryDetailName))),
      invalid: false,
    };
  });
  const noticesInvalid = !noticeEnvelopeAligned(source, items)
    || noticeStates.some((state) => state.invalid);
  const noticesComplete = items.length > 0 && noticeStates.every((state) => state.complete);
  const metadataCertifications = rows(metadata.certifications);
  const officialCertificationByType = new Map(metadataCertifications.flatMap((candidate) => {
    const type = text(candidate.certificationType);
    return type ? [[type, candidate] as const] : [];
  }));
  const itemCertifications = items.map((item) => rows(item.certifications));
  const certificationStates = itemCertifications.map((certifications) => {
    const supplied = new Map<string, string>();
    let invalid = false;
    for (const certification of certifications) {
      const type = text(certification.certificationType);
      const code = text(certification.certificationCode);
      if (!type || !code || containsPlaceholder(code) || !officialCertificationByType.has(type)
        || (supplied.has(type) && supplied.get(type) !== code)) invalid = true;
      else supplied.set(type, code);
    }
    let complete = true;
    for (const certification of metadataCertifications.filter((candidate) => mandatory(candidate.required))) {
      const type = text(certification.certificationType);
      if (!type) invalid = true;
      else if (!supplied.has(type)) {
        complete = false;
        if (text(certification.dataType).toUpperCase() !== "CODE") invalid = true;
      }
    }
    return { complete, invalid };
  });
  const certificationsInvalid = certificationStates.some((state) => state.invalid);
  const certificationsComplete = items.length > 0 && certificationStates.every((state) => state.complete);
  const status = (complete: boolean, invalid: boolean): CoupangCreateCompletenessStatus =>
    invalid ? "blocked" : complete ? "resolved" : "manual_required";
  return {
    options: field("options", "구매 옵션", status(exposedOptionsComplete, optionsInvalid),
      ["source.facts.coupangOptionRows[*]", "body.items[*].attributes",
        "body.items[*].barcode", "body.items[*].emptyBarcode",
        "body.items[*].emptyBarcodeReason", "body.items[*].modelNo"], sources,
      exposedOptionsComplete && !optionsInvalid ? "seller_confirmed.body" : null,
      optionsInvalid ? "구매 옵션과 상품 식별값에 빈 값이나 placeholder를 사용할 수 없습니다."
        : exposedOptionsComplete ? "현재 옵션값이 확인됐습니다." : "노출할 구매 옵션과 값을 입력해 주세요."),
    attributes: field("attributes", "카테고리 속성", status(requiredAttributesComplete, attributesInvalid),
      ["body.items[*].attributes"], sources,
      requiredAttributesComplete && !attributesInvalid ? "seller_confirmed.body" : null,
      attributesInvalid ? "카테고리 속성에 빈 값이나 placeholder를 사용할 수 없습니다."
        : requiredAttributesComplete ? "필수 카테고리 속성이 확인됐습니다." : "누락된 필수 카테고리 속성을 입력해 주세요."),
    notices: field("notices", "상품 고시", status(noticesComplete, noticesInvalid),
      ["body.items[*].notices"], sources,
      noticesComplete && !noticesInvalid ? "seller_confirmed.body" : null,
      noticesInvalid ? "상품 고시 분류·상세 항목이 공식 메타데이터와 다르거나 placeholder를 포함합니다."
        : noticesComplete ? "필수 상품 고시가 확인됐습니다." : "카테고리별 필수 상품 고시를 입력해 주세요."),
    certifications: field("certifications", "인증정보", status(certificationsComplete, certificationsInvalid),
      ["body.items[*].certifications"], sources,
      certificationsComplete && !certificationsInvalid ? "seller_confirmed.body" : null,
      certificationsInvalid ? "인증 유형·면제 조건이 공식 메타데이터와 일치하지 않습니다."
        : certificationsComplete ? "카테고리 인증 요구조건이 확인됐습니다." : "필수 인증 유형과 인증번호를 입력해 주세요."),
  };
}

export function resolveCoupangCreateCompleteness(
  input: CoupangCreateCompletenessInput,
): CoupangCreateCompletenessResult {
  const source = row(input.source);
  const body = row(input.body);
  const context = row(input.publishContext);
  const product = row(context?.product);
  const items = rows(body?.items);
  const categoryMetadata = providerRead(input.categoryMetadataRead);
  const categoryStatusRead = providerRead(input.categoryStatusRead);
  const outboundRead = providerRead(input.outboundShippingPlacesRead);
  const returnRead = providerRead(input.returnCentersRead);
  const metadataFields = metadataDependentFields(categoryMetadata, items, source);
  const assignment = confirmedCoupangAssignment(context);
  const categoryCode = Number(body?.displayCategoryCode);
  const assignmentCategory = Number(assignment?.categoryId);
  const statusValue = categoryStatusRead.state === "success"
    ? categoryStatus(categoryStatusRead.data)
    : null;

  const forbiddenRecovery = hasRetiredProductRecovery(source)
    || hasRetiredProductRecovery(body)
    || hasRetiredProductRecovery(context)
    || Boolean(
    text(source?.resumeRemoteId)
    || text(source?.sellerProductId)
    || text(body?.sellerProductId)
    || items.some((item) => text(item.sellerProductItemId)),
  );
  const createLineage = field("create_lineage", "신규 CREATE 계보",
    forbiddenRecovery ? "blocked" : "resolved",
    ["source.resumeRemoteId", "body.sellerProductId", "body.items[*].sellerProductItemId"],
    ["publish_context.product"], forbiddenRecovery ? null : "publish_context.product",
    forbiddenRecovery
      ? "기존 원격 상품 회복값은 신규 CREATE 입력에 사용할 수 없습니다."
      : "신규 상품 계보에 기존 원격 상품 식별자가 없습니다.");

  let category: CoupangCreateCompletenessField;
  if (!positiveInteger(categoryCode) || !assignment) {
    category = field("category", "카테고리", "manual_required",
      ["body.displayCategoryCode", "publishContext.assignments[channel=coupang].categoryId"],
      ["publish_context.confirmed_assignment", "seller_confirmed.body"], null,
      "확정된 쿠팡 카테고리를 선택해 주세요.");
  } else if (categoryCode !== assignmentCategory) {
    category = field("category", "카테고리", "blocked",
      ["body.displayCategoryCode", "publishContext.assignments[channel=coupang].categoryId"],
      ["publish_context.confirmed_assignment", "seller_confirmed.body"], null,
      "본문 카테고리가 현재 확정 assignment와 일치하지 않습니다.");
  } else if (categoryStatusRead.state === "missing") {
    category = field("category", "카테고리", "provider_read_required",
      ["body.displayCategoryCode", "publishContext.assignments[channel=coupang].categoryId"],
      ["publish_context.confirmed_assignment", "seller_confirmed.body", "provider.category_status"], null,
      "선택한 카테고리의 현재 활성 상태를 조회해 주세요.");
  } else if (categoryStatusRead.state === "failed" || statusValue !== true) {
    category = field("category", "카테고리", "blocked",
      ["body.displayCategoryCode", "publishContext.assignments[channel=coupang].categoryId"],
      ["publish_context.confirmed_assignment", "seller_confirmed.body", "provider.category_status"], null,
      "쿠팡 카테고리가 비활성 상태이거나 상태 조회에 실패했습니다.");
  } else {
    category = field("category", "카테고리", "resolved",
      ["body.displayCategoryCode", "publishContext.assignments[channel=coupang].categoryId"],
      ["publish_context.confirmed_assignment", "seller_confirmed.body", "provider.category_status"],
      "provider.category_status", "확정 assignment와 활성 카테고리가 일치합니다.");
  }

  const itemNames = itemValues(items, "itemName").map(text);
  const titles = [body?.sellerProductName, body?.displayProductName, ...itemNames];
  const contextTitle = text(row(context?.manualFields)?.productName) || text(product?.name);
  const approvedCoupangTitle = text(rows(context?.localizedListings).find((candidate) =>
    text(candidate.channel).toLowerCase() === "coupang"
    && (!text(candidate.market) || text(candidate.market).toUpperCase() === "KR"))?.title);
  const allowedSellerTitles = new Set([contextTitle, approvedCoupangTitle]
    .filter(Boolean).map((candidate) => candidate.slice(0, 100)));
  const titleInvalid = titles.some(containsPlaceholder)
    || new Set(itemNames).size !== itemNames.length
    || (allNonPlaceholderText(titles) && allowedSellerTitles.size > 0
      && !allowedSellerTitles.has(text(body?.sellerProductName)));
  const title = field("title", "상품명", titleInvalid ? "blocked"
    : allNonPlaceholderText(titles) ? "resolved" : "manual_required",
  ["body.sellerProductName", "body.displayProductName", "body.items[*].itemName"],
  ["publish_context.product", "seller_confirmed.body"],
  !titleInvalid && allNonPlaceholderText(titles) ? "seller_confirmed.body" : null,
  titleInvalid ? "상품명이 현재 상품 원본과 다르거나 placeholder를 포함합니다."
    : allNonPlaceholderText(titles) ? "상품명이 입력됐습니다." : "상품명을 확인해 주세요.");

  const brandValue = text(body?.brand);
  const brandInvalid = containsPlaceholder(brandValue)
    || Boolean(brandValue && !/^[\p{L}\p{N}]+$/u.test(brandValue) && !text(body?.brandId));
  const brand = field("brand", "브랜드", brandInvalid ? "blocked"
    : brandValue || text(body?.brandId) ? "resolved" : "manual_required",
  ["body.brand", "body.brandId"],
  ["publish_context.product", "seller_confirmed.body"],
  !brandInvalid && (brandValue || text(body?.brandId)) ? "seller_confirmed.body" : null,
  brandInvalid ? "브랜드는 공백 없는 공식 브랜드명 또는 브랜드 ID여야 합니다."
    : brandValue || text(body?.brandId) ? "브랜드가 입력됐습니다." : "브랜드를 확인해 주세요.");

  const baseSku = text(source?.sellerpilotCoupangBaseSku);
  const contextSku = text(row(context?.manualFields)?.sellerSku) || text(product?.sku);
  const skus = itemValues(items, "externalVendorSku").map(text);
  const optionAlignmentInvalid = !optionSourceAligned(source, body, baseSku);
  const skuInvalid = optionAlignmentInvalid
    || skus.some((sku) => containsPlaceholder(sku) || sku.length > 100)
    || new Set(skus).size !== skus.length
    || Boolean(baseSku && contextSku && baseSku !== contextSku)
    || skus.some((sku) => baseSku && sku !== baseSku && !sku.startsWith(`${baseSku}-`));
  const skuComplete = Boolean(baseSku && contextSku && skus.length && skus.every(Boolean));
  const externalSku = field("external_vendor_sku", "판매자 SKU", skuInvalid ? "blocked"
    : skuComplete ? "resolved" : "manual_required",
  ["source.sellerpilotCoupangBaseSku", "body.items[*].externalVendorSku", "publishContext.product.sku"],
  ["publish_context.product", "seller_confirmed.option_rows", "seller_confirmed.body"],
  !skuInvalid && skuComplete ? "seller_confirmed.option_rows" : null,
  skuInvalid ? "판매자 SKU가 상품 원본·옵션 계보와 일치하지 않습니다."
    : skuComplete ? "판매자 SKU가 신규 상품 계보에 맞습니다." : "기본 SKU와 모든 옵션 SKU를 입력해 주세요.");

  const priceComplete = items.length > 0 && itemValues(items, "salePrice").every(positiveMoney);
  const price = field("price", "판매가", optionAlignmentInvalid ? "blocked"
    : priceComplete ? "resolved" : "manual_required",
    ["body.items[*].salePrice", "body.items[*].originalPrice"],
    ["publish_context.product", "seller_confirmed.option_rows", "seller_confirmed.body"],
    !optionAlignmentInvalid && priceComplete ? "seller_confirmed.body" : null,
    optionAlignmentInvalid ? "옵션 초안의 판매가가 최종 상품 본문과 일치하지 않습니다."
      : priceComplete ? "모든 옵션 판매가가 입력됐습니다." : "모든 옵션의 판매가를 입력해 주세요.");

  const stockComplete = items.length > 0 && itemValues(items, "maximumBuyCount").every(positiveInteger);
  const stock = field("stock", "재고", optionAlignmentInvalid ? "blocked"
    : stockComplete ? "resolved" : "manual_required",
    ["body.items[*].maximumBuyCount"],
    ["publish_context.product", "seller_confirmed.option_rows", "seller_confirmed.body"],
    !optionAlignmentInvalid && stockComplete ? "seller_confirmed.body" : null,
    optionAlignmentInvalid ? "옵션 초안의 재고가 최종 상품 본문과 일치하지 않습니다."
      : stockComplete ? "모든 옵션 재고가 입력됐습니다." : "모든 옵션의 판매 가능 재고를 입력해 주세요.");

  const unitComplete = items.length > 0 && itemValues(items, "unitCount").every(positiveInteger);
  const unit = field("unit", "판매 단위", optionAlignmentInvalid ? "blocked"
    : unitComplete ? "resolved" : "manual_required",
    ["body.items[*].unitCount"],
    ["seller_confirmed.option_rows", "seller_confirmed.body"],
    !optionAlignmentInvalid && unitComplete ? "seller_confirmed.body" : null,
    optionAlignmentInvalid ? "옵션 초안의 판매 단위가 최종 상품 본문과 일치하지 않습니다."
      : unitComplete ? "모든 옵션 판매 단위가 입력됐습니다." : "모든 옵션의 판매 단위를 확인해 주세요.");

  if (optionAlignmentInvalid) {
    metadataFields.options = field("options", "구매 옵션", "blocked",
      ["source.facts.coupangOptionRows[*]", "body.items[*]"],
      ["seller_confirmed.option_rows", "seller_confirmed.body"], null,
      "옵션 초안과 최종 옵션 상품이 일치하지 않습니다.");
  }

  const outboundCenters = outboundRead.state === "success" ? nestedRows(outboundRead.data) : [];
  const requestedOutbound = text(body?.outboundShippingPlaceCode);
  const outboundMatch = outboundCenters.find((candidate) =>
    usable(candidate.usable)
    && preferredKoreanAddress(candidate.placeAddresses)
    && text(candidate.outboundShippingPlaceCode) === requestedOutbound);
  const outbound = readDependentField({
    key: "outbound_shipping_place", label: "출고지", read: outboundRead,
    paths: ["body.outboundShippingPlaceCode"],
    sources: ["provider.outbound_shipping_places", "seller_confirmed.body"],
    complete: Boolean(requestedOutbound && outboundMatch),
    invalid: Boolean(requestedOutbound && outboundRead.state === "success" && !outboundMatch),
    missingMessage: "조회된 사용 가능 출고지 중 하나를 선택해 주세요.",
    invalidMessage: "선택한 출고지가 현재 쿠팡 계정에서 사용 가능하지 않습니다.",
  });

  const returnCenters = returnRead.state === "success" ? nestedRows(returnRead.data) : [];
  const selectedReturn = selectedReturnCenter(returnCenters, body);
  const requestedReturn = text(body?.returnCenterCode);
  const returnCenter = readDependentField({
    key: "return_center", label: "반품지", read: returnRead,
    paths: ["body.returnCenterCode"],
    sources: ["provider.return_centers", "seller_confirmed.body"],
    complete: Boolean(requestedReturn && selectedReturn),
    invalid: Boolean(requestedReturn && returnRead.state === "success" && !selectedReturn),
    missingMessage: "조회된 사용 가능 반품지 중 하나를 선택해 주세요.",
    invalidMessage: "선택한 반품지가 현재 쿠팡 계정에서 사용 가능하지 않습니다.",
  });
  const providerCarrier = text(selectedReturn?.deliverCode).toUpperCase();
  const selectedCarrier = text(body?.deliveryCompanyCode).toUpperCase();
  const selectedCarrierValid = /^[A-Z0-9_-]{2,32}$/u.test(selectedCarrier);
  const carrier = readDependentField({
    key: "carrier", label: "택배사", read: returnRead,
    paths: ["body.deliveryCompanyCode"],
    sources: ["provider.return_centers", "seller_confirmed.body"],
    complete: Boolean(selectedReturn && selectedCarrierValid
      && (!providerCarrier || selectedCarrier === providerCarrier)),
    invalid: Boolean(selectedReturn && selectedCarrier && providerCarrier && selectedCarrier !== providerCarrier),
    missingMessage: "선택한 반품지의 택배사를 확인해 주세요.",
    invalidMessage: "입력한 택배사가 선택한 반품지의 현재 계약값과 다릅니다.",
  });
  const providerFee = returnFee(selectedReturn);
  const providerFeeAmbiguous = ambiguousReturnFee(selectedReturn);
  const feeComplete = Boolean(selectedReturn
    && !providerFeeAmbiguous
    && validShippingFeeContract(source, body, providerFee)
    && validLeadTimeContract(source, items));
  const fees = readDependentField({
    key: "fees", label: "배송·반품비", read: returnRead,
    paths: ["body.deliveryChargeType", "body.deliveryCharge", "body.freeShipOverAmount",
      "body.deliveryChargeOnReturn", "body.returnCharge",
      "source.sellerpilotAssets.shipping.shippingRule",
      "source.sellerpilotAssets.shipping.coupangLeadTimeConfirmation",
      "body.items[*].outboundShippingTimeDay"],
    sources: ["provider.return_centers", "seller_confirmed.body"],
    complete: feeComplete,
    invalid: Boolean(selectedReturn
      && (providerFeeAmbiguous || contradictoryShippingFeeContract(body, providerFee))),
    missingMessage: "배송비·반품비와 쿠팡 출고 소요일 확인값을 입력해 주세요.",
    invalidMessage: providerFeeAmbiguous
      ? "반품지의 중량별 반품비가 서로 달라 확정 포장중량에 맞는 계약 요금을 선택해야 합니다."
      : "입력한 반품비가 현재 반품지 계약값과 다르거나 배송비 조건이 잘못됐습니다.",
  });

  const representationImagesByItem = items.map((item) => rows(item.images).filter((image) =>
    text(image.imageType).toUpperCase() === "REPRESENTATION"));
  const representationImages = representationImagesByItem.flat();
  const representativeInvalid = representationImages.some((image) =>
    !text(image.vendorPath).startsWith("https://") || containsPlaceholder(image.vendorPath));
  const representativeComplete = items.length > 0
    && representationImagesByItem.every((images) => images.length === 1)
    && representationImages.every((image) => text(image.vendorPath).startsWith("https://"));
  const representative = field("representative_image", "대표 이미지", representativeInvalid ? "blocked"
    : representativeComplete ? "resolved" : "manual_required",
  ["body.items[*].images[imageType=REPRESENTATION].vendorPath"],
  ["seller_confirmed.body"], representativeComplete && !representativeInvalid ? "seller_confirmed.body" : null,
  representativeInvalid ? "대표 이미지는 검토된 HTTPS 이미지여야 합니다."
    : representativeComplete ? "각 옵션의 대표 이미지가 입력됐습니다." : "각 옵션의 대표 이미지를 선택해 주세요.");

  const assets = row(source?.sellerpilotAssets);
  const detailPaths = Array.isArray(assets?.approvedDetailImagePaths)
    ? assets.approvedDetailImagePaths.map(text) : [];
  const detailHashes = Array.isArray(assets?.approvedDetailImageSha256s)
    ? assets.approvedDetailImageSha256s.map(text) : [];
  const detailRoles = Array.isArray(assets?.detailImageRoles)
    ? assets.detailImageRoles.map(text) : [];
  const detailPage = row(context?.detailPage);
  const manifest = row(detailPage?.imageManifest);
  const detailComplete = detailPaths.length === 8 && detailHashes.length === 8 && detailRoles.length === 8
    && detailPaths.every(Boolean) && detailHashes.every((value) => sha256.test(value))
    && detailRoles.every(Boolean) && new Set(detailPaths).size === 8 && new Set(detailHashes).size === 8
    && positiveInteger(assets?.approvedDetailPageVersion)
    && Number(assets?.approvedDetailPageVersion) === Number(detailPage?.version)
    && Number(detailPage?.approvedVersion) === Number(detailPage?.version)
    && sha256.test(text(assets?.detailImageManifestDigest))
    && text(assets?.detailImageManifestDigest) === text(manifest?.digest);
  const detailSupplied = detailPaths.length > 0 || detailHashes.length > 0 || detailRoles.length > 0;
  const detailImages = field("approved_detail_images", "승인 상세 이미지 8장",
    detailComplete ? "resolved" : detailSupplied ? "blocked" : "manual_required",
    ["source.sellerpilotAssets.approvedDetailImagePaths", "source.sellerpilotAssets.approvedDetailImageSha256s",
      "source.sellerpilotAssets.detailImageRoles", "source.sellerpilotAssets.approvedDetailPageVersion",
      "source.sellerpilotAssets.detailImageManifestDigest", "publishContext.detailPage.imageManifest.digest"],
    ["approved_detail_manifest"], detailComplete ? "approved_detail_manifest" : null,
    detailComplete ? "현재 승인 revision의 상세 이미지 8장이 바이트 단위로 확인됐습니다."
      : detailSupplied ? "상세 이미지 8장 또는 승인 revision·manifest가 서로 일치하지 않습니다."
        : "승인된 상세 이미지 8장을 준비해 주세요.");

  const credential = row(input.credentialRevision);
  const expiresAt = text(credential?.expiresAt);
  const expires = expiresAt ? new Date(expiresAt).getTime() : Number.POSITIVE_INFINITY;
  const credentialSupplied = input.credentialRevision !== undefined && input.credentialRevision !== null;
  const credentialComplete = Boolean(credential
    && uuid.test(text(credential.credentialId))
    && positiveInteger(credential.credentialVersion)
    && text(credential.credentialFingerprint)
    && ["production", "sandbox"].includes(text(credential.environment))
    && (!input.environment || text(credential.environment) === input.environment)
    && credential.sellerIdentityReady === true
    && (!expiresAt || (Number.isFinite(expires)
      && expires > (input.now ?? new Date()).getTime())));
  const credentialField = field("credential_revision", "활성 인증 revision",
    credentialComplete ? "resolved" : credentialSupplied ? "blocked" : "provider_read_required",
    ["credentialRevision.credentialId", "credentialRevision.credentialVersion",
      "credentialRevision.credentialFingerprint", "credentialRevision.environment",
      "credentialRevision.expiresAt", "credentialRevision.sellerIdentityReady"],
    ["server.active_credential_revision"], credentialComplete ? "server.active_credential_revision" : null,
    credentialComplete ? "현재 활성 인증 revision과 판매자 식별정보가 확인됐습니다."
      : credentialSupplied ? "인증 revision이 만료됐거나 현재 활성 credential 조건을 충족하지 않습니다."
        : "서버에서 현재 활성 credential revision을 조회해 주세요.");

  const fields = [
    createLineage, category, title, brand, metadataFields.options, externalSku, price, stock, unit,
    metadataFields.attributes, metadataFields.notices, metadataFields.certifications,
    outbound, returnCenter, carrier, fees, representative, detailImages, credentialField,
  ];
  const counts = fields.reduce<Record<CoupangCreateCompletenessStatus, number>>((total, candidate) => {
    total[candidate.status] += 1;
    return total;
  }, { resolved: 0, manual_required: 0, provider_read_required: 0, blocked: 0 });
  const blockingFieldKeys = fields.filter((candidate) => candidate.status !== "resolved")
    .map((candidate) => candidate.key);
  const overallStatus: CoupangCreateCompletenessStatus = counts.blocked > 0 ? "blocked"
    : counts.provider_read_required > 0 ? "provider_read_required"
      : counts.manual_required > 0 ? "manual_required" : "resolved";
  return {
    contract: coupangCreateCompletenessContract,
    channel: "coupang",
    operation: "listing.create",
    fields,
    counts,
    blockingFieldKeys,
    overallStatus,
    canBindCreateSourceRevision: blockingFieldKeys.length === 0,
  };
}

/**
 * This is the only hand-off into the 003 source-revision binder. It does not
 * call Coupang or mutate its input. A partial form can never produce a CREATE
 * arguments candidate that a caller might accidentally bind or enqueue.
 */
export function buildCoupangCreateRevisionCandidate(
  input: CoupangCreateCompletenessInput,
): CoupangCreateRevisionCandidate {
  const completeness = resolveCoupangCreateCompleteness(input);
  if (!completeness.canBindCreateSourceRevision) {
    throw new Error(`COUPANG_CREATE_COMPLETENESS_REQUIRED:${completeness.blockingFieldKeys.join(",")}`);
  }
  const source = row(input.source);
  const body = row(input.body);
  const context = row(input.publishContext);
  const credential = row(input.credentialRevision);
  const officialReadEvidence = row(input.officialReadEvidence);
  if (!source || !body || !context || !credential || !officialReadEvidence) {
    throw new Error("COUPANG_CREATE_COMPLETENESS_REQUIRED:input_shape");
  }
  return {
    argumentsValue: { ...structuredClone(source), body: structuredClone(body) },
    publishContext: structuredClone(context),
    credentialRevision: structuredClone(credential),
    officialReadEvidence: structuredClone(officialReadEvidence),
    completeness,
  };
}
