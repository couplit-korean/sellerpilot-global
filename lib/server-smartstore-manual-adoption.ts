import { createHash } from "node:crypto";

import sharp from "sharp";
import { z } from "zod";

import { downloadMarketplaceImage } from "./channels/marketplace-images";
import {
  fetchNaverAccessToken,
  naverRequest,
  readStoredNaverAccessToken,
  type RemoteResponse,
  type SecretPayload,
} from "./channels/protocols";
import {
  smartstoreDetailImageCount,
  smartstoreReadbackImageProjection,
} from "./channels/smartstore-image-contract";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const remoteIdSchema = z.string().regex(/^[1-9]\d{5,19}$/u);
const maximumReadbackBytes = 2 * 1024 * 1024;
const maximumDecodedPixels = 16_000_000;
const minimumDecodedImageEdge = 600;

export const smartstoreManualAdoptionRequestSchema = z.object({
  confirmReadOnlyAdoption: z.literal(true),
}).strict();

const smartstoreManualAdoptionPreparationBase = z.object({
  contract: z.literal("smartstore_manual_adoption_prepare_v1"),
  productId: z.string().uuid(),
  sellerSku: z.string().trim().min(1).max(100),
  remoteCreationOriginAsserted: z.literal(false),
  apiCreateSucceeded: z.literal(false),
  providerMutationPerformed: z.literal(false),
  normalUpdateEligibilityScope: z.literal("database_linkage_only"),
  publicationGateOpenAsserted: z.literal(false),
}).strict();

const preparationReadySchema = smartstoreManualAdoptionPreparationBase.extend({
  status: z.literal("ready"),
  reason: z.null(),
  listingId: z.string().uuid(),
  sourceJobId: z.string().uuid(),
  sourceAttemptId: z.string().uuid(),
  credentialId: z.string().uuid(),
  originProductNo: z.null(),
  channelProductNo: z.null(),
  approvalRevision: z.number().int().positive(),
  contentSha256: digestSchema,
  manifestDigest: digestSchema,
  receiptId: z.null(),
  attestationId: z.null(),
  provenance: z.null(),
  contentVerified: z.literal(false),
  normalUpdateEligible: z.literal(false),
  reused: z.literal(false),
});

const preparationVerifiedSchema = smartstoreManualAdoptionPreparationBase.extend({
  status: z.literal("already_verified"),
  reason: z.null(),
  listingId: z.string().uuid(),
  sourceJobId: z.string().uuid(),
  sourceAttemptId: z.string().uuid(),
  credentialId: z.string().uuid(),
  originProductNo: remoteIdSchema,
  channelProductNo: remoteIdSchema,
  approvalRevision: z.number().int().positive(),
  contentSha256: digestSchema,
  manifestDigest: digestSchema,
  receiptId: z.string().uuid(),
  attestationId: z.string().uuid(),
  provenance: z.literal("manual_adoption_verified"),
  contentVerified: z.literal(true),
  normalUpdateEligible: z.literal(true),
  reused: z.literal(true),
});

const preparationBlockedSchema = smartstoreManualAdoptionPreparationBase.extend({
  status: z.literal("blocked"),
  reason: z.string().trim().min(1).max(240),
  listingId: z.string().uuid().nullable(),
  sourceJobId: z.string().uuid().nullable(),
  sourceAttemptId: z.string().uuid().nullable(),
  credentialId: z.string().uuid().nullable(),
  originProductNo: remoteIdSchema.nullable(),
  channelProductNo: remoteIdSchema.nullable(),
  approvalRevision: z.number().int().positive().nullable(),
  contentSha256: digestSchema.nullable(),
  manifestDigest: digestSchema.nullable(),
  receiptId: z.string().uuid().nullable(),
  attestationId: z.string().uuid().nullable(),
  provenance: z.literal("manual_adoption_verified").nullable(),
  contentVerified: z.boolean(),
  normalUpdateEligible: z.literal(false),
  reused: z.boolean(),
});

export const smartstoreManualAdoptionPreparationSchema = z.discriminatedUnion(
  "status",
  [preparationReadySchema, preparationVerifiedSchema, preparationBlockedSchema],
);

const smartstoreManualAdoptionCommitBase = z.object({
  contract: z.literal("smartstore_manual_adoption_verified_v1"),
  receiptId: z.string().uuid(),
  attestationId: z.string().uuid(),
  productId: z.string().uuid(),
  listingId: z.string().uuid(),
  sourceJobId: z.string().uuid(),
  sourceAttemptId: z.string().uuid(),
  credentialId: z.string().uuid(),
  originProductNo: remoteIdSchema,
  channelProductNo: remoteIdSchema,
  sellerSku: z.string().trim().min(1).max(100),
  normalUpdateEligible: z.literal(true),
  apiCreateSucceeded: z.literal(false),
  providerMutationPerformed: z.literal(false),
  contentVerified: z.literal(true),
  provenance: z.literal("manual_adoption_verified"),
  remoteCreationOriginAsserted: z.literal(false),
  normalUpdateEligibilityScope: z.literal("database_linkage_only"),
  publicationGateOpenAsserted: z.literal(false),
  sourcePreserved: z.literal(true),
}).strict();

export const smartstoreManualAdoptionCommitSchema = z.discriminatedUnion("status", [
  smartstoreManualAdoptionCommitBase.extend({
    status: z.literal("verified"),
    reused: z.literal(false),
  }),
  smartstoreManualAdoptionCommitBase.extend({
    status: z.literal("already_verified"),
    reused: z.literal(true),
  }),
]);

const smartstoreManualAdoptionReadbackStateBase = z.object({
  contract: z.literal("smartstore_manual_adoption_readback_enqueue_v1"),
  productId: z.string().uuid(),
  providerMutationPerformed: z.literal(false),
}).strict();

const emptyReadbackVerification = {
  receiptId: z.null(),
  attestationId: z.null(),
  originProductNo: z.null(),
  channelProductNo: z.null(),
  contentVerified: z.literal(false),
  normalUpdateEligible: z.literal(false),
} as const;

const pendingReadbackState = smartstoreManualAdoptionReadbackStateBase.extend({
  listingId: z.string().uuid(),
  jobId: z.string().uuid(),
  reused: z.boolean(),
  ...emptyReadbackVerification,
});

/**
 * Service-only queue/status projection. The browser never supplies any of
 * these identities; the database derives and binds them from the current
 * owner, approval, source CREATE, credential, and listing lineage.
 */
export const smartstoreManualAdoptionReadbackStateSchema = z.discriminatedUnion(
  "status",
  [
    pendingReadbackState.extend({
      status: z.literal("queued"),
      reason: z.literal("READBACK_QUEUED"),
    }),
    pendingReadbackState.extend({
      status: z.literal("running"),
      reason: z.literal("READBACK_RUNNING"),
    }),
    pendingReadbackState.extend({
      status: z.literal("reconciliation_required"),
      reason: z.literal("READBACK_RECONCILIATION_REQUIRED"),
    }),
    smartstoreManualAdoptionReadbackStateBase.extend({
      status: z.literal("verified"),
      reason: z.literal("ADOPTION_ALREADY_VERIFIED"),
      listingId: z.string().uuid(),
      jobId: z.string().uuid().nullable(),
      reused: z.boolean(),
      receiptId: z.string().uuid(),
      attestationId: z.string().uuid(),
      originProductNo: remoteIdSchema,
      channelProductNo: remoteIdSchema,
      contentVerified: z.literal(true),
      normalUpdateEligible: z.literal(true),
    }),
    smartstoreManualAdoptionReadbackStateBase.extend({
      status: z.literal("blocked"),
      reason: z.enum(["PREPARE_BLOCKED", "READBACK_FAILED", "NO_READBACK_JOB"]),
      listingId: z.string().uuid().nullable(),
      jobId: z.string().uuid().nullable(),
      reused: z.boolean(),
      ...emptyReadbackVerification,
    }),
  ],
);

export type SmartstoreManualAdoptionReadbackState = z.infer<
  typeof smartstoreManualAdoptionReadbackStateSchema
>;

export type SmartstoreManualAdoptionPreparation = z.infer<
  typeof smartstoreManualAdoptionPreparationSchema
>;

type SmartstoreProviderRequest = (input: {
  accessToken: string;
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}) => Promise<RemoteResponse>;

type DownloadedImage = {
  bytes: Buffer;
  contentType: string;
};

export type SmartstoreManualAdoptionReadbackDependencies = {
  accessToken: (credential: SecretPayload) => Promise<string>;
  downloadImage: (url: string, signal?: AbortSignal) => Promise<DownloadedImage>;
  now: () => Date;
  request: SmartstoreProviderRequest;
};

export type SmartstoreManualAdoptionReadback = {
  contract: "smartstore_official_manual_adoption_readback_v1";
  source: "smartstore_official_api_readback_v1";
  observedAt: string;
  providerMutationPerformed: false;
  searchReadback: {
    method: "POST";
    path: "/v1/products/search";
    httpStatus: 200;
    request: Record<string, unknown>;
    response: Record<string, unknown>;
  };
  originReadback: {
    method: "GET";
    path: string;
    httpStatus: 200;
    request: null;
    response: Record<string, unknown>;
  };
  channelReadback: {
    method: "GET";
    path: string;
    httpStatus: 200;
    request: null;
    response: Record<string, unknown>;
  };
  detailImageUrls: string[];
  detailImagePixelSha256s: string[];
};

const naverCredentialFailureCodes = [
  "NAVER_CREDENTIALS_MISSING",
  "NAVER_AUTH_FAILED",
  "NAVER_IP_NOT_ALLOWED",
  "NAVER_PROVIDER_UNAVAILABLE",
  "NAVER_TOKEN_EXCHANGE_FAILED",
] as const;

export type SmartstoreManualAdoptionCredentialCauseCode =
  | (typeof naverCredentialFailureCodes)[number]
  | "NAVER_TOKEN_EXCHANGE_NETWORK_FAILED"
  | "NAVER_TOKEN_EXCHANGE_POLICY_BLOCKED"
  | "NAVER_TOKEN_EXCHANGE_TIMEOUT"
  | "NAVER_TOKEN_EXCHANGE_UNKNOWN";

const naverCredentialFailureCodeSet = new Set<string>(naverCredentialFailureCodes);

/**
 * Converts only protocol-owned errors and standard transport failure classes
 * into administrator-safe codes. Provider response text, credential values,
 * stack traces, and arbitrary nested messages never cross this boundary.
 */
export function smartstoreManualAdoptionCredentialCauseCode(
  error: unknown,
): SmartstoreManualAdoptionCredentialCauseCode {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    const value = record(current);
    const message = typeof value.message === "string" ? value.message.trim() : "";
    if (naverCredentialFailureCodeSet.has(message)) {
      return message as (typeof naverCredentialFailureCodes)[number];
    }
    if (message === "LISTING_PUBLICATION_VERIFY_NON_READ_TRANSPORT_BLOCKED") {
      return "NAVER_TOKEN_EXCHANGE_POLICY_BLOCKED";
    }
    const name = typeof value.name === "string" ? value.name : "";
    if (name === "AbortError" || name === "TimeoutError") {
      return "NAVER_TOKEN_EXCHANGE_TIMEOUT";
    }
    if (name === "TypeError") {
      return "NAVER_TOKEN_EXCHANGE_NETWORK_FAILED";
    }
    if (!("cause" in value)) break;
    current = value.cause;
  }
  return "NAVER_TOKEN_EXCHANGE_UNKNOWN";
}

export class SmartstoreManualAdoptionError extends Error {
  readonly code: string;
  readonly causeCode: SmartstoreManualAdoptionCredentialCauseCode | null;

  constructor(
    code: string,
    cause?: unknown,
    causeCode: SmartstoreManualAdoptionCredentialCauseCode | null = null,
  ) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = "SmartstoreManualAdoptionError";
    this.code = code;
    this.causeCode = causeCode;
  }
}

const retryableCredentialCauseCodes = new Set<SmartstoreManualAdoptionCredentialCauseCode>([
  "NAVER_PROVIDER_UNAVAILABLE",
  "NAVER_TOKEN_EXCHANGE_NETWORK_FAILED",
  "NAVER_TOKEN_EXCHANGE_TIMEOUT",
]);

function hasRetryableReadTransportCause(error: SmartstoreManualAdoptionError) {
  let cause = error.cause;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!cause || typeof cause !== "object") return false;
    const value = cause as { name?: unknown; message?: unknown; cause?: unknown };
    const name = typeof value.name === "string" ? value.name : "";
    const message = typeof value.message === "string" ? value.message : "";
    if (name === "TimeoutError"
        || /fetch failed|ETIMEDOUT|ECONNRESET|EAI_AGAIN|UND_ERR_|network/i.test(message)) {
      return true;
    }
    cause = value.cause;
  }
  return false;
}

/** Only read-only transport failures may reuse the same bounded gateway job. */
export function isRetryableSmartstoreManualAdoptionReadbackError(error: unknown) {
  return error instanceof SmartstoreManualAdoptionError
    && (error.code === "SMARTSTORE_MANUAL_PROVIDER_TRANSIENT"
      || (error.code === "SMARTSTORE_MANUAL_DETAIL_IMAGE_DOWNLOAD_FAILED"
        && hasRetryableReadTransportCause(error))
      || (error.code === "SMARTSTORE_MANUAL_CREDENTIAL_UNAVAILABLE"
        && error.causeCode !== null
        && retryableCredentialCauseCodes.has(error.causeCode)));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function exactRemoteId(value: unknown) {
  const parsed = remoteIdSchema.safeParse(String(value ?? "").trim());
  return parsed.success ? parsed.data : "";
}

function allRemoteIdsIfPresentMatch(values: unknown[], expected: string) {
  const present = values.filter((value) => value !== null && value !== undefined && value !== "");
  return present.every((value) => exactRemoteId(value) === expected);
}

function sellerCodeFromOriginProduct(value: unknown) {
  const originProduct = record(value);
  const detailAttribute = record(originProduct.detailAttribute);
  return String(record(detailAttribute.sellerCodeInfo).sellerManagementCode ?? "").trim();
}

function sellerCodeFromChannelProduct(value: unknown) {
  return String(record(value).sellerManagementCode ?? "").trim();
}

function criticalOriginProductEvidence(value: unknown) {
  const originProduct = record(value);
  const images = record(originProduct.images);
  const optionalImages = Array.isArray(images.optionalImages)
    ? images.optionalImages.map((image) => record(image).url)
    : images.optionalImages;
  return JSON.stringify({
    name: originProduct.name,
    salePrice: originProduct.salePrice,
    stockQuantity: originProduct.stockQuantity,
    detailContent: originProduct.detailContent,
    representativeImageUrl: record(images.representativeImage).url,
    optionalImageUrls: optionalImages,
  });
}

function accepted(remote: RemoteResponse) {
  const code = String(remote.data.code ?? "").trim().toUpperCase();
  return remote.response.status === 200 && !code;
}

function assertProviderResponseNotTransient(remote: RemoteResponse) {
  if (remote.response.status === 429 || remote.response.status >= 500) {
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_PROVIDER_TRANSIENT");
  }
}

function completeFirstSearchPage(
  data: Record<string, unknown>,
  contents: unknown[],
  expectedSize: number,
) {
  const { page, size, totalElements, totalPages } = data;
  return typeof page === "number"
    && Number.isSafeInteger(page)
    && page === 1
    && typeof size === "number"
    && Number.isSafeInteger(size)
    && size === expectedSize
    && typeof totalElements === "number"
    && Number.isSafeInteger(totalElements)
    && totalElements >= 0
    && totalElements === contents.length
    && typeof totalPages === "number"
    && Number.isSafeInteger(totalPages)
    && totalPages === (contents.length === 0 ? 0 : 1)
    && data.first === true
    && data.last === true;
}

function boundedJson(value: unknown) {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch (cause) {
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_READBACK_JSON_INVALID", cause);
  }
  if (!encoded || Buffer.byteLength(encoded, "utf8") > maximumReadbackBytes) {
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_READBACK_TOO_LARGE");
  }
  return value as Record<string, unknown>;
}

async function defaultAccessToken(credential: SecretPayload) {
  const stored = readStoredNaverAccessToken(credential);
  if (stored) return stored;
  return (await fetchNaverAccessToken(credential)).accessToken;
}

const defaultDependencies: SmartstoreManualAdoptionReadbackDependencies = {
  accessToken: defaultAccessToken,
  downloadImage: downloadMarketplaceImage,
  now: () => new Date(),
  request: naverRequest,
};

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  task: (value: T, index: number) => Promise<R>,
) {
  const output = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        output[index] = await task(values[index]!, index);
      }
    },
  );
  await Promise.all(workers);
  return output;
}

async function inspectProviderImage(
  url: string,
  index: number,
  dependencies: SmartstoreManualAdoptionReadbackDependencies,
  signal?: AbortSignal,
) {
  let downloaded: DownloadedImage;
  try {
    downloaded = await dependencies.downloadImage(url, signal);
  } catch (cause) {
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_DETAIL_IMAGE_DOWNLOAD_FAILED", cause);
  }
  try {
    const decoded = await sharp(downloaded.bytes, {
      failOn: "warning",
      limitInputPixels: maximumDecodedPixels,
    }).rotate().toColourspace("srgb").ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = decoded.info;
    if (channels !== 4
        || width < minimumDecodedImageEdge
        || height < minimumDecodedImageEdge
        || width * height > maximumDecodedPixels) {
      throw new Error("SMARTSTORE_MANUAL_DETAIL_IMAGE_DIMENSIONS_INVALID");
    }
    return {
      index,
      url,
      contentType: downloaded.contentType,
      byteLength: downloaded.bytes.byteLength,
      width,
      height,
      decodedRgbaSha256: createHash("sha256")
        .update(Buffer.concat([
          Buffer.from(`${width}x${height}:RGBA\n`, "utf8"),
          decoded.data,
        ]))
        .digest("hex"),
    };
  } catch (cause) {
    if (cause instanceof SmartstoreManualAdoptionError) throw cause;
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_DETAIL_IMAGE_INVALID", cause);
  }
}

/**
 * Reads the exact manually-created SmartStore product from official Commerce
 * APIs and verifies provider-hosted image bytes. The caller may persist this
 * value only through the atomic adoption RPC; none of it is accepted from a
 * browser request and this function performs no listing mutation.
 */
export async function collectSmartstoreManualAdoptionReadback(
  input: {
    credential: SecretPayload;
    target: Pick<SmartstoreManualAdoptionPreparation,
      "sellerSku">;
    signal?: AbortSignal;
  },
  dependencyOverrides: Partial<SmartstoreManualAdoptionReadbackDependencies> = {},
): Promise<SmartstoreManualAdoptionReadback> {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const sellerSku = input.target.sellerSku.trim();
  if (!sellerSku || sellerSku.length > 100) {
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_SELLER_SKU_INVALID");
  }

  let accessToken: string;
  try {
    accessToken = await dependencies.accessToken(input.credential);
  } catch (cause) {
    throw new SmartstoreManualAdoptionError(
      "SMARTSTORE_MANUAL_CREDENTIAL_UNAVAILABLE",
      cause,
      smartstoreManualAdoptionCredentialCauseCode(cause),
    );
  }
  if (!accessToken) {
    throw new SmartstoreManualAdoptionError(
      "SMARTSTORE_MANUAL_CREDENTIAL_UNAVAILABLE",
      undefined,
      "NAVER_TOKEN_EXCHANGE_FAILED",
    );
  }

  const request = (requestInput: Omit<Parameters<SmartstoreProviderRequest>[0], "accessToken">) => (
    dependencies.request({ ...requestInput, accessToken })
  );
  const searchRequest = {
    searchKeywordType: "SELLER_CODE",
    sellerManagementCode: sellerSku,
    page: 1,
    size: 50,
    orderType: "NO",
  };
  const search = await request({
    method: "POST",
    path: "/v1/products/search",
    body: searchRequest,
  });
  assertProviderResponseNotTransient(search);
  if (!accepted(search)
      || !Array.isArray(search.data.contents)
      || !completeFirstSearchPage(search.data, search.data.contents, searchRequest.size)) {
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_SEARCH_UNVERIFIED");
  }
  const matchingSearchRows = search.data.contents.flatMap((value) => {
    const row = record(value);
    const originProductNo = exactRemoteId(row.originProductNo);
    if (!originProductNo || !Array.isArray(row.channelProducts)) return [];
    return row.channelProducts.flatMap((candidate) => {
      const channelProduct = record(candidate);
      const channelProductNo = exactRemoteId(channelProduct.channelProductNo);
      return channelProductNo
        && allRemoteIdsIfPresentMatch(
          [channelProduct.smartstoreChannelProductNo],
          channelProductNo,
        )
        && allRemoteIdsIfPresentMatch(
          [channelProduct.originProductNo],
          originProductNo,
        )
        && sellerCodeFromChannelProduct(channelProduct) === sellerSku
        ? [{ originProductNo, channelProductNo }]
        : [];
    });
  });
  if (matchingSearchRows.length !== 1) {
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_SEARCH_IDENTITY_MISMATCH");
  }
  const { originProductNo, channelProductNo } = matchingSearchRows[0]!;

  const [origin, channel] = await Promise.all([
    request({ method: "GET", path: `/v2/products/origin-products/${originProductNo}` }),
    request({ method: "GET", path: `/v2/products/channel-products/${channelProductNo}` }),
  ]);
  assertProviderResponseNotTransient(origin);
  assertProviderResponseNotTransient(channel);
  const originProduct = record(origin.data.originProduct);
  const embeddedChannelProduct = record(origin.data.smartstoreChannelProduct);
  const channelOriginProduct = record(channel.data.originProduct);
  const channelProduct = record(channel.data.smartstoreChannelProduct);
  const originStatus = String(originProduct.statusType ?? "").trim().toUpperCase();
  const channelOriginStatus = String(
    channelOriginProduct.statusType ?? "",
  ).trim().toUpperCase();
  const channelStatus = String(
    channelProduct.channelProductDisplayStatusType
      ?? channelProduct.displayStatusType
      ?? "",
  ).trim().toUpperCase();
  if (origin.response.status !== 200) {
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_ORIGIN_HTTP_STATUS_INVALID");
  }
  if (String(origin.data.code ?? "").trim()) {
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_ORIGIN_PROVIDER_REJECTED");
  }
  if (channel.response.status !== 200) {
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_CHANNEL_HTTP_STATUS_INVALID");
  }
  if (String(channel.data.code ?? "").trim()) {
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_CHANNEL_PROVIDER_REJECTED");
  }
  if (!Object.keys(originProduct).length) {
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_ORIGIN_PAYLOAD_INVALID");
  }
  if (!Object.keys(channelProduct).length) {
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_CHANNEL_PAYLOAD_INVALID");
  }
  if (!Object.keys(channelOriginProduct).length) {
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_CHANNEL_ORIGIN_PAYLOAD_INVALID");
  }

  // The current official v2 GET response schemas do not require product-number
  // fields in the response body. Search establishes the unique number pair and
  // each GET path binds one member of that pair. If an implementation returns
  // redundant identity fields, every supplied value must still match.
  if (!allRemoteIdsIfPresentMatch(
    [
      origin.data.originProductNo,
      originProduct.originProductNo,
      embeddedChannelProduct.originProductNo,
    ],
    originProductNo,
  ) || !allRemoteIdsIfPresentMatch(
    [
      origin.data.smartstoreChannelProductNo,
      origin.data.channelProductNo,
      embeddedChannelProduct.channelProductNo,
      embeddedChannelProduct.smartstoreChannelProductNo,
    ],
    channelProductNo,
  )) {
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_ORIGIN_IDENTITY_MISMATCH");
  }
  if (!allRemoteIdsIfPresentMatch(
    [
      channel.data.smartstoreChannelProductNo,
      channel.data.channelProductNo,
      channelProduct.channelProductNo,
      channelProduct.smartstoreChannelProductNo,
    ],
    channelProductNo,
  ) || !allRemoteIdsIfPresentMatch(
    [
      channel.data.originProductNo,
      channelOriginProduct.originProductNo,
      channelProduct.originProductNo,
    ],
    originProductNo,
  )) {
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_CHANNEL_IDENTITY_MISMATCH");
  }
  if (sellerCodeFromOriginProduct(originProduct) !== sellerSku) {
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_ORIGIN_SELLER_SKU_MISMATCH");
  }
  if (sellerCodeFromOriginProduct(channelOriginProduct) !== sellerSku) {
    throw new SmartstoreManualAdoptionError(
      "SMARTSTORE_MANUAL_CHANNEL_ORIGIN_SELLER_SKU_MISMATCH",
    );
  }
  const channelSellerSku = sellerCodeFromChannelProduct(channelProduct);
  if (channelSellerSku && channelSellerSku !== sellerSku) {
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_CHANNEL_SELLER_SKU_MISMATCH");
  }
  if (originStatus !== "SALE") {
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_ORIGIN_STATUS_MISMATCH");
  }
  if (channelOriginStatus !== "SALE") {
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_CHANNEL_ORIGIN_STATUS_MISMATCH");
  }
  if (criticalOriginProductEvidence(channelOriginProduct)
      !== criticalOriginProductEvidence(originProduct)) {
    throw new SmartstoreManualAdoptionError(
      "SMARTSTORE_MANUAL_CHANNEL_ORIGIN_PRODUCT_MISMATCH",
    );
  }
  if (channelStatus !== "ON") {
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_CHANNEL_STATUS_MISMATCH");
  }

  const images = smartstoreReadbackImageProjection(originProduct);
  if (!images.verified
      || images.detailImageUrls.length !== smartstoreDetailImageCount
      || new Set(images.detailImageUrls).size !== smartstoreDetailImageCount) {
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_DETAIL_IMAGES_UNVERIFIED");
  }
  const inspectedDetailImages = await mapWithConcurrency(
    images.detailImageUrls,
    3,
    (url, index) => inspectProviderImage(url, index, dependencies, input.signal),
  );
  if (new Set(inspectedDetailImages.map((image) => image.decodedRgbaSha256)).size
      !== smartstoreDetailImageCount) {
    throw new SmartstoreManualAdoptionError("SMARTSTORE_MANUAL_DETAIL_IMAGES_NOT_DISTINCT");
  }

  const readback = {
    contract: "smartstore_official_manual_adoption_readback_v1" as const,
    source: "smartstore_official_api_readback_v1" as const,
    observedAt: dependencies.now().toISOString(),
    providerMutationPerformed: false as const,
    searchReadback: {
      method: "POST" as const,
      path: "/v1/products/search" as const,
      httpStatus: 200 as const,
      request: searchRequest,
      response: boundedJson(search.data),
    },
    originReadback: {
      method: "GET" as const,
      path: `/v2/products/origin-products/${originProductNo}`,
      httpStatus: 200 as const,
      request: null,
      response: boundedJson(origin.data),
    },
    channelReadback: {
      method: "GET" as const,
      path: `/v2/products/channel-products/${channelProductNo}`,
      httpStatus: 200 as const,
      request: null,
      response: boundedJson(channel.data),
    },
    detailImageUrls: [...images.detailImageUrls],
    detailImagePixelSha256s: inspectedDetailImages.map(
      (image) => image.decodedRgbaSha256,
    ),
  };
  boundedJson(readback);
  return readback;
}
