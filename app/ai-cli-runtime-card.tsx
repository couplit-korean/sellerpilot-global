"use client";

import { AlertTriangle, Ban, CheckCircle2, Clock3, Copy, Cpu, History, KeyRound, LoaderCircle, RefreshCw, RotateCcw, ShieldCheck, SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";

type WorkerStatus = {
  worker: {
    label: string;
    fingerprint: string;
    expires_at: string;
    last_seen_at: string | null;
    last_version: string | null;
  } | null;
  queued: number;
  running: number;
  succeeded_today: number;
  failed_today: number;
};

type IssuedToken = {
  token: string;
  fingerprint: string;
  expiresAt: string;
  message: string;
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

function formatDate(value: string | null) {
  if (!value) return "아직 접속 없음";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function isOnline(lastSeenAt: string | null) {
  return Boolean(lastSeenAt && Date.now() - new Date(lastSeenAt).getTime() < 30_000);
}

export function AiCliRuntimeCard({ notify }: { notify: (message: string) => void }) {
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [jobsError, setJobsError] = useState("");
  const [workingJobId, setWorkingJobId] = useState("");

  const authenticatedFetch = useCallback(async (input: string, init?: RequestInit) => {
    const { data } = await createClient().auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error("CLI 작업자 관리는 관리자 로그인이 필요합니다.");
    return fetch(input, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}`, ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statusResponse, jobsResponse] = await Promise.all([
        authenticatedFetch("/api/admin/ai-worker-token"),
        authenticatedFetch("/api/admin/ai-jobs?limit=12"),
      ]);
      const statusPayload = await statusResponse.json().catch(() => ({ message: "CLI 상태 응답을 읽지 못했습니다." })) as WorkerStatus & { message?: string };
      const jobsPayload = await jobsResponse.json().catch(() => ({ message: "작업 이력 응답을 읽지 못했습니다.", jobs: [] })) as { message?: string; jobs?: AiJob[] };
      if (!statusResponse.ok) throw new Error(statusPayload.message ?? "CLI 상태를 불러오지 못했습니다.");
      setStatus(statusPayload);
      setError("");
      if (jobsResponse.ok) {
        setJobs(jobsPayload.jobs ?? []);
        setJobsError("");
      } else {
        setJobsError(jobsPayload.message ?? "작업 이력을 불러오지 못했습니다.");
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "CLI 상태를 불러오지 못했습니다.");
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

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 15_000);
    return () => { window.clearTimeout(initialLoad); window.clearInterval(interval); };
  }, [load]);

  const issueToken = async () => {
    if (status?.worker && !window.confirm("기존 CLI 작업자 토큰은 즉시 폐기됩니다. 새 토큰으로 교체할까요?")) return;
    setIssuing(true);
    setError("");
    try {
      const response = await authenticatedFetch("/api/admin/ai-worker-token", {
        method: "POST",
        body: JSON.stringify({ label: "SellerPilot Mac · ChatGPT CLI", expiresInDays }),
      });
      const payload = await response.json().catch(() => ({ message: "토큰 발급 응답을 읽지 못했습니다." })) as IssuedToken;
      if (!response.ok || !payload.token) throw new Error(payload.message ?? "CLI 작업자 토큰을 발급하지 못했습니다.");
      setIssued(payload);
      notify("CLI 작업자 토큰을 발급했습니다. 지금 한 번만 복사할 수 있습니다.");
      await load();
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : "CLI 작업자 토큰을 발급하지 못했습니다.");
    } finally {
      setIssuing(false);
    }
  };

  const copy = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify(message);
    } catch {
      notify("클립보드 권한이 없어 복사하지 못했습니다. 값을 직접 선택해 주세요.");
    }
  };

  const online = Number(status?.running ?? 0) > 0 || isOnline(status?.worker?.last_seen_at ?? null);

  return <section className="cli-runtime-card">
    <header>
      <div className="cli-runtime-title"><span><SquareTerminal size={18} /></span><div><small>CHATGPT CLI RUNTIME</small><h3>로컬 Codex AI 작업자</h3><p>ChatGPT OAuth는 Mac에만 남고, Vercel은 암호화된 작업 큐만 전달합니다.</p></div></div>
      <span className={`cli-runtime-state ${online ? "online" : "offline"}`}><i />{online ? "실시간 연결" : status?.worker ? "작업자 대기" : "토큰 미발급"}</span>
    </header>

    <div className="cli-runtime-grid">
      <article><Cpu size={16} /><span><small>작업자</small><b>{status?.worker?.label ?? "연결 필요"}</b><em>{status?.worker?.last_version ?? "Codex CLI 로그인 후 실행"}</em></span></article>
      <article><Clock3 size={16} /><span><small>마지막 신호</small><b>{formatDate(status?.worker?.last_seen_at ?? null)}</b><em>{status?.worker ? `토큰 ${status.worker.fingerprint} · 만료 ${formatDate(status.worker.expires_at)}` : "토큰을 먼저 발급하세요"}</em></span></article>
      <article><RefreshCw size={16} /><span><small>현재 작업</small><b>{Number(status?.running ?? 0)} 실행 · {Number(status?.queued ?? 0)} 대기</b><em>15초마다 자동 갱신</em></span></article>
      <article><CheckCircle2 size={16} /><span><small>오늘 처리</small><b>{Number(status?.succeeded_today ?? 0)} 성공 · {Number(status?.failed_today ?? 0)} 실패</b><em>상세페이지 분석 + codex-image</em></span></article>
    </div>

    <div className="cli-runtime-actions">
      <div><label><span>토큰 유효기간</span><select value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))}><option value={30}>30일</option><option value={90}>90일</option><option value={180}>180일</option><option value={365}>365일</option></select></label><button type="button" className="credential-primary" onClick={() => void issueToken()} disabled={issuing}>{issuing ? <LoaderCircle className="spin" size={14} /> : status?.worker ? <RotateCcw size={14} /> : <KeyRound size={14} />}{status?.worker ? "작업자 토큰 교체" : "작업자 토큰 발급"}</button></div>
      <aside><ShieldCheck size={15} /><span><b>API Key 불필요</b><small>`codex login`의 ChatGPT 계정 인증과 codex-image 스킬을 사용합니다.</small></span></aside>
    </div>

    <div className="cli-job-history">
      <div className="cli-job-history-heading"><span><History size={15} /><b>최근 AI 작업</b></span><small>요청 이미지·시도 횟수·결과 상태를 운영 화면에서 관리합니다.</small></div>
      {jobs.length > 0 ? <div className="cli-job-list">
        {jobs.map((job) => <article key={job.id} className="cli-job-row">
          <div className="cli-job-main">
            <span className={`cli-job-status ${job.status}`}>{jobStatusLabel[job.status]}</span>
            <div><b>{job.product_description || "상품 상세페이지 생성"}</b><small>{job.image_count}개 이미지 · {job.attempt_count}회 시도 · {formatDate(job.created_at)}</small>{job.error_message && <em>{job.error_message}</em>}</div>
          </div>
          <div className="cli-job-controls">
            {job.status === "succeeded" && <span className="cli-job-output">{job.has_hero ? "대표 이미지 포함" : job.has_result ? "분석 완료" : "완료"}</span>}
            {(job.status === "failed" || job.status === "cancelled") && <button type="button" onClick={() => void controlJob(job, "retry")} disabled={workingJobId === job.id}>{workingJobId === job.id ? <LoaderCircle className="spin" size={13} /> : <RotateCcw size={13} />}다시 실행</button>}
            {(job.status === "queued" || job.status === "running") && <button type="button" className="danger" onClick={() => void controlJob(job, "cancel")} disabled={workingJobId === job.id}>{workingJobId === job.id ? <LoaderCircle className="spin" size={13} /> : <Ban size={13} />}취소</button>}
          </div>
        </article>)}
      </div> : !loading && !jobsError && <p className="cli-job-empty">아직 생성 요청이 없습니다. 상품 AI 스튜디오에서 첫 작업을 실행해 보세요.</p>}
      {jobsError && <p className="cli-runtime-error"><AlertTriangle size={14} />{jobsError}</p>}
    </div>

    {issued && <div className="cli-token-reveal">
      <div><AlertTriangle size={16} /><span><b>일회성 토큰 — 창을 닫기 전에 복사하세요.</b><small>토큰 원문은 서버에도 저장되지 않으며 SHA-256 지문만 보관됩니다.</small></span></div>
      <code>{issued.token}</code>
      <button type="button" onClick={() => void copy(issued.token, "CLI 작업자 토큰을 복사했습니다.")}><Copy size={14} />토큰 복사</button>
      <p><b>Mac 자동실행 설치</b><code>npm run ai:worker:install</code><button type="button" onClick={() => void copy("npm run ai:worker:install", "CLI 작업자 설치 명령을 복사했습니다.")}><Copy size={13} />명령 복사</button><small>명령 실행 후 뜨는 보안 입력창에 위 토큰을 붙여 넣으면 키체인에 저장되고 로그인 시 자동 실행됩니다.</small></p>
    </div>}
    {error && <p className="cli-runtime-error"><AlertTriangle size={14} />{error}</p>}
    {loading && !status && <div className="cli-runtime-loading"><LoaderCircle className="spin" size={15} />CLI 작업자 상태 확인 중</div>}
  </section>;
}
