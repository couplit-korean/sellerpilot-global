import { assertNoRetiredProductRecovery } from "./retired-product-recovery";
import { runChannelDiagnostic, type ChannelDiagnostic } from "../channel-diagnostics";
import { searchElevenstProductVariants, type CompetitorPriceCandidate } from "../competitor-prices";
import { assertEbayListingCreateConfiguration } from "./ebay-listing-configuration";
import { assertEbayCreatePublicationContract } from "./ebay-create-preflight";
import type { GatewayClaim } from "./gateway-contract";
import { executeProviderListingLineageVerification, type ProviderListingLineageVerificationResult } from "./listing-lineage-verification";
import { assertListingPublicationSourceLocalized, listingPublicationProviderAssetEvidence, parseListingPublicationAssetBinding } from "./listing-publication-content";
import { verifiedListingRemoteStateSchema } from "./listing-publication-state";
import { executeChannelOperation, writeChannelOperations, type ChannelOperationName, type ChannelOperationResult } from "./commerce-operations";
import { listingPublicationVerificationSourceSchema } from "./listing-publication-verification";
import { assertShopeeShopProfileTarget, readProviderAccountIdentity } from "./provider-account-identity";
import {
  sameShopeeShopIdentity,
  shopeeShopIdentityForShop,
  shopeeShopIdentityFromVerifiedProfile,
  withShopeeShopIdentity,
} from "./shopee-shop-identity";
import { ensureEbayAccessToken, ensureLazadaAccessToken, ensureShopeeAccessToken, ensureShopeeMerchantAccessToken, fetchNaverAccessToken, lazadaRequest, readStoredNaverAccessToken, runWithProviderReadOnlyTransport, runWithProviderTransportContext, runWithChannelRequestSignal, shopeeRequest, textValue, type SecretPayload } from "./protocols";
import { executeProviderOAuthExchange, type ProviderOAuthClaim, type ProviderOAuthResult } from "./provider-oauth-runtime";
import { prepareMarketplaceListingArguments } from "./provider-listing-runtime";
import { verifyShopeeGlobalListingPostPublish } from "./provider-shopee-post-publish-runtime";
import { channelPriceUpdateRelease } from "./price-update-release";
import { qoo10S1ActivationArgument, qoo10S1ActivationArgumentsValid } from "./qoo10-listing-activation";
import { qoo10DurableCreateFulfillmentBinding } from "../server-qoo10-listing-create-fulfillment-source";
import { temuActivationBinding, temuContainmentDiscoveryBinding } from "./provider-temu-publication-readback";
import { executeCoupangDurableCreateReconciliation, type CoupangDurableCreateReconciliationArguments, type CoupangDurableCreateReconciliationResult } from "../product-registration/coupang/durable-create-reconciliation";
import { shopeeSgListingCreateRequested } from "./shopee-sg-listing-create";
import {
  assertSmartstoreCreateTransport,
  smartstoreCreateBodyBindingSha256,
  smartstoreCreateTransportArgument,
  smartstoreCreateTransportStageArgument,
} from "./smartstore-create-transport";
import {
  applyLazadaGatewayCreateProviderResult,
  lazadaGatewayCreateReceiptKindFromArguments,
} from "../product-registration/lazada/my-create-gateway-receipt";
const serverlessWriteMatrix = {
  "listing.create": new Set([
    "qoo10", "shopee", "lazada", "coupang", "elevenst", "temu", "smartstore", "ebay",
  ]),
  "listing.update": new Set([
    "qoo10", "shopee", "lazada", "coupang", "elevenst", "temu", "smartstore", "ebay",
  ]),
  "listing.stop": new Set([
    "qoo10", "shopee", "lazada", "coupang", "elevenst", "temu", "smartstore",
  ]),
  "listing.activate": new Set(["qoo10", "temu"]),
  "inventory.update": new Set([
    "qoo10", "shopee", "lazada", "coupang", "temu", "smartstore", "ebay",
  ]),
} as const satisfies Record<string, ReadonlySet<GatewayClaim["channel"]>>;
const allServerlessChannels = new Set<GatewayClaim["channel"]>([
  "qoo10", "shopee", "lazada", "coupang", "elevenst", "temu", "smartstore", "ebay",
]);
const serverlessReadMatrix = {
  "categories.list": allServerlessChannels,
  "categories.suggest": allServerlessChannels,
  "categories.attributes": allServerlessChannels,
  "categories.validate": allServerlessChannels,
  "listing.publication.verify": new Set([
    "qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay", "temu",
  ]),
} as const satisfies Record<string, ReadonlySet<GatewayClaim["channel"]>>;
const serverlessOAuthChannels = new Set<GatewayClaim["channel"]>(["shopee", "lazada", "ebay"]);
const serverlessShopDiscoveryChannels = new Set<GatewayClaim["channel"]>(["shopee", "lazada"]);
const serverlessLineageChannels = new Set<GatewayClaim["channel"]>(["qoo10", "shopee", "lazada", "coupang", "ebay"]);
export const SERVERLESS_GATEWAY_WRITE_MATRIX = serverlessWriteMatrix;
export const SERVERLESS_GATEWAY_READ_MATRIX = serverlessReadMatrix;
export type { ServerlessGatewayExecutionHooks } from "./provider-execution-contract";
import type { ServerlessGatewayExecutionHooks } from "./provider-execution-contract";
type ServerlessDiagnosticResult = {
  ok: boolean;
  channel: GatewayClaim["channel"];
  operation: "diagnostic.test";
  diagnostic: ChannelDiagnostic;
  safeMessage: string;
};
type ServerlessShopDiscoveryResult = {
  ok: boolean;
  channel: "shopee" | "lazada";
  operation: "shops.get";
  steps: ChannelOperationResult["steps"];
  safeMessage: string;
};
type ServerlessCompetitorSearchResult = {
  ok: true;
  channel: "elevenst";
  operation: "competitor.search";
  items: CompetitorPriceCandidate[];
  safeMessage: string;
};
export type ServerlessGatewayProviderResult = ChannelOperationResult
  | ProviderOAuthResult
  | ServerlessDiagnosticResult
  | ServerlessShopDiscoveryResult
  | ServerlessCompetitorSearchResult
  | CoupangDurableCreateReconciliationResult
  | ProviderListingLineageVerificationResult;
export type ServerlessGatewayProviderExecutionInput = {
  job: GatewayClaim;
  signal: AbortSignal;
  hooks: ServerlessGatewayExecutionHooks;
  elevenstCredentialVersion?: number;
};
type ProviderExecutor = typeof executeChannelOperation;
function requestArguments(job: GatewayClaim) {
  const value = job.request.arguments;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
export function serverlessGatewayOperationAllowed(channel: GatewayClaim["channel"], operation: GatewayClaim["operation"]) {
  if (operation === "inquiries.list" || operation === "inquiries.reply") return false;
  if (operation === "oauth.exchange") return serverlessOAuthChannels.has(channel);
  if (operation === "price.update") return channelPriceUpdateRelease(channel).available;
  if (operation === "diagnostic.test") return allServerlessChannels.has(channel);
  if (operation === "shops.get") return serverlessShopDiscoveryChannels.has(channel);
  if (operation === "competitor.search") return false;
  if (operation === "listing.lineage.verify") return serverlessLineageChannels.has(channel);
  if (operation in serverlessWriteMatrix) {
    return (serverlessWriteMatrix[
      operation as keyof typeof serverlessWriteMatrix
    ] as ReadonlySet<GatewayClaim["channel"]>).has(channel);
  }
  if (operation in serverlessReadMatrix) {
    return (serverlessReadMatrix[
      operation as keyof typeof serverlessReadMatrix
    ] as ReadonlySet<GatewayClaim["channel"]>).has(channel);
  }
  return false;
}
function channelOperation(operation: GatewayClaim["operation"]): operation is ChannelOperationName {
  return operation !== "inquiries.list" && operation !== "inquiries.reply" && operation !== "oauth.exchange"
    && operation !== "shops.get"
    && operation !== "diagnostic.test"
    && operation !== "competitor.search"
    && operation !== "listing.lineage.verify";
}
async function prepareCredential(input: ServerlessGatewayProviderExecutionInput, operationArguments: Record<string, unknown>) {
  let credential: SecretPayload = input.job.credential;
  let shopeeShopCredential: SecretPayload | undefined;
  const arguments_ = operationArguments;
  const publicationReadOnly = input.job.operation === "listing.publication.verify";
  const shopeeCategoryRead = input.job.channel === "shopee"
    && (
      input.job.operation === "categories.list"
      || input.job.operation === "categories.suggest"
      || input.job.operation === "categories.attributes"
      || input.job.operation === "categories.validate"
    );
  const shopeeAccessBufferMs = shopeeCategoryRead ? 0 : 10 * 60 * 1000;
  const publicationSource = publicationReadOnly
    ? listingPublicationVerificationSourceSchema.safeParse(operationArguments.sellerpilotPublicationSource)
    : null;
  const publicationSourceArguments = publicationSource?.success
    ? publicationSource.data.sourceArguments
    : {};
  const readOnlyCredentialRefreshBlocked = async () => {
    throw new Error("LISTING_PUBLICATION_VERIFY_CREDENTIAL_REFRESH_REQUIRED");
  };
  const shopeeCategoryReadRefreshBlocked = async () => {
    throw new Error("SHOPEE_CATEGORY_READ_TOKEN_REFRESH_BLOCKED");
  };
  const refreshHooks = publicationReadOnly
    ? {
      onExternalMutationStart: readOnlyCredentialRefreshBlocked,
      onCredentialRefresh: readOnlyCredentialRefreshBlocked,
    }
    : shopeeCategoryRead
      ? {
        onExternalMutationStart: shopeeCategoryReadRefreshBlocked,
        onCredentialRefresh: shopeeCategoryReadRefreshBlocked,
      }
      : {
        onExternalMutationStart: input.hooks.beginCredentialMutation,
        onCredentialRefresh: input.hooks.stageCredentialRefresh,
      };
  if (input.job.channel === "shopee") {
    if (publicationReadOnly && !readProviderAccountIdentity(credential, "shopee")) {
      throw new Error("PROVIDER_ACCOUNT_IDENTITY_MISSING");
    }
    const sourceRemoteState = publicationSource?.success
      ? recordValue(publicationSource.data.sourceResponsePayload.remoteState)
      : {};
    const sourceResources = recordValue(sourceRemoteState.resources);
    const globalProduct = arguments_.globalProduct === true
      || publicationSourceArguments.globalProduct === true
      || Boolean(String(sourceResources.globalItemId ?? "").trim());
    if (globalProduct) {
      if (input.job.operation === "listing.create" || publicationReadOnly) {
        const sourcePublish = publicationSourceArguments.publish
          && typeof publicationSourceArguments.publish === "object"
          && !Array.isArray(publicationSourceArguments.publish)
          ? publicationSourceArguments.publish as Record<string, unknown>
          : {};
        const publish = arguments_.publish && typeof arguments_.publish === "object"
          && !Array.isArray(arguments_.publish)
          ? arguments_.publish as Record<string, unknown>
          : sourcePublish;
        const shopId = String((sourceResources.shopId
          ?? publish.shop_id
          ?? arguments_.shopId
          ?? arguments_.shop_id) ?? "").trim();
        await input.hooks.assertLeaseHealthy();
        const shopEnsured = await ensureShopeeAccessToken(credential, input.job.environment, shopeeAccessBufferMs, shopId, refreshHooks.onExternalMutationStart, refreshHooks.onCredentialRefresh, !publicationReadOnly && !shopeeCategoryRead);
        shopeeShopCredential = shopEnsured.payload;
        if (!publicationReadOnly) credential = shopEnsured.payload;
      }
      const merchantId = String(publicationSourceArguments.merchantId
        ?? publicationSourceArguments.merchant_id
        ?? arguments_.merchantId
        ?? arguments_.merchant_id
        ?? "").trim();
      await input.hooks.assertLeaseHealthy();
      const merchantEnsured = await ensureShopeeMerchantAccessToken(credential, input.job.environment, shopeeAccessBufferMs, merchantId, refreshHooks.onExternalMutationStart, refreshHooks.onCredentialRefresh, !publicationReadOnly && !shopeeCategoryRead);
      credential = merchantEnsured.payload;
    }
    else {
      const shopId = String(arguments_.shopId ?? arguments_.shop_id ?? "").trim();
      await input.hooks.assertLeaseHealthy();
      const ensured = await ensureShopeeAccessToken(credential, input.job.environment, shopeeAccessBufferMs, shopId, refreshHooks.onExternalMutationStart, refreshHooks.onCredentialRefresh, !publicationReadOnly && !shopeeCategoryRead);
      credential = ensured.payload;
    }
  }
  else if (input.job.channel === "smartstore") {
    const storedAccessToken = readStoredNaverAccessToken(credential, 10 * 60 * 1000);
    if (publicationReadOnly) {
      if (!storedAccessToken) {
        throw new Error("LISTING_PUBLICATION_VERIFY_CREDENTIAL_REFRESH_REQUIRED");
      }
    } else if ((input.job.operation === "listing.create"
      || input.job.operation === "listing.update")
      && !storedAccessToken) {
      await input.hooks.assertLeaseHealthy();
      await input.hooks.beginCredentialMutation();
      const token = await fetchNaverAccessToken(credential);
      credential = {
        ...credential,
        access_token: token.accessToken,
        access_token_expires_at: token.expiresAt,
      };
      await input.hooks.stageCredentialRefresh({
        payload: credential,
        expiresAt: null,
      });
    }
  }
  else if (input.job.channel === "lazada") {
    const country = String(arguments_.country || textValue(credential, "country") || "my")
      .toLowerCase();
    credential = { ...credential, country };
    await input.hooks.assertLeaseHealthy();
    const ensured = await ensureLazadaAccessToken(credential, undefined, refreshHooks.onExternalMutationStart, refreshHooks.onCredentialRefresh, true);
    credential = ensured.payload;
  }
  else if (input.job.channel === "ebay") {
    if (publicationReadOnly && !readProviderAccountIdentity(credential, "ebay")) {
      throw new Error("PROVIDER_ACCOUNT_IDENTITY_MISSING");
    }
    await input.hooks.assertLeaseHealthy();
    const ensured = await ensureEbayAccessToken(credential, input.job.environment, undefined, refreshHooks.onExternalMutationStart, refreshHooks.onCredentialRefresh, !publicationReadOnly);
    credential = ensured.payload;
  }
  return { credential, arguments_, shopeeShopCredential };
}
async function executeDiagnostic(input: ServerlessGatewayProviderExecutionInput) {
  const prepared = await prepareCredential(input, requestArguments(input.job));
  if (input.job.channel === "ebay"
    && !readProviderAccountIdentity(prepared.credential, "ebay")) {
    throw new Error("PROVIDER_ACCOUNT_IDENTITY_MISSING");
  }
  await input.hooks.assertLeaseHealthy();
  const diagnostic = await runChannelDiagnostic(input.job.channel, prepared.credential, input.job.environment);
  await input.hooks.assertLeaseHealthy();
  return {
    ok: diagnostic.status !== "failed",
    channel: input.job.channel,
    operation: "diagnostic.test" as const,
    diagnostic,
    safeMessage: diagnostic.message,
  };
}
/**
 * A successful verified discovery is the only place that observes the shop's market
 * and display name. Persisting that identity on the credential payload keeps the SG
 * listing fences usable after later token rotations, which the discovery ledger
 * (bound to one credential version) cannot do on its own.
 *
 * Fail-closed: nothing is written unless the provider returned a supported market and
 * a display name, and the credential already carries an attested provider subject that
 * the credential refresh RPCs require. A failed write never hides a successful read.
 */
async function persistShopeeShopIdentity(
  input: ServerlessGatewayProviderExecutionInput,
  evidence: { payload: SecretPayload; profile: unknown; shopId: string },
) {
  const identity = shopeeShopIdentityFromVerifiedProfile({
    profile: evidence.profile,
    shopId: evidence.shopId,
    verifiedAt: new Date().toISOString(),
  });
  if (!identity) return;
  try {
    if (!readProviderAccountIdentity(evidence.payload, "shopee")) return;
    if (sameShopeeShopIdentity(shopeeShopIdentityForShop(evidence.payload, identity.shopId), identity)) return;
    await input.hooks.beginCredentialMutation();
    await input.hooks.stageCredentialRefresh({
      payload: withShopeeShopIdentity(evidence.payload, identity),
      expiresAt: textValue(evidence.payload, "authorization_expires_at") || null,
    });
  } catch (error) {
    console.error("shopee shop identity persist failed", {
      code: error instanceof Error ? error.message : "unknown",
      shopId: identity.shopId,
      marketCode: identity.marketCode,
    });
  }
}

async function executeShopDiscovery(input: ServerlessGatewayProviderExecutionInput) {
  if (input.job.channel === "shopee") {
    const shopId = String(input.job.request.shopId ?? "").trim();
    await input.hooks.assertLeaseHealthy();
    const ensured = await ensureShopeeAccessToken(input.job.credential, input.job.environment, 10 * 60 * 1000, shopId, input.hooks.beginCredentialMutation, input.hooks.stageCredentialRefresh, true);
    await input.hooks.assertLeaseHealthy();
    const remote = await shopeeRequest({
      payload: ensured.payload,
      environment: input.job.environment,
      method: "GET",
      path: "/api/v2/shop/get_shop_info",
    });
    await input.hooks.assertLeaseHealthy();
    const providerError = textValue(remote.data, "error");
    const ok = remote.response.ok && !providerError;
    if (ok) {
      assertShopeeShopProfileTarget(remote.data, shopId, { acceptSignedRequestBinding: true });
      await persistShopeeShopIdentity(input, { payload: ensured.payload, profile: remote.data, shopId });
      await input.hooks.assertLeaseHealthy();
    }
    return {
      ok,
      channel: "shopee" as const,
      operation: "shops.get" as const,
      steps: [{
        name: "shop-info",
        ok,
        status: remote.response.status,
        data: remote.data,
      }],
      safeMessage: ok
        ? "Shopee 판매자 대상 정보를 확인했습니다."
        : "Shopee 판매자 대상 조회가 원격 오류로 종료됐습니다.",
    };
  }
  if (input.job.channel === "lazada") {
    await input.hooks.assertLeaseHealthy();
    const ensured = await ensureLazadaAccessToken(input.job.credential, undefined, input.hooks.beginCredentialMutation, input.hooks.stageCredentialRefresh, true);
    const country = String(input.job.request.country || textValue(ensured.payload, "country") || "my").toLowerCase();
    await input.hooks.assertLeaseHealthy();
    const remote = await lazadaRequest({
      payload: { ...ensured.payload, country },
      path: "/seller/get",
    });
    await input.hooks.assertLeaseHealthy();
    const providerCode = String(remote.data.code ?? "");
    const providerError = textValue(remote.data, "error");
    const ok = remote.response.ok && !providerError && (!providerCode || providerCode === "0");
    return {
      ok,
      channel: "lazada" as const,
      operation: "shops.get" as const,
      steps: [{
        name: "seller-info",
        ok,
        status: remote.response.status,
        data: remote.data,
      }],
      safeMessage: ok
        ? "Lazada 판매자 대상 정보를 확인했습니다."
        : "Lazada 판매자 대상 조회가 원격 오류로 종료됐습니다.",
    };
  }
  throw new Error("SERVERLESS_GATEWAY_OPERATION_NOT_ALLOWED");
}
async function executeCompetitorSearch(input: ServerlessGatewayProviderExecutionInput) {
  if (input.job.channel !== "elevenst") {
    throw new Error("SERVERLESS_GATEWAY_OPERATION_NOT_ALLOWED");
  }
  const primary = String(input.job.request.primary ?? "")
    .replace(/\p{Cc}/gu, " ")
    .trim()
    .slice(0, 160);
  const aliases = Array.isArray(input.job.request.aliases)
    ? input.job.request.aliases
      .filter((alias): alias is string => typeof alias === "string")
      .map((alias) => alias.replace(/\p{Cc}/gu, " ").trim().slice(0, 160))
      .filter((alias) => alias.length >= 2)
      .slice(0, 12)
    : [];
  const displayPerQuery = Math.max(1, Math.min(30, Number(input.job.request.displayPerQuery ?? 30) || 30));
  if (primary.length < 2) throw new Error("COMPETITOR_SEARCH_ARGUMENT_INVALID");
  await input.hooks.assertLeaseHealthy();
  const items = await searchElevenstProductVariants(primary, aliases, { apiKey: textValue(input.job.credential, "api_key") }, displayPerQuery);
  if (items.some((item) => item.provider !== "elevenst_product_search"
    || item.marketplace !== "elevenst"
    || item.currency !== "KRW")) {
    throw new Error("COMPETITOR_SEARCH_RESULT_INVALID");
  }
  await input.hooks.assertLeaseHealthy();
  return {
    ok: true as const,
    channel: "elevenst" as const,
    operation: "competitor.search" as const,
    items,
    safeMessage: `11번가 공식 상품검색에서 후보 ${items.length}건을 확인했습니다.`,
  };
}
async function executeListingLineage(input: ServerlessGatewayProviderExecutionInput) {
  if (!serverlessLineageChannels.has(input.job.channel)) {
    throw new Error("LISTING_LINEAGE_ARGUMENT_INVALID:version");
  }
  const arguments_ = input.job.request.arguments;
  if (!arguments_ || typeof arguments_ !== "object" || Array.isArray(arguments_)) {
    throw new Error("LISTING_LINEAGE_ARGUMENT_INVALID:arguments");
  }
  await input.hooks.assertLeaseHealthy();
  if (input.job.channel === "coupang") {
    if (input.job.request.sellerpilotLineageVersion !== "coupang_create_reconciliation_v1") {
      throw new Error("LISTING_LINEAGE_ARGUMENT_INVALID:version");
    }
    const result = await executeCoupangDurableCreateReconciliation({
      payload: input.job.credential,
      arguments: arguments_ as CoupangDurableCreateReconciliationArguments,
    });
    await input.hooks.assertLeaseHealthy();
    return result;
  }
  if (input.job.request.sellerpilotLineageVersion !== "provider_listing_readback_v1") {
    throw new Error("LISTING_LINEAGE_ARGUMENT_INVALID:version");
  }
  const result = await executeProviderListingLineageVerification({
    channel: input.job.channel as "qoo10" | "shopee" | "lazada" | "ebay",
    payload: input.job.credential,
    arguments: arguments_ as Record<string, unknown>,
    environment: input.job.environment,
    onExternalMutationStart: input.hooks.beginCredentialMutation,
    onCredentialRefresh: input.hooks.stageCredentialRefresh,
  });
  await input.hooks.assertLeaseHealthy();
  return result;
}
export async function executeServerlessGatewayProviderJob(input: ServerlessGatewayProviderExecutionInput, operationExecutor: ProviderExecutor = executeChannelOperation): Promise<ServerlessGatewayProviderResult> {
  if (!serverlessGatewayOperationAllowed(input.job.channel, input.job.operation)) {
    throw new Error("SERVERLESS_GATEWAY_OPERATION_NOT_ALLOWED");
  }
  const execute = () => runWithChannelRequestSignal(input.signal, async () => {
    if (input.job.operation === "oauth.exchange") {
      return executeProviderOAuthExchange(input.job as ProviderOAuthClaim, input.hooks);
    }
    if (input.job.operation === "diagnostic.test") return executeDiagnostic(input);
    if (input.job.operation === "shops.get") return executeShopDiscovery(input);
    if (input.job.operation === "competitor.search") return executeCompetitorSearch(input);
    if (input.job.operation === "listing.lineage.verify") {
      return runWithProviderReadOnlyTransport(() => executeListingLineage(input));
    }
    if (!channelOperation(input.job.operation)) {
      throw new Error("SERVERLESS_GATEWAY_OPERATION_NOT_ALLOWED");
    }
    const rawArguments = requestArguments(input.job);
    const lazadaGetRecoveryCreate = input.job.channel === "lazada"
      && input.job.operation === "listing.create"
      && lazadaGatewayCreateReceiptKindFromArguments(rawArguments) === "get_recovery";
    const qoo10DurableCreateBinding = input.job.channel === "qoo10"
      && input.job.operation === "listing.create"
      ? qoo10DurableCreateFulfillmentBinding(rawArguments)
      : null;
    if (input.job.channel === "qoo10" && input.job.operation === "listing.create"
        && (!qoo10DurableCreateBinding
          || qoo10DurableCreateBinding.credentialId !== input.job.credential_id)) {
      throw new Error("QOO10_CREATE_FULFILLMENT_DURABLE_CONTEXT_REQUIRED");
    }
    assertNoRetiredProductRecovery(rawArguments);
    if (input.job.channel === "temu"
      && input.job.operation === "listing.create"
      && (rawArguments.publicationStateContract !== "verified_remote_state_v1"
        || !["live", "safe_test"].includes(String(rawArguments.publicationIntent ?? "")))) {
      throw new Error("TEMU_CREATE_CONTRACT_REQUIRED");
    }
    const strictShopeeSgCreate = input.job.channel === "shopee"
      && input.job.operation === "listing.create"
      && rawArguments.globalProduct === true
      && shopeeSgListingCreateRequested(rawArguments);
    const contentBoundPublicationWrite = (
      input.job.operation === "listing.create"
      || input.job.operation === "listing.update"
      || (input.job.channel === "temu" && input.job.operation === "listing.activate")
    )
      && rawArguments.publicationStateContract === "verified_remote_state_v1"
      && (rawArguments.publicationIntent === "live"
        || ((input.job.channel === "temu" || Boolean(false))
          && rawArguments.publicationIntent === "safe_test"));
    if (input.job.channel === "qoo10"
      && input.job.operation === "listing.create"
      && !contentBoundPublicationWrite) {
      throw new Error("QOO10_CREATE_STRICT_PUBLICATION_CONTEXT_REQUIRED");
    }
    const qoo10ActivationMarkerSupplied = Object.hasOwn(rawArguments, qoo10S1ActivationArgument);
    const temuActivationMarkerSupplied = Object.hasOwn(rawArguments, "sellerpilotTemuActivation");
    const exactActivationContext = input.job.operation === "listing.activate"
      ? input.job.channel === "qoo10"
        ? qoo10ActivationMarkerSupplied
        && !temuActivationMarkerSupplied
        && qoo10S1ActivationArgumentsValid(rawArguments)
        : input.job.channel === "temu"
          ? !qoo10ActivationMarkerSupplied
          && temuActivationMarkerSupplied
          && Boolean(temuActivationBinding(rawArguments))
          : false
      : !qoo10ActivationMarkerSupplied && !temuActivationMarkerSupplied;
    if (!exactActivationContext) {
      throw new Error("LISTING_ACTIVATION_SERVER_CONTEXT_REQUIRED");
    }
    if (input.job.operation === "listing.publication.verify") {
      const source = listingPublicationVerificationSourceSchema.safeParse(rawArguments.sellerpilotPublicationSource);
      const containmentDiscovery = input.job.channel === "temu"
        ? temuContainmentDiscoveryBinding(rawArguments)
        : null;
      if (rawArguments.sellerpilotReadOnly !== true
        || (!containmentDiscovery
          && (!source.success || source.data.verificationJobId !== input.job.id))) {
        throw new Error("LISTING_PUBLICATION_VERIFY_READ_ONLY_CONTEXT_REQUIRED");
      }
    }
    if (input.job.channel === "ebay" && input.job.operation === "listing.create") {
      // Reject legacy/directly queued drafts before OAuth refresh, media writes,
      // or the provider-mutation fence. Policy/location selection is an
      // operator decision and cannot be inferred safely by the worker.
      assertEbayCreatePublicationContract(rawArguments);
      assertEbayListingCreateConfiguration(rawArguments);
    }
    if (contentBoundPublicationWrite) {
      if (!parseListingPublicationAssetBinding(rawArguments.sellerpilotPublicationAssetBinding)) {
        throw new Error("LISTING_PUBLICATION_APPROVED_ASSET_BINDING_REQUIRED");
      }
      {
        assertListingPublicationSourceLocalized({
          channel: input.job.channel,
          expectedLocale: String(rawArguments.publicationExpectedLocale ?? ""),
          sourceArguments: rawArguments,
        });
      }
    }
    const preparedCredential = await prepareCredential(input, rawArguments);
    const delayedEbayCreateBoundary = input.job.channel === "ebay"
      && input.job.operation === "listing.create";
    const delayedCoupangCreateBoundary = input.job.channel === "coupang"
      && input.job.operation === "listing.create";
    if (delayedEbayCreateBoundary) {
      if (!readProviderAccountIdentity(preparedCredential.credential, "ebay")) {
        throw new Error("EBAY_CREATE_SELLER_IDENTITY_REQUIRED");
      }
      const recordedScopes = typeof preparedCredential.credential.scopes === "string"
        ? new Set(preparedCredential.credential.scopes.split(/\s+/u).filter(Boolean))
        : new Set<string>();
      if (!["https://api.ebay.com/oauth/api_scope/sell.account",
        "https://api.ebay.com/oauth/api_scope/sell.inventory"].every((scope) => recordedScopes.has(scope))) {
        throw new Error("EBAY_CREATE_SELL_SCOPES_REQUIRED");
      }
    }
    let operationArguments = preparedCredential.arguments_;
    let mediaMutationObserved = false;
    if ((input.job.operation === "listing.create" || input.job.operation === "listing.update")
        && !strictShopeeSgCreate
        && !lazadaGetRecoveryCreate) {
      const preparedListing = await prepareMarketplaceListingArguments({
        channel: input.job.channel,
        operation: input.job.operation,
        credential: preparedCredential.credential,
        credentialId: input.job.credential_id,
        credentialVersion: input.elevenstCredentialVersion,
        arguments: operationArguments,
        environment: input.job.environment,
        signal: input.signal,
        hooks: delayedEbayCreateBoundary
          ? {
              assertLeaseHealthy: input.hooks.assertLeaseHealthy,
              beginProviderMutation: async () => {
                throw new Error("EBAY_CREATE_MEDIA_MUTATION_BEFORE_PREFLIGHT");
              },
            }
          : input.hooks,
        ...(preparedCredential.shopeeShopCredential
          ? { shopeeShopCredential: preparedCredential.shopeeShopCredential }
          : {}),
      });
      operationArguments = preparedListing.arguments;
      mediaMutationObserved = preparedListing.mediaMutationObserved;
      if (input.job.channel === "smartstore"
          && input.job.operation === "listing.create") {
        if (!input.hooks.stageSmartstoreCreateTransport) {
          throw new Error("SMARTSTORE_CREATE_TRANSPORT_STAGE_UNAVAILABLE");
        }
        const body = recordValue(operationArguments.body);
        const source = recordValue(operationArguments.sellerpilotSmartstoreCreateSource);
        const transport = assertSmartstoreCreateTransport({
          body,
          transport: operationArguments[smartstoreCreateTransportArgument],
        });
        const bodyBindingSha256 = smartstoreCreateBodyBindingSha256(body);
        if (source.bodyBindingSha256 !== bodyBindingSha256) {
          throw new Error("SMARTSTORE_CREATE_BODY_BINDING_CHANGED");
        }
        const stage = await input.hooks.stageSmartstoreCreateTransport({
          ...transport,
          bodyBindingSha256,
        });
        assertSmartstoreCreateTransport({
          body,
          transport,
          stage,
          expectedJobId: input.job.id,
        });
        operationArguments = {
          ...operationArguments,
          [smartstoreCreateTransportStageArgument]: stage,
        };
      }
    }
    await input.hooks.assertLeaseHealthy();
    const delayedTemuActivationBoundary = input.job.channel === "temu"
      && input.job.operation === "listing.activate";
    const delayedQoo10CreateBoundary = input.job.channel === "qoo10"
      && input.job.operation === "listing.create"
      && Boolean(qoo10DurableCreateBinding);
    if (input.job.channel === "temu"
      && input.job.operation === "listing.update") {
      throw new Error("TEMU_EXACT_EXISTING_UPDATE_SERVER_CONTEXT_REQUIRED");
    }
    if (writeChannelOperations.has(input.job.operation)
      && !delayedTemuActivationBoundary
      && !delayedQoo10CreateBoundary
      && !delayedEbayCreateBoundary
      && !delayedCoupangCreateBoundary
      && !strictShopeeSgCreate) {
      await input.hooks.beginProviderMutation();
      await input.hooks.assertLeaseHealthy();
    }
    const channelOperationName = input.job.operation as ChannelOperationName;
    const executeOperation = () => operationExecutor({
      channel: input.job.channel,
      operation: channelOperationName,
      payload: preparedCredential.credential,
      arguments: operationArguments,
      environment: input.job.environment,
      ...(delayedEbayCreateBoundary || delayedQoo10CreateBoundary || delayedCoupangCreateBoundary
        ? {
            providerMutationHooks: {
              begin: delayedCoupangCreateBoundary
                ? (boundary?: { providerBody?: Record<string, unknown> }) =>
                  input.hooks.beginProviderMutation(
                    boundary as { fresh?: boolean } | undefined,
                  )
                : () => input.hooks.beginProviderMutation(),
              assertLeaseHealthy: input.hooks.assertLeaseHealthy,
            },
          }
        : {}),
      ...(preparedCredential.shopeeShopCredential
        ? { shopeeShopCredential: preparedCredential.shopeeShopCredential }
        : {}),
      ...(strictShopeeSgCreate
        ? {
          signal: input.signal,
          providerMutationHooks: {
            gatewayCredentialId: input.job.credential_id,
            assertLeaseHealthy: input.hooks.assertLeaseHealthy,
            begin: () => input.hooks.beginProviderMutation(),
            readShopeeSgCreateStageState:
              input.hooks.readShopeeSgCreateStageState,
            beginShopeeSgCreateStage:
              input.hooks.beginShopeeSgCreateStage,
            completeShopeeSgCreateStage:
              input.hooks.completeShopeeSgCreateStage,
            readShopeeSgCreateResume: input.hooks.readShopeeSgCreateResume,
            recordShopeeSgGlobalCreateReadback:
              input.hooks.recordShopeeSgGlobalCreateReadback,
            captureShopeeSgPreparedArguments: (prepared: Record<string, unknown>) => {
              operationArguments = prepared;
            },
          },
        }
        : {}),
    });
    let result = input.job.operation === "listing.publication.verify"
      || lazadaGetRecoveryCreate
      ? await runWithProviderReadOnlyTransport(executeOperation)
      : await executeOperation();
    if (input.job.channel === "lazada" && input.job.operation === "listing.create") {
      result = applyLazadaGatewayCreateProviderResult(result, operationArguments);
    }
    if (mediaMutationObserved) {
      result.steps.unshift({
        name: "listing-image-upload",
        ok: true,
        status: 200,
        data: { sellerpilotMutation: "accepted" },
      });
    }
    if (input.job.channel === "shopee"
      && input.job.operation === "listing.create"
      && operationArguments.globalProduct === true
      && preparedCredential.shopeeShopCredential
      && !strictShopeeSgCreate) {
      result = await verifyShopeeGlobalListingPostPublish({
        result,
        merchantCredential: preparedCredential.credential,
        shopCredential: preparedCredential.shopeeShopCredential,
        arguments: operationArguments,
        environment: input.job.environment,
        signal: input.signal,
        hooks: input.hooks,
      });
    }
    // Shopee global CREATE obtains its verified remote state in the dedicated
    // post-publish readback above. Bind approved source assets only after that
    // state exists so the final completion receipt carries both facts.
    if (contentBoundPublicationWrite && result.remoteState) {
      const publicationAssetBinding = listingPublicationProviderAssetEvidence({
        channel: input.job.channel,
        remoteId: result.remoteId ?? "",
        sourceArguments: rawArguments,
        providerArguments: operationArguments,
      });
      const boundState = verifiedListingRemoteStateSchema.safeParse(publicationAssetBinding
        ? {
          ...result.remoteState,
          evidence: {
            ...result.remoteState.evidence,
            publicationAssetBinding,
          },
        }
        : null);
      if (!boundState.success) {
        throw new Error("LISTING_PUBLICATION_PROVIDER_ASSET_BINDING_FAILED");
      }
      result = { ...result, remoteState: boundState.data };
    }
    return result;
  });
  return runWithProviderTransportContext({ signal: input.signal, reserve: input.hooks.reserveProviderRequest }, execute);
}
