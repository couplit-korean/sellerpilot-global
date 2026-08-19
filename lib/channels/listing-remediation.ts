import type { ChannelOperationResult } from "./operations";
import { userFacingErrorMessage } from "../user-facing-errors";

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
  if (/not authori[sz]ed to sell|do not have permission to list|NO_AUTHORITY|NotAuthority\.product\.category\.id|RESTRICTED_CATEGORY|판매 권한.*카테고리|등록권한이 있어야만 판매/i.test(text)) {
    return {
      kind: "category_permission",
      code: "CATEGORY_PERMISSION_REQUIRED",
      safeMessage: "현재 선택한 카테고리는 이 판매자 계정에서 사용할 수 없습니다. 판매 권한을 확인하거나 상품에 맞는 다른 최종 카테고리를 선택해 주세요.",
      rejectCategory: true,
      retryableAfterCorrection: true,
    };
  }
  if (/10원 단위|1원단위|NumberUnit|Invalid Attribute Value|구매 옵션 값 혹은 단위|유효하지 않은.*(?:단위|옵션)/i.test(text)) {
    return {
      kind: "missing_field",
      code: "PRICE_OR_ATTRIBUTE_UNIT_REJECTED",
      safeMessage: "가격 또는 옵션 정보가 판매 채널 기준과 맞지 않습니다. 값을 자동으로 보정한 뒤 다시 확인해 주세요.",
      rejectCategory: false,
      retryableAfterCorrection: true,
    };
  }
  if (/BIZ_CHECK_EXIST_OUTER_DESCRIPTION_IMAGE|MEDIA_SPACE|MIGRATE_IMAGE|TEMU_IMAGE_READBACK_MISSING|EBAY_IMAGE_READBACK_MISSING|image[_ -]?(?:url|upload|file|size|dimensions?|format|required|invalid|failed|rejected)|(?:picture|photo|thumbnail)[_ -]?(?:url|upload|file|size|dimensions?|format|required|invalid|failed|rejected)|이미지\s*(?:URL|업로드|규격|크기|경로|파일|오류|실패|거절)/i.test(text)) {
    return {
      kind: "image",
      code: "IMAGE_REJECTED_AFTER_NORMALIZATION",
      safeMessage: "상품 사진이 판매 채널 기준을 통과하지 못했습니다. 사진을 다시 선택하면 크기와 용량을 자동으로 맞춘 뒤 재등록합니다.",
      rejectCategory: false,
      retryableAfterCorrection: true,
    };
  }
  if (/required|missing|mandatory|필수|누락|invalid.*(?:field|attribute)|attribute.*invalid/i.test(text)) {
    return {
      kind: "missing_field",
      code: "REQUIRED_FIELD_REJECTED",
      safeMessage: "등록에 필요한 정보가 빠졌거나 형식이 맞지 않습니다. ‘직접 입력 필요’로 표시된 항목을 확인해 주세요.",
      rejectCategory: false,
      retryableAfterCorrection: true,
    };
  }
  if (/token|oauth|unauthori[sz]ed|forbidden|credential|signature|error_sign/i.test(text)) {
    return {
      kind: "authentication",
      code: "CHANNEL_AUTHENTICATION_REQUIRED",
      safeMessage: "판매 채널 연결을 다시 확인해 주세요. ‘채널 연결’에서 해당 계정을 다시 연결한 뒤 시도해 주세요.",
      rejectCategory: false,
      retryableAfterCorrection: true,
    };
  }
  return {
    kind: "provider",
    code: "CHANNEL_PROVIDER_REJECTED",
    safeMessage: userFacingErrorMessage(result.safeMessage, "판매 채널에서 상품을 등록하지 못했습니다. 입력 정보를 확인하고 다시 시도해 주세요."),
    rejectCategory: false,
    retryableAfterCorrection: false,
  };
}

export function applyListingRemediation(result: ChannelOperationResult) {
  const remediation = classifyListingFailure(result);
  if (!remediation) return { result, remediation: null };
  return { result: { ...result, safeMessage: remediation.safeMessage }, remediation };
}
