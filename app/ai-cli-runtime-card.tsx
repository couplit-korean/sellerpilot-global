"use client";

import { AlertTriangle, Ban, CheckCircle2, Clock3, Copy, Cpu, DatabaseZap, History, KeyRound, LoaderCircle, RefreshCw, RotateCcw, ShieldCheck, SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";

type WorkerScope = "ai" | "gateway" | "scheduler";

type WorkerSnapshot = {
  label: string;
  fingerprint: string;
  expires_at: string;
  last_seen_at: string | null;
  last_version: string | null;
  scope?: WorkerScope | "legacy_combined";
};

type WorkerStatus = {
  worker: WorkerSnapshot | null;
  workers?: Partial<Record<WorkerScope | "legacy_combined", WorkerSnapshot>>;
  queued: number;
  running: number;
  succeeded_today: number;
  failed_today: number;
};

type IssuedTokenSet = {
  tokenSetId: string;
  activationExpiresAt: string;
  expiresAt: string;
  tokens: Record<WorkerScope, { token: string; fingerprint: string }>;
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

const jobKindLabel: Record<string, string> = {
  product_studio: "상품 상세페이지 생성",
  product_research: "상품정보 조사",
  support_reply: "고객 문의 답변 초안",
};

const workerScopeDefinitions: ReadonlyArray<{
  scope: WorkerScope;
  label: string;
  shortLabel: string;
  purpose: string;
  tokenLabel: string;
  keychainService: string;
  rotateFlag: string;
}> = [
  {
    scope: "ai",
    label: "AI 작업",
    shortLabel: "AI",
    purpose: "상품 분석·이미지·답변 초안 큐만 처리합니다.",
    tokenLabel: "SellerPilot Mac · AI Worker",
    keychainService: "SellerPilot AI Worker",
    rotateFlag: "--rotate-ai-token",
  },
  {
    scope: "gateway",
    label: "판매채널 게이트웨이",
    shortLabel: "게이트웨이",
    purpose: "판매채널 쓰기 작업과 채널 자격증명 사용만 허용합니다.",
    tokenLabel: "SellerPilot Mac · Gateway Worker",
    keychainService: "SellerPilot Gateway Worker",
    rotateFlag: "--rotate-gateway-token",
  },
  {
    scope: "scheduler",
    label: "스케줄러",
    shortLabel: "스케줄러",
    purpose: "운영 동기화·유지보수 예약 작업만 호출합니다.",
    tokenLabel: "SellerPilot Mac · Scheduler Worker",
    keychainService: "SellerPilot Scheduler Worker",
    rotateFlag: "--rotate-scheduler-token",
  },
];

function workerForScope(status: WorkerStatus | null, scope: WorkerScope) {
  if (!status) return null;
  if (status.workers) {
    return status.workers[scope]
      ?? status.workers.legacy_combined
      ?? (scope === "ai" ? status.worker : null);
  }
  return status.worker;
}

function formatDate(value: string | null) {
  if (!value) return "아직 접속 없음";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function isOnline(lastSeenAt: string | null) {
  return Boolean(lastSeenAt && Date.now() - new Date(lastSeenAt).getTime() < 30_000);
}

export function AiCliRuntimeCard({ notify }: { notify: (message: string) => void }) {
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [issued, setIssued] = useState<IssuedTokenSet | null>(null);
  const [selectedScope, setSelectedScope] = useState<WorkerScope>("ai");
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [jobsError, setJobsError] = useState("");
  const [workingJobId, setWorkingJobId] = useState("");
  const [tokenRotationConfirming, setTokenRotationConfirming] = useState(false);
  const tokenRotationDialogRef = useRef<HTMLDialogElement | null>(null);
  const tokenRotationConfirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const tokenRotationOpenerRef = useRef<HTMLElement | null>(null);

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

  const closeTokenRotationConfirmation = useCallback(() => {
    const dialog = tokenRotationDialogRef.current;
    if (dialog?.open) dialog.close();
    setTokenRotationConfirming(false);
    const opener = tokenRotationOpenerRef.current;
    tokenRotationOpenerRef.current = null;
    window.requestAnimationFrame(() => {
      if (opener?.isConnected && !(opener instanceof HTMLButtonElement && opener.disabled)) opener.focus();
    });
  }, []);

  useEffect(() => {
    const dialog = tokenRotationDialogRef.current;
    if (!dialog || !tokenRotationConfirming) return;
    if (!dialog.open) dialog.showModal();
    const focusFrame = window.requestAnimationFrame(() => tokenRotationConfirmButtonRef.current?.focus());
    return () => window.cancelAnimationFrame(focusFrame);
  }, [tokenRotationConfirming]);

  const selectedScopeDefinition = workerScopeDefinitions.find((definition) => definition.scope === selectedScope) ?? workerScopeDefinitions[0];
  const selectedWorker = workerForScope(status, selectedScope);

  const issueToken = async () => {
    setIssuing(true);
    setError("");
    try {
      const response = await authenticatedFetch("/api/admin/ai-worker-token", {
        method: "POST",
        body: JSON.stringify({ label: "SellerPilot Mac Worker", expiresInDays }),
      });
      const payload = await response.json().catch(() => ({ message: "토큰 발급 응답을 읽지 못했습니다." })) as Partial<IssuedTokenSet>;
      const completeTokenSet = payload.tokens
        && workerScopeDefinitions.every((definition) => payload.tokens?.[definition.scope]?.token.startsWith("spw_"));
      if (!response.ok || !payload.tokenSetId || !completeTokenSet) {
        throw new Error(payload.message ?? "CLI 작업자 토큰 세트를 발급하지 못했습니다.");
      }
      setIssued({
        tokenSetId: payload.tokenSetId,
        activationExpiresAt: payload.activationExpiresAt ?? "",
        expiresAt: payload.expiresAt ?? "",
        message: payload.message ?? "새 CLI 작업자 토큰 세트가 대기 상태로 발급됐습니다.",
        tokens: payload.tokens as IssuedTokenSet["tokens"],
      });
      notify("세 범위 전용 토큰을 대기 상태로 발급했습니다. 설치 성공 전까지 기존 토큰은 유지됩니다.");
      await load();
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : "CLI 작업자 토큰을 발급하지 못했습니다.");
    } finally {
      setIssuing(false);
    }
  };

  const requestTokenIssue = () => {
    if (!status?.worker) {
      void issueToken();
      return;
    }
    tokenRotationOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTokenRotationConfirming(true);
  };

  const confirmTokenRotation = () => {
    tokenRotationOpenerRef.current = null;
    const dialog = tokenRotationDialogRef.current;
    if (dialog?.open) dialog.close();
    setTokenRotationConfirming(false);
    void issueToken();
  };

  const copy = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify(message);
    } catch {
      notify("클립보드 권한이 없어 복사하지 못했습니다. 값을 직접 선택해 주세요.");
    }
  };

  const online = isOnline(selectedWorker?.last_seen_at ?? null);
  const issuedInstallCommand = issued
    ? `npm run ai:worker:install -- --rotate-token --token-set ${issued.tokenSetId}`
    : "";

  return <section className="cli-runtime-card">
    <header>
      <div className="cli-runtime-title"><span><SquareTerminal size={18} /></span><div><small>CHATGPT CLI RUNTIME</small><h3>로컬 Codex AI 작업자</h3><p>ChatGPT OAuth는 Mac에만 남고, Vercel은 암호화된 작업 큐만 전달합니다.</p></div></div>
      <span className={`cli-runtime-state ${online ? "online" : "offline"}`}><i />{online ? `${selectedScopeDefinition.shortLabel} 연결` : selectedWorker ? `${selectedScopeDefinition.shortLabel} 대기` : `${selectedScopeDefinition.shortLabel} 토큰 미발급`}</span>
    </header>

    <div className="cli-worker-scopes" role="group" aria-label="CLI 작업자 권한 선택">
      {workerScopeDefinitions.map((definition) => {
        const scopeWorker = workerForScope(status, definition.scope);
        const scopeOnline = isOnline(scopeWorker?.last_seen_at ?? null);
        return <button
          type="button"
          key={definition.scope}
          className={selectedScope === definition.scope ? "selected" : ""}
          aria-pressed={selectedScope === definition.scope}
          onClick={() => setSelectedScope(definition.scope)}
        >
          <span><i className={scopeOnline ? "online" : scopeWorker ? "ready" : "missing"} />{definition.label}</span>
          <small>{scopeOnline ? "실시간 연결" : scopeWorker ? `대기 · ${scopeWorker.fingerprint}` : "전용 토큰 필요"}</small>
        </button>;
      })}
    </div>

    <div className="cli-runtime-grid">
      <article><Cpu size={16} /><span><small>{selectedScopeDefinition.label} 작업자</small><b>{selectedWorker?.label ?? "연결 필요"}</b><em>{selectedWorker?.last_version ?? "전용 토큰 저장 후 실행"}</em></span></article>
      <article><Clock3 size={16} /><span><small>마지막 신호</small><b>{formatDate(selectedWorker?.last_seen_at ?? null)}</b><em>{selectedWorker ? `토큰 ${selectedWorker.fingerprint} · 만료 ${formatDate(selectedWorker.expires_at)}` : `${selectedScopeDefinition.label} 토큰을 먼저 발급하세요`}</em></span></article>
      <article><RefreshCw size={16} /><span><small>현재 작업</small><b>{Number(status?.running ?? 0)} 실행 · {Number(status?.queued ?? 0)} 대기</b><em>15초마다 자동 갱신</em></span></article>
      <article><CheckCircle2 size={16} /><span><small>오늘 처리</small><b>{Number(status?.succeeded_today ?? 0)} 성공 · {Number(status?.failed_today ?? 0)} 실패</b><em>상세페이지 분석 + codex-image</em></span></article>
    </div>

    <div className="cli-runtime-actions">
      <div><label><span>토큰 유효기간</span><select value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))}><option value={30}>30일</option><option value={90}>90일</option><option value={180}>180일</option><option value={365}>365일</option></select></label><button type="button" className="credential-primary" onClick={requestTokenIssue} disabled={issuing || tokenRotationConfirming}>{issuing ? <LoaderCircle className="spin" size={14} /> : status?.worker ? <RotateCcw size={14} /> : <KeyRound size={14} />}{status?.worker ? "3개 토큰 안전 교체" : "3개 전용 토큰 발급"}</button></div>
      <aside><ShieldCheck size={15} /><span><b>{selectedScopeDefinition.label} 전용 권한</b><small>{selectedScopeDefinition.purpose}</small></span></aside>
    </div>

    <dialog
      ref={tokenRotationDialogRef}
      className="cli-token-confirm-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="cli-token-confirm-title"
      aria-describedby="cli-token-confirm-description"
      onCancel={(event) => {
        event.preventDefault();
        closeTokenRotationConfirmation();
      }}
    >
      <div className="cli-token-confirm-heading"><span><AlertTriangle size={18} /></span><div><small>WORKER TOKEN ROTATION</small><h4 id="cli-token-confirm-title">작업자 토큰 세트 교체 확인</h4></div></div>
      <p id="cli-token-confirm-description">AI·게이트웨이·스케줄러 토큰 세트를 새로 발급할까요? 기존 작업자는 새 런타임 설치가 성공할 때까지 계속 동작합니다.</p>
      <div className="cli-token-confirm-actions"><button type="button" className="credential-secondary" onClick={closeTokenRotationConfirmation}>취소</button><button ref={tokenRotationConfirmButtonRef} type="button" className="credential-primary" onClick={confirmTokenRotation}>확인 후 새로 발급</button></div>
    </dialog>

    <div className="cli-job-history">
      <div className="cli-job-history-heading"><span><History size={15} /><b>최근 AI 작업</b></span><small>요청 이미지·시도 횟수·결과 상태를 운영 화면에서 관리합니다.</small></div>
      {jobs.length > 0 ? <div className="cli-job-list">
        {jobs.map((job) => <article key={job.id} className="cli-job-row">
          <div className="cli-job-main">
            <span className={`cli-job-status ${job.status}`}>{jobStatusLabel[job.status]}</span>
            <div><b>{job.product_description || jobKindLabel[job.kind] || "CLI 작업"}</b><small>{job.kind === "product_studio" ? `${job.image_count}개 이미지 · ` : ""}{job.attempt_count}회 시도 · {formatDate(job.created_at)}</small>{job.error_message && <em>{job.error_message}</em>}</div>
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

    {issued && <div className="cli-token-reveal">
      <div><AlertTriangle size={16} /><span><b>세 범위 일회성 토큰 — 설치 완료 전 창을 닫지 마세요.</b><small>서버에는 SHA-256 지문만 저장되며, 세 토큰이 모두 검증돼야 기존 토큰과 원자적으로 교체됩니다.</small></span></div>
      {workerScopeDefinitions.map((definition) => <p key={definition.scope}>
        <b>{definition.label}</b><code>{issued.tokens[definition.scope].token}</code>
        <button type="button" onClick={() => void copy(issued.tokens[definition.scope].token, `${definition.label} 전용 토큰을 복사했습니다.`)}><Copy size={13} />토큰 복사</button>
        <small>Keychain: {definition.keychainService} · 지문 {issued.tokens[definition.scope].fingerprint}</small>
      </p>)}
      <p><b>안전 설치·교체</b><code>{issuedInstallCommand}</code><button type="button" onClick={() => void copy(issuedInstallCommand, "CLI 작업자 안전 교체 명령을 복사했습니다.")}><Copy size={13} />명령 복사</button><small>{formatDate(issued.activationExpiresAt)} 전까지 실행하세요. 설치 실패 시 대기 토큰만 폐기되고 기존 작업자는 유지됩니다.</small></p>
    </div>}
    {error && <p className="cli-runtime-error"><AlertTriangle size={14} />{error}</p>}
    {loading && !status && <div className="cli-runtime-loading"><LoaderCircle className="spin" size={15} />CLI 작업자 상태 확인 중</div>}
  </section>;
}
