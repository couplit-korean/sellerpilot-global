"use client";

import { AlertTriangle, Ban, CheckCircle2, Clock3, Cpu, DatabaseZap, History, LoaderCircle, RefreshCw, RotateCcw, ShieldCheck, SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";

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

type ServerReadiness = {
  available: boolean;
  reason: string;
  message: string;
  checkedAt: string;
};

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
    statusLabel: "서버 AI 연결",
    queueSummary: "Vercel 서버 토큰과 활성 AI 토큰 일치",
    recoveryTitle: "운영 비밀값은 서버에서만 관리",
    recoveryDetail: "SELLERPILOT_AI_WORKER_TOKEN과 AI 공급자 인증은 Vercel sensitive environment에만 둡니다. 이 화면은 토큰을 발급·노출·복사하지 않으며 로컬 설치 명령도 제공하지 않습니다.",
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
  return typeof candidate.available === "boolean"
    && typeof candidate.reason === "string"
    && typeof candidate.message === "string"
    && typeof candidate.checkedAt === "string";
}

function resolveServerAiRuntimeState(
  readiness: ServerReadiness | null,
  serverWorker: WorkerSnapshot | null,
): ServerAiRuntimeState {
  if (!readiness) return "checking";
  if (readiness.available) return "ready";
  if (readiness.reason === "token_mismatch") return "token_mismatch";
  if (readiness.reason === "token_missing_or_expired") return "token_missing_or_expired";
  if (readiness.reason === "configuration_missing") return "configuration_missing";
  if (readiness.reason === "worker_missing" && !serverWorker) return "token_missing_or_expired";
  return "status_unavailable";
}

export function AiCliRuntimeCard({ notify }: { notify: (message: string) => void }) {
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [readiness, setReadiness] = useState<ServerReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [jobsError, setJobsError] = useState("");
  const [workingJobId, setWorkingJobId] = useState("");

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statusResponse, jobsResponse, readinessResponse] = await Promise.all([
        authenticatedFetch("/api/admin/ai-worker-token"),
        authenticatedFetch("/api/admin/ai-jobs?limit=12"),
        authenticatedFetch("/api/ai/product-studio"),
      ]);
      const statusPayload = await statusResponse.json().catch(() => ({ message: "런타임 상태 응답을 읽지 못했습니다." })) as WorkerStatus & { message?: string };
      const jobsPayload = await jobsResponse.json().catch(() => ({ message: "작업 이력 응답을 읽지 못했습니다.", jobs: [] })) as { message?: string; jobs?: AiJob[] };
      const readinessPayload = await readinessResponse.json().catch(() => null) as unknown;
      if (!statusResponse.ok) throw new Error(statusPayload.message ?? "런타임 상태를 불러오지 못했습니다.");
      setStatus(statusPayload);
      setReadiness(validReadiness(readinessPayload) ? readinessPayload : {
        available: false,
        reason: readinessResponse.ok ? "invalid_response" : "status_unavailable",
        message: "Vercel 서버 AI 연결 상태를 확인하지 못했습니다.",
        checkedAt: new Date().toISOString(),
      });
      setError("");
      if (jobsResponse.ok) {
        setJobs(jobsPayload.jobs ?? []);
        setJobsError("");
      } else {
        setJobsError(jobsPayload.message ?? "작업 이력을 불러오지 못했습니다.");
      }
    } catch (loadError) {
      setReadiness({
        available: false,
        reason: "status_unavailable",
        message: "Vercel 서버 AI 준비 상태를 확인할 수 없습니다.",
        checkedAt: new Date().toISOString(),
      });
      setError(loadError instanceof Error ? loadError.message : "런타임 상태를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [authenticatedFetch]);

  const controlJob = async (job: AiJob, action: "retry" | "cancel") => {
    const actionLabel = action === "retry" ? "다시 실행" : "취소";
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
  const serverReady = readiness?.available === true;
  const queueReady = serverReady && Boolean(serverWorker);
  const runtimeState = resolveServerAiRuntimeState(readiness, serverWorker);
  const runtimeGuidance = serverAiRuntimeGuidance[runtimeState];

  return <section className="cli-runtime-card">
    <header>
      <div className="cli-runtime-title"><span><SquareTerminal size={18} /></span><div><small>SERVER-ONLY VERCEL AI</small><h3>서버 AI 스튜디오 런타임</h3><p>상품 분석과 이미지 제작은 Vercel Node·AI Gateway OIDC·Supabase 비공개 큐에서 실행됩니다. 운영에 Mac 또는 로컬 상품 작업자는 필요하지 않습니다.</p></div></div>
      <span className={`cli-runtime-state ${serverReady ? "online" : "offline"}`}><i />{runtimeGuidance.statusLabel}</span>
    </header>

    <div className="cli-server-runtime-flow" aria-label="서버 AI 실행 경로">
      <article><span><i className={serverReady ? "online" : "missing"} />Vercel Node + OIDC</span><small>{serverReady ? "요청 범위에서 AI Gateway 인증 확인" : "OIDC·AI Gateway 연결 확인 필요"}</small></article>
      <article><span><i className={queueReady ? "online" : "missing"} />Supabase 비공개 큐</span><small>{runtimeGuidance.queueSummary}{serverWorker ? ` · 만료 ${formatDate(serverWorker.expires_at)}` : ""}</small></article>
      <article><span><i className={serverReady ? "ready" : "missing"} />운영 복구 게이트</span><small>{serverReady ? "5분 큐 복구 일정 · 운영 활성 여부는 배포 canary에서 확인" : "토큰 불일치·만료는 자동 복구하지 않음 · 운영 체크리스트 §7 확인"}</small></article>
    </div>

    <div className="cli-runtime-grid">
      <article><Cpu size={16} /><span><small>상품 제작 실행 위치</small><b>Vercel Node · AI Gateway</b><em>로컬 프로세스 없이 서버에서 실행</em></span></article>
      <article><Clock3 size={16} /><span><small>서버 연결 확인</small><b>{formatDate(readiness?.checkedAt)}</b><em>{readiness?.message ?? "서버 연결 상태 확인 중"}</em></span></article>
      <article><RefreshCw size={16} /><span><small>현재 작업</small><b>{Number(status?.running ?? 0)} 실행 · {Number(status?.queued ?? 0)} 대기</b><em>15초마다 자동 갱신</em></span></article>
      <article><CheckCircle2 size={16} /><span><small>오늘 처리</small><b>{Number(status?.succeeded_today ?? 0)} 성공 · {Number(status?.failed_today ?? 0)} 실패</b><em>16개 이미지 + 26개국 현지화 계약</em></span></article>
    </div>

    <div className="cli-runtime-actions cli-server-runtime-notice" role="status" aria-live="polite">
      <aside>{serverReady ? <ShieldCheck size={15} /> : <AlertTriangle size={15} />}<span><b>{runtimeGuidance.recoveryTitle}</b><small>{runtimeGuidance.recoveryDetail}</small></span></aside>
    </div>

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
            {(job.status === "failed" || job.status === "cancelled") && <button type="button" onClick={() => void controlJob(job, "retry")} disabled={workingJobId === job.id}>{workingJobId === job.id ? <LoaderCircle className="spin" size={13} /> : <RotateCcw size={13} />}다시 실행</button>}
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
