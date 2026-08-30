const PROCESS_COPY_MARKERS = [
  "scene 0",
  "scene 1",
  "scenes",
  "seller_input",
  "buyerquestion",
  "imageasset",
  "system prompt",
  "model response",
  "json schema",
  "prompt instruction",
  "the image shows",
  "this image shows",
  "photo shows",
  "shown in the image",
  "shown for reference",
  "for illustration only",
  "illustrative image",
  "seller review",
  "before publishing",
  "how to read the scenes",
  "production note",
  "시스템 설명",
  "시스템 프롬프트",
  "모델 응답",
  "json 스키마",
  "프롬프트 지시",
  "연출 이미지",
  "연출 사진",
  "연출용",
  "연출 소품",
  "사진마다",
  "사진에서",
  "사진으로",
  "이미지에서",
  "이미지에는",
  "이미지만으로",
  "대표사진에서",
  "대표 이미지에서",
  "화면의 양",
  "화면 속 양",
  "화면 색감",
  "장면을 보여",
  "장면은 예시",
  "검수 항목",
  "판매자 검수",
  "게시 전 보완",
  "게시 전에 별도 확인",
  "제작 과정",
  "제작 안내",
  "렌더링 안내",
  "단정하지 않습니다",
  "확정하지 않습니다",
  "해석하지 마세요",
] as const;

function collectStrings(value: unknown, output: string[]) {
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, output));
    return;
  }
  if (!value || typeof value !== "object") return;
  Object.values(value).forEach((item) => collectStrings(item, output));
}

/**
 * Public copy describes the product. Generation, photography and operator QA
 * explanations belong in warnings/admin metadata and must not reach a buyer.
 */
export function customerCopyQualityIssue(value: unknown) {
  const strings: string[] = [];
  collectStrings(value, strings);
  for (const text of strings) {
    const normalized = text.toLocaleLowerCase();
    const marker = PROCESS_COPY_MARKERS.find((candidate) => normalized.includes(candidate));
    if (marker) return `process-copy-marker:${marker}`;
  }
  return "";
}

export function safeCustomerCopy(value: unknown, fallback = "") {
  const text = typeof value === "string" ? value.trim() : "";
  return text && !customerCopyQualityIssue(text) ? text : fallback;
}
