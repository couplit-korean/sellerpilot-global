import {
  decideQoo10ReplyS3Requery,
  type Qoo10ReplyS3RequeryLineage,
  type Qoo10ReplyS3RequeryVerification,
} from "./reply-readback-requery.ts";

export const qoo10ReplyS3RequeryContextContract =
  "sellerpilot-qoo10-reply-s3-requery-context/1" as const;
export const qoo10ReplyS3RequeryResultContract =
  "sellerpilot-qoo10-reply-s3-requery-result/1" as const;

type RpcResult = { data: unknown; error: { code?: string | null } | null };
type Rpc = (name: string, arguments_: Record<string, unknown>) => Promise<RpcResult>;
type RuntimeVerification = Qoo10ReplyS3RequeryVerification & {
  matchingRows: number;
  resendAllowed: false;
  replyContentObserved: false;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST_RE = /^[a-f0-9]{64}$/u;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function parseContext(value: unknown) {
  const context = record(value);
  const lineageValue = record(context?.lineage);
  const targetValue = record(lineageValue?.target);
  const environment = exactString(lineageValue?.environment);
  const inquiryType = exactString(targetValue?.inquiryType);
  const expectedLineageDigest = context?.expectedLineageDigest === null
    ? null
    : exactString(context?.expectedLineageDigest);
  const lineage: Qoo10ReplyS3RequeryLineage = {
    ownerId: exactString(lineageValue?.ownerId),
    credentialId: exactString(lineageValue?.credentialId),
    sellerAccountKey: exactString(lineageValue?.sellerAccountKey),
    environment: environment as Qoo10ReplyS3RequeryLineage["environment"],
    deliveryId: exactString(lineageValue?.deliveryId),
    replyJobId: exactString(lineageValue?.replyJobId),
    inboundKey: exactString(lineageValue?.inboundKey),
    searchStartAt: exactString(lineageValue?.searchStartAt),
    searchEndAt: exactString(lineageValue?.searchEndAt),
    target: {
      inquiryType: inquiryType as Qoo10ReplyS3RequeryLineage["target"]["inquiryType"],
      questionNo: exactString(targetValue?.questionNo),
      sequenceNo: exactString(targetValue?.sequenceNo),
    },
  };
  const attemptNumber = context?.attemptNumber;
  const firstCheckedAt = exactString(context?.firstCheckedAt);
  const lastCheckedAt = exactString(context?.lastCheckedAt);
  if (context?.contract !== qoo10ReplyS3RequeryContextContract
      || !UUID_RE.test(exactString(context.sourceReadbackJobId))
      || !Number.isInteger(attemptNumber) || Number(attemptNumber) < 1 || Number(attemptNumber) > 5
      || !firstCheckedAt || !lastCheckedAt
      || (Number(attemptNumber) === 1 ? expectedLineageDigest !== null : !DIGEST_RE.test(expectedLineageDigest ?? ""))) {
    throw new Error("QOO10_REPLY_REQUERY_CONTEXT_INVALID");
  }
  return {
    sourceReadbackJobId: exactString(context.sourceReadbackJobId),
    lineage,
    attemptNumber: Number(attemptNumber),
    expectedLineageDigest,
    firstCheckedAt,
    lastCheckedAt,
  };
}

function requireReceipt(value: unknown, expected: {
  jobId: string;
  deliveryId: string;
  attemptNumber: number;
  lineageDigest: string;
  decision: "retry" | "stop";
  stopReason?: string;
  nextAttemptNumber?: number;
}) {
  const receipt = record(value);
  const status = exactString(receipt?.status);
  const validStatus = expected.decision === "retry"
    ? status === "scheduled"
    : expected.stopReason === "already_verified"
      ? status === "verified"
      : status === "reconciliation_required";
  if (receipt?.contract !== qoo10ReplyS3RequeryResultContract
      || !validStatus
      || receipt.sourceReadbackJobId !== expected.jobId
      || receipt.deliveryId !== expected.deliveryId
      || receipt.attemptNumber !== expected.attemptNumber
      || receipt.lineageDigest !== expected.lineageDigest
      || typeof receipt.replayed !== "boolean"
      || (expected.decision === "retry" && (
        receipt.nextAttemptNumber !== expected.nextAttemptNumber
        || !UUID_RE.test(exactString(receipt.requeryJobId))
      ))) {
    throw new Error("QOO10_REPLY_REQUERY_RECEIPT_INVALID");
  }
  return receipt;
}

export async function recordQoo10ReplyS3Requery(input: {
  rpc: Rpc;
  tokenHash: string;
  jobId: string;
  claimToken: string;
  verification: RuntimeVerification;
}) {
  const common = {
    p_token_hash: input.tokenHash,
    p_job_id: input.jobId,
    p_claim_token: input.claimToken,
  };
  const contextRpc = await input.rpc(
    "sellerpilot_service_qoo10_reply_s3_requery_context_v1",
    common,
  );
  if (contextRpc.error) throw new Error("QOO10_REPLY_REQUERY_CONTEXT_UNAVAILABLE");
  const context = parseContext(contextRpc.data);
  if (context.sourceReadbackJobId !== input.jobId) {
    throw new Error("QOO10_REPLY_REQUERY_CONTEXT_INVALID");
  }
  const decision = decideQoo10ReplyS3Requery({
    lineage: context.lineage,
    expectedLineageDigest: context.expectedLineageDigest,
    attemptNumber: context.attemptNumber,
    firstCheckedAt: context.firstCheckedAt,
    lastCheckedAt: context.lastCheckedAt,
    verification: input.verification,
  });
  if (decision.decision === "stop"
      && !["already_verified", "attempt_limit_reached", "elapsed_limit_reached"].includes(decision.reason)) {
    throw new Error("QOO10_REPLY_REQUERY_DECISION_INVALID");
  }
  const descriptor = decision.decision === "retry"
    ? {
        contractVersion: decision.contractVersion,
        decision: decision.decision,
        reason: decision.reason,
        attemptNumber: decision.attemptNumber,
        nextAttemptNumber: decision.nextAttemptNumber,
        retryAt: decision.retryAt,
        lineageDigest: decision.lineageDigest,
        periodicKey: decision.periodicKey,
        operation: decision.operation,
               arguments: decision.arguments,
        readOnly: decision.readOnly,
        resendAllowed: decision.resendAllowed,
        replyOperationAllowed: decision.replyOperationAllowed,
      }
    : {
        contractVersion: decision.contractVersion,
        decision: decision.decision,
        reason: decision.reason,
        attemptNumber: decision.attemptNumber,
        lineageDigest: decision.lineageDigest,
        readOnly: decision.readOnly,
        resendAllowed: decision.resendAllowed,
        replyOperationAllowed: decision.replyOperationAllowed,
      };
  const applied = await input.rpc(
    "sellerpilot_service_apply_qoo10_reply_s3_requery_v1",
    {
      ...common,
      p_state: input.verification.state,
      p_reason: input.verification.reason,
      p_matching_rows: input.verification.matchingRows,
      p_descriptor: descriptor,
    },
  );
  if (applied.error) throw new Error("QOO10_REPLY_REQUERY_RECORDING_FAILED");
  return requireReceipt(applied.data, {
    jobId: input.jobId,
    deliveryId: context.lineage.deliveryId,
    attemptNumber: context.attemptNumber,
    lineageDigest: decision.lineageDigest,
    decision: decision.decision,
    ...(decision.decision === "stop" ? { stopReason: decision.reason } : {
      nextAttemptNumber: decision.nextAttemptNumber,
    }),
  });
}
