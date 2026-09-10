import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { buildChannelArguments } from "../app/product-publish-workbench";
import { setRegistrationValue } from "../lib/channel-registration-form";

const productId = "90000000-0000-4000-8000-000000000006";
const credentialId = "91000000-0000-4000-8000-000000000006";
const attemptId = "92000000-0000-4000-8000-000000000006";
const listingLedgerId = "94000000-0000-4000-8000-000000000006";
const release = "6".repeat(40);
const detailRoles = [
  "detail-overview", "detail-context", "detail-package", "detail-feature",
  "detail-contents", "detail-use", "detail-care", "detail-routine",
];

const target = {
  targetId: "EBAY_US",
  displayName: "United States",
  marketCode: "US",
  locale: "en-US",
  language: "English",
  currency: "USD",
};

function publishContext() {
  return {
    contentMode: "ai_generated" as const,
    product: {
      id: productId,
      externalCode: "FIXTURE-EBAY-006-R2",
      sku: "FIXTURE-EBAY-006-R2",
      name: "Fixture ceramic organizer",
      description: "Approved fixture description for the US listing.",
      sourceUrl: null,
      status: "draft",
    },
    manualFields: {
      productName: "Fixture ceramic organizer",
      description: "Approved fixture description for the US listing.",
      sellerSku: "FIXTURE-EBAY-006-R2",
      categoryHint: "Home organization",
      brandName: "Fixture Brand",
      manufacturer: "Fixture Maker",
      countryOfOrigin: "Korea, Republic of",
      material: "Ceramic",
      packageContents: "1 organizer",
      condition: "NEW" as const,
      gtinStatus: "NO_GTIN" as const,
      gtin: "",
      sellingPrice: 18.75,
      currency: "USD",
      stock: 3,
      weightKg: 0.4,
      packageLengthCm: 20,
      packageWidthCm: 12,
      packageHeightCm: 8,
      shippingFeeKrw: 0,
      shippingRule: "",
      packagingRule: "",
    },
    imageSpecs: [],
    assignments: [{
      channel: "ebay" as const,
      market: "US",
      categoryId: "20473",
      categoryPath: ["Home & Garden", "Organization"],
      providedAttributes: { Material: "Ceramic" },
      requiredAttributes: [],
      officialMetadata: {},
      status: "confirmed" as const,
      confirmedAt: "2026-09-09T00:00:00.000Z",
    }],
    listings: [],
    sourceImages: [{ path: "fixture/source.jpg", url: "https://fixture.invalid/source.jpg" }],
    generatedImages: [
      ...["square", "hero", "portrait", "wide"].map((id) => ({
        id,
        path: `fixture/generated/${id}.jpg`,
        url: `https://fixture.invalid/${id}.jpg`,
      })),
      ...detailRoles.map((id) => ({
        id,
        path: `fixture/generated/${id}.jpg`,
        url: `https://fixture.invalid/${id}.jpg`,
      })),
    ],
    localizedListings: [],
    detailData: null,
  };
}

function restoredWorkbenchArguments() {
  let draft = buildChannelArguments(
    "ebay",
    publishContext(),
    18.75,
    3,
    target,
    { weight: 0.4, length: 20, width: 12, height: 8 },
    18.75,
    null,
    {
      productId,
      channel: "ebay",
      environment: "production",
      market: "US",
      marketplaceId: "EBAY_US",
      fulfillmentPolicyId: "fixture-fulfillment-us",
      paymentPolicyId: "fixture-payment-us",
      returnPolicyId: "fixture-return-us",
      merchantLocationKey: "fixture-warehouse-us",
      updatedAt: "2026-09-09T00:00:00.000Z",
    },
  );
  draft = setRegistrationValue(draft, ["sellerpilotAssets", "shipping", "policyReview"], "확인");
  return draft;
}

type GatewayMode = "failure" | "success";
type GatewayInput = {
  arguments: Record<string, unknown>;
  listingCreate?: { currency: string; price: number; requestFingerprint: string };
};

async function loadActualRouteHarness() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.supabase.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "fixture-publishable-key";
  process.env.SUPABASE_SECRET_KEY = "fixture-secret-key";
  process.env.SELLERPILOT_RELEASE_SHA = release;

  let gatewayMode: GatewayMode = "failure";
  const gatewayInputs: GatewayInput[] = [];
  const userRpcCalls: string[] = [];
  const serviceRpcCalls: string[] = [];

  const approvedManifest = {
    version: 1,
    manifest: {
      contract: "sellerpilot_detail_image_manifest_v2",
      algorithm: "sha256",
      digest: "a".repeat(64),
      images: detailRoles.map((role, index) => ({
        role,
        path: `fixture/generated/${role}.jpg`,
        sourceSha256: (index + 1).toString(16).padStart(64, "0"),
      })),
    },
  };
  const routePublishContext = {
    contentMode: "ai_generated",
    generatedImagePaths: Object.fromEntries(detailRoles.map((role) => [role, `fixture/generated/${role}.jpg`])),
  };

  const userClient = {
    auth: {
      getUser: async () => ({ data: { user: { id: "fixture-admin" } }, error: null }),
    },
    rpc: async (name: string) => {
      userRpcCalls.push(name);
      if (name === "sellerpilot_is_admin") return { data: true, error: null };
      if (name === "sellerpilot_list_credentials") return {
        data: [{ id: credentialId, channel: "ebay", environment: "production", status: "active" }],
        error: null,
      };
      if (name === "sellerpilot_get_product_publish_context") return { data: routePublishContext, error: null };
      if (name === "sellerpilot_claim_channel_operation") return {
        data: { attempt_id: attemptId, duplicate: false, status: "running" },
        error: null,
      };
      return { data: null, error: null };
    },
  };
  const serviceClient = {
    rpc: async (name: string) => {
      serviceRpcCalls.push(name);
      if (name === "sellerpilot_service_listing_mutation_release_gate_status") return {
        data: {
          contract: "verified_publication_release_gate_v1",
          effectiveOpen: true,
          open: true,
          state: "open",
          openedChannel: null,
          openedRelease: release,
          attestedRelease: release,
          activeRuntimeRelease: release,
        },
        error: null,
      };
      return { data: true, error: null };
    },
    storage: {
      from: () => ({
        exists: async () => ({ data: true, error: null }),
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map((_, index) => ({ signedUrl: `https://fixture.invalid/signed-${index + 1}.jpg` })),
          error: null,
        }),
      }),
    },
  };

  class GatewayError extends Error {
    attemptId?: string;
    listingId?: string;
    jobId?: string;
  }
  const gatewayStub = {
    ChannelGatewayInProgressError: GatewayError,
    ChannelGatewayCredentialUnattestedError: GatewayError,
    ChannelGatewayListingAlreadyPublishedError: GatewayError,
    ChannelGatewayListingBlockedError: GatewayError,
    ChannelGatewayReconciliationRequiredError: GatewayError,
    ChannelGatewayRemoteFailedError: GatewayError,
    executeViaChannelGateway: async (input: GatewayInput) => {
      gatewayInputs.push({
        arguments: structuredClone(input.arguments),
        listingCreate: input.listingCreate ? structuredClone(input.listingCreate) : undefined,
      });
      if (gatewayMode === "failure") {
        return {
          listingId: listingLedgerId,
          result: {
            ok: false,
            channel: "ebay",
            operation: "listing.create",
            safeMessage: "fixture gateway rejected restored request",
            steps: [{ name: "publish", ok: false, status: 422, data: { reason: "fixture rejection" } }],
          },
        };
      }
      const fingerprint = String(input.arguments.publicationExpectedFingerprint ?? "");
      const remoteId = "fixture-listing-006-r2";
      return {
        listingId: listingLedgerId,
        result: {
          ok: true,
          channel: "ebay",
          operation: "listing.create",
          safeMessage: "fixture official listing readback verified",
          steps: [{ name: "publish-readback", ok: true, status: 200, data: { listingId: remoteId } }],
          remoteId,
          publicationStateContract: "verified_remote_state_v1",
          publicationIntent: "live",
          publicationFulfilled: true,
          remoteState: {
            verified: true,
            visibility: "live",
            providerStatus: "PUBLISHED",
            verifiedAt: "2026-09-09T00:00:00.000Z",
            evidence: {
              identityVerified: true,
              statusVerified: true,
              localeVerified: true,
              fingerprintVerified: true,
              imageCountVerified: true,
            },
            resources: { listingId: remoteId },
            locale: "en-US",
            fingerprint,
            imageCount: 8,
          },
        },
      };
    },
  };

  const routePath = resolve("app/api/admin/channel-operations/route.ts");
  const routeSource = await readFile(routePath, "utf8");
  const compiled = ts.transpileModule(routeSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: routePath,
  }).outputText;
  const actualRequire = createRequire(routePath);
  const routeModule = { exports: {} as Record<string, unknown> };
  const routeRequire = (specifier: string) => {
    if (specifier === "@supabase/supabase-js") {
      return { createClient: (_url: string, key: string) => key === "fixture-secret-key" ? serviceClient : userClient };
    }
    if (specifier === "next/server") {
      return { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } };
    }
    if (specifier.endsWith("/channels/gateway")) return gatewayStub;
    if (specifier.endsWith("/channels/marketplace-images")) {
      return { prepareMarketplaceImages: async (_client: unknown, _channel: string, args: Record<string, unknown>) => args };
    }
    if (specifier.endsWith("/server-product-detail-manifest")) {
      return {
        approvedProductDetailManifestFromPublishContext: () => ({ ok: true, value: approvedManifest }),
        bindMarketplaceArgumentsToApprovedDetailManifest: (args: Record<string, unknown>) => args,
        marketplaceArgumentsForApprovedDetailFingerprint: (args: Record<string, unknown>) => args,
      };
    }
    return actualRequire(specifier);
  };
  const sandbox = {
    module: routeModule,
    exports: routeModule.exports,
    require: routeRequire,
    __dirname: resolve("app/api/admin/channel-operations"),
    __filename: routePath,
    Buffer,
    console,
    process,
    Response,
    Request,
    URL,
    structuredClone,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(compiled, sandbox, { filename: routePath });
  const POST = routeModule.exports.POST as (request: Request) => Promise<Response>;
  assert.equal(typeof POST, "function");
  return {
    POST,
    gatewayInputs,
    userRpcCalls,
    serviceRpcCalls,
    setGatewayMode: (mode: GatewayMode) => { gatewayMode = mode; },
  };
}

function actualPostRequest(arguments_: Record<string, unknown>) {
  return new Request("http://fixture.local/api/admin/channel-operations", {
    method: "POST",
    headers: {
      authorization: "Bearer fixture-access-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      credentialId,
      channel: "ebay",
      operation: "listing.create",
      publicationIntent: "live",
      idempotencyKey: `listing:${productId}:ebay:fixture006r2`,
      confirmWrite: true,
      productId,
      currency: "USD",
      price: 18.75,
      market: "US",
      targetId: "EBAY_US",
      arguments: arguments_,
    }),
  });
}

test("actual channel-operations POST runs restored eBay values through route claim, gateway, and failure/success classification", async () => {
  const harness = await loadActualRouteHarness();
  const restored = restoredWorkbenchArguments();
  assert.equal(restored.sellerpilotAssets.shipping.policyReview, "확인");

  harness.setGatewayMode("failure");
  const failedResponse = await harness.POST(actualPostRequest(restored));
  const failed = await failedResponse.json();
  assert.equal(failedResponse.status, 422);
  assert.equal(failed.ok, false, JSON.stringify(failed));
  assert.equal(failed.safeMessage, "fixture gateway rejected restored request");

  harness.setGatewayMode("success");
  const succeededResponse = await harness.POST(actualPostRequest(restored));
  const succeeded = await succeededResponse.json();
  assert.equal(succeededResponse.status, 200);
  assert.equal(succeeded.ok, true);
  assert.equal(succeeded.remoteId, "fixture-listing-006-r2");
  assert.equal(succeeded.publicationFulfilled, true);
  assert.equal(succeeded.gateway, "vercel-serverless-channel-gateway");

  assert.equal(harness.gatewayInputs.length, 2);
  for (const input of harness.gatewayInputs) {
    assert.equal(input.arguments.sellerpilotAssets.shipping.policyReview, "확인");
    assert.equal(input.arguments.offer.listingPolicies.fulfillmentPolicyId, "fixture-fulfillment-us");
    assert.equal(input.arguments.offer.listingPolicies.paymentPolicyId, "fixture-payment-us");
    assert.equal(input.arguments.offer.listingPolicies.returnPolicyId, "fixture-return-us");
    assert.equal(input.arguments.offer.merchantLocationKey, "fixture-warehouse-us");
    assert.equal(input.arguments.offer.pricingSummary.price.currency, "USD");
    assert.equal(input.arguments.offer.pricingSummary.price.value, "18.75");
    assert.equal(input.listingCreate?.currency, "USD");
    assert.equal(input.listingCreate?.price, 18.75);
    assert.match(String(input.arguments.publicationExpectedFingerprint), /^[a-f0-9]{64}$/);
  }
  assert.equal(harness.userRpcCalls.filter((name) => name === "sellerpilot_claim_channel_operation").length, 2);
  assert.equal(harness.serviceRpcCalls.filter((name) => name === "sellerpilot_service_listing_mutation_release_gate_status").length, 2);
});
