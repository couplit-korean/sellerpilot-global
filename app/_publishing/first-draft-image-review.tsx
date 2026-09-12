"use client";

import Image from "next/image";
import { ImageIcon } from "lucide-react";
import { coreFirstDraftAssetIds } from "../../lib/ai-generated-assets";
import type { FirstDraftGeneratedImage } from "./use-first-draft-images";

const firstDraftImageLabels: Record<(typeof coreFirstDraftAssetIds)[number], string> = {
  portrait: "모바일 세로 설정샷",
  wide: "가로 설정샷",
  "detail-overview": "상품 전체·준비컷",
  "detail-use": "사용 설정샷",
  "detail-routine": "생활 루틴 설정샷",
  "detail-scale": "크기 비교 설정샷",
};

export function FirstDraftImageReview({ firstDraftImages, studioDraftImagesMerged, firstDraftConceptStatus, studioDraftBlockedReason }: {
  firstDraftImages: FirstDraftGeneratedImage[];
  studioDraftImagesMerged: boolean;
  firstDraftConceptStatus: string;
  studioDraftBlockedReason: string;
}) {
  if (!firstDraftImages.length) return null;
  return (<section className="first-draft-image-review" aria-label="1차 생성 이미지 6개">
              <header><span><ImageIcon size={16} /><b>1차 생성 이미지</b><small>{studioDraftImagesMerged ? "상세페이지와 동일한 카테고리 매칭 프롬프트로 생성된 6장입니다." : firstDraftConceptStatus || studioDraftBlockedReason || "상세페이지와 같은 파이프라인으로 6장을 생성하고 있습니다. 완료되면 이 자리에 표시됩니다."}</small></span><em>{firstDraftImages.length} / 6장</em></header>
              <div>{firstDraftImages.map((image) => <figure key={image.id}><span><Image src={image.url} alt={firstDraftImageLabels[image.id as (typeof coreFirstDraftAssetIds)[number]]} fill sizes="(max-width: 360px) 42vw, (max-width: 720px) 44vw, 180px" unoptimized /></span><figcaption>{firstDraftImageLabels[image.id as (typeof coreFirstDraftAssetIds)[number]]}</figcaption></figure>)}</div>
            </section>);
}
