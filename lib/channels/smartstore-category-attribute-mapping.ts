import { createHash } from "node:crypto";

type UnknownRecord = Record<string, unknown>;

export const smartstoreCategoryAttributeAssignmentContract =
  "smartstore_category_attribute_assignment_v1" as const;
export const smartstoreCategoryAttributeOfficialReadbackContract =
  "smartstore_category_attribute_official_readback_v1" as const;
export const smartstoreCategoryAttributeMappingContract =
  "smartstore_category_attribute_mapping_v1" as const;
export const smartstoreCategoryAttributeBlockerContract =
  "smartstore_category_attribute_blocker_v1" as const;

export type SmartstoreCategoryAttributeSelection = {
  attributeSeq: number | string;
  attributeValueSeq: number | string;
  attributeRealValue?: string;
  attributeRealValueUnitCode?: string;
};

export type SmartstoreCategoryAttributeAssignment = {
  contract: typeof smartstoreCategoryAttributeAssignmentContract;
  channel: "smartstore";
  operation: "listing.create";
  environment: "production" | "sandbox";
  market: "KR";
  status: "confirmed";
  categoryId: string;
  revision: number;
  digest: string;
  providedAttributes: SmartstoreCategoryAttributeSelection[];
};

export type SmartstoreCategoryAttributeOfficialReadback = {
  contract: typeof smartstoreCategoryAttributeOfficialReadbackContract;
  categoryId: string;
  assignmentRevision: number;
  assignmentDigest: string;
  category: unknown;
  attributes: unknown;
  attributeValues: unknown;
  attributeValueUnits: unknown;
  digest: string;
};

export type SmartstoreProductAttribute = {
  attributeSeq: number;
  attributeValueSeq: number;
  attributeRealValue?: string;
  attributeRealValueUnitCode?: string;
};

export type SmartstoreCategoryAttributeBlockerCode =
  | "SMARTSTORE_CATEGORY_ASSIGNMENT_INVALID"
  | "SMARTSTORE_CATEGORY_ASSIGNMENT_NOT_CONFIRMED"
  | "SMARTSTORE_CATEGORY_ASSIGNMENT_DIGEST_MISMATCH"
  | "SMARTSTORE_CATEGORY_ATTRIBUTE_READBACK_INVALID"
  | "SMARTSTORE_CATEGORY_ATTRIBUTE_READBACK_DIGEST_MISMATCH"
  | "SMARTSTORE_CATEGORY_ATTRIBUTE_MAPPING_INVALID"
  | "SMARTSTORE_CATEGORY_ATTRIBUTE_BODY_MISMATCH"
  | "SMARTSTORE_CATEGORY_ATTRIBUTE_STALE"
  | "SMARTSTORE_CATEGORY_ATTRIBUTE_CROSS_CATEGORY"
  | "SMARTSTORE_CATEGORY_ATTRIBUTE_SELECTION_INVALID"
  | "SMARTSTORE_CATEGORY_ATTRIBUTE_CLASSIFICATION_UNSUPPORTED"
  | "SMARTSTORE_CATEGORY_ATTRIBUTE_VALUE_INVALID"
  | "SMARTSTORE_CATEGORY_ATTRIBUTE_DUPLICATE_PAIR"
  | "SMARTSTORE_CATEGORY_ATTRIBUTE_REQUIRED_MISSING"
  | "SMARTSTORE_CATEGORY_ATTRIBUTE_TOO_MANY_VALUES"
  | "SMARTSTORE_CATEGORY_ATTRIBUTE_REAL_VALUE_INVALID"
  | "SMARTSTORE_CATEGORY_ATTRIBUTE_UNKNOWN_UNIT";

export type SmartstoreCategoryAttributeBlocker = {
  contract: typeof smartstoreCategoryAttributeBlockerContract;
  code: SmartstoreCategoryAttributeBlockerCode;
  fieldPath: string;
  message: string;
  assignmentBinding: {
    categoryId: string | null;
    revision: number | null;
    digest: string | null;
  };
  officialBinding: {
    categoryId: string | null;
    assignmentRevision: number | null;
    assignmentDigest: string | null;
    digest: string | null;
  };
  providerMutationAllowed: false;
  providerMutationCounts: { create: 0; put: 0 };
};

export type SmartstoreCategoryAttributeMappingResult =
  | {
      ok: true;
      contract: typeof smartstoreCategoryAttributeMappingContract;
      categoryId: string;
      assignmentRevision: number;
      assignmentDigest: string;
      officialReadbackDigest: string;
      productAttributes: SmartstoreProductAttribute[];
      productAttributesSha256: string;
    }
  | { ok: false; blocker: SmartstoreCategoryAttributeBlocker };

export type SmartstoreCategoryAttributeBodyBindingResult =
  | {
      ok: true;
      body: Record<string, unknown>;
      mapping: Extract<SmartstoreCategoryAttributeMappingResult, { ok: true }>;
    }
  | { ok: false; blocker: SmartstoreCategoryAttributeBlocker };

export type SmartstoreCategoryAttributeCreateBindingResult =
  | {
      ok: true;
      mapping: Extract<SmartstoreCategoryAttributeMappingResult, { ok: true }>;
    }
  | { ok: false; blocker: SmartstoreCategoryAttributeBlocker };

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function collection(value: unknown) {
  if (Array.isArray(value)) return value;
  const wrapper = record(value);
  for (const key of ["items", "contents", "data"]) {
    if (Array.isArray(wrapper[key])) return wrapper[key] as unknown[];
  }
  return [];
}

function hasCollection(value: unknown) {
  if (Array.isArray(value)) return true;
  const wrapper = record(value);
  return ["items", "contents", "data"].some((key) => Array.isArray(wrapper[key]));
}

function canonicalTextCompare(left: string, right: string) {
  // PostgreSQL COLLATE "C" compares UTF-8 bytes. JavaScript's relational
  // comparison uses UTF-16 code units and reverses some astral/BMP pairs
  // (for example emoji versus U+E000), producing a different digest.
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as UnknownRecord)
      .sort(([left], [right]) => canonicalTextCompare(left, right))
      .map(([key, child]) => [key, canonical(child)]),
  );
}

function digest(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)), "utf8")
    .digest("hex");
}

function sortedRecords(value: unknown) {
  return collection(value)
    .map((item) => structuredClone(record(item)))
    .sort((left, right) =>
      canonicalTextCompare(
        JSON.stringify(canonical(left)),
        JSON.stringify(canonical(right)),
      ));
}

export function smartstoreProductAttributesDigest(value: unknown) {
  return digest(sortedRecords(value));
}

function positiveInteger(value: unknown) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^[1-9]\d*$/u.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function bindingText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function blocker(
  code: SmartstoreCategoryAttributeBlockerCode,
  fieldPath: string,
  message: string,
  assignment: Partial<SmartstoreCategoryAttributeAssignment>,
  official: Partial<SmartstoreCategoryAttributeOfficialReadback>,
): Extract<SmartstoreCategoryAttributeMappingResult, { ok: false }> {
  return {
    ok: false,
    blocker: {
      contract: smartstoreCategoryAttributeBlockerContract,
      code,
      fieldPath,
      message,
      assignmentBinding: {
        categoryId: bindingText(assignment.categoryId),
        revision: positiveInteger(assignment.revision),
        digest: bindingText(assignment.digest),
      },
      officialBinding: {
        categoryId: bindingText(official.categoryId),
        assignmentRevision: positiveInteger(official.assignmentRevision),
        assignmentDigest: bindingText(official.assignmentDigest),
        digest: bindingText(official.digest),
      },
      providerMutationAllowed: false,
      providerMutationCounts: { create: 0, put: 0 },
    },
  };
}

function assignmentProjection(
  assignment: Omit<SmartstoreCategoryAttributeAssignment, "digest">,
) {
  return {
    contract: assignment.contract,
    channel: assignment.channel,
    operation: assignment.operation,
    environment: assignment.environment,
    market: assignment.market,
    status: assignment.status,
    categoryId: assignment.categoryId,
    revision: assignment.revision,
    providedAttributes: sortedRecords(assignment.providedAttributes),
  };
}

export function smartstoreCategoryAttributeAssignmentDigest(
  assignment: Omit<SmartstoreCategoryAttributeAssignment, "digest">,
) {
  return digest(assignmentProjection(assignment));
}

function officialProjection(
  readback: Omit<SmartstoreCategoryAttributeOfficialReadback, "digest">,
) {
  return {
    contract: readback.contract,
    categoryId: readback.categoryId,
    assignmentRevision: readback.assignmentRevision,
    assignmentDigest: readback.assignmentDigest,
    category: canonical(structuredClone(readback.category)),
    attributes: sortedRecords(readback.attributes),
    attributeValues: sortedRecords(readback.attributeValues),
    attributeValueUnits: sortedRecords(readback.attributeValueUnits),
  };
}

export function smartstoreCategoryAttributeOfficialReadbackDigest(
  readback: Omit<SmartstoreCategoryAttributeOfficialReadback, "digest">,
) {
  return digest(officialProjection(readback));
}

function primaryAttribute(value: UnknownRecord) {
  return String(value.attributeType ?? "").trim().toUpperCase() === "PRIMARY"
    || value.required === true
    || value.mandatory === true;
}

function classification(value: UnknownRecord) {
  return String(value.attributeClassificationType ?? "").trim().toUpperCase();
}

function realValueParts(value: string) {
  if (!/^\d+(?:\.\d+)?(?:[~x]\d+(?:\.\d+)?)?$/u.test(value)) return null;
  return value.split(/[~x]/u).map(Number);
}

function rangeContains(value: string, range: UnknownRecord) {
  const parts = realValueParts(value);
  if (!parts) return false;
  const minText = String(range.minAttributeValue ?? "").trim();
  const maxText = String(range.maxAttributeValue ?? "").trim();
  const minimum = /^\d+(?:\.\d+)?$/u.test(minText) ? Number(minText) : null;
  const maximum = /^\d+(?:\.\d+)?$/u.test(maxText) ? Number(maxText) : null;
  return parts.every((part) =>
    Number.isFinite(part)
      && (minimum === null || part >= minimum)
      && (maximum === null || part <= maximum));
}

/**
 * Converts one exact confirmed SmartStore assignment into the provider-native
 * productAttributes array. It is deliberately pure: every invalid/stale
 * input returns a structured pre-provider blocker with CREATE=0 and PUT=0.
 */
export function buildSmartstoreCategoryProductAttributes(input: {
  assignment: SmartstoreCategoryAttributeAssignment;
  officialReadback: SmartstoreCategoryAttributeOfficialReadback;
}): SmartstoreCategoryAttributeMappingResult {
  const assignment = input.assignment ?? {} as SmartstoreCategoryAttributeAssignment;
  const official = input.officialReadback ?? {} as SmartstoreCategoryAttributeOfficialReadback;
  const categoryId = bindingText(assignment.categoryId);
  const revision = positiveInteger(assignment.revision);
  if (assignment.contract !== smartstoreCategoryAttributeAssignmentContract
      || assignment.channel !== "smartstore"
      || assignment.operation !== "listing.create"
      || !["production", "sandbox"].includes(assignment.environment)
      || assignment.market !== "KR"
      || !categoryId
      || !revision
      || !Array.isArray(assignment.providedAttributes)) {
    return blocker("SMARTSTORE_CATEGORY_ASSIGNMENT_INVALID", "assignment", "SmartStore 신규 CREATE용 category assignment 형식이 올바르지 않습니다.", assignment, official);
  }
  if (assignment.status !== "confirmed") {
    return blocker("SMARTSTORE_CATEGORY_ASSIGNMENT_NOT_CONFIRMED", "assignment.status", "확정되지 않은 category assignment입니다.", assignment, official);
  }
  const expectedAssignmentDigest = smartstoreCategoryAttributeAssignmentDigest(assignment);
  if (!/^[a-f0-9]{64}$/u.test(assignment.digest)
      || assignment.digest !== expectedAssignmentDigest) {
    return blocker("SMARTSTORE_CATEGORY_ASSIGNMENT_DIGEST_MISMATCH", "assignment.digest", "category assignment 원문과 digest가 일치하지 않습니다.", assignment, official);
  }
  if (official.contract !== smartstoreCategoryAttributeOfficialReadbackContract
      || !bindingText(official.categoryId)
      || !positiveInteger(official.assignmentRevision)
      || !bindingText(official.assignmentDigest)
      || !hasCollection(official.attributes)
      || !hasCollection(official.attributeValues)
      || !hasCollection(official.attributeValueUnits)) {
    return blocker("SMARTSTORE_CATEGORY_ATTRIBUTE_READBACK_INVALID", "officialReadback", "Naver category attribute 공식 조회 형식이 올바르지 않습니다.", assignment, official);
  }
  const expectedOfficialDigest = smartstoreCategoryAttributeOfficialReadbackDigest(official);
  if (!/^[a-f0-9]{64}$/u.test(official.digest)
      || official.digest !== expectedOfficialDigest) {
    return blocker("SMARTSTORE_CATEGORY_ATTRIBUTE_READBACK_DIGEST_MISMATCH", "officialReadback.digest", "Naver 공식 조회 원문과 digest가 일치하지 않습니다.", assignment, official);
  }
  if (official.categoryId !== categoryId) {
    return blocker("SMARTSTORE_CATEGORY_ATTRIBUTE_CROSS_CATEGORY", "officialReadback.categoryId", "assignment와 공식 조회의 categoryId가 다릅니다.", assignment, official);
  }
  if (official.assignmentRevision !== revision
      || official.assignmentDigest !== assignment.digest) {
    return blocker("SMARTSTORE_CATEGORY_ATTRIBUTE_STALE", "officialReadback.assignmentRevision", "현재 assignment revision/digest에 결속되지 않은 오래된 공식 조회입니다.", assignment, official);
  }
  const category = record(official.category);
  if (String(category.id ?? "").trim() !== categoryId || category.last !== true) {
    return blocker("SMARTSTORE_CATEGORY_ATTRIBUTE_CROSS_CATEGORY", "officialReadback.category", "공식 조회가 exact leaf category를 증명하지 않습니다.", assignment, official);
  }

  const attributeRows = sortedRecords(official.attributes);
  const valueRows = sortedRecords(official.attributeValues);
  const unitRows = sortedRecords(official.attributeValueUnits);
  const attributes = new Map<number, UnknownRecord>();
  for (const row of attributeRows) {
    const attributeSeq = positiveInteger(row.attributeSeq);
    const kind = classification(row);
    const attributeType = String(row.attributeType ?? "").trim().toUpperCase();
    const maximum = Number(row.attributeValueMaxMatchingCount);
    if (!attributeSeq
        || attributes.has(attributeSeq)
        || !["SINGLE_SELECT", "MULTI_SELECT", "RANGE"].includes(kind)
        || !["PRIMARY", "OPTIONAL"].includes(attributeType)
        || typeof row.unitUsable !== "boolean"
        || !Number.isSafeInteger(maximum)
        || maximum < 0) {
      return blocker("SMARTSTORE_CATEGORY_ATTRIBUTE_READBACK_INVALID", "officialReadback.attributes", "공식 속성의 ID, 분류, 유형, 단위 사용 여부 또는 최대 선택 수가 올바르지 않습니다.", assignment, official);
    }
    attributes.set(attributeSeq, row);
  }
  const values = new Map<string, UnknownRecord>();
  for (const row of valueRows) {
    const attributeSeq = positiveInteger(row.attributeSeq);
    const attributeValueSeq = positiveInteger(row.attributeValueSeq);
    const key = `${attributeSeq}:${attributeValueSeq}`;
    if (!attributeSeq || !attributeValueSeq || values.has(key)) {
      return blocker("SMARTSTORE_CATEGORY_ATTRIBUTE_READBACK_INVALID", "officialReadback.attributeValues", "공식 속성값 ID가 없거나 중복됐습니다.", assignment, official);
    }
    if (!attributes.has(attributeSeq)) {
      return blocker("SMARTSTORE_CATEGORY_ATTRIBUTE_CROSS_CATEGORY", "officialReadback.attributeValues", "공식 속성값이 exact category의 속성 목록에 속하지 않습니다.", assignment, official);
    }
    values.set(key, row);
  }
  const units = new Set<string>();
  for (const row of unitRows) {
    const id = String(row.id ?? "").trim();
    if (!/^A\d{5}$/u.test(id) || units.has(id)) {
      return blocker("SMARTSTORE_CATEGORY_ATTRIBUTE_READBACK_INVALID", "officialReadback.attributeValueUnits", "공식 단위 코드가 없거나 중복됐습니다.", assignment, official);
    }
    units.add(id);
  }

  const mapped: SmartstoreProductAttribute[] = [];
  const seenPairs = new Set<string>();
  const countByAttribute = new Map<number, number>();
  for (let index = 0; index < assignment.providedAttributes.length; index += 1) {
    const selection = record(assignment.providedAttributes[index]);
    const attributeSeq = positiveInteger(selection.attributeSeq);
    const attributeValueSeq = positiveInteger(selection.attributeValueSeq);
    if (!attributeSeq || !attributeValueSeq
        || Object.keys(selection).some((key) => ![
          "attributeSeq",
          "attributeValueSeq",
          "attributeRealValue",
          "attributeRealValueUnitCode",
        ].includes(key))) {
      return blocker("SMARTSTORE_CATEGORY_ATTRIBUTE_SELECTION_INVALID", `assignment.providedAttributes.${index}`, "상품 속성 선택 형식이 올바르지 않습니다.", assignment, official);
    }
    const pair = `${attributeSeq}:${attributeValueSeq}`;
    if (seenPairs.has(pair)) {
      return blocker("SMARTSTORE_CATEGORY_ATTRIBUTE_DUPLICATE_PAIR", `assignment.providedAttributes.${index}`, "같은 attributeSeq/valueSeq 조합이 중복됐습니다.", assignment, official);
    }
    seenPairs.add(pair);
    const attribute = attributes.get(attributeSeq);
    const value = values.get(pair);
    if (!attribute || !value) {
      return blocker("SMARTSTORE_CATEGORY_ATTRIBUTE_CROSS_CATEGORY", `assignment.providedAttributes.${index}`, "선택한 속성 또는 속성값이 exact category 공식 조회에 없습니다.", assignment, official);
    }
    const kind = classification(attribute);
    if (!["SINGLE_SELECT", "MULTI_SELECT", "RANGE"].includes(kind)) {
      return blocker("SMARTSTORE_CATEGORY_ATTRIBUTE_CLASSIFICATION_UNSUPPORTED", `officialReadback.attributes.${attributeSeq}`, "지원하지 않는 Naver 속성 분류입니다.", assignment, official);
    }
    const realValue = typeof selection.attributeRealValue === "string"
      ? selection.attributeRealValue.trim()
      : "";
    const unitCode = typeof selection.attributeRealValueUnitCode === "string"
      ? selection.attributeRealValueUnitCode.trim()
      : "";
    const hasRealValue = Object.hasOwn(selection, "attributeRealValue");
    const hasUnitCode = Object.hasOwn(selection, "attributeRealValueUnitCode");
    if (kind !== "RANGE" && (hasRealValue || hasUnitCode)) {
      return blocker("SMARTSTORE_CATEGORY_ATTRIBUTE_VALUE_INVALID", `assignment.providedAttributes.${index}`, "SELECT 속성에는 RANGE 실제 값이나 단위를 넣을 수 없습니다.", assignment, official);
    }
    if (kind === "RANGE") {
      if (!realValue || !rangeContains(realValue, value)) {
        return blocker("SMARTSTORE_CATEGORY_ATTRIBUTE_REAL_VALUE_INVALID", `assignment.providedAttributes.${index}.attributeRealValue`, "RANGE 실제 값이 숫자 형식이 아니거나 선택한 공식 범례 밖입니다.", assignment, official);
      }
      const unitUsable = attribute.unitUsable === true;
      if (unitUsable && (!unitCode || !units.has(unitCode))) {
        return blocker("SMARTSTORE_CATEGORY_ATTRIBUTE_UNKNOWN_UNIT", `assignment.providedAttributes.${index}.attributeRealValueUnitCode`, "RANGE 단위가 없거나 공식 전체 단위 조회에 없습니다.", assignment, official);
      }
      if (!unitUsable && hasUnitCode) {
        return blocker("SMARTSTORE_CATEGORY_ATTRIBUTE_UNKNOWN_UNIT", `assignment.providedAttributes.${index}.attributeRealValueUnitCode`, "단위를 지원하지 않는 RANGE 속성에 단위가 입력됐습니다.", assignment, official);
      }
      const rangeUnits = new Set([
        value.minAttributeValueUnitCode,
        value.maxAttributeValueUnitCode,
        attribute.representativeUnitCode,
      ].map((item) => String(item ?? "").trim()).filter(Boolean));
      if (unitCode && rangeUnits.size > 0 && !rangeUnits.has(unitCode)) {
        return blocker("SMARTSTORE_CATEGORY_ATTRIBUTE_UNKNOWN_UNIT", `assignment.providedAttributes.${index}.attributeRealValueUnitCode`, "RANGE 단위가 선택한 공식 범례와 일치하지 않습니다.", assignment, official);
      }
    }
    countByAttribute.set(attributeSeq, (countByAttribute.get(attributeSeq) ?? 0) + 1);
    mapped.push({
      attributeSeq,
      attributeValueSeq,
      ...(kind === "RANGE" ? { attributeRealValue: realValue } : {}),
      ...(kind === "RANGE" && unitCode
        ? { attributeRealValueUnitCode: unitCode }
        : {}),
    });
  }

  for (const [attributeSeq, attribute] of attributes) {
    const count = countByAttribute.get(attributeSeq) ?? 0;
    if (primaryAttribute(attribute) && count === 0) {
      return blocker("SMARTSTORE_CATEGORY_ATTRIBUTE_REQUIRED_MISSING", `assignment.providedAttributes.${attributeSeq}`, "Naver PRIMARY 속성의 선택값이 없습니다.", assignment, official);
    }
    const kind = classification(attribute);
    if ((kind === "SINGLE_SELECT" || kind === "RANGE") && count > 1) {
      return blocker("SMARTSTORE_CATEGORY_ATTRIBUTE_TOO_MANY_VALUES", `assignment.providedAttributes.${attributeSeq}`, "단일 선택 또는 RANGE 속성에 여러 값이 입력됐습니다.", assignment, official);
    }
    const maximum = Number(attribute.attributeValueMaxMatchingCount);
    if (kind === "MULTI_SELECT" && Number.isSafeInteger(maximum) && maximum > 0 && count > maximum) {
      return blocker("SMARTSTORE_CATEGORY_ATTRIBUTE_TOO_MANY_VALUES", `assignment.providedAttributes.${attributeSeq}`, "복수 선택 속성의 공식 최대 개수를 초과했습니다.", assignment, official);
    }
  }

  const productAttributes = mapped.sort((left, right) =>
    left.attributeSeq - right.attributeSeq
      || left.attributeValueSeq - right.attributeValueSeq);
  return {
    ok: true,
    contract: smartstoreCategoryAttributeMappingContract,
    categoryId,
    assignmentRevision: revision,
    assignmentDigest: assignment.digest,
    officialReadbackDigest: official.digest,
    productAttributes,
    productAttributesSha256: smartstoreProductAttributesDigest(productAttributes),
  };
}

/** Bind only a verified mapping to a cloned new-CREATE body. */
export function bindSmartstoreCategoryProductAttributes(input: {
  body: Record<string, unknown>;
  mapping: SmartstoreCategoryAttributeMappingResult;
  assignment: SmartstoreCategoryAttributeAssignment;
  officialReadback: SmartstoreCategoryAttributeOfficialReadback;
}): SmartstoreCategoryAttributeBodyBindingResult {
  if (!input.mapping.ok) return input.mapping;
  const body = structuredClone(input.body);
  const originProduct = record(body.originProduct);
  if (String(originProduct.leafCategoryId ?? "").trim() !== input.mapping.categoryId) {
    return blocker(
      "SMARTSTORE_CATEGORY_ATTRIBUTE_CROSS_CATEGORY",
      "body.originProduct.leafCategoryId",
      "CREATE body와 검증된 category attribute mapping의 categoryId가 다릅니다.",
      input.assignment,
      input.officialReadback,
    );
  }
  const detailAttribute = record(originProduct.detailAttribute);
  detailAttribute.productAttributes = structuredClone(input.mapping.productAttributes);
  originProduct.detailAttribute = detailAttribute;
  body.originProduct = originProduct;
  return { ok: true, body, mapping: input.mapping };
}

/**
 * Final new-CREATE boundary. The route may carry only the verified mapping
 * receipt, so bind it to the exact body again before token acquisition. The
 * current DB revision/digest still has to be checked by the central source
 * fence; this function proves receipt integrity and body continuity.
 */
export function verifySmartstoreCategoryAttributeCreateBinding(input: {
  body: unknown;
  mapping: unknown;
}): SmartstoreCategoryAttributeCreateBindingResult {
  const mapping = record(input.mapping);
  const categoryId = bindingText(mapping.categoryId);
  const revision = positiveInteger(mapping.assignmentRevision);
  const assignmentDigest = bindingText(mapping.assignmentDigest);
  const officialDigest = bindingText(mapping.officialReadbackDigest);
  const productAttributesSha256 = bindingText(mapping.productAttributesSha256);
  const pseudoAssignment: Partial<SmartstoreCategoryAttributeAssignment> = {
    categoryId: categoryId ?? undefined,
    revision: revision ?? undefined,
    digest: assignmentDigest ?? undefined,
  };
  const pseudoOfficial: Partial<SmartstoreCategoryAttributeOfficialReadback> = {
    categoryId: categoryId ?? undefined,
    assignmentRevision: revision ?? undefined,
    assignmentDigest: assignmentDigest ?? undefined,
    digest: officialDigest ?? undefined,
  };
  if (mapping.ok !== true
      || mapping.contract !== smartstoreCategoryAttributeMappingContract
      || !categoryId
      || !revision
      || !assignmentDigest
      || !officialDigest
      || !productAttributesSha256
      || !/^[a-f0-9]{64}$/u.test(assignmentDigest)
      || !/^[a-f0-9]{64}$/u.test(officialDigest)
      || !/^[a-f0-9]{64}$/u.test(productAttributesSha256)
      || !Array.isArray(mapping.productAttributes)) {
    return blocker(
      "SMARTSTORE_CATEGORY_ATTRIBUTE_MAPPING_INVALID",
      "sellerpilotSmartstoreCategoryAttributeMapping",
      "검증된 SmartStore category attribute mapping receipt가 없습니다.",
      pseudoAssignment,
      pseudoOfficial,
    );
  }
  const seenPairs = new Set<string>();
  for (let index = 0; index < mapping.productAttributes.length; index += 1) {
    const attribute = record(mapping.productAttributes[index]);
    const attributeSeq = positiveInteger(attribute.attributeSeq);
    const attributeValueSeq = positiveInteger(attribute.attributeValueSeq);
    const pair = `${attributeSeq}:${attributeValueSeq}`;
    const realValue = typeof attribute.attributeRealValue === "string"
      ? attribute.attributeRealValue.trim()
      : "";
    const unitCode = typeof attribute.attributeRealValueUnitCode === "string"
      ? attribute.attributeRealValueUnitCode.trim()
      : "";
    const hasRealValue = Object.hasOwn(attribute, "attributeRealValue");
    const hasUnitCode = Object.hasOwn(attribute, "attributeRealValueUnitCode");
    if (!attributeSeq
        || !attributeValueSeq
        || seenPairs.has(pair)
        || Object.keys(attribute).some((key) => ![
          "attributeSeq",
          "attributeValueSeq",
          "attributeRealValue",
          "attributeRealValueUnitCode",
        ].includes(key))
        || (hasUnitCode && !hasRealValue)
        || (hasRealValue && !realValueParts(realValue))
        || (hasUnitCode && !/^A\d{5}$/u.test(unitCode))) {
      return blocker(
        "SMARTSTORE_CATEGORY_ATTRIBUTE_MAPPING_INVALID",
        `sellerpilotSmartstoreCategoryAttributeMapping.productAttributes.${index}`,
        "mapping receipt의 provider-native 상품 속성 형식이 올바르지 않습니다.",
        pseudoAssignment,
        pseudoOfficial,
      );
    }
    seenPairs.add(pair);
  }
  if (smartstoreProductAttributesDigest(mapping.productAttributes)
      !== productAttributesSha256) {
    return blocker(
      "SMARTSTORE_CATEGORY_ATTRIBUTE_MAPPING_INVALID",
      "sellerpilotSmartstoreCategoryAttributeMapping.productAttributesSha256",
      "mapping receipt의 상품 속성 원문과 digest가 일치하지 않습니다.",
      pseudoAssignment,
      pseudoOfficial,
    );
  }
  const body = record(input.body);
  const originProduct = record(body.originProduct);
  const detailAttribute = record(originProduct.detailAttribute);
  if (String(originProduct.leafCategoryId ?? "").trim() !== categoryId
      || !Array.isArray(detailAttribute.productAttributes)
      || smartstoreProductAttributesDigest(detailAttribute.productAttributes)
        !== productAttributesSha256) {
    return blocker(
      "SMARTSTORE_CATEGORY_ATTRIBUTE_BODY_MISMATCH",
      "body.originProduct.detailAttribute.productAttributes",
      "CREATE body가 검증된 category attribute mapping receipt와 일치하지 않습니다.",
      pseudoAssignment,
      pseudoOfficial,
    );
  }
  return {
    ok: true,
    mapping: mapping as Extract<SmartstoreCategoryAttributeMappingResult, { ok: true }>,
  };
}
