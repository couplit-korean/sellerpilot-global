import { smartstoreReadbackImageProjection } from "./smartstore-image-contract";
import { validatedSmartstoreShippingInfo } from "./listing-shipping";
import { smartstoreIndicationUnits } from "./smartstore-unit-capacity";

type UnknownRecord = Record<string, unknown>;

export const smartstoreListingCreateContract =
  "smartstore_listing_create_v1" as const;

export type SmartstoreCreateIdentity = {
  originProductNo: string;
  channelProductNo: string;
};

/**
 * Every SmartStore create must carry both contracts injected by the provider
 * preparation stage. Direct calls are not a legacy escape hatch because they
 * reach the same live Commerce API create endpoint.
 */
export function smartstoreStrictCreateRequested(value: unknown) {
  const argumentsValue = record(value);
  const marker = argumentsValue.sellerpilotSmartstoreCreateContract;
  const verifiedPublication =
    argumentsValue.publicationStateContract === "verified_remote_state_v1";
  if (marker === undefined) {
    throw new Error("NAVER_CREATE_CONTRACT_REQUIRED");
  }
  if (marker !== smartstoreListingCreateContract) {
    throw new Error("NAVER_CREATE_CONTRACT_INVALID");
  }
  if (!verifiedPublication) {
    throw new Error("NAVER_CREATE_PUBLICATION_CONTRACT_REQUIRED");
  }
  return true;
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function integerInRange(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= minimum && value <= maximum;
}

function snakeToCamel(value: string) {
  return value.toLowerCase().replace(/_([a-z])/gu, (_match, letter: string) =>
    letter.toUpperCase());
}

function assertProvidedNotice(
  detailAttribute: UnknownRecord,
  allowServerManagedContact: boolean,
) {
  const notice = record(detailAttribute.productInfoProvidedNotice);
  const type = text(notice.productInfoProvidedNoticeType);
  if (!/^[A-Z][A-Z0-9_]{1,79}$/u.test(type)) {
    throw new Error("NAVER_CREATE_PRODUCT_NOTICE_REQUIRED");
  }
  const body = record(notice[snakeToCamel(type)]);
  if (!Object.keys(body).length) {
    throw new Error("NAVER_CREATE_PRODUCT_NOTICE_REQUIRED");
  }
  if (type !== "ETC") return;
  for (const field of [
    "returnCostReason",
    "noRefundReason",
    "qualityAssuranceStandard",
    "compensationProcedure",
    "troubleShootingContents",
    "itemName",
    "modelName",
    "certificateDetails",
    "manufacturer",
    "customerServicePhoneNumber",
  ]) {
    if (!text(body[field])
        || (text(body[field]) === "SERVER_MANAGED"
          && !(allowServerManagedContact
            && field === "customerServicePhoneNumber"))) {
      throw new Error("NAVER_CREATE_PRODUCT_NOTICE_REQUIRED");
    }
  }
}

function assertCertificationDecision(detailAttribute: UnknownRecord) {
  const certifications = detailAttribute.productCertificationInfos;
  if (Array.isArray(certifications) && certifications.length > 0) {
    const valid = certifications.every((value) => {
      const certification = record(value);
      return integerInRange(
        certification.certificationInfoId,
        0,
        Number.MAX_SAFE_INTEGER,
      ) && [
        "KC_CERTIFICATION",
        "CHILD_CERTIFICATION",
        "GREEN_PRODUCTS",
        "CHEMICAL_CERTIFICATION",
        "PARALLEL_IMPORT",
        "OVERSEAS",
        "ETC",
      ].includes(text(certification.certificationKindType))
        && text(certification.name)
        && text(certification.certificationNumber)
        && (certification.certificationMark === undefined
          || typeof certification.certificationMark === "boolean");
    });
    if (valid) return;
  }

  const exclusion = record(detailAttribute.certificationTargetExcludeContent);
  const booleanKeys = [
    "childCertifiedProductExclusionYn",
    "greenCertifiedProductExclusionYn",
    "chemicalCertifiedProductExclusionYn",
  ];
  const kcDecision = text(exclusion.kcCertifiedProductExclusionYn);
  const kcExemptionType = text(exclusion.kcExemptionType);
  const valid = booleanKeys.every((key) =>
    typeof exclusion[key] === "boolean")
    && ["FALSE", "KC_EXEMPTION_OBJECT", "TRUE"].includes(kcDecision)
    && (kcDecision !== "KC_EXEMPTION_OBJECT"
      || ["OVERSEAS", "SAFE_CRITERION", "PARALLEL_IMPORT"].includes(
        kcExemptionType,
      ))
    && (!kcExemptionType
      || ["OVERSEAS", "SAFE_CRITERION", "PARALLEL_IMPORT"].includes(
        kcExemptionType,
      ));
  if (!valid) throw new Error("NAVER_CREATE_CERTIFICATION_DECISION_REQUIRED");
}

function assertOptions(detailAttribute: UnknownRecord) {
  const optionInfo = record(detailAttribute.optionInfo);
  const collectionKeys = [
    "optionSimple",
    "optionCustom",
    "optionCombinations",
    "optionStandards",
  ] as const;
  const collections = collectionKeys
    .map((key) => optionInfo[key])
    .filter((value) => value !== undefined);
  if (collections.some((value) => !Array.isArray(value))) {
    throw new Error("NAVER_CREATE_OPTIONS_INVALID");
  }
  if (optionInfo.useStockManagement !== undefined
      && typeof optionInfo.useStockManagement !== "boolean") {
    throw new Error("NAVER_CREATE_OPTIONS_INVALID");
  }

  const simple = Array.isArray(optionInfo.optionSimple)
    ? optionInfo.optionSimple : [];
  const custom = Array.isArray(optionInfo.optionCustom)
    ? optionInfo.optionCustom : [];
  const combinations = Array.isArray(optionInfo.optionCombinations)
    ? optionInfo.optionCombinations : [];
  const standards = Array.isArray(optionInfo.optionStandards)
    ? optionInfo.optionStandards : [];
  if (simple.length > 3 || custom.length > 5
      || (simple.length > 0 && (combinations.length > 0 || standards.length > 0))
      || (combinations.length > 0 && standards.length > 0)) {
    throw new Error("NAVER_CREATE_OPTIONS_INVALID");
  }
  for (const value of [...simple, ...custom]) {
    const option = record(value);
    if (!text(option.groupName)
        || (option.usable !== undefined && typeof option.usable !== "boolean")) {
      throw new Error("NAVER_CREATE_OPTIONS_INVALID");
    }
  }
  for (const value of [...combinations, ...standards]) {
    const option = record(value);
    if (!text(option.optionName1)
        || !integerInRange(option.stockQuantity, 0, 99_999_999)
        || (option.price !== undefined
          && !integerInRange(option.price, 0, 999_999_990))
        || (option.usable !== undefined && typeof option.usable !== "boolean")) {
      throw new Error("NAVER_CREATE_OPTIONS_INVALID");
    }
  }
}

function assertUnitCapacityShape(detailAttribute: UnknownRecord) {
  if (!Object.hasOwn(detailAttribute, "unitCapacity")) return;
  const capacity = record(detailAttribute.unitCapacity);
  if (typeof capacity.unitPriceYn !== "boolean") {
    throw new Error("NAVER_CREATE_UNIT_CAPACITY_INVALID");
  }
  const fields = ["totalCapacityValue", "unitCapacity", "indicationUnit"];
  if (!capacity.unitPriceYn) {
    if (fields.some((key) => Object.hasOwn(capacity, key))) {
      throw new Error("NAVER_CREATE_UNIT_CAPACITY_INVALID");
    }
    return;
  }
  const total = capacity.totalCapacityValue;
  if (typeof total !== "number" || !Number.isFinite(total)
      || total < 0.001 || total > 999_999_999
      || !/^[0-9]+(?:\.[0-9]{1,3})?$/u.test(String(total))
      || !integerInRange(capacity.unitCapacity, 1, 999)
      || !(smartstoreIndicationUnits as readonly string[]).includes(
        text(capacity.indicationUnit),
      )) {
    throw new Error("NAVER_CREATE_UNIT_CAPACITY_INVALID");
  }
}

function assertBrandAndOrigin(detailAttribute: UnknownRecord) {
  const searchInfo = record(detailAttribute.naverShoppingSearchInfo);
  const brandId = Number(searchInfo.brandId);
  if (!text(searchInfo.brandName)
      && (!Number.isSafeInteger(brandId) || brandId <= 0)) {
    throw new Error("NAVER_CREATE_BRAND_REQUIRED");
  }
  const origin = record(detailAttribute.originAreaInfo);
  const code = text(origin.originAreaCode);
  if (!["00", "01", "02", "03", "04", "05"].includes(code)
      || (code === "02" && !text(origin.importer))
      || (code === "04" && !text(origin.content))) {
    throw new Error("NAVER_CREATE_ORIGIN_AREA_REQUIRED");
  }
}

/** Shared create fields that must be explicit at draft and final boundaries. */
function assertSmartstoreCreateBodyFields(
  value: unknown,
  allowServerManagedContact: boolean,
) {
  const body = record(value);
  const originProduct = record(body.originProduct);
  const channelProduct = record(body.smartstoreChannelProduct);
  if (!["SALE", "SUSPENSION"].includes(text(originProduct.statusType))
      || !["NEW", "OLD"].includes(text(originProduct.saleType))
      || !/^[1-9][0-9]*$/u.test(text(originProduct.leafCategoryId))
      || !text(originProduct.name)
      || !text(originProduct.detailContent)
      || !integerInRange(originProduct.salePrice, 10, 999_999_990)
      || Number(originProduct.salePrice) % 10 !== 0
      || !integerInRange(originProduct.stockQuantity, 0, 99_999_999)) {
    throw new Error("NAVER_CREATE_ORIGIN_PRODUCT_REQUIRED");
  }
  try {
    validatedSmartstoreShippingInfo(originProduct.deliveryInfo);
  } catch {
    throw new Error("NAVER_CREATE_SHIPPING_REQUIRED");
  }
  const deliveryInfo = record(originProduct.deliveryInfo);
  if (!["NORMAL", "TODAY", "OPTION_TODAY", "HOPE", "TODAY_ARRIVAL",
    "DAWN_ARRIVAL", "ARRIVAL_GUARANTEE", "SELLER_GUARANTEE",
    "HOPE_SELLER_GUARANTEE", "QUICK", "PICKUP", "QUICK_PICKUP"]
    .includes(text(deliveryInfo.deliveryAttributeType))) {
    throw new Error("NAVER_CREATE_SHIPPING_REQUIRED");
  }

  const detailAttribute = record(originProduct.detailAttribute);
  const sellerCodeInfo = record(detailAttribute.sellerCodeInfo);
  const afterServiceInfo = record(detailAttribute.afterServiceInfo);
  if (!text(sellerCodeInfo.sellerManagementCode)) {
    throw new Error("NAVER_SELLER_MANAGEMENT_CODE_MISSING");
  }
  if (!text(afterServiceInfo.afterServiceTelephoneNumber)
      || !text(afterServiceInfo.afterServiceGuideContent)) {
    throw new Error("NAVER_CREATE_AFTER_SERVICE_REQUIRED");
  }
  assertProvidedNotice(detailAttribute, allowServerManagedContact);
  assertCertificationDecision(detailAttribute);
  assertBrandAndOrigin(detailAttribute);
  assertUnitCapacityShape(detailAttribute);
  assertOptions(detailAttribute);

  if (typeof channelProduct.naverShoppingRegistration !== "boolean"
      || !text(channelProduct.channelProductName)
      || !["ON", "SUSPENSION"].includes(
        text(channelProduct.channelProductDisplayStatusType),
      )) {
    throw new Error("NAVER_CREATE_CHANNEL_PRODUCT_REQUIRED");
  }
  return { originProduct, afterServiceInfo };
}

/**
 * Checks seller-entered and category-bound create values before the first
 * provider mutation. Provider image URLs and the server-resolved phone may
 * still be explicit placeholders at this boundary.
 */
export function assertSmartstoreCreateDraftReady(value: unknown) {
  assertSmartstoreCreateBodyFields(value, true);
}

/**
 * Checks the fully prepared Commerce API body immediately before product
 * creation. Provider image URLs and server-owned contact/shipping values must
 * already be resolved; this function never fills or guesses them.
 */
export function assertSmartstoreCreateBodyReady(value: unknown) {
  const { originProduct, afterServiceInfo } =
    assertSmartstoreCreateBodyFields(value, false);
  if (!smartstoreReadbackImageProjection(originProduct).verified) {
    throw new Error("NAVER_CREATE_IMAGES_REQUIRED");
  }
  if (text(afterServiceInfo.afterServiceTelephoneNumber) === "SERVER_MANAGED"
      || text(afterServiceInfo.afterServiceGuideContent) === "SERVER_MANAGED") {
    throw new Error("NAVER_CREATE_AFTER_SERVICE_REQUIRED");
  }
}

export function smartstoreCreateIdentity(value: unknown): SmartstoreCreateIdentity | null {
  const response = record(value);
  const originProductNo = text(response.originProductNo);
  const channelProductNo = text(response.smartstoreChannelProductNo);
  const providerId = /^[1-9][0-9]{5,19}$/u;
  return providerId.test(originProductNo)
      && providerId.test(channelProductNo)
      && originProductNo !== channelProductNo
    ? { originProductNo, channelProductNo }
    : null;
}
