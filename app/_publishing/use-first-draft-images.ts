"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient as createSupabaseClient } from "../../lib/supabase/client";
import { coreFirstDraftAssetIds, type AiGeneratedAssetId } from "../../lib/ai-generated-assets";

export type FirstDraftGeneratedImage = {
  id: AiGeneratedAssetId;
  url: string;
};

export type FirstDraftImagePhase =
  | "idle"
  | "source-photo-catalog"
  | "queued"
  | "partial"
  | "complete"
  | "failed"
  | "unknown";

type FirstDraftLineageEntry = {
  digest?: unknown;
  auditMode?: unknown;
};

export type FirstDraftImageResult = {
  generatedImages?: Array<{ id: string; url: string | null }>;
  preflightAssetLineage?: Record<string, FirstDraftLineageEntry>;
  firstDraftGeneration?: { exhausted?: boolean; attempts?: number; maxAttempts?: number } | null;
};

export type FirstDraftImageSnapshot = {
  phase: Exclude<FirstDraftImagePhase, "idle" | "queued">;
  images: FirstDraftGeneratedImage[];
  confirmedGeneratedCount: number;
};

type FirstDraftJobToken = Readonly<{ jobId: string; generation: number }>;

export type FirstDraftImageHookDependencies = {
  getAccessToken?: () => Promise<string | undefined>;
  fetcher?: typeof fetch;
  pollDelayMs?: number;
  maximumPollAttempts?: number;
};

const lowercaseSha256Pattern = /^[a-f0-9]{64}$/;
const authenticationRequiredMessage = "로그인 세션이 만료되었습니다. 다시 로그인한 뒤 같은 작업을 다시 확인해 주세요.";

function exactKnownImages(generated: FirstDraftImageResult["generatedImages"]) {
  const byId = new Map<AiGeneratedAssetId, string>();
  for (const image of generated ?? []) {
    if (!coreFirstDraftAssetIds.includes(image.id as (typeof coreFirstDraftAssetIds)[number])
        || typeof image.url !== "string"
        || image.url.length === 0
        || byId.has(image.id as AiGeneratedAssetId)) continue;
    byId.set(image.id as AiGeneratedAssetId, image.url);
  }
  return coreFirstDraftAssetIds.flatMap((id) => {
    const url = byId.get(id);
    return url ? [{ id, url }] : [];
  });
}

/**
 * Browser-side display classification for the existing recovery/job payload.
 * URLs alone never establish generation: the stored per-role audit lineage is
 * the authority, and six distinct composite digests are required for complete.
 */
export function classifyFirstDraftImageResult(result: FirstDraftImageResult | null | undefined): FirstDraftImageSnapshot {
  const knownImages = exactKnownImages(result?.generatedImages);
  const images = knownImages.filter((image) => {
    const entry = result?.preflightAssetLineage?.[image.id];
    return entry?.auditMode === "segmented-source-composite" && typeof entry.digest === "string" && lowercaseSha256Pattern.test(entry.digest);
  });
  const lineage = result?.preflightAssetLineage;
  if (!lineage || typeof lineage !== "object" || Array.isArray(lineage)) {
    return {
      phase: result?.firstDraftGeneration?.exhausted
        ? "failed"
        : knownImages.length > 0 && knownImages.length < coreFirstDraftAssetIds.length ? "partial" : "unknown",
      images,
      confirmedGeneratedCount: 0,
    };
  }

  const modes = coreFirstDraftAssetIds.map((id) => lineage[id]?.auditMode);
  const compositeDigests = images.flatMap(({ id }) => {
    const entry = lineage[id];
    return entry?.auditMode === "segmented-source-composite"
      && typeof entry.digest === "string"
      && lowercaseSha256Pattern.test(entry.digest)
      ? [entry.digest]
      : [];
  });
  const confirmedGeneratedCount = new Set(compositeDigests).size;
  const allCatalog = modes.every((mode) => mode === "source-photo-catalog");
  const allComposite = modes.every((mode) => mode === "segmented-source-composite");
  const complete = allComposite
    && images.length === coreFirstDraftAssetIds.length
    && confirmedGeneratedCount === coreFirstDraftAssetIds.length;

  if (complete) return { phase: "complete", images, confirmedGeneratedCount };
  if (result?.firstDraftGeneration?.exhausted) return { phase: "failed", images, confirmedGeneratedCount };
  if (allCatalog) {
    return { phase: "source-photo-catalog", images, confirmedGeneratedCount: 0 };
  }
  if (knownImages.length < coreFirstDraftAssetIds.length || confirmedGeneratedCount > 0) {
    return { phase: "partial", images, confirmedGeneratedCount };
  }
  return { phase: "unknown", images, confirmedGeneratedCount: 0 };
}

/** Small job/generation fence kept separate so duplicate, retry and stale-result behavior is testable. */
export function createFirstDraftJobFence() {
  let activeJobId = "";
  let generation = 0;
  let requestPending = false;
  let mounted = true;

  const isCurrent = (token: FirstDraftJobToken) => mounted
    && token.jobId === activeJobId
    && token.generation === generation;

  return {
    mount() {
      mounted = true;
      activeJobId = "";
      generation += 1;
      requestPending = false;
    },
    activate(jobId: string): FirstDraftJobToken | null {
      if (!mounted || !jobId) return null;
      activeJobId = jobId;
      generation += 1;
      requestPending = false;
      return { jobId, generation };
    },
    beginRequest(jobId: string): FirstDraftJobToken | null {
      if (!mounted || jobId !== activeJobId || requestPending) return null;
      requestPending = true;
      return { jobId, generation };
    },
    releaseRequest(token: FirstDraftJobToken) {
      if (isCurrent(token)) requestPending = false;
    },
    isCurrent,
    reset() {
      activeJobId = "";
      generation += 1;
      requestPending = false;
    },
    unmount() {
      mounted = false;
      activeJobId = "";
      generation += 1;
      requestPending = false;
    },
  };
}

async function defaultAccessToken() {
  return (await createSupabaseClient().auth.getSession()).data.session?.access_token;
}

function defaultFetcher(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, init);
}

function firstDraftPhaseMessage(phase: FirstDraftImagePhase, confirmedGeneratedCount: number) {
  if (phase === "source-photo-catalog") return "역할별 이미지 생성을 준비하고 있습니다. 원본사진은 생성 결과에 표시하지 않습니다.";
  if (phase === "queued") return "8장 전체의 생성·검수를 마친 뒤 한 번에 표시합니다. 장별 검수 중 재시도될 수 있습니다.";
  if (phase === "partial") return `역할별 생성 이미지 ${confirmedGeneratedCount} / 8장을 확인했습니다. 나머지 이미지와 계보를 기다리고 있습니다.`;
  if (phase === "complete") return "원본 계보와 서로 다른 역할별 생성 근거가 확인된 1차 이미지 8장입니다.";
  if (phase === "failed") return "1차 이미지 생성을 완료하지 못해 중단됐습니다. 원본사진을 생성 결과로 표시하지 않습니다.";
  if (phase === "unknown") return "이미지 URL은 있으나 생성 계보를 확인할 수 없어 완료로 표시하지 않습니다.";
  return "";
}

// Owns only the browser lifecycle; generation and quality checks stay on the server/worker.
export function useFirstDraftImages(dependencies: FirstDraftImageHookDependencies = {}) {
  const getAccessToken = dependencies.getAccessToken ?? defaultAccessToken;
  const fetcher = dependencies.fetcher ?? defaultFetcher;
  const pollDelayMs = dependencies.pollDelayMs ?? 20_000;
  const maximumPollAttempts = dependencies.maximumPollAttempts ?? 90;
  const [firstDraftImages, setFirstDraftImages] = useState<FirstDraftGeneratedImage[]>([]);
  const [firstDraftImagePhase, setFirstDraftImagePhase] = useState<FirstDraftImagePhase>("idle");
  const [confirmedGeneratedCount, setConfirmedGeneratedCount] = useState(0);
  const [firstDraftConceptStatus, setFirstDraftConceptStatus] = useState("");
  const [firstDraftRetryAvailable, setFirstDraftRetryAvailable] = useState(false);
  const phaseRef = useRef<FirstDraftImagePhase>("idle");
  const confirmedGeneratedCountRef = useRef(0);
  const [fence] = useState(createFirstDraftJobFence);
  const requestControllerRef = useRef<AbortController | null>(null);
  const pollControllerRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const acceptedJobIdsRef = useRef(new Set<string>());

  const setPhase = useCallback((phase: FirstDraftImagePhase, count = 0, message?: string) => {
    phaseRef.current = phase;
    confirmedGeneratedCountRef.current = count;
    setFirstDraftImagePhase(phase);
    setConfirmedGeneratedCount(count);
    setFirstDraftConceptStatus(message ?? firstDraftPhaseMessage(phase, count));
  }, []);

  const stopAsyncLifecycle = useCallback((reason: string) => {
    requestControllerRef.current?.abort(new DOMException(reason, "AbortError"));
    requestControllerRef.current = null;
    pollControllerRef.current?.abort(new DOMException(reason, "AbortError"));
    pollControllerRef.current = null;
    if (pollTimerRef.current !== null) window.clearTimeout(pollTimerRef.current);
    pollTimerRef.current = null;
  }, []);

  const applySnapshot = useCallback((snapshot: FirstDraftImageSnapshot, keepQueued = false) => {
    setFirstDraftImages(snapshot.images);
    if (keepQueued && snapshot.phase === "source-photo-catalog") {
      setPhase("queued", 0);
    } else {
      setPhase(snapshot.phase, snapshot.confirmedGeneratedCount);
    }
    setFirstDraftRetryAvailable(false);
  }, [setPhase]);

  const activateFirstDraftJob = useCallback((jobId: string, result: FirstDraftImageResult) => {
    stopAsyncLifecycle("다른 1차 상품 작업으로 변경되었습니다.");
    const token = fence.activate(jobId);
    const snapshot = classifyFirstDraftImageResult(result);
    if (!token) return snapshot;
    setFirstDraftImages(snapshot.images);
    setPhase(snapshot.phase, snapshot.confirmedGeneratedCount);
    setFirstDraftRetryAvailable(false);
    return snapshot;
  }, [fence, setPhase, stopAsyncLifecycle]);

  const resetFirstDraftImages = useCallback(() => {
    stopAsyncLifecycle("1차 상품 입력 또는 원본이 변경되었습니다.");
    fence.reset();
    setFirstDraftImages([]);
    setPhase("idle", 0);
    setFirstDraftRetryAvailable(false);
  }, [fence, setPhase, stopAsyncLifecycle]);

  const refreshFirstDraftImages = useCallback(async (jobId: string, token: FirstDraftJobToken, signal: AbortSignal) => {
    try {
      const accessToken = await getAccessToken();
      if (signal.aborted || !fence.isCurrent(token)) return "stale" as const;
      if (!accessToken) return "authentication-required" as const;
      const read = await fetcher("/api/ai/product-research/recover", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
        cache: "no-store",
        signal,
      });
      if (signal.aborted || !fence.isCurrent(token)) return "stale" as const;
      if (read.status === 401) return "authentication-required" as const;
      if (!read.ok) return "pending" as const;
      const payload = await read.json() as { jobId?: string; result?: FirstDraftImageResult };
      if (payload.jobId !== jobId || signal.aborted || !fence.isCurrent(token)) return "stale" as const;
      const snapshot = classifyFirstDraftImageResult(payload.result);
      applySnapshot(snapshot, phaseRef.current === "queued");
      return snapshot.phase;
    } catch (error) {
      if (signal.aborted || !fence.isCurrent(token) || (error instanceof Error && error.name === "AbortError")) {
        return "stale" as const;
      }
      return "pending" as const;
    }
  }, [applySnapshot, fence, fetcher, getAccessToken]);

  const beginFirstDraftPolling = useCallback((jobId: string, token: FirstDraftJobToken) => {
    const pollController = new AbortController();
    pollControllerRef.current = pollController;
    let attempts = 0;
    const poll = async () => {
      if (pollController.signal.aborted || !fence.isCurrent(token)) return;
      attempts += 1;
      const phase = await refreshFirstDraftImages(jobId, token, pollController.signal);
      if (phase === "complete" || phase === "stale" || phase === "failed") {
        fence.releaseRequest(token);
        pollControllerRef.current = null;
        return;
      }
      if (phase === "authentication-required") {
        pollControllerRef.current = null;
        fence.releaseRequest(token);
        if (fence.isCurrent(token)) {
          setPhase("failed", confirmedGeneratedCountRef.current, authenticationRequiredMessage);
          setFirstDraftRetryAvailable(true);
        }
        return;
      }
      if (attempts >= maximumPollAttempts) {
        pollControllerRef.current = null;
        fence.releaseRequest(token);
        if (fence.isCurrent(token)) {
          setPhase("unknown", confirmedGeneratedCountRef.current, "1차 이미지 생성 완료를 제한시간 안에 확인하지 못했습니다. 같은 작업으로 다시 확인해 주세요.");
          setFirstDraftRetryAvailable(true);
        }
        return;
      }
      pollTimerRef.current = window.setTimeout(() => {
        pollTimerRef.current = null;
        void poll();
      }, pollDelayMs);
    };
    pollTimerRef.current = window.setTimeout(() => {
      pollTimerRef.current = null;
      void poll();
    }, pollDelayMs);
  }, [fence, maximumPollAttempts, pollDelayMs, refreshFirstDraftImages, setPhase]);

  const startFirstDraftConceptImages = useCallback(async (jobId: string) => {
    if (!jobId || phaseRef.current === "complete") return false;
    const token = fence.beginRequest(jobId);
    if (!token) return false;
    stopAsyncLifecycle("같은 1차 이미지 작업을 다시 요청합니다.");
    const requestController = new AbortController();
    requestControllerRef.current = requestController;
    setPhase("queued", confirmedGeneratedCountRef.current);
    setFirstDraftRetryAvailable(false);
    try {
      if (acceptedJobIdsRef.current.has(jobId)) {
        beginFirstDraftPolling(jobId, token);
        return true;
      }
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error(authenticationRequiredMessage);
      if (requestController.signal.aborted || !fence.isCurrent(token)) return false;
      const response = await fetcher("/api/admin/first-draft-images-enqueue", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
        cache: "no-store",
        signal: requestController.signal,
      });
      const payload = await response.json().catch(() => null) as { jobId?: string; message?: string; code?: string } | null;
      if (requestController.signal.aborted || !fence.isCurrent(token)) return false;
      if (!response.ok) {
        if (response.status === 401) throw new Error(authenticationRequiredMessage);
        if (payload?.code === "already_generated") {
          acceptedJobIdsRef.current.add(jobId);
          fence.releaseRequest(token);
          const pollController = new AbortController();
          pollControllerRef.current = pollController;
          const phase = await refreshFirstDraftImages(jobId, token, pollController.signal);
          if (phase === "complete") return true;
        }
        throw new Error(payload?.message || "1차 이미지 생성 요청을 넣지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
      if (payload?.jobId !== jobId) throw new Error("1차 이미지 생성 요청의 작업 ID가 현재 상품과 일치하지 않습니다.");
      acceptedJobIdsRef.current.add(jobId);
      requestControllerRef.current = null;
      setPhase("queued", confirmedGeneratedCountRef.current);
      beginFirstDraftPolling(jobId, token);
      return true;
    } catch (error) {
      if (requestController.signal.aborted || !fence.isCurrent(token) || (error instanceof Error && error.name === "AbortError")) return false;
      fence.releaseRequest(token);
      const message = error instanceof Error ? error.message : "1차 이미지 생성 요청을 완료하지 못했습니다.";
      setPhase("failed", confirmedGeneratedCountRef.current, message);
      setFirstDraftRetryAvailable(true);
      return false;
    } finally {
      if (requestControllerRef.current === requestController) requestControllerRef.current = null;
    }
  }, [beginFirstDraftPolling, fence, fetcher, getAccessToken, refreshFirstDraftImages, setPhase, stopAsyncLifecycle]);

  useEffect(() => {
    fence.mount();
    return () => {
      stopAsyncLifecycle("1차 이미지 검토 화면을 닫았습니다.");
      fence.unmount();
    };
  }, [fence, stopAsyncLifecycle]);

  return {
    firstDraftImages,
    firstDraftImagePhase,
    confirmedGeneratedCount,
    studioDraftImagesMerged: firstDraftImagePhase === "complete",
    firstDraftConceptStatus,
    firstDraftRetryAvailable,
    activateFirstDraftJob,
    resetFirstDraftImages,
    startFirstDraftConceptImages,
  };
}
