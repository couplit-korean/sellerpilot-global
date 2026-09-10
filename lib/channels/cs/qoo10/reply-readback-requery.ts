import { createHash } from "node:crypto";
import {
  buildQoo10S3GatewayReadback,
  type Qoo10ReplyReadbackTarget,
} from "./reply-readback.ts";

export const qoo10ReplyS3RequeryPolicy = Object.freeze({
  contractVersion: "sellerpilot-qoo10-reply-s3-requery/1" as const,
  maxAttempts: 5,
  maxElapsedMs: 6 * 60 * 60 * 1_000,
  backoffSeconds: Object.freeze([60, 300, 900, 3_600] as const),
});

export type Qoo10ReplyS3RequeryLineage = {
  ownerId: string;
  credentialId: string;
  sellerAccountKey: string;
  environment: "sandbox" | "production";
  deliveryId: string;
  replyJobId: string;
  inboundKey: string;
  searchStartAt: string;
  searchEndAt: string;
  target: Qoo10ReplyReadbackTarget;
};

export type Qoo10ReplyS3RequeryVerification = {
  state: "pending" | "incomplete" | "verified";
  reason:
    | "exact_s3_not_observed"
    | "wrong_sequence_observed"
    | "exact_identity_not_completed"
    | "provider_transport_or_contract_failed"
    | "provider_rejected"
    | "exact_s3_status_observed";
};

type Qoo10ReplyS3RequeryInput = {
  lineage: Qoo10ReplyS3RequeryLineage;
  expectedLineageDigest?: string | null;
  attemptNumber: number;
  firstCheckedAt: string;
  lastCheckedAt: string;
  verification: Qoo10ReplyS3RequeryVerification;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ACCOUNT_KEY_RE = /^[0-9a-f]{64}$/u;
const DIGEST_RE = /^[0-9a-f]{64}$/u;
const retryableResults = new Set([
  "pending:exact_s3_not_observed",
  "incomplete:wrong_sequence_observed",
  "incomplete:exact_identity_not_completed",
  "incomplete:provider_rejected",
  "incomplete:provider_transport_or_contract_failed",
]);

function timestamp(value: string, code: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) throw new Error(code);
  return time;
}

function normalizedLineage(input: Qoo10ReplyS3RequeryLineage) {
  const identifiers = [input.ownerId, input.credentialId, input.deliveryId, input.replyJobId];
  if (identifiers.some((value) => !UUID_RE.test(value))) {
    throw new Error("QOO10_REPLY_REQUERY_LINEAGE_INVALID");
  }
  if (!ACCOUNT_KEY_RE.test(input.sellerAccountKey)
      || !["sandbox", "production"].includes(input.environment)
      || !input.inboundKey.trim() || input.inboundKey.length > 512) {
    throw new Error("QOO10_REPLY_REQUERY_LINEAGE_INVALID");
  }
  const readback = buildQoo10S3GatewayReadback({
    from: input.searchStartAt,
    to: input.searchEndAt,
    target: input.target,
    deliveryId: input.deliveryId,
  });
  return Object.freeze({
    ownerId: input.ownerId,
    credentialId: input.credentialId,
    sellerAccountKey: input.sellerAccountKey,
    environment: input.environment,
    deliveryId: input.deliveryId,
    replyJobId: input.replyJobId,
    inboundKey: input.inboundKey,
    searchStartAt: input.searchStartAt,
    searchEndAt: input.searchEndAt,
    target: Object.freeze({ ...readback.target }),
  });
}

export function qoo10ReplyS3RequeryLineageDigest(input: Qoo10ReplyS3RequeryLineage) {
  const lineage = normalizedLineage(input);
  const material = [
    qoo10ReplyS3RequeryPolicy.contractVersion,
    lineage.ownerId,
    lineage.credentialId,
    lineage.sellerAccountKey,
    lineage.environment,
    lineage.deliveryId,
    lineage.replyJobId,
    lineage.inboundKey,
    lineage.searchStartAt,
    lineage.searchEndAt,
    lineage.target.inquiryType,
    lineage.target.questionNo,
    lineage.target.sequenceNo,
  ].join("\u001f");
  return createHash("sha256").update(material).digest("hex");
}

function stop(reason: string, lineageDigest: string, attemptNumber: number) {
  return Object.freeze({
    contractVersion: qoo10ReplyS3RequeryPolicy.contractVersion,
    decision: "stop" as const,
    reason,
    attemptNumber,
    lineageDigest,
    readOnly: true as const,
    resendAllowed: false as const,
    replyOperationAllowed: false as const,
  });
}

export function decideQoo10ReplyS3Requery(input: Qoo10ReplyS3RequeryInput) {
  if (!Number.isInteger(input.attemptNumber) || input.attemptNumber < 1) {
    throw new Error("QOO10_REPLY_REQUERY_ATTEMPT_INVALID");
  }
  const lineage = normalizedLineage(input.lineage);
  const lineageDigest = qoo10ReplyS3RequeryLineageDigest(lineage);
  const expectedDigest = input.expectedLineageDigest?.trim() ?? "";
  if (expectedDigest && !DIGEST_RE.test(expectedDigest)) {
    throw new Error("QOO10_REPLY_REQUERY_DIGEST_INVALID");
  }
  if (input.attemptNumber > 1 && !expectedDigest) {
    return stop("lineage_proof_required", lineageDigest, input.attemptNumber);
  }
  if (expectedDigest && expectedDigest !== lineageDigest) {
    return stop("lineage_mismatch", lineageDigest, input.attemptNumber);
  }

  const firstCheckedAt = timestamp(input.firstCheckedAt, "QOO10_REPLY_REQUERY_TIME_INVALID");
  const lastCheckedAt = timestamp(input.lastCheckedAt, "QOO10_REPLY_REQUERY_TIME_INVALID");
  if (lastCheckedAt < firstCheckedAt) throw new Error("QOO10_REPLY_REQUERY_TIME_INVALID");

  if (input.verification.state === "verified") {
    return stop("already_verified", lineageDigest, input.attemptNumber);
  }
  const verificationKey = `${input.verification.state}:${input.verification.reason}`;
  if (!retryableResults.has(verificationKey)) {
    return stop("verification_not_retryable", lineageDigest, input.attemptNumber);
  }
  if (input.attemptNumber >= qoo10ReplyS3RequeryPolicy.maxAttempts) {
    return stop("attempt_limit_reached", lineageDigest, input.attemptNumber);
  }
  if (lastCheckedAt - firstCheckedAt >= qoo10ReplyS3RequeryPolicy.maxElapsedMs) {
    return stop("elapsed_limit_reached", lineageDigest, input.attemptNumber);
  }

  const delaySeconds = qoo10ReplyS3RequeryPolicy.backoffSeconds[input.attemptNumber - 1];
  if (!delaySeconds) return stop("attempt_limit_reached", lineageDigest, input.attemptNumber);
  const retryAtMs = lastCheckedAt + delaySeconds * 1_000;
  if (retryAtMs > firstCheckedAt + qoo10ReplyS3RequeryPolicy.maxElapsedMs) {
    return stop("elapsed_limit_reached", lineageDigest, input.attemptNumber);
  }

  const nextAttemptNumber = input.attemptNumber + 1;
  const readback = buildQoo10S3GatewayReadback({
    from: lineage.searchStartAt,
    to: lineage.searchEndAt,
    target: lineage.target,
    deliveryId: lineage.deliveryId,
  });
  const argumentsValue = Object.freeze({
    params: Object.freeze({ ...readback.arguments.params }),
    sellerpilotQoo10ReplyReadback: Object.freeze({
      ...readback.arguments.sellerpilotQoo10ReplyReadback,
    }),
    sellerpilotQoo10ReplyReadbackRequery: Object.freeze({
      contractVersion: qoo10ReplyS3RequeryPolicy.contractVersion,
      attemptNumber: nextAttemptNumber,
      lineageDigest,
    }),
  });
  return Object.freeze({
    contractVersion: qoo10ReplyS3RequeryPolicy.contractVersion,
    decision: "retry" as const,
    reason: "bounded_read_only_requery" as const,
    attemptNumber: input.attemptNumber,
    nextAttemptNumber,
    retryAt: new Date(retryAtMs).toISOString(),
    delaySeconds,
    lineage,
    lineageDigest,
    periodicKey: `${readback.periodicKey}:attempt:${nextAttemptNumber}`,
    operation: "inquiries.list" as const,
    arguments: argumentsValue,
    readOnly: true as const,
    resendAllowed: false as const,
    replyOperationAllowed: false as const,
  });
}
