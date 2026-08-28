import type { ChannelOperationResult } from "./operations";
import {
  runWithChannelRequestSignal,
  shopeeMerchantRequest,
  shopeeRequest,
  type SecretPayload,
} from "./protocols";

type ShopeePostPublishHooks = {
  assertLeaseHealthy: () => Promise<void>;
  beginProviderMutation: () => Promise<void>;
};

type ShopeePostPublishInput = {
  result: ChannelOperationResult;
  merchantCredential: SecretPayload;
  shopCredential: SecretPayload;
  arguments: Record<string, unknown>;
  environment: "sandbox" | "production";
  signal: AbortSignal;
  hooks: ShopeePostPublishHooks;
};

export type ShopeePostPublishDependencies = {
  shopeeRequest: typeof shopeeRequest;
  shopeeMerchantRequest: typeof shopeeMerchantRequest;
};

const defaultDependencies: ShopeePostPublishDependencies = {
  shopeeRequest,
  shopeeMerchantRequest,
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requestedListingStock(arguments_: Record<string, unknown>) {
  const publish = recordValue(arguments_.publish);
  const item = recordValue(publish.item);
  const sellerStock = Array.isArray(item.seller_stock)
    ? recordValue(item.seller_stock[0])
    : {};
  const value = sellerStock.stock ?? item.normal_stock;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function localAvailableStock(data: Record<string, unknown>) {
  const response = recordValue(data.response);
  const items = Array.isArray(response.item_list) ? response.item_list : [];
  const item = recordValue(items[0]);
  const stockInfo = recordValue(item.stock_info_v2);
  const summary = recordValue(stockInfo.summary_info);
  const value = Number(summary.total_available_stock);
  return Number.isFinite(value) ? value : null;
}

function globalAvailableStock(data: Record<string, unknown>) {
  const response = recordValue(data.response);
  const items = Array.isArray(response.global_item_list) ? response.global_item_list : [];
  const item = recordValue(items[0]);
  const stocks = Array.isArray(item.stock_info) ? item.stock_info : [];
  if (!stocks.length) return null;
  return stocks.reduce((total, stock) => {
    const value = Number(recordValue(stock).normal_stock ?? 0);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
}

export async function verifyShopeeGlobalListingPostPublish(
  input: ShopeePostPublishInput,
  dependencies: ShopeePostPublishDependencies = defaultDependencies,
): Promise<ChannelOperationResult> {
  const result: ChannelOperationResult = {
    ...input.result,
    steps: [...input.result.steps],
  };
  if (result.channel !== "shopee"
      || result.operation !== "listing.create"
      || input.arguments.globalProduct !== true
      || !result.ok
      || !result.remoteId) {
    return result;
  }

  return runWithChannelRequestSignal(input.signal, async () => {
    const readLocalItem = async () => {
      await input.hooks.assertLeaseHealthy();
      const remote = await dependencies.shopeeRequest({
        payload: input.shopCredential,
        environment: input.environment,
        method: "GET",
        path: "/api/v2/product/get_item_base_info",
        query: new URLSearchParams({ item_id_list: result.remoteId ?? "" }),
      });
      await input.hooks.assertLeaseHealthy();
      return remote;
    };
    const requestedStock = requestedListingStock(input.arguments);
    let localReadback = await readLocalItem();
    let localOk = localReadback.response.ok && !localReadback.data.error;
    result.steps.push({
      name: "local-item-readback-initial",
      ok: localOk,
      status: localReadback.response.status,
      data: localReadback.data,
    });

    if (localOk
        && requestedStock !== null
        && localAvailableStock(localReadback.data) !== requestedStock) {
      await input.hooks.assertLeaseHealthy();
      await input.hooks.beginProviderMutation();
      await input.hooks.assertLeaseHealthy();
      const stockRemote = await dependencies.shopeeRequest({
        payload: input.shopCredential,
        environment: input.environment,
        method: "POST",
        path: "/api/v2/product/update_stock",
        body: {
          item_id: Number(result.remoteId),
          stock_list: [{ seller_stock: [{ stock: requestedStock }] }],
        },
      });
      await input.hooks.assertLeaseHealthy();
      const failures = recordValue(stockRemote.data.response).failure_list;
      let stockOk = stockRemote.response.ok
        && !stockRemote.data.error
        && (!Array.isArray(failures) || failures.length === 0);
      result.steps.push({
        name: "local-stock-reconcile",
        ok: stockOk,
        status: stockRemote.response.status,
        data: stockRemote.data,
      });

      const cbscGlobalStockOnly = stockRemote.data.error === "product.cnsc_shop_block";
      if (!stockOk && cbscGlobalStockOnly) {
        const globalItemId = String(input.arguments.globalItemId ?? "").trim();
        if (globalItemId) {
          await input.hooks.assertLeaseHealthy();
          const globalStockRemote = await dependencies.shopeeMerchantRequest({
            payload: input.merchantCredential,
            environment: input.environment,
            method: "GET",
            path: "/api/v2/global_product/get_global_item_info",
            query: new URLSearchParams({ global_item_id_list: globalItemId }),
          });
          await input.hooks.assertLeaseHealthy();
          stockOk = globalStockRemote.response.ok
            && !globalStockRemote.data.error
            && globalAvailableStock(globalStockRemote.data) === requestedStock;
          result.steps.push({
            name: "global-stock-readback",
            ok: stockOk,
            status: globalStockRemote.response.status,
            data: globalStockRemote.data,
          });
          if (stockOk) result.steps[result.steps.length - 2].ok = true;
        }
      }

      if (stockOk && !cbscGlobalStockOnly) {
        localReadback = await readLocalItem();
        localOk = localReadback.response.ok
          && !localReadback.data.error
          && localAvailableStock(localReadback.data) === requestedStock;
        result.steps.push({
          name: "local-item-readback-final",
          ok: localOk,
          status: localReadback.response.status,
          data: localReadback.data,
        });
      } else {
        localOk = stockOk;
      }
    } else if (localOk && requestedStock !== null) {
      localOk = localAvailableStock(localReadback.data) === requestedStock;
      result.steps[result.steps.length - 1].ok = localOk;
    }

    result.ok = result.ok && localOk;
    result.safeMessage = result.ok
      ? "Shopee 글로벌 상품 생성·국가별 발행·로컬 상품·재고 읽기 검증을 완료했습니다."
      : "Shopee 글로벌 상품은 발행됐지만 로컬 상품·재고 재검증이 필요합니다.";
    return result;
  });
}
