import type { RemoteResponse } from "./protocols";

export type ChannelOperationStep = {
  name: string;
  ok: boolean;
  status: number;
  requestId?: string;
  data: Record<string, unknown>;
};

const SAFE_RATE_HEADER_NAMES = [
  "retry-after",
  "x-ebay-api-call-limit",
  "x-ebay-api-call-limit-remaining",
  "x-ebay-api-call-limit-reset",
  "x-ebay-c-apicall-limit",
  "x-ebay-c-user-rate-limit",
  "x-ebay-c-user-rate-limit-remaining",
  "x-ebay-c-user-rate-limit-reset",
] as const;

function safeRateHeaders(response: Response) {
  const headers: Record<string, string> = {};
  for (const name of SAFE_RATE_HEADER_NAMES) {
    const value = response.headers.get(name)?.trim();
    if (value && value.length <= 160 && /^[\w\s,.:;=+/-]+$/.test(value)) headers[name] = value;
  }
  return headers;
}

export function requestIdentifier(data: Record<string, unknown>) {
  for (const key of ["request_id", "requestId", "traceId", "rCode"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 160);
  }
  return undefined;
}

export function step(name: string, remote: RemoteResponse): ChannelOperationStep {
  const resultCode = remote.data.ResultCode ?? remote.data.ErrorCode;
  const commonCode = remote.data.code;
  const shopeeError = remote.data.error;
  const temuSuccess = remote.data.success;
  const normalizedCommonCode = commonCode === undefined || commonCode === null ? "" : String(commonCode).toUpperCase();
  const commonCodeAccepted = !normalizedCommonCode
    || ["0", "SUCCESS", "SUCCES", "OK"].includes(normalizedCommonCode)
    || (/^2\d\d$/.test(normalizedCommonCode));
  const providerAccepted =
    (resultCode === undefined || resultCode === null || String(resultCode) === "0") &&
    commonCodeAccepted &&
    (temuSuccess === undefined || temuSuccess === true) &&
    (shopeeError === undefined || shopeeError === null || String(shopeeError) === "");
  const responseHeaders = safeRateHeaders(remote.response);
  return {
    name,
    ok: remote.response.ok && providerAccepted,
    status: remote.response.status,
    requestId: requestIdentifier(remote.data),
    data: Object.keys(responseHeaders).length
      ? { ...remote.data, sellerpilotRateLimit: { responseHeaders } }
      : remote.data,
  };
}
