import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  executeProviderListingLineageVerification,
  type VerificationDependencies,
} from "../lib/channels/listing-lineage-verification";
import {
  gatewayClaimSchema,
  gatewayWorkerCompletionSchema,
} from "../lib/channels/gateway-contract";
import type { RemoteResponse, SecretPayload } from "../lib/channels/protocols";

const JOB_ID = "00000000-0000-4000-8000-000000000002";
const CLAIM_TOKEN = "00000000-0000-4000-8000-000000000003";
const CREDENTIAL_ID = "00000000-0000-4000-8000-000000000004";

function remote(data: Record<string, unknown>, status = 200): RemoteResponse {
  return {
    response: new Response(JSON.stringify(data), { status }),
    data,
    text: JSON.stringify(data),
  };
}

function dependencies(overrides: Partial<VerificationDependencies>): VerificationDependencies {
  const unchanged = async (payload: SecretPayload) => ({
    payload,
    refreshed: false as const,
    credentialExpiresAt: null,
  });
  const unsupported = async (): Promise<RemoteResponse> => {
    throw new Error("unexpected provider request");
  };
  return {
    ensureShopeeAccessToken: unchanged,
    ensureLazadaAccessToken: unchanged,
    ensureEbayAccessToken: unchanged,
    shopeeRequest: unsupported,
    lazadaRequest: unsupported,
    ebayRequest: unsupported,
    qoo10Request: unsupported,
    ...overrides,
  } as VerificationDependencies;
}

test("Qoo10 lineage verification requires one exact account-scoped item code", async () => {
  const result = await executeProviderListingLineageVerification({
    channel: "qoo10",
    payload: { api_key: "secret-key" },
    environment: "production",
    arguments: {
      expectedRemoteId: "1234567890",
      market: "JP",
      targetId: "",
    },
  }, dependencies({
    qoo10Request: async ({ service, method, params }) => {
      assert.equal(service, "ItemsLookup");
      assert.equal(method, "GetItemDetailInfo");
      assert.equal(params.ItemCode, "1234567890");
      return remote({
        ResultCode: 0,
        ResultObject: { ItemCode: "1234567890", ItemTitle: "private title" },
      });
    },
  }));

  assert.equal(result.verificationStatus, "verified");
  assert.equal(result.evidence.verifiedRemoteId, "1234567890");
  assert.equal(result.evidence.targetId, "");
  assert.doesNotMatch(JSON.stringify(result), /private title|secret-key/);
});

test("Qoo10 lineage verification preserves an empty legacy market snapshot", async () => {
  const result = await executeProviderListingLineageVerification({
    channel: "qoo10",
    payload: { api_key: "secret-key" },
    environment: "production",
    arguments: {
      expectedRemoteId: "1234567890",
      market: "",
      targetId: "",
    },
  }, dependencies({
    qoo10Request: async ({ params }) => {
      assert.equal(params.ItemCode, "1234567890");
      return remote({
        ResultCode: 0,
        ResultObject: { ItemCode: "1234567890" },
      });
    },
  }));

  assert.equal(result.verificationStatus, "verified");
  assert.equal(result.evidence.market, "");
  assert.equal(result.evidence.targetId, "");
  assert.equal(result.evidence.verifiedRemoteId, "1234567890");
});

test("Qoo10 lineage verification rejects mixed or mismatched item identities", async () => {
  await assert.rejects(
    executeProviderListingLineageVerification({
      channel: "qoo10",
      payload: {},
      environment: "production",
      arguments: {
        expectedRemoteId: "1234567890",
        market: "JP",
        targetId: "qoo10-jp",
      },
    }, dependencies({
      qoo10Request: async () => remote({
        ResultCode: 0,
        ResultObject: [{ ItemCode: "1234567890" }, { GdNo: "different" }],
      }),
    })),
    /LISTING_LINEAGE_REMOTE_ID_MISMATCH:qoo10/,
  );
});

test("read-only provider throttling is classified for a safe retry", async () => {
  await assert.rejects(
    executeProviderListingLineageVerification({
      channel: "qoo10",
      payload: {},
      environment: "production",
      arguments: { expectedRemoteId: "1234567890", market: "JP", targetId: "" },
    }, dependencies({
      qoo10Request: async () => remote({ ResultCode: "429" }, 429),
    })),
    /LISTING_LINEAGE_TRANSIENT_PROVIDER_ERROR:qoo10Item:429/,
  );
});

test("Shopee lineage verification checks the exact shop and item without returning provider payloads", async () => {
  const paths: string[] = [];
  const result = await executeProviderListingLineageVerification({
    channel: "shopee",
    payload: { shop_id: "1719148844", access_token: "secret-token" },
    environment: "production",
    arguments: {
      expectedRemoteId: "99887766",
      market: "MY",
      targetId: "1719148844",
    },
  }, dependencies({
    shopeeRequest: async ({ path }) => {
      paths.push(path);
      if (path.endsWith("get_shop_info")) {
        return remote({ response: { shop_id: 1719148844, shop_name: "private seller" } });
      }
      return remote({ response: { item_list: [{ item_id: 99887766, item_name: "private product" }] } });
    },
  }));

  assert.equal(result.verificationStatus, "verified");
  assert.equal(result.evidence.verifiedRemoteId, "99887766");
  assert.deepEqual(paths, ["/api/v2/shop/get_shop_info", "/api/v2/product/get_item_base_info"]);
  assert.doesNotMatch(JSON.stringify(result), /private seller|private product|secret-token/);
});

test("Shopee lineage verification rejects a different item id", async () => {
  await assert.rejects(
    executeProviderListingLineageVerification({
      channel: "shopee",
      payload: { shop_id: "1719148844" },
      environment: "production",
      arguments: {
        expectedRemoteId: "99887766",
        market: "MY",
        targetId: "1719148844",
      },
    }, dependencies({
      shopeeRequest: async ({ path }) => path.endsWith("get_shop_info")
        ? remote({ response: { shop_id: 1719148844 } })
        : remote({ response: { item_list: [{ item_id: 99887766 }, { item_id: 123 }] } }),
    })),
    /LISTING_LINEAGE_REMOTE_ID_MISMATCH:shopee/,
  );
});

test("Lazada lineage verification binds the requested country endpoint to the exact nested item", async () => {
  let observedCountry = "";
  const result = await executeProviderListingLineageVerification({
    channel: "lazada",
    payload: { country: "sg", access_token: "secret-token" },
    environment: "production",
    arguments: {
      expectedRemoteId: "400050006",
      market: "my",
      targetId: "lazada-my-shop",
    },
  }, dependencies({
    ensureLazadaAccessToken: async (payload) => {
      observedCountry = String(payload.country ?? "");
      return { payload, refreshed: false as const, credentialExpiresAt: null };
    },
    lazadaRequest: async ({ payload, path, params }) => {
      assert.equal(path, "/product/item/get");
      assert.equal(params?.item_id, "400050006");
      assert.equal(payload.country, "my");
      return remote({ code: "0", data: { item: { item_id: "400050006", name: "private product" } } });
    },
  }));

  assert.equal(observedCountry, "my");
  assert.equal(result.verificationStatus, "verified");
  assert.equal(result.evidence.market, "MY");
  assert.doesNotMatch(JSON.stringify(result), /private product|secret-token/);
});

test("Lazada lineage verification rejects a country-item readback mismatch", async () => {
  await assert.rejects(
    executeProviderListingLineageVerification({
      channel: "lazada",
      payload: { country: "my" },
      environment: "production",
      arguments: {
        expectedRemoteId: "400050006",
        market: "MY",
        targetId: "lazada-my-shop",
      },
    }, dependencies({
      lazadaRequest: async () => remote({
        code: "0",
        data: { item: { item_id: "400050006" }, item_id: "different" },
      }),
    })),
    /LISTING_LINEAGE_REMOTE_ID_MISMATCH:lazada/,
  );
});

test("eBay keeps a listing unbound when an immutable SKU is unavailable", async () => {
  let providerCalled = false;
  const result = await executeProviderListingLineageVerification({
    channel: "ebay",
    payload: { marketplace_id: "EBAY_US" },
    environment: "production",
    arguments: {
      expectedRemoteId: "110000000777",
      market: "EBAY_US",
      targetId: "EBAY_US",
    },
  }, dependencies({
    ebayRequest: async () => {
      providerCalled = true;
      return remote({});
    },
  }));

  assert.equal(providerCalled, false);
  assert.equal(result.verificationStatus, "manual_required");
  assert.equal(result.evidence.reasonCode, "EBAY_MARKETPLACE_SKU_MISSING");
  assert.equal(result.evidence.verifiedRemoteId, null);
});

test("eBay lineage verification cross-checks SKU, offer id, marketplace, and public listing id", async () => {
  const urls: string[] = [];
  const result = await executeProviderListingLineageVerification({
    channel: "ebay",
    payload: { marketplace_id: "EBAY_US", access_token: "secret-token" },
    environment: "production",
    arguments: {
      expectedRemoteId: "110000000777",
      market: "US",
      targetId: "",
      marketplaceSku: "SELLERPILOT-777",
      providerResourceId: "offer-777",
    },
  }, dependencies({
    ebayRequest: async ({ path, query }) => {
      urls.push(`${path}?${query ?? ""}`);
      if (path.endsWith("/offer")) {
        return remote({ offers: [{
          offerId: "offer-777",
          sku: "SELLERPILOT-777",
          marketplaceId: "EBAY_US",
          title: "private title",
        }] });
      }
      return remote({
        offerId: "offer-777",
        sku: "SELLERPILOT-777",
        marketplaceId: "EBAY_US",
        listing: { listingId: "110000000777" },
        description: "private description",
      });
    },
  }));

  assert.equal(result.verificationStatus, "verified");
  assert.equal(result.evidence.providerResourceId, "offer-777");
  assert.equal(result.evidence.marketplaceSku, "SELLERPILOT-777");
  assert.equal(result.evidence.verifiedRemoteId, "110000000777");
  assert.equal(result.evidence.market, "US");
  assert.equal(result.evidence.targetId, "");
  assert.equal(urls.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /private title|private description|secret-token/);
});

test("eBay rejects any public listing id mismatch", async () => {
  await assert.rejects(
    executeProviderListingLineageVerification({
      channel: "ebay",
      payload: { marketplace_id: "EBAY_US" },
      environment: "production",
      arguments: {
        expectedRemoteId: "110000000777",
        market: "EBAY_US",
        targetId: "EBAY_US",
        marketplaceSku: "SELLERPILOT-777",
      },
    }, dependencies({
      ebayRequest: async ({ path }) => path.endsWith("/offer")
        ? remote({ offers: [{ offerId: "offer-777", sku: "SELLERPILOT-777", marketplaceId: "EBAY_US" }] })
        : remote({ offerId: "offer-777", sku: "SELLERPILOT-777", marketplaceId: "EBAY_US", listing: { listingId: "wrong" } }),
    })),
    /LISTING_LINEAGE_REMOTE_ID_MISMATCH:ebay/,
  );
});

test("gateway contracts accept only normalized listing lineage claims and completions", () => {
  const claim = gatewayClaimSchema.parse({
    id: JOB_ID,
    claim_token: CLAIM_TOKEN,
    credential_id: CREDENTIAL_ID,
    channel: "lazada",
    operation: "listing.lineage.verify",
    environment: "production",
    request: {
      sellerpilotLineageVersion: "provider_listing_readback_v1",
      arguments: {
        expectedRemoteId: "400050006",
        market: "MY",
        targetId: "lazada-my-shop",
      },
    },
    credential: { access_token: "secret" },
    attempt_count: 1,
  });
  assert.equal(claim.operation, "listing.lineage.verify");

  const completion = gatewayWorkerCompletionSchema.parse({
    jobId: JOB_ID,
    claimToken: CLAIM_TOKEN,
    status: "succeeded",
    result: {
      ok: true,
      channel: "lazada",
      operation: "listing.lineage.verify",
      verificationStatus: "verified",
      evidence: {
        expectedRemoteId: "400050006",
        verifiedRemoteId: "400050006",
        market: "MY",
        targetId: "lazada-my-shop",
        evidenceVersion: "provider_listing_readback_rebind_v1",
      },
      steps: [{
        name: "listing-lineage-readback",
        ok: true,
        status: 200,
        data: { sellerpilotVerification: "LAZADA_COUNTRY_ITEM_ID_VERIFIED" },
      }],
      safeMessage: "access_token=raw-secret",
    },
  });
  assert.equal(completion.status, "succeeded");
  assert.doesNotMatch(JSON.stringify(completion), /raw-secret|safeMessage/);

  const legacyQoo10Completion = gatewayWorkerCompletionSchema.parse({
    jobId: JOB_ID,
    claimToken: CLAIM_TOKEN,
    status: "succeeded",
    result: {
      ok: true,
      channel: "qoo10",
      operation: "listing.lineage.verify",
      verificationStatus: "verified",
      evidence: {
        expectedRemoteId: "1234567890",
        verifiedRemoteId: "1234567890",
        market: "",
        targetId: "",
        evidenceVersion: "provider_listing_readback_rebind_v1",
      },
      steps: [{
        name: "listing-lineage-readback",
        ok: true,
        status: 200,
        data: {
          sellerpilotVerification: "QOO10_ITEM_CODE_VERIFIED",
          verifiedRemoteId: "1234567890",
        },
      }],
    },
  });
  assert.equal(legacyQoo10Completion.status, "succeeded");

  assert.equal(gatewayWorkerCompletionSchema.safeParse({
    jobId: JOB_ID,
    claimToken: CLAIM_TOKEN,
    status: "succeeded",
    result: {
      ok: true,
      channel: "lazada",
      operation: "listing.lineage.verify",
      verificationStatus: "verified",
      evidence: {
        expectedRemoteId: "400050006",
        verifiedRemoteId: null,
        market: "my",
        targetId: "lazada-my-shop",
        evidenceVersion: "provider_listing_readback_rebind_v1",
      },
      steps: [],
      safeMessage: "forged",
    },
  }).success, false);

  const verifiedEvidence = {
    expectedRemoteId: "110000000777",
    verifiedRemoteId: "110000000777",
    market: "EBAY_US",
    targetId: "EBAY_US",
    evidenceVersion: "provider_listing_readback_rebind_v1",
  };
  const baseResult = {
    ok: true,
    operation: "listing.lineage.verify",
    verificationStatus: "verified",
    steps: [{
      name: "listing-lineage-readback",
      ok: true,
      status: 200,
      data: {
        sellerpilotVerification: "EBAY_OFFER_LISTING_ID_VERIFIED",
        verifiedRemoteId: "110000000777",
        providerResourceId: "offer-777",
      },
    }],
  };
  assert.equal(gatewayWorkerCompletionSchema.safeParse({
    jobId: JOB_ID,
    claimToken: CLAIM_TOKEN,
    status: "succeeded",
    result: { ...baseResult, channel: "ebay", evidence: verifiedEvidence },
  }).success, false, "eBay verified evidence must include exact SKU and offer ID");
  assert.equal(gatewayWorkerCompletionSchema.safeParse({
    jobId: JOB_ID,
    claimToken: CLAIM_TOKEN,
    status: "succeeded",
    result: {
      ...baseResult,
      channel: "ebay",
      evidence: { ...verifiedEvidence, marketplaceSku: "SKU-777", providerResourceId: "offer-777" },
      steps: [{
        ...baseResult.steps[0],
        data: { ...baseResult.steps[0].data, access_token: "raw-secret" },
      }],
    },
  }).success, false, "lineage steps must reject undeclared provider or secret data");
  assert.equal(gatewayWorkerCompletionSchema.safeParse({
    jobId: JOB_ID,
    claimToken: CLAIM_TOKEN,
    status: "succeeded",
    result: {
      ...baseResult,
      channel: "qoo10",
      evidence: {
        ...verifiedEvidence,
        market: "JP",
        targetId: "qoo10-jp",
        marketplaceSku: "must-not-cross-channels",
      },
      steps: [{
        name: "listing-lineage-readback",
        ok: true,
        status: 200,
        data: { sellerpilotVerification: "QOO10_ITEM_CODE_VERIFIED", verifiedRemoteId: "110000000777" },
      }],
    },
  }).success, false, "non-eBay evidence cannot carry eBay resource identifiers");

  assert.equal(gatewayWorkerCompletionSchema.safeParse({
    jobId: JOB_ID,
    claimToken: CLAIM_TOKEN,
    status: "succeeded",
    result: {
      ...baseResult,
      channel: "qoo10",
      evidence: {
        expectedRemoteId: "110000000777",
        verifiedRemoteId: "110000000777",
        market: "JP",
        targetId: "",
        evidenceVersion: "provider_listing_readback_rebind_v1",
      },
      steps: [{
        name: "listing-lineage-readback",
        ok: true,
        status: 200,
        data: { sellerpilotVerification: "QOO10_ITEM_CODE_VERIFIED", verifiedRemoteId: "110000000777" },
      }],
    },
  }).success, true, "legacy Qoo10 listings keep their exact empty target snapshot");
});

test("the worker routes lineage verification through the read-only normalized verifier", () => {
  const worker = readFileSync(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8");
  const branchStart = worker.indexOf('job.operation === "listing.lineage.verify"');
  const branchEnd = worker.indexOf('job.operation === "diagnostic.test"', branchStart);
  assert.ok(branchStart > 0 && branchEnd > branchStart);
  const branch = worker.slice(branchStart, branchEnd);

  assert.match(branch, /sellerpilotLineageVersion !== "provider_listing_readback_v1"/);
  assert.match(branch, /executeProviderListingLineageVerification/);
  assert.match(branch, /onCredentialRefresh: rememberCredentialRefresh/);
  assert.doesNotMatch(branch, /markExternalWriteStarted|externalWriteStarted\s*=\s*true/);
  assert.match(worker, /retryableLineageReadback[\s\S]*LISTING_LINEAGE_TRANSIENT_PROVIDER_ERROR/);
  assert.match(worker, /const workerVersion = "sellerpilot-cli-worker\/1\.43"/);
});
