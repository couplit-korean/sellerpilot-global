import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

import {
  buildChannelArguments,
  inspectWorkbenchListingDraft,
  missingNativeValues,
} from "../app/product-publish-workbench";
import {
  registrationPatches,
  registrationValueAt,
  setRegistrationValue,
} from "../lib/channel-registration-form";
import {
  publishRegistrationIdentity,
  restoreChannelRegistrationPatches,
  type PublishRegistrationData,
} from "../lib/publish-registration-draft";
import * as draftContract from "../lib/product-registration-draft";
import * as operationNames from "../lib/channels/operation-names";
import * as channelCatalog from "../lib/channels/catalog";

const actualRequire = createRequire(import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    if (specifier === "./marketplace-images"
      && context.parentURL?.endsWith("/lib/channels/provider-listing-runtime.ts")) {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export async function downloadMarketplaceImage(){return {bytes:new Uint8Array([255,216,255,217]),contentType:'image/jpeg'}}",
      };
    }
    return nextResolve(specifier, context);
  },
});
const { prepareMarketplaceListingArguments } = await import("../lib/channels/provider-listing-runtime");

const ownerId = "10000000-0000-4000-8000-000000000001";
const productId = "20000000-0000-4000-8000-000000000001";
const credentialId = "30000000-0000-4000-8000-000000000001";
const attemptId = "40000000-0000-4000-8000-000000000001";
const listingId = "50000000-0000-4000-8000-000000000001";
const releaseSha = "a".repeat(40);
const fingerprint = "b".repeat(64);
const categoryId = "50022679";
const identity = publishRegistrationIdentity("smartstore", "KR", "", credentialId);

type PublishContext = Parameters<typeof buildChannelArguments>[1];

function context(): PublishContext {
  const roles = [
    "detail-overview", "detail-feature", "detail-context", "detail-package",
    "detail-contents", "detail-use", "detail-routine", "detail-care",
  ];
  const urls = Array.from({ length: 9 }, (_, index) =>
    `https://shop-phinf.pstatic.net/20260909_sellerpilot/flow-${index}.jpg`);
  return {
    contentMode: "ai_generated",
    product: {
      id: productId,
      externalCode: "SMARTSTORE-FLOW-TEST",
      sku: "SMARTSTORE-FLOW-TEST",
      name: "스마트스토어 현재 흐름 검사 상품",
      description: "로컬 fixture로만 검사하는 상품입니다.",
      sourceUrl: null,
      status: "ready",
    },
    manualFields: {
      productName: "스마트스토어 현재 흐름 검사 상품",
      description: "로컬 fixture로만 검사하는 상품입니다.",
      sellerSku: "SMARTSTORE-FLOW-TEST",
      categoryHint: "생활용품",
      brandName: "SellerPilot Test",
      manufacturer: "SellerPilot Test",
      countryOfOrigin: "대한민국",
      material: "검사 재질",
      packageContents: "1개",
      condition: "NEW",
      gtinStatus: "NO_GTIN",
      gtin: "",
      sellingPrice: 10_000,
      currency: "KRW",
      stock: 1,
      shippingFeeKrw: 3_000,
      shippingRule: "",
      packagingRule: "",
      weightKg: 0.5,
      packageLengthCm: 10,
      packageWidthCm: 10,
      packageHeightCm: 10,
    },
    imageSpecs: [],
    assignments: [{
      channel: "smartstore",
      market: "KR",
      categoryId,
      categoryPath: ["생활용품"],
      providedAttributes: {},
      status: "confirmed",
      confirmedAt: "2026-09-09T00:00:00.000Z",
    }],
    listings: [],
    sourceImages: [{ path: "fixture/source.jpg", url: urls[0] }],
    generatedImages: [
      { id: "hero", path: "fixture/hero.jpg", url: urls[0] },
      ...roles.map((id, index) => ({ id, path: `fixture/${id}.jpg`, url: urls[index + 1] })),
    ],
    localizedListings: [],
  };
}

function baseDraft() {
  return buildChannelArguments(
    "smartstore", context(), 10_000, 1, undefined,
    { weight: 0.5, length: 10, width: 10, height: 10 }, 10,
  );
}

function set(value: Record<string, unknown>, path: string[], next: unknown) {
  return setRegistrationValue(value, path, next);
}

function completeDraft(incomplete: Record<string, unknown>) {
  const certification = ["body", "originProduct", "detailAttribute", "certificationTargetExcludeContent"];
  let value = incomplete;
  value = set(value, ["body", "originProduct", "detailAttribute", "unitCapacity", "unitPriceYn"], false);
  value = set(value, [...certification, "childCertifiedProductExclusionYn"], false);
  value = set(value, [...certification, "kcCertifiedProductExclusionYn"], "TRUE");
  value = set(value, [...certification, "greenCertifiedProductExclusionYn"], false);
  value = set(value, [...certification, "chemicalCertifiedProductExclusionYn"], false);
  value = set(value, ["body", "originProduct", "deliveryInfo", "deliveryCompany"], "HANJIN");
  value = set(value, ["body", "originProduct", "deliveryInfo", "deliveryFee", "deliveryFeeType"], "PAID");
  value = set(value, ["body", "originProduct", "deliveryInfo", "deliveryFee", "baseFee"], 3_000);
  value = set(value, ["body", "originProduct", "deliveryInfo", "claimDeliveryInfo", "returnDeliveryFee"], 3_000);
  value = set(value, ["body", "originProduct", "deliveryInfo", "claimDeliveryInfo", "exchangeDeliveryFee"], 6_000);
  value = set(value, ["body", "originProduct", "deliveryInfo", "claimDeliveryInfo", "shippingAddressId"], 12_345_678);
  value = set(value, ["body", "originProduct", "deliveryInfo", "claimDeliveryInfo", "returnAddressId"], 87_654_321);
  return value;
}

function registrationData(base: Record<string, unknown>, current: Record<string, unknown>): PublishRegistrationData {
  return {
    schemaVersion: 1,
    sourceFingerprint: "smartstore-current-flow-fixture",
    common: {
      fields: {}, price: 10_000, globalBaseUsdPrice: 10, quantity: 1,
      packageFields: { weight: 0.5, length: 10, width: 10, height: 10 },
    },
    channels: { [identity]: { categoryId, patches: registrationPatches(base, current) } },
  };
}

type StoredDraft = ReturnType<typeof draftContract.productRegistrationDraftRpcResult>;

async function draftRoutes() {
  const source = await readFile(new URL("../app/api/admin/product-registration-drafts/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let stored: StoredDraft = null;
  const serviceClient = {
    async rpc(name: string, parameters: Record<string, unknown>) {
      if (name === draftContract.PRODUCT_REGISTRATION_DRAFT_GET_RPC) return { data: stored, error: null };
      assert.equal(name, draftContract.PRODUCT_REGISTRATION_DRAFT_PUT_RPC);
      const expected = Number(parameters.p_expected_version);
      assert.equal(expected, stored?.version ?? 0);
      stored = {
        draftId: productId,
        kind: "publish",
        productId,
        version: expected + 1,
        data: parameters.p_data,
        updatedAt: `2026-09-09T00:00:0${expected + 1}.000Z`,
      } as StoredDraft;
      return { data: stored, error: null };
    },
  };
  const sandbox = vm.createContext({
    exports: {}, Request, Response, URL, TextEncoder,
    require(name: string) {
      if (name === "next/server") return { NextResponse: Response };
      if (name.endsWith("/admin-api")) return {
        authenticateAdminRequest: async () => ({ user: { id: ownerId }, serviceClient }),
        isAdminApiError: () => false,
      };
      if (name.endsWith("/product-registration-draft")) return draftContract;
      throw new Error(`unexpected draft import: ${name}`);
    },
  });
  vm.runInContext(compiled, sandbox);
  return sandbox.exports as {
    GET(request: Request): Promise<Response>;
    PUT(request: Request): Promise<Response>;
  };
}

async function putDraft(routes: Awaited<ReturnType<typeof draftRoutes>>, data: PublishRegistrationData, version: number) {
  const response = await routes.PUT(new Request("https://fixture.invalid/api/admin/product-registration-drafts", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ draftId: productId, kind: "publish", productId, expectedVersion: version, data }),
  }));
  assert.equal(response.status, 200);
}

async function getDraft(routes: Awaited<ReturnType<typeof draftRoutes>>) {
  const response = await routes.GET(new Request(
    `https://fixture.invalid/api/admin/product-registration-drafts?draftId=${productId}&kind=publish`,
  ));
  assert.equal(response.status, 200);
  return (await response.json() as { draft: NonNullable<StoredDraft> }).draft;
}

class GatewayError extends Error {
  attemptId = attemptId;
  listingId = listingId;
  jobId = "60000000-0000-4000-8000-000000000001";
  additionalEvidenceRequired = false;
}

type ProviderAudit = { calls: string[]; mutations: number; error?: string };

async function channelOperationRoute(gatewayArguments: Record<string, unknown>[], providerAudits: ProviderAudit[]) {
  const routeUrl = new URL("../app/api/admin/channel-operations/route.ts", import.meta.url);
  const actualRouteRequire = createRequire(routeUrl);
  const source = await readFile(routeUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const publishContext = context() as unknown as Record<string, unknown>;
  const manifest = {
    version: 1,
    manifest: {
      digest: fingerprint,
      images: Array.from({ length: 8 }, (_, index) => ({
        role: `detail-${index}`, path: `fixture/detail-${index}.jpg`, sourceSha256: fingerprint,
      })),
    },
  };
  const userClient = {
    auth: { getUser: async () => ({ data: { user: { id: ownerId } }, error: null }) },
    async rpc(name: string) {
      if (name === "sellerpilot_is_admin") return { data: true, error: null };
      if (name === "sellerpilot_list_credentials") return { data: [{ id: credentialId, channel: "smartstore", status: "active", environment: "production" }], error: null };
      if (name === "sellerpilot_get_product_publish_context") return { data: publishContext, error: null };
      if (name === "sellerpilot_claim_channel_operation") return { data: { attempt_id: attemptId, duplicate: false }, error: null };
      throw new Error(`unexpected user rpc: ${name}`);
    },
  };
  const serviceClient = {
    storage: { from: () => ({
      exists: async () => ({ data: true, error: null }),
      createSignedUrls: async (paths: string[]) => ({ data: paths.map((_, index) => ({ signedUrl: `https://signed.invalid/${index}.jpg` })), error: null }),
    }) },
    async rpc(name: string) {
      if (name === "sellerpilot_service_serverless_static_egress_status") return { data: { smartstore: true }, error: null };
      if (name === "sellerpilot_service_serverless_cs_wakeup_status") return { data: { configured: true, active: true, activeRelease: releaseSha }, error: null };
      if (name === "sellerpilot_service_listing_mutation_release_gate_status") return { data: {
        contract: "verified_publication_release_gate_v1", effectiveOpen: true,
        open: true, state: "open", openedChannel: null, openedRelease: releaseSha,
        attestedRelease: releaseSha, activeRuntimeRelease: releaseSha,
      }, error: null };
      if (name === "sellerpilot_service_fail_pre_gateway_channel_operation") return { data: true, error: null };
      throw new Error(`unexpected service rpc: ${name}`);
    },
  };
  let clientCount = 0;
  const noop = () => null;
  const requireModule = (name: string): unknown => {
    if (name === "node:crypto" || name === "zod") return actualRequire(name);
    if (name === "next/server") return { NextResponse: Response };
    if (name === "@supabase/supabase-js") return { createClient: () => (++clientCount % 2 === 1 ? userClient : serviceClient) };
    if (name.endsWith("/supabase/config")) return { supabaseUrl: "https://fixture.supabase.invalid", supabasePublishableKey: "fixture-key" };
    if (name.endsWith("/operation-names")) return operationNames;
    if (name.endsWith("/channels/catalog")) return channelCatalog;
    if (name.endsWith("/retired-product-recovery")) return { hasRetiredProductRecovery: () => false };
    if (name.endsWith("/operation-availability")) return { channelOperationRelease: () => ({ available: true, mode: "implemented", reason: "ready" }) };
    if (name.endsWith("/serverless-static-egress")) return {
      configuredServerlessStaticEgressChannels: () => ["smartstore"],
      hasServerlessStaticEgressFor: () => true,
      SERVERLESS_STATIC_EGRESS_REQUIRED: "SERVERLESS_STATIC_EGRESS_REQUIRED",
    };
    if (name.endsWith("/local-channel-executor")) return {
      externalDetailApprovalBindingFromPublishContext: noop,
      localChannelExecutorAccess: () => null,
      LOCAL_CHANNEL_EXECUTOR_READINESS_RPC: "unused",
      normalizeReleaseSha: (value: string) => value,
      parseLocalChannelExecutorReadiness: noop,
    };
    if (name.endsWith("/internal-scheduler-auth")) return { resolveRuntimeReleaseIdentity: () => ({ status: "valid", release: releaseSha }) };
    if (name.endsWith("/smartstore-local-read-routing")) return { isSmartstoreLocalReadOperation: () => false, resolveLocalGatewayReadReady: noop };
    if (name.endsWith("/server-product-detail-manifest")) return {
      approvedProductDetailManifestFromPublishContext: () => ({ ok: true, value: manifest }),
      bindMarketplaceArgumentsToApprovedDetailManifest: (value: Record<string, unknown>) => value,
      marketplaceArgumentsForApprovedDetailFingerprint: (value: Record<string, unknown>) => value,
    };
    if (name.endsWith("/marketplace-image-contract")) return { marketplaceChannelDetailImageCount: 8 };
    if (name.endsWith("/marketplace-images")) return { prepareMarketplaceImages: async (_client: unknown, _channel: unknown, value: Record<string, unknown>) => {
      const prepared = structuredClone(value);
      const assets = prepared.sellerpilotAssets as { galleryImageUrls: string[]; detailImageUrls: string[] };
      prepared.imageUrls = [assets.galleryImageUrls[0], ...assets.detailImageUrls];
      const body = prepared.body as { originProduct: { detailContent: string } };
      body.originProduct.detailContent = assets.detailImageUrls.map((url) => `<img src="${url}" />`).join("");
      return prepared;
    } };
    if (name.endsWith("/listing-shipping")) return { assertListingShippingReady: noop };
    if (name.endsWith("/listing-publication-state")) return {
      listingPublicationIntentSchema: z.enum(["safe_test", "live"]),
      listingRemoteStateContractVersion: "verified_remote_state_v1",
      listingOperationRequiresVerifiedRemoteState: () => true,
      listingOperationUsesPublicationIntent: () => true,
      listingExpectedPublicationLocale: () => "ko-KR",
      persistedListingPublicationReplay: noop,
      verifiedListingPublicationResult: () => ({ status: "verified" }),
    };
    if (name.endsWith("/listing-remediation")) return { applyListingRemediation: (result: unknown) => ({ result, remediation: null }) };
    if (name.endsWith("/gateway")) return {
      ChannelGatewayInProgressError: GatewayError,
      ChannelGatewayCredentialUnattestedError: GatewayError,
      ChannelGatewayListingAlreadyPublishedError: GatewayError,
      ChannelGatewayListingBlockedError: GatewayError,
      ChannelGatewayReconciliationRequiredError: GatewayError,
      ChannelGatewayRemoteFailedError: GatewayError,
      executeChannelTargetDiscovery: noop,
      executeViaChannelGateway: async (input: { arguments: Record<string, unknown> }) => {
        gatewayArguments.push(input.arguments);
        const calls: string[] = [];
        let mediaMutations = 0;
        const audit: ProviderAudit = { calls, mutations: 0 };
        providerAudits.push(audit);
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (request) => {
          const url = String(request); calls.push(url);
          if (url.endsWith(`/v1/categories/${categoryId}`)) return Response.json({ id: categoryId, last: true, exceptionalCategories: [], wholeCategoryName: "생활용품" });
          if (url.endsWith("/v1/products/search")) return Response.json({ page: 1, size: 50, totalElements: 0, totalPages: 0, first: true, last: true, contents: [] });
          if (url.endsWith("/v1/product-images/upload")) return Response.json({
            images: Array.from({ length: 9 }, (_, index) => ({
              url: `https://shop-phinf.pstatic.net/20260909_sellerpilot/uploaded-${index}.jpg`,
            })),
          });
          throw new Error(`unexpected provider request: ${url}`);
        };
        try {
          const prepared = await prepareMarketplaceListingArguments({
            channel: "smartstore", operation: "listing.create", environment: "production",
            credential: { access_token: "fixture-token", access_token_expires_at: "2099-01-01T00:00:00.000Z", after_service_phone: "02-1234-5678" },
            arguments: input.arguments,
            signal: new AbortController().signal,
            hooks: { assertLeaseHealthy: async () => {}, beginProviderMutation: async () => { mediaMutations += 1; audit.mutations = mediaMutations; } },
          });
          assert.equal(prepared.arguments.sellerpilotSmartstoreCreateContract, "smartstore_listing_create_v1");
          assert.deepEqual(calls.map((url) => new URL(url).pathname), [`/external/v1/categories/${categoryId}`, "/external/v1/products/search", "/external/v1/product-images/upload"]);
          assert.equal(mediaMutations, 1);
        } catch (error) {
          audit.error = error instanceof Error ? error.message : String(error);
          throw error;
        } finally { globalThis.fetch = originalFetch; }
        return { listingId, result: { ok: true, remoteId: "fixture-remote", publicationFulfilled: true, remoteState: { visibility: "live" }, safeMessage: "fixture verified" } };
      },
    };
    if (name.endsWith("/commerce-operations")) return { executeChannelOperation: noop };
    if (name.endsWith("/ebay-listing-configuration")) return { missingEbayListingCreateConfiguration: () => [] };
    if (name.endsWith("/smartstore-content-repair-contract")) return { smartstoreContentRepairArgument: "repair", smartstoreContentRepairTransmissionArgument: "repairImages" };
    if (name.endsWith("/server-smartstore-adoption-update-binding")) return {
      bindSmartstoreManualAdoptionUpdateArguments: (value: unknown) => value,
      hasClientSmartstoreManualAdoptionUpdateMarker: () => false,
      isSmartstoreManualAdoptionListing: () => false,
      readSmartstoreManualAdoptionUpdateBinding: noop,
      SmartstoreManualAdoptionUpdateBindingError: GatewayError,
    };
    if (name.endsWith("/listing-update")) return {
      elevenstListingUpdateProjectionDigestInput: noop,
      bindQoo10RollbackUpdateRecoveryArguments: (value: unknown) => value,
      listingUpdateRemoteIdentity: noop,
      listingUpdateServerCandidate: () => false,
      qoo10RollbackListingUpdateCandidate: () => false,
      qoo10RollbackUpdateRecoveryArgument: "rollback",
    };
    if (name.endsWith("/write-resource")) return { channelListingRemoteIdentity: noop, channelWriteResource: noop, listingLedgerRemoteIdentity: noop };
    if (name.endsWith("/listing-publication-content")) return { parseListingPublicationAssetBinding: noop };
    if (name.endsWith("/external-detail-import-api")) return { externalDetailImportTarget: "unused", readExternalDetailImportContext: noop, verifyExternalDetailOriginalSnapshot: noop };
    if (name.startsWith(".")) return actualRouteRequire(name);
    throw new Error(`unexpected channel operation import: ${name}`);
  };
  const sandbox = vm.createContext({
    exports: {}, Request, Response, URL, TextEncoder, AbortController,
    process: { env: { SUPABASE_SECRET_KEY: "fixture-secret" } }, structuredClone,
    require: requireModule,
  });
  vm.runInContext(compiled, sandbox);
  return sandbox.exports as { POST(request: Request): Promise<Response> };
}

test("SmartStore current UI draft survives save/reload and only complete input reaches the actual POST route", async () => {
  const base = baseDraft();
  const kcDecisionPath = ["body", "originProduct", "detailAttribute", "certificationTargetExcludeContent", "kcCertifiedProductExclusionYn"];
  let incomplete = completeDraft(base);
  incomplete = set(incomplete, kcDecisionPath, "");
  const routes = await draftRoutes();
  await putDraft(routes, registrationData(base, incomplete), 0);
  const firstRead = await getDraft(routes);
  const firstRestored = restoreChannelRegistrationPatches(baseDraft(), firstRead.data.channels[identity].patches);
  assert.equal(registrationValueAt(firstRestored, ["body", "originProduct", "detailAttribute", "certificationTargetExcludeContent", "childCertifiedProductExclusionYn"]), false);
  assert.ok(inspectWorkbenchListingDraft("smartstore", firstRestored).some((item) => item.status === "manual"));
  const gatewayArguments: Record<string, unknown>[] = [];
  const providerAudits: ProviderAudit[] = [];
  const route = await channelOperationRoute(gatewayArguments, providerAudits);
  const request = (argumentsValue: Record<string, unknown>) => new Request("https://fixture.invalid/api/admin/channel-operations", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer fixture-admin" },
    body: JSON.stringify({
      credentialId, channel: "smartstore", operation: "listing.create",
      publicationIntent: "live", idempotencyKey: "smartstore-current-flow-fixture",
      confirmWrite: true, productId, currency: "KRW", price: 10_000,
      market: "KR", targetId: "", arguments: argumentsValue,
    }),
  });
  const blockedResponse = await route.POST(request(firstRestored));
  assert.equal(blockedResponse.status, 422);
  assert.equal(providerAudits[0]?.error, "NAVER_CREATE_CERTIFICATION_DECISION_REQUIRED");
  assert.deepEqual(providerAudits[0]?.calls, []);
  assert.equal(providerAudits[0]?.mutations, 0);

  const complete = completeDraft(firstRestored);
  await putDraft(routes, registrationData(base, complete), 1);
  const secondRead = await getDraft(routes);
  const restored = restoreChannelRegistrationPatches(baseDraft(), secondRead.data.channels[identity].patches);
  assert.equal(registrationValueAt(restored, ["body", "originProduct", "detailAttribute", "certificationTargetExcludeContent", "childCertifiedProductExclusionYn"]), false);
  assert.equal(registrationValueAt(restored, ["body", "originProduct", "deliveryInfo", "deliveryFee", "baseFee"]), 3_000);
  assert.equal(registrationValueAt(restored, ["body", "originProduct", "detailAttribute", "productInfoProvidedNotice", "etc", "manufacturer"]), "SellerPilot Test");
  assert.deepEqual(inspectWorkbenchListingDraft("smartstore", restored).filter((item) => item.status === "manual"), []);
  assert.deepEqual(missingNativeValues("smartstore", restored), []);

  const response = await route.POST(request(restored));
  const payload = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 200, JSON.stringify({ payload, gatewayArguments }));
  assert.equal(payload.ok, true);
  assert.equal(payload.gateway, "vercel-serverless-channel-gateway");
  assert.equal(gatewayArguments.length, 2);
  assert.deepEqual(providerAudits[1]?.calls.map((url) => new URL(url).pathname), [
    `/external/v1/categories/${categoryId}`,
    "/external/v1/products/search",
    "/external/v1/product-images/upload",
  ]);
  assert.equal(providerAudits[1]?.mutations, 1);
});
