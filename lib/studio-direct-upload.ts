import { requireSupabaseBrowserConfig } from "./supabase/config";

const safeStoragePathPattern = /^[A-Za-z0-9._/-]+$/;

function encodeStoragePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export async function uploadStudioStorageObject({
  accessToken,
  path,
  body,
  contentType,
  cacheControl,
  parentSignal,
  timeoutMs,
  fetcher = globalThis.fetch,
  configuration,
}: {
  accessToken: string;
  path: string;
  body: Blob;
  contentType: string;
  cacheControl: string;
  parentSignal: AbortSignal;
  timeoutMs: number;
  fetcher?: typeof fetch;
  configuration?: { supabaseUrl: string; supabasePublishableKey: string };
}) {
  if (!accessToken || !path || path.startsWith("/") || path.includes("..")
      || !safeStoragePathPattern.test(path) || body.size < 1 || body.type !== contentType) {
    throw new Error("상품 이미지 직접 업로드 요청이 안전 규격과 일치하지 않습니다.");
  }
  const { supabaseUrl, supabasePublishableKey } = configuration ?? requireSupabaseBrowserConfig();
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([parentSignal, timeoutSignal]);
  const formData = new FormData();
  formData.append("cacheControl", cacheControl);
  formData.append("", body);
  let response: Response;
  try {
    response = await fetcher(
      `${supabaseUrl}/storage/v1/object/sellerpilot-ai/${encodeStoragePath(path)}`,
      {
        method: "POST",
        headers: {
          apikey: supabasePublishableKey,
          authorization: `Bearer ${accessToken}`,
          "x-upsert": "false",
        },
        body: formData,
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal,
      },
    );
  } catch (error) {
    if (parentSignal.aborted) throw parentSignal.reason ?? new DOMException("상품 이미지 업로드를 중단했습니다.", "AbortError");
    if (timeoutSignal.aborted) throw new Error("상품 이미지 직접 업로드 제한시간을 초과했습니다.");
    throw error;
  }
  if (!response.ok) throw new Error("상품 이미지 직접 업로드에 실패했습니다.");
}
