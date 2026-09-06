import { AI_GATEWAY_CUSTOMER_VERIFICATION_MESSAGE } from "./ai-gateway-failure";

const DEFAULT_PRODUCT_RESEARCH_FAILURE_MESSAGE =
  "AI 상품정보 분석 서버에 일시적으로 연결하지 못했습니다. 잠시 후 같은 입력으로 다시 시도해 주세요.";

const PRODUCT_RESEARCH_FAILURE_MESSAGES = {
  gateway_customer_verification_required: AI_GATEWAY_CUSTOMER_VERIFICATION_MESSAGE,
  gateway_authentication_error:
    "AI 상품정보 분석 인증을 확인하지 못했습니다. 운영 연결을 점검한 뒤 다시 시도해 주세요.",
  gateway_billing_required:
    "외부 AI 사용 한도가 소진되어 상품정보 분석을 실행할 수 없습니다. 운영 담당자의 결제·사용량 확인이 필요합니다.",
  gateway_forbidden:
    "AI 상품정보 분석 권한이 허용되지 않았습니다. 운영 권한 설정을 확인해야 합니다.",
  gateway_model_not_found:
    "현재 상품정보 분석 모델을 사용할 수 없습니다. 운영 모델 설정 확인이 필요합니다.",
  gateway_rate_limited:
    "AI 요청이 몰려 상품정보 분석이 잠시 지연되고 있습니다. 잠시 후 같은 입력으로 다시 시도해 주세요.",
  gateway_timeout:
    "AI 상품정보 분석 응답이 지연되었습니다. 잠시 후 같은 입력으로 다시 시도해 주세요.",
  gateway_request_failed: DEFAULT_PRODUCT_RESEARCH_FAILURE_MESSAGE,
  gateway_result_invalid:
    "AI가 반환한 상품정보 형식을 확인하지 못했습니다. 같은 입력으로 다시 시도해 주세요.",
  runtime_timeout:
    "AI 상품정보 분석 시간이 초과되었습니다. 잠시 후 같은 입력으로 다시 시도해 주세요.",
  source_photo_analysis_limit: "한 번의 제작에는 대표사진을 포함해 최대 10장을 선택해 주세요.",
  source_product_identity_mismatch: "다른 상품으로 보이는 사진이 포함되어 있습니다. 같은 상품의 사진인지 확인한 뒤 다시 실행해 주세요.",
  source_view_not_compositable: "연출컷에 사용할 상품 전체 모습을 확인하지 못했습니다. 상품이 온전히 보이는 사진을 추가해 주세요.",
  research_input_invalid:
    "상품 링크 또는 설명을 2자 이상 입력해 주세요.",
  // Older jobs may still contain this pre-auto-OIDC reason. Keep it private
  // and present the same actionable authentication guidance.
  oidc_unavailable:
    "AI 상품정보 분석 인증을 확인하지 못했습니다. 운영 연결을 점검한 뒤 다시 시도해 주세요.",
} as const;

export type ProductResearchFailureReason = keyof typeof PRODUCT_RESEARCH_FAILURE_MESSAGES;

const SAFE_PRODUCT_RESEARCH_FAILURE_MESSAGES = new Set<string>(
  Object.values(PRODUCT_RESEARCH_FAILURE_MESSAGES),
);

function extractProductResearchFailureReason(value: unknown): ProductResearchFailureReason | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  const reason = normalized.startsWith("server product research failed:")
    ? normalized.slice("server product research failed:".length).trim()
    : normalized;
  return Object.prototype.hasOwnProperty.call(PRODUCT_RESEARCH_FAILURE_MESSAGES, reason)
    ? reason as ProductResearchFailureReason
    : null;
}

export function productResearchFailureMessage(value: unknown) {
  const normalizedMessage = typeof value === "string" ? value.trim() : "";
  // The authenticated polling route already redacts DB reasons. Preserve only
  // one of our own exact messages when the browser applies the same guard a
  // second time; arbitrary provider or database text still falls back.
  if (SAFE_PRODUCT_RESEARCH_FAILURE_MESSAGES.has(normalizedMessage)) {
    return normalizedMessage;
  }
  const reason = extractProductResearchFailureReason(value);
  return reason
    ? PRODUCT_RESEARCH_FAILURE_MESSAGES[reason]
    : DEFAULT_PRODUCT_RESEARCH_FAILURE_MESSAGE;
}
