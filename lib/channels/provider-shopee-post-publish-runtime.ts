import type { ChannelOperationResult } from "./operations";
import {
  listingRemoteStateFulfillsOperation,
  listingRemoteStateMatchesOperation,
} from "./listing-publication-state";
import { readShopeeGlobalListingPublicationState } from "./provider-shopee-publication-readback";
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

function exactShopeeGlobalItemId(input: ShopeePostPublishInput) {
  const supplied = String(input.arguments.globalItemId ?? "").trim();
  const created = input.result.steps
    .filter((item) => item.name === "global-item-create")
    .map((item) => String(recordValue(item.data.response).global_item_id ?? "").trim())
    .filter(Boolean);
  const candidates = [...new Set([supplied, ...created].filter(Boolean))];
  return candidates.length === 1 ? candidates[0] : "";
}

export async function verifyShopeeGlobalListingPostPublish(
  input: ShopeePostPublishInput,
  dependencies: ShopeePostPublishDependencies = defaultDependencies,
): Promise<ChannelOperationResult> {
  const result: ChannelOperationResult = {
    ...input.result,
    steps: [...input.result.steps],
  };
  const providerStepsSucceeded = result.steps.length > 0 && result.steps.every((item) => item.ok);
  if (result.channel !== "shopee"
      || result.operation !== "listing.create"
      || input.arguments.globalProduct !== true
      || !providerStepsSucceeded
      || !result.remoteId) {
    return result;
  }

  return runWithChannelRequestSignal(input.signal, async () => {
    const globalItemId = exactShopeeGlobalItemId(input);
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

    if (result.publicationStateContract === "verified_remote_state_v1") {
      const expectedLocale = String(input.arguments.publicationExpectedLocale ?? "").trim();
      const expectedFingerprint = String(input.arguments.publicationExpectedFingerprint ?? "").trim();
      const expectedImageCount = Number(input.arguments.publicationExpectedImageCount);
      const publicationArguments = {
        ...input.arguments,
        ...(globalItemId ? { globalItemId } : {}),
      };
      const publicationVerification = await readShopeeGlobalListingPublicationState({
        merchantPayload: input.merchantCredential,
        shopPayload: input.shopCredential,
        environment: input.environment,
        operation: "listing.create",
        globalItemId,
        localItemId: result.remoteId ?? "",
        shopId: String(input.shopCredential.shop_id ?? ""),
        mutationArguments: publicationArguments,
        expectedLocale,
        expectedFingerprint,
        expectedImageCount,
      }, {
        shopRequest: async (request) => {
          await input.hooks.assertLeaseHealthy();
          const remote = await dependencies.shopeeRequest(request);
          await input.hooks.assertLeaseHealthy();
          return remote;
        },
        merchantRequest: async (request) => {
          await input.hooks.assertLeaseHealthy();
          const remote = await dependencies.shopeeMerchantRequest(request);
          await input.hooks.assertLeaseHealthy();
          return remote;
        },
      });
      result.steps.push({
        name: "global-item-publication-readback",
        ok: publicationVerification.globalIdentityVerified,
        status: publicationVerification.globalItemRemote.response.status,
        data: publicationVerification.globalItemRemote.data,
      }, {
        name: "published-linkage-publication-readback",
        ok: publicationVerification.publishedLinkageVerified,
        status: publicationVerification.publishedLinkRemote.response.status,
        data: publicationVerification.publishedLinkRemote.data,
      });
      const publicationStepOk = Boolean(publicationVerification.remoteState);
      result.steps.push({
        name: "local-item-publication-readback",
        ok: publicationStepOk,
        status: publicationVerification.localItemRemote.response.status,
        data: {
          ...publicationVerification.localItemRemote.data,
          sellerpilotPublicationVerification: publicationStepOk
            ? "SHOPEE_PUBLICATION_STATE_VERIFIED"
            : "SHOPEE_PUBLICATION_STATE_UNVERIFIED",
          providerStatus: publicationVerification.providerStatus,
          actualImageCount: publicationVerification.imageCount,
          sellerpilotPublicationChecks: publicationVerification.checks,
          sellerpilotGlobalIdentityVerified: publicationVerification.globalIdentityVerified,
          sellerpilotPublishedLinkageVerified: publicationVerification.publishedLinkageVerified,
          sellerpilotStrictCreateVerified: publicationVerification.strictCreateVerified,
        },
      });
      if (publicationVerification.remoteState) {
        result.remoteState = {
          ...publicationVerification.remoteState,
          evidence: {
            ...(result.remoteState?.evidence ?? {}),
            ...publicationVerification.remoteState.evidence,
          },
        };
        result.publicationFulfilled = listingRemoteStateFulfillsOperation(
          result.operation,
          publicationVerification.remoteState,
          result.publicationIntent,
        );
      }
      result.ok = localOk
        && publicationStepOk
        && Boolean(publicationVerification.remoteState
          && listingRemoteStateMatchesOperation(
            result.operation,
            publicationVerification.remoteState,
            result.publicationIntent,
          ));
    } else {
      result.ok = providerStepsSucceeded && localOk;
    }
    result.safeMessage = result.ok
      ? "Shopee 글로벌 상품 생성·국가별 발행·로컬 상품·재고 읽기 검증을 완료했습니다."
      : "Shopee 글로벌 상품은 발행됐지만 로컬 상품·재고 재검증이 필요합니다.";
    return result;
  });
}
