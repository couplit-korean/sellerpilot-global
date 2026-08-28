import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { GatewayClaim } from "../lib/channels/gateway-contract";
import type { ChannelOperationName, ChannelOperationResult } from "../lib/channels/operations";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const {
  deriveServerlessCsGatewayCredentials,
  runServerlessCsGatewayDrain,
} = await import("../lib/channels/serverless-cs-gateway");
const {
  executeServerlessGatewayProviderJob,
  serverlessGatewayOperationAllowed,
} = await import("../lib/channels/serverless-gateway-provider");
const {
  verifyShopeeGlobalListingPostPublish,
} = await import("../lib/channels/provider-shopee-post-publish-runtime");

const CRON_SECRET = "serverless-generic-gateway-cron-secret";
const JOB_ID = "51000000-0000-4000-8000-000000000001";
const CLAIM_TOKEN = "52000000-0000-4000-8000-000000000001";
const CREDENTIAL_ID = "53000000-0000-4000-8000-000000000001";
const channels: GatewayClaim["channel"][] = [
  "qoo10", "shopee", "lazada", "coupang", "elevenst", "temu", "smartstore", "ebay",
];

const expectedWrites: Record<string, GatewayClaim["channel"][]> = {
  "listing.create": ["qoo10", "shopee", "lazada", "coupang", "elevenst", "temu", "smartstore", "ebay"],
  "listing.update": ["qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore"],
  "listing.stop": ["qoo10", "shopee", "lazada", "coupang", "elevenst", "temu", "smartstore"],
  "inventory.update": ["qoo10", "shopee", "lazada", "coupang", "temu", "smartstore", "ebay"],
  "shipment.acknowledge": ["qoo10", "shopee", "lazada", "coupang", "smartstore"],
  "shipment.confirm": ["qoo10", "shopee", "lazada", "coupang", "temu", "smartstore", "ebay"],
};

function genericClaim(
  channel: GatewayClaim["channel"],
  operation: GatewayClaim["operation"],
): GatewayClaim {
  return {
    id: JOB_ID,
    claim_token: CLAIM_TOKEN,
    credential_id: CREDENTIAL_ID,
    channel,
    operation,
    environment: "sandbox",
    request: { arguments: { remoteId: "remote-item-1" } },
    credential: { api_key: "private-test-key" },
    attempt_count: 1,
  };
}

function authorizedRequest() {
  const { wakeBearer } = deriveServerlessCsGatewayCredentials(CRON_SECRET);
  return new Request("https://sellerpilot.example/api/internal/channel-gateway-drain", {
    method: "POST",
    headers: { authorization: `Bearer ${wakeBearer}` },
  });
}

test("generic serverless operation matrix is exact and price updates stay closed", () => {
  for (const [operation, allowed] of Object.entries(expectedWrites)) {
    for (const channel of channels) {
      assert.equal(
        serverlessGatewayOperationAllowed(
          channel,
          operation as GatewayClaim["operation"],
        ),
        allowed.includes(channel),
        `${channel}:${operation}`,
      );
    }
  }
  const allChannels = [...channels];
  const expectedReads: Record<string, GatewayClaim["channel"][]> = {
    "categories.list": allChannels,
    "categories.suggest": allChannels,
    "categories.attributes": allChannels,
    "categories.validate": allChannels,
    "orders.get": ["qoo10", "shopee", "lazada", "coupang", "temu", "smartstore", "ebay"],
  };
  for (const [operation, allowed] of Object.entries(expectedReads)) {
    for (const channel of channels) {
      assert.equal(
        serverlessGatewayOperationAllowed(channel, operation as GatewayClaim["operation"]),
        allowed.includes(channel),
        `${channel}:${operation}`,
      );
    }
  }
  for (const channel of channels) {
    assert.equal(serverlessGatewayOperationAllowed(channel, "price.update"), false);
    assert.equal(serverlessGatewayOperationAllowed(channel, "orders.list"), true);
    assert.equal(serverlessGatewayOperationAllowed(channel, "diagnostic.test"), true);
    assert.equal(
      serverlessGatewayOperationAllowed(channel, "oauth.exchange"),
      ["shopee", "lazada", "ebay"].includes(channel),
    );
    assert.equal(
      serverlessGatewayOperationAllowed(channel, "shops.get"),
      ["shopee", "lazada"].includes(channel),
    );
    assert.equal(
      serverlessGatewayOperationAllowed(channel, "competitor.search"),
      channel === "elevenst",
    );
    assert.equal(
      serverlessGatewayOperationAllowed(channel, "listing.lineage.verify"),
      ["qoo10", "shopee", "lazada", "ebay"].includes(channel),
    );
    assert.equal(
      serverlessGatewayOperationAllowed(channel, "inquiries.list"),
      ["qoo10", "lazada", "coupang", "smartstore", "ebay", "temu"].includes(channel),
    );
    assert.equal(
      serverlessGatewayOperationAllowed(channel, "inquiries.reply"),
      ["qoo10", "lazada", "coupang", "smartstore", "ebay"].includes(channel),
    );
  }
});

test("a bounded provider write crosses the mutation fence and rechecks its lease", async () => {
  const events: string[] = [];
  const job = genericClaim("qoo10", "listing.stop");
  const result = await executeServerlessGatewayProviderJob({
    job,
    signal: new AbortController().signal,
    hooks: {
      assertLeaseHealthy: async () => { events.push("lease"); },
      beginProviderMutation: async () => { events.push("mutation-fence"); },
      beginCredentialMutation: async () => { throw new Error("unexpected credential mutation"); },
      stageCredentialRefresh: async () => { throw new Error("unexpected credential stage"); },
    },
  }, async (input) => {
    events.push("provider");
    assert.equal(input.channel, "qoo10");
    assert.equal(input.operation, "listing.stop");
    return {
      ok: true,
      channel: input.channel,
      operation: input.operation,
      steps: [{ name: "stop-display", ok: true, status: 200, data: { accepted: true } }],
      safeMessage: "listing stopped",
    };
  });
  assert.equal(result.ok, true);
  assert.deepEqual(events, ["lease", "mutation-fence", "lease", "provider"]);
});

for (const channel of ["coupang", "smartstore", "elevenst", "temu"] as const) {
  test(`${channel} generic writes fail before provider execution without static-egress attestation`, async () => {
    let claims = 0;
    let providerCalls = 0;
    const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
      cronSecret: CRON_SECRET,
      rpc: async (name) => {
        if (name === "sellerpilot_service_enqueue_periodic_sync") {
          return { data: { status: "already_pending" }, error: null };
        }
        if (name === "sellerpilot_claim_serverless_gateway_job") {
          claims += 1;
          return {
            data: claims === 1 ? genericClaim(channel, "listing.stop") : null,
            error: null,
          };
        }
        return { data: null, error: { code: "unexpected_rpc" } };
      },
      executeProvider: async () => {
        providerCalls += 1;
        throw new Error("provider must not run");
      },
    });
    assert.equal(response.status, 503);
    assert.equal(providerCalls, 0);
  });
}

test("an exception after the provider fence is stored as reconciliation without private details", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  let claims = 0;
  const privateMessage = "private upstream response and credential";
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    rpc: async (name, arguments_ = {}) => {
      calls.push({ name, arguments_ });
      if (name === "sellerpilot_service_enqueue_periodic_sync") {
        return { data: { status: "already_pending" }, error: null };
      }
      if (name === "sellerpilot_claim_serverless_gateway_job") {
        claims += 1;
        return { data: claims === 1 ? genericClaim("qoo10", "listing.stop") : null, error: null };
      }
      if (name === "sellerpilot_touch_serverless_cs_job") return { data: "running", error: null };
      if (name === "sellerpilot_service_begin_serverless_gateway_provider_mutation") {
        return { data: true, error: null };
      }
      if (name === "sellerpilot_service_serverless_cs_completion_context") {
        return {
          data: {
            status: "running",
            channel: "qoo10",
            operation: "listing.stop",
            normalization_timestamp: "2026-08-28T00:00:00.000Z",
          },
          error: null,
        };
      }
      if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
        return { data: { status: "completed" }, error: null };
      }
      return { data: null, error: { code: "unexpected_rpc" } };
    },
    executeProvider: async ({ hooks }) => {
      await hooks.beginProviderMutation();
      throw new Error(privateMessage);
    },
  });
  assert.equal(response.status, 200);
  const responseText = await response.text();
  assert.match(responseText, /reconciliation_required/);
  assert.doesNotMatch(responseText, new RegExp(privateMessage));
  const completion = calls.find(({ name }) =>
    name === "sellerpilot_service_complete_serverless_cs_transaction");
  assert.equal(completion?.arguments_.p_status, "reconciliation_required");
  assert.equal(completion?.arguments_.p_error_message, "serverless_cs_execution_failed");
  assert.doesNotMatch(JSON.stringify(completion), new RegExp(privateMessage));
});

test("order sync normalizes with the fenced completion timestamp and stores only a safe summary", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  let claims = 0;
  const job = genericClaim("ebay", "orders.list");
  const continuation = {
    reason: "page_cap_reached" as const,
    arguments: {
      query: { offset: 100 },
      sellerpilotPaginationDepth: 1,
    },
  };
  const rawResult: ChannelOperationResult = {
    ok: true,
    channel: "ebay",
    operation: "orders.list",
    steps: [{
      name: "orders",
      ok: true,
      status: 200,
      data: {
        orders: [{
          orderId: "order-1",
          buyer: { username: "private-buyer" },
          lineItems: [{ title: "private-product", quantity: 2 }],
          pricingSummary: { total: { value: "17.50", currency: "USD" } },
          orderPaymentStatus: "PAID",
          orderFulfillmentStatus: "NOT_STARTED",
        }],
        rawProviderToken: "private-raw-page-token",
      },
    }],
    continuation,
    safeMessage: "raw provider order result",
  };
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    rpc: async (name, arguments_ = {}) => {
      calls.push({ name, arguments_ });
      if (name === "sellerpilot_service_enqueue_periodic_sync") {
        return { data: { status: "already_pending" }, error: null };
      }
      if (name === "sellerpilot_claim_serverless_gateway_job") {
        claims += 1;
        return { data: claims === 1 ? job : null, error: null };
      }
      if (name === "sellerpilot_touch_serverless_cs_job") return { data: "running", error: null };
      if (name === "sellerpilot_service_serverless_cs_completion_context") {
        return {
          data: {
            status: "running",
            channel: "ebay",
            operation: "orders.list",
            normalization_timestamp: "2026-08-28T02:03:04.000Z",
          },
          error: null,
        };
      }
      if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
        return { data: { status: "completed" }, error: null };
      }
      return { data: null, error: { code: "unexpected_rpc" } };
    },
    executeProvider: async () => rawResult,
  });
  assert.equal(response.status, 200);
  const completion = calls.find(({ name }) =>
    name === "sellerpilot_service_complete_serverless_cs_transaction");
  assert.deepEqual(completion?.arguments_.p_normalized_orders, [{
    externalOrderId: "order-1",
    customerName: "private-buyer",
    productName: "private-product",
    quantity: 2,
    amount: 17.5,
    currency: "USD",
    amountKrw: 0,
    status: "paid",
    orderedAt: "2026-08-28T02:03:04.000Z",
  }]);
  assert.deepEqual(completion?.arguments_.p_response_payload, {
    ok: true,
    channel: "ebay",
    operation: "orders.list",
    steps: [{
      name: "orders-normalized",
      ok: true,
      status: 200,
      data: {
        sellerpilotMarker: "normalized_orders_v1",
        normalizedOrderCount: 1,
        providerStepCount: 1,
      },
    }],
    continuation,
    safeMessage: "주문 동기화 결과를 정규화해 저장했습니다.",
  });
  assert.doesNotMatch(
    JSON.stringify(completion?.arguments_.p_response_payload),
    /private-buyer|private-product|private-raw-page-token|raw provider order result/,
  );
});

test("successful OAuth completion keeps secrets only in credential staging", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  let claims = 0;
  const job = genericClaim("ebay", "oauth.exchange");
  const credentialRefresh = {
    payload: {
      client_id: "private-client-id",
      client_secret: "private-client-secret",
      access_token: "private-access-token",
      refresh_token: "private-refresh-token",
    },
    expiresAt: "2099-01-01T00:00:00.000Z",
    oauthComplete: true,
  };
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    rpc: async (name, arguments_ = {}) => {
      calls.push({ name, arguments_ });
      if (name === "sellerpilot_service_enqueue_periodic_sync") {
        return { data: { status: "already_pending" }, error: null };
      }
      if (name === "sellerpilot_claim_serverless_gateway_job") {
        claims += 1;
        return { data: claims === 1 ? job : null, error: null };
      }
      if (name === "sellerpilot_touch_serverless_cs_job") return { data: "running", error: null };
      if (name === "sellerpilot_service_begin_serverless_cs_credential_refresh") {
        return { data: true, error: null };
      }
      if (name === "sellerpilot_service_prepare_serverless_cs_credential_refresh") {
        return {
          data: { status: "prepared", credential_id: CREDENTIAL_ID },
          error: null,
        };
      }
      if (name === "sellerpilot_service_serverless_cs_completion_context") {
        return {
          data: {
            status: "running",
            channel: "ebay",
            operation: "oauth.exchange",
            normalization_timestamp: "2026-08-28T00:00:00.000Z",
          },
          error: null,
        };
      }
      if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
        return { data: { status: "completed" }, error: null };
      }
      return { data: null, error: { code: "unexpected_rpc" } };
    },
    executeProvider: async ({ hooks }) => {
      await hooks.beginCredentialMutation();
      await hooks.stageCredentialRefresh(credentialRefresh);
      return {
        ok: true,
        channel: "ebay",
        operation: "oauth.exchange",
        expiresAt: credentialRefresh.expiresAt,
        safeMessage: "eBay OAuth exchange completed.",
      };
    },
  });
  assert.equal(response.status, 200);
  const completion = calls.find(({ name }) =>
    name === "sellerpilot_service_complete_serverless_cs_transaction");
  assert.deepEqual(completion?.arguments_.p_response_payload, {
    ok: true,
    channel: "ebay",
    operation: "oauth.exchange",
    expiresAt: credentialRefresh.expiresAt,
    safeMessage: "eBay OAuth exchange completed.",
  });
  assert.deepEqual(completion?.arguments_.p_credential_refresh, credentialRefresh);
  assert.doesNotMatch(
    JSON.stringify(completion?.arguments_.p_response_payload),
    /credentialPayload|client_secret|access_token|refresh_token|private-/,
  );
  const staged = calls.find(({ name }) =>
    name === "sellerpilot_service_prepare_serverless_cs_credential_refresh");
  assert.deepEqual(staged?.arguments_.p_secret_payload, credentialRefresh.payload);
  assert.equal(staged?.arguments_.p_oauth_complete, true);
});

test("failed provider diagnostics complete transport successfully and persist the diagnostic atomically", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  let claims = 0;
  const job = genericClaim("qoo10", "diagnostic.test");
  const diagnostic = {
    status: "failed" as const,
    message: "필수 인증값 또는 OAuth 토큰이 누락됐습니다.",
  };
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    rpc: async (name, arguments_ = {}) => {
      calls.push({ name, arguments_ });
      if (name === "sellerpilot_service_enqueue_periodic_sync") {
        return { data: { status: "already_pending" }, error: null };
      }
      if (name === "sellerpilot_claim_serverless_gateway_job") {
        claims += 1;
        return { data: claims === 1 ? job : null, error: null };
      }
      if (name === "sellerpilot_touch_serverless_cs_job") return { data: "running", error: null };
      if (name === "sellerpilot_service_serverless_cs_completion_context") {
        return {
          data: {
            status: "running",
            channel: "qoo10",
            operation: "diagnostic.test",
            normalization_timestamp: "2026-08-28T00:00:00.000Z",
          },
          error: null,
        };
      }
      if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
        return { data: { status: "completed" }, error: null };
      }
      return { data: null, error: { code: "unexpected_rpc" } };
    },
    executeProvider: async () => ({
      ok: false,
      channel: "qoo10",
      operation: "diagnostic.test",
      diagnostic,
      safeMessage: diagnostic.message,
    }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { status: string }).status, "succeeded");
  const completion = calls.find(({ name }) =>
    name === "sellerpilot_service_complete_serverless_cs_transaction");
  assert.equal(completion?.arguments_.p_status, "succeeded");
  assert.deepEqual(completion?.arguments_.p_diagnostic, diagnostic);
});

test("listing lineage uses its dedicated exact-claim completion instead of the generic ledger", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  let claims = 0;
  const job = genericClaim("qoo10", "listing.lineage.verify");
  job.request = {
    sellerpilotLineageVersion: "provider_listing_readback_v1",
    arguments: {
      expectedRemoteId: "QOO10-ITEM-1",
      market: "",
      targetId: "",
    },
  };
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    rpc: async (name, arguments_ = {}) => {
      calls.push({ name, arguments_ });
      if (name === "sellerpilot_service_enqueue_periodic_sync") {
        return { data: { status: "already_pending" }, error: null };
      }
      if (name === "sellerpilot_claim_serverless_gateway_job") {
        claims += 1;
        return { data: claims === 1 ? job : null, error: null };
      }
      if (name === "sellerpilot_touch_serverless_cs_job") return { data: "running", error: null };
      if (name === "sellerpilot_service_serverless_cs_completion_context") {
        return {
          data: {
            status: "running",
            channel: "qoo10",
            operation: "listing.lineage.verify",
            normalization_timestamp: "2026-08-28T00:00:00.000Z",
          },
          error: null,
        };
      }
      if (name === "sellerpilot_complete_listing_lineage_verification") {
        return { data: { status: "bound", job_id: JOB_ID }, error: null };
      }
      return { data: null, error: { code: "unexpected_rpc" } };
    },
    executeProvider: async () => ({
      ok: true,
      channel: "qoo10",
      operation: "listing.lineage.verify",
      verificationStatus: "verified",
      evidence: {
        expectedRemoteId: "QOO10-ITEM-1",
        verifiedRemoteId: "QOO10-ITEM-1",
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
          verifiedRemoteId: "QOO10-ITEM-1",
        },
      }],
      safeMessage: "Qoo10 상품 계보를 확인했습니다.",
    }),
  });
  assert.equal(response.status, 200);
  const lineageCompletion = calls.find(({ name }) =>
    name === "sellerpilot_complete_listing_lineage_verification");
  assert.equal(lineageCompletion?.arguments_.p_status, "succeeded");
  assert.deepEqual(lineageCompletion?.arguments_.p_response_payload, {
    ok: true,
    channel: "qoo10",
    operation: "listing.lineage.verify",
    evidenceVersion: "provider_listing_readback_v1",
    expectedRemoteId: "QOO10-ITEM-1",
    verifiedRemoteId: "QOO10-ITEM-1",
    market: "",
    targetId: "",
    verification: "exact_provider_readback",
  });
  assert.equal(
    calls.some(({ name }) => name === "sellerpilot_service_complete_serverless_cs_transaction"),
    false,
  );
});

test("Shopee global stock correction is fenced and a failed final readback lowers the result", async () => {
  const events: string[] = [];
  let localReads = 0;
  const result = await verifyShopeeGlobalListingPostPublish({
    result: {
      ok: true,
      channel: "shopee",
      operation: "listing.create",
      remoteId: "12345",
      steps: [{ name: "product-create", ok: true, status: 200, data: {} }],
      safeMessage: "created",
    },
    merchantCredential: { access_token: "merchant-token" },
    shopCredential: { access_token: "shop-token" },
    arguments: {
      globalProduct: true,
      publish: { item: { seller_stock: [{ stock: 5 }] } },
    },
    environment: "sandbox",
    signal: new AbortController().signal,
    hooks: {
      assertLeaseHealthy: async () => { events.push("lease"); },
      beginProviderMutation: async () => { events.push("mutation-fence"); },
    },
  }, {
    shopeeRequest: async (input) => {
      events.push(`${input.method}:${input.path}`);
      if (input.method === "POST") {
        return {
          response: Response.json({ response: {} }),
          data: { response: {} },
        };
      }
      localReads += 1;
      const stock = localReads === 1 ? 1 : 4;
      const data = {
        response: {
          item_list: [{ stock_info_v2: { summary_info: { total_available_stock: stock } } }],
        },
      };
      return { response: Response.json(data), data };
    },
    shopeeMerchantRequest: async () => {
      throw new Error("unexpected merchant read");
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.steps.at(-1)?.name, "local-item-readback-final");
  assert.equal(result.steps.at(-1)?.ok, false);
  assert.ok(events.indexOf("mutation-fence") < events.indexOf("POST:/api/v2/product/update_stock"));
});

test("OAuth validates inputs before opening a credential mutation fence", async () => {
  let mutationCalls = 0;
  const job = genericClaim("ebay", "oauth.exchange");
  job.request = { code: "" };
  job.credential = {};
  await assert.rejects(
    executeServerlessGatewayProviderJob({
      job,
      signal: new AbortController().signal,
      hooks: {
        assertLeaseHealthy: async () => undefined,
        beginProviderMutation: async () => { throw new Error("unexpected provider mutation"); },
        beginCredentialMutation: async () => { mutationCalls += 1; },
        stageCredentialRefresh: async () => { throw new Error("unexpected credential stage"); },
      },
    }),
    /EBAY_OAUTH_INPUT_MISSING/,
  );
  assert.equal(mutationCalls, 0);
});

test("test-only provider result fixtures stay within channel operation contracts", () => {
  const operation: ChannelOperationName = "listing.stop";
  const result: ChannelOperationResult = {
    ok: true,
    channel: "qoo10",
    operation,
    steps: [{ name: "stop-display", ok: true, status: 200, data: {} }],
    safeMessage: "ok",
  };
  assert.equal(result.operation, operation);
});
