import { executeChannelInquiries as qoo10 } from "../channels/qoo10/adapter";
import { executeChannelInquiries as shopee } from "../channels/shopee/adapter";
import { executeChannelInquiries as lazada } from "../channels/lazada/adapter";
import { executeChannelInquiries as coupang } from "../channels/coupang/adapter";
import { executeChannelInquiries as elevenst } from "../channels/elevenst/adapter";
import { executeChannelInquiries as smartstore } from "../channels/smartstore/adapter";
import { executeChannelInquiries as ebay } from "../channels/ebay/adapter";
import { executeChannelInquiries as temu } from "../channels/temu/adapter";
import type { ActiveChannelKey } from "../../channels/catalog";
import type { ChannelOperationStep } from "../../channels/operation-step";
import type { CsExecuteInput, CsRetryContinuation } from "./contracts";
type Adapter = (
  input: CsExecuteInput,
) => Promise<{
  steps: ChannelOperationStep[];
  remoteId?: string;
  continuationArguments?: Record<string, unknown>;
  retryContinuation?: CsRetryContinuation;
}>;
export const csChannelAdapters = {
  qoo10: qoo10,
  shopee: shopee,
  lazada: lazada,
  coupang: coupang,
  elevenst: elevenst,
  smartstore: smartstore,
  ebay: ebay,
  temu: temu,
} satisfies Record<ActiveChannelKey, Adapter>;
