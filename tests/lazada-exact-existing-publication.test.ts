import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  bindLazadaExactExistingUpdateArguments,
  lazadaExactExistingCentralSkuVerified,
  lazadaExactExistingCreateForbidden,
  lazadaExactExistingPublicationCandidate,
  lazadaExactExistingPublicationIdentity as identity,
  lazadaExactExistingUpdateBindingValue,
} from "../lib/channels/lazada-exact-existing-identity";
import { listingUpdateServerCandidate } from "../lib/channels/listing-update";
import {
  prepareLazadaListing,
  type LazadaListingRuntimeDependencies,
  type PrepareProviderListingInput,
} from "../lib/channels/provider-listing-runtime";
import { SERVERLESS_STATIC_EGRESS_CHANNELS } from "../lib/channels/serverless-static-egress";
import { executeServerlessGatewayProviderJob } from "../lib/channels/serverless-gateway-provider";

const listing = {
  listingId: identity.listingId,
  remoteId: identity.remoteId,
  marketplaceSku: null,
  status: "failed",
  failureClass: "external_action" as const,
  requestedPublicationIntent: "live",
  remoteVisibility: "unknown",
  providerStatus: null,
  publishedAt: null,
};

function createArguments(sellerSku = `${identity.centralSku}-${identity.market}`) {
  return {
    country: identity.country,
    request: {
      Request: {
        Product: {
          Skus: { Sku: [{ SellerSku: sellerSku }] },
        },
      },
    },
  };
}

test("Lazada MY exact failed listing is update-only while every near-match remains blocked", () => {
  assert.equal(lazadaExactExistingPublicationCandidate({ channel: "lazada", ...listing }), true);
  assert.equal(listingUpdateServerCandidate("lazada", listing), true);
  assert.equal(listingUpdateServerCandidate("lazada", { ...listing, remoteId: "14976038920" }), false);
  assert.equal(listingUpdateServerCandidate("lazada", { ...listing, failureClass: "retryable" }), false);
  assert.equal(lazadaExactExistingCreateForbidden({ productId: identity.productId }), true);
  assert.equal(lazadaExactExistingCreateForbidden({
    productId: identity.productId,
    market: "SG",
  }), false);
  assert.equal(lazadaExactExistingCreateForbidden({ argumentsValue: createArguments() }), true);
  assert.equal(lazadaExactExistingCreateForbidden({
    argumentsValue: { ...createArguments(), country: "sg" },
  }), false);
});

test("Lazada exact central contract only accepts the confirmed central SKU", () => {
  assert.equal(lazadaExactExistingCentralSkuVerified({
    product: { sku: identity.centralSku },
    manualFields: { sellerSku: identity.centralSku },
  }), true);
  assert.equal(lazadaExactExistingCentralSkuVerified({
    product: { sku: identity.centralSku },
    manualFields: { sellerSku: "OTHER" },
  }), false);
});

test("Lazada OAuth flow is not incorrectly coupled to the fixed-egress channel allowlist", () => {
  assert.equal((SERVERLESS_STATIC_EGRESS_CHANNELS as readonly string[]).includes("lazada"), false);
});

test("admin route rejects the exact Lazada duplicate before credential or gateway work", () => {
  const route = readFileSync(
    new URL("../app/api/admin/channel-operations/route.ts", import.meta.url),
    "utf8",
  );
  const fence = route.indexOf("lazadaExactExistingCreateForbidden({");
  assert.equal(fence > route.indexOf("export async function POST"), true);
  assert.equal(fence < route.indexOf("const userClient = createClient"), true);
  assert.match(route.slice(fence, route.indexOf("const userClient = createClient")),
    /lazada_exact_existing_duplicate_create_forbidden/u);
});

test("admin route injects the Lazada seller target only after immutable lineage succeeds", () => {
  const route = readFileSync(
    new URL("../app/api/admin/channel-operations/route.ts", import.meta.url),
    "utf8",
  );
  const lineage = route.indexOf("sellerpilot_service_validate_listing_write_lineage");
  const binding = route.indexOf("sellerpilotExpectedSellerId: parsed.data.targetId");
  const claim = route.indexOf("sellerpilot_claim_channel_operation", binding);
  assert.equal(lineage > 0 && lineage < binding, true);
  assert.equal(binding > 0 && binding < claim, true);
  assert.match(route.slice(lineage, binding), /lineageStatus !== "allowed"/u);
});

test("admin route strips client Lazada authority and arms only the short exact server RPC", () => {
  const route = readFileSync(
    new URL("../app/api/admin/channel-operations/route.ts", import.meta.url),
    "utf8",
  );
  const strip = route.indexOf("delete effectiveArguments[lazadaExactExistingUpdateArgument]");
  const identityRpc = route.indexOf('"sellerpilot_service_get_lazada_exact_update_id"');
  const bind = route.indexOf("bindLazadaExactExistingUpdateArguments({");
  const arm = route.indexOf('"sellerpilot_service_arm_lazada_exact_update"');
  const claim = route.indexOf("sellerpilot_claim_channel_operation", bind);
  assert.equal(strip > 0 && identityRpc > 0 && bind > identityRpc, true);
  assert.equal(arm > bind && arm < claim, true);
  assert.doesNotMatch(
    route.slice(strip, bind),
    /parsed\.data\.arguments\.sellerpilotLazadaExactExistingUpdate/u,
  );
});

test("Lazada exact binding accepts only server-owned immutable lineage fields", () => {
  const binding = lazadaExactExistingUpdateBindingValue({
    contract: "lazada_exact_existing_my_live_update_v1",
    productId: identity.productId,
    listingId: identity.listingId,
    credentialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    itemId: identity.remoteId,
    sellerSku: `${identity.centralSku}-${identity.market}`,
    sellerAccountKey: "b".repeat(64),
    targetId: "200100300",
    lineageAttestationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    lineageEvidenceDigest: "c".repeat(64),
    approvedManifestDigest: "d".repeat(64),
    releaseSha: "e".repeat(40),
  });
  assert.ok(binding);
  assert.equal(lazadaExactExistingUpdateBindingValue({
    ...binding,
    itemId: "14976038920",
  }), null);
  const rebound = bindLazadaExactExistingUpdateArguments({
    sellerpilotLazadaExactExistingUpdate: { itemId: "attacker-item" },
    itemId: identity.remoteId,
    country: "my",
    publicationStateContract: "verified_remote_state_v1",
    publicationIntent: "live",
    publicationExpectedLocale: "ms-MY",
    publicationExpectedFingerprint: "f".repeat(64),
    publicationExpectedImageCount: 8,
    sellerpilotExpectedSellerId: binding.targetId,
    imageUrls: [
      "https://assets.example.test/hero.jpg",
      ...Array.from({ length: 8 }, (_, index) => `https://assets.example.test/detail-${index}.jpg`),
    ],
    sellerpilotAssets: { galleryImageUrls: ["https://assets.example.test/hero.jpg"] },
    sellerpilotPublicationAssetBinding: {
      contract: "sellerpilot_publication_asset_binding_v1",
      providerImageSurface: "detail_content",
      approvedManifestDigest: binding.approvedManifestDigest,
      providerTransportImages: Array.from({ length: 8 }, (_, index) => ({
        publicUrl: `https://assets.example.test/detail-${index}.jpg`,
      })),
    },
    sellerpilotLazadaPricePolicy: {
      contract: "lazada_krw_myr_reference_price_v1",
      sourceCurrency: "KRW",
      sourcePriceKrw: 5000,
      targetCurrency: "MYR",
      targetPriceMyr: 14.29,
    },
    request: { Request: { Product: {
      PrimaryCategory: "10100205",
      Skus: { Sku: [{
        SellerSku: `${identity.centralSku}-${identity.market}`,
        price: "14.29",
        quantity: "1",
        Status: "active",
      }] },
    } } },
  }, binding);
  assert.deepEqual(rebound.sellerpilotLazadaExactExistingUpdate, binding);
});

test("serverless gateway rejects a stale exact create before OAuth preparation", () => {
  const source = readFileSync(
    new URL("../lib/channels/serverless-gateway-provider.ts", import.meta.url),
    "utf8",
  );
  const fence = source.indexOf("lazadaExactExistingCreateForbidden({ argumentsValue: rawArguments })");
  assert.equal(fence > source.indexOf("const rawArguments = requestArguments"), true);
  assert.equal(fence < source.indexOf("const preparedCredential = await prepareCredential"), true);
});

test("serverless rejects malformed exact Lazada update authority before OAuth or provider work", async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  let mutationBegins = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    return Response.json({ code: "0", data: {} });
  };
  try {
    await assert.rejects(
      executeServerlessGatewayProviderJob({
        job: {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          claim_token: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          credential_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          channel: "lazada",
          operation: "listing.update",
          environment: "production",
          request: { arguments: {
            itemId: identity.remoteId,
            sellerpilotLazadaExactExistingUpdate: { itemId: identity.remoteId },
          } },
          credential: {
            app_key: "app",
            app_secret: "secret",
            access_token: "token",
            refresh_token: "refresh",
          },
          attempt_count: 1,
        },
        signal: new AbortController().signal,
        hooks: {
          assertLeaseHealthy: async () => undefined,
          beginProviderMutation: async () => { mutationBegins += 1; },
          beginCredentialMutation: async () => { mutationBegins += 1; },
          stageCredentialRefresh: async () => { mutationBegins += 1; },
        },
      }),
      /LAZADA_EXACT_EXISTING_UPDATE_SERVER_CONTEXT_REQUIRED/u,
    );
    assert.equal(fetches, 0);
    assert.equal(mutationBegins, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada exact duplicate create fails before image validation or a provider request", async () => {
  const events: string[] = [];
  const dependencies: LazadaListingRuntimeDependencies = {
    assertPublicReferenceUrl: async () => {
      events.push("image-validation");
      throw new Error("unexpected image validation");
    },
    lazadaRequest: async () => {
      events.push("provider-request");
      throw new Error("unexpected provider request");
    },
    loadKrwPerMyr: async () => {
      events.push("exchange-rate");
      throw new Error("unexpected exchange-rate request");
    },
  } as LazadaListingRuntimeDependencies;
  const input: PrepareProviderListingInput = {
    channel: "lazada",
    operation: "listing.create",
    credential: {},
    arguments: createArguments(),
    environment: "production",
    signal: new AbortController().signal,
    hooks: {
      assertLeaseHealthy: async () => { events.push("lease"); },
      beginProviderMutation: async () => { events.push("mutation"); },
    },
  };
  await assert.rejects(
    prepareLazadaListing(input, dependencies),
    /LAZADA_EXACT_EXISTING_DUPLICATE_CREATE_FORBIDDEN/u,
  );
  assert.deepEqual(events, []);
});
