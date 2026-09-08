import type { CsExecuteInput } from "../../operations/contracts";
import { executeEbayInquiry } from "../../../channels/ebay-inquiries";
export async function executeChannelInquiries(input: CsExecuteInput) {
  if (input.channel !== "ebay") throw new Error("CS_CHANNEL_MISMATCH:ebay");
  return executeEbayInquiry(input);
}
