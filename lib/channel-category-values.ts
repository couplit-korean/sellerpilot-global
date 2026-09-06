export type ChannelCategoryValue = string | string[];

type ShopeeCategoryAttributeDescriptor = {
  id?: unknown;
  attribute_id?: unknown;
  inputKind?: unknown;
  values?: unknown;
};

const shopeeTextInputKinds = new Set([
  "text",
  "repeatable_text",
  "number",
  "number_with_unit",
  "boolean",
]);
const shopeeSelectionInputKinds = new Set(["single_select", "multi_select"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function descriptorId(value: ShopeeCategoryAttributeDescriptor) {
  const id = value.id ?? value.attribute_id;
  return typeof id === "string" || typeof id === "number" ? String(id).trim() : "";
}

function descriptorOptionIds(value: ShopeeCategoryAttributeDescriptor) {
  if (!Array.isArray(value.values)) return new Set<string>();
  return new Set(value.values.flatMap((candidate) => {
    const option = record(candidate);
    const id = option?.id ?? option?.value_id;
    return typeof id === "string" || typeof id === "number" ? [String(id).trim()] : [];
  }).filter(Boolean));
}

export function categoryScalar(value: ChannelCategoryValue | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (value.length === 0) return "";
  if (value.length === 1) return value[0];
  throw new Error("이 채널의 단일 값 항목에 여러 값이 입력됐습니다. 카테고리 속성을 확인해 주세요.");
}

export function shopeeCategoryAttributes(
  values: Record<string, ChannelCategoryValue>,
  descriptors: unknown[] = [],
) {
  const descriptorById = new Map(descriptors.flatMap((candidate) => {
    const descriptor = record(candidate) as ShopeeCategoryAttributeDescriptor | null;
    const id = descriptor ? descriptorId(descriptor) : "";
    return descriptor && id ? [[id, descriptor] as const] : [];
  }));

  return Object.entries(values).filter(([id]) => /^\d+$/.test(id)).map(([id, value]) => {
    const descriptor = descriptorById.get(id);
    const inputKind = typeof descriptor?.inputKind === "string" ? descriptor.inputKind : "";
    const optionIds = descriptor ? descriptorOptionIds(descriptor) : new Set<string>();
    const attributeValueList = (Array.isArray(value) ? value : [value]).filter(Boolean).map((item) => {
      if (shopeeTextInputKinds.has(inputKind)) return { original_value_name: item };
      if (shopeeSelectionInputKinds.has(inputKind)) {
        if (!/^\d+$/.test(item) || (optionIds.size > 0 && !optionIds.has(item))) {
          throw new Error("Shopee 선택 속성값이 공식 옵션 ID와 일치하지 않습니다.");
        }
        return { value_id: Number(item) };
      }
      if (inputKind === "unsupported") {
        throw new Error("Shopee에서 지원하지 않는 카테고리 속성값이 포함됐습니다.");
      }
      // Legacy assignments do not have typed descriptors. Preserve their
      // previous conversion until the category metadata is refreshed.
      return /^\d+$/.test(item) ? { value_id: Number(item) } : { original_value_name: item };
    });
    return { attribute_id: Number(id), attribute_value_list: attributeValueList };
  });
}

export function coupangCategoryInputs(values: Record<string, ChannelCategoryValue>) {
  const attributes: Array<{ attributeTypeName: string; attributeValueName: string }> = [];
  const notices: Array<{ noticeCategoryName: string; noticeCategoryDetailName: string; content: string }> = [];
  const certifications: Array<{ certificationType: string; certificationCode: string }> = [];
  const selectedNoticeCategory = categoryScalar(values["notice:category"]).trim();

  for (const [key, raw] of Object.entries(values)) {
    const value = categoryScalar(raw);
    if (!value.trim() || key === "notice:category") continue;
    if (key.startsWith("notice:")) {
      const rest = key.slice(7);
      const split = rest.indexOf(":");
      if (split < 1 || split === rest.length - 1) {
        throw new Error("상품 고시 항목의 카테고리 연결을 확인해 주세요.");
      }
      const noticeCategoryName = rest.slice(0, split);
      if (selectedNoticeCategory && selectedNoticeCategory !== noticeCategoryName) {
        throw new Error("선택한 상품 고시 분류와 입력 항목의 분류가 일치하지 않습니다.");
      }
      notices.push({
        noticeCategoryName,
        noticeCategoryDetailName: rest.slice(split + 1),
        content: value,
      });
    } else if (key.startsWith("certification:")) {
      const certificationType = key.slice(14).trim();
      if (!certificationType) throw new Error("상품 인증 항목의 유형을 확인해 주세요.");
      certifications.push({ certificationType, certificationCode: value });
    } else {
      attributes.push({ attributeTypeName: key, attributeValueName: value });
    }
  }
  return { attributes, notices, certifications };
}
