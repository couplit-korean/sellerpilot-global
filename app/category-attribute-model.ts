import type { ActiveChannelKey } from "../lib/channels/catalog";

export type CategoryAttributeRequirement = "required" | "optional" | "one_of_group";
export type CategoryAttributeInputKind =
  | "text"
  | "single_select"
  | "multi_select"
  | "number"
  | "number_with_unit"
  | "boolean"
  | "repeatable_text"
  | "unsupported";
export type CategoryAttributeSourceKind = "attribute" | "notice" | "certification";
export type CategoryAttributeValue = string | string[];

export type CategoryAttributeOption = { id: string; name: string };
export type CategoryAttributeCondition = { attributeId: string; equals: string };

export type CategoryAttribute = {
  id: string;
  name: string;
  required: boolean;
  requirement: CategoryAttributeRequirement;
  values: CategoryAttributeOption[];
  mode: string | null;
  inputKind: CategoryAttributeInputKind;
  units: string[];
  groupId: string | null;
  repeatable: boolean;
  sourceKind: CategoryAttributeSourceKind;
  condition: CategoryAttributeCondition | null;
  unsupportedReason: string | null;
};

export type CategoryOfficialMetadata = {
  schemaVersion: "sellerpilot.category-input.v2";
  descriptors: CategoryAttribute[];
  unsupportedAttributeIds: string[];
  nativeCategoryMetadata: {
    attributes: Record<string, unknown>[];
    noticeCategories: Record<string, unknown>[];
    certifications: Record<string, unknown>[];
  };
};

export type CategoryInputIssue = {
  id: string;
  label: string;
  reason: "missing" | "invalid" | "unsupported" | "group_missing";
};

const explicitFreeTextModes = new Set(["FREE_TEXT", "TEXT", "TEXTAREA", "STRING", "INPUT"]);
const explicitSingleSelectModes = new Set(["SELECTION_ONLY", "SINGLE_SELECT", "SELECT", "DROPDOWN", "LIST"]);
const explicitMultiSelectModes = new Set(["MULTI_SELECT", "MULTIPLE_SELECT", "CHECKBOX", "CHECKBOXES"]);
const explicitNumberModes = new Set(["NUMBER", "NUMERIC", "DECIMAL", "INTEGER"]);
const explicitBooleanModes = new Set(["BOOLEAN", "BOOL"]);
const shopeeCustomValueInputTypes = new Set([2, 3, 5]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function records(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 8 || value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((item) => records(item, depth + 1));
  const row = record(value);
  if (!row) return [];
  return [row, ...Object.values(row).flatMap((item) => records(item, depth + 1))];
}

function text(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function explicitBoolean(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "1" || value === "Y" || value === "MANDATORY" || value === "MULTI") return true;
    if (value === 0 || value === "0" || value === "N" || value === "OPTIONAL" || value === "SINGLE") return false;
  }
  return null;
}

function uniqueText(values: unknown[]) {
  return [...new Set(values.flatMap((value) => {
    if (typeof value === "string" || typeof value === "number") {
      const normalized = String(value).trim();
      return normalized && normalized !== "없음" ? [normalized] : [];
    }
    return [];
  }))];
}

function optionRows(row: Record<string, unknown>) {
  const values = Array.isArray(row.options) ? row.options
    : Array.isArray(row.attribute_value_list) ? row.attribute_value_list
      : Array.isArray(row.attributeValues) ? row.attributeValues
        : Array.isArray(row.aspectValues) ? row.aspectValues
          : Array.isArray(row.values) ? row.values : [];
  const deduplicated = new Map<string, CategoryAttributeOption>();
  for (const item of values) {
    const option = record(item);
    const name = option
      ? text(option, ["display_value_name", "original_value_name", "name", "value", "localizedValue", "display_value", "en_name"])
      : typeof item === "string" || typeof item === "number" ? String(item).trim() : "";
    const id = option ? text(option, ["value_id", "id", "option_id"]) || name : name;
    if (id && name && !deduplicated.has(id)) deduplicated.set(id, { id, name });
  }
  return [...deduplicated.values()];
}

function attributeUnits(row: Record<string, unknown>) {
  const arrays = [row.usableUnits, row.units, row.unitList, row.attribute_unit_list]
    .filter(Array.isArray)
    .flatMap((value) => value as unknown[]);
  const basicUnit = text(row, ["basicUnit", "unit"]);
  return uniqueText([basicUnit, ...arrays]);
}

function isMultiple(row: Record<string, unknown>, constraint: Record<string, unknown>) {
  const explicit = explicitBoolean(row, ["is_multiple", "isMultiple", "multiple", "multi_value", "allowMultiple", "repeatable"]);
  if (explicit !== null) return explicit;
  return [
    constraint.itemToAspectCardinality,
    constraint.cardinality,
    row.cardinality,
    row.maxValueCount,
    row.max_value_count,
  ].some((value) => String(value ?? "").trim().toUpperCase() === "MULTI" || Number(value) > 1);
}

function inputKind(row: Record<string, unknown>, constraint: Record<string, unknown>, values: CategoryAttributeOption[], units: string[]) {
  const mode = text(constraint, ["aspectMode", "mode"])
    || text(row, ["mode", "inputType", "input_type", "valueType", "value_type", "dataType", "attributeType"]);
  const normalizedMode = mode.toUpperCase();
  const multiple = isMultiple(row, constraint);
  const shopeeInputType = Number(record(row.attribute_info)?.input_type);

  if (explicitBooleanModes.has(normalizedMode)) return { kind: "boolean" as const, mode: normalizedMode };
  if (explicitNumberModes.has(normalizedMode)) {
    return { kind: units.length ? "number_with_unit" as const : "number" as const, mode: normalizedMode };
  }
  if (explicitMultiSelectModes.has(normalizedMode)) {
    return { kind: values.length ? "multi_select" as const : "unsupported" as const, mode: normalizedMode };
  }
  if (explicitSingleSelectModes.has(normalizedMode)) {
    return { kind: multiple ? "multi_select" as const : "single_select" as const, mode: normalizedMode };
  }
  if (explicitFreeTextModes.has(normalizedMode)) {
    return { kind: multiple ? "repeatable_text" as const : "text" as const, mode: normalizedMode };
  }
  if (Number.isSafeInteger(shopeeInputType) && shopeeInputType > 0) {
    if (multiple && values.length) return { kind: "multi_select" as const, mode: `SHOPEE_INPUT_${shopeeInputType}` };
    if (shopeeCustomValueInputTypes.has(shopeeInputType)) {
      return { kind: multiple ? "repeatable_text" as const : "text" as const, mode: `SHOPEE_INPUT_${shopeeInputType}` };
    }
    return { kind: values.length ? "single_select" as const : "unsupported" as const, mode: `SHOPEE_INPUT_${shopeeInputType}` };
  }
  if (normalizedMode) return { kind: "unsupported" as const, mode: normalizedMode };
  if (multiple) return { kind: values.length ? "multi_select" as const : "repeatable_text" as const, mode: null };
  return { kind: values.length ? "single_select" as const : "text" as const, mode: null };
}

function standardAttribute(row: Record<string, unknown>): CategoryAttribute | null {
  const constraint = record(row.aspectConstraint) ?? {};
  const id = text(row, ["attribute_id", "attributeId", "attributeSeq", "attributeTypeName", "name", "localizedAspectName"]);
  const name = text(row, ["display_attribute_name", "original_attribute_name", "attributeName", "attributeTypeName", "label", "name", "localizedAspectName"]);
  const looksLikeAttribute = Boolean(
    row.attribute_id !== undefined || row.attributeSeq !== undefined || row.attributeTypeName !== undefined
    || row.localizedAspectName !== undefined || row.is_mandatory !== undefined || row.mandatory !== undefined,
  );
  if (!id || !name || !looksLikeAttribute) return null;
  const providerRequired = explicitBoolean(row, ["required", "mandatory", "is_mandatory", "isMandatory"]) === true
    || constraint.aspectRequired === true
    || row.attributeType === "PRIMARY";
  const rawGroup = text(row, ["groupNumber", "group_id", "groupId"]);
  const groupId = rawGroup && rawGroup.toUpperCase() !== "NONE" ? rawGroup : null;
  const requirement: CategoryAttributeRequirement = providerRequired
    ? groupId ? "one_of_group" : "required"
    : "optional";
  const values = optionRows(row);
  const units = attributeUnits(row);
  const inferred = inputKind(row, constraint, values, units);
  const exposed = text(row, ["exposed"]);
  const hidden = exposed && exposed.toUpperCase() !== "EXPOSED";
  const unsupportedReason = hidden
    ? `공식 메타가 ${exposed} 입력으로 표시했습니다.`
    : inferred.kind === "unsupported"
      ? `공식 입력 타입 ${inferred.mode ?? "unknown"}을 안전하게 편집할 수 없습니다.`
      : null;
  return {
    id,
    name,
    required: requirement === "required",
    requirement,
    values,
    mode: inferred.mode,
    inputKind: hidden ? "unsupported" : inferred.kind,
    units,
    groupId,
    repeatable: inferred.kind === "repeatable_text" || inferred.kind === "multi_select",
    sourceKind: "attribute",
    condition: null,
    unsupportedReason,
  };
}

function coupangMetadata(payloads: unknown[]) {
  const native = {
    attributes: [] as Record<string, unknown>[],
    noticeCategories: [] as Record<string, unknown>[],
    certifications: [] as Record<string, unknown>[],
  };
  for (const row of records({ payloads })) {
    for (const key of Object.keys(native) as Array<keyof typeof native>) {
      if (!Array.isArray(row[key])) continue;
      for (const item of row[key] as unknown[]) {
        const value = record(item);
        if (value && !native[key].some((existing) => JSON.stringify(existing) === JSON.stringify(value))) native[key].push(value);
      }
    }
  }
  return native;
}

function coupangNoticeAttributes(noticeCategories: Record<string, unknown>[]) {
  const viable = noticeCategories.flatMap((category) => {
    const name = text(category, ["noticeCategoryName"]);
    const details = Array.isArray(category.noticeCategoryDetailNames)
      ? category.noticeCategoryDetailNames.flatMap((item) => record(item) ? [record(item)!] : [])
      : [];
    return name && details.length ? [{ name, details }] : [];
  });
  if (!viable.length) return [];
  const categorySelector: CategoryAttribute = {
    id: "notice:category",
    name: "상품정보제공고시 분류",
    required: true,
    requirement: "required",
    values: viable.map(({ name }) => ({ id: name, name })),
    mode: "SELECTION_ONLY",
    inputKind: "single_select",
    units: [],
    groupId: null,
    repeatable: false,
    sourceKind: "notice",
    condition: null,
    unsupportedReason: null,
  };
  const details = viable.flatMap(({ name: categoryName, details: rows }) => rows.flatMap((detail) => {
    const detailName = text(detail, ["noticeCategoryDetailName"]);
    if (!detailName) return [];
    const required = explicitBoolean(detail, ["required", "mandatory"]) === true;
    return [{
      id: `notice:${categoryName}:${detailName}`,
      name: detailName,
      required,
      requirement: required ? "required" as const : "optional" as const,
      values: [],
      mode: "FREE_TEXT",
      inputKind: "text" as const,
      units: [],
      groupId: null,
      repeatable: false,
      sourceKind: "notice" as const,
      condition: { attributeId: categorySelector.id, equals: categoryName },
      unsupportedReason: null,
    }];
  }));
  return [categorySelector, ...details];
}

function coupangCertificationAttributes(certifications: Record<string, unknown>[]) {
  return certifications.flatMap((certification): CategoryAttribute[] => {
    const certificationType = text(certification, ["certificationType"]);
    if (!certificationType) return [];
    const required = explicitBoolean(certification, ["required", "mandatory"]) === true;
    const dataType = text(certification, ["dataType"]).toUpperCase();
    const supported = dataType === "CODE";
    return [{
      id: `certification:${certificationType}`,
      name: `${certificationType} 인증코드`,
      required,
      requirement: required ? "required" : "optional",
      values: [],
      mode: dataType || null,
      inputKind: supported ? "text" : "unsupported",
      units: [],
      groupId: null,
      repeatable: false,
      sourceKind: "certification",
      condition: null,
      unsupportedReason: supported ? null : `공식 인증 타입 ${dataType || "unknown"}은 코드 입력으로 확정할 수 없습니다.`,
    }];
  });
}

function deduplicateAttributes(attributes: CategoryAttribute[]) {
  const deduplicated = new Map<string, CategoryAttribute>();
  for (const attribute of attributes) {
    if (!deduplicated.has(attribute.id)) deduplicated.set(attribute.id, attribute);
  }
  return [...deduplicated.values()].sort((left, right) => {
    const priority = (attribute: CategoryAttribute) => attribute.requirement === "required" ? 0
      : attribute.requirement === "one_of_group" ? 1
        : attribute.inputKind === "unsupported" ? 3 : 2;
    return priority(left) - priority(right) || left.name.localeCompare(right.name);
  });
}

export function normalizeCategoryMetadata(channel: ActiveChannelKey, payloads: unknown[]): CategoryOfficialMetadata {
  const native = channel === "coupang"
    ? coupangMetadata(payloads)
    : { attributes: [], noticeCategories: [], certifications: [] };
  const standardRows = channel === "coupang" ? native.attributes : records({ payloads });
  const attributes = deduplicateAttributes([
    ...standardRows.flatMap((row) => {
      const normalized = standardAttribute(row);
      return normalized ? [normalized] : [];
    }),
    ...(channel === "coupang" ? coupangNoticeAttributes(native.noticeCategories) : []),
    ...(channel === "coupang" ? coupangCertificationAttributes(native.certifications) : []),
  ]);
  return {
    schemaVersion: "sellerpilot.category-input.v2",
    descriptors: attributes,
    unsupportedAttributeIds: attributes.filter((attribute) => attribute.inputKind === "unsupported").map((attribute) => attribute.id),
    nativeCategoryMetadata: native,
  };
}

function strings(value: CategoryAttributeValue | undefined) {
  return (Array.isArray(value) ? value : [value])
    .flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []);
}

export function categoryAttributeApplies(attribute: CategoryAttribute, values: Record<string, CategoryAttributeValue>) {
  if (!attribute.condition) return true;
  return strings(values[attribute.condition.attributeId]).includes(attribute.condition.equals);
}

export function categoryAttributeValueValid(attribute: CategoryAttribute, value: CategoryAttributeValue | undefined) {
  const supplied = strings(value);
  if (!supplied.length) return false;
  if (attribute.inputKind === "unsupported") return false;
  if (attribute.inputKind === "single_select") return supplied.length === 1 && attribute.values.some((option) => option.id === supplied[0]);
  if (attribute.inputKind === "multi_select") return supplied.every((item) => attribute.values.some((option) => option.id === item));
  if (attribute.inputKind === "boolean") return supplied.length === 1 && ["true", "false"].includes(supplied[0]);
  if (attribute.inputKind === "number") return supplied.length === 1 && /^[-+]?\d+(?:\.\d+)?$/u.test(supplied[0]);
  if (attribute.inputKind === "number_with_unit") {
    const match = supplied.length === 1 ? supplied[0].match(/^([-+]?\d+(?:\.\d+)?)\s*(\S+)$/u) : null;
    return Boolean(match && attribute.units.includes(match[2]));
  }
  if (attribute.inputKind === "text") return supplied.length === 1;
  return supplied.length >= 1;
}

export function missingCategoryInputIssues(attributes: CategoryAttribute[], values: Record<string, CategoryAttributeValue>) {
  const issues: CategoryInputIssue[] = [];
  const applicable = attributes.filter((attribute) => categoryAttributeApplies(attribute, values));
  for (const attribute of applicable) {
    if (attribute.requirement !== "required") continue;
    const supplied = strings(values[attribute.id]);
    if (!supplied.length) issues.push({ id: attribute.id, label: attribute.name, reason: "missing" });
    else if (attribute.inputKind === "unsupported") issues.push({ id: attribute.id, label: attribute.name, reason: "unsupported" });
    else if (!categoryAttributeValueValid(attribute, values[attribute.id])) issues.push({ id: attribute.id, label: attribute.name, reason: "invalid" });
  }
  const groups = new Map<string, CategoryAttribute[]>();
  for (const attribute of applicable.filter((item) => item.requirement === "one_of_group" && item.groupId)) {
    groups.set(attribute.groupId!, [...(groups.get(attribute.groupId!) ?? []), attribute]);
  }
  for (const [groupId, group] of groups) {
    if (!group.some((attribute) => categoryAttributeValueValid(attribute, values[attribute.id]))) {
      issues.push({ id: `group:${groupId}`, label: group.map((attribute) => attribute.name).join(" 또는 "), reason: "group_missing" });
    }
  }
  return issues;
}

export function serializeCategoryAttributeValues(
  channel: ActiveChannelKey,
  attributes: CategoryAttribute[],
  values: Record<string, CategoryAttributeValue>,
) {
  return Object.fromEntries(attributes.flatMap((attribute) => {
    if (!categoryAttributeApplies(attribute, values) || attribute.inputKind === "unsupported") return [];
    const supplied = strings(values[attribute.id]);
    if (!supplied.length) return [];
    const serialized = channel === "lazada"
      ? supplied.map((item) => attribute.values.find((option) => option.id === item)?.name ?? item)
      : supplied;
    return [[attribute.id, attribute.repeatable || attribute.inputKind === "multi_select" ? serialized : serialized[0]]];
  }));
}

export function assignmentCategoryAttributeDescriptors(
  attributes: CategoryAttribute[],
  values: Record<string, CategoryAttributeValue>,
) {
  return attributes.map((attribute) => ({
    ...attribute,
    // The current RPC understands only a flat `required` boolean. Preserve the
    // full requirement/condition contract, while marking only an applicable
    // required field or the selected member of a one-of group as DB-required.
    required: categoryAttributeApplies(attribute, values) && (
      attribute.requirement === "required"
      || (attribute.requirement === "one_of_group" && categoryAttributeValueValid(attribute, values[attribute.id]))
    ),
  }));
}

function fact(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const normalized = String(value).trim();
  return /^(?:unknown|not provided|n\/a|tbd|미정|미확인|확인 필요)$/iu.test(normalized) ? "" : normalized;
}

function firstNamedFact(productFacts: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = fact(productFacts[key]);
    if (value) return value;
  }
  return "";
}

function producerAndLocationFact(productFacts: Record<string, unknown>) {
  const combined = firstNamedFact(productFacts, ["producerAndLocation", "manufacturerAndLocation"]);
  if (combined) return combined;
  const producer = firstNamedFact(productFacts, ["producer", "manufacturer"]);
  const location = firstNamedFact(productFacts, ["producerAddress", "manufacturerAddress"]);
  return producer && location ? `${producer}, ${location}` : "";
}

export function suggestedCategoryAttributeValues(attributes: CategoryAttribute[], productFacts: Record<string, unknown>) {
  const result: Record<string, CategoryAttributeValue> = {};
  const candidate = (attribute: CategoryAttribute) => {
    const name = attribute.name.toLocaleLowerCase().replace(/\s+/gu, "");
    if (attribute.id === "notice:category" && attribute.values.length === 1) return attribute.values[0]?.id ?? "";
    if (/(영양성분|영양정보|nutritionfacts?|nutritionalinformation)/u.test(name)) {
      return firstNamedFact(productFacts, ["nutritionFacts", "nutritionInformation"]);
    }
    if (/(생산자.*소재지|제조자.*소재지|제조사.*소재지|생산자.*주소|제조자.*주소|제조사.*주소|producer.*(?:location|address)|manufacturer.*(?:location|address))/u.test(name)) {
      return producerAndLocationFact(productFacts);
    }
    if (/(소재지|사업장주소|생산지주소)/u.test(name)) {
      return firstNamedFact(productFacts, ["producerAddress", "manufacturerAddress"]);
    }
    if (/(brand|브랜드|상표)/u.test(name)) return fact(productFacts.brandName);
    if (/(manufacturer|producer|제조사|제조자|생산자|공급자)/u.test(name)) return fact(productFacts.manufacturer);
    if (/(country.*manufacture|원산지|제조국)/u.test(name)) return fact(productFacts.countryOfOrigin);
    if (/(material|소재|재질|원재료|성분)/u.test(name)) return fact(productFacts.material);
    if (/(seller.*sku|판매자.*상품코드|모델번호)/u.test(name)) return fact(productFacts.sellerSku);
    if (/(productname|상품명|제품명)/u.test(name)) return fact(productFacts.productName);
    if (/(총?수량|개수|구성수)/u.test(name)) return fact(productFacts.packageContents);
    return "";
  };
  for (const attribute of attributes) {
    const value = candidate(attribute);
    if (!value || attribute.inputKind === "unsupported") continue;
    if (attribute.inputKind === "single_select") {
      const option = attribute.values.find((item) => item.id === value || item.name.toLocaleLowerCase() === value.toLocaleLowerCase());
      if (option) result[attribute.id] = option.id;
      continue;
    }
    if (categoryAttributeValueValid(attribute, value)) result[attribute.id] = value;
  }
  return result;
}

export function normalizeStoredCategoryAttribute(value: unknown): CategoryAttribute | null {
  const row = record(value);
  if (!row) return null;
  const id = text(row, ["id", "name"]);
  const name = text(row, ["name", "id"]);
  if (!id || !name) return null;
  const normalized = standardAttribute({ ...row, name, attribute_id: id });
  if (!normalized) return null;
  const input = text(row, ["inputKind"]);
  const requirement = text(row, ["requirement"]) as CategoryAttributeRequirement;
  return {
    ...normalized,
    ...(input && ["text", "single_select", "multi_select", "number", "number_with_unit", "boolean", "repeatable_text", "unsupported"].includes(input)
      ? { inputKind: input as CategoryAttributeInputKind }
      : {}),
    ...(requirement && ["required", "optional", "one_of_group"].includes(requirement)
      ? { requirement, required: requirement === "required" }
      : {}),
    units: Array.isArray(row.units) ? uniqueText(row.units) : normalized.units,
    groupId: typeof row.groupId === "string" && row.groupId.trim() ? row.groupId.trim() : normalized.groupId,
    repeatable: typeof row.repeatable === "boolean" ? row.repeatable : normalized.repeatable,
    sourceKind: ["attribute", "notice", "certification"].includes(String(row.sourceKind))
      ? row.sourceKind as CategoryAttributeSourceKind
      : normalized.sourceKind,
    condition: record(row.condition) && text(record(row.condition)!, ["attributeId"]) && text(record(row.condition)!, ["equals"])
      ? { attributeId: text(record(row.condition)!, ["attributeId"]), equals: text(record(row.condition)!, ["equals"]) }
      : null,
    unsupportedReason: typeof row.unsupportedReason === "string" && row.unsupportedReason.trim() ? row.unsupportedReason.trim() : normalized.unsupportedReason,
  };
}

export function compatibleCategoryValues(
  previousAttributes: CategoryAttribute[],
  nextAttributes: CategoryAttribute[],
  values: Record<string, CategoryAttributeValue>,
) {
  const previousById = new Map(previousAttributes.map((attribute) => [attribute.id, attribute]));
  const accepted: Record<string, CategoryAttributeValue> = {};
  const isolated: Record<string, CategoryAttributeValue> = {};
  for (const [id, value] of Object.entries(values)) {
    const previous = previousById.get(id);
    const next = nextAttributes.find((attribute) => attribute.id === id);
    const sameContract = previous && next
      && previous.inputKind === next.inputKind
      && previous.sourceKind === next.sourceKind
      && JSON.stringify(previous.units) === JSON.stringify(next.units);
    if (sameContract && categoryAttributeValueValid(next, value)) accepted[id] = value;
    else isolated[id] = value;
  }
  return { accepted, isolated };
}
