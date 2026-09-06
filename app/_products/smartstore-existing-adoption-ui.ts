const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type ListingLike = {
  channel?: unknown;
  status?: unknown;
  remoteId?: unknown;
  lastError?: unknown;
};

type ActivityLike = {
  id?: unknown;
  productId?: unknown;
  status?: unknown;
  channels?: unknown;
};

export type SmartstoreExistingAdoptionState = "none" | "review_required" | "verified";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function requiresExistingAdoptionReview(status: unknown) {
  return ["blocked", "failed", "manual_required", "reconciliation_required"]
    .includes(text(status).toLowerCase());
}

/**
 * Keeps an uncertain Smartstore create lineage out of the normal retry path.
 * Only the server can turn review_required into verified after an official
 * readback; a remote ID by itself is not proof of a safe ledger binding.
 */
export function smartstoreExistingAdoptionState(
  references: readonly ListingLike[],
): SmartstoreExistingAdoptionState {
  const smartstore = references.filter((listing) => text(listing.channel).toLowerCase() === "smartstore");
  if (smartstore.some((listing) => text(listing.status).toLowerCase() === "published" && Boolean(text(listing.remoteId)))) {
    return "verified";
  }
  return smartstore.some((listing) => requiresExistingAdoptionReview(listing.status))
    ? "review_required"
    : "none";
}

export function isSmartstoreExistingAdoptionActivity(activity: ActivityLike) {
  if (!text(activity.id).startsWith("product:")
      || !uuidPattern.test(text(activity.productId))
      || !["blocked", "failed"].includes(text(activity.status))) return false;
  if (!Array.isArray(activity.channels)) return false;
  return activity.channels.some((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const channel = entry as ListingLike;
    return text(channel.channel).toLowerCase() === "smartstore"
      && requiresExistingAdoptionReview(channel.status);
  });
}

export type VerifiedSmartstoreExistingAdoption = {
  receiptId: string;
  attestationId: string;
  productId: string;
  listingId: string;
  originProductNo: string;
  channelProductNo: string;
  message: string;
};

export type PendingSmartstoreExistingAdoption = {
  status: "queued" | "running";
  productId: string;
  listingId: string;
  jobId: string;
  reused: boolean;
  message: string;
};

/**
 * A queued readback is still working. Keep its exact product, listing, and job
 * identities while polling so an unrelated 202 response cannot be adopted.
 */
export function parsePendingSmartstoreExistingAdoption(
  value: unknown,
  expectedProductId: string,
): PendingSmartstoreExistingAdoption | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  const productId = text(result.productId);
  const listingId = text(result.listingId);
  const jobId = text(result.jobId);
  if (result.ok !== true
      || (result.status !== "queued" && result.status !== "running")
      || result.apiCreateSucceeded !== false
      || result.providerMutationPerformed !== false
      || result.contentVerified !== false
      || result.normalUpdateEligible !== false
      || typeof result.reused !== "boolean"
      || !uuidPattern.test(expectedProductId)
      || productId !== expectedProductId
      || !uuidPattern.test(listingId)
      || !uuidPattern.test(jobId)) return null;
  return {
    status: result.status,
    productId,
    listingId,
    jobId,
    reused: result.reused,
    message: text(result.message) || (result.status === "running"
      ? "로컬 채널 작업기가 스마트스토어 기존 상품을 공식 조회하고 있습니다."
      : "스마트스토어 기존 상품 공식 조회 작업을 로컬 채널 작업기에 등록했습니다."),
  };
}

/**
 * A 2xx response is not enough. The UI only reports a verified existing
 * binding when the response explicitly proves no provider mutation or create.
 */
export function parseVerifiedSmartstoreExistingAdoption(
  value: unknown,
  expectedProductId: string,
): VerifiedSmartstoreExistingAdoption | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  const receiptId = text(result.receiptId);
  const attestationId = text(result.attestationId);
  const productId = text(result.productId);
  const listingId = text(result.listingId);
  const originProductNo = text(result.originProductNo);
  const channelProductNo = text(result.channelProductNo);
  if (result.ok !== true
      || result.status !== "verified"
      || result.apiCreateSucceeded !== false
      || result.providerMutationPerformed !== false
      || result.contentVerified !== true
      || result.normalUpdateEligible !== true
      || !uuidPattern.test(expectedProductId)
      || productId !== expectedProductId
      || ![receiptId, attestationId, listingId].every((identifier) => uuidPattern.test(identifier))
      || !/^\d+$/u.test(originProductNo)
      || !/^\d+$/u.test(channelProductNo)) return null;
  return {
    receiptId,
    attestationId,
    productId,
    listingId,
    originProductNo,
    channelProductNo,
    message: text(result.message) || "기존 상품 연결 확인 완료",
  };
}

export function smartstoreExistingAdoptionErrorMessage(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "기존 스마트스토어 상품의 공식 조회 결과를 확인하지 못했습니다.";
  }
  const message = text((value as Record<string, unknown>).message);
  return message.length > 0 && message.length <= 500
    ? message
    : "기존 스마트스토어 상품의 공식 조회 결과를 확인하지 못했습니다.";
}
