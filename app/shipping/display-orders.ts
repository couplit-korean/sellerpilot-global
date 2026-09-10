import type { ShippingSnapshot } from "../../lib/shipping/snapshot";
import type { DisplayOrder } from "./workspace";
const orderStatusLabel = {
  paid: "결제완료",
  ready_to_ship: "출고대기",
  shipped: "배송중",
  delivered: "배송완료",
  cancelled: "취소완료",
  refunded: "환불완료",
} as const;
function relativeTime(value: string) {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 60_000),
  );
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}시간 전`;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
  }).format(new Date(value));
}
export function displayShippingOrders(
  snapshot: ShippingSnapshot | null,
): DisplayOrder[] {
  return (
    snapshot?.orders.map((order) => ({
      sourceId: order.id,
      id: order.externalOrderId,
      channelKey: order.channelKey,
      channel: order.channelCode,
      customer: order.customerName,
      product: order.productName,
      amount: new Intl.NumberFormat("ko-KR", {
        style: "currency",
        currency: order.currency,
        maximumFractionDigits: order.currency === "KRW" ? 0 : 2,
      }).format(order.amount),
      status: orderStatusLabel[order.status],
      time: relativeTime(order.orderedAt),
      shippedAt: order.shippedAt,
      deliveredAt: order.deliveredAt,
      carrierCode: order.carrierCode,
      trackingNumber: order.trackingNumber,
      settlementStatus:
        {
          pending: "정산 대기",
          expected: "정산 예정",
          settled: "정산 완료",
          held: "정산 보류",
          disputed: "정산 이의",
        }[order.settlementStatus] ?? order.settlementStatus,
      settlementAmount: order.settlementAmount,
      settlementCurrency: order.settlementCurrency,
      exchangeLossPercent: order.exchangeLossPercent,
    })) ?? []
  );
}
