import "server-only";
import type { ActiveChannelKey } from "./catalog";
import type { ChannelOperationResult } from "./operations";
import { firstFiniteNonNegative } from "./normalize-value";

export type NormalizedChannelOrder = {
  externalOrderId: string;
  customerName: string;
  productName: string;
  quantity: number;
  amount: number;
  currency: string;
  amountKrw: number;
  status: "paid" | "ready_to_ship" | "shipped" | "delivered" | "cancelled" | "refunded";
  orderedAt: string;
  providerContext?: Record<string, unknown>;
};

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};
const list = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
  ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
  : [];
const text = (...values: unknown[]) => values.find((value) => (typeof value === "string" || typeof value === "number") && String(value).trim())?.toString().trim() ?? "";
const number = (...values: unknown[]) => firstFiniteNonNegative(values);
const iso = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      const time = value < 10_000_000_000 ? value * 1000 : value;
      const parsed = new Date(time);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
  }
  return new Date().toISOString();
};

function status(value: unknown): NormalizedChannelOrder["status"] {
  const remote = String(value ?? "").toUpperCase();
  if (/REFUND|RETURN/.test(remote)) return "refunded";
  if (/CANCEL|VOID|INACTIVE/.test(remote)) return "cancelled";
  if (/DELIVERED|FINAL_DELIVERY|COMPLETED|COMPLETE/.test(remote)) return "delivered";
  if (/SHIPPED|DEPARTURE|DELIVERING|IN_TRANSIT|PROCESSED/.test(remote)) return "shipped";
  if (/READY|INSTRUCT|TO_SHIP|PENDING_SHIPMENT|PACKED/.test(remote)) return "ready_to_ship";
  return "paid";
}

function compactProductNames(items: Record<string, unknown>[], fallback: string) {
  const names = items.map((item) => text(item.vendorItemName, item.productName, item.itemName, item.goodsName, item.originalGoodsName, item.name, item.title)).filter(Boolean);
  const unique = [...new Set(names)];
  if (!unique.length) return fallback;
  return unique.length === 1 ? unique[0] : `${unique[0]} 외 ${unique.length - 1}개`;
}

function temuOrderStatus(value: unknown): NormalizedChannelOrder["status"] {
  const numeric = Number(value);
  if (numeric === 2 || numeric === 41) return "ready_to_ship";
  if (numeric === 3) return "cancelled";
  if (numeric === 4 || numeric === 51) return "shipped";
  if (numeric === 5) return "delivered";
  return status(value);
}

function normalizeTemu(data: Record<string, unknown>) {
  const rows = list(object(data.result).pageItems);
  return rows.map((row): NormalizedChannelOrder | null => {
    const parent = object(row.parentOrderMap);
    const items = list(row.orderList);
    const externalOrderId = text(parent.parentOrderSn, row.parentOrderSn);
    if (!externalOrderId) return null;
    const activeQuantity = items.reduce((sum, item) => {
      const ordered = Math.round(number(item.quantity));
      const cancelled = Math.round(number(item.canceledQuantityBeforeShipment));
      return sum + Math.max(0, ordered - cancelled);
    }, 0);
    const amount = number(parent.orderAmount, parent.totalAmount, row.orderAmount);
    const currency = text(parent.currency, row.currency, "KRW").toUpperCase();
    const orderItems = items.map((item) => ({
      parentOrderSn: externalOrderId,
      orderSn: text(item.orderSn),
      goodsId: text(item.goodsId),
      skuId: text(item.skuId),
      quantity: Math.max(0, Math.round(number(item.quantity)) - Math.round(number(item.canceledQuantityBeforeShipment))),
    })).filter((item) => item.orderSn && item.quantity > 0).slice(0, 100);
    return {
      externalOrderId,
      customerName: "Temu 구매자",
      productName: compactProductNames(items, "Temu 주문 상품"),
      quantity: Math.max(1, activeQuantity || Math.round(number(parent.quantity)) || 1),
      amount,
      currency,
      amountKrw: currency === "KRW" ? amount : 0,
      status: temuOrderStatus(parent.parentOrderStatus),
      orderedAt: iso(parent.parentOrderTime, parent.createTime, items[0]?.orderCreateTime, parent.updateTime),
      providerContext: {
        parentOrderSn: externalOrderId,
        regionId: text(parent.regionId),
        inventoryDeductionWarehouseId: text(items[0]?.inventoryDeductionWarehouseId),
        orderItems,
      },
    };
  }).filter((row): row is NormalizedChannelOrder => Boolean(row));
}

function normalizeCoupang(data: Record<string, unknown>) {
  const rows = list(data.data).length ? list(data.data) : list(object(data.data).orderSheets);
  return rows.map((row): NormalizedChannelOrder | null => {
    const cancellation = text(row.receiptType).toUpperCase() === "CANCEL" || Array.isArray(row.returnItems);
    const items = cancellation ? list(row.returnItems) : list(row.orderItems);
    const externalOrderId = text(row.orderId, row.shipmentBoxId);
    if (!externalOrderId) return null;
    const itemTotal = items.reduce((sum, item) => {
      const unitPrice = number(item.orderPrice, item.salesPrice, item.unitPrice, item.discountPrice);
      const quantity = Math.max(1, number(item.shippingCount, item.quantity, item.orderQuantity));
      return sum + unitPrice * quantity;
    }, 0);
    const sheetTotal = number(row.orderPrice, row.totalPrice, row.paidAmount, row.paymentAmount);
    const total = sheetTotal > 0 ? sheetTotal : itemTotal;
    return {
      externalOrderId,
      customerName: text(object(row.orderer).name, object(row.receiver).name, "쿠팡 구매자"),
      productName: compactProductNames(items, cancellation ? "쿠팡 취소 상품" : "쿠팡 주문 상품"),
      quantity: Math.max(1, Math.round(items.reduce((sum, item) => sum + number(item.cancelCount, item.shippingCount, item.quantity), 0) || number(row.cancelCountSum) || 1)),
      amount: total,
      currency: "KRW",
      amountKrw: total,
      status: cancellation ? "cancelled" : status(row.status),
      orderedAt: iso(row.orderedAt, row.paidAt, row.createdAt, row.modifiedAt),
    };
  }).filter((row): row is NormalizedChannelOrder => Boolean(row));
}

function normalizeShopee(data: Record<string, unknown>) {
  const rows = list(object(data.response).order_list);
  return rows.map((row): NormalizedChannelOrder | null => {
    const externalOrderId = text(row.order_sn, row.order_id);
    if (!externalOrderId) return null;
    const amount = number(row.total_amount);
    const currency = text(row.currency, "KRW").toUpperCase();
    return {
      externalOrderId,
      customerName: text(row.buyer_username, "Shopee 구매자"),
      productName: text(row.item_name, "Shopee 주문 상품"),
      quantity: Math.max(1, Math.round(number(row.quantity) || 1)),
      amount,
      currency,
      amountKrw: currency === "KRW" ? amount : 0,
      status: status(row.order_status),
      orderedAt: iso(row.create_time, row.update_time),
    };
  }).filter((row): row is NormalizedChannelOrder => Boolean(row));
}

function normalizeLazada(data: Record<string, unknown>) {
  const rows = list(object(data.data).orders);
  return rows.map((row): NormalizedChannelOrder | null => {
    const externalOrderId = text(row.order_id, row.order_number);
    if (!externalOrderId) return null;
    const amount = number(row.price, row.grand_total);
    const currency = text(row.currency, "MYR").toUpperCase();
    const statuses = Array.isArray(row.statuses) ? row.statuses.join(" ") : row.status;
    return {
      externalOrderId,
      customerName: text([row.customer_first_name, row.customer_last_name].filter(Boolean).join(" "), "Lazada 구매자"),
      productName: text(row.item_name, "Lazada 주문 상품"),
      quantity: Math.max(1, Math.round(number(row.items_count) || 1)),
      amount,
      currency,
      amountKrw: currency === "KRW" ? amount : 0,
      status: status(statuses),
      orderedAt: iso(row.created_at, row.updated_at),
    };
  }).filter((row): row is NormalizedChannelOrder => Boolean(row));
}

function normalizeSmartstore(data: Record<string, unknown>) {
  const root = object(data.data);
  const rows = list(root.lastChangeStatuses).length ? list(root.lastChangeStatuses) : list(root.contents);
  return rows.map((row): NormalizedChannelOrder | null => {
    const externalOrderId = text(row.orderId, row.productOrderId);
    if (!externalOrderId) return null;
    const amount = number(row.totalPaymentAmount, row.paymentAmount);
    return {
      externalOrderId,
      customerName: text(row.ordererName, "네이버 구매자"),
      productName: text(row.productName, "스마트스토어 주문 상품"),
      quantity: Math.max(1, Math.round(number(row.quantity) || 1)),
      amount,
      currency: "KRW",
      amountKrw: amount,
      status: status(text(row.productOrderStatus, row.lastChangedType)),
      orderedAt: iso(row.paymentDate, row.lastChangedDate),
    };
  }).filter((row): row is NormalizedChannelOrder => Boolean(row));
}

function normalizeEbay(data: Record<string, unknown>) {
  return list(data.orders).map((row): NormalizedChannelOrder | null => {
    const externalOrderId = text(row.orderId);
    if (!externalOrderId) return null;
    const pricing = object(object(row.pricingSummary).total);
    const items = list(row.lineItems);
    const amount = number(pricing.value);
    const currency = text(pricing.currency, "USD").toUpperCase();
    return {
      externalOrderId,
      customerName: text(object(row.buyer).username, "eBay 구매자"),
      productName: compactProductNames(items, "eBay 주문 상품"),
      quantity: Math.max(1, Math.round(items.reduce((sum, item) => sum + number(item.quantity), 0))),
      amount,
      currency,
      amountKrw: currency === "KRW" ? amount : 0,
      status: status(`${text(row.orderPaymentStatus)} ${text(row.orderFulfillmentStatus)}`),
      orderedAt: iso(row.creationDate, row.lastModifiedDate),
    };
  }).filter((row): row is NormalizedChannelOrder => Boolean(row));
}

function normalizeQoo10(data: Record<string, unknown>) {
  const value = data.ResultObject;
  const rows = list(value).length ? list(value) : list(object(value).ShippingInfo);
  return rows.map((row): NormalizedChannelOrder | null => {
    const externalOrderId = text(row.OrderNo, row.PackNo);
    if (!externalOrderId) return null;
    const amount = number(row.OrderPrice, row.total);
    const currency = text(row.Currency, "JPY").toUpperCase();
    return {
      externalOrderId,
      customerName: text(row.BuyerName, row.Receiver, "Qoo10 구매자"),
      productName: text(row.ItemTitle, row.ItemName, "Qoo10 주문 상품"),
      quantity: Math.max(1, Math.round(number(row.OrderQty, row.Qty) || 1)),
      amount,
      currency,
      amountKrw: currency === "KRW" ? amount : 0,
      status: status(text(row.ShippingStatus, row.OrderStatus)),
      orderedAt: iso(row.OrderDate, row.PaymentDate),
    };
  }).filter((row): row is NormalizedChannelOrder => Boolean(row));
}

function normalizeElevenst(data: Record<string, unknown>) {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of list(data.orders)) {
    const orderNo = text(row.orderNo);
    if (!orderNo) continue;
    grouped.set(orderNo, [...(grouped.get(orderNo) ?? []), row]);
  }
  return [...grouped.entries()].map(([externalOrderId, rows]): NormalizedChannelOrder => {
    const perSequenceTotal = rows.reduce((sum, row) => sum + number(row.amountPerSequence), 0);
    const orderTotal = Math.max(...rows.map((row) => number(row.orderPaymentAmount)), 0);
    const itemTotal = rows.reduce((sum, row) => {
      const quantity = Math.max(1, number(row.quantity));
      return sum + number(row.unitPrice) * quantity;
    }, 0);
    const amount = perSequenceTotal > 0 ? perSequenceTotal : orderTotal > 0 ? orderTotal : itemTotal;
    const names = [...new Set(rows.map((row) => text(row.productName)).filter(Boolean))];
    const rawOrderedAt = text(rows[0]?.orderedAt);
    const orderedAt = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(rawOrderedAt)
      ? iso(`${rawOrderedAt.replace(" ", "T")}+09:00`)
      : iso(rawOrderedAt);
    return {
      externalOrderId,
      customerName: text(rows[0]?.customerName, "11번가 구매자"),
      productName: names.length > 1 ? `${names[0]} 외 ${names.length - 1}개` : names[0] || "11번가 주문 상품",
      quantity: Math.max(1, Math.round(rows.reduce((sum, row) => sum + number(row.quantity), 0))),
      amount,
      currency: "KRW",
      amountKrw: amount,
      status: "paid",
      orderedAt,
    };
  });
}

export function normalizeChannelOrders(channel: ActiveChannelKey, result: ChannelOperationResult): NormalizedChannelOrder[] {
  if (channel === "temu") {
    const normalized = result.steps
      .filter((item) => /^orders(?::\d+)?$/.test(item.name))
      .flatMap((item) => normalizeTemu(item.data));
    return [...new Map(normalized.map((order) => [order.externalOrderId, order])).values()];
  }
  const data = result.steps.find((step) => step.name === "orders")?.data ?? result.steps.at(-1)?.data ?? {};
  const normalized = channel === "coupang" ? normalizeCoupang(data)
    : channel === "shopee" ? normalizeShopee(data)
      : channel === "lazada" ? normalizeLazada(data)
        : channel === "smartstore" ? normalizeSmartstore(data)
          : channel === "ebay" ? normalizeEbay(data)
            : channel === "qoo10" ? normalizeQoo10(data)
              : channel === "elevenst" ? normalizeElevenst(data)
                : [];
  return [...new Map(normalized.map((order) => [order.externalOrderId, order])).values()];
}

export { orderSyncArguments, orderSyncRequests } from "./sync-arguments";
