import { executeCsOperation } from "./execute";
import { isCsOperation, type CsOperationResult, type CsExecuteInput } from "./contracts";
import type { ProviderExecutionInput } from "../../channels/provider-execution-contract";
import { ebayAsqOperationMarketplaceId } from "../../channels/ebay-asq";
import { shopeeShopTargetIds } from "../../channels/target-records";
import { shopeeHistoryAuthorizationError } from "../../channels/cs/shopee/history-authorization";
import { ensureShopeeAccessToken, ensureLazadaAccessToken, ensureEbayAccessToken, textValue, runWithChannelRequestSignal, runWithProviderTransportContext } from "../../channels/protocols";
type ProviderExecutor = (input: CsExecuteInput) => Promise<CsOperationResult>;
export const serverlessCsMatrix = {
  "inquiries.list": new Set([
    "qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay", "temu",
  ]),
  "inquiries.reply": new Set([
    "qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay",
  ]),
} as const satisfies Record<string, ReadonlySet<ProviderExecutionInput["job"]["channel"]>>;

async function executeAllShopeeShopInquiries(input: ProviderExecutionInput, arguments_: Record<string, unknown>, operationExecutor: ProviderExecutor) {
  if (input.job.channel !== "shopee" || input.job.operation !== "inquiries.list"
      || String(arguments_.shopId ?? arguments_.shop_id ?? "").trim()) return null;
  const shopIds = shopeeShopTargetIds(input.job.credential);
  if (!shopIds.length) throw new Error("SHOPEE_INQUIRY_SHOP_IDS_MISSING");
  const rawTargetIndex = arguments_.sellerpilotShopeeTargetIndex ?? 0;
  const targetIndex = typeof rawTargetIndex === "number" ? rawTargetIndex : Number(rawTargetIndex);
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= shopIds.length) {
    throw new Error("SHOPEE_INQUIRY_TARGET_INDEX_INVALID");
  }
  const shopId = shopIds[targetIndex];
  await input.hooks.assertLeaseHealthy();
  const ensured = await ensureShopeeAccessToken(
    input.job.credential,
    input.job.environment,
    10 * 60 * 1_000,
    shopId,
    input.hooks.beginCredentialMutation,
    input.hooks.stageCredentialRefresh,
    true,
  );
  await input.hooks.assertLeaseHealthy();
  const shopResult = await operationExecutor({
    channel: "shopee",
    operation: "inquiries.list",
    payload: ensured.payload,
    arguments: { ...arguments_, shopId },
    environment: input.job.environment,
  });
  if (!shopResult.ok) return shopResult;

  const continuationArguments: Record<string, unknown> | null = shopResult.continuation
    ? { ...shopResult.continuation.arguments, sellerpilotShopeeTargetIndex: targetIndex }
    : targetIndex + 1 < shopIds.length
      ? {
          ...arguments_,
          cursor: "",
          pageNo: 1,
          sellerpilotPaginationDepth: 1,
          sellerpilotPaginationEpoch: 0,
          sellerpilotPaginationTrail: [],
          sellerpilotShopeeTargetIndex: targetIndex + 1,
        }
      : null;
  if (continuationArguments) {
    delete continuationArguments.shopId;
    delete continuationArguments.shop_id;
    if (!shopResult.continuation) {
      delete continuationArguments.returnQueue;
      delete continuationArguments.nextPageNo;
    }
  }
  const { continuation: _shopContinuation, ...boundedShopResult } = shopResult;
  void _shopContinuation;
  return {
    ...boundedShopResult,
    ...(continuationArguments ? {
      continuation: {
        reason: "page_cap_reached" as const,
        arguments: continuationArguments,
      },
    } : {}),
    safeMessage: continuationArguments
      ? `Shopee ${targetIndex + 1}/${shopIds.length} 숍의 현재 구간을 저장하고 다음 구간을 이어서 처리합니다.`
      : `Shopee ${shopIds.length}개 숍의 ${arguments_.kind === "return_refund" ? "반품·환불" : "상품 후기"} 조회를 완료했습니다.`,
  };
}

export async function executeCsProviderJob(input: ProviderExecutionInput, executor: ProviderExecutor = executeCsOperation): Promise<CsOperationResult> {
  const operation = input.job.operation;
  if (!isCsOperation(operation) || !(serverlessCsMatrix[operation] as ReadonlySet<string>).has(input.job.channel)) throw new Error("SERVERLESS_CS_OPERATION_NOT_ALLOWED");
  const execute = () => runWithChannelRequestSignal(input.signal, async () => {
    const raw = input.job.request.arguments;
    let arguments_ = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const allShops = await executeAllShopeeShopInquiries(input, arguments_, executor);
    if (allShops) {
      const error = shopeeHistoryAuthorizationError(arguments_, allShops);
      if (error) throw new Error(error);
      return allShops;
    }
    let credential = input.job.credential;
    if (input.job.channel === "shopee") {
      await input.hooks.assertLeaseHealthy();
      credential = (await ensureShopeeAccessToken(credential, input.job.environment, 10 * 60_000,
        String(arguments_.shopId ?? arguments_.shop_id ?? "").trim(), input.hooks.beginCredentialMutation, input.hooks.stageCredentialRefresh, true)).payload;
    } else if (input.job.channel === "lazada") {
      await input.hooks.assertLeaseHealthy();
      credential = { ...credential, country: String(arguments_.country || textValue(credential, "country") || "my").toLowerCase() };
      credential = (await ensureLazadaAccessToken(credential, undefined, input.hooks.beginCredentialMutation, input.hooks.stageCredentialRefresh, true)).payload;
    } else if (input.job.channel === "ebay") {
      await input.hooks.assertLeaseHealthy();
      credential = (await ensureEbayAccessToken(credential, input.job.environment, undefined, input.hooks.beginCredentialMutation, input.hooks.stageCredentialRefresh, true)).payload;
      if (operation === "inquiries.list") arguments_ = { ...arguments_, marketplaceId: ebayAsqOperationMarketplaceId({
        periodic: typeof input.job.request.periodicKey === "string", credentialMarketplaceId: credential.marketplace_id, requestedMarketplaceId: arguments_.marketplaceId,
      }) };
    }
    await input.hooks.assertLeaseHealthy();
    if (operation === "inquiries.reply") { await input.hooks.beginProviderMutation(); await input.hooks.assertLeaseHealthy(); }
    const result = await executor({ channel: input.job.channel, operation, payload: credential, arguments: arguments_, environment: input.job.environment });
    const authorizationError = input.job.channel === "shopee" && operation === "inquiries.list" ? shopeeHistoryAuthorizationError(arguments_, result) : null;
    if (authorizationError) throw new Error(authorizationError);
    return result;
  });
  return runWithProviderTransportContext({ signal: input.signal, reserve: input.hooks.reserveProviderRequest }, execute);
}
