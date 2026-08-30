"use client";

import { AlertTriangle, Ban, CheckCircle2, Clock3, Cpu, DatabaseZap, History, LoaderCircle, RefreshCw, RotateCcw, ShieldCheck, SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { isStudioExecutionReady, type StudioWorkerReadiness } from "../lib/studio-worker-readiness";

type WorkerSnapshot = {
  label: string;
  expires_at: string;
  last_seen_at: string | null;
  last_version: string | null;
  scope?: "ai" | "gateway" | "scheduler" | "legacy_combined";
};

type WorkerStatus = {
  worker: WorkerSnapshot | null;
  workers?: Partial<Record<"ai" | "gateway" | "scheduler" | "legacy_combined", WorkerSnapshot>>;
  queued: number;
  running: number;
  succeeded_today: number;
  failed_today: number;
};

type ServerReadiness = StudioWorkerReadiness;

type GatewaySmokePayload = {
  ok?: boolean;
  diagnostic?: {
    code?: string;
    status?: number;
  };
};

type GatewaySmokeState = {
  status: "idle" | "checking" | "passed" | "failed";
  message: string;
  checkedAt: string | null;
};

type RuntimeReleaseState = {
  status: "idle" | "checking" | "passed" | "failed";
  message: string;
};

const listingPublicationChannels = [
  "qoo10",
  "shopee",
  "lazada",
  "coupang",
  "elevenst",
  "smartstore",
  "ebay",
] as const;

type ListingPublicationChannel = (typeof listingPublicationChannels)[number];

const listingPublicationChannelLabels: Record<ListingPublicationChannel, string> = {
  qoo10: "Qoo10",
  shopee: "Shopee",
  lazada: "Lazada",
  coupang: "쿠팡",
  elevenst: "11번가",
  smartstore: "스마트스토어",
  ebay: "eBay",
};

type ListingReleaseGate = {
  open: boolean;
  state: "open" | "closed";
  effectiveOpen: boolean;
  openedAt: string | null;
  updatedAt: string;
  openedRelease: string | null;
  openedChannel: "qoo10" | null;
  attestedRelease: string | null;
  activeRuntimeRelease: string | null;
  publicationAdaptersReady: number;
  publicationRecheckerReady: boolean;
  publicationReleaseConsistent: boolean;
  runtimeReleaseMatches: boolean;
  orphanPendingReviews: number;
  queuedOrRunning: number;
  reconciliationRequired: number;
  qoo10AdapterReady: boolean;
  qoo10AttestedRelease: string | null;
  qoo10ReleaseConsistent: boolean;
  qoo10RuntimeReleaseMatches: boolean;
  qoo10ReviewViolations: number;
  qoo10QueuedOrRunning: number;
  qoo10ReconciliationRequired: number;
  qoo10EffectiveOpen: boolean;
};

type ListingReleasePayload = {
  ok?: boolean;
  code?: string;
  message?: string;
  readyForOpen?: boolean;
  readyForQoo10Open?: boolean;
  runtimeRelease?: {
    status: "valid" | "unavailable";
    currentRelease: string | null;
  };
  gate?: ListingReleaseGate;
};

type ListingReleaseState = {
  status: "checking" | "ready" | "working" | "failed";
  message: string;
  currentRelease: string | null;
  gate: ListingReleaseGate | null;
  readyForOpen: boolean;
  readyForQoo10Open: boolean;
};

type ListingReleaseAction =
  | { action: "attest_adapter"; channel: ListingPublicationChannel }
  | { action: "attest_rechecker" }
  | { action: "open_gate" }
  | { action: "open_channel_gate"; channel: "qoo10" }
  | { action: "close_gate" };

type PendingConfirmation =
  | { kind: "runtime_activate" }
  | { kind: "listing_release"; request: ListingReleaseAction }
  | null;

type ServerAiRuntimeState =
  | "checking"
  | "ready"
  | "token_mismatch"
  | "token_missing_or_expired"
  | "status_unavailable"
  | "configuration_missing";

const serverAiRuntimeGuidance: Record<ServerAiRuntimeState, {
  statusLabel: string;
  queueSummary: string;
  recoveryTitle: string;
  recoveryDetail: string;
}> = {
  checking: {
    statusLabel: "확인 중",
    queueSummary: "Vercel·Supabase 토큰 상태 확인 중",
    recoveryTitle: "확인 결과 전에는 설정을 변경하지 마세요",
    recoveryDetail: "상태 확인이 끝날 때까지 새 토큰을 만들거나 환경변수를 바꾸지 않습니다.",
  },
  ready: {
    statusLabel: "서버 구성 감지",
    queueSummary: "Vercel 서버 토큰과 활성 AI 토큰 일치 · 실제 Gateway 호출은 별도 점검",
    recoveryTitle: "구성 감지와 실제 AI 호출 성공은 별도로 판정",
    recoveryDetail: "OIDC와 Supabase 큐가 보인다는 이유만으로 생성 가능 상태라고 표시하지 않습니다. 실제 호출 점검을 통과해야 AI Gateway 운영 연결을 확인한 것으로 판정합니다. 이 화면은 토큰을 발급·노출·복사하지 않으며 로컬 설치 명령도 제공하지 않습니다.",
  },
  token_mismatch: {
    statusLabel: "서버 토큰 불일치",
    queueSummary: "Vercel 서버 토큰과 Supabase 활성 AI 토큰이 다름",
    recoveryTitle: "마지막 정상 배포를 복원하거나 서버 전용으로 교체하세요",
    recoveryDetail: "새 상품 AI 요청은 차단됩니다. 방금 Vercel 환경변수나 배포가 바뀌었다면 원문을 꺼내지 말고 마지막 정상 배포를 복원하세요. 복원할 수 없으면 운영 배포·인증 체크리스트 §7의 서버 전용 교체 절차를 사용하며 이 화면에서 발급하거나 복사하지 않습니다.",
  },
  token_missing_or_expired: {
    statusLabel: "활성 AI 토큰 없음·만료",
    queueSummary: "Supabase에 만료되지 않은 활성 AI 토큰이 없음",
    recoveryTitle: "실행 중 작업을 확인한 뒤 서버 전용으로 교체하세요",
    recoveryDetail: "새 상품 AI 요청은 차단됩니다. 운영 배포·인증 체크리스트 §7에서 실행 중 lease를 먼저 확인한 뒤 승인된 운영 셸에서만 새 원문을 만들고, 원문은 Vercel sensitive environment에만 CLI 표준입력으로 전달하며 Supabase에는 해시와 지문만 등록합니다.",
  },
  status_unavailable: {
    statusLabel: "토큰 상태 조회 실패",
    queueSummary: "Supabase 토큰 상태를 확인하지 못함",
    recoveryTitle: "조회 실패를 만료로 간주해 교체하지 마세요",
    recoveryDetail: "Supabase 연결과 상태 RPC를 먼저 복구한 뒤 새로고침합니다. 실제 활성 토큰 상태가 확인되기 전에는 토큰 교체나 작업 재시도를 시작하지 않습니다.",
  },
  configuration_missing: {
    statusLabel: "서버 구성 확인 필요",
    queueSummary: "활성 AI 토큰 상태 확인 전 OIDC·Vercel 서버 구성이 준비되지 않음",
    recoveryTitle: "토큰 교체 전에 서버 구성을 분리 확인하세요",
    recoveryDetail: "Vercel 요청 범위의 OIDC, Supabase 서버 환경변수와 정확한 배포 프로젝트를 먼저 확인합니다. 이 상태만으로 활성 토큰의 존재 여부는 확인되지 않았으므로 원인을 분리하기 전 새 토큰을 발급하지 않습니다.",
  },
};

type AiJob = {
  id: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  attempt_count: number;
  image_count: number;
  product_description: string;
  product_url: string;
  error_message: string | null;
  has_result: boolean;
  has_hero: boolean;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

const jobStatusLabel: Record<AiJob["status"], string> = {
  queued: "대기",
  running: "실행 중",
  succeeded: "완료",
  failed: "실패",
  cancelled: "취소",
};

const jobKindLabel: Record<string, string> = {
  product_studio: "상품 상세페이지 생성",
  product_research: "상품정보 조사",
  support_reply: "고객 문의 답변 초안",
};

const productAiJobKinds = new Set(["product_studio", "product_research", "product_asset_regeneration"]);

function aiWorker(status: WorkerStatus | null) {
  if (!status) return null;
  return status.workers?.ai
    ?? (status.worker?.scope === "ai" || status.worker?.scope === undefined ? status.worker : null);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "확인 전";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "확인 전";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function validReadiness(value: unknown): value is ServerReadiness {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const coreValid = typeof candidate.available === "boolean"
    && typeof candidate.reason === "string"
    && typeof candidate.message === "string"
    && typeof candidate.checkedAt === "string";
  return coreValid && (candidate.available !== true || isStudioExecutionReady(candidate as ServerReadiness));
}

function gatewaySmokeStateFromReadiness(readiness: ServerReadiness): GatewaySmokeState {
  if (isStudioExecutionReady(readiness)) {
    return {
      status: "passed",
      message: "Vercel AI Gateway 실제 생성 호출이 확인된 실행 가능 상태입니다.",
      checkedAt: readiness.gatewayVerification?.checkedAt ?? readiness.checkedAt,
    };
  }
  if (readiness.reason === "gateway_verification_failed"
      && readiness.gatewayVerification?.status === "failed") {
    return {
      status: "failed",
      message: readiness.message,
      checkedAt: readiness.gatewayVerification.checkedAt,
    };
  }
  return {
    status: "idle",
    message: readiness.reason === "gateway_unverified"
      ? readiness.message
      : "실제 AI Gateway 호출은 아직 확인하지 않았습니다.",
    checkedAt: null,
  };
}

function resolveServerAiRuntimeState(
  readiness: ServerReadiness | null,
  serverWorker: WorkerSnapshot | null,
): ServerAiRuntimeState {
  if (!readiness) return "checking";
  if (readiness.configurationReady === true || readiness.available) return "ready";
  if (readiness.reason === "token_mismatch") return "token_mismatch";
  if (readiness.reason === "token_missing_or_expired") return "token_missing_or_expired";
  if (readiness.reason === "configuration_missing") return "configuration_missing";
  if (readiness.reason === "worker_missing" && !serverWorker) return "token_missing_or_expired";
  return "status_unavailable";
}

function confirmationCopy(pending: Exclude<PendingConfirmation, null>) {
  if (pending.kind === "runtime_activate") {
    return {
      title: "운영 일정 재검증·재시작 준비",
      detail: "현재 운영 배포의 무작업 점검 6개를 실행한 뒤 Supabase 운영 일정을 다시 시작합니다. 상품 게시를 자동 실행하지 않습니다.",
      executeLabel: "재검증·재시작 실행",
      danger: false,
    };
  }
  if (pending.request.action === "attest_adapter") {
    return {
      title: `${listingPublicationChannelLabels[pending.request.channel]} 어댑터 확인 준비`,
      detail: "서버가 확인한 현재 배포 SHA로 이 어댑터의 원격 상태 계약을 기록합니다. 상품 게시를 자동 실행하지 않습니다.",
      executeLabel: "어댑터 확인 기록",
      danger: false,
    };
  }
  if (pending.request.action === "attest_rechecker") {
    return {
      title: "게시 결과 재조회기 확인 준비",
      detail: "서버가 확인한 현재 배포 SHA로 공개 결과 재조회기 계약을 기록합니다. 상품 게시를 자동 실행하지 않습니다.",
      executeLabel: "재조회기 확인 기록",
      danger: false,
    };
  }
  if (pending.request.action === "open_gate") {
    return {
      title: "7개 채널 게시 게이트 열기 준비",
      detail: "게이트를 열면 이후 승인된 상품 등록·수정·중지 요청이 외부 채널로 전달될 수 있습니다. 준비 조건을 다시 확인한 뒤 실행하세요.",
      executeLabel: "게시 게이트 열기 실행",
      danger: true,
    };
  }
  if (pending.request.action === "open_channel_gate") {
    return {
      title: "Qoo10 전용 게시 게이트 열기 준비",
      detail: "현재 배포에서 검증된 Qoo10 상품 등록·수정·중지만 외부로 전달될 수 있습니다. 다른 6개 채널은 계속 차단됩니다.",
      executeLabel: "Qoo10만 열기 실행",
      danger: true,
    };
  }
  return {
    title: "7개 채널 게시 게이트 닫기 준비",
    detail: "새 상품 등록·수정·중지 요청이 외부 채널로 전달되지 않도록 게시 게이트를 닫습니다.",
    executeLabel: "게시 게이트 닫기 실행",
    danger: false,
  };
}

function InlineReleaseConfirmation({
  pending,
  working,
  onCancel,
  onExecute,
}: {
  pending: Exclude<PendingConfirmation, null>;
  working: boolean;
  onCancel: () => void;
  onExecute: () => Promise<void>;
}) {
  const copy = confirmationCopy(pending);
  return <div className="cli-release-confirmation" role="alertdialog" aria-label={copy.title}>
    <AlertTriangle size={16} />
    <span><b>{copy.title}</b><small>{copy.detail}</small></span>
    <div>
      <button type="button" className="credential-secondary" onClick={onCancel} disabled={working}>취소</button>
      <button type="button" className={`credential-primary${copy.danger ? " danger" : ""}`} onClick={() => void onExecute()} disabled={working}>{working ? <LoaderCircle className="spin" size={13} /> : <CheckCircle2 size={13} />}{working ? "처리 중" : copy.executeLabel}</button>
    </div>
  </div>;
}

export function AiCliRuntimeCard({ notify }: { notify: (message: string) => void }) {
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [readiness, setReadiness] = useState<ServerReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [jobsError, setJobsError] = useState("");
  const [workingJobId, setWorkingJobId] = useState("");
  const [gatewaySmoke, setGatewaySmoke] = useState<GatewaySmokeState>({
    status: "idle",
    message: "실제 AI Gateway 호출은 아직 확인하지 않았습니다.",
    checkedAt: null,
  });
  const [runtimeRelease, setRuntimeRelease] = useState<RuntimeReleaseState>({
    status: "idle",
    message: "배포 후 무작업 점검 6개와 Supabase 일정 상태를 함께 확인합니다.",
  });
  const [listingRelease, setListingRelease] = useState<ListingReleaseState>({
    status: "checking",
    message: "현재 배포와 7개 채널 게시 게이트 상태를 확인하고 있습니다.",
    currentRelease: null,
    gate: null,
    readyForOpen: false,
    readyForQoo10Open: false,
  });
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>(null);

  const authenticatedFetch = useCallback(async (input: string, init?: RequestInit) => {
    const { data } = await createClient().auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error("운영 런타임 관리는 관리자 로그인이 필요합니다.");
    return fetch(input, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}`, ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  }, []);

  const load = useCallback(async (preserveGatewaySmoke = false) => {
    setLoading(true);
    try {
      const [statusResponse, jobsResponse, readinessResponse, listingReleaseResponse] = await Promise.all([
        authenticatedFetch("/api/admin/ai-worker-token"),
        authenticatedFetch("/api/admin/ai-jobs?limit=12"),
        authenticatedFetch("/api/ai/product-studio"),
        authenticatedFetch("/api/admin/listing-publication-release"),
      ]);
      const statusPayload = await statusResponse.json().catch(() => ({ message: "런타임 상태 응답을 읽지 못했습니다." })) as WorkerStatus & { message?: string };
      const jobsPayload = await jobsResponse.json().catch(() => ({ message: "작업 이력 응답을 읽지 못했습니다.", jobs: [] })) as { message?: string; jobs?: AiJob[] };
      const readinessPayload = await readinessResponse.json().catch(() => null) as unknown;
      const listingReleasePayload = await listingReleaseResponse.json().catch(() => ({ message: "게시 릴리스 상태 응답을 읽지 못했습니다." })) as ListingReleasePayload;
      if (!statusResponse.ok) throw new Error(statusPayload.message ?? "런타임 상태를 불러오지 못했습니다.");
      setStatus(statusPayload);
      const nextReadiness: ServerReadiness = validReadiness(readinessPayload) ? readinessPayload : {
        available: false,
        reason: "status_unavailable",
        message: "Vercel 서버 AI 연결 상태를 확인하지 못했습니다.",
        checkedAt: new Date().toISOString(),
      };
      setReadiness(nextReadiness);
      if (!preserveGatewaySmoke) setGatewaySmoke(gatewaySmokeStateFromReadiness(nextReadiness));
      setError("");
      if (jobsResponse.ok) {
        setJobs(jobsPayload.jobs ?? []);
        setJobsError("");
      } else {
        setJobsError(jobsPayload.message ?? "작업 이력을 불러오지 못했습니다.");
      }
      setListingRelease({
        status: listingReleaseResponse.ok && listingReleasePayload.gate ? "ready" : "failed",
        message: listingReleasePayload.message ?? (listingReleaseResponse.ok
          ? "현재 배포의 게시 릴리스 상태를 확인했습니다."
          : "게시 릴리스 상태를 불러오지 못했습니다."),
        currentRelease: listingReleasePayload.runtimeRelease?.currentRelease ?? null,
        gate: listingReleasePayload.gate ?? null,
        readyForOpen: listingReleasePayload.readyForOpen === true,
        readyForQoo10Open: listingReleasePayload.readyForQoo10Open === true,
      });
    } catch (loadError) {
      setReadiness({
        available: false,
        reason: "status_unavailable",
        message: "Vercel 서버 AI 준비 상태를 확인할 수 없습니다.",
        checkedAt: new Date().toISOString(),
      });
      setListingRelease((current) => ({
        ...current,
        status: "failed",
        message: "현재 배포의 게시 릴리스 상태를 확인하지 못했습니다.",
        readyForOpen: false,
        readyForQoo10Open: false,
      }));
      setError(loadError instanceof Error ? loadError.message : "런타임 상태를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [authenticatedFetch]);

  const controlJob = async (job: AiJob, action: "retry" | "cancel") => {
    const actionLabel = action === "retry" ? "다시 실행" : "취소";
    if (action === "retry" && productAiJobKinds.has(job.kind) && !isStudioExecutionReady(readiness)) {
      notify(readiness?.message ?? "AI Gateway 실제 호출 점검을 통과한 뒤 상품 AI 작업을 다시 실행해 주세요.");
      return;
    }
    if (!window.confirm(`이 AI 작업을 ${actionLabel}할까요?`)) return;
    setWorkingJobId(job.id);
    setJobsError("");
    try {
      const response = await authenticatedFetch("/api/admin/ai-jobs", {
        method: "POST",
        body: JSON.stringify({ jobId: job.id, action }),
      });
      const payload = await response.json().catch(() => ({ message: "작업 제어 응답을 읽지 못했습니다." })) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? `AI 작업을 ${actionLabel}하지 못했습니다.`);
      notify(payload.message ?? `AI 작업을 ${actionLabel}했습니다.`);
      await load();
    } catch (controlError) {
      setJobsError(controlError instanceof Error ? controlError.message : `AI 작업을 ${actionLabel}하지 못했습니다.`);
    } finally {
      setWorkingJobId("");
    }
  };

  const verifyGateway = async () => {
    setGatewaySmoke({ status: "checking", message: "Vercel AI Gateway 실제 호출을 확인하고 있습니다.", checkedAt: null });
    try {
      const response = await authenticatedFetch("/api/admin/server-runtime-smoke", {
        method: "POST",
        body: JSON.stringify({ action: "ai_gateway_smoke" }),
      });
      const payload = await response.json().catch(() => ({})) as GatewaySmokePayload;
      const checkedAt = new Date().toISOString();
      if (response.ok && payload.ok === true) {
        const message = "Vercel OIDC 기반 AI Gateway 실제 생성 호출을 확인했습니다.";
        setGatewaySmoke({ status: "passed", message, checkedAt });
        await load(true);
        notify(message);
        return;
      }
      const message = payload.diagnostic?.code === "customer_verification_required"
        ? "Vercel AI Gateway 계정 확인이 필요합니다. Vercel 결제수단·고객 확인을 마친 뒤 다시 점검해 주세요."
        : payload.diagnostic?.code === "billing_required"
          ? "Vercel AI Gateway 사용 한도 또는 결제 상태 확인이 필요합니다."
          : payload.diagnostic?.code === "authentication_error"
            ? "Vercel OIDC 인증 연결을 확인하지 못했습니다. 배포 프로젝트의 OIDC 설정을 확인해 주세요."
            : "Vercel AI Gateway 실제 생성 호출에 실패했습니다. 운영 로그와 Gateway 상태를 확인해 주세요.";
      setGatewaySmoke({ status: "failed", message, checkedAt });
      await load(true);
      notify(message);
    } catch {
      const message = "Vercel AI Gateway 실제 호출 점검 요청을 완료하지 못했습니다.";
      setGatewaySmoke({ status: "failed", message, checkedAt: new Date().toISOString() });
      notify(message);
    }
  };

  const executeRuntimeReleaseActivation = async () => {
    setRuntimeRelease({ status: "checking", message: "현재 운영 배포를 무작업 점검한 뒤 Supabase 일정을 재시작하고 있습니다." });
    try {
      const response = await authenticatedFetch("/api/admin/serverless-runtime-release", {
        method: "POST",
        body: JSON.stringify({ action: "canary_activate" }),
      });
      const payload = await response.json().catch(() => ({})) as { message?: string };
      const message = payload.message ?? (response.ok
        ? "운영 일정 재검증과 재시작을 완료했습니다."
        : "운영 일정 재검증을 완료하지 못했습니다.");
      setRuntimeRelease({ status: response.ok ? "passed" : "failed", message });
      if (response.ok) await load(true);
      notify(message);
    } catch {
      const message = "운영 일정 재검증 요청을 완료하지 못했습니다. 일정 상태를 다시 확인해 주세요.";
      setRuntimeRelease({ status: "failed", message });
      notify(message);
    }
  };

  const executeListingReleaseAction = async (request: ListingReleaseAction) => {
    setListingRelease((current) => ({
      ...current,
      status: "working",
      message: "게시 릴리스 상태를 변경하고 결과를 다시 확인하고 있습니다.",
    }));
    try {
      const response = await authenticatedFetch("/api/admin/listing-publication-release", {
        method: "POST",
        body: JSON.stringify(request),
      });
      const payload = await response.json().catch(() => ({ message: "게시 릴리스 변경 응답을 읽지 못했습니다." })) as ListingReleasePayload;
      const message = payload.message ?? (response.ok
        ? "게시 릴리스 상태를 변경했습니다."
        : "게시 릴리스 상태를 변경하지 못했습니다.");
      setListingRelease((current) => ({
        status: response.ok && payload.gate ? "ready" : "failed",
        message,
        currentRelease: payload.runtimeRelease?.currentRelease ?? current.currentRelease,
        gate: payload.gate ?? current.gate,
        readyForOpen: payload.readyForOpen === true,
        readyForQoo10Open: payload.readyForQoo10Open === true,
      }));
      notify(message);
    } catch {
      const message = "게시 릴리스 관리 요청을 완료하지 못했습니다. 현재 상태를 다시 확인해 주세요.";
      setListingRelease((current) => ({
        ...current,
        status: "failed",
        message,
        readyForOpen: false,
        readyForQoo10Open: false,
      }));
      notify(message);
    }
  };

  const executePendingConfirmation = async () => {
    const pending = pendingConfirmation;
    if (!pending) return;
    setPendingConfirmation(null);
    if (pending.kind === "runtime_activate") {
      await executeRuntimeReleaseActivation();
      return;
    }
    await executeListingReleaseAction(pending.request);
  };

  const recoverProduct = async (job: AiJob) => {
    setWorkingJobId(job.id);
    setJobsError("");
    try {
      const response = await authenticatedFetch("/api/operations/snapshot", {
        method: "POST",
        body: JSON.stringify({ action: "product_create", jobId: job.id }),
      });
      const payload = await response.json().catch(() => ({ message: "상품 원장 연결 응답을 읽지 못했습니다." })) as { id?: string | null; message?: string };
      if (!response.ok || typeof payload.id !== "string") throw new Error(payload.message ?? "완료된 AI 작업을 상품 원장에 연결하지 못했습니다.");
      notify("완료된 AI 작업을 상품 원장에 연결했습니다.");
    } catch (recoverError) {
      setJobsError(recoverError instanceof Error ? recoverError.message : "완료된 AI 작업을 상품 원장에 연결하지 못했습니다.");
    } finally {
      setWorkingJobId("");
    }
  };

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 15_000);
    return () => { window.clearTimeout(initialLoad); window.clearInterval(interval); };
  }, [load]);

  const serverWorker = aiWorker(status);
  const serverConfigured = readiness?.configurationReady === true;
  const serverReady = isStudioExecutionReady(readiness);
  const gatewayVerified = serverReady;
  const queueReady = serverConfigured && Boolean(serverWorker);
  const runtimeState = resolveServerAiRuntimeState(readiness, serverWorker);
  const runtimeGuidance = serverAiRuntimeGuidance[runtimeState];
  const runtimeStatusLabel = gatewayVerified
    ? "AI Gateway 실호출 확인"
    : gatewaySmoke.status === "failed"
      ? "AI Gateway 확인 필요"
      : runtimeGuidance.statusLabel;
  const listingGate = listingRelease.gate;
  const listingReleaseBusy = listingRelease.status === "working";
  const exactPublicationReleaseReady = Boolean(
    listingRelease.currentRelease
      && listingGate?.publicationReleaseConsistent
      && listingGate.attestedRelease === listingRelease.currentRelease,
  );
  const exactRuntimeReleaseReady = Boolean(
    listingRelease.currentRelease
      && listingGate?.runtimeReleaseMatches
      && listingGate.activeRuntimeRelease === listingRelease.currentRelease,
  );
  const exactQoo10ReleaseReady = Boolean(
    listingRelease.currentRelease
      && listingGate?.qoo10ReleaseConsistent
      && listingGate.qoo10AttestedRelease === listingRelease.currentRelease,
  );
  const anyListingGateEffective = Boolean(
    listingGate?.effectiveOpen || listingGate?.qoo10EffectiveOpen,
  );

  return <section className="cli-runtime-card">
    <header>
      <div className="cli-runtime-title"><span><SquareTerminal size={18} /></span><div><small>SERVER-ONLY VERCEL AI</small><h3>서버 AI 스튜디오 런타임</h3><p>상품 분석과 이미지 제작은 Vercel Node·AI Gateway OIDC·Supabase 비공개 큐에서 실행됩니다. 운영에 Mac 또는 로컬 상품 작업자는 필요하지 않습니다.</p></div></div>
      <span className={`cli-runtime-state ${serverReady && gatewayVerified ? "online" : "offline"}`}><i />{runtimeStatusLabel}</span>
    </header>

    <div className="cli-server-runtime-flow" aria-label="서버 AI 실행 경로">
      <article><span><i className={gatewayVerified ? "online" : "missing"} />Vercel Node + OIDC</span><small>{gatewayVerified ? "실제 AI Gateway 생성 호출 확인" : serverConfigured ? "OIDC 인증 수단 감지 · 실제 호출은 아래에서 점검" : "OIDC·AI Gateway 구성 확인 필요"}</small></article>
      <article><span><i className={queueReady ? "online" : "missing"} />Supabase 비공개 큐</span><small>{runtimeGuidance.queueSummary}{serverWorker ? ` · 만료 ${formatDate(serverWorker.expires_at)}` : ""}</small></article>
      <article><span><i className={gatewayVerified ? "ready" : "missing"} />운영 복구 게이트</span><small>{gatewayVerified ? "실제 Gateway 호출 통과 · 큐 복구 상태는 운영 원장에서 확인" : "구성 감지만으로 성공 처리하지 않음 · 실제 호출 점검 필요 · 토큰 불일치·만료는 자동 복구하지 않음"}</small></article>
    </div>

    <div className="cli-runtime-grid">
      <article><Cpu size={16} /><span><small>상품 제작 실행 위치</small><b>Vercel Node · AI Gateway</b><em>로컬 프로세스 없이 서버에서 실행</em></span></article>
      <article><Clock3 size={16} /><span><small>서버 연결 확인</small><b>{formatDate(readiness?.checkedAt)}</b><em>{readiness?.message ?? "서버 연결 상태 확인 중"}</em></span></article>
      <article><RefreshCw size={16} /><span><small>현재 작업</small><b>{Number(status?.running ?? 0)} 실행 · {Number(status?.queued ?? 0)} 대기</b><em>15초마다 자동 갱신</em></span></article>
      <article><CheckCircle2 size={16} /><span><small>오늘 처리</small><b>{Number(status?.succeeded_today ?? 0)} 성공 · {Number(status?.failed_today ?? 0)} 실패</b><em>16개 이미지 + 26개국 현지화 계약</em></span></article>
    </div>

    <div className="cli-runtime-actions cli-server-runtime-notice" role="status" aria-live="polite">
      <aside>{gatewayVerified ? <ShieldCheck size={15} /> : <AlertTriangle size={15} />}<span><b>{gatewaySmoke.status === "idle" ? runtimeGuidance.recoveryTitle : gatewaySmoke.message}</b><small>{gatewaySmoke.checkedAt ? `실제 호출 점검 ${formatDate(gatewaySmoke.checkedAt)}` : runtimeGuidance.recoveryDetail}</small></span></aside>
      <button type="button" className="credential-secondary cli-gateway-smoke-button" onClick={() => void verifyGateway()} disabled={!serverConfigured || gatewaySmoke.status === "checking"}>{gatewaySmoke.status === "checking" ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}{gatewaySmoke.status === "checking" ? "실제 호출 확인 중" : "AI Gateway 실제 호출 점검"}</button>
      <button type="button" className="credential-secondary cli-gateway-smoke-button" onClick={() => setPendingConfirmation({ kind: "runtime_activate" })} disabled={runtimeRelease.status === "checking" || listingReleaseBusy} title={runtimeRelease.message}>{runtimeRelease.status === "checking" ? <LoaderCircle className="spin" size={13} /> : runtimeRelease.status === "passed" ? <CheckCircle2 size={13} /> : <RefreshCw size={13} />}{runtimeRelease.status === "checking" ? "운영 일정 재검증 중" : "운영 일정 재검증·재시작"}</button>
    </div>

    {pendingConfirmation?.kind === "runtime_activate" && <InlineReleaseConfirmation pending={pendingConfirmation} working={runtimeRelease.status === "checking"} onCancel={() => setPendingConfirmation(null)} onExecute={executePendingConfirmation} />}

    <section className="cli-listing-release" aria-labelledby="listing-release-heading">
      <header>
        <div><ShieldCheck size={17} /><span><small>EXACT-SHA PUBLICATION CONTROL</small><h4 id="listing-release-heading">7개 채널 게시 릴리스 게이트</h4><p>서버가 확인한 현재 배포 SHA로만 어댑터와 재조회기를 기록합니다. 이 화면에서 SHA를 입력하거나 자동 게시하지 않습니다.</p></span></div>
        <span className={`cli-listing-release-state ${anyListingGateEffective ? "open" : "closed"}`}><i />{listingGate?.effectiveOpen ? "7개 채널 게시 허용" : listingGate?.qoo10EffectiveOpen ? "Qoo10만 게시 허용" : listingGate?.open ? "조건 불일치 · 차단" : "외부 게시 차단"}</span>
      </header>

      <div className="cli-listing-release-summary">
        <article><small>현재 서버 배포 SHA</small><code title={listingRelease.currentRelease ?? undefined}>{listingRelease.currentRelease ?? "확인 불가"}</code><em>{listingRelease.currentRelease ? "브라우저 입력 없이 서버에서 확인" : "attestation·게이트 열기 차단"}</em></article>
        <article><small>7개 게시 어댑터</small><b>{listingGate?.publicationAdaptersReady ?? 0} / {listingPublicationChannels.length}</b><em className={exactPublicationReleaseReady ? "ok" : "waiting"}>{exactPublicationReleaseReady ? "현재 SHA 일치" : "현재 SHA 확인 필요"}</em></article>
        <article><small>Qoo10 단일 채널</small><b>{listingGate?.qoo10AdapterReady ? "어댑터 확인됨" : "확인 필요"}</b><em className={exactQoo10ReleaseReady ? "ok" : "waiting"}>{exactQoo10ReleaseReady ? "현재 SHA 일치" : "Qoo10 SHA 확인 필요"}</em></article>
        <article><small>게시 결과 재조회기</small><b>{listingGate?.publicationRecheckerReady ? "확인됨" : "확인 필요"}</b><em className={listingGate?.publicationRecheckerReady && exactPublicationReleaseReady ? "ok" : "waiting"}>{listingGate?.publicationRecheckerReady && exactPublicationReleaseReady ? "현재 SHA 일치" : "재조회 계약 확인 필요"}</em></article>
        <article><small>활성 서버 런타임</small><b>{exactRuntimeReleaseReady ? "현재 SHA 일치" : "재검증 필요"}</b><em className={exactRuntimeReleaseReady ? "ok" : "waiting"}>{listingGate?.activeRuntimeRelease ?? "활성 릴리스 확인 불가"}</em></article>
      </div>

      <div className="cli-listing-release-blockers">
        <span className={(listingGate?.queuedOrRunning ?? 0) === 0 ? "ok" : "blocked"}>게시 작업 {listingGate?.queuedOrRunning ?? 0}건</span>
        <span className={(listingGate?.reconciliationRequired ?? 0) === 0 ? "ok" : "blocked"}>조정 필요 {listingGate?.reconciliationRequired ?? 0}건</span>
        <span className={(listingGate?.orphanPendingReviews ?? 0) === 0 ? "ok" : "blocked"}>고아 심사대기 {listingGate?.orphanPendingReviews ?? 0}건</span>
        <span className={listingRelease.readyForOpen ? "ok" : "blocked"}>{listingRelease.readyForOpen ? "게이트 개방 조건 충족" : "게이트 개방 조건 미충족"}</span>
        <span className={listingRelease.readyForQoo10Open ? "ok" : "blocked"}>{listingRelease.readyForQoo10Open ? "Qoo10 단일 개방 조건 충족" : "Qoo10 단일 개방 조건 미충족"}</span>
      </div>

      <div className="cli-listing-release-controls">
        <div className="cli-listing-adapter-controls">
          <b>어댑터별 현재 SHA 확인</b>
          <small>각 채널의 원격 상태 계약을 검증한 뒤 해당 버튼을 두 단계로 실행하세요.</small>
          <div>{listingPublicationChannels.map((channel) => <button key={channel} type="button" className="credential-secondary" onClick={() => setPendingConfirmation({ kind: "listing_release", request: { action: "attest_adapter", channel } })} disabled={!listingRelease.currentRelease || listingReleaseBusy}>{listingPublicationChannelLabels[channel]} 확인 기록</button>)}</div>
        </div>
        <div className="cli-listing-gate-controls">
          <button type="button" className="credential-secondary" onClick={() => setPendingConfirmation({ kind: "listing_release", request: { action: "attest_rechecker" } })} disabled={!listingRelease.currentRelease || listingReleaseBusy}>재조회기 확인 기록</button>
          <button type="button" className="credential-primary" onClick={() => setPendingConfirmation({ kind: "listing_release", request: { action: "open_channel_gate", channel: "qoo10" } })} disabled={!listingRelease.readyForQoo10Open || listingReleaseBusy || listingGate?.qoo10EffectiveOpen === true}>Qoo10만 열기</button>
          <button type="button" className="credential-primary" onClick={() => setPendingConfirmation({ kind: "listing_release", request: { action: "open_gate" } })} disabled={!listingRelease.readyForOpen || listingReleaseBusy || listingGate?.effectiveOpen === true}>게시 게이트 열기</button>
          <button type="button" className="credential-secondary" onClick={() => setPendingConfirmation({ kind: "listing_release", request: { action: "close_gate" } })} disabled={listingReleaseBusy}>게시 게이트 닫기</button>
        </div>
      </div>

      {pendingConfirmation?.kind === "listing_release" && <InlineReleaseConfirmation pending={pendingConfirmation} working={listingReleaseBusy} onCancel={() => setPendingConfirmation(null)} onExecute={executePendingConfirmation} />}
      <p className={`cli-listing-release-message ${listingRelease.status}`} role="status" aria-live="polite">{listingRelease.status === "checking" || listingRelease.status === "working" ? <LoaderCircle className="spin" size={13} /> : listingRelease.status === "failed" ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}{listingRelease.message}</p>
    </section>

    <div className="cli-job-history">
      <div className="cli-job-history-heading"><span><History size={15} /><b>최근 AI 작업</b></span><small>요청 이미지·시도 횟수·결과 상태를 운영 화면에서 관리합니다.</small></div>
      {jobs.length > 0 ? <div className="cli-job-list">
        {jobs.map((job) => <article key={job.id} className="cli-job-row">
          <div className="cli-job-main">
            <span className={`cli-job-status ${job.status}`}>{jobStatusLabel[job.status]}</span>
            <div><b>{job.product_description || jobKindLabel[job.kind] || "AI 작업"}</b><small>{job.kind === "product_studio" ? `${job.image_count}개 이미지 · ` : ""}{job.attempt_count}회 시도 · {formatDate(job.created_at)}</small>{job.error_message && <em>{job.error_message}</em>}</div>
          </div>
          <div className="cli-job-controls">
            {job.status === "succeeded" && <><span className="cli-job-output">{job.has_hero ? "대표 이미지 포함" : job.kind === "support_reply" ? "답변 초안 완료" : job.has_result ? "분석 완료" : "완료"}</span>{job.kind === "product_studio" && <button type="button" onClick={() => void recoverProduct(job)} disabled={workingJobId === job.id}>{workingJobId === job.id ? <LoaderCircle className="spin" size={13} /> : <DatabaseZap size={13} />}상품 원장 연결</button>}</>}
            {(job.status === "failed" || job.status === "cancelled") && <button type="button" onClick={() => void controlJob(job, "retry")} disabled={workingJobId === job.id || productAiJobKinds.has(job.kind) && !gatewayVerified} title={productAiJobKinds.has(job.kind) && !gatewayVerified ? readiness?.message : undefined}>{workingJobId === job.id ? <LoaderCircle className="spin" size={13} /> : <RotateCcw size={13} />}{productAiJobKinds.has(job.kind) && !gatewayVerified ? "Gateway 점검 필요" : "다시 실행"}</button>}
            {(job.status === "queued" || job.status === "running") && <button type="button" className="danger" onClick={() => void controlJob(job, "cancel")} disabled={workingJobId === job.id}>{workingJobId === job.id ? <LoaderCircle className="spin" size={13} /> : <Ban size={13} />}취소</button>}
          </div>
        </article>)}
      </div> : !loading && !jobsError && <p className="cli-job-empty">아직 생성 요청이 없습니다. 상품 AI 스튜디오에서 첫 작업을 실행해 보세요.</p>}
      {jobsError && <p className="cli-runtime-error"><AlertTriangle size={14} />{jobsError}</p>}
    </div>

    {error && <p className="cli-runtime-error"><AlertTriangle size={14} />{error}</p>}
    {loading && !status && <div className="cli-runtime-loading"><LoaderCircle className="spin" size={15} />운영 런타임 상태 확인 중</div>}
  </section>;
}
