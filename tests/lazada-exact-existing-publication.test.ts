import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  lazadaExactExistingCentralSkuVerified,
  lazadaExactExistingCreateForbidden,
  lazadaExactExistingPublicationCandidate,
  lazadaExactExistingPublicationIdentity as identity,
} from "../lib/channels/lazada-exact-existing-identity";
import { listingUpdateServerCandidate } from "../lib/channels/listing-update";
import {
  prepareLazadaListing,
  type LazadaListingRuntimeDependencies,
  type PrepareProviderListingInput,
} from "../lib/channels/provider-listing-runtime";
import { SERVERLESS_STATIC_EGRESS_CHANNELS } from "../lib/channels/serverless-static-egress";

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

test("serverless gateway rejects a stale exact create before OAuth preparation", () => {
  const source = readFileSync(
    new URL("../lib/channels/serverless-gateway-provider.ts", import.meta.url),
    "utf8",
  );
  const fence = source.indexOf("lazadaExactExistingCreateForbidden({ argumentsValue: rawArguments })");
  assert.equal(fence > source.indexOf("const rawArguments = requestArguments"), true);
  assert.equal(fence < source.indexOf("const preparedCredential = await prepareCredential"), true);
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
