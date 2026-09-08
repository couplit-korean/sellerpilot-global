import { createHash } from "node:crypto";
import type {
  ShopeeReturnHistoryScope,
  ShopeeReviewHistoryScope,
} from "./history-plan";

type ShopeeHistoryScope = ShopeeReviewHistoryScope | ShopeeReturnHistoryScope;
type ShopeeHistoryKind = ShopeeHistoryScope["kind"];
type ShopeeHistoryStatus = "pending" | "partial" | "complete" | "failed" | "authorization_required";

const digestPattern = /^[a-f0-9]{64}$/u;

export type ShopeeReviewCheckpoint = {
  kind: "product_review";
  checkpointDigest: string;
  cursorDigest: string;
  paginationEpoch: number;
  paginationDepth: number;
};

export type ShopeeReturnCheckpoint = {
  kind: "return_refund";
  checkpointDigest: string;
  pageNo: number;
  pendingDetailCount: number;
  nextListPageNo: number | null;
  paginationEpoch: number;
  paginationDepth: number;
};

export type ShopeeHistoryCheckpoint = ShopeeReviewCheckpoint | ShopeeReturnCheckpoint;

type ShopeeHistoryEventBase = {
  eventKey: string;
  sequence: number;
  scopeKey: string;
  shopId: string;
  kind: ShopeeHistoryKind;
};

export type ShopeeHistoryPageEvent = ShopeeHistoryEventBase & {
  type: "page";
  inputCheckpointDigest: string | null;
  pageDigest: string;
  remoteRecordDigests: string[];
  normalizedRecordDigests: string[];
  isolatedRecordDigests: string[];
  excludedRecordDigests: string[];
  projectedEventDigests: string[];
  nextCheckpoint: ShopeeHistoryCheckpoint | null;
};

export type ShopeeHistoryInterruptionEvent = ShopeeHistoryEventBase & {
  type: "interruption";
  checkpointDigest: string | null;
  reason: "failed" | "authorization_required";
  errorCode: string;
};

export type ShopeeHistoryEvent = ShopeeHistoryPageEvent | ShopeeHistoryInterruptionEvent;

export type ShopeeHistoryScopeProgress = {
  scopeKey: string;
  shopId: string;
  country: string;
  kind: ShopeeHistoryKind;
  status: ShopeeHistoryStatus;
  coverage: ShopeeHistoryScope["coverage"];
  pageCount: number;
  remoteUniqueCount: number;
  normalizedUniqueCount: number;
  projectedEventUniqueCount: number;
  duplicateRemoteCount: number;
  isolatedUniqueCount: number;
  excludedUniqueCount: number;
  unprocessedUniqueCount: number;
  replayedEventCount: number;
  activeCheckpoint: ShopeeHistoryCheckpoint | null;
  lastErrorCode: string | null;
  range: { from: number; to: number } | null;
};

export type ShopeeHistoryShopKindProgress = {
  shopId: string;
  country: string;
  kind: ShopeeHistoryKind;
  status: ShopeeHistoryStatus;
  plannedScopeCount: number;
  completedScopeCount: number;
  failedScopeCount: number;
  authorizationRequiredScopeCount: number;
  remainingScopeKeys: string[];
  activeCheckpointDigests: string[];
  knownPendingDetailCount: number;
  providerRemainderUnknown: boolean;
  remoteUniqueCount: number;
  normalizedUniqueCount: number;
  projectedEventUniqueCount: number;
  duplicateRemoteCount: number;
  isolatedUniqueCount: number;
  excludedUniqueCount: number;
  unprocessedUniqueCount: number;
  replayedEventCount: number;
};

export type ShopeeHistoryProgress = {
  contract: "sellerpilot-shopee-history-progress/1";
  scopes: ShopeeHistoryScopeProgress[];
  shopKinds: ShopeeHistoryShopKindProgress[];
};

type InternalScopeProgress = ShopeeHistoryScopeProgress & {
  remoteDigests: Set<string>;
  normalizedDigests: Set<string>;
  isolatedDigests: Set<string>;
  excludedDigests: Set<string>;
  projectedEventDigests: Set<string>;
  remoteOccurrenceCount: number;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function shopeeHistoryRecordDigest(shopId: string, kind: ShopeeHistoryKind, remoteId: string) {
  const remoteIdentityValid = kind === "product_review"
    ? /^[1-9]\d{0,18}$/u.test(remoteId)
    : /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(remoteId);
  if (!/^[1-9]\d{0,31}$/u.test(shopId)
      || !["product_review", "return_refund"].includes(kind)
      || !remoteIdentityValid) {
    throw new Error("SHOPEE_HISTORY_RECORD_IDENTITY_INVALID");
  }
  return sha256(["shopee-history-record-v1", shopId, kind, remoteId].join("\u001f"));
}

function integer(value: unknown, minimum: number, maximum: number, code: string) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(code);
  }
  return Number(value);
}

function digest(value: unknown, code: string) {
  if (typeof value !== "string" || !digestPattern.test(value)) throw new Error(code);
  return value;
}

function digestList(value: unknown, code: string) {
  if (!Array.isArray(value) || value.length > 5_000) throw new Error(code);
  const result = value.map((item) => digest(item, code));
  if (new Set(result).size !== result.length) throw new Error(code);
  return result;
}

function validateCheckpoint(checkpoint: ShopeeHistoryCheckpoint, kind: ShopeeHistoryKind) {
  if (!checkpoint || checkpoint.kind !== kind) throw new Error("SHOPEE_HISTORY_CHECKPOINT_INVALID");
  digest(checkpoint.checkpointDigest, "SHOPEE_HISTORY_CHECKPOINT_INVALID");
  integer(checkpoint.paginationEpoch, 0, Number.MAX_SAFE_INTEGER, "SHOPEE_HISTORY_CHECKPOINT_INVALID");
  integer(checkpoint.paginationDepth, 1, 50, "SHOPEE_HISTORY_CHECKPOINT_INVALID");
  if (checkpoint.kind === "product_review") {
    digest(checkpoint.cursorDigest, "SHOPEE_HISTORY_CHECKPOINT_INVALID");
    return;
  }
  integer(checkpoint.pageNo, 1, 1_000_000, "SHOPEE_HISTORY_CHECKPOINT_INVALID");
  integer(checkpoint.pendingDetailCount, 0, 100, "SHOPEE_HISTORY_CHECKPOINT_INVALID");
  if (checkpoint.nextListPageNo !== null) {
    integer(checkpoint.nextListPageNo, 2, 1_000_001, "SHOPEE_HISTORY_CHECKPOINT_INVALID");
  }
  if (checkpoint.pendingDetailCount === 0 && checkpoint.nextListPageNo === null) {
    throw new Error("SHOPEE_HISTORY_CHECKPOINT_INVALID");
  }
}

function validateScope(scope: ShopeeHistoryScope) {
  const expected = scope.kind === "product_review"
    ? `shopee:${scope.shopId}:product_review:cursor-corpus`
    : `shopee:${scope.shopId}:return_refund:${scope.arguments.createTimeFrom}-${scope.arguments.createTimeTo}`;
  if (scope.scopeKey !== expected || scope.arguments.shopId !== scope.shopId) {
    throw new Error("SHOPEE_HISTORY_SCOPE_INVALID");
  }
}

function validateEventIdentity(event: ShopeeHistoryEvent, scope: ShopeeHistoryScope) {
  if (!/^[a-zA-Z0-9:_-]{1,160}$/u.test(event.eventKey)
      || event.scopeKey !== scope.scopeKey
      || event.shopId !== scope.shopId
      || event.kind !== scope.kind) {
    throw new Error("SHOPEE_HISTORY_EVENT_IDENTITY_INVALID");
  }
  integer(event.sequence, 1, Number.MAX_SAFE_INTEGER, "SHOPEE_HISTORY_EVENT_SEQUENCE_INVALID");
}

function addOutcomes(
  target: Map<string, "normalized" | "isolated" | "excluded">,
  digests: string[],
  outcome: "normalized" | "isolated" | "excluded",
) {
  for (const item of digests) {
    const previous = target.get(item);
    if (previous && previous !== outcome) throw new Error("SHOPEE_HISTORY_RECORD_OUTCOME_CONFLICT");
    target.set(item, outcome);
  }
}

function projectScope(
  scope: ShopeeHistoryScope,
  events: ShopeeHistoryEvent[],
  replayedEventCount: number,
): InternalScopeProgress {
  const remoteDigests = new Set<string>();
  const normalizedDigests = new Set<string>();
  const isolatedDigests = new Set<string>();
  const excludedDigests = new Set<string>();
  const projectedEventDigests = new Set<string>();
  const outcomes = new Map<string, "normalized" | "isolated" | "excluded">();
  const seenCheckpoints = new Set<string>();
  let remoteOccurrenceCount = 0;
  let activeCheckpoint: ShopeeHistoryCheckpoint | null = null;
  let terminal = false;
  let pageCount = 0;
  let lastErrorCode: string | null = null;
  let interruptionReason: ShopeeHistoryInterruptionEvent["reason"] | null = null;

  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  if (new Set(ordered.map((event) => event.sequence)).size !== ordered.length) {
    throw new Error("SHOPEE_HISTORY_EVENT_SEQUENCE_CONFLICT");
  }
  for (const event of ordered) {
    validateEventIdentity(event, scope);
    const expectedCheckpoint = activeCheckpoint?.checkpointDigest ?? null;
    if (event.type === "interruption") {
      if (terminal || event.checkpointDigest !== expectedCheckpoint
          || !/^[A-Z0-9:_-]{1,120}$/u.test(event.errorCode)) {
        throw new Error("SHOPEE_HISTORY_INTERRUPTION_INVALID");
      }
      lastErrorCode = event.errorCode;
      interruptionReason = event.reason;
      continue;
    }

    if (terminal || event.inputCheckpointDigest !== expectedCheckpoint) {
      throw new Error("SHOPEE_HISTORY_CHECKPOINT_CHAIN_INVALID");
    }
    digest(event.pageDigest, "SHOPEE_HISTORY_PAGE_INVALID");
    const remote = digestList(event.remoteRecordDigests, "SHOPEE_HISTORY_PAGE_INVALID");
    const normalized = digestList(event.normalizedRecordDigests, "SHOPEE_HISTORY_PAGE_INVALID");
    const isolated = digestList(event.isolatedRecordDigests, "SHOPEE_HISTORY_PAGE_INVALID");
    const excluded = digestList(event.excludedRecordDigests, "SHOPEE_HISTORY_PAGE_INVALID");
    const projected = digestList(event.projectedEventDigests, "SHOPEE_HISTORY_PAGE_INVALID");
    const remotePage = new Set(remote);
    if ([...normalized, ...isolated, ...excluded].some((item) => !remotePage.has(item))) {
      throw new Error("SHOPEE_HISTORY_RECORD_OUTCOME_INVALID");
    }
    addOutcomes(outcomes, normalized, "normalized");
    addOutcomes(outcomes, isolated, "isolated");
    addOutcomes(outcomes, excluded, "excluded");
    remote.forEach((item) => remoteDigests.add(item));
    normalized.forEach((item) => normalizedDigests.add(item));
    isolated.forEach((item) => isolatedDigests.add(item));
    excluded.forEach((item) => excludedDigests.add(item));
    projected.forEach((item) => projectedEventDigests.add(item));
    remoteOccurrenceCount += remote.length;
    pageCount += 1;
    lastErrorCode = null;
    interruptionReason = null;

    if (event.nextCheckpoint) {
      validateCheckpoint(event.nextCheckpoint, scope.kind);
      const nextDigest = event.nextCheckpoint.checkpointDigest;
      if (nextDigest === expectedCheckpoint || seenCheckpoints.has(nextDigest)) {
        throw new Error("SHOPEE_HISTORY_CHECKPOINT_REPEATED");
      }
      if (scope.kind === "product_review" && remote.length === 0) {
        throw new Error("SHOPEE_HISTORY_EMPTY_PAGE_WITH_CONTINUATION");
      }
      seenCheckpoints.add(nextDigest);
      activeCheckpoint = event.nextCheckpoint;
    } else {
      activeCheckpoint = null;
      terminal = true;
    }
  }

  const status: ShopeeHistoryStatus = terminal
    ? "complete"
    : interruptionReason ?? (pageCount ? "partial" : "pending");
  const range = scope.kind === "return_refund" ? {
    from: scope.arguments.createTimeFrom,
    to: scope.arguments.createTimeTo,
  } : null;
  return {
    scopeKey: scope.scopeKey,
    shopId: scope.shopId,
    country: scope.country,
    kind: scope.kind,
    status,
    coverage: scope.coverage,
    pageCount,
    remoteUniqueCount: remoteDigests.size,
    normalizedUniqueCount: normalizedDigests.size,
    projectedEventUniqueCount: projectedEventDigests.size,
    duplicateRemoteCount: remoteOccurrenceCount - remoteDigests.size,
    isolatedUniqueCount: isolatedDigests.size,
    excludedUniqueCount: excludedDigests.size,
    unprocessedUniqueCount: [...remoteDigests]
      .filter((item) => !outcomes.has(item)).length,
    replayedEventCount,
    activeCheckpoint,
    lastErrorCode,
    range,
    remoteDigests,
    normalizedDigests,
    isolatedDigests,
    excludedDigests,
    projectedEventDigests,
    remoteOccurrenceCount,
  };
}

function groupStatus(scopes: InternalScopeProgress[]): ShopeeHistoryStatus {
  if (scopes.every((scope) => scope.status === "complete")) return "complete";
  if (scopes.some((scope) => scope.status === "authorization_required")) return "authorization_required";
  if (scopes.some((scope) => scope.status === "failed")) return "failed";
  if (scopes.some((scope) => scope.status !== "pending")) return "partial";
  return "pending";
}

function groupScopes(scopes: InternalScopeProgress[]): ShopeeHistoryShopKindProgress[] {
  const groups = new Map<string, InternalScopeProgress[]>();
  for (const scope of scopes) {
    const key = `${scope.shopId}:${scope.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), scope]);
  }
  return [...groups.values()].map((items) => {
    const first = items[0];
    const remote = new Set<string>();
    const normalized = new Set<string>();
    const isolated = new Set<string>();
    const excluded = new Set<string>();
    const projected = new Set<string>();
    const outcomes = new Map<string, "normalized" | "isolated" | "excluded">();
    let occurrences = 0;
    for (const item of items) {
      item.remoteDigests.forEach((value) => remote.add(value));
      item.normalizedDigests.forEach((value) => normalized.add(value));
      item.isolatedDigests.forEach((value) => isolated.add(value));
      item.excludedDigests.forEach((value) => excluded.add(value));
      item.projectedEventDigests.forEach((value) => projected.add(value));
      addOutcomes(outcomes, [...item.normalizedDigests], "normalized");
      addOutcomes(outcomes, [...item.isolatedDigests], "isolated");
      addOutcomes(outcomes, [...item.excludedDigests], "excluded");
      occurrences += item.remoteOccurrenceCount;
    }
    const remaining = items.filter((item) => item.status !== "complete");
    return {
      shopId: first.shopId,
      country: first.country,
      kind: first.kind,
      status: groupStatus(items),
      plannedScopeCount: items.length,
      completedScopeCount: items.filter((item) => item.status === "complete").length,
      failedScopeCount: items.filter((item) => item.status === "failed").length,
      authorizationRequiredScopeCount: items
        .filter((item) => item.status === "authorization_required").length,
      remainingScopeKeys: remaining.map((item) => item.scopeKey),
      activeCheckpointDigests: remaining.flatMap((item) => item.activeCheckpoint
        ? [item.activeCheckpoint.checkpointDigest] : []),
      knownPendingDetailCount: items.reduce((count, item) => count
        + (item.activeCheckpoint?.kind === "return_refund" ? item.activeCheckpoint.pendingDetailCount : 0), 0),
      providerRemainderUnknown: first.kind === "product_review"
        ? remaining.length > 0
        : remaining.some((item) => item.status === "pending"
          || item.activeCheckpoint?.kind === "return_refund" && item.activeCheckpoint.nextListPageNo !== null),
      remoteUniqueCount: remote.size,
      normalizedUniqueCount: normalized.size,
      projectedEventUniqueCount: projected.size,
      duplicateRemoteCount: occurrences - remote.size,
      isolatedUniqueCount: isolated.size,
      excludedUniqueCount: excluded.size,
      unprocessedUniqueCount: [...remote].filter((item) => !outcomes.has(item)).length,
      replayedEventCount: items.reduce((count, item) => count + item.replayedEventCount, 0),
    };
  }).sort((left, right) => left.shopId.localeCompare(right.shopId)
    || left.kind.localeCompare(right.kind));
}

export function projectShopeeHistoryProgress(
  plannedScopes: ShopeeHistoryScope[],
  observedEvents: ShopeeHistoryEvent[],
): ShopeeHistoryProgress {
  if (!Array.isArray(plannedScopes) || !plannedScopes.length || plannedScopes.length > 20_000
      || !Array.isArray(observedEvents) || observedEvents.length > 100_000) {
    throw new Error("SHOPEE_HISTORY_PROGRESS_INPUT_INVALID");
  }
  const scopes = new Map<string, ShopeeHistoryScope>();
  for (const scope of plannedScopes) {
    validateScope(scope);
    if (scopes.has(scope.scopeKey)) throw new Error("SHOPEE_HISTORY_SCOPE_DUPLICATE");
    scopes.set(scope.scopeKey, scope);
  }

  const uniqueEvents = new Map<string, { event: ShopeeHistoryEvent; digest: string }>();
  const replayCount = new Map<string, number>();
  for (const event of observedEvents) {
    const scope = scopes.get(event.scopeKey);
    if (!scope) throw new Error("SHOPEE_HISTORY_SCOPE_UNPLANNED");
    validateEventIdentity(event, scope);
    const eventDigest = sha256(stable(event));
    const previous = uniqueEvents.get(event.eventKey);
    if (previous) {
      if (previous.digest !== eventDigest) throw new Error("SHOPEE_HISTORY_EVENT_REUSE_MISMATCH");
      replayCount.set(event.scopeKey, (replayCount.get(event.scopeKey) ?? 0) + 1);
    } else {
      uniqueEvents.set(event.eventKey, { event, digest: eventDigest });
    }
  }

  const internal = [...scopes.values()].map((scope) => projectScope(
    scope,
    [...uniqueEvents.values()].map(({ event }) => event).filter((event) => event.scopeKey === scope.scopeKey),
    replayCount.get(scope.scopeKey) ?? 0,
  ));
  const publicScopes = internal.map((scope): ShopeeHistoryScopeProgress => ({
    scopeKey: scope.scopeKey,
    shopId: scope.shopId,
    country: scope.country,
    kind: scope.kind,
    status: scope.status,
    coverage: scope.coverage,
    pageCount: scope.pageCount,
    remoteUniqueCount: scope.remoteUniqueCount,
    normalizedUniqueCount: scope.normalizedUniqueCount,
    projectedEventUniqueCount: scope.projectedEventUniqueCount,
    duplicateRemoteCount: scope.duplicateRemoteCount,
    isolatedUniqueCount: scope.isolatedUniqueCount,
    excludedUniqueCount: scope.excludedUniqueCount,
    unprocessedUniqueCount: scope.unprocessedUniqueCount,
    replayedEventCount: scope.replayedEventCount,
    activeCheckpoint: scope.activeCheckpoint,
    lastErrorCode: scope.lastErrorCode,
    range: scope.range,
  }));
  return {
    contract: "sellerpilot-shopee-history-progress/1",
    scopes: publicScopes,
    shopKinds: groupScopes(internal),
  };
}
