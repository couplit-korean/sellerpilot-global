export type StudioResultQuality = {
  status: "degraded" | "not_flagged";
  blockedForPublication: boolean;
  imageFallback: boolean;
  copyFallback: boolean;
  reasons: string[];
  message: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Detect recorded degradation, not visual quality. A legacy result without a
 * fallback marker is not thereby quality-verified. The publish-context RPC
 * historically exposes warnings but omits deterministic_fallback/audit modes,
 * so both exact legacy warnings and structured provenance must be honored. */
export function inspectStudioResultQuality(value: unknown): StudioResultQuality {
  const result = record(value);
  const fallback = record(result?.deterministic_fallback);
  const warnings = Array.isArray(result?.warnings)
    ? result.warnings.filter((item): item is string => typeof item === "string")
    : [];
  const modes = record(result?.asset_audit_modes);
  const imageFallback = Boolean(fallback?.imageReason)
    || Object.values(modes ?? {}).some((mode) => mode === "source-photo-catalog")
    || warnings.some((warning) => /원본 사진 기반 중립 카탈로그|AI 생성 이미지가 아니라 원본 사진/u.test(warning));
  const copyFallback = Boolean(fallback?.masterReason)
    || (Array.isArray(fallback?.localizationReasons) && fallback.localizationReasons.length > 0)
    || warnings.some((warning) => /studio_terminal_contract_invalid|studio_localization_contract_invalid|문안으로 대체했|입력만 사용해 (?:16개 상세 섹션을 안전하게|결정론적으로) 구성/u.test(warning));
  const reasons = [
    ...(imageFallback ? ["recorded_source_photo_catalog_fallback"] : []),
    ...(copyFallback ? ["recorded_copy_fallback"] : []),
  ];
  const blockedForPublication = reasons.length > 0;
  return {
    status: blockedForPublication ? "degraded" : "not_flagged",
    blockedForPublication,
    imageFallback,
    copyFallback,
    reasons,
    message: blockedForPublication
      ? "AI 제한 또는 제작 오류로 만든 대체본입니다. 파일 수와 저장 승인은 제작 품질 통과가 아닙니다. 사진·상세페이지를 다시 제작하고 검수하기 전에는 채널에 전송할 수 없습니다."
      : "기록된 대체 제작 경고가 없습니다. 실제 이미지·문안 검수와 채널별 게시 조건은 별도로 확인해야 합니다.",
  };
}
