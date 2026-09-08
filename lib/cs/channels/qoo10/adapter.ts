import type { CsExecuteInput } from "../../operations/contracts";
import { executeQoo10Inquiry } from "../../../channels/qoo10-inquiries";
export async function executeChannelInquiries(input: CsExecuteInput) {
  if (input.channel !== "qoo10") throw new Error("CS_CHANNEL_MISMATCH:qoo10");
  return executeQoo10Inquiry(input);
}
