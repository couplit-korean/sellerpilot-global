"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createLazadaSupplementalMemoryStore,
  createLazadaSupplementalSessionStore,
  createLazadaSupplementalUiWorkflow,
  fetchLazadaSupplementalUiScopes,
  lazadaSupplementalUiSelectionSchema,
  type LazadaSupplementalUiScope,
  type LazadaSupplementalUiScopes,
  type LazadaSupplementalUiScopeState,
  type LazadaSupplementalUiSelection,
} from "../../../../lib/cs/channels/lazada/supplemental-ui-workflow";
import { LazadaProductReviewReplyComposer } from "./product-review-reply-composer";
import styles from "../../lazada-quarantine.module.css";

type AuthenticatedFetch = (input: string, init?: RequestInit) => Promise<Response>;
type SelectionFields = LazadaSupplementalUiSelection;
const authenticatedFetchSessionIds = new WeakMap<AuthenticatedFetch, number>();
let nextAuthenticatedFetchSessionId = 1;

function authenticatedFetchSessionId(authenticatedFetch: AuthenticatedFetch) {
  const existing = authenticatedFetchSessionIds.get(authenticatedFetch);
  if (existing) return existing;
  const created = nextAuthenticatedFetchSessionId;
  nextAuthenticatedFetchSessionId += 1;
  authenticatedFetchSessionIds.set(authenticatedFetch, created);
  return created;
}

const surfaceLabels = {
  product_review: "상품 리뷰",
  reverse_order_after_sales: "반품·환불·취소 사후지원",
} as const;

const sourcePathLabels = {
  "/review/seller/list": "상품 리뷰 목록",
  "/reverse/getreverseordersforseller": "사후지원 전체 목록",
  "/order/reverse/return/detail/list": "반품 상세",
  "/order/reverse/return/history/list": "반품 처리 이력",
} as const;

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function firstFields(scopes: LazadaSupplementalUiScopes): SelectionFields | null {
  const account = scopes.accounts[0];
  const scope = account?.scopes[0];
  return account && scope ? {
    credentialId: account.credentialId,
    country: scope.country,
    surface: scope.surface,
    sourcePath: scope.sourcePath,
    resourceId: "",
    pageSize: 20,
  } : null;
}

function selectedScope(scopes: LazadaSupplementalUiScopes, fields: SelectionFields) {
  return scopes.accounts.find((account) => account.credentialId === fields.credentialId)?.scopes.find(
    (scope) => scope.country === fields.country && scope.surface === fields.surface
      && scope.sourcePath === fields.sourcePath,
  ) ?? null;
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

type ControlsProps = {
  scopes: LazadaSupplementalUiScopes;
  fields: SelectionFields;
  state: LazadaSupplementalUiScopeState | null;
  busy: boolean;
  error: string;
  message: string;
  onAccount(value: string): void;
  onCountry(value: string): void;
  onSurface(value: SelectionFields["surface"]): void;
  onSourcePath(value: SelectionFields["sourcePath"]): void;
  onResource(value: string): void;
  onRefresh(): void;
  onAction(): void;
  authenticatedFetch?: AuthenticatedFetch;
};

export function LazadaSupplementalReadControls({
  scopes, fields, state, busy, error, message,
  onAccount, onCountry, onSurface, onSourcePath, onResource, onRefresh, onAction,
  authenticatedFetch,
}: ControlsProps) {
  const account = scopes.accounts.find((candidate) => candidate.credentialId === fields.credentialId);
  const countries = unique((account?.scopes ?? []).map((scope) => scope.country));
  const surfaces = unique((account?.scopes ?? []).filter((scope) => scope.country === fields.country)
    .map((scope) => scope.surface));
  const sourcePaths = (account?.scopes ?? []).filter((scope) => scope.country === fields.country
    && scope.surface === fields.surface);
  const scope = selectedScope(scopes, fields);
  const parsedSelection = lazadaSupplementalUiSelectionSchema.safeParse(fields);
  const allowed = scope?.permissionState === "authorized";
  const actionLabel = state?.progress?.complete
    ? "새 라운드 다시 동기화"
    : state?.progress ? "중단 지점부터 계속" : "선택 범위 동기화";

  return <>
    <div className={styles.controls}>
      <label>연결 계정
        <select aria-label="Lazada 연결 계정" value={fields.credentialId} disabled={busy}
          onChange={(event) => onAccount(event.currentTarget.value)}>
          {scopes.accounts.map((candidate) => <option key={candidate.credentialId} value={candidate.credentialId}>
            {candidate.label}
          </option>)}
        </select>
      </label>
      <label>국가
        <select aria-label="Lazada 국가" value={fields.country} disabled={busy}
          onChange={(event) => onCountry(event.currentTarget.value)}>
          {countries.map((country) => <option key={country} value={country}>{country}</option>)}
        </select>
      </label>
      <label>업무 영역
        <select aria-label="Lazada 업무 영역" value={fields.surface} disabled={busy}
          onChange={(event) => onSurface(event.currentTarget.value as SelectionFields["surface"])}>
          {surfaces.map((surface) => <option key={surface} value={surface}>{surfaceLabels[surface]}</option>)}
        </select>
      </label>
      <label>조회 종류
        <select aria-label="Lazada 조회 종류" value={fields.sourcePath} disabled={busy}
          onChange={(event) => onSourcePath(event.currentTarget.value as SelectionFields["sourcePath"])}>
          {sourcePaths.map((candidate) => <option key={candidate.sourcePath} value={candidate.sourcePath}>
            {sourcePathLabels[candidate.sourcePath]}
          </option>)}
        </select>
      </label>
      <label>{scope?.resourceLabel ?? "대상 ID"}
        <input aria-label={scope?.resourceLabel ?? "Lazada 대상 ID"} inputMode="numeric" pattern="[0-9]*"
          value={fields.resourceId} disabled={busy || !scope?.resourceRequired}
          placeholder={scope?.resourceRequired ? "숫자 ID 입력" : "전체 목록"}
          onChange={(event) => onResource(event.currentTarget.value)} />
      </label>
    </div>
    {scope ? <p className={allowed ? styles.allowed : styles.blocked} role="status">
      {allowed ? "실행 가능한 읽기 권한" : "실행 차단"} · {scope.message}
    </p> : <p className={styles.blocked} role="alert">현재 서버 권한에 포함된 범위를 다시 선택해 주세요.</p>}
    <p>자동 조회·자동 답글 비활성 · 주문/환불 변경 비활성. 아래 조회 버튼은 선택 범위만 한 번 읽고,
      저장된 상품 리뷰 답글은 별도 권한 확인 후 수동 접수합니다.</p>
    <div className={styles.actions}>
      <button type="button" className="filter-button" disabled={busy || !parsedSelection.success}
        data-lazada-supplemental-refresh="true" onClick={onRefresh}>
        {busy ? "처리 중…" : "저장 상태 새로고침"}
      </button>
      <button type="button" className="filter-button"
        disabled={busy || !parsedSelection.success || !allowed}
        data-lazada-supplemental-action="true" onClick={onAction}>
        {busy ? "처리 중…" : actionLabel}
      </button>
    </div>
    {error ? <p role="alert" className={styles.blocked}>{error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
    {state?.progress ? <div className={styles.progress} data-lazada-supplemental-progress="true">
      <p><strong>라운드 {state.progress.runNumber}</strong> · 페이지 {state.progress.pageNumber}
        · 리비전 {state.progress.revision} · {state.progress.complete ? "완료" : "계속 가능"}</p>
      <small>마지막 저장 {formatTime(state.progress.updatedAt)}</small>
    </div> : state ? <p>이 범위의 저장된 진행 상태가 없습니다.</p> : null}
    {state ? <>
      <h4>정규화 저장 이력 {state.events.length}건</h4>
      <ul className={styles.events}>
        {state.events.map((event) => <li key={`${event.credentialId}:${event.country}:${event.resourceKey}:${event.eventKey}`}>
          <strong>{event.title}</strong><span>{event.status} · {formatTime(event.occurredAt)}</span>
          {event.body ? <p>{event.body}</p> : null}
          <small>항목 {event.resourceKey} · 주문 {event.externalOrderId ?? "미제공"}
            · 상품 {event.externalItemId ?? "미제공"}</small>
          {event.surface === "product_review" && authenticatedFetch
            ? <LazadaProductReviewReplyComposer event={event} authenticatedFetch={authenticatedFetch} />
            : null}
        </li>)}
      </ul>
      {state.events.length === 0 ? <p>현재 정규화 저장 원장에는 해당 범위 이력이 없습니다. 원격 0건 확인은 아닙니다.</p> : null}
    </> : null}
  </>;
}

function LazadaSupplementalReadSession({ authenticatedFetch }: { authenticatedFetch: AuthenticatedFetch }) {
  const [scopes, setScopes] = useState<LazadaSupplementalUiScopes | null>(null);
  const [fields, setFields] = useState<SelectionFields | null>(null);
  const [state, setState] = useState<LazadaSupplementalUiScopeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const uiGeneration = useRef(0);
  const pendingStore = useMemo(() => typeof window === "undefined"
    ? createLazadaSupplementalMemoryStore()
    : createLazadaSupplementalSessionStore(window.sessionStorage), []);
  const workflow = useMemo(
    () => createLazadaSupplementalUiWorkflow(authenticatedFetch, pendingStore),
    [authenticatedFetch, pendingStore],
  );
  useEffect(() => () => {
    uiGeneration.current += 1;
    workflow.activate(null);
  }, [workflow]);

  const commitFields = (next: SelectionFields | null) => {
    uiGeneration.current += 1;
    setFields(next);
    setState(null);
    setBusy(false);
    setError("");
    setMessage("");
    const parsed = lazadaSupplementalUiSelectionSchema.safeParse(next);
    workflow.activate(parsed.success ? parsed.data : null);
  };

  const loadScopes = async () => {
    const run = ++uiGeneration.current;
    workflow.activate(null);
    setBusy(true);
    setError("");
    try {
      const nextScopes = await fetchLazadaSupplementalUiScopes(authenticatedFetch);
      if (run !== uiGeneration.current) return;
      const nextFields = firstFields(nextScopes);
      setScopes(nextScopes);
      setFields(nextFields);
      setState(null);
      const parsed = lazadaSupplementalUiSelectionSchema.safeParse(nextFields);
      workflow.activate(parsed.success ? parsed.data : null);
      setMessage(nextScopes.accounts.length
        ? "서버가 허용한 연결 계정과 국가 범위를 불러왔습니다."
        : "현재 서버가 허용한 Lazada 연결 계정이 없습니다.");
    } catch {
      if (run === uiGeneration.current) setError("Lazada 연결 계정과 권한 범위를 불러오지 못했습니다.");
    } finally {
      if (run === uiGeneration.current) setBusy(false);
    }
  };

  const chooseScope = (candidate: LazadaSupplementalUiScope, credentialId: string) => {
    commitFields({ credentialId, country: candidate.country, surface: candidate.surface,
      sourcePath: candidate.sourcePath, resourceId: "", pageSize: 20 });
  };

  const manualRefresh = async () => {
    const parsed = lazadaSupplementalUiSelectionSchema.safeParse(fields);
    if (!parsed.success) {
      setError("선택한 조회 종류에 필요한 숫자 대상 ID를 확인해 주세요.");
      return;
    }
    const run = uiGeneration.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await workflow.refresh(parsed.data);
      if (run !== uiGeneration.current || result.status === "stale") return;
      setState(result.state);
      setMessage("선택 범위의 정규화 저장 원장을 새로고침했습니다.");
    } catch {
      if (run === uiGeneration.current) setError("선택한 계정·국가 범위의 저장 상태를 불러오지 못했습니다.");
    } finally {
      if (run === uiGeneration.current) setBusy(false);
    }
  };

  const execute = async () => {
    const parsed = lazadaSupplementalUiSelectionSchema.safeParse(fields);
    if (!parsed.success) {
      setError("선택한 조회 종류에 필요한 숫자 대상 ID를 확인해 주세요.");
      return;
    }
    const run = uiGeneration.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await workflow.execute(parsed.data);
      if (run !== uiGeneration.current || result.status === "stale") return;
      setState(result.state);
      setMessage(result.replayRecovered
        ? "직전 요청의 저장 결과를 확인해 같은 요청 ID로 안전하게 복구했습니다."
        : "한 번의 읽기 후 정규화 저장 원장을 새로고침했습니다.");
    } catch {
      if (run === uiGeneration.current) {
        setError("읽기 요청 결과를 확인하지 못했습니다. 같은 선택으로 다시 누르면 저장된 요청 ID를 재사용합니다.");
      }
    } finally {
      if (run === uiGeneration.current) setBusy(false);
    }
  };

  return <details className={`panel ${styles.panel}`} onToggle={(event) => {
    if (event.currentTarget.open) {
      if (!scopes && !busy) void loadScopes();
      return;
    }
    uiGeneration.current += 1;
    workflow.activate(null);
    setScopes(null);
    setFields(null);
    setState(null);
    setBusy(false);
    setError("");
    setMessage("");
  }}>
    <summary>Lazada 리뷰·사후지원 수동 동기화</summary>
    <p>로그인한 관리자의 서버 권한 범위에서 계정·국가·조회 종류를 선택합니다. grant ID나 원시 UUID를 직접 입력하지 않습니다.</p>
    {busy && !scopes ? <p role="status">연결 범위 확인 중…</p> : null}
    {error && !scopes ? <><p role="alert" className={styles.blocked}>{error}</p>
      <button type="button" className="filter-button" onClick={() => void loadScopes()}>연결 범위 다시 불러오기</button></> : null}
    {scopes && fields ? <LazadaSupplementalReadControls scopes={scopes} fields={fields} state={state}
      busy={busy} error={error} message={message}
      onAccount={(credentialId) => {
        const account = scopes.accounts.find((candidate) => candidate.credentialId === credentialId);
        if (account?.scopes[0]) chooseScope(account.scopes[0], credentialId);
      }}
      onCountry={(country) => {
        const account = scopes.accounts.find((candidate) => candidate.credentialId === fields.credentialId);
        const candidate = account?.scopes.find((scope) => scope.country === country);
        if (candidate) chooseScope(candidate, fields.credentialId);
      }}
      onSurface={(surface) => {
        const account = scopes.accounts.find((candidate) => candidate.credentialId === fields.credentialId);
        const candidate = account?.scopes.find((scope) => scope.country === fields.country && scope.surface === surface);
        if (candidate) chooseScope(candidate, fields.credentialId);
      }}
      onSourcePath={(sourcePath) => {
        const scope = scopes.accounts.find((candidate) => candidate.credentialId === fields.credentialId)?.scopes.find(
          (candidate) => candidate.country === fields.country && candidate.surface === fields.surface
            && candidate.sourcePath === sourcePath,
        );
        if (scope) commitFields({ ...fields, sourcePath, resourceId: "" });
      }}
      onResource={(resourceId) => commitFields({ ...fields, resourceId })}
      onRefresh={() => void manualRefresh()} onAction={() => void execute()}
      authenticatedFetch={authenticatedFetch} /> : null}
    {scopes && scopes.accounts.length === 0 ? <p className={styles.blocked}>활성 production Lazada 계정·국가 바인딩이 없어 실행할 수 없습니다.</p> : null}
  </details>;
}

export function LazadaSupplementalReadPanel({ authenticatedFetch }: { authenticatedFetch: AuthenticatedFetch }) {
  return <LazadaSupplementalReadSession
    key={authenticatedFetchSessionId(authenticatedFetch)}
    authenticatedFetch={authenticatedFetch}
  />;
}
