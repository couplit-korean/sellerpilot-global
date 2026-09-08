import { createHash } from "node:crypto";
export function shippingWriteResource(channel: string, orderId: string) {
  if (!/^[a-f0-9-]{36}$/i.test(orderId))
    throw new Error("SHIPPING_ORDER_ID_REQUIRED");
  return {
    kind: "order_shipment" as const,
    key: createHash("sha256")
      .update(`${channel}\u0000order_shipment\u0000${orderId}`)
      .digest("hex"),
    orderId,
  };
}
