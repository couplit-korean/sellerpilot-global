import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import type { GatewayClaim } from "../lib/channels/gateway-contract";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const {
  EBAY_LISTING_CONFIGURATION_FIELDS,
  assertEbayListingCreateConfiguration,
  missingEbayListingCreateConfiguration,
} = await import("../lib/channels/ebay-listing-configuration");
const {
  executeServerlessGatewayProviderJob,
} = await import("../lib/channels/serverless-gateway-provider");

function explicitArguments() {
  return {
    sku: "SELLERPILOT-EXPLICIT",
    inventoryItem: {
      product: { imageUrls: ["https://cdn.example.com/item.jpg"] },
    },
    offer: {
      marketplaceId: "EBAY_US",
      listingPolicies: {
        fulfillmentPolicyId: "fulfillment-operator",
        paymentPolicyId: "payment-operator",
        returnPolicyId: "return-operator",
      },
      merchantLocationKey: "warehouse-operator",
    },
  };
}

test("eBay listing configuration accepts only explicit policy and location values", () => {
  assert.deepEqual(
    missingEbayListingCreateConfiguration({
      offer: {
        listingPolicies: {
          fulfillmentPolicyId: " SERVER_MANAGED ",
          paymentPolicyId: "",
          returnPolicyId: null,
        },
      },
    }),
    [...EBAY_LISTING_CONFIGURATION_FIELDS],
  );
  assert.doesNotThrow(() => assertEbayListingCreateConfiguration(explicitArguments()));
});

test("directly queued eBay drafts are rejected before credential or provider mutation", async () => {
  const events: string[] = [];
  let providerCalls = 0;
  const arguments_ = explicitArguments();
  arguments_.offer.merchantLocationKey = "SERVER_MANAGED";
  const job: GatewayClaim = {
    id: "10000000-0000-4000-8000-000000000001",
    claim_token: "20000000-0000-4000-8000-000000000001",
    credential_id: "30000000-0000-4000-8000-000000000001",
    channel: "ebay",
    operation: "listing.create",
    environment: "production",
    request: { arguments: arguments_ },
    credential: {},
    attempt_count: 1,
  };

  await assert.rejects(
    executeServerlessGatewayProviderJob({
      job,
      signal: new AbortController().signal,
      hooks: {
        assertLeaseHealthy: async () => { events.push("lease"); },
        beginProviderMutation: async () => { events.push("provider-mutation"); },
        beginCredentialMutation: async () => { events.push("credential-mutation"); },
        stageCredentialRefresh: async () => { events.push("credential-stage"); },
      },
    }, async () => {
      providerCalls += 1;
      throw new Error("provider must not run");
    }),
    /EBAY_LISTING_CONFIGURATION_REQUIRED:offer\.merchantLocationKey/,
  );
  assert.deepEqual(events, []);
  assert.equal(providerCalls, 0);
});

test("eBay executor contains no policy auto-selection or hard-coded location provisioning", async () => {
  const source = await readFile(
    new URL("../lib/channels/operations.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /sellerpilot-seoul|Teheran-ro/);
  assert.doesNotMatch(source, /sell\/account\/v1\/(?:fulfillment|payment|return)_policy/);
  assert.doesNotMatch(source, /sell\/inventory\/v1\/location/);
});
