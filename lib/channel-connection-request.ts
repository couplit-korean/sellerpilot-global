/** Channel OAuth requests need a deadline through body parsing as well as
 * headers. Use AbortController for browsers without AbortSignal.timeout. */
export async function requestChannelConnection(
  url: string,
  init: Omit<RequestInit, "signal">,
  timeoutMs = 25_000,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException("채널 연결 응답 시간이 초과되었습니다. 연결 상태를 먼저 확인해 주세요.", "TimeoutError");
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { ...init, signal: controller.signal });
        const payload: unknown = await response.json();
        return { response, payload };
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
