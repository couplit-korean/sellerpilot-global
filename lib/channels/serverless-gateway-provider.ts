import { runChannelDiagnostic, type ChannelDiagnostic } from "../channel-diagnostics";
import { searchElevenstProductVariants, type CompetitorPriceCandidate } from "../competitor-prices";
import { ebayAsqOperationMarketplaceId } from "./ebay-asq";
import { assertEbayListingCreateConfiguration } from "./ebay-listing-configuration";
import {
  assertEbayExactExistingQaUpdateArguments,
  ebayExactExistingQaCreateForbidden,
  ebayExactExistingQaRecoveryArgument,
  ebayExactExistingQaRecoveryBinding,
} from "./ebay-exact-existing-qa-recovery";
import type { GatewayClaim } from "./gateway-contract";
import {
  executeProviderListingLineageVerification,
  type ProviderListingLineageVerificationResult,
} from "./listing-lineage-verification";
import {
  assertListingPublicationSourceLocalized,
  listingPublicationProviderAssetEvidence,
  parseListingPublicationAssetBinding,
} from "./listing-publication-content";
import { verifiedListingRemoteStateSchema } from "./listing-publication-state";
import {
  executeChannelOperation,
  writeChannelOperations,
  type ChannelOperationName,
  type ChannelOperationResult,
} from "./operations";
import { listingPublicationVerificationSourceSchema } from "./listing-publication-verification";
import {
  assertShopeeShopProfileTarget,
  readProviderAccountIdentity,
} from "./provider-account-identity";
import {
  ensureEbayAccessToken,
  ensureLazadaAccessToken,
  ensureShopeeAccessToken,
  ensureShopeeMerchantAccessToken,
  fetchNaverAccessToken,
  lazadaRequest,
  readStoredNaverAccessToken,
  runWithProviderReadOnlyTransport,
  runWithChannelRequestSignal,
  shopeeRequest,
  textValue,
  type CredentialRefreshSnapshot,
  type SecretPayload,
} from "./protocols";
import {
  executeProviderOAuthExchange,
  type ProviderOAuthClaim,
  type ProviderOAuthResult,
} from "./provider-oauth-runtime";
import { prepareMarketplaceListingArguments } from "./provider-listing-runtime";
import { verifyShopeeGlobalListingPostPublish } from "./provider-shopee-post-publish-runtime";
import {
  coupangExactQaCreateForbidden,
  coupangExactQaRecoveryArgument,
  coupangExactQaRecoveryBinding,
} from "./coupang-exact-qa-recovery";
import { channelPriceUpdateRelease } from "./price-update-release";
import {
  qoo10S1ActivationArgument,
  qoo10S1ActivationArgumentsValid,
} from "./qoo10-listing-activation";
import {
  qoo10ExactLocalizationRecoveryIdentity,
  qoo10ExactLocalizationUpdateArgument,
  qoo10ExactLocalizationUpdateBinding,
  qoo10ExactTargetCreateForbidden,
} from "./qoo10-exact-localization-recovery";
import {
  temuActivationBinding,
  temuContainmentDiscoveryBinding,
} from "./provider-temu-publication-readback";
import {
  assertElevenstExactExistingUpdate,
  elevenstExactExistingCreateForbidden,
  elevenstExactExistingPublicationArgument,
  elevenstExactExistingPublicationBinding,
  elevenstExactExistingUpdateTarget,
} from "./elevenst-exact-existing-publication";
import { lazadaExactExistingCreateForbidden } from "./lazada-exact-existing-identity";

const serverlessWriteMatrix = {
  "listing.create": new Set([
    "qoo10", "shopee", "lazada", "coupang", "elevenst", "temu", "smartstore", "ebay",
  ]),
  "listing.update": new Set([
    "qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay",
  ]),
  "listing.stop": new Set([
    "qoo10", "shopee", "lazada", "coupang", "elevenst", "temu", "smartstore",
  ]),
  "listing.activate": new Set(["qoo10", "temu"]),
  "inventory.update": new Set([
    "qoo10", "shopee", "lazada", "coupang", "temu", "smartstore", "ebay",
  ]),
  "shipment.acknowledge": new Set([
    "qoo10", "shopee", "lazada", "coupang", "smartstore",
  ]),
  "shipment.confirm": new Set([
    "qoo10", "shopee", "lazada", "coupang", "temu", "smartstore", "ebay",
  ]),
} as const satisfies Record<string, ReadonlySet<GatewayClaim["channel"]>>;

const serverlessCsMatrix = {
  "inquiries.list": new Set(["qoo10", "lazada", "coupang", "smartstore", "ebay", "temu"]),
  "inquiries.reply": new Set(["qoo10", "lazada", "coupang", "smartstore", "ebay"]),
} as const satisfies Record<string, ReadonlySet<GatewayClaim["channel"]>>;

const allServerlessChannels = new Set<GatewayClaim["channel"]>([
  "qoo10", "shopee", "lazada", "coupang", "elevenst", "temu", "smartstore", "ebay",
]);

const serverlessOrderChannels = new Set<GatewayClaim["channel"]>([
  "qoo10", "shopee", "lazada", "coupang", "elevenst", "temu", "smartstore", "ebay",
]);

const serverlessReadMatrix = {
  "categories.list": allServerlessChannels,
  "categories.suggest": allServerlessChannels,
  "categories.attributes": allServerlessChannels,
  "categories.validate": allServerlessChannels,
  "orders.get": new Set(["qoo10", "shopee", "lazada", "coupang", "temu", "smartstore", "ebay"]),
  "listing.publication.verify": new Set([
    "qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay", "temu",
  ]),
} as const satisfies Record<string, ReadonlySet<GatewayClaim["channel"]>>;

const serverlessOAuthChannels = new Set<GatewayClaim["channel"]>(["shopee", "lazada", "ebay"]);
const serverlessShopDiscoveryChannels = new Set<GatewayClaim["channel"]>(["shopee", "lazada"]);
const serverlessLineageChannels = new Set<GatewayClaim["channel"]>(["qoo10", "shopee", "lazada", "ebay"]);

export const SERVERLESS_GATEWAY_WRITE_MATRIX = serverlessWriteMatrix;
export const SERVERLESS_GATEWAY_CS_MATRIX = serverlessCsMatrix;
export const SERVERLESS_GATEWAY_ORDER_CHANNELS = serverlessOrderChannels;
export const SERVERLESS_GATEWAY_READ_MATRIX = serverlessReadMatrix;

export type ServerlessGatewayExecutionHooks = {
  beginCredentialMutation: () => Promise<void>;
  beginOAuthProviderCall?: () => Promise<void>;
  stageCredentialRefresh: (refresh: CredentialRefreshSnapshot) => Promise<void>;
  beginProviderMutation: () => Promise<void>;
  assertLeaseHealthy: () => Promise<void>;
};

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
  | ProviderListingLineageVerificationResult;

export type ServerlessGatewayProviderExecutionInput = {
  job: GatewayClaim;
  signal: AbortSignal;
  hooks: ServerlessGatewayExecutionHooks;
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

export function serverlessGatewayOperationAllowed(
  channel: GatewayClaim["channel"],
  operation: GatewayClaim["operation"],
) {
  if (operation === "oauth.exchange") return serverlessOAuthChannels.has(channel);
  if (operation === "price.update") return channelPriceUpdateRelease(channel).available;
  if (operation === "orders.list") return serverlessOrderChannels.has(channel);
  if (operation === "diagnostic.test") return allServerlessChannels.has(channel);
  if (operation === "shops.get") return serverlessShopDiscoveryChannels.has(channel);
  if (operation === "competitor.search") return channel === "elevenst";
  if (operation === "listing.lineage.verify") return serverlessLineageChannels.has(channel);
  if (operation in serverlessWriteMatrix) {
    return (serverlessWriteMatrix[
      operation as keyof typeof serverlessWriteMatrix
    ] as ReadonlySet<GatewayClaim["channel"]>).has(channel);
  }
  if (operation in serverlessCsMatrix) {
    return (serverlessCsMatrix[
      operation as keyof typeof serverlessCsMatrix
    ] as ReadonlySet<GatewayClaim["channel"]>).has(channel);
  }
  if (operation in serverlessReadMatrix) {
    return (serverlessReadMatrix[
      operation as keyof typeof serverlessReadMatrix
    ] as ReadonlySet<GatewayClaim["channel"]>).has(channel);
  }
  return false;
}

function channelOperation(
  operation: GatewayClaim["operation"],
): operation is ChannelOperationName {
  return operation !== "oauth.exchange"
    && operation !== "shops.get"
    && operation !== "diagnostic.test"
    && operation !== "competitor.search"
    && operation !== "listing.lineage.verify";
}

async function prepareCredential(
  input: ServerlessGatewayProviderExecutionInput,
  operationArguments: Record<string, unknown>,
) {
  let credential: SecretPayload = input.job.credential;
  let shopeeShopCredential: SecretPayload | undefined;
  let arguments_ = operationArguments;
  const publicationReadOnly = input.job.operation === "listing.publication.verify";
  const publicationSource = publicationReadOnly
    ? listingPublicationVerificationSourceSchema.safeParse(
        operationArguments.sellerpilotPublicationSource,
      )
    : null;
  const publicationSourceArguments = publicationSource?.success
    ? publicationSource.data.sourceArguments
    : {};
  const readOnlyCredentialRefreshBlocked = async () => {
    throw new Error("LISTING_PUBLICATION_VERIFY_CREDENTIAL_REFRESH_REQUIRED");
  };
  const refreshHooks = publicationReadOnly
    ? {
        onExternalMutationStart: readOnlyCredentialRefreshBlocked,
        onCredentialRefresh: readOnlyCredentialRefreshBlocked,
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
        const shopId = String(
          (sourceResources.shopId
            ?? publish.shop_id
            ?? arguments_.shopId
            ?? arguments_.shop_id) ?? "",
        ).trim();
        await input.hooks.assertLeaseHealthy();
        const shopEnsured = await ensureShopeeAccessToken(
          credential,
          input.job.environment,
          10 * 60 * 1_000,
          shopId,
          refreshHooks.onExternalMutationStart,
          refreshHooks.onCredentialRefresh,
          !publicationReadOnly,
        );
        shopeeShopCredential = shopEnsured.payload;
        if (!publicationReadOnly) credential = shopEnsured.payload;
      }
      const merchantId = String(
        publicationSourceArguments.merchantId
          ?? publicationSourceArguments.merchant_id
          ?? arguments_.merchantId
          ?? arguments_.merchant_id
          ?? "",
      ).trim();
      await input.hooks.assertLeaseHealthy();
      const merchantEnsured = await ensureShopeeMerchantAccessToken(
        credential,
        input.job.environment,
        10 * 60 * 1_000,
        merchantId,
        refreshHooks.onExternalMutationStart,
        refreshHooks.onCredentialRefresh,
        !publicationReadOnly,
      );
      credential = merchantEnsured.payload;
    } else {
      const shopId = String(arguments_.shopId ?? arguments_.shop_id ?? "").trim();
      await input.hooks.assertLeaseHealthy();
      const ensured = await ensureShopeeAccessToken(
        credential,
        input.job.environment,
        10 * 60 * 1_000,
        shopId,
        refreshHooks.onExternalMutationStart,
        refreshHooks.onCredentialRefresh,
        !publicationReadOnly,
      );
      credential = ensured.payload;
    }
  } else if (input.job.channel === "smartstore") {
    const storedAccessToken = readStoredNaverAccessToken(credential, 10 * 60 * 1_000);
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
  } else if (input.job.channel === "lazada") {
    const country = String(arguments_.country || textValue(credential, "country") || "my")
      .toLowerCase();
    credential = { ...credential, country };
    await input.hooks.assertLeaseHealthy();
    const ensured = await ensureLazadaAccessToken(
      credential,
      undefined,
      refreshHooks.onExternalMutationStart,
      refreshHooks.onCredentialRefresh,
      true,
    );
    credential = ensured.payload;
  } else if (input.job.channel === "ebay") {
    if (publicationReadOnly && !readProviderAccountIdentity(credential, "ebay")) {
      throw new Error("PROVIDER_ACCOUNT_IDENTITY_MISSING");
    }
    await input.hooks.assertLeaseHealthy();
    const ensured = await ensureEbayAccessToken(
      credential,
      input.job.environment,
      undefined,
      refreshHooks.onExternalMutationStart,
      refreshHooks.onCredentialRefresh,
      !publicationReadOnly,
    );
    credential = ensured.payload;
    if (input.job.operation === "inquiries.list") {
      arguments_ = {
        ...arguments_,
        marketplaceId: ebayAsqOperationMarketplaceId({
          periodic: typeof input.job.request.periodicKey === "string",
          credentialMarketplaceId: credential.marketplace_id,
          requestedMarketplaceId: arguments_.marketplaceId,
        }),
      };
    }
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
  const diagnostic = await runChannelDiagnostic(
    input.job.channel,
    prepared.credential,
    input.job.environment,
  );
  await input.hooks.assertLeaseHealthy();
  return {
    ok: diagnostic.status !== "failed",
    channel: input.job.channel,
    operation: "diagnostic.test" as const,
    diagnostic,
    safeMessage: diagnostic.message,
  };
}

async function executeShopDiscovery(input: ServerlessGatewayProviderExecutionInput) {
  if (input.job.channel === "shopee") {
    const shopId = String(input.job.request.shopId ?? "").trim();
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
    const remote = await shopeeRequest({
      payload: ensured.payload,
      environment: input.job.environment,
      method: "GET",
      path: "/api/v2/shop/get_shop_info",
    });
    await input.hooks.assertLeaseHealthy();
    const providerError = textValue(remote.data, "error");
    const ok = remote.response.ok && !providerError;
    if (ok) assertShopeeShopProfileTarget(remote.data, shopId);
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
    const ensured = await ensureLazadaAccessToken(
      input.job.credential,
      undefined,
      input.hooks.beginCredentialMutation,
      input.hooks.stageCredentialRefresh,
      true,
    );
    const country = String(
      input.job.request.country || textValue(ensured.payload, "country") || "my",
    ).toLowerCase();
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
  const displayPerQuery = Math.max(
    1,
    Math.min(30, Number(input.job.request.displayPerQuery ?? 30) || 30),
  );
  if (primary.length < 2) throw new Error("COMPETITOR_SEARCH_ARGUMENT_INVALID");
  await input.hooks.assertLeaseHealthy();
  const items = await searchElevenstProductVariants(
    primary,
    aliases,
    { apiKey: textValue(input.job.credential, "api_key") },
    displayPerQuery,
  );
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
  if (!serverlessLineageChannels.has(input.job.channel)
      || input.job.request.sellerpilotLineageVersion !== "provider_listing_readback_v1") {
    throw new Error("LISTING_LINEAGE_ARGUMENT_INVALID:version");
  }
  const arguments_ = input.job.request.arguments;
  if (!arguments_ || typeof arguments_ !== "object" || Array.isArray(arguments_)) {
    throw new Error("LISTING_LINEAGE_ARGUMENT_INVALID:arguments");
  }
  await input.hooks.assertLeaseHealthy();
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

export async function executeServerlessGatewayProviderJob(
  input: ServerlessGatewayProviderExecutionInput,
  operationExecutor: ProviderExecutor = executeChannelOperation,
): Promise<ServerlessGatewayProviderResult> {
  if (!serverlessGatewayOperationAllowed(input.job.channel, input.job.operation)) {
    throw new Error("SERVERLESS_GATEWAY_OPERATION_NOT_ALLOWED");
  }

  return runWithChannelRequestSignal(input.signal, async () => {
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
    if (input.job.channel === "coupang"
        && input.job.operation === "listing.create"
        && coupangExactQaCreateForbidden({ argumentsValue: rawArguments })) {
      throw new Error("COUPANG_EXACT_QA_DUPLICATE_CREATE_FORBIDDEN");
    }
    if (input.job.channel === "elevenst"
        && input.job.operation === "listing.create"
        && elevenstExactExistingCreateForbidden({ argumentsValue: rawArguments })) {
      throw new Error("ELEVENST_EXACT_EXISTING_DUPLICATE_CREATE_FORBIDDEN");
    }
    if (input.job.channel === "lazada"
        && input.job.operation === "listing.create"
        && lazadaExactExistingCreateForbidden({ argumentsValue: rawArguments })) {
      throw new Error("LAZADA_EXACT_EXISTING_DUPLICATE_CREATE_FORBIDDEN");
    }
    if (input.job.channel === "ebay"
        && input.job.operation === "listing.create"
        && ebayExactExistingQaCreateForbidden({ argumentsValue: rawArguments })) {
      throw new Error("EBAY_EXACT_EXISTING_QA_DUPLICATE_CREATE_FORBIDDEN");
    }
    const ebayExactRecovery = ebayExactExistingQaRecoveryBinding(rawArguments);
    if (Object.hasOwn(rawArguments, ebayExactExistingQaRecoveryArgument)
        && (input.job.channel !== "ebay"
          || input.job.operation !== "listing.update"
          || !ebayExactRecovery)) {
      throw new Error("EBAY_EXACT_EXISTING_QA_SERVER_CONTEXT_REQUIRED");
    }
    if (input.job.channel === "ebay" && input.job.operation === "listing.update") {
      if (!ebayExactRecovery) {
        throw new Error("EBAY_EXACT_EXISTING_QA_SERVER_CONTEXT_REQUIRED");
      }
      if (input.job.credential_id !== ebayExactRecovery.credentialId) {
        throw new Error("EBAY_EXACT_EXISTING_QA_CREDENTIAL_LINEAGE_MISMATCH");
      }
      assertEbayExactExistingQaUpdateArguments(rawArguments);
    }
    const elevenstExactPublication = elevenstExactExistingPublicationBinding(rawArguments);
    if (Object.hasOwn(rawArguments, elevenstExactExistingPublicationArgument)
        && (input.job.channel !== "elevenst"
          || input.job.operation !== "listing.update"
          || !elevenstExactPublication)) {
      throw new Error("ELEVENST_EXACT_EXISTING_SERVER_CONTEXT_REQUIRED");
    }
    if (input.job.channel === "elevenst"
        && input.job.operation === "listing.update"
        && elevenstExactExistingUpdateTarget(rawArguments)) {
      if (!elevenstExactPublication) {
        throw new Error("ELEVENST_EXACT_EXISTING_SERVER_CONTEXT_REQUIRED");
      }
      if (input.job.credential_id !== elevenstExactPublication.credentialId) {
        throw new Error("ELEVENST_EXACT_EXISTING_CREDENTIAL_LINEAGE_MISMATCH");
      }
      assertElevenstExactExistingUpdate(rawArguments);
    }
    const coupangRecoveryPhase = input.job.operation === "listing.update"
      || input.job.operation === "listing.stop"
      ? input.job.operation
      : undefined;
    if (Object.hasOwn(rawArguments, coupangExactQaRecoveryArgument)
        && (input.job.channel !== "coupang"
          || !coupangRecoveryPhase
          || !coupangExactQaRecoveryBinding(rawArguments, coupangRecoveryPhase))) {
      throw new Error("COUPANG_EXACT_QA_RECOVERY_SERVER_CONTEXT_REQUIRED");
    }
    if (input.job.channel === "qoo10"
        && input.job.operation === "listing.create"
        && qoo10ExactTargetCreateForbidden(rawArguments)) {
      // This QA SKU already owns remote item 1217336970. Reject the stale
      // create before credential refresh, media preparation, or the worker's
      // provider-mutation fence; only the exact bound update is recoverable.
      throw new Error("QOO10_EXACT_DUPLICATE_CREATE_FORBIDDEN");
    }
    const qoo10ExactLocalizationMarkerSupplied = Object.hasOwn(
      rawArguments,
      qoo10ExactLocalizationUpdateArgument,
    );
    const qoo10ExactLocalizationTarget = input.job.channel === "qoo10"
      && input.job.operation === "listing.update"
      && String((rawArguments.params as Record<string, unknown> | undefined)?.ItemCode ?? "")
        === qoo10ExactLocalizationRecoveryIdentity.remoteId;
    if ((qoo10ExactLocalizationMarkerSupplied || qoo10ExactLocalizationTarget)
        && (!qoo10ExactLocalizationTarget
          || !qoo10ExactLocalizationUpdateBinding(rawArguments))) {
      throw new Error("QOO10_EXACT_LOCALIZATION_SERVER_CONTEXT_REQUIRED");
    }
    const contentBoundPublicationWrite = (
      input.job.operation === "listing.create"
      || input.job.operation === "listing.update"
      || (input.job.channel === "temu" && input.job.operation === "listing.activate")
    )
      && rawArguments.publicationStateContract === "verified_remote_state_v1"
      && (rawArguments.publicationIntent === "live"
        || (input.job.channel === "temu" && rawArguments.publicationIntent === "safe_test"));
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
      const source = listingPublicationVerificationSourceSchema.safeParse(
        rawArguments.sellerpilotPublicationSource,
      );
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
      assertEbayListingCreateConfiguration(rawArguments);
    }
    if (contentBoundPublicationWrite) {
      if (!parseListingPublicationAssetBinding(rawArguments.sellerpilotPublicationAssetBinding)) {
        throw new Error("LISTING_PUBLICATION_APPROVED_ASSET_BINDING_REQUIRED");
      }
      assertListingPublicationSourceLocalized({
        channel: input.job.channel,
        expectedLocale: String(rawArguments.publicationExpectedLocale ?? ""),
        sourceArguments: rawArguments,
      });
    }

    const preparedCredential = await prepareCredential(input, rawArguments);
    let operationArguments = preparedCredential.arguments_;
    let mediaMutationObserved = false;
    if (input.job.operation === "listing.create" || input.job.operation === "listing.update") {
      const preparedListing = await prepareMarketplaceListingArguments({
        channel: input.job.channel,
        operation: input.job.operation,
        credential: preparedCredential.credential,
        arguments: operationArguments,
        environment: input.job.environment,
        signal: input.signal,
        hooks: input.hooks,
        ...(preparedCredential.shopeeShopCredential
          ? { shopeeShopCredential: preparedCredential.shopeeShopCredential }
          : {}),
      });
      operationArguments = preparedListing.arguments;
      mediaMutationObserved = preparedListing.mediaMutationObserved;
    }

    await input.hooks.assertLeaseHealthy();
    const delayedTemuActivationBoundary = input.job.channel === "temu"
      && input.job.operation === "listing.activate";
    const delayedEbayExactUpdateBoundary = input.job.channel === "ebay"
      && input.job.operation === "listing.update"
      && Boolean(ebayExactRecovery);
    if (writeChannelOperations.has(input.job.operation)
        && !delayedTemuActivationBoundary
        && !delayedEbayExactUpdateBoundary) {
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
      ...(delayedTemuActivationBoundary || delayedEbayExactUpdateBoundary
        ? {
            providerMutationHooks: {
              begin: input.hooks.beginProviderMutation,
              assertLeaseHealthy: input.hooks.assertLeaseHealthy,
            },
          }
        : {}),
      ...(preparedCredential.shopeeShopCredential
        ? { shopeeShopCredential: preparedCredential.shopeeShopCredential }
        : {}),
    });
    let result = input.job.operation === "listing.publication.verify"
      ? await runWithProviderReadOnlyTransport(executeOperation)
      : await executeOperation();
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
        && preparedCredential.shopeeShopCredential) {
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
    return result;
  });
}
