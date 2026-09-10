import { createClient } from "./supabase/client";

export class AuthenticationRequiredError extends Error {}

function abortable<T>(promise: PromiseLike<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("요청이 취소되었습니다.", "AbortError"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("요청이 취소되었습니다.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

// Authentication is infrastructure only: no workspace data, request registry,
// abort controller, polling timer or domain error state is retained here.
export async function authenticatedFetch(input: string, init?: RequestInit): Promise<Response> {
  const { data } = await abortable(createClient().auth.getSession(), init?.signal);
  if (init?.signal?.aborted) throw init.signal.reason;
  if (!data.session?.access_token) throw new AuthenticationRequiredError("다시 로그인해 주세요.");
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  headers.set("authorization", `Bearer ${data.session.access_token}`);
  return abortable(fetch(input, { ...init, cache: "no-store", headers }), init?.signal);
}
