import { executeQoo10 } from "./channels/qoo10";
import { executeShopee } from "./channels/shopee";
import { executeLazada } from "./channels/lazada";
import { executeCoupang } from "./channels/coupang";
import { executeElevenst } from "./channels/elevenst";
import { executeSmartstore } from "./channels/smartstore";
import { executeEbay } from "./channels/ebay";
import { executeTemu } from "./channels/temu";
import type { ActiveChannelKey } from "../channels/catalog";
import type {
  ShippingExecuteInput as ExecuteInput,
  ShippingOperationResult as ChannelOperationResult,
} from "./contracts";
export const shippingChannelAdapters = {
  qoo10: executeQoo10,
  shopee: executeShopee,
  lazada: executeLazada,
  coupang: executeCoupang,
  elevenst: executeElevenst,
  smartstore: executeSmartstore,
  ebay: executeEbay,
  temu: executeTemu,
} satisfies Record<
  ActiveChannelKey,
  (input: ExecuteInput) => Promise<ChannelOperationResult>
>;
