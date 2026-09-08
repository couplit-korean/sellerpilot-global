import type { CsExecuteInput } from "../../operations/contracts";
import {
  executeTemuInquiry,
  temuInquiryRetryContinuation,
} from "../../../channels/temu-inquiries";
export async function executeChannelInquiries(input: CsExecuteInput) {
  if (input.channel !== "temu") throw new Error("CS_CHANNEL_MISMATCH:temu");
  if (input.operation !== "inquiries.list")
    throw new Error("CHANNEL_OPERATION_UNSUPPORTED:inquiries.reply");
  const result = await executeTemuInquiry({
    ...input,
    operation: "inquiries.list",
  });
  return {
    ...result,
    retryContinuation: temuInquiryRetryContinuation(result) ?? undefined,
  };
}
