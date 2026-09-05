import "server-only";
import type { ActiveChannelKey } from "./catalog";
import type { ChannelOperationResult } from "./operations";
import { firstFiniteNonNegative } from "./normalize-value";
import { createTimestampNormalizer } from "./normalization-time";
import { lazadaShipmentItemIds } from "./shipment-draft";

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
type TimestampNormalizer = ReturnType<typeof createTimestampNormalizer>;

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

function qoo10OrderStatus(value: unknown): NormalizedChannelOrder["status"] {
  const remote = String(value ?? "").trim().toUpperCase();
  if (remote === "5") return "delivered";
  if (remote === "4") return "shipped";
  if (remote === "3") return "ready_to_ship";
  return status(remote);
}

function smartstoreOrderStatus(...values: unknown[]): NormalizedChannelOrder["status"] {
  const remote = values.map((value) => String(value ?? "").trim().toUpperCase()).filter(Boolean).join(" ");
  if (/CANCEL/.test(remote)) return "cancelled";
  if (/RETURN/.test(remote)) return "refunded";
  if (/PURCHASE_DECIDED|DELIVERED/.test(remote)) return "delivered";
  if (/DISPATCHED|DELIVERING/.test(remote)) return "shipped";
  if (/PRODUCT_PREPARE/.test(remote)) return "ready_to_ship";
  return status(remote);
}

function normalizeTemu(data: Record<string, unknown>, iso: TimestampNormalizer) {
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

function normalizeCoupang(data: Record<string, unknown>, iso: TimestampNormalizer) {
  const rows = list(data.data).length ? list(data.data) : list(object(data.data).orderSheets);
  return rows.map((row): NormalizedChannelOrder | null => {
    const cancellation = text(row.receiptType).toUpperCase() === "CANCEL" || Array.isArray(row.returnItems);
    const items = cancellation ? list(row.returnItems) : list(row.orderItems);
    // Coupang's acknowledgement, order readback, and invoice endpoints all use
    // shipmentBoxId. orderId is a different namespace and must never be sent to
    // those endpoints as a fallback.
    const externalOrderId = text(row.shipmentBoxId);
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
      providerContext: {
        shipmentBoxId: externalOrderId,
        orderId: text(row.orderId),
      },
    };
  }).filter((row): row is NormalizedChannelOrder => Boolean(row));
}

function normalizeShopee(data: Record<string, unknown>, iso: TimestampNormalizer) {
  const response = object(data.response);
  const credentialContext = object(data.sellerpilotProviderContext);
  const rows = list(response.order_list);
  return rows.map((row): NormalizedChannelOrder | null => {
    const externalOrderId = text(row.order_sn, row.order_id);
    if (!externalOrderId) return null;
    const amount = number(row.total_amount);
    const currency = text(row.currency, "KRW").toUpperCase();
    const shopId = text(row.shop_id, row.shopId, response.shop_id, data.shop_id, credentialContext.shopId);
    const merchantId = text(credentialContext.merchantId);
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
      providerContext: {
        orderSn: externalOrderId,
        ...(shopId ? { shopId } : {}),
        ...(merchantId ? { merchantId } : {}),
      },
    };
  }).filter((row): row is NormalizedChannelOrder => Boolean(row));
}

function normalizeLazada(data: Record<string, unknown>, iso: TimestampNormalizer, steps: ChannelOperationResult["steps"] = []) {
  const rows = list(object(data.data).orders);
  const itemDetails = steps.filter((item) => item.name.startsWith("order-items:"));
  // Inspect every successful detail page in the received batch, not just the
  // current order page. An item identity cannot belong to two different orders.
  const itemOwners = new Map<string, Set<string>>();
  for (const detail of itemDetails.filter((item) => item.ok)) {
    const orderId = detail.name.slice("order-items:".length).trim();
    if (!orderId) continue;
    for (const item of list(detail.data.data)) {
      let itemId: string;
      try {
        [itemId] = lazadaShipmentItemIds([item.order_item_id]);
      } catch {
        continue;
      }
      const owners = itemOwners.get(itemId) ?? new Set<string>();
      owners.add(orderId);
      itemOwners.set(itemId, owners);
    }
  }
  const conflictingOrders = new Set([...itemOwners.values()]
    .filter((owners) => owners.size > 1).flatMap((owners) => [...owners]));
  return rows.map((row): NormalizedChannelOrder | null => {
    const externalOrderId = text(row.order_id, row.order_number);
    if (!externalOrderId) return null;
    const amount = number(row.price, row.grand_total);
    const currency = text(row.currency, "MYR").toUpperCase();
    const statuses = Array.isArray(row.statuses) ? row.statuses.join(" ") : row.status;
    const details = itemDetails.filter((item) => item.name === `order-items:${externalOrderId}`);
    const rawItems = details.length === 1 && details[0].ok ? details[0].data.data : undefined;
    let items = list(rawItems);
    let orderItemIds: string[] = [];
    let deliveryType = "";
    try {
      // Inspect the unfiltered response. A malformed row must not disappear
      // before identity validation, including array holes and duplicate IDs.
      if (conflictingOrders.has(externalOrderId)) throw new Error("conflicting item ownership");
      if (!Array.isArray(rawItems) || rawItems.length !== items.length) throw new Error("invalid items");
      orderItemIds = lazadaShipmentItemIds(items.map((item) => item.order_item_id));
      if (row.items_count !== undefined && row.items_count !== null) {
        const count = typeof row.items_count === "number" || typeof row.items_count === "string"
          ? Number(row.items_count) : NaN;
        if (!Number.isSafeInteger(count) || count !== items.length) throw new Error("incomplete items");
      }
      if (items.some((item) => item.order_id !== undefined && text(item.order_id) !== externalOrderId)) {
        throw new Error("wrong order items");
      }
      const deliveryTypes = items.map((item) => {
        const value = typeof item.shipping_type === "string" ? item.shipping_type.trim().toLowerCase() : "";
        return value.includes("drop") ? "dropship" : value;
      });
      deliveryType = deliveryTypes[0];
      if (!deliveryType || deliveryTypes.some((value) => value !== deliveryType)) throw new Error("ambiguous delivery type");
      // JSONB's text form adds separator whitespace. Leave headroom below the
      // 32768-byte storage guard for this bounded, at-most-100-item object.
      if (Buffer.byteLength(JSON.stringify({ orderId: externalOrderId, orderItemIds, deliveryType }), "utf8") > 32000) {
        throw new Error("provider context too large");
      }
    } catch {
      // Persist an explicit, small object so the storage RPC replaces any older
      // actionable context. Missing/oversized context would retain stale IDs.
      // Invalid details are also forbidden as display/quantity evidence.
      items = [];
      orderItemIds = [];
      deliveryType = "";
    }
    return {
      externalOrderId,
      customerName: text([row.customer_first_name, row.customer_last_name].filter(Boolean).join(" "), "Lazada 구매자"),
      productName: compactProductNames(items, text(row.item_name, "Lazada 주문 상품")),
      quantity: Math.max(1, Math.round(items.length || number(row.items_count) || 1)),
      amount,
      currency,
      amountKrw: currency === "KRW" ? amount : 0,
      status: status(statuses),
      orderedAt: iso(row.created_at, row.updated_at),
      providerContext: {
        orderId: externalOrderId,
        orderItemIds,
        deliveryType,
      },
    };
  }).filter((row): row is NormalizedChannelOrder => Boolean(row));
}

function normalizeSmartstore(data: Record<string, unknown>, iso: TimestampNormalizer) {
  const nested = object(data.data);
  const root = Object.keys(nested).length ? nested : data;
  const rows = list(root.lastChangeStatuses).length ? list(root.lastChangeStatuses) : list(root.contents);
  return rows.map((row): NormalizedChannelOrder | null => {
    // Confirm, detail, and dispatch are product-order scoped. The parent
    // orderId is not accepted as a safe substitute for productOrderId.
    const externalOrderId = text(row.productOrderId);
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
      status: smartstoreOrderStatus(row.productOrderStatus, row.lastChangedType),
      orderedAt: iso(row.paymentDate, row.lastChangedDate),
      providerContext: {
        productOrderId: externalOrderId,
        orderId: text(row.orderId),
      },
    };
  }).filter((row): row is NormalizedChannelOrder => Boolean(row));
}

function ebayOrderStatus(row: Record<string, unknown>): NormalizedChannelOrder["status"] {
  if (row.orderPaymentStatus === "FULLY_REFUNDED") return "refunded";
  if (object(row.cancelStatus).cancelState === "CANCELED") return "cancelled";
  if (row.orderFulfillmentStatus === "FULFILLED") return "shipped";
  return status(`${text(row.orderPaymentStatus)} ${text(row.orderFulfillmentStatus)}`);
}

function normalizeEbay(data: Record<string, unknown>, iso: TimestampNormalizer) {
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
      status: ebayOrderStatus(row),
      orderedAt: iso(row.creationDate, row.lastModifiedDate),
      providerContext: {
        orderId: externalOrderId,
        // Keep every line, including incomplete ones, so the shipment contract
        // fails closed instead of silently dropping an unrecognized item.
        lineItems: items.map((item) => ({ lineItemId: text(item.lineItemId), quantity: item.quantity })),
      },
    };
  }).filter((row): row is NormalizedChannelOrder => Boolean(row));
}

function normalizeQoo10(data: Record<string, unknown>, iso: TimestampNormalizer) {
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
      status: qoo10OrderStatus(text(row.ShippingStatus, row.OrderStatus)),
      orderedAt: iso(row.OrderDate, row.PaymentDate),
    };
  }).filter((row): row is NormalizedChannelOrder => Boolean(row));
}

function normalizeElevenst(data: Record<string, unknown>, iso: TimestampNormalizer) {
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

export function normalizeChannelOrders(
  channel: ActiveChannelKey,
  result: ChannelOperationResult,
  normalizationTimestamp: string,
): NormalizedChannelOrder[] {
  const iso = createTimestampNormalizer(normalizationTimestamp);
  const orderSteps = result.steps.filter((item) => item.ok && /^orders(?::\d+)?$/.test(item.name));
  const pageData = orderSteps.length
    ? orderSteps.map((item) => item.data)
    : [result.steps.at(-1)?.data ?? {}];
  const normalized = pageData.flatMap((data) => channel === "temu" ? normalizeTemu(data, iso)
    : channel === "coupang" ? normalizeCoupang(data, iso)
      : channel === "shopee" ? normalizeShopee(data, iso)
        : channel === "lazada" ? normalizeLazada(data, iso, result.steps)
          : channel === "smartstore" ? normalizeSmartstore(data, iso)
            : channel === "ebay" ? normalizeEbay(data, iso)
              : channel === "qoo10" ? normalizeQoo10(data, iso)
                : channel === "elevenst" ? normalizeElevenst(data, iso)
                  : []);
  return [...new Map(normalized.map((order) => [order.externalOrderId, order])).values()];
}

export { orderSyncArguments, orderSyncRequests } from "./sync-arguments";
