import { createHash } from "node:crypto";
import type { NormalizedChannelInquiry } from "../../inquiry-sync";
import type { CsOperationResult as ChannelOperationResult } from "../../../cs/operations/contracts";
import {
  shopeeHistoryRecordDigest,
  type ShopeeHistoryEvent,
  type ShopeeHistoryPageEvent,
} from "./history-progress";

type JsonRecord = Record<string, unknown>;
type ShopeeHistoryKind = "product_review" | "return_refund";
const digestPattern = /^[a-f0-9]{64}$/u;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

const sha256 = (value: unknown) => createHash("sha256").update(stable(value), "utf8").digest("hex");

function positiveInteger(value: unknown, code: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000_000) throw new Error(code);
  return parsed;
}

function metadata(argumentsValue: JsonRecord) {
  const scopeKey = String(argumentsValue.sellerpilotShopeeScopeKey ?? "").trim();
  const shopId = String(argumentsValue.shopId ?? argumentsValue.shop_id ?? "").trim();
  const rawKind = argumentsValue.kind;
  const historyRunId = String(argumentsValue.sellerpilotShopeeHistoryRunId ?? "").trim();
  const sequence = positiveInteger(argumentsValue.sellerpilotShopeeHistorySequence, "SHOPEE_HISTORY_SEQUENCE_INVALID");
  const inputCheckpoint = argumentsValue.sellerpilotShopeeInputCheckpointDigest;
  if (!/^[1-9]\d{0,31}$/u.test(shopId)
      || (rawKind !== "product_review" && rawKind !== "return_refund")
      || !/^[A-Za-z0-9:_-]{1,120}$/u.test(historyRunId)
      || scopeKey !== (rawKind === "product_review"
        ? `shopee:${shopId}:product_review:cursor-corpus`
        : `shopee:${shopId}:return_refund:${argumentsValue.createTimeFrom}-${argumentsValue.createTimeTo}`)
      || (inputCheckpoint !== null && (typeof inputCheckpoint !== "string" || !digestPattern.test(inputCheckpoint)))) {
    throw new Error("SHOPEE_HISTORY_METADATA_INVALID");
  }
  const kind: ShopeeHistoryKind = rawKind;
  return { scopeKey, shopId, kind, sequence, inputCheckpoint: inputCheckpoint as string | null };
}

export function shopeeHistoryCheckpointDigest(argumentsValue: JsonRecord) {
  const material = { ...argumentsValue };
  delete material.sellerpilotShopeeInputCheckpointDigest;
  return sha256({ contract: "sellerpilot-shopee-history-checkpoint/1", arguments: material });
}

export function withShopeeHistoryContinuation(
  currentArguments: JsonRecord,
  continuationArguments: JsonRecord,
) {
  const current = metadata(currentArguments);
  const next = {
    ...continuationArguments,
    shopId: current.shopId,
    kind: current.kind,
    sellerpilotShopeeScopeKey: current.scopeKey,
    sellerpilotShopeeHistoryRunId: currentArguments.sellerpilotShopeeHistoryRunId,
    sellerpilotShopeeHistorySequence: current.sequence + 1,
  };
  return { ...next, sellerpilotShopeeInputCheckpointDigest: shopeeHistoryCheckpointDigest(next) };
}

function remoteIds(result: ChannelOperationResult, shopId: string, kind: ShopeeHistoryKind) {
  const ids: string[] = [];
  for (const step of result.steps) {
    if (!step.ok || !/^inquiries(?::\d+)?$/u.test(step.name)) continue;
    const context = record(step.data.sellerpilotProviderContext);
    if (String(context.shopId ?? "") !== shopId) throw new Error("SHOPEE_HISTORY_REMOTE_SHOP_MISMATCH");
    const response = record(step.data.response);
    if (kind === "product_review") {
      if (!Array.isArray(response.item_comment_list)) throw new Error("SHOPEE_HISTORY_REMOTE_PAGE_INVALID");
      for (const value of response.item_comment_list) {
        const commentId = String(record(value).comment_id ?? "");
        if (!/^[1-9]\d{0,18}$/u.test(commentId)) throw new Error("SHOPEE_HISTORY_REMOTE_PAGE_INVALID");
        ids.push(commentId);
      }
    } else {
      const returnSn = String(response.return_sn ?? "");
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(returnSn)) {
        throw new Error("SHOPEE_HISTORY_REMOTE_PAGE_INVALID");
      }
      ids.push(returnSn);
    }
  }
  return ids;
}

function normalizedIdentity(
  inquiry: NormalizedChannelInquiry,
  shopId: string,
  kind: ShopeeHistoryKind,
) {
  const context = inquiry.providerContext;
  if (String(context.shopId ?? "") !== shopId) return null;
  const id = kind === "product_review" ? String(context.commentId ?? "") : String(context.returnSn ?? "");
  return id ? shopeeHistoryRecordDigest(shopId, kind, id) : null;
}

function nextCheckpoint(
  currentArguments: JsonRecord,
  result: ChannelOperationResult,
  kind: ShopeeHistoryKind,
) {
  if (!result.continuation) return null;
  const next = result.continuation.arguments;
  const checkpointDigest = String(next.sellerpilotShopeeInputCheckpointDigest ?? "");
  if (!digestPattern.test(checkpointDigest)
      || checkpointDigest !== shopeeHistoryCheckpointDigest(next)
      || Number(next.sellerpilotShopeeHistorySequence) !== Number(currentArguments.sellerpilotShopeeHistorySequence) + 1) {
    throw new Error("SHOPEE_HISTORY_CONTINUATION_INVALID");
  }
  const paginationDepth = positiveInteger(next.sellerpilotPaginationDepth, "SHOPEE_HISTORY_CONTINUATION_INVALID");
  const paginationEpoch = Number(next.sellerpilotPaginationEpoch ?? 0);
  if (!Number.isSafeInteger(paginationEpoch) || paginationEpoch < 0) {
    throw new Error("SHOPEE_HISTORY_CONTINUATION_INVALID");
  }
  if (kind === "product_review") {
    const cursor = String(next.cursor ?? "");
    if (!cursor) throw new Error("SHOPEE_HISTORY_CONTINUATION_INVALID");
    return {
      kind, checkpointDigest, cursorDigest: sha256(cursor), paginationEpoch, paginationDepth,
    };
  }
  const queue = next.returnQueue;
  if (queue !== undefined && (!Array.isArray(queue) || queue.length > 100)) {
    throw new Error("SHOPEE_HISTORY_CONTINUATION_INVALID");
  }
  const pendingDetailCount = Array.isArray(queue) ? queue.length : 0;
  const pageNo = positiveInteger(next.pageNo, "SHOPEE_HISTORY_CONTINUATION_INVALID");
  const nextListPageNo = next.nextPageNo === undefined
    ? null
    : positiveInteger(next.nextPageNo, "SHOPEE_HISTORY_CONTINUATION_INVALID");
  if (pendingDetailCount === 0 && nextListPageNo === null) {
    throw new Error("SHOPEE_HISTORY_CONTINUATION_INVALID");
  }
  return { kind, checkpointDigest, pageNo, pendingDetailCount, nextListPageNo,
    paginationEpoch, paginationDepth };
}

export function shopeeHistoryPageEvidence(input: {
  jobId: string;
  arguments: JsonRecord;
  result: ChannelOperationResult;
  normalizedInquiries: NormalizedChannelInquiry[];
}): ShopeeHistoryPageEvent {
  const meta = metadata(input.arguments);
  if (!/^[0-9a-f-]{36}$/u.test(input.jobId) || input.result.channel !== "shopee"
      || input.result.operation !== "inquiries.list" || !input.result.ok
      || input.result.steps.some((step) => !step.ok)) {
    throw new Error("SHOPEE_HISTORY_PAGE_RESULT_INVALID");
  }
  const remote = remoteIds(input.result, meta.shopId, meta.kind)
    .map((id) => shopeeHistoryRecordDigest(meta.shopId, meta.kind, id));
  const remoteUnique = [...new Set(remote)];
  const normalized = [...new Set(input.normalizedInquiries
    .map((inquiry) => normalizedIdentity(inquiry, meta.shopId, meta.kind))
    .filter((value): value is string => Boolean(value)))];
  if (normalized.some((value) => !remoteUnique.includes(value))) {
    throw new Error("SHOPEE_HISTORY_NORMALIZED_REMOTE_MISMATCH");
  }
  const projectedEventDigests = [...new Set(input.normalizedInquiries.map((inquiry) => sha256(inquiry.inboundKey)))];
  const checkpoint = nextCheckpoint(input.arguments, input.result, meta.kind);
  return {
    type: "page", eventKey: input.jobId, sequence: meta.sequence,
    scopeKey: meta.scopeKey, shopId: meta.shopId, kind: meta.kind,
    inputCheckpointDigest: meta.inputCheckpoint,
    pageDigest: sha256({ remote: remoteUnique, projectedEventDigests, checkpoint }),
    remoteRecordDigests: remoteUnique,
    normalizedRecordDigests: normalized,
    isolatedRecordDigests: [],
    excludedRecordDigests: remoteUnique.filter((value) => !normalized.includes(value)),
    projectedEventDigests,
    nextCheckpoint: checkpoint,
  };
}

export function shopeeHistoryInterruptionEvidence(input: {
  jobId: string;
  arguments: JsonRecord;
  error: string;
}): ShopeeHistoryEvent {
  const meta = metadata(input.arguments);
  const raw = input.error.toUpperCase();
  const authorization = /(401|403|TOKEN|AUTH|PERMISSION)/u.test(raw);
  const safe = raw.replace(/[^A-Z0-9:_-]+/gu, "_").replace(/^_+|_+$/gu, "").slice(0, 120)
    || "SHOPEE_HISTORY_FAILED";
  return {
    type: "interruption", eventKey: input.jobId, sequence: meta.sequence,
    scopeKey: meta.scopeKey, shopId: meta.shopId, kind: meta.kind,
    checkpointDigest: meta.inputCheckpoint,
    reason: authorization ? "authorization_required" : "failed",
    errorCode: authorization && !/(401|403|TOKEN|AUTH|PERMISSION)/u.test(safe)
      ? "SHOPEE_AUTHORIZATION_REQUIRED" : safe,
  };
}
