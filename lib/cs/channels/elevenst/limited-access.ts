export type ElevenstLimitedSurface = "seller_talk" | "review";

export type ElevenstLimitedAccessProjection = {
  contractVersion: "sellerpilot-elevenst-limited-access-projection/2";
  surface: ElevenstLimitedSurface;
  accessMode: "seller_office_session_only" | "seller_office_export_only";
  automaticReadAvailable: false;
  automaticReplyAvailable: false;
  remoteCount: null;
  storedCount: null;
  retention: { maximum: 3; unit: "month"; exactDays: null } | null;
  reviewedImportCandidate: "reviewed_browser_capture" | "seller_office_xls_preview";
  message: string;
};

export function buildElevenstLimitedAccessProjection(
  surface: ElevenstLimitedSurface,
): ElevenstLimitedAccessProjection {
  if (surface === "seller_talk") {
    return {
      contractVersion: "sellerpilot-elevenst-limited-access-projection/2",
      surface,
      accessMode: "seller_office_session_only",
      automaticReadAvailable: false,
      automaticReplyAvailable: false,
      remoteCount: null,
      storedCount: null,
      retention: { maximum: 3, unit: "month", exactDays: null },
      reviewedImportCandidate: "reviewed_browser_capture",
      message: "공식 자동 수신·답변 API 계약을 확인하지 못했습니다. Seller Office 세션의 최근 최대 3개월 화면만 수동 검토할 수 있으며, 표시된 0건을 과거 전체 0건으로 해석하지 않습니다.",
    };
  }
  return {
    contractVersion: "sellerpilot-elevenst-limited-access-projection/2",
    surface,
    accessMode: "seller_office_export_only",
    automaticReadAvailable: false,
    automaticReplyAvailable: false,
    remoteCount: null,
    storedCount: null,
    retention: null,
    reviewedImportCandidate: "seller_office_xls_preview",
    message: "공식 리뷰 조회·댓글 API 계약을 확인하지 못했습니다. Seller Office 엑셀은 열과 출처를 검토하는 미리보기 수입 후보일 뿐 자동연동이나 댓글 완료 증거가 아닙니다.",
  };
}
