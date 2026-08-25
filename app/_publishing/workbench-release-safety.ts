import type { ActiveChannelKey } from "../../lib/channels/catalog";
import type { ProductEditFieldState } from "../../lib/channels/listing-update";

export type WorkbenchListingSnapshot = {
  id: string;
  channel: ActiveChannelKey;
  market: string;
  targetId: string;
  remoteId: string | null;
  status: string;
  lastError: string | null;
  failureClass?: "retryable" | "external_action" | null;
  operationAttemptId?: string | null;
};

export type WorkbenchChannelResult = {
  phase: "idle" | "queued" | "running" | "succeeded" | "failed" | "blocked";
  operation?: "listing.create" | "listing.update" | "listing.stop";
  message?: string;
  remoteId?: string;
  attemptId?: string;
  listingId?: string;
  market?: string;
  targetId?: string;
  mutationGeneration?: string;
};

export function workbenchProductContextMatches(
  productId: string | null,
  contextProductId: string | null | undefined,
) {
  return Boolean(productId && contextProductId === productId);
}

export type WorkbenchTargetIdentity = {
  targetId: string;
  marketCode: string;
};

export function channelTargetOptionValue(target: WorkbenchTargetIdentity) {
  return JSON.stringify([target.marketCode, target.targetId]);
}

export function listingMutationGeneration(
  listing: WorkbenchListingSnapshot | undefined,
  previousGeneration?: string,
) {
  if (listing?.status === "failed"
      && listing.failureClass === "retryable"
      && listing.operationAttemptId) {
    return `retryable:${listing.operationAttemptId}`;
  }
  return previousGeneration ?? (listing?.id ? `listing:${listing.id}` : "initial");
}

export function productEditSupportLabel(
  remoteState: ProductEditFieldState,
  centralState: ProductEditFieldState,
) {
  if (remoteState === "supported") return "원격 수정";
  if (remoteState === "partial") return "원격 일부";
  return centralState === "blocked" ? "미지원" : "중앙만";
}

function exactAttemptListings(
  listings: WorkbenchListingSnapshot[],
  channel: ActiveChannelKey,
  result: WorkbenchChannelResult,
) {
  if (!result.attemptId) return [];
  return listings.filter((listing) => listing.channel === channel
    && listing.market === (result.market ?? "")
    && listing.targetId === (result.targetId ?? "")
    && listing.operationAttemptId === result.attemptId);
}

export function reconcileQueuedChannelResults(
  current: Partial<Record<ActiveChannelKey, WorkbenchChannelResult>>,
  listings: WorkbenchListingSnapshot[],
) {
  let changed = false;
  const next = { ...current };

  for (const [channelValue, result] of Object.entries(current)) {
    if (result?.phase !== "queued" || !result.attemptId) continue;
    const channel = channelValue as ActiveChannelKey;
    const candidates = exactAttemptListings(listings, channel, result);
    const listing = result.listingId
      ? candidates.find((candidate) => candidate.id === result.listingId)
      : candidates.length === 1
        ? candidates[0]
        : undefined;
    if (!listing) continue;

    const boundResult = result.listingId === listing.id
      ? result
      : { ...result, listingId: listing.id };
    if (boundResult !== result) changed = true;

    const operation = result.operation ?? "listing.create";
    if (["queued", "publishing"].includes(listing.status)
        || (operation === "listing.stop" && listing.status === "published")) {
      next[channel] = boundResult;
      continue;
    }

    changed = true;
    const succeeded = operation === "listing.stop"
      ? listing.status === "paused"
      : listing.status === "published";
    if (succeeded) {
      next[channel] = {
        ...boundResult,
        phase: "succeeded",
        message: "판매채널 작업이 완료되어 상품 원장에 반영됐습니다.",
        remoteId: listing.remoteId ?? result.remoteId,
      };
    } else if (listing.failureClass === "external_action") {
      next[channel] = {
        ...boundResult,
        phase: "blocked",
        message: listing.lastError ?? "원격 판매자센터 상태를 수동 확인해야 합니다.",
      };
    } else {
      next[channel] = {
        ...boundResult,
        phase: "failed",
        message: listing.lastError ?? "판매채널 작업이 완료되지 않았습니다.",
      };
    }
  }

  return changed ? next : current;
}
