import { qoo10InquiryListParams, qoo10InquiryTypes, type Qoo10InquiryType } from "./contracts.ts";
import type { Qoo10HistoryExecutor } from "./history-runtime.ts";

export type Qoo10ReplyReadbackTarget = {
  inquiryType: Qoo10InquiryType;
  questionNo: string;
  sequenceNo: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function target(input: Qoo10ReplyReadbackTarget): Qoo10ReplyReadbackTarget {
  const inquiryType = text(input.inquiryType).toUpperCase();
  const questionNo = text(input.questionNo);
  const sequenceNo = text(input.sequenceNo);
  if (!qoo10InquiryTypes.includes(inquiryType as Qoo10InquiryType)
      || !/^\d{1,40}$/u.test(questionNo) || !/^\d{1,40}$/u.test(sequenceNo)) {
    throw new Error("QOO10_REPLY_READBACK_TARGET_INVALID");
  }
  return { inquiryType: inquiryType as Qoo10InquiryType, questionNo, sequenceNo };
}

function resultRows(data: Record<string, unknown>) {
  const result = data.ResultObject;
  const rows = Array.isArray(result)
    ? result
    : record(result).InquiryInfo ?? record(result).InquiryMessage;
  if (!Array.isArray(rows)
      || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("QOO10_REPLY_READBACK_ROWS_INVALID");
  }
  return rows as Record<string, unknown>[];
}

export function buildQoo10S3ReadbackArguments(input: {
  from: string;
  to: string;
  target: Qoo10ReplyReadbackTarget;
}) {
  const exactTarget = target(input.target);
  return {
    arguments: {
      params: qoo10InquiryListParams({
        params: { search_start_dt: input.from, search_end_dt: input.to, proc_status: "S3" },
      }),
    },
    target: exactTarget,
  };
}

export function buildQoo10S3GatewayReadback(input: {
  from: string;
  to: string;
  target: Qoo10ReplyReadbackTarget;
  deliveryId: string;
}) {
  if (!UUID_RE.test(input.deliveryId)) throw new Error("QOO10_REPLY_READBACK_DELIVERY_INVALID");
  const request = buildQoo10S3ReadbackArguments(input);
  return {
    periodicKey: `inquiries:reply-readback:qoo10:${input.deliveryId}`,
    arguments: {
      ...request.arguments,
      sellerpilotQoo10ReplyReadback: {
        contractVersion: "sellerpilot-qoo10-reply-readback/1" as const,
        deliveryId: input.deliveryId,
        inquiryType: request.target.inquiryType,
        questionNo: request.target.questionNo,
        sequenceNo: request.target.sequenceNo,
      },
    },
    target: request.target,
  };
}

export function verifyQoo10S3Readback(input: {
  target: Qoo10ReplyReadbackTarget;
  data: Record<string, unknown>;
}) {
  const exactTarget = target(input.target);
  const resultCode = input.data.ResultCode;
  if (resultCode !== 0 && resultCode !== "0") {
    return {
      state: "incomplete" as const,
      reason: "provider_rejected" as const,
      resendAllowed: false as const,
      replyContentObserved: false as const,
      matchingRows: 0,
    };
  }
  const rows = resultRows(input.data);
  const sameQuestion = rows.filter((row) =>
    text(row.INQ_TYPE ?? row.inq_type).toUpperCase() === exactTarget.inquiryType
    && text(row.QUESTION_NO ?? row.question_no) === exactTarget.questionNo);
  const exact = sameQuestion.filter((row) => text(row.SEQ_NO ?? row.seq_no) === exactTarget.sequenceNo);
  if (!exact.length) {
    return {
      state: sameQuestion.length ? "incomplete" as const : "pending" as const,
      reason: sameQuestion.length ? "wrong_sequence_observed" as const : "exact_s3_not_observed" as const,
      resendAllowed: false as const,
      replyContentObserved: false as const,
      matchingRows: 0,
    };
  }
  const completed = exact.every((row) => /^(?:S3|ANSWER(?:ED)?|COMPLETE(?:D)?)$/u
    .test(text(row.STATUS ?? row.Status ?? row.AnswerYN).toUpperCase()));
  if (!completed) {
    return {
      state: "incomplete" as const,
      reason: "exact_identity_not_completed" as const,
      resendAllowed: false as const,
      replyContentObserved: false as const,
      matchingRows: exact.length,
    };
  }
  return {
    state: "verified" as const,
    reason: "exact_s3_status_observed" as const,
    resendAllowed: false as const,
    replyContentObserved: false as const,
    matchingRows: exact.length,
  };
}

export async function executeQoo10ReplyS3Readback(input: {
  from: string;
  to: string;
  target: Qoo10ReplyReadbackTarget;
  execute: Qoo10HistoryExecutor;
}) {
  const request = buildQoo10S3ReadbackArguments(input);
  const execution = await input.execute({ operation: "inquiries.list", arguments: request.arguments });
  if (execution.steps.length !== 1) throw new Error("QOO10_REPLY_READBACK_STEPS_INVALID");
  const step = execution.steps[0]!;
  const verification = step.ok
    ? verifyQoo10S3Readback({ target: request.target, data: step.data })
    : {
      state: "incomplete" as const,
      reason: "provider_transport_or_contract_failed" as const,
      resendAllowed: false as const,
      replyContentObserved: false as const,
      matchingRows: 0,
    };
  return { execution, verification };
}
