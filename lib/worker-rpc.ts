const WORKER_AUTH_ERROR_CODE = "42501";

export const WORKER_RPC_TIMEOUT_MS = 8_000;

type RpcErrorLike = {
  code?: string | null;
};

export function workerRpcErrorStatus(error: RpcErrorLike | null | undefined): 401 | 503 {
  return error?.code === WORKER_AUTH_ERROR_CODE ? 401 : 503;
}

export function workerRpcErrorMessage(status: 401 | 503) {
  return status === 401
    ? "채널 작업자 토큰이 유효하지 않습니다."
    : "운영 데이터베이스 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.";
}

export function createBoundedSupabaseFetch(timeoutMs = WORKER_RPC_TIMEOUT_MS) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;
    return fetch(input, { ...init, signal });
  };
}
