import { AI_GATEWAY_CUSTOMER_VERIFICATION_MESSAGE } from "./ai-gateway-failure";

const GENERIC_AI_JOB_FAILURE = "AI 상품 작업을 완료하지 못했습니다. 잠시 후 다시 실행해 주세요.";
const AI_TOOL_CONNECTION_FAILURE = "AI 생성 도구 연결이 중단되었습니다. 작업자를 다시 시작한 뒤 다시 실행해 주세요.";
const AI_IMAGE_RESPONSE_FAILURE = "AI 이미지 생성 도구가 올바른 결과를 반환하지 못했습니다. 작업자를 다시 시작한 뒤 다시 실행해 주세요.";

const CONNECTION_FAILURE_PATTERN = /(?:authrequired|www_authenticate|bearer\s+realm|rmcp::|transport\s+channel\s+closed|mcp\.[a-z0-9.-]+)/i;
const PROMPT_LEAK_PATTERN = /(?:```|sketch-to-render|primary\s+request:|style\/medium:|subject:|features\s+enabled:|under-development\s+features)/i;
const PRIVATE_RUNTIME_PATTERN = /(?:\/Users\/|\/private\/|\/var\/folders\/|file:\/\/|node_modules|[A-Za-z]:\\|\bat\s+\S+\s*\()/i;
const SECRET_MATERIAL_PATTERN = /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|password|secret)\b/i;
const CUSTOMER_VERIFICATION_REASON_PATTERN = /^(?:server product (?:research|studio) failed:\s*)?gateway_customer_verification_required$/i;

const STUDIO_SEGMENT_FAILURES = {
  "budget-exhausted": "AI 마스터 기획 보정 시간이 모두 사용되었습니다. 입력 사진과 설명을 확인한 뒤 다시 실행해 주세요. [studio-budget-exhausted]",
  "invalid-schema": "AI 상세페이지 분할 규격을 확인하지 못했습니다. 작업자와 배포 버전을 확인해 주세요. [studio-invalid-schema]",
  "invalid-plan": "AI 상세페이지 분할 실행 계획을 확인하지 못했습니다. 작업자와 배포 버전을 확인해 주세요. [studio-invalid-plan]",
  "invalid-master": "AI 마스터 기획의 분할 형식 검증에 실패했습니다. 입력을 확인한 뒤 다시 실행해 주세요. [studio-invalid-master]",
  "invalid-segment": "AI 현지화 분할 형식 검증에 실패했습니다. 입력을 확인한 뒤 다시 실행해 주세요. [studio-invalid-segment]",
  "unexpected-target": "AI 현지화 대상 채널 검증에 실패했습니다. 다시 실행해 주세요. [studio-unexpected-target]",
  "locale-mismatch": "AI 현지화 언어 구성 검증에 실패했습니다. 다시 실행해 주세요. [studio-locale-mismatch]",
  "duplicate-target": "AI 현지화 대상이 중복되어 완료하지 못했습니다. 다시 실행해 주세요. [studio-duplicate-target]",
  "missing-target": "AI 현지화 대상 일부가 누락되어 완료하지 못했습니다. 다시 실행해 주세요. [studio-missing-target]",
} as const;

const SAFE_SELLER_FACING_MESSAGES = new Set<string>([
  GENERIC_AI_JOB_FAILURE,
  AI_TOOL_CONNECTION_FAILURE,
  AI_IMAGE_RESPONSE_FAILURE,
  AI_GATEWAY_CUSTOMER_VERIFICATION_MESSAGE,
  ...Object.values(STUDIO_SEGMENT_FAILURES),
]);

function studioSegmentFailure(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { name?: unknown; code?: unknown };
  if (candidate.name !== "StudioSegmentContractError" || typeof candidate.code !== "string") return null;
  return Object.hasOwn(STUDIO_SEGMENT_FAILURES, candidate.code)
    ? STUDIO_SEGMENT_FAILURES[candidate.code as keyof typeof STUDIO_SEGMENT_FAILURES]
    : null;
}

export function sellerSafeAiJobFailure(error: unknown) {
  const structuredStudioFailure = studioSegmentFailure(error);
  if (structuredStudioFailure) return structuredStudioFailure;
  const raw = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";
  const compact = raw.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim();
  if (!compact) return GENERIC_AI_JOB_FAILURE;
  if (SAFE_SELLER_FACING_MESSAGES.has(compact)) return compact;
  if (CUSTOMER_VERIFICATION_REASON_PATTERN.test(compact)) {
    return AI_GATEWAY_CUSTOMER_VERIFICATION_MESSAGE;
  }
  if (CONNECTION_FAILURE_PATTERN.test(compact)) return AI_TOOL_CONNECTION_FAILURE;
  if (PROMPT_LEAK_PATTERN.test(compact)) return AI_IMAGE_RESPONSE_FAILURE;
  if (PRIVATE_RUNTIME_PATTERN.test(compact) || SECRET_MATERIAL_PATTERN.test(compact)) {
    return GENERIC_AI_JOB_FAILURE;
  }
  // Upstream text is untrusted even when it contains Korean. Only the exact
  // fixed messages and structured reason codes above may reach seller UI.
  return GENERIC_AI_JOB_FAILURE;
}
