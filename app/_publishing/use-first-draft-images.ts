"use client";

import { useRef, useState } from "react";
import { createClient as createSupabaseClient } from "../../lib/supabase/client";
import type { AiGeneratedAssetId } from "../../lib/ai-generated-assets";

export type FirstDraftGeneratedImage = {
  id: AiGeneratedAssetId;
  url: string;
};

// Owns the browser lifecycle only; generation and quality checks stay on the server/worker.
export function useFirstDraftImages() {
  const [firstDraftImages, setFirstDraftImages] = useState<FirstDraftGeneratedImage[]>([]);
  const [studioDraftImagesMerged, setStudioDraftImagesMerged] = useState(false);
  const mergeStudioDraftImages = (generated?: Array<{ id: string; url: string | null }>) => {
    const urls = new Map((generated ?? [])
      .filter((image) => typeof image.url === "string" && image.url)
      .map((image) => [image.id, image.url as string]));
    if (!urls.size) return;
    setStudioDraftImagesMerged(true);
    setFirstDraftImages((current) => current.map((image) => {
      const url = urls.get(image.id);
      return url && url !== image.url ? { ...image, url } : image;
    }));
  };
  // The first-draft six images come from the serverless catalog (photo crops) because the
  // gateway image model is unavailable to this account, so the same six assets are generated
  // on the local Codex lane and the tiles are refreshed as the images arrive.
  const [firstDraftConceptStatus, setFirstDraftConceptStatus] = useState("");
  const firstDraftImagePollRef = useRef<number | null>(null);
  const firstDraftImageRequestedRef = useRef(false);
  const refreshFirstDraftImages = async (jobId: string) => {
    try {
      const accessToken = (await createSupabaseClient().auth.getSession()).data.session?.access_token;
      if (!accessToken) return;
      const read = await fetch('/api/ai/product-research/recover', {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      if (!read.ok) return;
      const payload = await read.json() as { result?: { generatedImages?: Array<{ id: string; url: string | null }> } };
      const generated = payload.result?.generatedImages ?? [];
      if (generated.length) mergeStudioDraftImages(generated);
    } catch {
      // a transient read must not stop the running generation
    }
  };
  const startFirstDraftConceptImages = async (jobId: string) => {
    if (!jobId || firstDraftImageRequestedRef.current) return;
    firstDraftImageRequestedRef.current = true;
    try {
      const accessToken = (await createSupabaseClient().auth.getSession()).data.session?.access_token;
      if (!accessToken) return;
      const response = await fetch('/api/admin/first-draft-images-enqueue', {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        setFirstDraftConceptStatus(payload?.message || "1차 이미지 생성 요청을 넣지 못했습니다. 잠시 후 다시 시도해 주세요.");
        firstDraftImageRequestedRef.current = false;
        return;
      }
      setFirstDraftConceptStatus('1차 이미지 6장을 상세페이지와 같은 카테고리 매칭 파이프라인으로 생성하고 있습니다. 완료되는 대로 이 자리에 반영됩니다.');
      if (firstDraftImagePollRef.current !== null) window.clearInterval(firstDraftImagePollRef.current);
      let attempts = 0;
      firstDraftImagePollRef.current = window.setInterval(() => {
        attempts += 1;
        void refreshFirstDraftImages(jobId);
        if (attempts >= 90 && firstDraftImagePollRef.current !== null) {
          window.clearInterval(firstDraftImagePollRef.current);
          firstDraftImagePollRef.current = null;
        }
      }, 20_000);
    } catch {
      // requesting generated images is best effort; the server result stays as is
    }
  };
  return { firstDraftImages, setFirstDraftImages, studioDraftImagesMerged, firstDraftConceptStatus, startFirstDraftConceptImages, mergeStudioDraftImages };
}
