"use client";

import Image from "next/image";
import { ImageIcon } from "lucide-react";
import { coreFirstDraftAssetIds } from "../../lib/ai-generated-assets";
import type { FirstDraftGeneratedImage, FirstDraftImagePhase } from "./use-first-draft-images";

const firstDraftImageLabels: Record<(typeof coreFirstDraftAssetIds)[number], string> = {
  portrait: "모바일 세로 설정샷",
  wide: "가로 설정샷",
  "detail-overview": "상품 전체·준비컷",
  "detail-use": "사용 설정샷",
  "detail-routine": "생활 루틴 설정샷",
  "detail-scale": "크기 비교 설정샷",
};

export function FirstDraftImageReview({ firstDraftImages, phase, confirmedGeneratedCount, firstDraftConceptStatus, retryAvailable, onRetry }: {
  firstDraftImages: FirstDraftGeneratedImage[];
  phase: FirstDraftImagePhase;
  confirmedGeneratedCount: number;
  firstDraftConceptStatus: string;
  retryAvailable: boolean;
  onRetry: () => void;
}) {
  if (phase === "idle" && !firstDraftImages.length) return null;
  const imagesById = new Map(firstDraftImages.map((image) => [image.id, image]));
  const statusLabel = phase === "complete"
    ? "생성 확인 6 / 6장"
    : phase === "source-photo-catalog" || phase === "queued" || phase === "unknown" || phase === "failed"
      ? "생성 확인 0 / 6장"
      : `생성 확인 ${confirmedGeneratedCount} / 6장`;
  return (<section className="first-draft-image-review" aria-label="1차 생성 이미지 6개">
              <header><span><ImageIcon size={16} /><b>1차 생성 이미지</b><small role="status" aria-live="polite">{firstDraftConceptStatus || "역할별 이미지 생성 상태를 확인하고 있습니다."}{retryAvailable && <> <button type="button" onClick={onRetry}>같은 작업 다시 확인</button></>}</small></span><em>{statusLabel}</em></header>
              <div>{coreFirstDraftAssetIds.map((id) => {
                const image = imagesById.get(id);
                const label = firstDraftImageLabels[id];
                return <figure key={id}><span>{image
                  ? <Image src={image.url} alt={label} fill sizes="(max-width: 360px) 42vw, (max-width: 720px) 44vw, 180px" unoptimized />
                  : <i role="img" aria-label={`${label} 생성 대기`}><ImageIcon aria-hidden="true" size={22} /></i>}</span><figcaption>{label}</figcaption></figure>;
              })}</div>
            </section>);
}
