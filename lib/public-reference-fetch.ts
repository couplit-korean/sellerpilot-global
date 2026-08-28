import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

export const maximumPublicReferencePageBytes = 2_000_000;
export const maximumPublicReferenceRedirects = 3;

const maximumPublicReferenceTimeoutMs = 30_000;
const maximumPublicReferenceUrlCharacters = 4_096;
const allowedReferenceContentTypes = new Set([
  "application/xhtml+xml",
  "text/html",
  "text/plain",
]);
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export type PublicReferenceFetchErrorCode =
  | "REFERENCE_ABORTED"
  | "REFERENCE_ADDRESS_BLOCKED"
  | "REFERENCE_BODY_TOO_LARGE"
  | "REFERENCE_CONTENT_ENCODING_INVALID"
  | "REFERENCE_CONTENT_LENGTH_INVALID"
  | "REFERENCE_CONTENT_TYPE_INVALID"
  | "REFERENCE_DNS_FAILED"
  | "REFERENCE_REDIRECT_INVALID"
  | "REFERENCE_REDIRECT_LIMIT"
  | "REFERENCE_REDIRECT_LOOP"
  | "REFERENCE_REQUEST_FAILED"
  | "REFERENCE_TIMEOUT"
  | "REFERENCE_URL_INVALID"
  | "REFERENCE_URL_POLICY_BLOCKED";

export class PublicReferenceFetchError extends Error {
  readonly code: PublicReferenceFetchErrorCode;

  constructor(code: PublicReferenceFetchErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PublicReferenceFetchError";
    this.code = code;
  }
}

export type PublicReferenceFetchOptions = {
  maximumBytes?: number;
  maximumRedirects?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type PublicReferenceDocument = {
  body: Buffer;
  contentType: string;
  finalUrl: string;
  redirects: string[];
  status: number;
};

export type PublicReferenceDnsRecord = {
  address: string;
  family: number;
};

export type PinnedPublicReferenceTarget = {
  address: string;
  family: 4 | 6;
  hostname: string;
  url: URL;
};

type PublicReferenceHop = {
  body: Buffer;
  contentType: string;
  location: string;
  status: number;
};

export type PublicReferenceFetchDependencies = {
  requestHop: (
    target: PinnedPublicReferenceTarget,
    signal: AbortSignal,
    maximumBytes: number,
  ) => Promise<PublicReferenceHop>;
  resolve: (hostname: string) => Promise<PublicReferenceDnsRecord[]>;
};

function ipv4Value(address: string) {
  if (isIP(address) !== 4) return null;
  const octets = address.split(".").map(Number);
  return (((octets[0] << 24) >>> 0)
    + (octets[1] << 16)
    + (octets[2] << 8)
    + octets[3]) >>> 0;
}

function ipv4InPrefix(value: number, network: string, prefixLength: number) {
  const networkValue = ipv4Value(network);
  if (networkValue === null) return false;
  if (prefixLength === 0) return true;
  const mask = (0xffff_ffff << (32 - prefixLength)) >>> 0;
  return (value & mask) === (networkValue & mask);
}

const blockedIpv4Prefixes = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const;

function ipv6Value(address: string) {
  let normalized = address.toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }
  if (normalized.includes("%")) return null;

  const dottedMatch = normalized.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dottedMatch) {
    const embedded = ipv4Value(dottedMatch[1]);
    if (embedded === null) return null;
    normalized = `${normalized.slice(0, -dottedMatch[1].length)}${(embedded >>> 16).toString(16)}:${(embedded & 0xffff).toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (left.some((group) => !/^[0-9a-f]{1,4}$/.test(group))
    || right.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (missing < 1 && halves.length === 2) return null;
  if (halves.length === 1 && left.length !== 8) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8) return null;
  return groups.reduce(
    (value, group) => (value << BigInt(16)) | BigInt(Number.parseInt(group, 16)),
    BigInt(0),
  );
}

function ipv6InPrefix(value: bigint, network: string, prefixLength: number) {
  const networkValue = ipv6Value(network);
  if (networkValue === null) return false;
  if (prefixLength === 0) return true;
  const shift = BigInt(128 - prefixLength);
  return (value >> shift) === (networkValue >> shift);
}

/**
 * Returns true only for conservative, globally routable IPv4/IPv6 addresses.
 * Transition, mapped, documentation, benchmark, multicast, link-local and
 * otherwise special-purpose ranges deliberately fail closed.
 */
export function isPublicReferenceAddress(address: string) {
  const normalized = address.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const family = isIP(normalized);
  if (family === 4) {
    const value = ipv4Value(normalized);
    return value !== null && !blockedIpv4Prefixes.some(([network, bits]) => ipv4InPrefix(value, network, bits));
  }
  if (family !== 6) return false;
  const value = ipv6Value(normalized);
  if (value === null) return false;

  // Current globally routable unicast space is 2000::/3. Keep special-use
  // ranges inside it blocked as well. This also rejects IPv4-mapped/NAT64,
  // ULA, link-local, multicast and unspecified addresses without translation
  // ambiguity.
  if (!ipv6InPrefix(value, "2000::", 3)) return false;
  return ![
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["3fff::", 20],
  ].some(([network, bits]) => ipv6InPrefix(value, String(network), Number(bits)));
}

function normalizedHostname(url: URL) {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

export function validatePublicReferenceUrl(input: string | URL) {
  const raw = input instanceof URL ? input.toString() : String(input);
  if (!raw || raw.length > maximumPublicReferenceUrlCharacters) {
    throw new PublicReferenceFetchError("REFERENCE_URL_INVALID", "참고 링크 형식이 올바르지 않습니다.");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch (cause) {
    throw new PublicReferenceFetchError("REFERENCE_URL_INVALID", "참고 링크 형식이 올바르지 않습니다.", { cause });
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)
    || url.username
    || url.password
    || url.port) {
    throw new PublicReferenceFetchError(
      "REFERENCE_URL_POLICY_BLOCKED",
      "기본 포트의 http/https 공개 링크만 지원합니다.",
    );
  }
  const hostname = normalizedHostname(url);
  if (!hostname
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")) {
    throw new PublicReferenceFetchError("REFERENCE_URL_POLICY_BLOCKED", "로컬 네트워크 링크는 지원하지 않습니다.");
  }
  url.hash = "";
  return url;
}

function abortError(signal: AbortSignal, externalSignal?: AbortSignal) {
  if (externalSignal?.aborted) {
    return new PublicReferenceFetchError("REFERENCE_ABORTED", "참고 링크 확인이 취소됐습니다.", {
      cause: externalSignal.reason,
    });
  }
  return new PublicReferenceFetchError("REFERENCE_TIMEOUT", "참고 링크 응답 제한시간을 초과했습니다.", {
    cause: signal.reason,
  });
}

async function raceWithSignal<T>(operation: Promise<T>, signal: AbortSignal, externalSignal?: AbortSignal) {
  if (signal.aborted) throw abortError(signal, externalSignal);
  return new Promise<T>((resolveOperation, rejectOperation) => {
    const onAbort = () => rejectOperation(abortError(signal, externalSignal));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolveOperation(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        rejectOperation(error);
      },
    );
  });
}

async function defaultResolve(hostname: string) {
  const family = isIP(hostname);
  if (family === 4 || family === 6) return [{ address: hostname, family }];
  return lookup(hostname, { all: true, verbatim: true });
}

async function resolvePinnedTarget(
  url: URL,
  resolver: PublicReferenceFetchDependencies["resolve"],
  signal: AbortSignal,
  externalSignal?: AbortSignal,
) {
  const hostname = normalizedHostname(url);
  let records: PublicReferenceDnsRecord[];
  try {
    records = await raceWithSignal(resolver(hostname), signal, externalSignal);
  } catch (cause) {
    if (cause instanceof PublicReferenceFetchError) throw cause;
    throw new PublicReferenceFetchError("REFERENCE_DNS_FAILED", "참고 링크의 공개 주소를 확인하지 못했습니다.", { cause });
  }
  const normalizedRecords = records.map((record) => ({
    address: String(record.address).trim().toLowerCase().replace(/^\[|\]$/g, ""),
    family: isIP(String(record.address).trim().replace(/^\[|\]$/g, "")),
  }));
  if (!normalizedRecords.length
    || normalizedRecords.some((record) => !isPublicReferenceAddress(record.address))) {
    throw new PublicReferenceFetchError(
      "REFERENCE_ADDRESS_BLOCKED",
      "내부 또는 예약 네트워크 주소는 접근할 수 없습니다.",
    );
  }
  const selected = normalizedRecords[0];
  if (selected.family !== 4 && selected.family !== 6) {
    throw new PublicReferenceFetchError("REFERENCE_ADDRESS_BLOCKED", "확인할 수 없는 네트워크 주소입니다.");
  }
  return {
    address: selected.address,
    family: selected.family,
    hostname,
    url,
  } satisfies PinnedPublicReferenceTarget;
}

function singleHeader(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name];
  if (Array.isArray(value)) return value.length === 1 ? value[0] : "";
  return value ?? "";
}

function assertReferenceContentHeaders(headers: IncomingHttpHeaders, maximumBytes: number) {
  const contentType = singleHeader(headers, "content-type").trim();
  const baseContentType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (!allowedReferenceContentTypes.has(baseContentType)) {
    throw new PublicReferenceFetchError(
      "REFERENCE_CONTENT_TYPE_INVALID",
      "HTML 또는 텍스트 링크만 지원합니다.",
    );
  }
  const contentEncoding = singleHeader(headers, "content-encoding").trim().toLowerCase();
  if (contentEncoding && contentEncoding !== "identity") {
    throw new PublicReferenceFetchError(
      "REFERENCE_CONTENT_ENCODING_INVALID",
      "압축되지 않은 HTML 또는 텍스트 응답만 지원합니다.",
    );
  }
  const contentLength = singleHeader(headers, "content-length").trim();
  if (contentLength) {
    if (!/^\d+$/.test(contentLength)) {
      throw new PublicReferenceFetchError("REFERENCE_CONTENT_LENGTH_INVALID", "참고 링크 본문 크기가 올바르지 않습니다.");
    }
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maximumBytes) {
      throw new PublicReferenceFetchError("REFERENCE_BODY_TOO_LARGE", "참고 링크 본문이 2MB를 초과합니다.");
    }
  }
  return contentType;
}

export async function collectBoundedPublicReferenceBody(
  source: AsyncIterable<Uint8Array>,
  maximumBytes = maximumPublicReferencePageBytes,
) {
  const safeMaximum = Math.max(1, Math.min(maximumPublicReferencePageBytes, Math.trunc(maximumBytes)));
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of source) {
    const bytes = Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > safeMaximum) {
      throw new PublicReferenceFetchError("REFERENCE_BODY_TOO_LARGE", "참고 링크 본문이 2MB를 초과합니다.");
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}

async function requestPinnedReferenceHop(
  target: PinnedPublicReferenceTarget,
  signal: AbortSignal,
  maximumBytes: number,
) {
  return new Promise<PublicReferenceHop>((resolveRequest, rejectRequest) => {
    let settled = false;
    const finish = (error: unknown, result?: PublicReferenceHop) => {
      if (settled) return;
      settled = true;
      if (error) rejectRequest(error);
      else resolveRequest(result!);
    };
    const request = (target.url.protocol === "https:" ? httpsRequest : httpRequest)({
      agent: false,
      family: target.family,
      headers: {
        accept: "text/html,text/plain;q=0.9,application/xhtml+xml;q=0.8",
        "accept-encoding": "identity",
        connection: "close",
        host: target.url.host,
        "user-agent": "SellerPilot-Product-Reference/1.1",
      },
      hostname: target.address,
      maxHeaderSize: 16 * 1_024,
      method: "GET",
      path: `${target.url.pathname}${target.url.search}`,
      port: target.url.protocol === "https:" ? 443 : 80,
      protocol: target.url.protocol,
      servername: target.url.protocol === "https:" && isIP(target.hostname) === 0
        ? target.hostname
        : undefined,
      signal,
    }, (response) => {
      const status = response.statusCode ?? 0;
      const location = singleHeader(response.headers, "location").trim();
      if (redirectStatuses.has(status) || status < 200 || status >= 300) {
        finish(null, { body: Buffer.alloc(0), contentType: "", location, status });
        response.destroy();
        return;
      }

      let contentType: string;
      try {
        contentType = assertReferenceContentHeaders(response.headers, maximumBytes);
      } catch (error) {
        finish(error);
        response.destroy();
        return;
      }

      void collectBoundedPublicReferenceBody(response, maximumBytes).then(
        (body) => finish(null, { body, contentType, location: "", status }),
        (error) => {
          finish(error);
          response.destroy();
        },
      );
    });
    request.once("error", (cause) => {
      if (signal.aborted) return finish(abortError(signal));
      finish(new PublicReferenceFetchError("REFERENCE_REQUEST_FAILED", "참고 링크 본문을 가져오지 못했습니다.", { cause }));
    });
    request.end();
  });
}

const defaultDependencies: PublicReferenceFetchDependencies = {
  requestHop: requestPinnedReferenceHop,
  resolve: defaultResolve,
};

function normalizedOptions(options: PublicReferenceFetchOptions) {
  const maximumBytes = Number.isFinite(options.maximumBytes)
    ? Math.max(1, Math.min(maximumPublicReferencePageBytes, Math.trunc(options.maximumBytes!)))
    : maximumPublicReferencePageBytes;
  const maximumRedirects = Number.isFinite(options.maximumRedirects)
    ? Math.max(0, Math.min(maximumPublicReferenceRedirects, Math.trunc(options.maximumRedirects!)))
    : maximumPublicReferenceRedirects;
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1, Math.min(maximumPublicReferenceTimeoutMs, Math.trunc(options.timeoutMs!)))
    : 15_000;
  return { maximumBytes, maximumRedirects, timeoutMs };
}

/**
 * Applies the same URL and DNS policy without downloading a response body.
 * This is useful before handing a URL to a trusted marketplace API that will
 * perform the actual transfer itself.
 */
export async function assertPublicReferenceUrl(
  input: string | URL,
  options: Pick<PublicReferenceFetchOptions, "signal" | "timeoutMs"> = {},
) {
  const policy = normalizedOptions(options);
  const timeoutSignal = AbortSignal.timeout(policy.timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  const url = validatePublicReferenceUrl(input);
  await resolvePinnedTarget(url, defaultDependencies.resolve, signal, options.signal);
  return url;
}

/**
 * Fetches one public HTML/text reference document. Every redirect target is
 * resolved and policy-checked again, then the socket connects to the selected
 * validated IP while preserving the original Host header and HTTPS SNI.
 */
export async function fetchPublicReferenceDocument(
  input: string | URL,
  options: PublicReferenceFetchOptions = {},
) {
  return fetchPublicReferenceDocumentWithDependencies(input, options, defaultDependencies);
}

/** Test seam for deterministic redirect, rebinding and timeout coverage. */
export async function fetchPublicReferenceDocumentWithDependencies(
  input: string | URL,
  options: PublicReferenceFetchOptions,
  dependencies: PublicReferenceFetchDependencies,
) {
  const policy = normalizedOptions(options);
  const timeoutSignal = AbortSignal.timeout(policy.timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  let currentUrl = validatePublicReferenceUrl(input);
  const seen = new Set([currentUrl.toString()]);
  const redirects: string[] = [];

  while (true) {
    if (signal.aborted) throw abortError(signal, options.signal);
    const target = await resolvePinnedTarget(currentUrl, dependencies.resolve, signal, options.signal);
    let hop: PublicReferenceHop;
    try {
      hop = await raceWithSignal(
        dependencies.requestHop(target, signal, policy.maximumBytes),
        signal,
        options.signal,
      );
    } catch (cause) {
      if (cause instanceof PublicReferenceFetchError) throw cause;
      if (signal.aborted) throw abortError(signal, options.signal);
      throw new PublicReferenceFetchError("REFERENCE_REQUEST_FAILED", "참고 링크 본문을 가져오지 못했습니다.", { cause });
    }

    if (redirectStatuses.has(hop.status)) {
      if (!hop.location) {
        throw new PublicReferenceFetchError("REFERENCE_REDIRECT_INVALID", "참고 링크의 이동 주소가 비어 있습니다.");
      }
      if (redirects.length >= policy.maximumRedirects) {
        throw new PublicReferenceFetchError("REFERENCE_REDIRECT_LIMIT", "참고 링크 리디렉션이 너무 많습니다.");
      }
      let nextUrl: URL;
      try {
        nextUrl = validatePublicReferenceUrl(new URL(hop.location, currentUrl));
      } catch (cause) {
        if (cause instanceof PublicReferenceFetchError) throw cause;
        throw new PublicReferenceFetchError("REFERENCE_REDIRECT_INVALID", "참고 링크의 이동 주소가 올바르지 않습니다.", { cause });
      }
      if (seen.has(nextUrl.toString())) {
        throw new PublicReferenceFetchError("REFERENCE_REDIRECT_LOOP", "참고 링크 리디렉션이 반복됩니다.");
      }
      seen.add(nextUrl.toString());
      redirects.push(nextUrl.toString());
      currentUrl = nextUrl;
      continue;
    }

    if (hop.status >= 200 && hop.status < 300) {
      const baseContentType = hop.contentType.split(";", 1)[0].trim().toLowerCase();
      if (!allowedReferenceContentTypes.has(baseContentType)) {
        throw new PublicReferenceFetchError("REFERENCE_CONTENT_TYPE_INVALID", "HTML 또는 텍스트 링크만 지원합니다.");
      }
      if (hop.body.byteLength > policy.maximumBytes) {
        throw new PublicReferenceFetchError("REFERENCE_BODY_TOO_LARGE", "참고 링크 본문이 2MB를 초과합니다.");
      }
    }

    return {
      body: hop.body,
      contentType: hop.contentType,
      finalUrl: currentUrl.toString(),
      redirects,
      status: hop.status,
    } satisfies PublicReferenceDocument;
  }
}
