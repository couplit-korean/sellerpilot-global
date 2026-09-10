import { qoo10Request, type SecretPayload } from "./protocols";
import { step, type ChannelOperationStep } from "./operation-step";
import { objectValue, stringMap } from "./operation-values";
import { replyAcceptanceMarker } from "./reply-verification";
import {
  qoo10InquiryListParams,
  qoo10InquiryReplyParams,
  qoo10JapanTimestamp,
} from "./cs/qoo10/contracts.ts";

type Qoo10InquiryInput = {
  operation: "inquiries.list" | "inquiries.reply";
  payload: SecretPayload;
  arguments: Record<string, unknown>;
};
type Qoo10InquiryExecution = { steps: ChannelOperationStep[]; remoteId?: string };

const qoo10ClaimStatuses = new Set(["1", "2", "3", "4", "5", "6", "11", "12", "13", "14", "15", "16"]);

function qoo10ClaimParams(argumentsValue: Record<string, unknown>) {
  const raw = objectValue(argumentsValue, "params");
  const allowed = new Set(["ClaimStat", "search_Sdate", "search_Edate", "search_condition"]);
  if (Object.entries(raw).some(([key, value]) =>
    !allowed.has(key) || !["string", "number"].includes(typeof value)
  )) throw new Error("QOO10_CLAIM_QUERY_INVALID");
  const params = stringMap(argumentsValue, "params", true);
  const fromValue = params.search_Sdate?.trim() ?? "";
  const toValue = params.search_Edate?.trim() ?? "";
  const from = qoo10JapanTimestamp(fromValue, "QOO10_CLAIM_TIME_RANGE_INVALID");
  const to = qoo10JapanTimestamp(toValue, "QOO10_CLAIM_TIME_RANGE_INVALID");
  if (to < from || to - from > 90 * 86_400_000) throw new Error("QOO10_CLAIM_TIME_RANGE_INVALID");
  if (params.ClaimStat && !qoo10ClaimStatuses.has(params.ClaimStat)) throw new Error("QOO10_CLAIM_QUERY_INVALID");
  if (params.search_condition && !["1", "2", "3"].includes(params.search_condition)) {
    throw new Error("QOO10_CLAIM_QUERY_INVALID");
  }
  return params;
}

export async function executeQoo10Inquiry(input: Qoo10InquiryInput): Promise<Qoo10InquiryExecution> {
  const kind = typeof input.arguments.kind === "string" ? input.arguments.kind.trim() : "";
  if (input.operation === "inquiries.list" && kind === "claim") {
    const remote = await qoo10Request({
      payload: input.payload,
      service: "ShippingBasic",
      method: "GetClaimInfo_V3",
      params: qoo10ClaimParams(input.arguments),
    });
    const claimStep = step("GetClaimInfo_V3", remote);
    claimStep.data = { ...claimStep.data, sellerpilotInquiryKind: "claim" };
    return { steps: [claimStep] };
  }
  if (kind) throw new Error("CHANNEL_ARGUMENT_INVALID:kind");
  const method = input.operation === "inquiries.list" ? "GetInquiryMessage"
    : input.operation === "inquiries.reply" ? "SetInquiryMessage" : undefined;
  if (!method) throw new Error("QOO10_INQUIRY_OPERATION_REQUIRED");
  const params: Record<string, string> = input.operation === "inquiries.list"
    ? qoo10InquiryListParams(input.arguments)
    : qoo10InquiryReplyParams(input.arguments);
  const remote = await qoo10Request({
    payload: input.payload,
    service: "CSCenter",
    method,
    params,
  });
  const resultObject = remote.data.ResultObject;
  // Preserve the existing gateway response identity contract. The native CS
  // question/sequence remains bound in reply arguments, not a listing lookup.
  const remoteId = typeof resultObject === "string" || typeof resultObject === "number"
    ? String(resultObject)
    : resultObject && typeof resultObject === "object" && !Array.isArray(resultObject)
      ? ["SEQ_NO", "SeqNo", "seq_no", "GdNo", "ItemCode", "itemCode"]
        .map(key => (resultObject as Record<string, unknown>)[key])
        .find((value): value is string | number => typeof value === "string" || typeof value === "number")
        ?.toString()
      : undefined;
  const resultStep = step(method, remote);
  if (input.operation === "inquiries.reply" && resultStep.ok) {
    resultStep.data = { ...resultStep.data, sellerpilotReplyAcceptance: replyAcceptanceMarker(
      "qoo10", "inquiry", {
        inquiryType: params.inq_type, questionNo: params.question_no, sequenceNo: params.seq_no,
      },
    ) };
  }
  return { steps: [resultStep], remoteId };
}
