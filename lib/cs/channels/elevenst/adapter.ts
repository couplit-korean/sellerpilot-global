import type { CsExecuteInput } from "../../operations/contracts";
import { executeElevenstInquiry } from "../../../channels/elevenst-inquiries";
export async function executeChannelInquiries(input: CsExecuteInput) {
  if (input.channel !== "elevenst")
    throw new Error("CS_CHANNEL_MISMATCH:elevenst");
  return executeElevenstInquiry(input);
}
