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
  requestedPublicationIntent?: "safe_test" | "live" | null;
  remoteVisibility?: "unknown" | "non_public" | "pending_review" | "live" | "withdrawn" | "rejected" | null;
  operationAttemptId?: string | null;
};

export type WorkbenchChannelResult = {
  phase: "idle" | "queued" | "running" | "pending_review" | "succeeded" | "failed" | "blocked";
  operation?: "listing.create" | "listing.update" | "listing.stop" | "listing.activate";
  message?: string;
  remoteId?: string;
  attemptId?: string;
  listingId?: string;
  market?: string;
  targetId?: string;
  mutationGeneration?: string;
};

export type WorkbenchPublicationResponse = {
  ok?: boolean;
  publicationPending?: boolean;
  publicationFulfilled?: boolean;
};

export function isPublicationPendingReviewResponse(
  status: number,
  payload: WorkbenchPublicationResponse,
) {
  return status === 202
    && payload.ok === true
    && (payload.publicationPending === true || payload.publicationFulfilled === false);
}

export type WorkbenchChannelWriteSettlement<T> =
  | { channel: ActiveChannelKey; status: "fulfilled"; value: T }
  | { channel: ActiveChannelKey; status: "rejected"; reason: unknown };

export async function executeChannelWritesIndependently<T>(
  channels: readonly ActiveChannelKey[],
  execute: (channel: ActiveChannelKey) => Promise<T>,
): Promise<WorkbenchChannelWriteSettlement<T>[]> {
  const settled = await Promise.allSettled(channels.map((channel) => (
    Promise.resolve().then(() => execute(channel))
  )));
  return settled.map((result, index) => result.status === "fulfilled"
    ? { channel: channels[index]!, status: result.status, value: result.value }
    : { channel: channels[index]!, status: result.status, reason: result.reason });
}

/**
 * The multi-channel QA flow contains Temu immediately after create and proves
 * the off-shelf readback. A single-channel confirmation remains the explicit
 * path for an operator-approved live Temu create.
 */
export function bulkChannelPublicationIntent(channel: ActiveChannelKey) {
  return channel === "temu" ? "safe_test" as const : "live" as const;
}

export type BulkPublicationOutcome = "live" | "safe_test_contained" | false;

export function summarizeBulkPublicationOutcomes(
  outcomes: readonly BulkPublicationOutcome[],
) {
  const live = outcomes.filter((outcome) => outcome === "live").length;
  const safeTestContained = outcomes.filter(
    (outcome) => outcome === "safe_test_contained",
  ).length;
  return {
    live,
    safeTestContained,
    attentionRequired: outcomes.length - live - safeTestContained,
  };
}

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
    if (operation !== "listing.stop"
        && listing.requestedPublicationIntent === "live"
        && listing.remoteVisibility === "pending_review") {
      next[channel] = {
        ...boundResult,
        phase: "pending_review",
        message: "판매채널 접수는 완료됐지만 아직 심사 중이며 공개 게시 성공에는 포함되지 않습니다.",
        remoteId: listing.remoteId ?? result.remoteId,
      };
      continue;
    }

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
