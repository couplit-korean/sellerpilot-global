import type { CsExecuteInput } from "../../operations/contracts";
import { executeShopeeInquiry } from "../../../channels/shopee-inquiries";
export async function executeChannelInquiries(input: CsExecuteInput) {
  if (input.channel !== "shopee") throw new Error("CS_CHANNEL_MISMATCH:shopee");
  return executeShopeeInquiry(input);
}
