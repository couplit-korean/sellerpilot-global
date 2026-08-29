"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const toastDurationMs = 2_000;
export type ToastTone = "success" | "info" | "warning" | "error";

export function toastToneForMessage(message: string): ToastTone {
  if (/(실패|오류|못했습니다|거절|유효하지|초과했습니다)/.test(message)) return "error";
  if (/(권한|차단|재시도|일부|확인 필요|찾지 못|없습니다|중단|필요합니다|주세요)/.test(message)) return "warning";
  if (/(중입니다|(?:AI 분석 중|채널 등록 중|처리 중|진행 중)(?![가-힣A-Za-z0-9_])|시작|대기|등록했습니다|불러왔습니다|다시 연결|상태 변경|새 주문|새 CS)/.test(message)) return "info";
  return "success";
}

export type ToastItem = { id: number; message: string };

export function appendToast(queue: ToastItem[], message: string, id: number) {
  const normalized = message.trim();
  if (!normalized) return queue;
  return [...queue, { id, message: normalized }];
}

export function shiftToastQueue(queue: ToastItem[]) {
  return queue.slice(1);
}

export function useToastQueue(durationMs = toastDurationMs) {
  const [queue, setQueue] = useState<ToastItem[]>([]);
  const nextToastIdRef = useRef(0);
  const currentToast = queue[0] ?? null;
  const toast = currentToast?.message ?? "";

  const notify = useCallback((message: string) => {
    nextToastIdRef.current += 1;
    const id = nextToastIdRef.current;
    setQueue((current) => appendToast(current, message, id));
  }, []);

  const dismissToast = useCallback(() => {
    setQueue(shiftToastQueue);
  }, []);

  useEffect(() => {
    if (!currentToast) return;
    const timer = window.setTimeout(dismissToast, durationMs);
    return () => window.clearTimeout(timer);
  }, [currentToast, dismissToast, durationMs]);

  return { toast, notify, dismissToast };
}
