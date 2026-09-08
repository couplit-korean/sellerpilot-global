import { channelCatalog, type ActiveChannelKey } from "../channels/catalog";
import {
  shippingOperationCapabilities,
  type ShippingOperationName,
} from "./contracts";
export function shippingOperationRelease(
  channel: ActiveChannelKey,
  operation: ShippingOperationName,
) {
  const capability =
    channelCatalog[channel].capabilities[
      shippingOperationCapabilities[operation]
    ];
  if (
    capability.mode === "unsupported" ||
    capability.mode === "vendor_docs_required"
  )
    return { available: false, mode: capability.mode, reason: capability.note };
  if (
    (channel === "elevenst" && operation !== "orders.list") ||
    (["ebay", "temu"].includes(channel) && operation === "shipment.acknowledge")
  )
    return {
      available: false,
      mode: "release_verification_required",
      reason:
        "이 채널의 해당 배송 동작은 제공되지 않거나 검증되지 않아 차단했습니다.",
    };
  return { available: true, mode: "available", reason: capability.note };
}
