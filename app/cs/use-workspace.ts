"use client";
import { createClient } from "../../lib/supabase/client";
import { isSupabaseConfigured } from "../../lib/supabase/config";
import { AuthenticationRequiredError } from "../../lib/authenticated-fetch";
import { useCallback, useEffect, useRef, useState } from "react";
import { csSnapshotSchema, type CsSnapshot } from "../../lib/cs/snapshot";
import { csEventNotifications, csEventState, type CsEventState } from "./event-notifications";
import { channels } from "../channel-config";
import type { DisplayTicket, InquiryHistoryBackfill, OperationTicketDelivery, ReplyQueueResult, SupportLocale } from "./workspace-contracts";

function abortableBrowserDelay(ms: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("요청이 취소되었습니다.", "AbortError"));
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(signal.reason ?? new DOMException("요청이 취소되었습니다.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
function createPageAbortScope(
  sourceSignals: readonly AbortSignal[],
  timeoutMs?: number,
  timeoutMessage = "요청 제한시간을 초과했습니다.",
): { signal: AbortSignal; dispose: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutController = timeoutMs === undefined ? null : new AbortController();
  if (timeoutController && timeoutMs !== undefined) {
    timeoutId = globalThis.setTimeout(() => {
      timeoutController.abort(new DOMException(timeoutMessage, "TimeoutError"));
    }, timeoutMs);
  }
  const signals = timeoutController ? [...sourceSignals, timeoutController.signal] : [...sourceSignals];
  const fallbackController = new AbortController();
  const fallbackListeners: Array<{ source: AbortSignal; listener: () => void }> = [];
  let signal: AbortSignal;
  if (signals.length === 1) {
    [signal] = signals;
  } else if (typeof AbortSignal.any === "function") {
    signal = AbortSignal.any(signals);
  } else {
    const abortFrom = (source: AbortSignal) => {
      if (!fallbackController.signal.aborted) {
        fallbackController.abort(source.reason ?? new DOMException("요청이 취소되었습니다.", "AbortError"));
      }
    };
    for (const source of signals) {
      const listener = () => abortFrom(source);
      if (source.aborted) abortFrom(source);
      else source.addEventListener("abort", listener, { once: true });
      fallbackListeners.push({ source, listener });
    }
    signal = fallbackController.signal;
  }
  let disposed = false;
  return {
    signal,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
      for (const { source, listener } of fallbackListeners) source.removeEventListener("abort", listener);
    },
  };
}
function parseInquiryHistoryBackfill(value: unknown): InquiryHistoryBackfill | null {
  if (!isRecord(value)
      || typeof value.runId !== "string"
      || !["queued", "running", "succeeded", "failed", "blocked"].includes(String(value.status))
      || !Array.isArray(value.channels)
      || value.channels.length < 1 || value.channels.length > 3
      || new Set(value.channels).size !== value.channels.length
      || value.channels.some((channel) => channel !== "coupang" && channel !== "elevenst" && channel !== "smartstore")) return null;
  const numericKeys = [
    "historyDays", "expectedInitialJobs", "totalJobs", "queuedJobs", "runningJobs",
    "succeededJobs", "failedJobs", "progressPercent",
  ] as const;
  if (numericKeys.some((key) => typeof value[key] !== "number" || !Number.isInteger(value[key]) || Number(value[key]) < 0)
      || typeof value.fromDate !== "string"
      || typeof value.toDate !== "string"
      || typeof value.startedAt !== "string"
      || typeof value.updatedAt !== "string"
      || value.completedAt !== null && typeof value.completedAt !== "string"
      || value.blockedReason !== undefined && value.blockedReason !== "STATIC_EGRESS_REQUIRED") return null;
  return value as InquiryHistoryBackfill;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function useCsWorkspace({ authenticatedFetch, notify, active }: {
  authenticatedFetch: (input: string, init?: RequestInit) => Promise<Response>;
  notify: (message: string) => void;
  active: boolean;
}) {
  const [snapshot, setSnapshot] = useState<CsSnapshot | null>(null);
  const events = useRef<CsEventState | null>(null);
  useEffect(() => {
    if (!snapshot) return;
    for (const message of csEventNotifications(events.current, snapshot)) notify(message);
    events.current = csEventState(snapshot);
  }, [snapshot, notify]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const snapshotController = useRef<AbortController | null>(null);
  const snapshotGeneration = useRef(0);
  const refreshTimers = useRef(new Set<number>());
  const supportReplyControllerRef = useRef<AbortController | null>(null);
  const [syncingCsInquiries, setSyncingCsInquiries] = useState(false);
  const [inquiryHistoryBackfill, setInquiryHistoryBackfill] = useState<InquiryHistoryBackfill | null>(null);
  const activeInquiryHistoryRunsRef = useRef(new Set<string>());
  const notifiedInquiryHistoryRunsRef = useRef(new Set<string>());
  const syncingCsInquiriesRef = useRef(false);
  const reload = useCallback(async () => {
    const generation = ++snapshotGeneration.current;
    snapshotController.current?.abort();
    const controller = new AbortController(); snapshotController.current = controller;
    const bounded = createPageAbortScope([controller.signal], 30_000);
    try {
      const response = await authenticatedFetch("/api/admin/cs/snapshot", { signal: bounded.signal });
      if (response.status === 401 || response.status === 403) throw new AuthenticationRequiredError("관리자 로그인을 다시 확인해 주세요.");
      if (!response.ok) throw new Error("문의 데이터를 불러오지 못했습니다.");
      const value = csSnapshotSchema.parse(await response.json());
      if (generation === snapshotGeneration.current && !controller.signal.aborted) { setSnapshot(value); setError(null); }
    } catch (cause) {
      if (generation === snapshotGeneration.current && !controller.signal.aborted) {
        if (cause instanceof AuthenticationRequiredError) { setSnapshot(null); events.current = null; }
        setError(cause instanceof Error ? cause.message : "문의 데이터를 불러오지 못했습니다.");
      }
    } finally {
      bounded.dispose();
      if (generation === snapshotGeneration.current && !controller.signal.aborted) setLoading(false);
    }
  }, [authenticatedFetch]);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let userId: string | null = null;
    const { data: { subscription } } = createClient().auth.onAuthStateChange((event, session) => {
      const nextUser = session?.user.id ?? null;
      if (event === "SIGNED_OUT" || (userId !== null && nextUser !== userId)) {
        snapshotGeneration.current++;
        snapshotController.current?.abort();
        supportReplyControllerRef.current?.abort();
        setSnapshot(null);
        events.current = null;
        setInquiryHistoryBackfill(null);
        setError("관리자 로그인을 다시 확인해 주세요.");
      }
      userId = nextUser;
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    const generationRef = snapshotGeneration;
    const timer = window.setTimeout(() => { void reload(); }, 0);
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void reload(); }, active ? 60_000 : 300_000);
    return () => { window.clearTimeout(timer); window.clearInterval(poll); generationRef.current++; snapshotController.current?.abort(); };
  }, [active, reload]);
  useEffect(() => {
    if (!active) { supportReplyControllerRef.current?.abort(); supportReplyControllerRef.current = null; }
  }, [active]);
  useEffect(() => () => { supportReplyControllerRef.current?.abort(); supportReplyControllerRef.current = null; for (const timer of refreshTimers.current) window.clearTimeout(timer); refreshTimers.current.clear(); }, []);
  const saveTicketReply = useCallback(async (ticket: DisplayTicket, reply: string) => {
    const source = snapshot?.tickets.find((item) => item.id === ticket.sourceId);
    if (!source) {
      notify("운영 DB 마이그레이션 적용 후 CS 답변을 저장할 수 있습니다.");
      return null;
    }
    try {
      const response = await authenticatedFetch("/api/admin/cs/reply", {
        method: "POST",
        body: JSON.stringify({ ticketId: source.id, reply, expectedInboundKey: ticket.latestInboundKey }),
      });
      const payload = await response.json().catch(() => ({ message: "CS 답변 응답을 읽지 못했습니다." })) as Partial<ReplyQueueResult> & { message?: string };
      if (response.status !== 202 || !payload.jobId || !payload.delivery) {
        throw new Error(payload.message ?? "판매채널 답변을 대기열에 등록하지 못했습니다.");
      }
      return {
        jobId: payload.jobId,
        message: payload.message ?? "답변을 안전한 판매채널 작업 대기열에 등록했습니다.",
        delivery: payload.delivery,
      };
    } catch (error) {
      notify(error instanceof Error ? error.message : "판매채널 답변을 대기열에 등록하지 못했습니다.");
      return null;
    }
  }, [snapshot, authenticatedFetch, notify]);

  const getTicketDeliveryStatus = useCallback(async (ticketId: string, jobId: string) => {
    try {
      const response = await authenticatedFetch(`/api/admin/cs/reply?ticketId=${encodeURIComponent(ticketId)}&jobId=${encodeURIComponent(jobId)}`);
      const payload = await response.json().catch(() => null) as { delivery?: OperationTicketDelivery; message?: string } | null;
      if (!response.ok || !payload?.delivery) return null;
      if (["succeeded", "failed", "cancelled", "reconciliation_required"].includes(payload.delivery.status)) {
        await reload();
      }
      return payload.delivery;
    } catch {
      return null;
    }
  }, [authenticatedFetch, reload]);

  const updateTicketStatus = useCallback(async (ticket: DisplayTicket, status: "waiting" | "in_progress" | "resolved") => {
    const source = snapshot?.tickets.find((item) => item.id === ticket.sourceId);
    if (!source) return false;
    try {
      const response = await authenticatedFetch("/api/admin/cs/ticket-status", {
        method: "POST",
        body: JSON.stringify({ id: source.id, status, replyDraft: source.replyDraft ?? undefined, expectedInboundKey: ticket.latestInboundKey }),
      });
      if (!response.ok) throw new Error("문의 처리 상태를 저장하지 못했습니다.");
      await reload();
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "문의 처리 상태를 저장하지 못했습니다.");
      return false;
    }
  }, [notify, snapshot, authenticatedFetch, reload]);

  const generateSupportReply = useCallback(async (ticket: DisplayTicket, targetLocale: SupportLocale) => {
    const jobId = crypto.randomUUID();
    supportReplyControllerRef.current?.abort(new DOMException("새 답변 초안 요청으로 교체됐습니다.", "AbortError"));
    const controller = new AbortController();
    supportReplyControllerRef.current = controller;
    const fetchSupportReply = async (input: string, init?: RequestInit) => {
      const bounded = createPageAbortScope(
        [controller.signal],
        30_000,
        "문의 답변 작업 확인이 30초를 초과했습니다. 다시 시도해 주세요.",
      );
      try {
        return await authenticatedFetch(input, { ...init, signal: bounded.signal });
      } finally {
        bounded.dispose();
      }
    };
    try {
      const queued = await fetchSupportReply("/api/admin/cs/drafts", {
        method: "POST",
        body: JSON.stringify({ jobId, ticketId: ticket.sourceId, expectedInboundKey: ticket.latestInboundKey, targetLocale, tone: "polite" }),
      });
      const queuedPayload = await queued.json().catch(() => ({ message: "CLI 작업 응답을 읽지 못했습니다." })) as { message?: string };
      if (!queued.ok) throw new Error(queuedPayload.message ?? "CLI 답변 작업을 시작하지 못했습니다.");
      notify("ChatGPT CLI가 문의 원문과 연결된 원장 정보가 있는지 확인하고 있습니다.");

      for (let attempt = 0; attempt < 120; attempt += 1) {
        await abortableBrowserDelay(2_000, controller.signal);
        const response = await fetchSupportReply(`/api/admin/cs/drafts?id=${jobId}`);
        const payload = await response.json().catch(() => null) as null | {
          status?: string;
          error?: string;
          result?: { mode?: string; draft?: string; targetLocale?: string };
        };
        if (!response.ok || !payload) throw new Error("CLI 답변 작업 상태를 확인하지 못했습니다.");
        if (payload.status === "failed" || payload.status === "cancelled") throw new Error(payload.error || "CLI 답변 초안 생성에 실패했습니다.");
        if (payload.status === "succeeded") {
          if (payload.result?.mode !== "support-reply" || typeof payload.result.draft !== "string") {
            throw new Error("CLI 답변 결과 형식을 확인하지 못했습니다.");
          }
          return payload.result.draft;
        }
      }
      throw new Error("CLI 작업이 대기 중입니다. 작업자 연결 상태를 확인한 뒤 다시 시도해 주세요.");
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) return null;
      notify(error instanceof Error ? error.message : "CLI 답변 초안을 만들지 못했습니다.");
      return null;
    } finally {
      if (controller.signal.aborted) void authenticatedFetch(`/api/admin/cs/drafts?id=${jobId}`, { method: "DELETE", signal: AbortSignal.timeout(5_000) }).catch(() => null);
      if (supportReplyControllerRef.current === controller) supportReplyControllerRef.current = null;
    }
  }, [notify, authenticatedFetch]);

  const syncCsInquiries = useCallback(async (silent = false, historyDays?: number, historyChannel?: "coupang" | "elevenst" | "smartstore", historyEndDate?: string) => {
    if (syncingCsInquiriesRef.current) return;
    syncingCsInquiriesRef.current = true;
    setSyncingCsInquiries(true);
    try {
      const response = await authenticatedFetch("/api/admin/cs/sync", {
        method: "POST",
        body: JSON.stringify(historyDays
          ? { channels: historyChannel ? [historyChannel] : ["coupang", "elevenst", "smartstore"], historyDays, ...(historyEndDate ? { historyEndDate } : {}) }
          : { includeImBootstrap: !silent }),
      });
      const payload = await response.json().catch(() => ({ message: "문의 동기화 응답을 읽지 못했습니다." })) as { message?: string; historyBackfill?: unknown };
      const parsedBackfill = historyDays
        ? parseInquiryHistoryBackfill(payload.historyBackfill)
        : null;
      if (parsedBackfill) setInquiryHistoryBackfill(parsedBackfill);
      if (!response.ok) throw new Error(payload.message ?? "판매채널 문의 동기화를 시작하지 못했습니다.");
      if (historyDays) {
        if (!parsedBackfill) throw new Error("과거 문의 작업 접수 상태를 확인하지 못했습니다.");
      }
      if (!silent) notify(payload.message ?? (historyDays
        ? "한국 쇼핑몰의 과거 문의를 읽기 전용으로 다시 불러오기 시작했습니다."
        : "연결된 판매채널의 실제 고객 문의 조회를 시작했습니다. 결과는 자동 반영됩니다."));
      for (const delay of [3_000, 12_000, 30_000]) {
        const timer = window.setTimeout(() => { refreshTimers.current.delete(timer); void reload(); }, delay);
        refreshTimers.current.add(timer);
      }
    } catch (error) {
      if (!silent) notify(error instanceof Error ? error.message : "판매채널 문의 동기화를 시작하지 못했습니다.");
    } finally {
      syncingCsInquiriesRef.current = false;
      setSyncingCsInquiries(false);
    }
  }, [authenticatedFetch, notify, reload]);

  const refreshInquiryHistoryBackfill = useCallback(async (runId: string | null = null) => {
    const params = runId ? `?runId=${encodeURIComponent(runId)}` : "";
    try {
      const response = await authenticatedFetch(`/api/admin/cs/sync${params}`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null) as null | { historyBackfill?: unknown };
      if (!response.ok || !payload) return false;
      if (payload.historyBackfill === null) {
        if (!runId) setInquiryHistoryBackfill(null);
        return true;
      }
      const parsedBackfill = parseInquiryHistoryBackfill(payload.historyBackfill);
      if (!parsedBackfill || runId && parsedBackfill.runId !== runId) return false;
      setInquiryHistoryBackfill(parsedBackfill);
      return true;
    } catch {
      return false;
    }
  }, [authenticatedFetch]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => {
      void refreshInquiryHistoryBackfill();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshInquiryHistoryBackfill, active]);

  useEffect(() => {
    if (!active || !inquiryHistoryBackfill
        || !["queued", "running"].includes(inquiryHistoryBackfill.status)) return;
    activeInquiryHistoryRunsRef.current.add(inquiryHistoryBackfill.runId);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshInquiryHistoryBackfill(inquiryHistoryBackfill.runId);
      }
    };
    const interval = window.setInterval(refreshWhenVisible, 15_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [inquiryHistoryBackfill, refreshInquiryHistoryBackfill, active]);

  useEffect(() => {
    if (!inquiryHistoryBackfill
        || !["succeeded", "failed", "blocked"].includes(inquiryHistoryBackfill.status)
        || !activeInquiryHistoryRunsRef.current.has(inquiryHistoryBackfill.runId)) return;
    const notificationKey = `${inquiryHistoryBackfill.runId}:${inquiryHistoryBackfill.status}`;
    if (notifiedInquiryHistoryRunsRef.current.has(notificationKey)) return;
    notifiedInquiryHistoryRunsRef.current.add(notificationKey);
    const historyChannelLabel = inquiryHistoryBackfill.channels.map((channel) => channels[channel].name).join("·");
    notify(inquiryHistoryBackfill.status === "succeeded"
      ? `${historyChannelLabel} ${inquiryHistoryBackfill.historyDays}일 문의 이력 ${inquiryHistoryBackfill.succeededJobs}개 작업을 모두 반영했습니다.`
      : inquiryHistoryBackfill.status === "blocked"
        ? `${historyChannelLabel} 문의 조회에는 승인된 고정 egress 설정이 필요합니다. 작업을 자동 재시도하지 않습니다.`
        : `${historyChannelLabel} ${inquiryHistoryBackfill.historyDays}일 문의 이력 중 ${inquiryHistoryBackfill.failedJobs}개 작업은 실패해 완료 처리하지 않았습니다.`);
    void reload();
  }, [inquiryHistoryBackfill, notify, reload]);

  return { snapshot, loading, error, reload, saveTicketReply, getTicketDeliveryStatus, updateTicketStatus, generateSupportReply, syncCsInquiries, syncingCsInquiries, inquiryHistoryBackfill };
}
