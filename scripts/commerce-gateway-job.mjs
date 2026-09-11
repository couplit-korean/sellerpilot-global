
import { createHash } from "node:crypto";
import { runChannelDiagnostic } from "../lib/channel-diagnostics.ts";
import { attachEbayCreateClaimIncarnation } from "../lib/channels/ebay-create-claim.ts";
import { ebayCreateCredentialRefreshIncarnationFromResponse } from "../lib/channels/ebay-credential-refresh-receipt.ts";
import { gatewayJobCompletionStatus, smartstoreManualAdoptionReadbackJobSchema } from "../lib/channels/gateway-contract.ts";
import { smartstoreContentRepairTransmissionArgument } from "../lib/channels/smartstore-content-repair-contract.ts";
import { smartstoreContentRepairBinding } from "../lib/channels/smartstore-content-repair.ts";
import { buildSmartstoreContentRepairResult } from "../lib/channels/smartstore-content-repair-result.ts";
import { qoo10S1ActivationArgument, qoo10S1ActivationArgumentsValid } from "../lib/channels/qoo10-listing-activation.ts";
import { channelPriceUpdateRelease } from "../lib/channels/price-update-release.ts";
import { executeProviderOAuthExchange } from "../lib/channels/provider-oauth-runtime.ts";
import { prepareMarketplaceListingArguments } from "../lib/channels/provider-listing-runtime.ts";
import { assertElevenstGatewayCredentialVersionReceipt } from "../lib/product-registration/elevenst/credential-version.ts";
import { verifyShopeeGlobalListingPostPublish } from "../lib/channels/provider-shopee-post-publish-runtime.ts";
import { shopeeSgListingCreateRequested } from "../lib/channels/shopee-sg-listing-create.ts";
import { searchElevenstProductVariants } from "../lib/competitor-prices.ts";
import { executeProviderListingLineageVerification } from "../lib/channels/listing-lineage-verification.ts";
import { collectSmartstoreManualAdoptionReadback, isRetryableSmartstoreManualAdoptionReadbackError, SmartstoreManualAdoptionError } from "../lib/server-smartstore-manual-adoption.ts";
import { createGatewayMutationBoundary } from "./gateway-mutation-boundary.mjs";
import { boundedGatewayCompletionError, clearSmartstoreListingUpdateCompletionJournal, smartstoreListingUpdateCompletionEvidenceStored, stageSmartstoreListingUpdateCompletionJournal } from "./gateway-worker-completion.mjs";
import { GATEWAY_COMPLETION_TRANSIENT_GRACE_MS, WorkerRequestTerminalError } from "./worker-lifecycle-retry.mjs";
import { executeChannelOperation, writeChannelOperations } from "../lib/channels/commerce-operations.ts";
import { assertShopeeShopProfileTarget } from "../lib/channels/provider-account-identity.ts";
import { executeEbayPublicationReconciliation } from "../lib/channels/ebay-publication-reconciliation.ts";
import {
  assertSmartstoreCreateTransport,
  smartstoreCreateBodyBindingSha256,
  smartstoreCreateTransportArgument,
  smartstoreCreateTransportStageArgument,
} from "../lib/channels/smartstore-create-transport.ts";
import {
  qoo10DurableCreateFulfillmentBinding,
  qoo10GatewayCreateReconciliationResult,
  qoo10RetiredExistingItemCode,
  readQoo10LocalCreateSellerCodeReconciliation,
} from "../lib/server-qoo10-listing-create-fulfillment-source.ts";
import {
  drainElevenstCreateRecovery,
  elevenstCreateRecoveryWorkerRpc,
} from "../lib/channels/elevenst-create-recovery-drain.ts";
import { applyLazadaGatewayCreateProviderResult, lazadaGatewayCreateReceiptKindFromArguments } from "../lib/product-registration/lazada/my-create-gateway-receipt.ts";
import { ensureEbayAccessToken, ensureLazadaAccessToken, ensureShopeeAccessToken, ensureShopeeMerchantAccessToken, lazadaRequest, runWithProviderReadOnlyTransport, shopeeRequest, textValue } from "../lib/channels/protocols.ts";
export async function processElevenstCreateRecoveryDrain({
  rpc,
  tokenHash,
  request,
} = {}) {
  if (typeof rpc === "function") {
    return drainElevenstCreateRecovery({
      rpc,
      tokenHash: String(tokenHash ?? ""),
    });
  }
  if (typeof request !== "function") {
    throw new Error("ELEVENST_CREATE_RECOVERY_DRAIN_TRANSPORT_REQUIRED");
  }
  return drainElevenstCreateRecovery({
    rpc: elevenstCreateRecoveryWorkerRpc(request),
    tokenHash: "",
  });
}
export async function processCommerceGatewayJob(job, {
  createGatewayHeartbeat,
  persistWorkerCompletion,
  executeCommerceOperation = executeChannelOperation,
  prepareListingArguments = prepareMarketplaceListingArguments,
}) {
  job = attachEbayCreateClaimIncarnation(job);
  if (/^(orders|shipment|inquiries)\./.test(job.operation)) throw new Error("COMMERCE_WORKER_OPERATION_REQUIRED");
  if (["inquiries.list", "inquiries.reply"].includes(job.operation)) throw new Error("COMMERCE_WORKER_OPERATION_REQUIRED");
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const claimToken = String(job?.claim_token ?? "");
  if (!UUID_PATTERN.test(claimToken)) {
    throw new Error("채널 작업 claim 식별자가 없습니다.");
  }
  const gatewayHeartbeat = createGatewayHeartbeat(job.id, claimToken);
  let gatewayHeartbeatStopped = false;
  let externalWriteStarted = false;
  let listingMediaWriteObserved = false;
  let credentialMutationInFlight = false;
  let credentialRefresh;
  let credentialIncarnation;
  let qoo10CreateLookupArguments = job.request?.arguments
    && typeof job.request.arguments === "object"
    && !Array.isArray(job.request.arguments)
    ? job.request.arguments
    : {};
  let qoo10CreateCredential = job.credential;
  const gatewayExecutionSignal = AbortSignal.timeout(180_000);
  const assertGatewayLeaseHealthy = () => gatewayHeartbeat.assertHealthy();
  const markExternalWriteStarted = createGatewayMutationBoundary({
    reuseRegistration: job.channel === "smartstore" && job.operation === "listing.update"
      && Boolean(smartstoreContentRepairBinding(job.request?.arguments ?? {})),
    assertLeaseHealthy: assertGatewayLeaseHealthy,
    persist: () => persistWorkerCompletion(
      "/api/channel-gateway/worker/begin-mutation",
      { jobId: job.id, claimToken },
      "채널 외부 호출 경계 저장 실패",
      GATEWAY_COMPLETION_TRANSIENT_GRACE_MS,
    ),
    onStarted: () => { externalWriteStarted = true; },
  });
  const qoo10CreateBinding = job.channel === "qoo10" && job.operation === "listing.create"
    ? qoo10DurableCreateFulfillmentBinding(job.request?.arguments ?? {})
    : null;
  const markQoo10CreateStarted = createGatewayMutationBoundary({
    reuseRegistration: true,
    assertLeaseHealthy: assertGatewayLeaseHealthy,
    persist: () => {
      if (!qoo10CreateBinding) {
        throw new Error("QOO10_CREATE_FULFILLMENT_DURABLE_CONTEXT_REQUIRED");
      }
      return persistWorkerCompletion(
        "/api/channel-gateway/worker/qoo10-create-boundary",
        { jobId: job.id, claimToken, binding: qoo10CreateBinding },
        "Qoo10 CREATE 원자적 외부 호출 경계 저장 실패",
        GATEWAY_COMPLETION_TRANSIENT_GRACE_MS,
      );
    },
    onStarted: () => { externalWriteStarted = true; },
  });
  const markCoupangCreateStarted = async (boundary = {}) => {
    const providerBody = boundary?.providerBody;
    if (!providerBody || typeof providerBody !== "object" || Array.isArray(providerBody)) {
      throw new Error("COUPANG_CREATE_PROVIDER_BODY_FENCE_REQUIRED");
    }
    await assertGatewayLeaseHealthy();
    await persistWorkerCompletion(
      "/api/channel-gateway/worker/begin-mutation",
      { jobId: job.id, claimToken, providerBody },
      "쿠팡 CREATE 최종 전송 본문 경계 저장 실패",
      GATEWAY_COMPLETION_TRANSIENT_GRACE_MS,
    );
    externalWriteStarted = true;
    await assertGatewayLeaseHealthy();
  };
  const markExternalMutationStarted = async () => {
    externalWriteStarted = true;
    credentialMutationInFlight = true;
    await assertGatewayLeaseHealthy();
    await persistWorkerCompletion(
      "/api/channel-gateway/worker/credential-refresh",
      { action: "begin", jobId: job.id, claimToken },
      "채널 인증 갱신 불확실성 경계 저장 실패",
      GATEWAY_COMPLETION_TRANSIENT_GRACE_MS,
    );
    await assertGatewayLeaseHealthy();
  };
  const rememberCredentialRefresh = async (refresh) => {
    credentialRefresh = refresh;
    await assertGatewayLeaseHealthy();
    const response = await persistWorkerCompletion(
      "/api/channel-gateway/worker/credential-refresh",
      { action: "stage", jobId: job.id, claimToken, credentialRefresh: refresh },
      "채널 인증 갱신 즉시 보존 실패",
      GATEWAY_COMPLETION_TRANSIENT_GRACE_MS,
    );
    const incarnation = await ebayCreateCredentialRefreshIncarnationFromResponse(
      response,
      job.channel === "ebay" && job.operation === "listing.create",
    );
    if (incarnation) credentialIncarnation = incarnation;
    await assertGatewayLeaseHealthy();
    credentialMutationInFlight = false;
    if (job.channel === "shopee" && job.operation === "listing.create") {
      await shopeeStageRequest("rebind-successor");
    }
  };
  const shopeeStageRequest = async (action, payload = {}) => {
    const response = await persistWorkerCompletion(
      "/api/channel-gateway/worker/shopee-create-stage",
      { action, jobId: job.id, claimToken, ...payload },
      "Shopee SG 단계 경계 저장 실패",
      GATEWAY_COMPLETION_TRANSIENT_GRACE_MS,
    );
    const value = await response.json().catch(() => null);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("SHOPEE_SG_STAGE_ROUTE_RESPONSE_INVALID");
    }
    return value;
  };
  const stopGatewayHeartbeat = async () => {
    if (gatewayHeartbeatStopped) return;
    gatewayHeartbeatStopped = true;
    await gatewayHeartbeat.stop();
  };
  try {
    await gatewayHeartbeat.start();
    await assertGatewayLeaseHealthy();
    if (job.channel === "temu") {
    }
    if (job.operation === "price.update") {
      const priceRelease = channelPriceUpdateRelease(job.channel);
      if (!priceRelease.available) {
        throw new Error(`PRICE_UPDATE_RELEASE_BLOCKED: ${priceRelease.reason}`);
      }
    }
    let result;
    await assertGatewayLeaseHealthy();
    if (job.ebay_publication_reconciliation) {
      if (job.channel !== "ebay" || job.operation !== "listing.create") {
        throw new Error("EBAY_PUBLICATION_RECONCILIATION_JOB_INVALID");
      }
      const ensured = await ensureEbayAccessToken(
        job.credential,
        job.environment,
        undefined,
        markExternalMutationStarted,
        rememberCredentialRefresh,
        true,
      );
      if (ensured.refreshed) {
        credentialRefresh = {
          payload: ensured.payload,
          expiresAt: ensured.credentialExpiresAt,
        };
      }
      await assertGatewayLeaseHealthy();
      result = await executeEbayPublicationReconciliation({
        channel: job.channel,
        operation: job.operation,
        payload: ensured.payload,
        arguments: job.request?.arguments ?? {},
        environment: job.environment,
      }, job.ebay_publication_reconciliation);
    } else if (job.operation === "oauth.exchange") {
      result = await executeProviderOAuthExchange(job, {
        assertLeaseHealthy: assertGatewayLeaseHealthy,
        beginCredentialMutation: markExternalMutationStarted,
        stageCredentialRefresh: rememberCredentialRefresh,
      });
    } else if (job.operation === "shops.get") {
      let remote;
      if (job.channel === "shopee") {
        await assertGatewayLeaseHealthy();
        const shopId = String(job.request?.shopId ?? "").trim();
        const ensured = await ensureShopeeAccessToken(job.credential, job.environment, 10 * 60 * 1000, shopId, markExternalMutationStarted, rememberCredentialRefresh, true);
        remote = await shopeeRequest({
          payload: ensured.payload,
          environment: job.environment,
          method: "GET",
          path: "/api/v2/shop/get_shop_info",
        });
        if (remote.response.ok && !textValue(remote.data, "error")) {
          assertShopeeShopProfileTarget(remote.data, shopId, { acceptSignedRequestBinding: true });
        }
        if (ensured.refreshed) credentialRefresh = { payload: ensured.payload, expiresAt: ensured.credentialExpiresAt };
      } else if (job.channel === "lazada") {
        await assertGatewayLeaseHealthy();
        const ensured = await ensureLazadaAccessToken(job.credential, undefined, markExternalMutationStarted, rememberCredentialRefresh, true);
        const country = String(job.request?.country || textValue(ensured.payload, "country") || "my").toLowerCase();
        remote = await lazadaRequest({ payload: { ...ensured.payload, country }, path: "/seller/get" });
        if (ensured.refreshed) credentialRefresh = { payload: ensured.payload, expiresAt: ensured.credentialExpiresAt };
      } else throw new Error("이 채널은 판매점 대상 조회를 지원하지 않습니다.");
      const providerCode = String(remote.data.code ?? "");
      const providerError = textValue(remote.data, "error");
      const ok = remote.response.ok && !providerError && (!providerCode || providerCode === "0");
      result = {
        ok,
        channel: job.channel,
        operation: "shops.get",
        steps: [{ name: job.channel === "shopee" ? "shop-info" : "seller-info", ok, status: remote.response.status, data: remote.data }],
        safeMessage: ok ? `${job.channel} 판매자 대상 정보를 확인했습니다.` : `${job.channel} 판매자 대상 조회가 원격 오류로 종료됐습니다.`,
      };
    } else if (job.operation === "competitor.search") {
      if (job.channel !== "elevenst") throw new Error("이 채널은 경쟁가 검색 작업을 지원하지 않습니다.");
      const primary = String(job.request?.primary ?? "").replace(/\p{Cc}/gu, " ").trim().slice(0, 160);
      const aliases = Array.isArray(job.request?.aliases)
        ? job.request.aliases.filter((alias) => typeof alias === "string").map((alias) => alias.replace(/\p{Cc}/gu, " ").trim().slice(0, 160)).filter((alias) => alias.length >= 2).slice(0, 12)
        : [];
      const displayPerQuery = Math.max(1, Math.min(30, Number(job.request?.displayPerQuery ?? 30) || 30));
      if (primary.length < 2) throw new Error("경쟁가 검색어가 올바르지 않습니다.");
      await assertGatewayLeaseHealthy();
      const items = await searchElevenstProductVariants(primary, aliases, { apiKey: textValue(job.credential, "api_key") }, displayPerQuery);
      result = { ok: true, channel: "elevenst", operation: "competitor.search", items, safeMessage: `11번가 공식 상품검색에서 후보 ${items.length}건을 확인했습니다.` };
    } else if (job.operation === "listing.lineage.verify") {
      if (job.request?.sellerpilotLineageVersion !== "provider_listing_readback_v1") {
        throw new Error("상품 계보 재검증 버전이 올바르지 않습니다.");
      }
      const operationArguments = job.request?.arguments;
      if (!operationArguments || typeof operationArguments !== "object" || Array.isArray(operationArguments)) {
        throw new Error("상품 계보 재검증 인자가 올바르지 않습니다.");
      }
      if (job.channel === "smartstore") {
        const adoptionJob = smartstoreManualAdoptionReadbackJobSchema.safeParse(
          operationArguments.sellerpilotSmartstoreManualAdoptionReadback,
        );
        if (!adoptionJob.success
            || job.environment !== "production"
            || adoptionJob.data.credentialId !== job.credential_id) {
          throw new Error("SMARTSTORE_MANUAL_ADOPTION_READBACK_JOB_INVALID");
        }
        await assertGatewayLeaseHealthy();
        const readback = await collectSmartstoreManualAdoptionReadback({
          credential: job.credential,
          target: { sellerSku: adoptionJob.data.sellerSku },
          signal: gatewayExecutionSignal,
        });
        await assertGatewayLeaseHealthy();
        result = {
          ok: true,
          channel: "smartstore",
          operation: "listing.lineage.verify",
          verificationStatus: "verified",
          evidence: {
            contract: "smartstore_manual_adoption_readback_result_v1",
            readback,
          },
          steps: [{
            name: "smartstore-manual-adoption-readback",
            ok: true,
            status: 200,
            data: {
              sellerpilotVerification: "SMARTSTORE_MANUAL_ADOPTION_READBACK_VERIFIED",
              providerMutationPerformed: false,
              detailImageCount: readback.detailImageUrls.length,
            },
          }],
          safeMessage: "스마트스토어 공식 API에서 기존 상품과 상세 이미지 8개를 읽기 전용으로 확인했습니다.",
        };
      } else {
        if (!["qoo10", "shopee", "lazada", "ebay"].includes(job.channel)) {
          throw new Error("이 채널은 공급자 상품 계보 재검증을 지원하지 않습니다.");
        }
        await assertGatewayLeaseHealthy();
        result = await executeProviderListingLineageVerification({
          channel: job.channel,
          payload: job.credential,
          arguments: operationArguments,
          environment: job.environment,
          onExternalMutationStart: markExternalMutationStarted,
          onCredentialRefresh: rememberCredentialRefresh,
        });
      }
    } else if (job.operation === "diagnostic.test") {
      let diagnosticCredential = job.credential;
      if (job.channel === "shopee") {
        await assertGatewayLeaseHealthy();
        const ensured = await ensureShopeeAccessToken(diagnosticCredential, job.environment, undefined, "", markExternalMutationStarted, rememberCredentialRefresh, true);
        diagnosticCredential = ensured.payload;
        if (ensured.refreshed) credentialRefresh = { payload: ensured.payload, expiresAt: ensured.credentialExpiresAt };
      } else if (job.channel === "lazada") {
        await assertGatewayLeaseHealthy();
        const ensured = await ensureLazadaAccessToken(diagnosticCredential, undefined, markExternalMutationStarted, rememberCredentialRefresh, true);
        diagnosticCredential = ensured.payload;
        if (ensured.refreshed) credentialRefresh = { payload: ensured.payload, expiresAt: ensured.credentialExpiresAt };
      } else if (job.channel === "ebay") {
        await assertGatewayLeaseHealthy();
        const ensured = await ensureEbayAccessToken(diagnosticCredential, job.environment, undefined, markExternalMutationStarted, rememberCredentialRefresh, true);
        diagnosticCredential = ensured.payload;
        if (ensured.refreshed) credentialRefresh = { payload: ensured.payload, expiresAt: ensured.credentialExpiresAt };
      }
      await assertGatewayLeaseHealthy();
      const diagnostic = await runChannelDiagnostic(job.channel, diagnosticCredential, job.environment);
      result = {
        ok: diagnostic.status !== "failed",
        channel: job.channel,
        operation: "diagnostic.test",
        diagnostic,
        safeMessage: diagnostic.message,
      };
    } else {
      let credential = job.credential;
      let operationArguments = job.request?.arguments ?? {};
      const activationArgumentsAreRecord = Boolean(
        operationArguments
        && typeof operationArguments === "object"
        && !Array.isArray(operationArguments),
      );
      const activationMarkerSupplied = activationArgumentsAreRecord
        && Object.hasOwn(operationArguments, qoo10S1ActivationArgument);
      if (activationMarkerSupplied !== (job.operation === "listing.activate")
          || (job.operation === "listing.activate"
            && (job.channel !== "qoo10"
              || !activationArgumentsAreRecord
              || !qoo10S1ActivationArgumentsValid(operationArguments)))) {
        throw new Error("QOO10_S1_ACTIVATION_SERVER_CONTEXT_REQUIRED");
      }
      let shopeeShopCredential;
      if (job.channel === "shopee") {
        const globalProduct = operationArguments.globalProduct === true;
        if (globalProduct) {
          if (job.operation === "listing.create") {
            const publish = operationArguments.publish && typeof operationArguments.publish === "object" ? operationArguments.publish : {};
            const shopId = String(publish.shop_id ?? operationArguments.shopId ?? operationArguments.shop_id ?? "").trim();
            await assertGatewayLeaseHealthy();
            const shopEnsured = await ensureShopeeAccessToken(credential, job.environment, 10 * 60 * 1000, shopId, markExternalMutationStarted, rememberCredentialRefresh, true);
            credential = shopEnsured.payload;
            shopeeShopCredential = shopEnsured.payload;
            if (shopEnsured.refreshed) credentialRefresh = { payload: shopEnsured.payload, expiresAt: shopEnsured.credentialExpiresAt };
          }
          const merchantId = String(operationArguments.merchantId ?? operationArguments.merchant_id ?? "").trim();
          await assertGatewayLeaseHealthy();
          const merchantEnsured = await ensureShopeeMerchantAccessToken(credential, job.environment, 10 * 60 * 1000, merchantId, markExternalMutationStarted, rememberCredentialRefresh, true);
          credential = merchantEnsured.payload;
          if (merchantEnsured.refreshed || credentialRefresh) credentialRefresh = { payload: merchantEnsured.payload, expiresAt: merchantEnsured.credentialExpiresAt };
        } else {
          const shopId = String(operationArguments.shopId ?? operationArguments.shop_id ?? "").trim();
          await assertGatewayLeaseHealthy();
          const ensured = await ensureShopeeAccessToken(credential, job.environment, 10 * 60 * 1000, shopId, markExternalMutationStarted, rememberCredentialRefresh, true);
          credential = ensured.payload;
          if (ensured.refreshed) credentialRefresh = { payload: ensured.payload, expiresAt: ensured.credentialExpiresAt };
        }
      } else if (job.channel === "lazada") {
        const country = String(operationArguments.country || textValue(credential, "country") || "my").toLowerCase();
        credential = { ...credential, country };
        await assertGatewayLeaseHealthy();
        const ensured = await ensureLazadaAccessToken(credential, undefined, markExternalMutationStarted, rememberCredentialRefresh, true);
        credential = ensured.payload;
        if (ensured.refreshed) credentialRefresh = { payload: ensured.payload, expiresAt: ensured.credentialExpiresAt };
      } else if (job.channel === "ebay") {
        await assertGatewayLeaseHealthy();
        const ensured = await ensureEbayAccessToken(credential, job.environment, undefined, markExternalMutationStarted, rememberCredentialRefresh, true);
        credential = ensured.payload;
        if (ensured.refreshed) credentialRefresh = { payload: ensured.payload, expiresAt: ensured.credentialExpiresAt };
        if (job.operation === "listing.create") {
          const incarnation = credentialIncarnation ?? (
            typeof job.credential_id === "string"
            && Number.isSafeInteger(Number(job.credential_version))
            && Number(job.credential_version) >= 1
            && typeof job.credential_fingerprint === "string"
              ? {
                id: job.credential_id,
                version: Number(job.credential_version),
                fingerprint: job.credential_fingerprint,
              }
              : null
          );
          if (!incarnation) throw new Error("EBAY_CREATE_CREDENTIAL_INCARNATION_REQUIRED");
          operationArguments = {
            ...operationArguments,
            sellerpilotEbayCredentialIncarnation: incarnation,
          };
        }
      }
      qoo10CreateCredential = credential;
      let elevenstCredentialVersion;
      if (job.channel === "elevenst" && job.operation === "listing.create") {
        await assertGatewayLeaseHealthy();
        const versionResponse = await persistWorkerCompletion(
          "/api/channel-gateway/worker/elevenst-credential-version",
          { jobId: job.id, claimToken },
          "11번가 자격증명 버전 확인 실패",
          GATEWAY_COMPLETION_TRANSIENT_GRACE_MS,
        );
        const versionReceipt = await versionResponse.clone().json().catch(() => null);
        elevenstCredentialVersion = assertElevenstGatewayCredentialVersionReceipt({
          receipt: versionReceipt,
          jobId: job.id,
          credentialId: job.credential_id,
          environment: job.environment,
        });
        await assertGatewayLeaseHealthy();
      }
      if (job.operation === "listing.create" || job.operation === "listing.update") {
        const strictShopeeSgCreate = job.channel === "shopee"
          && job.operation === "listing.create"
          && operationArguments.globalProduct === true
          && shopeeSgListingCreateRequested(operationArguments);
        const lazadaGetRecoveryCreate = job.channel === "lazada"
          && job.operation === "listing.create"
          && lazadaGatewayCreateReceiptKindFromArguments(operationArguments) === "get_recovery";
        if (!strictShopeeSgCreate && !lazadaGetRecoveryCreate) {
          const preparedListing = await prepareListingArguments({
          channel: job.channel,
          operation: job.operation,
          credential,
          credentialId: job.credential_id,
          credentialVersion: elevenstCredentialVersion,
          arguments: operationArguments,
          environment: job.environment,
          signal: gatewayExecutionSignal,
          hooks: {
            assertLeaseHealthy: assertGatewayLeaseHealthy,
            beginProviderMutation: qoo10CreateBinding
              ? markQoo10CreateStarted
              : markExternalWriteStarted,
          },
          ...(shopeeShopCredential ? { shopeeShopCredential } : {}),
        });
          operationArguments = preparedListing.arguments;
          listingMediaWriteObserved = preparedListing.mediaMutationObserved;
          if (job.channel === "qoo10" && job.operation === "listing.create"
              && operationArguments
              && typeof operationArguments === "object"
              && !Array.isArray(operationArguments)) {
            qoo10CreateLookupArguments = operationArguments;
          }
          if (job.channel === "smartstore" && job.operation === "listing.create") {
            const body = operationArguments.body && typeof operationArguments.body === "object"
              && !Array.isArray(operationArguments.body)
              ? operationArguments.body
              : {};
            const source = operationArguments.sellerpilotSmartstoreCreateSource
              && typeof operationArguments.sellerpilotSmartstoreCreateSource === "object"
              && !Array.isArray(operationArguments.sellerpilotSmartstoreCreateSource)
              ? operationArguments.sellerpilotSmartstoreCreateSource
              : {};
            const transport = assertSmartstoreCreateTransport({
              body,
              transport: operationArguments[smartstoreCreateTransportArgument],
            });
            const bodyBindingSha256 = smartstoreCreateBodyBindingSha256(body);
            if (source.bodyBindingSha256 !== bodyBindingSha256) {
              throw new Error("SMARTSTORE_CREATE_BODY_BINDING_CHANGED");
            }
            const stageResponse = await persistWorkerCompletion(
              "/api/channel-gateway/worker/smartstore-create-transport",
              {
                jobId: job.id,
                claimToken,
                ...transport,
                bodyBindingSha256,
              },
              "스마트스토어 최종 전송 경계 저장 실패",
              GATEWAY_COMPLETION_TRANSIENT_GRACE_MS,
            );
            const stage = await stageResponse.json().catch(() => null);
            assertSmartstoreCreateTransport({
              body,
              transport,
              stage,
              expectedJobId: job.id,
            });
            operationArguments = {
              ...operationArguments,
              [smartstoreCreateTransportStageArgument]: stage,
            };
          }
        }
      }
      if (job.channel === "lazada" && job.operation === "categories.suggest") {
        console.log(`[Lazada category debug] query=${String(operationArguments.query || "").slice(0, 160)}`);
      }
      await assertGatewayLeaseHealthy();
      const strictShopeeSgCreate = job.channel === "shopee"
        && job.operation === "listing.create"
        && operationArguments.globalProduct === true
        && shopeeSgListingCreateRequested(operationArguments);
      const strictQoo10Create = job.channel === "qoo10"
        && job.operation === "listing.create";
      const strictCoupangCreate = job.channel === "coupang"
        && job.operation === "listing.create";
      const lazadaGetRecoveryCreate = job.channel === "lazada"
        && job.operation === "listing.create"
        && lazadaGatewayCreateReceiptKindFromArguments(operationArguments) === "get_recovery";
      if (strictQoo10Create && !qoo10CreateBinding) {
        throw new Error("QOO10_CREATE_FULFILLMENT_DURABLE_CONTEXT_REQUIRED");
      }
      if (writeChannelOperations.has(job.operation)
          && !strictShopeeSgCreate
          && !strictQoo10Create
          && !strictCoupangCreate
          && !lazadaGetRecoveryCreate) {
        await markExternalWriteStarted();
      }
      const executeListingOperation = () => executeCommerceOperation({
        channel: job.channel,
        operation: job.operation,
        payload: credential,
        arguments: operationArguments,
        environment: job.environment,
        ...(shopeeShopCredential ? { shopeeShopCredential } : {}),
        ...(strictQoo10Create ? {
          signal: gatewayExecutionSignal,
          providerMutationHooks: {
            gatewayCredentialId: job.credential_id,
            assertLeaseHealthy: assertGatewayLeaseHealthy,
            begin: markQoo10CreateStarted,
          },
        } : strictShopeeSgCreate ? {
          signal: gatewayExecutionSignal,
          providerMutationHooks: {
            gatewayCredentialId: job.credential_id,
            assertLeaseHealthy: assertGatewayLeaseHealthy,
            begin: markExternalWriteStarted,
            readShopeeSgCreateStageState: () => shopeeStageRequest("state"),
            beginShopeeSgCreateStage: async (stage) => {
              const value = await shopeeStageRequest("begin", stage);
              externalWriteStarted = true;
              return value;
            },
            completeShopeeSgCreateStage: (stage) =>
              shopeeStageRequest("complete", stage),
            readShopeeSgCreateResume: async () => {
              const value = await shopeeStageRequest("resume");
              if (value.contract !== "sellerpilot-shopee-sg-create-resume/1") {
                throw new Error("SHOPEE_SG_RESUME_RECEIPT_INVALID");
              }
              if (value.status === "absent") return null;
              if (value.status !== "ready") {
                throw new Error("SHOPEE_SG_RESUME_RECEIPT_INVALID");
              }
              return value.receipt;
            },
            recordShopeeSgGlobalCreateReadback: (receipt) =>
              shopeeStageRequest("record-global", receipt).then(() => undefined),
            captureShopeeSgPreparedArguments: (prepared) => {
              operationArguments = prepared;
            },
          },
        } : strictCoupangCreate ? {
          providerMutationHooks: {
            begin: markCoupangCreateStarted,
            assertLeaseHealthy: assertGatewayLeaseHealthy,
          },
        } : {}),
      });
      result = lazadaGetRecoveryCreate
        ? await runWithProviderReadOnlyTransport(executeListingOperation)
        : await executeListingOperation();
      if (job.channel === "lazada" && job.operation === "listing.create") {
        result = applyLazadaGatewayCreateProviderResult(result, operationArguments);
      }
      if (listingMediaWriteObserved) {
        result.steps.unshift({
          name: "listing-image-upload",
          ok: true,
          status: 200,
          data: { sellerpilotMutation: "accepted" },
        });
      }
      const contentRepair = job.channel === "smartstore" && job.operation === "listing.update"
        ? smartstoreContentRepairBinding(operationArguments)
        : null;
      if (contentRepair && result.ok) {
        // Preserve the accepted PUT before the independent image reader can
        // fail. The final completion replaces this provisional journal only
        // after the full readback has been collected.
        await stageSmartstoreListingUpdateCompletionJournal({
          jobId: job.id,
          claimToken,
          status: "reconciliation_required",
          error: "SMARTSTORE_CONTENT_REPAIR_POSTWRITE_VERIFICATION_PENDING",
          result,
        }).catch(() => {
          console.error(`[채널 완료 증거 보존 실패] ${job.id} · 후속 조회 전 응답을 보존하지 못했습니다.`);
        });
      }
      if (contentRepair && result.ok) {
        const mutationEvidence = result.smartstoreContentRepair;
        if (!mutationEvidence
            || mutationEvidence.contract !== "smartstore_existing_content_repair_mutation_v1"
            || mutationEvidence.originProductNo !== contentRepair.originProductNo
            || mutationEvidence.channelProductNo !== contentRepair.channelProductNo
            || mutationEvidence.baselineBodySha256 !== contentRepair.baselineBodySha256
            || mutationEvidence.prewriteProtectedBodySha256 !== contentRepair.protectedBodySha256) {
          throw new Error("SMARTSTORE_CONTENT_REPAIR_MUTATION_EVIDENCE_INVALID");
        }
        await assertGatewayLeaseHealthy();
        const postwriteReadback = await collectSmartstoreManualAdoptionReadback({
          credential,
          target: { sellerSku: contentRepair.sellerSku },
          signal: gatewayExecutionSignal,
        });
        await assertGatewayLeaseHealthy();
        const evidence = buildSmartstoreContentRepairResult({
          binding: contentRepair,
          mutationEvidence,
          approvedTransmissionImages: operationArguments[smartstoreContentRepairTransmissionArgument],
          postwriteReadback,
        });
        result = {
          ok: true,
          channel: "smartstore",
          operation: "listing.update",
          steps: result.steps,
          remoteId: contentRepair.originProductNo,
          evidence,
          safeMessage: "스마트스토어 기존 상품에 승인된 콘텐츠를 반영하고 공식 재조회 증거를 확인했습니다.",
        };
      }
      if (job.channel === "lazada" && job.operation === "categories.suggest") {
        const names = result.steps.flatMap((entry) => entry?.data?.data?.categorySuggestions ?? []).map((entry) => entry.categoryName).slice(0, 10);
        console.log(`[Lazada category debug] candidates=${names.join(" | ")}`);
      }
      if (job.channel === "shopee" && job.operation === "listing.create" && operationArguments.globalProduct === true && shopeeShopCredential) {
        result = await verifyShopeeGlobalListingPostPublish({
          result,
          merchantCredential: credential,
          shopCredential: shopeeShopCredential,
          arguments: operationArguments,
          environment: job.environment,
          signal: gatewayExecutionSignal,
          hooks: {
            assertLeaseHealthy: assertGatewayLeaseHealthy,
            beginProviderMutation: strictShopeeSgCreate
              ? async () => {
                throw new Error("SHOPEE_SG_UNTRACKED_POSTPUBLISH_MUTATION");
              }
              : markExternalWriteStarted,
          },
        });
      }
    }
    const completionStatus = gatewayJobCompletionStatus(result.operation, result.ok, result.steps ?? []);
    result = { ...result, safeMessage: boundedGatewayCompletionError(result.safeMessage) };
    const completionPayload = completionStatus === "failed"
      ? { jobId: job.id, claimToken, status: "failed", error: result.safeMessage, ...(credentialRefresh ? { credentialRefresh } : {}) }
      : { jobId: job.id, claimToken, status: completionStatus, result, ...(completionStatus === "reconciliation_required" ? { error: result.safeMessage } : {}), ...(credentialRefresh ? { credentialRefresh } : {}) };
    const completionJournalPath = await stageSmartstoreListingUpdateCompletionJournal(completionPayload)
      .catch(() => {
        console.error(`[채널 완료 증거 보존 실패] ${job.id} · 로컬 journal을 기록하지 못했습니다.`);
        return null;
      });
    // Stop new heartbeats and await any in-flight renewal before persisting a
    // terminal result. A lost lease must preserve remote state for reconciliation.
    await assertGatewayLeaseHealthy();
    await stopGatewayHeartbeat();
    const completionResponse = await persistWorkerCompletion(
      "/api/channel-gateway/worker/complete",
      completionPayload,
      "채널 작업 결과 저장 실패",
      GATEWAY_COMPLETION_TRANSIENT_GRACE_MS,
    );
    const completionResponseBody = completionJournalPath
      ? await completionResponse.clone().json().catch(() => null)
      : null;
    if (completionJournalPath
        && smartstoreListingUpdateCompletionEvidenceStored(completionPayload, completionResponseBody)) {
      await clearSmartstoreListingUpdateCompletionJournal(completionJournalPath).catch(() => {
        console.error(`[채널 완료 증거 정리 보류] ${job.id} · 로컬 journal을 자동 재사용하지 않습니다.`);
      });
    }
    if (result.ok) console.log(`[채널 완료] ${job.channel} · ${job.operation} · ${job.id}`);
    else console.error(`[채널 원격 실패] ${job.channel} · ${job.operation} · ${job.id} · ${result.safeMessage}`);
  } catch (error) {
    let effectiveError = error;
    let qoo10CreateReconciliation;
    let qoo10CreateObservation;
    if (externalWriteStarted
        && job.channel === "qoo10"
        && job.operation === "listing.create") {
      try {
        qoo10CreateObservation = await readQoo10LocalCreateSellerCodeReconciliation({
          payload: qoo10CreateCredential,
          argumentsValue: qoo10CreateLookupArguments,
        });
      } catch {
        qoo10CreateObservation = null;
      }
      if (qoo10CreateObservation) {
        qoo10CreateReconciliation = qoo10GatewayCreateReconciliationResult(
          qoo10CreateObservation,
          error instanceof Error ? error.message.slice(0, 500) : "채널 작업 처리 오류",
        );
      }
    }
    if (!gatewayHeartbeatStopped) {
      try {
        await stopGatewayHeartbeat();
      } catch (heartbeatError) {
        effectiveError = heartbeatError;
      }
    }
    const message = effectiveError instanceof SmartstoreManualAdoptionError
      && effectiveError.causeCode
      ? `${effectiveError.message}:${effectiveError.causeCode}`.slice(0, 500)
      : effectiveError instanceof Error
        ? effectiveError.message.slice(0, 500)
        : "채널 작업 처리 오류";
    const terminalOwnershipLoss = effectiveError instanceof WorkerRequestTerminalError
      && [401, 404, 409].includes(effectiveError.status);
    const ebayPublicationRecovery = Boolean(job.ebay_publication_reconciliation);
    const retryableLineageReadback = job.operation === "listing.lineage.verify"
      && (isRetryableSmartstoreManualAdoptionReadbackError(effectiveError)
        || (!(effectiveError instanceof SmartstoreManualAdoptionError)
          && /LISTING_LINEAGE_TRANSIENT_PROVIDER_ERROR|fetch failed|ETIMEDOUT|ECONNRESET|EAI_AGAIN|UND_ERR_|aborted|network/i.test(message)));
    if (externalWriteStarted || retryableLineageReadback || ebayPublicationRecovery) {
      if (!terminalOwnershipLoss) {
        if (job.channel === "qoo10" && job.operation === "listing.create" && externalWriteStarted) {
          const observation = qoo10CreateObservation;
          const binding = qoo10DurableCreateFulfillmentBinding(
            qoo10CreateLookupArguments && typeof qoo10CreateLookupArguments === "object"
              && !Array.isArray(qoo10CreateLookupArguments)
              ? qoo10CreateLookupArguments
              : {},
          );
          const existingItemRejected = Boolean(observation
            && (observation.uniqueRemoteId === qoo10RetiredExistingItemCode
              || observation.exactRemoteIds.includes(qoo10RetiredExistingItemCode)
              || observation.sellerCode === qoo10RetiredExistingItemCode));
          if (observation
              && observation.lookupStatus === "observed"
              && typeof observation.httpStatus === "number"
              && (observation.matchStatus === "unique"
                || observation.matchStatus === "absent"
                || observation.matchStatus === "ambiguous")
              && binding
              && !existingItemRejected) {
            const requestSha256 = createHash("sha256").update(JSON.stringify({
              method: "ItemsLookup.GetItemDetailInfo",
              sellerCode: observation.sellerCode,
            })).digest("hex");
            const responseSha256 = createHash("sha256")
              .update(JSON.stringify(observation))
              .digest("hex");
            await persistWorkerCompletion(
              "/api/channel-gateway/worker/qoo10-create-boundary/recover",
              {
                jobId: job.id,
                claimToken,
                sourceId: binding.sourceId,
                requestSha256,
                responseSha256,
                observation: {
                  contract: observation.contract,
                  lookupStatus: "observed",
                  matchStatus: observation.matchStatus,
                  sellerCode: observation.sellerCode,
                  httpStatus: observation.httpStatus,
                  resultCode: observation.resultCode,
                  resultMessage: observation.resultMessage,
                  exactRemoteIds: observation.exactRemoteIds,
                  uniqueRemoteId: observation.uniqueRemoteId,
                  observedAt: observation.observedAt,
                },
              },
              "Qoo10 CREATE 공식 GET 복구 저장 실패",
              GATEWAY_COMPLETION_TRANSIENT_GRACE_MS,
            ).catch((completionError) => {
              const completionMessage = completionError instanceof Error
                ? completionError.message
                : "공식 GET 복구 저장 오류";
              console.error(`[채널 상태 저장 보류] ${job.id} · ${completionMessage}`);
            });
          }
        }
        await persistWorkerCompletion(
          "/api/channel-gateway/worker/complete",
          {
            jobId: job.id,
            claimToken,
            status: "reconciliation_required",
            error: boundedGatewayCompletionError(message),
            ...(qoo10CreateReconciliation ? { result: qoo10CreateReconciliation } : {}),
            ...(!credentialMutationInFlight && credentialRefresh ? { credentialRefresh } : {}),
          },
          "채널 작업 수동 확인 상태 저장 실패",
          GATEWAY_COMPLETION_TRANSIENT_GRACE_MS,
        ).catch((completionError) => {
          const completionMessage = completionError instanceof Error ? completionError.message : "수동 확인 상태 저장 오류";
          console.error(`[채널 상태 저장 보류] ${job.id} · ${completionMessage}`);
        });
      }
      console.error(`[채널 ${(retryableLineageReadback || ebayPublicationRecovery) && !externalWriteStarted ? "읽기 재시도 예정" : "수동 확인 필요"}] ${job.channel} · ${job.operation} · ${job.id} · ${message}`);
    } else if (effectiveError instanceof WorkerRequestTerminalError) {
      console.error(`[채널 상태 보존] ${job.channel} · ${job.operation} · ${job.id} · ${message}`);
    } else {
      await persistWorkerCompletion(
        "/api/channel-gateway/worker/complete",
        { jobId: job.id, claimToken, status: "failed", error: boundedGatewayCompletionError(message) },
        "채널 작업 실패 상태 저장 실패",
      ).catch((completionError) => {
        const completionMessage = completionError instanceof Error ? completionError.message : "완료 상태 저장 오류";
        console.error(`[채널 상태 저장 보류] ${job.id} · ${completionMessage}`);
      });
      console.error(`[채널 실패] ${job.channel} · ${job.operation} · ${message}`);
    }
  }
}
