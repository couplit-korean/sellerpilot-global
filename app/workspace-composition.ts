import type { OperationsSnapshot } from "./use-operations-snapshot";
import type { ShippingSnapshot } from "../lib/shipping/snapshot";
// Dashboard composition only. Neither owning workspace imports this adapter.
export function composeWorkspaceSnapshot(
  product: OperationsSnapshot | null,
  shipping: ShippingSnapshot | null,
): OperationsSnapshot | null {
  if (!product || !shipping) return product;
  const byChannel = new Map(
    shipping.channelMetrics.map((row) => [row.channelKey, row]),
  );
  const byProduct = new Map(
    shipping.productSales.map((row) => [row.productId, row]),
  );
  return {
    ...product,
    orders: shipping.orders,
    syncStatus: shipping.syncStatus,
    analytics: shipping.analytics,
    summary: { ...product.summary, ...shipping.summary },
    channelMetrics: product.channelMetrics.map((row) => ({
      ...row,
      ...byChannel.get(row.channelKey),
    })),
    products: product.products.map((row) => ({
      ...row,
      ...byProduct.get(row.id),
    })),
  };
}
