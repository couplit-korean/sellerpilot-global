import { executeCsOperation } from "./execute";
import { isCsOperation, type CsOperationResult, type CsExecuteInput } from "./contracts";
import type { ProviderExecutionInput } from "../../channels/provider-execution-contract";
import { ebayAsqOperationMarketplaceId } from "../../channels/ebay-asq";
import {
  prepareEbayAsqReplyReadback,
  runWithPreparedEbayAsqReplyReadback,
  type EbayAsqReplyBaseline,
} from "../../channels/ebay-asq-reply-readback";
import {
  temuCsAccountBindingEvidence,
  temuCsAccountBindingFailureDetail,
  type TemuCsAccountBindingEvidence,
} from "../../channels/cs/temu/account-binding";
import { isTemuBuyerChatInput, temuBuyerChatDispatchGuard } from "../../channels/cs/temu/buyer-chat-dispatch";
import { shopeeShopTargetIds } from "../../channels/target-records";
import { shopeeHistoryAuthorizationError } from "../../channels/cs/shopee/history-authorization";
import { bindShopeeMultiShopContinuation, resolveShopeeMultiShopTarget } from "../../channels/cs/shopee/multi-shop-continuation";
import { assertShopeeHistoryRecoveryArguments } from "../../channels/cs/shopee/history-recovery";
import { ensureShopeeAccessToken, ensureLazadaAccessToken, ensureEbayAccessToken, temuRequest, textValue, runWithChannelRequestSignal, runWithProviderTransportContext } from "../../channels/protocols";
import { lazadaProductReviewReplyArgumentsSchema } from "../../channels/cs/lazada/product-review-reply";
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
  const target = resolveShopeeMultiShopTarget(shopIds, arguments_);
  const { shopId, targetIndex, targetCount } = target;
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
    ? bindShopeeMultiShopContinuation(shopResult.continuation.arguments, target)
    : target.nextShopId
      ? bindShopeeMultiShopContinuation({
          ...arguments_,
          cursor: "",
          pageNo: 1,
          sellerpilotPaginationDepth: 1,
          sellerpilotPaginationEpoch: 0,
          sellerpilotPaginationTrail: [],
        }, target, target.nextShopId)
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
      ? `Shopee ${targetIndex + 1}/${targetCount} 숍의 현재 구간을 저장하고 다음 구간을 이어서 처리합니다.`
      : `Shopee ${targetCount}개 숍의 ${arguments_.kind === "return_refund" ? "반품·환불" : "상품 후기"} 조회를 완료했습니다.`,
  };
}

export async function executeCsProviderJob(input: ProviderExecutionInput, executor: ProviderExecutor = executeCsOperation): Promise<CsOperationResult> {
  const operation = input.job.operation;
  if (!isCsOperation(operation) || !(serverlessCsMatrix[operation] as ReadonlySet<string>).has(input.job.channel)) throw new Error("SERVERLESS_CS_OPERATION_NOT_ALLOWED");
  const execute = () => runWithChannelRequestSignal(input.signal, async () => {
    const raw = input.job.request.arguments;
    let arguments_ = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const lazadaReviewKind = arguments_.kind === "product_review"
      || arguments_.kind === "product_review_readback";
    if ((input.job.channel === "lazada" && lazadaReviewKind && operation !== "inquiries.reply")
        || (arguments_.kind === "product_review_readback" && input.job.channel !== "lazada")) {
      throw new Error("SERVERLESS_LAZADA_PRODUCT_REVIEW_JOB_BINDING_INVALID");
    }
    const lazadaProductReviewReadbackOnly = input.job.channel === "lazada"
      && operation === "inquiries.reply"
      && arguments_.kind === "product_review_readback";
    if (lazadaProductReviewReadbackOnly) lazadaProductReviewReplyArgumentsSchema.parse(arguments_);
    const buyerChat = isTemuBuyerChatInput({
      channel: input.job.channel,
      operation,
      arguments: arguments_,
    });
    if (buyerChat) {
      const binding = input.job.credential_binding_context;
      const guarded = temuBuyerChatDispatchGuard(({
        channel: "temu",
        operation: "inquiries.list",
        payload: {},
        arguments: arguments_,
        environment: input.job.environment,
        ...(binding?.status === "verified" ? {
          runtimeContext: {
            temuBuyerChat: {
              evidence: input.job.temu_buyer_chat_readiness_context,
              expected: {
                credentialId: input.job.credential_id,
                sellerAccountKey: binding.sellerAccountKey,
                environment: input.job.environment,
                expectedRegion: "GLOBAL",
                now: new Date().toISOString(),
              },
            },
          },
        } : {}),
      }) as unknown as Parameters<typeof temuBuyerChatDispatchGuard>[0]);
      if (guarded) return guarded;
    }
    if (input.job.channel === "shopee" && operation === "inquiries.list") {
      assertShopeeHistoryRecoveryArguments(arguments_);
    }
    const allShops = await executeAllShopeeShopInquiries(input, arguments_, executor);
    if (allShops) {
      const error = shopeeHistoryAuthorizationError(arguments_, allShops);
      if (error) throw new Error(error);
      return allShops;
    }
    let credential = input.job.credential;
    let ebayAsqReplyBaseline: EbayAsqReplyBaseline | null = null;
    let temuBinding: Extract<TemuCsAccountBindingEvidence, { status: "verified" }> | null = null;
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
      if (operation === "inquiries.list" && arguments_.kind !== "case_dispute_history") arguments_ = { ...arguments_, marketplaceId: ebayAsqOperationMarketplaceId({
        periodic: typeof input.job.request.periodicKey === "string", credentialMarketplaceId: credential.marketplace_id, requestedMarketplaceId: arguments_.marketplaceId,
      }) };
      if (operation === "inquiries.reply" && arguments_.kind !== "conversation") {
        await input.hooks.assertLeaseHealthy();
        ebayAsqReplyBaseline = await prepareEbayAsqReplyReadback({
          payload: credential,
          arguments: arguments_,
          environment: input.job.environment,
        });
        await input.hooks.assertLeaseHealthy();
      }
    }
    if (input.job.channel === "temu" && operation === "inquiries.list" && !buyerChat) {
      await input.hooks.assertLeaseHealthy();
      const accessTokenInfo = await temuRequest({
        payload: credential,
        type: "bg.open.accesstoken.info.get",
      });
      const evidence = temuCsAccountBindingEvidence({
        credential,
        environment: input.job.environment,
        accessTokenInfo: {
          ok: accessTokenInfo.response.ok,
          status: accessTokenInfo.response.status,
          data: accessTokenInfo.data,
        },
        // The claim payload carries the credential's certified seller account key;
        // use it when no explicit binding context was provided. The provenance
        // travels with it so a credential-incarnation key is never compared to
        // the provider-derived digest.
        expectedSellerAccountKey: input.job.credential_binding_context?.sellerAccountKey
          ?? (typeof input.job.seller_account_key === "string" ? input.job.seller_account_key : undefined),
        expectedSellerAccountKeySource: input.job.credential_binding_context?.sellerAccountKeySource
          ?? (typeof input.job.seller_account_key_source === "string" ? input.job.seller_account_key_source : undefined),
      });
      if (evidence.status !== "verified") {
        // The compared shapes travel with the failure so an operator can see
        // which side mismatched without any secret leaving the lane.
        const observedTemuIdentity = evidence.observedIdentity;
        throw new Error([
          "TEMU_CS_ACCOUNT_BINDING_UNAVAILABLE",
          evidence.blocker,
          temuCsAccountBindingFailureDetail(evidence),
          // The observed mall identity is a digest of the store the token belongs
          // to, not a secret, and it is required to re-certify the credential key.
          `mall=${observedTemuIdentity?.mallId ?? "unknown"}`,
          `observedKey=${observedTemuIdentity?.sellerAccountKey ?? "unknown"}`,
        ].join(":"));
      }
      temuBinding = evidence;
    }
    await input.hooks.assertLeaseHealthy();
    if (operation === "inquiries.reply" && !lazadaProductReviewReadbackOnly) {
      await input.hooks.beginProviderMutation();
      await input.hooks.assertLeaseHealthy();
    }
    const executeOperation = () => executor({
      channel: input.job.channel,
      operation,
      payload: credential,
      arguments: arguments_,
      environment: input.job.environment,
    });
    const result = ebayAsqReplyBaseline
      ? await runWithPreparedEbayAsqReplyReadback(ebayAsqReplyBaseline, executeOperation)
      : await executeOperation();
    const authorizationError = input.job.channel === "shopee" && operation === "inquiries.list" ? shopeeHistoryAuthorizationError(arguments_, result) : null;
    if (authorizationError) throw new Error(authorizationError);
    return temuBinding && result.ok ? {
      ...result,
      steps: [{
        name: "credential-binding:temu",
        ok: true,
        status: 200,
        data: temuBinding,
      }, ...result.steps],
    } : result;
  });
  return runWithProviderTransportContext({ signal: input.signal, reserve: input.hooks.reserveProviderRequest }, execute);
}
