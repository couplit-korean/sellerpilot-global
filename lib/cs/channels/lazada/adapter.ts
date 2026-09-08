import type { CsExecuteInput } from "../../operations/contracts";
import { executeLazadaInquiry } from "../../../channels/lazada-inquiries";
export async function executeChannelInquiries(input: CsExecuteInput) {
  if (input.channel !== "lazada") throw new Error("CS_CHANNEL_MISMATCH:lazada");
  return executeLazadaInquiry(input);
}
