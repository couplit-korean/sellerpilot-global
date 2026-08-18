import type { ChannelOperationResult } from "./operations";

export type ListingFailureKind = "category_permission" | "image" | "missing_field" | "authentication" | "provider";

export type ListingFailureRemediation = {
  kind: ListingFailureKind;
  code: string;
  safeMessage: string;
  rejectCategory: boolean;
  retryableAfterCorrection: boolean;
};

function providerText(result: ChannelOperationResult) {
  return result.steps
    .filter((step) => !step.ok)
    .map((step) => JSON.stringify(step.data))
    .join(" ")
    .slice(0, 20_000);
}

export function classifyListingFailure(result: ChannelOperationResult): ListingFailureRemediation | null {
  if (result.ok || (result.operation !== "listing.create" && result.operation !== "listing.update")) return null;
  const text = `${result.safeMessage} ${providerText(result)}`;
  if (/not authori[sz]ed to sell|do not have permission to list|NO_AUTHORITY|RESTRICTED_CATEGORY|판매 권한.*카테고리/i.test(text)) {
    return {
      kind: "category_permission",
      code: "CATEGORY_PERMISSION_REQUIRED",
      safeMessage: "판매자 계정에 허용되지 않은 카테고리입니다. 같은 카테고리 재시도를 중단했고, 권한이 있는 정확한 말단 카테고리를 다시 확정해야 합니다.",
      rejectCategory: true,
      retryableAfterCorrection: true,
    };
  }
  if (/10원 단위|1원단위|NumberUnit|Invalid Attribute Value|구매 옵션 값 혹은 단위|유효하지 않은.*(?:단위|옵션)/i.test(text)) {
    return {
      kind: "missing_field",
      code: "PRICE_OR_ATTRIBUTE_UNIT_REJECTED",
      safeMessage: "채널의 가격·옵션 단위 규칙에 맞지 않습니다. 판매가는 채널 단위로 자동 보정하고 숫자형 옵션은 공식 카테고리 단위를 붙인 뒤 다시 등록해 주세요.",
      rejectCategory: false,
      retryableAfterCorrection: true,
    };
  }
  if (/BIZ_CHECK_EXIST_OUTER_DESCRIPTION_IMAGE|MEDIA_SPACE|MIGRATE_IMAGE|TEMU_IMAGE_READBACK_MISSING|EBAY_IMAGE_READBACK_MISSING|image[_ -]?(?:url|upload|file|size|dimensions?|format|required|invalid|failed|rejected)|(?:picture|photo|thumbnail)[_ -]?(?:url|upload|file|size|dimensions?|format|required|invalid|failed|rejected)|이미지\s*(?:URL|업로드|규격|크기|경로|파일|오류|실패|거절)/i.test(text)) {
    return {
      kind: "image",
      code: "IMAGE_REJECTED_AFTER_NORMALIZATION",
      safeMessage: "대표 이미지를 1200×1200 JPEG·3MB 이하 공개 URL로 자동 보정했지만 채널 이미지 API가 거절했습니다. 원격 응답을 확인해 이미지 재생성 후 다시 시도해 주세요.",
      rejectCategory: false,
      retryableAfterCorrection: true,
    };
  }
  if (/required|missing|mandatory|필수|누락|invalid.*(?:field|attribute)|attribute.*invalid/i.test(text)) {
    return {
      kind: "missing_field",
      code: "REQUIRED_FIELD_REJECTED",
      safeMessage: "채널이 필수 입력값 또는 카테고리 속성을 거절했습니다. 해당 필드를 수동 입력 필수 상태로 확인한 뒤 다시 등록해 주세요.",
      rejectCategory: false,
      retryableAfterCorrection: true,
    };
  }
  if (/token|oauth|unauthori[sz]ed|forbidden|credential|signature|error_sign/i.test(text)) {
    return {
      kind: "authentication",
      code: "CHANNEL_AUTHENTICATION_REQUIRED",
      safeMessage: "채널 인증 또는 서명 검증에 실패했습니다. 운영 키와 OAuth 연결을 갱신한 뒤 다시 시도해 주세요.",
      rejectCategory: false,
      retryableAfterCorrection: true,
    };
  }
  return {
    kind: "provider",
    code: "CHANNEL_PROVIDER_REJECTED",
    safeMessage: result.safeMessage,
    rejectCategory: false,
    retryableAfterCorrection: false,
  };
}

export function applyListingRemediation(result: ChannelOperationResult) {
  const remediation = classifyListingFailure(result);
  return remediation ? { result: { ...result, safeMessage: remediation.safeMessage }, remediation } : { result, remediation: null };
}
