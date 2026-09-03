import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import {
  buildShopeeSignature,
  lazadaApiEndpoints,
  readRemoteResponse,
  shopeeEnvironment,
  signLazadaRequest,
  textValue,
  type RemoteResponse,
  type SecretPayload,
} from "./protocols";

// ---------------------------------------------------------------------------
// Channel-native image upload (Shopee media_space, Lazada UploadImage /
// MigrateImage).
//
// The normalization pipeline in marketplace-images.ts emits public Supabase
// URLs (1200x1200 JPEG, <=3MB). This module migrates those URLs into each
// channel's own media space so the listing payload references channel-native
// assets:
//   - Shopee: media_space/upload_image returns image_id values that the
//     v2 product payload consumes as image.image_id_list.
//   - Lazada: UploadImage (local bytes) or MigrateImage (external URL)
//     returns slatic.net URLs that replace every external URL in the
//     product payload and description HTML.
//
// All HTTP goes through an injectable fetch so tests can verify request
// serialization and result interpretation without network access. Validation
// failures throw; classified remote failures are returned in the result.
// ---------------------------------------------------------------------------

export type NativeImageUploadChannel = "shopee" | "lazada";
export type NativeImageUploadEnvironment = "sandbox" | "production";
export type NativeFetch = typeof fetch;

export type NativeImageUploadStep = {
  name: string;
  ok: boolean;
  status: number;
  requestId?: string;
  data: Record<string, unknown>;
};

// "upload" marks a transport/backend failure where retrying the same request
// may succeed. "validation" marks an image validity rejection (format, size,
// count, URL policy) that will not change on retry.
export type NativeImageFailureKind = "upload" | "validation";

export type NativeImageUploadFailure = {
  kind: NativeImageFailureKind;
  retryable: boolean;
  message: string;
  sourceUrl?: string;
};

export const shopeeMediaSpacePath = "/api/v2/media_space/upload_image";
export const lazadaUploadImagePath = "/image/upload";
export const lazadaMigrateImagePath = "/image/migrate";

// Official limits: Shopee media_space accepts JPG/JPEG/PNG, max 10MB each,
// fewer than 9 images per request and up to 9 images per product.
export const shopeeMaxImageBytes = 10 * 1024 * 1024;
export const shopeeMaxImagesPerRequest = 8;
export const shopeeMaxProductImages = 9;

// Official 2024 Lazada Image Upload guide: maxOriginalMediaByteSize 3145728,
// supported formats jpg/png. UploadImage migrates one image per call.
export const lazadaMaxImageBytes = 3_145_728;
export const lazadaMaxMigrateUrls = 24;

export type NativeImageFileLimits = {
  maxBytes: number;
  mimeTypes: readonly string[];
};

export const shopeeImageLimits: NativeImageFileLimits = {
  maxBytes: shopeeMaxImageBytes,
  mimeTypes: ["image/jpeg", "image/png"],
};

export const lazadaImageLimits: NativeImageFileLimits = {
  maxBytes: lazadaMaxImageBytes,
  mimeTypes: ["image/jpeg", "image/png"],
};

export type NativeImageUploadResult = {
  ok: boolean;
  channel: NativeImageUploadChannel;
  steps: NativeImageUploadStep[];
  failures: NativeImageUploadFailure[];
  retryable: boolean;
  imageIds: string[];
  imageUrls: string[];
  argumentsValue: Record<string, unknown>;
  safeMessage: string;
};

// ---------------------------------------------------------------------------
// Small shared helpers (mirrors marketplace-images.ts conventions).
// ---------------------------------------------------------------------------

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function numericId(value: string, name: string) {
  if (!/^\d+$/.test(value)) throw new Error(`SHOPEE_CREDENTIALS_MISSING:${name}`);
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) throw new Error(`SHOPEE_CREDENTIALS_MISSING:${name}`);
  return numeric;
}

function step(name: string, ok: boolean, status: number, data: Record<string, unknown>, requestId?: string): NativeImageUploadStep {
  return { name, ok, status, ...(requestId ? { requestId } : {}), data };
}

function safeFailureMessage(message: string) {
  return message
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .replace(/\b(key|token|secret|sign|access_token)=[^&\s|]+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function safeImageUrl(value: unknown) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
  } catch {
    return "";
  }
  return trimmed;
}

function filenameFromUrl(sourceUrl: string, contentType: string) {
  const extension = contentType === "image/png" ? "png" : "jpg";
  try {
    const base = new URL(sourceUrl).pathname.split("/").pop() ?? "";
    const safe = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
    return safe && /\.(jpe?g|png)$/i.test(safe) ? safe : `image.${extension}`;
  } catch {
    return `image.${extension}`;
  }
}

// ---------------------------------------------------------------------------
// Argument validation: image bytes (size + format), count limits, and the
// MigrateImage URL policy Lazada documents (ports 80/443, SSRF checks, no IP
// links, *.sg94 / *.id35 blacklist). Validation failures throw.
// ---------------------------------------------------------------------------

export function imageFormatFromBytes(bytes: Uint8Array): "image/jpeg" | "image/png" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= pngMagic.length && pngMagic.every((value, index) => bytes[index] === value)) return "image/png";
  return null;
}

export function validateNativeImageBytes(bytes: Uint8Array, limits: NativeImageFileLimits) {
  if (!bytes.length || bytes.length > limits.maxBytes) throw new Error("NATIVE_IMAGE_SIZE_INVALID");
  const format = imageFormatFromBytes(bytes);
  if (!format || !limits.mimeTypes.includes(format)) throw new Error("NATIVE_IMAGE_FORMAT_INVALID");
  return { format, size: bytes.length };
}

export function assertNativeImageCount(count: number, max: number) {
  if (!Number.isInteger(count) || count < 1 || count > max) throw new Error("NATIVE_IMAGE_COUNT_INVALID");
  return count;
}

export function assertMigrateImageUrl(value: string) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("NATIVE_IMAGE_URL_INVALID");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("NATIVE_IMAGE_URL_INVALID");
  }
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (![80, 443].includes(port)) throw new Error("NATIVE_IMAGE_URL_INVALID");
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) throw new Error("NATIVE_IMAGE_URL_INVALID");
  if (isIP(hostname)) throw new Error("NATIVE_IMAGE_URL_INVALID");
  if (hostname.endsWith(".sg94") || hostname.endsWith(".id35")) throw new Error("NATIVE_IMAGE_URL_INVALID");
  return url.toString();
}

// ---------------------------------------------------------------------------
// Downloading normalized source images (public URLs produced by
// marketplace-images.ts). The URL policy check here is syntactic: the
// normalization pipeline already performed DNS-level SSRF screening before
// publishing, and literal IP hosts are rejected offline.
// ---------------------------------------------------------------------------

export async function downloadNativeImageSource(input: {
  sourceUrl: string;
  fetchImpl: NativeFetch;
  limits: NativeImageFileLimits;
}) {
  const url = assertMigrateImageUrl(input.sourceUrl);
  let response: Response;
  try {
    response = await fetchWithTimeout(input.fetchImpl, url, { redirect: "error" }, 20_000);
  } catch {
    throw new Error("NATIVE_IMAGE_DOWNLOAD_FAILED");
  }
  const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0].toLowerCase();
  if (!response.ok || !input.limits.mimeTypes.includes(contentType)) throw new Error("NATIVE_IMAGE_DOWNLOAD_FAILED");
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > input.limits.maxBytes) throw new Error("NATIVE_IMAGE_SIZE_INVALID");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > input.limits.maxBytes) throw new Error("NATIVE_IMAGE_SIZE_INVALID");
  validateNativeImageBytes(bytes, input.limits);
  return { bytes, contentType };
}

async function fetchWithTimeout(fetchImpl: NativeFetch, url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Multipart form-data serialization (no external dependencies).
// ---------------------------------------------------------------------------

export type NativeMultipartField =
  | { name: string; value: string }
  | { name: string; filename: string; contentType: string; bytes: Uint8Array };

export function buildMultipartBody(fields: NativeMultipartField[], boundary = `----SellerPilot-${randomUUID()}`) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const field of fields) {
    chunks.push(encoder.encode(`--${boundary}\r\n`));
    if ("value" in field) {
      chunks.push(encoder.encode(`Content-Disposition: form-data; name="${field.name}"\r\n\r\n`));
      chunks.push(encoder.encode(field.value));
      chunks.push(encoder.encode("\r\n"));
    } else {
      chunks.push(encoder.encode(`Content-Disposition: form-data; name="${field.name}"; filename="${field.filename}"\r\nContent-Type: ${field.contentType}\r\n\r\n`));
      chunks.push(field.bytes);
      chunks.push(encoder.encode("\r\n"));
    }
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`));
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return { body, boundary, contentType: `multipart/form-data; boundary=${boundary}` };
}

// ---------------------------------------------------------------------------
// Shopee media_space/upload_image.
// Official spec: POST /api/v2/media_space/upload_image with the usual signed
// query parameters and a multipart body. `image` is a file part (JPG/JPEG/PNG,
// <=10MB, fewer than 9 images), `scene` ("normal" square processing or "desc"
// passthrough) and `ratio` ("1:1" default, "3:4" whitelisted) are optional
// form fields. The response carries image_id / image_url_list per image.
// ---------------------------------------------------------------------------

export type ShopeeMediaSpaceImageFile = { name: string; bytes: Uint8Array };

export type ShopeeMediaSpaceUploadRequest = {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: Uint8Array;
};

export function buildShopeeMediaSpaceUploadRequest(input: {
  payload: SecretPayload;
  environment: NativeImageUploadEnvironment;
  images: ShopeeMediaSpaceImageFile[];
  scene?: "normal" | "desc";
  ratio?: "1:1" | "3:4";
  nowMs?: number;
}): ShopeeMediaSpaceUploadRequest {
  const partnerId = textValue(input.payload, "partner_id");
  const partnerKey = textValue(input.payload, "partner_key");
  const shopId = textValue(input.payload, "shop_id");
  const accessToken = textValue(input.payload, "access_token");
  if (!partnerId || !partnerKey || !shopId || !accessToken) throw new Error("SHOPEE_CREDENTIALS_MISSING");
  numericId(partnerId, "partner_id");
  numericId(shopId, "shop_id");
  if (input.scene !== undefined && !["normal", "desc"].includes(input.scene)) throw new Error("NATIVE_IMAGE_ARGUMENT_INVALID:scene");
  if (input.ratio !== undefined && !["1:1", "3:4"].includes(input.ratio)) throw new Error("NATIVE_IMAGE_ARGUMENT_INVALID:ratio");
  assertNativeImageCount(input.images.length, shopeeMaxImagesPerRequest);
  const timestamp = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const query = new URLSearchParams({
    partner_id: partnerId,
    timestamp: String(timestamp),
    access_token: accessToken,
    shop_id: shopId,
  });
  query.set("sign", buildShopeeSignature({
    partnerId,
    partnerKey,
    path: shopeeMediaSpacePath,
    timestamp,
    accessToken,
    shopId,
  }));
  const fields: NativeMultipartField[] = input.images.map((image, index) => {
    const format = validateNativeImageBytes(image.bytes, shopeeImageLimits).format;
    const extension = format === "image/png" ? "png" : "jpg";
    return {
      name: "image",
      filename: image.name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || `image-${index + 1}.${extension}`,
      contentType: format,
      bytes: image.bytes,
    };
  });
  if (input.scene) fields.push({ name: "scene", value: input.scene });
  if (input.ratio) fields.push({ name: "ratio", value: input.ratio });
  const multipart = buildMultipartBody(fields);
  return {
    url: `${shopeeEnvironment(input.environment)}${shopeeMediaSpacePath}?${query}`,
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": multipart.contentType,
      "user-agent": "SellerPilot-Shopee-MediaSpace/1.0",
    },
    body: multipart.body,
  };
}

export type ShopeeMediaSpaceImage = {
  index: number;
  imageId: string;
  imageUrl: string;
  imageUrlRegion: string;
  error: string;
  message: string;
  ok: boolean;
};

export type ShopeeMediaSpaceUploadOutcome = {
  images: ShopeeMediaSpaceImage[];
  requestId: string;
  failure: NativeImageUploadFailure | null;
};

const retryableShopeeErrors = new Set([
  "error_network",
  "error_server",
  "error_data",
  "error_tier_img_partial",
  "error_tier_img_old_app",
]);

export function parseShopeeMediaSpaceUploadResult(remote: RemoteResponse, expectedCount: number): ShopeeMediaSpaceUploadOutcome {
  const requestId = String(remote.data.request_id ?? "").trim();
  const topError = String(remote.data.error ?? "").trim();
  const topMessage = String(remote.data.message ?? "").trim();
  let failure: NativeImageUploadFailure | null = null;
  if (!remote.response.ok) {
    const retryable = remote.response.status === 429 || remote.response.status >= 500;
    failure = {
      kind: "upload",
      retryable,
      message: `SHOPEE_MEDIA_SPACE_HTTP_${remote.response.status}`,
    };
  } else if (topError) {
    const baseError = topError.split(".").pop() ?? topError;
    const retryable = retryableShopeeErrors.has(baseError);
    failure = {
      kind: "upload",
      retryable,
      message: safeFailureMessage(topError + (topMessage ? `: ${topMessage}` : "")),
    };
  }
  const responseRoot = record(remote.data.response);
  const infoList = Array.isArray(responseRoot?.image_info_list) ? responseRoot.image_info_list : [];
  const images: ShopeeMediaSpaceImage[] = infoList.map((itemValue, index) => {
    const item = record(itemValue) ?? {};
    const imageInfo = record(item.image_info) ?? {};
    const imageId = String(imageInfo.image_id ?? "").trim();
    const urlList = (Array.isArray(imageInfo.image_url_list) ? imageInfo.image_url_list.map(record) : []).filter((x): x is Record<string, unknown> => Boolean(x));
    const firstUrl = urlList.find((entry) => safeImageUrl(entry.image_url));
    const imageUrl = safeImageUrl(imageInfo.image_url) || (firstUrl ? safeImageUrl(firstUrl.image_url) : "");
    const imageUrlRegion = firstUrl ? String(firstUrl.image_url_region ?? "").trim() : "";
    const error = String(item.error ?? "").trim();
    const message = String(item.message ?? "").trim();
    const parsedIndex = Number.isInteger(Number(item.id)) ? Number(item.id) : index;
    return {
      index: parsedIndex,
      imageId,
      imageUrl,
      imageUrlRegion,
      error,
      message,
      ok: !error && Boolean(imageId) && Boolean(imageUrl),
    };
  });
  if (!failure && images.length && images.some((image) => !image.ok)) {
    const rejected = images.filter((image) => !image.ok);
    failure = {
      kind: "validation",
      retryable: false,
      message: safeFailureMessage(rejected.map((image) => (image.error || "NATIVE_IMAGE_UPLOAD_REJECTED") + (image.message ? `: ${image.message}` : "")).join(" | ")),
    };
  }
  if (!failure && images.length !== expectedCount) {
    failure = {
      kind: "upload",
      retryable: true,
      message: `SHOPEE_MEDIA_SPACE_INCOMPLETE:expected ${expectedCount} received ${images.length}`,
    };
  }
  return { images, requestId, failure };
}

// ---------------------------------------------------------------------------
// Lazada UploadImage (multipart file upload) and MigrateImage (URL migration).
// Lazop signs every non-file parameter; the file part itself is excluded from
// the signature input.
// ---------------------------------------------------------------------------

export type LazadaImageFile = { name: string; bytes: Uint8Array };

function lazadaEndpointAndCommon(payload: SecretPayload) {
  const appKey = textValue(payload, "app_key");
  const appSecret = textValue(payload, "app_secret");
  const accessToken = textValue(payload, "access_token");
  const country = (textValue(payload, "country") || "my").toLowerCase();
  const endpoint = lazadaApiEndpoints[country];
  if (!appKey || !appSecret || !accessToken || !endpoint) throw new Error("LAZADA_CREDENTIALS_MISSING");
  return {
    endpoint,
    appSecret,
    common: { access_token: accessToken, app_key: appKey, sign_method: "sha256" },
  };
}

export function buildLazadaUploadImageRequest(input: {
  payload: SecretPayload;
  image: LazadaImageFile;
  nowMs?: number;
}) {
  const { endpoint, appSecret, common } = lazadaEndpointAndCommon(input.payload);
  const format = validateNativeImageBytes(input.image.bytes, lazadaImageLimits).format;
  const params = { ...common, timestamp: String(input.nowMs ?? Date.now()) };
  const sign = signLazadaRequest(lazadaUploadImagePath, params, appSecret);
  const fields: NativeMultipartField[] = Object.entries({ ...params, sign }).map(([name, value]) => ({ name, value }));
  const extension = format === "image/png" ? "png" : "jpg";
  fields.push({
    name: "image",
    filename: input.image.name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || `image.${extension}`,
    contentType: format,
    bytes: input.image.bytes,
  });
  const multipart = buildMultipartBody(fields);
  return {
    url: `${endpoint}${lazadaUploadImagePath}`,
    method: "POST" as const,
    headers: {
      accept: "application/json",
      "content-type": multipart.contentType,
      "user-agent": "SellerPilot-Lazada-MediaSpace/1.0",
    },
    body: multipart.body,
  };
}

export function buildLazadaMigrateImageRequest(input: {
  payload: SecretPayload;
  url: string;
  nowMs?: number;
}) {
  const { endpoint, appSecret, common } = lazadaEndpointAndCommon(input.payload);
  const normalizedUrl = assertMigrateImageUrl(input.url);
  const params: Record<string, unknown> = { ...common, timestamp: String(input.nowMs ?? Date.now()), url: normalizedUrl };
  params.sign = signLazadaRequest(lazadaMigrateImagePath, params, appSecret);
  return {
    url: `${endpoint}${lazadaMigrateImagePath}`,
    method: "POST" as const,
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      "user-agent": "SellerPilot-Lazada-MediaSpace/1.0",
    },
    body: new URLSearchParams(params),
  };
}

export type LazadaImageOutcome = {
  imageUrl: string;
  hashCode: string;
  requestId: string;
  failure: NativeImageUploadFailure | null;
};

export function parseLazadaImageResult(remote: RemoteResponse, sourceUrl: string): LazadaImageOutcome {
  const code = String(remote.data.code ?? "").trim();
  const requestId = String(remote.data.request_id ?? "").trim();
  const errorText = `${remote.text} ${JSON.stringify(remote.data)}`;
  const base = { imageUrl: "", hashCode: "", requestId, failure: null as NativeImageUploadFailure | null };
  const data = record(remote.data.data) ?? {};
  const image = record(data.image) ?? {};
  const imageUrl = safeImageUrl(image.url);
  const hashCode = String(image.hash_code ?? "").trim();

  if (!remote.response.ok) {
    const retryable = remote.response.status === 429 || remote.response.status >= 500;
    return { ...base, failure: { kind: "upload", retryable, message: `LAZADA_IMAGE_HTTP_${remote.response.status}`, sourceUrl } };
  }
  if (/api access frequency exceeds the limit/i.test(errorText)) {
    return { ...base, failure: { kind: "upload", retryable: true, message: "LAZADA_IMAGE_RATE_LIMITED", sourceUrl } };
  }
  if (code === "0") {
    if (!imageUrl) {
      return { ...base, failure: { kind: "upload", retryable: true, message: "LAZADA_IMAGE_URL_MISSING", sourceUrl } };
    }
    return { ...base, imageUrl, hashCode };
  }
  // E303: image too large. E302: not supported / not a stream / bad URL.
  if (code === "303" || code === "302") {
    return { ...base, failure: { kind: "validation", retryable: false, message: `LAZADA_IMAGE_REJECTED:${code}`, sourceUrl } };
  }
  // E300: upload failed (transient). E1000: internal application error.
  if (code === "300" || code === "1000") {
    return { ...base, failure: { kind: "upload", retryable: true, message: `LAZADA_IMAGE_UPLOAD_FAILED:${code}`, sourceUrl } };
  }
  return { ...base, failure: { kind: "upload", retryable: false, message: safeFailureMessage(`LAZADA_IMAGE_CODE_${code || "UNKNOWN"}`), sourceUrl } };
}

// ---------------------------------------------------------------------------
// Orchestration: prepareMarketplaceImages-compatible input
// (Record<string, unknown> with imageUrls and, for Lazada, the nested
// request.Request.Product structure) is migrated into channel-native media
// and a cloned arguments record is returned with native references applied.
// ---------------------------------------------------------------------------

export type NativeImageUploadInput = {
  channel: NativeImageUploadChannel;
  payload: SecretPayload;
  environment: NativeImageUploadEnvironment;
  argumentsValue: Record<string, unknown>;
  fetchImpl?: NativeFetch;
  scene?: "normal" | "desc";
};

const defaultFetch: NativeFetch = (input, init) => fetch(input, init);

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) result.push(values.slice(offset, offset + size));
  return result;
}

function failureFromError(message: string, sourceUrl?: string): NativeImageUploadFailure {
  const validationCodes = ["NATIVE_IMAGE_SIZE_INVALID", "NATIVE_IMAGE_FORMAT_INVALID", "NATIVE_IMAGE_URL_INVALID"];
  if (validationCodes.some((code) => message.includes(code))) {
    return { kind: "validation", retryable: false, message, sourceUrl };
  }
  return { kind: "upload", retryable: true, message, sourceUrl };
}

function isValidationFailure(failure: NativeImageUploadFailure) {
  return failure.kind === "validation" && !failure.retryable;
}

export async function uploadChannelNativeImages(input: NativeImageUploadInput): Promise<NativeImageUploadResult> {
  const fetchImpl = input.fetchImpl ?? defaultFetch;
  if (input.channel === "shopee") {
    const run = await runShopeeUpload(input, fetchImpl);
    const next = run.ok
      ? applyNativeImagesToArguments({
        channel: "shopee",
        argumentsValue: input.argumentsValue,
        sourceUrls: run.sourceUrls,
        imageUrls: run.imageUrls,
        imageIds: run.imageIds,
      })
      : structuredClone(input.argumentsValue);
    return finishResult("shopee", run.steps, run.failures, run.imageIds, run.imageUrls, next);
  }
  const run = await runLazadaUpload(input, fetchImpl);
  const next = run.ok
    ? applyNativeImagesToArguments({
      channel: "lazada",
      argumentsValue: input.argumentsValue,
      sourceUrls: run.sourceUrls,
      imageUrls: run.imageUrls,
    })
    : structuredClone(input.argumentsValue);
  return finishResult("lazada", run.steps, run.failures, [], run.imageUrls, next);
}

function finishResult(
  channel: NativeImageUploadChannel,
  steps: NativeImageUploadStep[],
  failures: NativeImageUploadFailure[],
  imageIds: string[],
  imageUrls: string[],
  argumentsValue: Record<string, unknown>,
): NativeImageUploadResult {
  const ok = failures.length === 0 && steps.length > 0 && imageUrls.length > 0 && imageUrls.every(Boolean);
  const retryable = failures.length === 0 || failures.every((failure) => failure.retryable);
  return {
    ok,
    channel,
    steps,
    failures,
    retryable,
    imageIds,
    imageUrls,
    argumentsValue,
    safeMessage: safeFailureMessage(failures.map((failure) => failure.message).join(" | ")),
  };
}

async function runShopeeUpload(
  input: NativeImageUploadInput,
  fetchImpl: NativeFetch,
) {
  const sourceUrls = uniqueStrings(strings(input.argumentsValue.imageUrls));
  if (!sourceUrls.length) throw new Error("NATIVE_IMAGE_REQUIRED");
  if (sourceUrls.length > shopeeMaxProductImages) throw new Error("NATIVE_IMAGE_COUNT_INVALID");
  const steps: NativeImageUploadStep[] = [];
  const failures: NativeImageUploadFailure[] = [];
  const files: ShopeeMediaSpaceImageFile[] = [];
  for (const [index, sourceUrl] of sourceUrls.entries()) {
    try {
      const downloaded = await downloadNativeImageSource({ sourceUrl, fetchImpl, limits: shopeeImageLimits });
      files.push({ name: filenameFromUrl(sourceUrl, downloaded.contentType), bytes: downloaded.bytes });
      steps.push(step(`image-download:${index + 1}`, true, 200, {
        sourceUrl,
        contentType: downloaded.contentType,
        bytes: downloaded.bytes.length,
      }));
    } catch (error) {
      const message = errorMessage(error);
      steps.push(step(`image-download:${index + 1}`, false, 0, { sourceUrl, error: message }));
      failures.push(failureFromError(message, sourceUrl));
    }
  }
  const images: ShopeeMediaSpaceImage[] = [];
  let mergedBase = 0;
  for (const [batchIndex, batch] of chunks(files, shopeeMaxImagesPerRequest).entries()) {
    if (!batch.length) continue;
    const batchBase = mergedBase;
    mergedBase += batch.length;
    let remote: RemoteResponse;
    try {
      const request = buildShopeeMediaSpaceUploadRequest({
        payload: input.payload,
        environment: input.environment,
        images: batch,
        scene: input.scene,
      });
      remote = await readRemoteResponse(await fetchWithTimeout(fetchImpl, request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body as BodyInit | undefined,
        redirect: "error",
      }, 60_000));
    } catch (error) {
      const message = errorMessage(error);
      steps.push(step(`shopee-media-space-upload:${batchIndex + 1}`, false, 0, { error: message }));
      failures.push({ kind: "upload", retryable: true, message });
      continue;
    }
    const outcome = parseShopeeMediaSpaceUploadResult(remote, batch.length);
    steps.push(step(`shopee-media-space-upload:${batchIndex + 1}`, !outcome.failure, remote.response.status, {
      requestId: outcome.requestId,
      uploaded: outcome.images.filter((image) => image.ok).length,
      total: batch.length,
      error: outcome.failure?.message ?? "",
    }, outcome.requestId || undefined));
    if (outcome.failure) failures.push(outcome.failure);
    images.push(...outcome.images.map((image, imageIndex) => ({ ...image, index: batchBase + imageIndex })));
  }
  const ordered = sourceUrls.map((_, index) => images.find((image) => image.index === index));
  const imageIds = ordered.map((image) => image?.imageId ?? "");
  const imageUrls = ordered.map((image) => image?.imageUrl ?? "");
  const ok = failures.length === 0 && images.length === sourceUrls.length && images.every((image) => image.ok);
  return { ok, steps, failures, imageIds, imageUrls, sourceUrls };
}

async function runLazadaUpload(
  input: NativeImageUploadInput,
  fetchImpl: NativeFetch,
) {
  const sourceUrls = uniqueStrings(strings(input.argumentsValue.imageUrls));
  if (!sourceUrls.length) throw new Error("NATIVE_IMAGE_REQUIRED");
  if (sourceUrls.length > lazadaMaxMigrateUrls) throw new Error("NATIVE_IMAGE_COUNT_INVALID");
  const steps: NativeImageUploadStep[] = [];
  const failures: NativeImageUploadFailure[] = [];
  const nativeBySource = new Map<string, string>();
  for (const [index, sourceUrl] of sourceUrls.entries()) {
    try {
      assertMigrateImageUrl(sourceUrl);
    } catch (error) {
      const message = errorMessage(error);
      steps.push(step(`image-validate:${index + 1}`, false, 0, { sourceUrl, error: message }));
      failures.push({ kind: "validation", retryable: false, message, sourceUrl });
      continue;
    }
    let migrateFailure: NativeImageUploadFailure | null = null;
    try {
      const request = buildLazadaMigrateImageRequest({ payload: input.payload, url: sourceUrl });
      const remote = await readRemoteResponse(await fetchWithTimeout(fetchImpl, request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body as BodyInit | undefined,
        redirect: "error",
      }, 20_000));
      const outcome = parseLazadaImageResult(remote, sourceUrl);
      steps.push(step(`lazada-image-migrate:${index + 1}`, !outcome.failure, remote.response.status, {
        sourceUrl,
        imageUrl: outcome.imageUrl,
        requestId: outcome.requestId,
        error: outcome.failure?.message ?? "",
      }, outcome.requestId || undefined));
      if (outcome.failure) migrateFailure = outcome.failure;
      else nativeBySource.set(sourceUrl, outcome.imageUrl);
    } catch (error) {
      const message = errorMessage(error);
      steps.push(step(`lazada-image-migrate:${index + 1}`, false, 0, { sourceUrl, error: message }));
      migrateFailure = { kind: "upload", retryable: true, message, sourceUrl };
    }
    if (nativeBySource.has(sourceUrl)) continue;
    // Fallback: Lazada rejected the URL migration (or the call failed); pull
    // the normalized bytes and push them through UploadImage instead.
    let finalFailure: NativeImageUploadFailure | null = migrateFailure;
    try {
      const downloaded = await downloadNativeImageSource({ sourceUrl, fetchImpl, limits: lazadaImageLimits });
      steps.push(step(`image-download:${index + 1}`, true, 200, {
        sourceUrl,
        contentType: downloaded.contentType,
        bytes: downloaded.bytes.length,
      }));
      const request = buildLazadaUploadImageRequest({
        payload: input.payload,
        image: { name: filenameFromUrl(sourceUrl, downloaded.contentType), bytes: downloaded.bytes },
      });
      const remote = await readRemoteResponse(await fetchWithTimeout(fetchImpl, request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body as BodyInit | undefined,
        redirect: "error",
      }, 60_000));
      const outcome = parseLazadaImageResult(remote, sourceUrl);
      steps.push(step(`lazada-image-upload:${index + 1}`, !outcome.failure, remote.response.status, {
        sourceUrl,
        imageUrl: outcome.imageUrl,
        requestId: outcome.requestId,
        error: outcome.failure?.message ?? "",
      }, outcome.requestId || undefined));
      if (outcome.failure) finalFailure = outcome.failure;
      else nativeBySource.set(sourceUrl, outcome.imageUrl);
    } catch (error) {
      const message = errorMessage(error);
      steps.push(step(`image-download:${index + 1}`, false, 0, { sourceUrl, error: message }));
      finalFailure = failureFromError(message, sourceUrl);
    }
    if (finalFailure && !nativeBySource.has(sourceUrl)) failures.push(finalFailure);
  }
  const imageUrls = sourceUrls.map((sourceUrl) => nativeBySource.get(sourceUrl) ?? "");
  const ok = failures.length === 0 && nativeBySource.size === sourceUrls.length;
  return { ok, steps, failures, imageUrls, sourceUrls };
}

// ---------------------------------------------------------------------------
// Applying native references back into the prepared arguments clone.
// Never mutates the input record; unmatched references throw instead of
// silently succeeding.
// ---------------------------------------------------------------------------

function escapedAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function replaceDescriptionImageSources(description: unknown, nativeBySource: Map<string, string>) {
  const source = typeof description === "string" ? description : "";
  if (!source) return source;
  const unmapped: string[] = [];
  const next = source.replace(/<img\b[^>]*>/gi, (tag) => {
    return tag.replace(/\bsrc\s*=\s*"([^"]*)"/i, (attribute, rawUrl: string) => {
      const native = nativeBySource.get(rawUrl.trim());
      if (native) return `src="${escapedAttribute(native)}"`;
      if (/^https?:\/\//i.test(rawUrl.trim())) unmapped.push(rawUrl.trim());
      return attribute;
    });
  });
  if (unmapped.length) throw new Error(`NATIVE_IMAGE_APPLY_MAP_MISSING:${unmapped.length}`);
  return next;
}

export function applyNativeImagesToArguments(input: {
  channel: NativeImageUploadChannel;
  argumentsValue: Record<string, unknown>;
  sourceUrls: string[];
  imageUrls: string[];
  imageIds?: string[];
}): Record<string, unknown> {
  if (input.sourceUrls.length !== input.imageUrls.length || input.sourceUrls.some((source, index) => !source || !input.imageUrls[index])) {
    throw new Error("NATIVE_IMAGE_APPLY_MAP_MISSING");
  }
  const nativeBySource = new Map(input.sourceUrls.map((source, index) => [source, input.imageUrls[index]]));
  const next = structuredClone(input.argumentsValue);
  if (input.channel === "shopee") {
    const imageIds = (input.imageIds ?? []).map((value) => value.trim()).filter(Boolean);
    if (!imageIds.length || imageIds.length !== input.imageUrls.length) throw new Error("NATIVE_IMAGE_APPLY_MISSING_IMAGE_IDS");
    next.imageUrls = [...input.imageUrls];
    next.imageIds = [...imageIds];
    if (next.body === undefined) return next;
    const body = record(next.body);
    if (!body) throw new Error("NATIVE_IMAGE_APPLY_TARGET_MISSING");
    const image = record(body.image) ?? {};
    image.image_id_list = [...imageIds];
    body.image = image;
    return next;
  }
  if (next.request === undefined) {
    next.imageUrls = [...input.imageUrls];
    return next;
  }
  const request = record(next.request);
  const requestRoot = record(request?.Request);
  const product = record(requestRoot?.Product);
  if (!product) throw new Error("NATIVE_IMAGE_APPLY_TARGET_MISSING");
  const attributes = record(product.Attributes);
  const sourceListing = strings(record(product.Images)?.Image);
  const listingCount = sourceListing.length || Math.min(input.imageUrls.length, 8);
  const listingImages = input.imageUrls.slice(0, listingCount);
  if (listingImages.length !== listingCount || listingImages.some((url) => !url)) throw new Error("NATIVE_IMAGE_APPLY_MAP_MISSING");
  product.Images = { Image: [...listingImages] };
  if (attributes) {
    attributes.description = replaceDescriptionImageSources(attributes.description, nativeBySource);
  }
  const skus = record(product.Skus);
  const skuList = Array.isArray(skus?.Sku) ? skus.Sku : [];
  for (const skuValue of skuList) {
    const sku = record(skuValue);
    if (!sku) continue;
    const sourceSkuImages = strings(record(sku.Images)?.Image);
    if (!sourceSkuImages.length) continue;
    const nativeSkuImages = sourceSkuImages.map((source) => {
      const native = nativeBySource.get(source);
      if (!native) throw new Error("NATIVE_IMAGE_APPLY_MAP_MISSING");
      return native;
    });
    sku.Images = { Image: nativeSkuImages };
  }
  next.imageUrls = [...input.imageUrls];
  return next;
}

// Exposed for classification callers that need to inspect a single failure.
export function isNativeImageValidationFailure(failure: NativeImageUploadFailure) {
  return isValidationFailure(failure);
}
