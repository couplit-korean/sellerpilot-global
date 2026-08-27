const GENERIC_AI_JOB_FAILURE = "AI 상품 작업을 완료하지 못했습니다. 잠시 후 다시 실행해 주세요.";
const AI_TOOL_CONNECTION_FAILURE = "AI 생성 도구 연결이 중단되었습니다. 작업자를 다시 시작한 뒤 다시 실행해 주세요.";
const AI_IMAGE_RESPONSE_FAILURE = "AI 이미지 생성 도구가 올바른 결과를 반환하지 못했습니다. 작업자를 다시 시작한 뒤 다시 실행해 주세요.";

const CONNECTION_FAILURE_PATTERN = /(?:authrequired|www_authenticate|bearer\s+realm|rmcp::|transport\s+channel\s+closed|mcp\.[a-z0-9.-]+)/i;
const PROMPT_LEAK_PATTERN = /(?:```|sketch-to-render|primary\s+request:|style\/medium:|subject:|features\s+enabled:|under-development\s+features)/i;
const PRIVATE_RUNTIME_PATTERN = /(?:\/Users\/|\/private\/|\/var\/folders\/|file:\/\/|node_modules|[A-Za-z]:\\|\bat\s+\S+\s*\()/i;
const SECRET_MATERIAL_PATTERN = /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|password|secret)\b/i;

export function sellerSafeAiJobFailure(error: unknown) {
  const raw = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";
  const compact = raw.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim();
  if (!compact) return GENERIC_AI_JOB_FAILURE;
  if (CONNECTION_FAILURE_PATTERN.test(compact)) return AI_TOOL_CONNECTION_FAILURE;
  if (PROMPT_LEAK_PATTERN.test(compact)) return AI_IMAGE_RESPONSE_FAILURE;
  if (PRIVATE_RUNTIME_PATTERN.test(compact) || SECRET_MATERIAL_PATTERN.test(compact)) {
    return GENERIC_AI_JOB_FAILURE;
  }
  if (!/[가-힣]/.test(compact)) return GENERIC_AI_JOB_FAILURE;
  return compact.slice(0, 300);
}
