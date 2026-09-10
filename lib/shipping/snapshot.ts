import { z } from "zod";
const nullableText = z.string().nullable();
const nullableNumber = z.number().nullable();
export const shippingSnapshotSchema = z.object({
  contract: z.literal("sellerpilot-shipping-snapshot/1"),
  generatedAt: z.string().datetime({ offset: true }),
  orders: z.array(
    z.object({
      id: z.string().uuid(),
      externalOrderId: z.string(),
      channelKey: z.string(),
      channelCode: z.string(),
      customerName: z.string(),
      productName: z.string(),
      quantity: z.number(),
      amount: z.number(),
      currency: z.string(),
      amountKrw: z.number(),
      status: z.enum([
        "paid",
        "ready_to_ship",
        "shipped",
        "delivered",
        "cancelled",
        "refunded",
      ]),
      orderedAt: z.string(),
      shippedAt: nullableText,
      deliveredAt: nullableText,
      lastSeenAt: z.string(),
      carrierCode: nullableText,
      trackingNumber: nullableText,
      settlementStatus: z.enum([
        "pending",
        "expected",
        "settled",
        "held",
        "disputed",
      ]),
      settlementAmount: nullableNumber,
      settlementCurrency: nullableText,
      settledAt: nullableText,
      settlementRateKrw: nullableNumber,
      referenceRateKrw: nullableNumber,
      exchangeLossPercent: nullableNumber,
      updatedAt: z.string(),
      demo: z.boolean(),
    }),
  ),
  syncStatus: z.array(
    z.object({
      channel_key: z.string(),
      data_type: z.literal("orders"),
      status: z.enum([
        "never",
        "queued",
        "running",
        "passed",
        "failed",
        "unsupported",
      ]),
      imported_count: z.number(),
      last_started_at: nullableText,
      last_succeeded_at: nullableText,
      last_error: nullableText,
      updated_at: z.string(),
    }),
  ),
  summary: z.object({
    revenue30dKrw: z.number(),
    sold30d: z.number(),
    orderCount: z.number(),
    paidOrderCount: z.number(),
    readyToShipCount: z.number(),
    settlementRiskCount: z.number(),
  }),
  channelMetrics: z.array(
    z.object({
      channelKey: z.string(),
      sold30d: z.number(),
      revenue30dKrw: z.number(),
      orderCount: z.number(),
      readyToShipCount: z.number(),
    }),
  ),
  productSales: z.array(
    z.object({
      productId: z.string().uuid(),
      sold30d: z.number(),
      revenue30dKrw: z.number(),
    }),
  ),
  analytics: z.object({
    from: z.string(),
    to: z.string(),
    summary: z.object({
      revenueKrw: z.number(),
      sold: z.number(),
      orderCount: z.number(),
    }),
    daily: z.array(
      z.object({
        date: z.string(),
        revenueKrw: z.number(),
        sold: z.number(),
        orderCount: z.number(),
        domesticRevenueKrw: z.number(),
        overseasRevenueKrw: z.number(),
        channels: z.record(z.string(), z.number()),
      }),
    ),
    channels: z.array(
      z.object({
        channelKey: z.string(),
        channelCode: z.string(),
        name: z.string(),
        market: z.string(),
        color: z.string(),
        revenueKrw: z.number(),
        sold: z.number(),
        orderCount: z.number(),
      }),
    ),
    products: z.array(
      z.object({
        productId: z.string(),
        sold: z.number(),
        revenueKrw: z.number(),
        channels: z.array(
          z.object({
            channelKey: z.string(),
            channelCode: z.string(),
            sold: z.number(),
            revenueKrw: z.number(),
          }),
        ),
      }),
    ),
  }),
});
export type ShippingSnapshot = z.infer<typeof shippingSnapshotSchema>;
export type ShippingRange = { from: string; to: string };
