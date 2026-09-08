import type { CsOperationResult as ChannelOperationResult } from "../../../cs/operations/contracts";
import {
  verifyQoo10S3Readback,
  type Qoo10ReplyReadbackTarget,
} from "./reply-readback.ts";

export const qoo10ReplyS3StoredEvidenceContract =
  "sellerpilot-qoo10-s3-stored-evidence/1" as const;

export type Qoo10ReplyS3ReadbackContext = Qoo10ReplyReadbackTarget & {
  contractVersion: "sellerpilot-qoo10-reply-readback/1";
  deliveryId: string;
};

export type Qoo10ReplyS3Verification = {
  state: "verified" | "pending" | "incomplete";
  reason:
    | "exact_s3_status_observed"
    | "exact_s3_not_observed"
    | "wrong_sequence_observed"
    | "exact_identity_not_completed"
    | "provider_rejected"
    | "provider_transport_or_contract_failed";
  resendAllowed: false;
  replyContentObserved: false;
  matchingRows: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function transportFailure(): Qoo10ReplyS3Verification {
  return {
    state: "incomplete",
    reason: "provider_transport_or_contract_failed",
    resendAllowed: false,
    replyContentObserved: false,
    matchingRows: 0,
  };
}

function markerFrom(value: unknown) {
  const root = record(value);
  if (!root) return null;
  if (Object.hasOwn(root, "qoo10ReplyReadback")) return root.qoo10ReplyReadback;
  const arguments_ = record(root.arguments);
  return arguments_ && Object.hasOwn(arguments_, "sellerpilotQoo10ReplyReadback")
    ? arguments_.sellerpilotQoo10ReplyReadback
    : null;
}

export function qoo10ReplyS3ReadbackContext(value: unknown): Qoo10ReplyS3ReadbackContext | null {
  const candidate = markerFrom(value);
  if (candidate === null || candidate === undefined) return null;
  const marker = record(candidate);
  const inquiryType = text(marker?.inquiryType).toUpperCase();
  const questionNo = text(marker?.questionNo);
  const sequenceNo = text(marker?.sequenceNo);
  const deliveryId = text(marker?.deliveryId).toLowerCase();
  if (!marker
      || marker.contractVersion !== "sellerpilot-qoo10-reply-readback/1"
      || !UUID_RE.test(deliveryId)
      || !["MSG", "HELP", "ITEM"].includes(inquiryType)
      || !/^\d{1,40}$/u.test(questionNo)
      || !/^\d{1,40}$/u.test(sequenceNo)) {
    throw new Error("QOO10_REPLY_READBACK_CONTEXT_INVALID");
  }
  return {
    contractVersion: "sellerpilot-qoo10-reply-readback/1",
    deliveryId,
    inquiryType: inquiryType as Qoo10ReplyReadbackTarget["inquiryType"],
    questionNo,
    sequenceNo,
  };
}

function providerRows(data: Record<string, unknown>) {
  const result = data.ResultObject;
  if (Array.isArray(result)) return result;
  const resultRecord = record(result);
  const rows = resultRecord?.InquiryInfo ?? resultRecord?.InquiryMessage;
  return Array.isArray(rows) ? rows : null;
}

function minimalStatusRows(
  data: Record<string, unknown>,
  target: Qoo10ReplyReadbackTarget,
) {
  const rows = providerRows(data);
  if (!rows || rows.some((row) => !record(row))) return null;
  return rows.flatMap((value) => {
    const row = record(value)!;
    const inquiryType = text(row.INQ_TYPE ?? row.inq_type).toUpperCase();
    const questionNo = text(row.QUESTION_NO ?? row.question_no);
    if (inquiryType !== target.inquiryType || questionNo !== target.questionNo) return [];
    return [{
      INQ_TYPE: inquiryType,
      QUESTION_NO: questionNo,
      SEQ_NO: text(row.SEQ_NO ?? row.seq_no),
      STATUS: text(row.STATUS ?? row.Status ?? row.AnswerYN).toUpperCase(),
    }];
  });
}

/**
 * Builds the only response shape that may be sealed for a delivery-bound Qoo10
 * S3 readback. Buyer/seller bodies and unrelated inquiries are deliberately
 * discarded; 007 can still derive the exact status from steps[0].data.
 */
export function qoo10ReplyS3CompletionEvidence(input: {
  context: Qoo10ReplyS3ReadbackContext;
  result?: ChannelOperationResult | null;
}) {
  const result = input.result;
  if (!result) return { storedResponse: null, verification: transportFailure() };
  if (result.channel !== "qoo10" || result.operation !== "inquiries.list") {
    throw new Error("QOO10_REPLY_READBACK_RESULT_LINEAGE_INVALID");
  }

  const step = result.steps.length === 1 ? result.steps[0] : null;
  const data = record(step?.data);
  const resultCode = data?.ResultCode;
  const rows = data ? minimalStatusRows(data, input.context) : null;
  const shapeValid = Boolean(
    step
    && step.name === "GetInquiryMessage"
    && data
    && (resultCode === 0 || resultCode === "0" || text(resultCode).length > 0)
    && (resultCode !== 0 && resultCode !== "0" || rows),
  );

  let verification: Qoo10ReplyS3Verification = transportFailure();
  if (shapeValid && data) {
    try {
      verification = verifyQoo10S3Readback({
        target: input.context,
        data,
      });
    } catch {
      verification = transportFailure();
    }
  }

  const safeData = shapeValid
    ? {
        ResultCode: resultCode,
        ResultObject: rows ?? [],
        sellerpilotMarker: qoo10ReplyS3StoredEvidenceContract,
      }
    : {
        ResultCode: null,
        ResultObject: null,
        sellerpilotMarker: qoo10ReplyS3StoredEvidenceContract,
      };
  const storedResponse: ChannelOperationResult = {
    ok: shapeValid ? result.ok : false,
    channel: "qoo10",
    operation: "inquiries.list",
    steps: [{
      name: shapeValid ? "GetInquiryMessage" : "qoo10-s3-readback-invalid",
      ok: shapeValid ? Boolean(step?.ok) : false,
      status: Number.isInteger(step?.status) ? step!.status : 502,
      data: safeData,
    }],
    safeMessage: "Qoo10 S3 상태 조회의 개인정보 제거 증거를 저장했습니다.",
  };
  return { storedResponse, verification };
}

export function qoo10ReplyS3StatusRpcArguments(input: {
  tokenHash: string;
  jobId: string;
  claimToken: string;
  context: Qoo10ReplyS3ReadbackContext;
  verification: Qoo10ReplyS3Verification;
}) {
  return {
    p_token_hash: input.tokenHash,
    p_job_id: input.jobId,
    p_claim_token: input.claimToken,
    p_delivery_id: input.context.deliveryId,
    p_state: input.verification.state,
    p_reason: input.verification.reason,
    p_matching_rows: input.verification.matchingRows,
    p_reply_content_observed: false,
    p_resend_allowed: false,
  };
}
