import { createHash } from "node:crypto";
import { shopeeHistoryCheckpointDigest } from "./history-event-evidence";
import type { ShopeeHistoryCheckpoint } from "./history-progress";
import type { ShopeeReturnHistoryScope, ShopeeReviewHistoryScope } from "./history-plan";

type JsonRecord = Record<string, unknown>;
type ShopeeHistoryScope = ShopeeReviewHistoryScope | ShopeeReturnHistoryScope;

export const shopeeHistoryRecoveryContract = "sellerpilot-shopee-history-recovery/1" as const;
export const SHOPEE_HISTORY_MAX_RECOVERY_ATTEMPTS = 3;

const recoveryKeys = [
  "sellerpilotShopeeHistoryRecoveryContract",
  "sellerpilotShopeeHistoryRecoveryAttempt",
  "sellerpilotShopeeHistoryRecoveryOfJobId",
] as const;
const metadataKeys = [
  "kind", "shopId", "sellerpilotShopeeScopeKey", "sellerpilotShopeeHistoryRunId",
  "sellerpilotShopeeHistorySequence", "sellerpilotShopeeInputCheckpointDigest",
  "sellerpilotPaginationDepth", "sellerpilotPaginationEpoch", "sellerpilotPaginationTrail",
  ...recoveryKeys,
] as const;
const allowedByKind = {
  product_review: new Set([...metadataKeys, "cursor", "pageSize"]),
  return_refund: new Set([
    ...metadataKeys, "createTimeFrom", "createTimeTo", "pageNo", "pageSize", "returnQueue", "nextPageNo",
  ]),
} as const;
const digestPattern = /^[a-f0-9]{64}$/u;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function sha256(value: unknown) {
  return createHash("sha256").update(stable(value), "utf8").digest("hex");
}

function integer(value: unknown, minimum: number, maximum: number, code: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(code);
  return parsed;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validatePagination(arguments_: Readonly<JsonRecord>) {
  const keys = ["sellerpilotPaginationDepth", "sellerpilotPaginationEpoch", "sellerpilotPaginationTrail"];
  const present = keys.filter((key) => Object.prototype.hasOwnProperty.call(arguments_, key));
  if (!present.length) return null;
  if (present.length !== keys.length) throw new Error("SHOPEE_HISTORY_RECOVERY_PAGINATION_INVALID");
  const depth = integer(arguments_.sellerpilotPaginationDepth, 1, 50,
    "SHOPEE_HISTORY_RECOVERY_PAGINATION_INVALID");
  const epoch = integer(arguments_.sellerpilotPaginationEpoch, 0, Number.MAX_SAFE_INTEGER,
    "SHOPEE_HISTORY_RECOVERY_PAGINATION_INVALID");
  const trail = arguments_.sellerpilotPaginationTrail;
  if (!Array.isArray(trail) || trail.length > 50
      || trail.some((item) => typeof item !== "string" || !digestPattern.test(item))) {
    throw new Error("SHOPEE_HISTORY_RECOVERY_PAGINATION_INVALID");
  }
  return { depth, epoch };
}

function validateBaseArguments(arguments_: Readonly<JsonRecord>) {
  const kind = arguments_.kind;
  if (kind !== "product_review" && kind !== "return_refund") {
    throw new Error("SHOPEE_HISTORY_RECOVERY_ARGUMENTS_INVALID");
  }
  if (Object.keys(arguments_).some((key) => !allowedByKind[kind].has(key))) {
    throw new Error("SHOPEE_HISTORY_RECOVERY_ARGUMENTS_INVALID");
  }
  const shopId = text(arguments_.shopId);
  const runId = text(arguments_.sellerpilotShopeeHistoryRunId);
  const scopeKey = text(arguments_.sellerpilotShopeeScopeKey);
  const sequence = integer(arguments_.sellerpilotShopeeHistorySequence, 1, 1_000_000,
    "SHOPEE_HISTORY_RECOVERY_ARGUMENTS_INVALID");
  const checkpointDigest = arguments_.sellerpilotShopeeInputCheckpointDigest;
  if (!/^[1-9]\d{0,31}$/u.test(shopId)
      || !/^[A-Za-z0-9:_-]{1,120}$/u.test(runId)
      || checkpointDigest !== null && (typeof checkpointDigest !== "string" || !digestPattern.test(checkpointDigest))) {
    throw new Error("SHOPEE_HISTORY_RECOVERY_ARGUMENTS_INVALID");
  }
  const expectedScopeKey = kind === "product_review"
    ? `shopee:${shopId}:product_review:cursor-corpus`
    : `shopee:${shopId}:return_refund:${arguments_.createTimeFrom}-${arguments_.createTimeTo}`;
  if (scopeKey !== expectedScopeKey || integer(arguments_.pageSize, 100, 100,
    "SHOPEE_HISTORY_RECOVERY_ARGUMENTS_INVALID") !== 100) {
    throw new Error("SHOPEE_HISTORY_RECOVERY_ARGUMENTS_INVALID");
  }
  const pagination = validatePagination(arguments_);
  if (kind === "product_review") {
    if (typeof arguments_.cursor !== "string" || arguments_.cursor.length > 500
        || checkpointDigest !== null && !arguments_.cursor.trim()) {
      throw new Error("SHOPEE_HISTORY_RECOVERY_CURSOR_INVALID");
    }
  } else {
    const from = integer(arguments_.createTimeFrom, 1, 9_999_999_999,
      "SHOPEE_HISTORY_RECOVERY_WINDOW_INVALID");
    const to = integer(arguments_.createTimeTo, 1, 9_999_999_999,
      "SHOPEE_HISTORY_RECOVERY_WINDOW_INVALID");
    if (from >= to || to - from > 15 * 86_400) throw new Error("SHOPEE_HISTORY_RECOVERY_WINDOW_INVALID");
    integer(arguments_.pageNo, 1, 1_000_000, "SHOPEE_HISTORY_RECOVERY_RETURN_INVALID");
    const queue = arguments_.returnQueue;
    if (queue !== undefined && (!Array.isArray(queue) || queue.length > 100
        || queue.some((item) => typeof item !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(item))
        || new Set(queue).size !== queue.length)) {
      throw new Error("SHOPEE_HISTORY_RECOVERY_RETURN_INVALID");
    }
    if (arguments_.nextPageNo !== undefined) {
      integer(arguments_.nextPageNo, 2, 1_000_001, "SHOPEE_HISTORY_RECOVERY_RETURN_INVALID");
    }
  }
  return { kind, shopId, runId, scopeKey, sequence, checkpointDigest, pagination };
}

export function assertShopeeHistoryRecoveryArguments(arguments_: Readonly<JsonRecord>) {
  const hasRecoveryField = recoveryKeys.some((key) => Object.prototype.hasOwnProperty.call(arguments_, key));
  if (!hasRecoveryField) return null;
  const base = validateBaseArguments(arguments_);
  const attempt = integer(arguments_.sellerpilotShopeeHistoryRecoveryAttempt, 1,
    SHOPEE_HISTORY_MAX_RECOVERY_ATTEMPTS, "SHOPEE_HISTORY_RECOVERY_ATTEMPT_INVALID");
  const recoveryOfJobId = text(arguments_.sellerpilotShopeeHistoryRecoveryOfJobId);
  if (arguments_.sellerpilotShopeeHistoryRecoveryContract !== shopeeHistoryRecoveryContract
      || !uuidPattern.test(recoveryOfJobId)) {
    throw new Error("SHOPEE_HISTORY_RECOVERY_BINDING_INVALID");
  }
  return { ...base, attempt, recoveryOfJobId };
}

export function buildShopeeHistoryRecoveryRequest(input: {
  credentialId: string;
  historyRunId: string;
  scope: ShopeeHistoryScope;
  activeCheckpoint: ShopeeHistoryCheckpoint | null;
  failedJob: {
    id: string;
    credentialId: string;
    channel: string;
    operation: string;
    status: string;
    request: { arguments: JsonRecord };
  };
  interruption: {
    jobId: string;
    sequence: number;
    checkpointDigest: string | null;
    reason: "failed" | "authorization_required";
  };
}) {
  const { failedJob, interruption, scope, activeCheckpoint } = input;
  if (!uuidPattern.test(input.credentialId) || !/^[A-Za-z0-9:_-]{1,120}$/u.test(input.historyRunId)
      || failedJob.credentialId !== input.credentialId
      || !uuidPattern.test(failedJob.id) || failedJob.id !== interruption.jobId
      || failedJob.channel !== "shopee" || failedJob.operation !== "inquiries.list"
      || failedJob.status !== "failed"
      || (interruption.reason !== "failed" && interruption.reason !== "authorization_required")) {
    throw new Error("SHOPEE_HISTORY_RECOVERY_JOB_INVALID");
  }
  const arguments_ = failedJob.request.arguments;
  const priorRecovery = assertShopeeHistoryRecoveryArguments(arguments_);
  const base = priorRecovery ?? validateBaseArguments(arguments_);
  if (base.runId !== input.historyRunId || base.scopeKey !== scope.scopeKey
      || base.shopId !== scope.shopId || base.kind !== scope.kind
      || base.sequence !== interruption.sequence
      || interruption.checkpointDigest !== base.checkpointDigest
      || (activeCheckpoint?.checkpointDigest ?? null) !== base.checkpointDigest
      || activeCheckpoint && activeCheckpoint.kind !== scope.kind) {
    throw new Error("SHOPEE_HISTORY_RECOVERY_SCOPE_MISMATCH");
  }
  if (scope.kind === "return_refund"
      && (arguments_.createTimeFrom !== scope.arguments.createTimeFrom
        || arguments_.createTimeTo !== scope.arguments.createTimeTo)) {
    throw new Error("SHOPEE_HISTORY_RECOVERY_WINDOW_MISMATCH");
  }
  if (activeCheckpoint) {
    if (!base.pagination
        || base.pagination.depth !== activeCheckpoint.paginationDepth
        || base.pagination.epoch !== activeCheckpoint.paginationEpoch) {
      throw new Error("SHOPEE_HISTORY_RECOVERY_CHECKPOINT_MISMATCH");
    }
    if (activeCheckpoint.kind === "product_review") {
      if (activeCheckpoint.cursorDigest !== sha256(arguments_.cursor)
          || (!priorRecovery && shopeeHistoryCheckpointDigest(arguments_) !== activeCheckpoint.checkpointDigest)) {
        throw new Error("SHOPEE_HISTORY_RECOVERY_CHECKPOINT_MISMATCH");
      }
    } else {
      const pendingDetailCount = Array.isArray(arguments_.returnQueue) ? arguments_.returnQueue.length : 0;
      const nextListPageNo = arguments_.nextPageNo === undefined ? null : Number(arguments_.nextPageNo);
      if (Number(arguments_.pageNo) !== activeCheckpoint.pageNo
          || pendingDetailCount !== activeCheckpoint.pendingDetailCount
          || nextListPageNo !== activeCheckpoint.nextListPageNo
          || (!priorRecovery && shopeeHistoryCheckpointDigest(arguments_) !== activeCheckpoint.checkpointDigest)) {
        throw new Error("SHOPEE_HISTORY_RECOVERY_CHECKPOINT_MISMATCH");
      }
    }
  }
  const attempt = (priorRecovery?.attempt ?? 0) + 1;
  if (attempt > SHOPEE_HISTORY_MAX_RECOVERY_ATTEMPTS) {
    throw new Error("SHOPEE_HISTORY_RECOVERY_ATTEMPTS_EXHAUSTED");
  }
  const nextArguments: JsonRecord = {
    ...arguments_,
    sellerpilotShopeeHistorySequence: base.sequence + 1,
    sellerpilotShopeeHistoryRecoveryContract: shopeeHistoryRecoveryContract,
    sellerpilotShopeeHistoryRecoveryAttempt: attempt,
    sellerpilotShopeeHistoryRecoveryOfJobId: failedJob.id,
  };
  assertShopeeHistoryRecoveryArguments(nextArguments);
  return {
    contract: shopeeHistoryRecoveryContract,
    recoveryAttempt: attempt,
    recoveryOfJobId: failedJob.id,
    historyRunId: base.runId,
    scopeKey: base.scopeKey,
    shopId: base.shopId,
    kind: base.kind,
    request: {
      periodicKey: `inquiries:history:resume:${failedJob.id}:${attempt}`,
      arguments: nextArguments,
    },
  };
}
