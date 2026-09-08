import type { CsExecuteInput } from "../../operations/contracts";
import { executeCoupangInquiry } from "../../../channels/coupang-inquiries";
export async function executeChannelInquiries(input: CsExecuteInput) {
  if (input.channel !== "coupang")
    throw new Error("CS_CHANNEL_MISMATCH:coupang");
  return executeCoupangInquiry(input);
}
