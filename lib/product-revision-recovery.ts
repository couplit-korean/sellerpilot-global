export type RecoverableProductRevision = {
  jobId: string;
  status: string;
};

export async function recoverAmbiguousProductRevision<State extends RecoverableProductRevision>({
  jobId,
  readState,
  wait,
  signal,
  attempts = 4,
}: {
  jobId: string;
  readState: (jobId: string, signal: AbortSignal) => Promise<State | null>;
  wait: (delayMs: number, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
  attempts?: number;
}): Promise<State | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal.aborted) throw signal.reason ?? new DOMException("상품 수정 상태 확인을 중단했습니다.", "AbortError");
    const state = await readState(jobId, signal);
    if (state?.jobId === jobId) return state;
    if (attempt + 1 < attempts) await wait(500 * (attempt + 1), signal);
  }
  return null;
}
