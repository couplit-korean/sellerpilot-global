const TRANSIENT_VISION_CUTOUT_PATTERN = /(?:SELLERPILOT_TRANSIENT_(?:VISION|SWIFT_CHILD)_FAILURE|RECOMPILE\s+E5|unable\s+to\s+create\s+E5RT\s+execution\s+stream|com\.apple\.Quagga[\s\S]{0,160}(?:Inference|execution)[\s\S]{0,80}(?:failed|failure)|(?:Vision|ANE|E5RT|Quagga)[\s\S]{0,120}(?:temporar(?:y|ily)|unavailable|resource\s+busy|connection\s+(?:closed|invalidated)))/i;

const TRANSIENT_CHILD_ERROR_CODES = new Set(["EAGAIN", "EBUSY", "EMFILE", "ENFILE"]);
const SAFE_REPEATED_FAILURE =
  "원본 상품 픽셀 보호 도구의 일시적인 Vision 실행 오류가 반복되었습니다. 작업자를 확인한 뒤 다시 실행해 주세요.";

type RetryDelay = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

type VisionCutoutRetryOptions<T> = {
  mode: string;
  signal?: AbortSignal;
  runAttempt: (attempt: number) => Promise<T>;
  onRetry?: (attempt: number, mode: string) => void;
  delay?: RetryDelay;
  backoffMs?: number;
};

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("원본 상품 픽셀 보호 작업이 취소되었습니다.");
}

async function boundedDelay(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) throw abortReason(signal);
  if (milliseconds <= 0) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(), milliseconds);
    const onAbort = () => finish(signal ? abortReason(signal) : undefined);
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function isTransientVisionCutoutFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.trim();
  // Product identity and provenance validation failures are intentionally
  // fail-closed Korean messages. Never reinterpret one as a transient runtime
  // failure even if untrusted input happens to mention a runtime marker.
  if (!message || /[가-힣]/u.test(message)) return false;
  const candidateCode = (error as NodeJS.ErrnoException).code;
  const code = typeof candidateCode === "string" ? candidateCode : "";
  return TRANSIENT_CHILD_ERROR_CODES.has(code) || TRANSIENT_VISION_CUTOUT_PATTERN.test(message);
}

export async function runVisionCutoutWithTransientRetry<T>({
  mode,
  signal,
  runAttempt,
  onRetry,
  delay = boundedDelay,
  backoffMs = 300,
}: VisionCutoutRetryOptions<T>) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (signal?.aborted) throw abortReason(signal);
    try {
      return await runAttempt(attempt);
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal);
      if (!isTransientVisionCutoutFailure(error)) throw error;
      if (attempt === 2) throw new Error(SAFE_REPEATED_FAILURE);
      onRetry?.(attempt, mode);
      await delay(backoffMs, signal);
    }
  }
  throw new Error(SAFE_REPEATED_FAILURE);
}
