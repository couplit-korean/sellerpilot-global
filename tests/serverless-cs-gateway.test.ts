import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import type { ChannelOperationResult } from "../lib/channels/operations";
import {
  coupangRequest,
  runWithChannelRequestSignal,
} from "../lib/channels/protocols";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const {
  SERVERLESS_CS_DRAIN_CONCURRENCY,
  SERVERLESS_CS_ENQUEUE_CONCURRENCY,
  SERVERLESS_CS_EXECUTION_TIMEOUT_MS,
  SERVERLESS_GATEWAY_MAX_PERIODIC_JOBS_PER_FIVE_MINUTES,
  SERVERLESS_GATEWAY_RETRY_SAFE_READ_TIMEOUT_MS,
  SERVERLESS_CS_PERIODIC_MIN_INTERVAL_MINUTES,
  deriveServerlessCsGatewayCredentials,
  executeServerlessCsProviderJob,
  runOneServerlessCsGatewayJob,
  runServerlessCsGatewayDrain,
  serverlessGatewayExecutionTimeoutMs,
  serverlessCsCurrentInquiryEnqueues,
} = await import("../lib/channels/serverless-cs-gateway");

const CRON_SECRET = "serverless-cs-gateway-cron-secret";
const JOB_ID = "10000000-0000-4000-8000-000000000001";
const CLAIM_TOKEN = "20000000-0000-4000-8000-000000000001";
const CREDENTIAL_ID = "30000000-0000-4000-8000-000000000001";
const PREPARED_CREDENTIAL_ID = "40000000-0000-4000-8000-000000000001";

function authorizedRequest(extraHeaders: Record<string, string> = {}) {
  const { wakeBearer } = deriveServerlessCsGatewayCredentials(CRON_SECRET);
  return new Request("https://sellerpilot.example/api/internal/channel-gateway-drain", {
    method: "POST",
    headers: { authorization: `Bearer ${wakeBearer}`, ...extraHeaders },
  });
}

function claim(
  channel: "ebay" | "coupang" | "smartstore" | "qoo10" = "ebay",
  operation: "inquiries.list" | "inquiries.reply" = "inquiries.list",
) {
  return {
    id: JOB_ID,
    claim_token: CLAIM_TOKEN,
    credential_id: CREDENTIAL_ID,
    channel,
    operation,
    environment: "sandbox" as const,
    request: {
      arguments: operation === "inquiries.reply"
        ? channel === "ebay"
          ? {
            marketplaceId: "EBAY_US",
            itemId: "123456789",
            parentMessageId: "message-1",
            recipientId: "buyer-1",
            reply: "bounded test reply",
          }
          : channel === "coupang"
            ? { inquiryId: "inquiry-1", kind: "product", reply: "bounded test reply" }
            : channel === "smartstore"
              ? { questionId: "question-1", reply: "bounded test reply" }
              : {
                params: {
                  inq_type: "MSG",
                  question_no: "12345678",
                  seq_no: "87654321",
                  contents: "bounded test reply",
                },
              }
        : channel === "ebay"
          ? {
            marketplaceId: "EBAY_US",
            startCreationTime: "2026-08-27T00:00:00.000Z",
            endCreationTime: "2026-08-28T00:00:00.000Z",
            entriesPerPage: 25,
            pageNumber: 1,
          }
          : channel === "qoo10"
            ? {
              params: {
                search_start_dt: "20260822",
                search_end_dt: "20260828",
                proc_status: "S1",
              },
            }
            : { query: { pageNum: 1, pageSize: 25, page: 1, size: 25 } },
    },
    credential: channel === "ebay"
      ? {
        access_token: "private-ebay-access-token",
        access_token_expires_at: "2099-01-01T00:00:00.000Z",
        refresh_token_expires_at: "2099-01-01T00:00:00.000Z",
        marketplace_id: "EBAY_US",
      }
      : channel === "coupang"
        ? {
          access_key: "private-coupang-access-key",
          secret_key: "private-coupang-secret-key",
          vendor_id: "vendor-1",
          requested_by: "wing-user",
        }
        : channel === "smartstore"
          ? {
            client_id: "private-smartstore-client",
            client_secret: "private-smartstore-secret",
            token_type: "SELLER",
            account_id: "seller-account",
          }
          : { api_key: "private-qoo10-api-key" },
    attempt_count: 1,
  };
}

function qoo10ListingUpdateClaim() {
  return {
    ...claim("qoo10", "inquiries.list"),
    operation: "listing.update" as const,
    request: { arguments: { ItemCode: "sellerpilot-qoo10-existing-item" } },
  };
}

function inquiryListResult(
  channel: "ebay" | "coupang" | "smartstore" | "qoo10" = "ebay",
): ChannelOperationResult {
  return {
    ok: true,
    channel,
    operation: "inquiries.list",
    steps: [{
      name: "inquiries",
      ok: true,
      status: 200,
      data: channel === "ebay"
        ? {
          memberMessages: [{
            messageId: "message-1",
            itemId: "123456789",
            senderId: "buyer-1",
            itemTitle: "Test item",
            body: "Where is my item?",
            messageStatus: "Unanswered",
            creationDate: "2026-08-28T01:00:00.000Z",
            marketplaceId: "EBAY_US",
          }],
        }
        : channel === "qoo10"
          ? {
            ResultCode: 0,
            ResultObject: [{
              INQ_TYPE: "MSG",
              QUESTION_NO: "12345678",
              SEQ_NO: "87654321",
              CONTENTS: "배송 상태를 알려 주세요.",
              CUST_NM: "Qoo10 민감 구매자",
              TITLE: "Qoo10 민감 문의 제목",
              STATUS: "S1",
              INQ_DT: "2026-08-28T01:23:45.000Z",
            }],
          }
          : { content: [] },
    }],
    safeMessage: "Inquiry sync completed.",
  };
}

function inquiryReplyResult(
  channel: "ebay" | "coupang" | "smartstore" | "qoo10",
): ChannelOperationResult {
  return {
    ok: true,
    channel,
    operation: "inquiries.reply",
    steps: [{ name: "inquiry-reply", ok: true, status: 200, data: { accepted: true } }],
    remoteId: "reply-parent-1",
    safeMessage: "Inquiry reply accepted.",
  };
}

function smartstoreCustomerInquiryResult(): ChannelOperationResult {
  return {
    ok: true,
    channel: "smartstore",
    operation: "inquiries.list",
    steps: [{
      name: "inquiries",
      ok: true,
      status: 200,
      data: {
        sellerpilotInquiryKind: "customer",
        content: [{
          inquiryNo: 987654321,
          inquiryContent: "배송지를 변경할 수 있나요?",
          customerName: "구매자",
          title: "배송 문의",
          answered: false,
          inquiryRegistrationDateTime: "2026-08-28T01:23:45.000Z",
        }],
      },
    }],
    safeMessage: "Customer inquiry sync completed.",
  };
}

function baseRpc(
  claimedJob: ReturnType<typeof claim> | ReturnType<typeof qoo10ListingUpdateClaim>,
  calls: Array<{ name: string; arguments_: Record<string, unknown> }>,
  overrides: Partial<Record<string, (arguments_: Record<string, unknown>) => { data: unknown; error: { code?: string } | null }>> = {},
) {
  let claimCount = 0;
  return async (name: string, arguments_: Record<string, unknown> = {}) => {
    calls.push({ name, arguments_ });
    const override = overrides[name];
    if (override) return override(arguments_);
    if (name === "sellerpilot_service_enqueue_periodic_sync") {
      return { data: { status: "already_pending" }, error: null };
    }
    if (name === "sellerpilot_claim_serverless_gateway_job") {
      claimCount += 1;
      return { data: claimCount === 1 ? claimedJob : null, error: null };
    }
    if (name === "sellerpilot_touch_serverless_cs_job") return { data: "running", error: null };
    if (name === "sellerpilot_service_begin_serverless_gateway_provider_mutation") return { data: true, error: null };
    if (name === "sellerpilot_service_begin_serverless_cs_credential_refresh") return { data: true, error: null };
    if (name === "sellerpilot_service_prepare_serverless_cs_credential_refresh") {
      return { data: { status: "prepared", credential_id: PREPARED_CREDENTIAL_ID }, error: null };
    }
    if (name === "sellerpilot_service_serverless_cs_completion_context") {
      return {
        data: {
          status: "running",
          channel: claimedJob.channel,
          operation: claimedJob.operation,
          normalization_timestamp: "2026-08-28T00:00:00.000Z",
        },
        error: null,
      };
    }
    if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
      return { data: { status: "completed" }, error: null };
    }
    return { data: null, error: { code: "unexpected_rpc" } };
  };
}

test("serverless CS derivation matches the Supabase HMAC bootstrap contract", () => {
  const credentials = deriveServerlessCsGatewayCredentials(CRON_SECRET);
  const wakeBearer = createHmac("sha256", CRON_SECRET)
    .update("sellerpilot:channel-gateway-drain:wake:v1", "utf8")
    .digest("base64url");
  const rawGatewayToken = `spw_${createHmac("sha256", CRON_SECRET)
    .update("sellerpilot:channel-gateway-drain:gateway:v1", "utf8")
    .digest("base64url")}`;
  assert.equal(credentials.wakeBearer, wakeBearer);
  assert.equal(credentials.wakeBearer.length, 43);
  assert.equal(
    credentials.gatewayTokenHash,
    createHash("sha256").update(rawGatewayToken, "utf8").digest("hex"),
  );
  assert.match(credentials.gatewayTokenHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    deriveServerlessCsGatewayCredentials(`  ${CRON_SECRET}\n`),
    credentials,
  );
  assert.throws(
    () => deriveServerlessCsGatewayCredentials(" \n "),
    /serverless_cs_cron_secret_missing/,
  );
});

test("derived wake authentication fails before any database claim", async () => {
  let rpcCalls = 0;
  const response = await runServerlessCsGatewayDrain(
    new Request("https://sellerpilot.example/api/internal/channel-gateway-drain", {
      method: "POST",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }),
    {
      cronSecret: CRON_SECRET,
      rpc: async () => {
        rpcCalls += 1;
        return { data: null, error: null };
      },
    },
  );
  assert.equal(response.status, 401);
  assert.equal(rpcCalls, 0);
});

test("retry-safe provider reads stay below one minute while mutations retain the full lease window", () => {
  const retrySafeReads = [
    "categories.list",
    "categories.suggest",
    "categories.attributes",
    "categories.validate",
    "orders.list",
    "orders.get",
    "inquiries.list",
    "diagnostic.test",
    "shops.get",
    "competitor.search",
  ] as const;
  for (const operation of retrySafeReads) {
    assert.equal(
      serverlessGatewayExecutionTimeoutMs(operation),
      SERVERLESS_GATEWAY_RETRY_SAFE_READ_TIMEOUT_MS,
      operation,
    );
  }

  const mutationOrUncertainOperations = [
    "oauth.exchange",
    "listing.lineage.verify",
    "listing.create",
    "listing.update",
    "listing.stop",
    "inventory.update",
    "inquiries.reply",
    "shipment.acknowledge",
    "shipment.confirm",
  ] as const;
  for (const operation of mutationOrUncertainOperations) {
    assert.equal(
      serverlessGatewayExecutionTimeoutMs(operation),
      SERVERLESS_CS_EXECUTION_TIMEOUT_MS,
      operation,
    );
  }

  assert.equal(serverlessGatewayExecutionTimeoutMs("orders.list", 300_000), 50_000);
  assert.equal(serverlessGatewayExecutionTimeoutMs("listing.create", 300_000), 180_000);
  assert.equal(serverlessGatewayExecutionTimeoutMs("orders.list", 12_345.9), 12_345);
  assert.equal(serverlessGatewayExecutionTimeoutMs("listing.create", 12_345.9), 12_345);
  assert.equal(serverlessGatewayExecutionTimeoutMs("orders.list", Number.NaN), 50_000);
});

test("authenticated canary validates the route without claiming or executing a job", async () => {
  let rpcCalls = 0;
  let providerCalls = 0;
  const response = await runServerlessCsGatewayDrain(
    authorizedRequest({ "x-sellerpilot-drain-mode": "canary-v1" }),
    {
      cronSecret: CRON_SECRET,
      rpc: async () => {
        rpcCalls += 1;
        return { data: null, error: null };
      },
      executeProvider: async () => {
        providerCalls += 1;
        return inquiryListResult("qoo10");
      },
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "canary",
    claimed: 0,
    processed: 0,
  });
  assert.equal(rpcCalls, 0);
  assert.equal(providerCalls, 0);
});

test("authenticated canary exposes only a validated Vercel commit identity", async () => {
  const release = "A".repeat(40);
  const response = await runServerlessCsGatewayDrain(
    authorizedRequest({ "x-sellerpilot-drain-mode": "canary-v1" }),
    {
      cronSecret: CRON_SECRET,
      releaseId: release,
      rpc: async () => ({ data: null, error: null }),
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "canary",
    claimed: 0,
    processed: 0,
    release: release.toLowerCase(),
  });

  const invalid = await runServerlessCsGatewayDrain(
    authorizedRequest({ "x-sellerpilot-drain-mode": "canary-v1" }),
    {
      cronSecret: CRON_SECRET,
      releaseId: "candidate-branch-name",
      rpc: async () => ({ data: null, error: null }),
    },
  );
  assert.deepEqual(await invalid.json(), {
    ok: true,
    status: "canary",
    claimed: 0,
    processed: 0,
  });

  const conflict = await runServerlessCsGatewayDrain(
    authorizedRequest({ "x-sellerpilot-drain-mode": "canary-v1" }),
    {
      cronSecret: CRON_SECRET,
      releaseId: "a".repeat(40),
      vercelGitCommitSha: "b".repeat(40),
      rpc: async () => ({ data: null, error: null }),
    },
  );
  assert.deepEqual(await conflict.json(), {
    ok: true,
    status: "canary",
    claimed: 0,
    processed: 0,
    releaseError: "runtime_release_conflict",
  });
});

test("live drain rejects a runtime whose release does not match the active database release", async () => {
  const calls: string[] = [];
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    releaseId: "a".repeat(40),
    requireActiveRuntime: true,
    rpc: async (name) => {
      calls.push(name);
      return {
        data: { active: true, activeRelease: "b".repeat(40) },
        error: null,
      };
    },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(calls, ["sellerpilot_service_serverless_cs_wakeup_status"]);
});

test("canary mode still rejects missing or wrong wake authentication before database access", async () => {
  let rpcCalls = 0;
  const dependencies = {
    cronSecret: CRON_SECRET,
    rpc: async () => {
      rpcCalls += 1;
      return { data: null, error: null };
    },
  };
  for (const authorization of [null, "Bearer wrong-wake-secret"]) {
    const headers = new Headers({ "x-sellerpilot-drain-mode": "canary-v1" });
    if (authorization) headers.set("authorization", authorization);
    const response = await runServerlessCsGatewayDrain(
      new Request("https://sellerpilot.example/api/internal/channel-gateway-drain", {
        method: "POST",
        headers,
      }),
      dependencies,
    );
    assert.equal(response.status, 401);
  }
  assert.equal(rpcCalls, 0);
});

test("an unknown explicit drain mode fails closed without claiming", async () => {
  let rpcCalls = 0;
  const response = await runServerlessCsGatewayDrain(
    authorizedRequest({ "x-sellerpilot-drain-mode": "canray-v1" }),
    {
      cronSecret: CRON_SECRET,
      rpc: async () => {
        rpcCalls += 1;
        return { data: null, error: null };
      },
    },
  );
  assert.equal(response.status, 400);
  assert.equal(rpcCalls, 0);
});

test("normal drain enqueues only current supported inquiries before eight bounded claims", async () => {
  const fixedNow = new Date("2026-08-28T07:00:00.000Z");
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  let activeEnqueues = 0;
  let maxActiveEnqueues = 0;
  let completedEnqueues = 0;
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    now: () => fixedNow,
    rpc: async (name, arguments_ = {}) => {
      calls.push({ name, arguments_ });
      if (name === "sellerpilot_service_enqueue_periodic_sync") {
        activeEnqueues += 1;
        maxActiveEnqueues = Math.max(maxActiveEnqueues, activeEnqueues);
        await new Promise((resolve) => setTimeout(resolve, 2));
        activeEnqueues -= 1;
        completedEnqueues += 1;
        return { data: { status: "already_pending" }, error: null };
      }
      assert.equal(completedEnqueues, 4);
      return { data: null, error: null };
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "idle",
    claimed: 0,
    processed: 0,
    capacity: SERVERLESS_CS_DRAIN_CONCURRENCY,
    enqueue: {
      attempted: 4,
      queued: 0,
      pending: 4,
      notConnected: 0,
      reconnectRequired: 0,
      reconciliationRequired: 0,
      fixedEgressRequired: 0,
      failed: 0,
    },
    jobs: [],
  });
  const enqueues = calls.filter(({ name }) => name === "sellerpilot_service_enqueue_periodic_sync");
  assert.equal(enqueues.length, 4);
  assert.equal(maxActiveEnqueues, Math.min(SERVERLESS_CS_ENQUEUE_CONCURRENCY, enqueues.length));
  assert.ok(maxActiveEnqueues >= 2 && maxActiveEnqueues <= 4);
  assert.equal(
    calls.filter(({ name }) => name === "sellerpilot_claim_serverless_gateway_job").length,
    SERVERLESS_CS_DRAIN_CONCURRENCY,
  );
  assert.equal(
    SERVERLESS_CS_DRAIN_CONCURRENCY * 5 > serverlessCsCurrentInquiryEnqueues(fixedNow).length,
    true,
  );
  assert.equal(SERVERLESS_GATEWAY_MAX_PERIODIC_JOBS_PER_FIVE_MINUTES, 25);
  assert.ok(
    SERVERLESS_CS_DRAIN_CONCURRENCY * 5
      > SERVERLESS_GATEWAY_MAX_PERIODIC_JOBS_PER_FIVE_MINUTES,
  );
  assert.equal(SERVERLESS_CS_PERIODIC_MIN_INTERVAL_MINUTES, 5);
  assert.deepEqual(
    enqueues.map(({ arguments_ }) => arguments_.p_channel).sort(),
    ["ebay", "qoo10", "smartstore", "smartstore"],
  );
  assert.ok(enqueues.every(({ arguments_ }) =>
    arguments_.p_operation === "inquiries.list"
      && arguments_.p_min_interval_minutes === 5));
  assert.deepEqual(
    enqueues.map(({ arguments_ }) => {
      const payload = arguments_.p_request_payload as { periodicKey: string };
      return `${arguments_.p_channel}:${payload.periodicKey}`;
    }).sort(),
    [
      "ebay:inquiries:0",
      "qoo10:inquiries:0",
      "smartstore:inquiries:customer",
      "smartstore:inquiries:product",
    ],
  );
  const serializedEnqueues = JSON.stringify(enqueues);
  assert.doesNotMatch(serializedEnqueues, /orders\.list|inquiries:history|lazada|shopee|elevenst|temu/i);
  const ebayEnqueue = enqueues.find(({ arguments_ }) => arguments_.p_channel === "ebay");
  assert.equal(
    (ebayEnqueue?.arguments_.p_request_payload as { periodicKey?: string })?.periodicKey,
    "inquiries:0",
  );
});

test("missing generic claim RPC falls back to the inquiries-only compatibility claimant", async () => {
  const names: string[] = [];
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    rpc: async (name) => {
      names.push(name);
      if (name === "sellerpilot_service_enqueue_periodic_sync") {
        return { data: { status: "already_pending" }, error: null };
      }
      if (name === "sellerpilot_claim_serverless_gateway_job") {
        return { data: null, error: { code: "PGRST202" } };
      }
      return { data: null, error: null };
    },
  });
  assert.equal(response.status, 200);
  assert.equal(names.filter((name) => name === "sellerpilot_claim_serverless_gateway_job").length, SERVERLESS_CS_DRAIN_CONCURRENCY);
  assert.equal(names.filter((name) => name === "sellerpilot_claim_serverless_cs_job").length, SERVERLESS_CS_DRAIN_CONCURRENCY);
  assert.equal(names.filter((name) => name === "sellerpilot_claim_ebay_asq_serverless_job").length, 0);
});

test("Smartstore current reads need no static egress while Coupang still does", () => {
  const enqueues = serverlessCsCurrentInquiryEnqueues(
    new Date("2026-08-28T07:00:00.000Z"),
    ["coupang"],
  );
  assert.equal(enqueues.length, 7);
  assert.deepEqual(
    enqueues.map(({ channel }) => channel).sort(),
    ["coupang", "coupang", "coupang", "ebay", "qoo10", "smartstore", "smartstore"],
  );
});

test("explicit Temu static egress enables its current inquiry read", () => {
  const enqueues = serverlessCsCurrentInquiryEnqueues(
    new Date("2026-08-28T07:00:00.000Z"),
    ["temu"],
  );
  assert.equal(enqueues.length, 5);
  assert.deepEqual(
    enqueues.map(({ channel }) => channel).sort(),
    ["ebay", "qoo10", "smartstore", "smartstore", "temu"],
  );
  const temu = enqueues.find(({ channel }) => channel === "temu");
  assert.equal(temu?.operation, "inquiries.list");
  assert.equal(temu?.payload.periodicKey, "inquiries:0");
});

test("fixed-egress claims fail closed before provider execution without runtime attestation", async () => {
  let providerCalls = 0;
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    rpc: baseRpc(claim("coupang", "inquiries.list"), []),
    executeProvider: async () => {
      providerCalls += 1;
      return inquiryListResult("coupang");
    },
  });
  assert.equal(response.status, 503);
  assert.equal(providerCalls, 0);
});

test("Temu claims also fail closed before provider execution without runtime attestation", async () => {
  let providerCalls = 0;
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    rpc: baseRpc(claim("temu", "inquiries.list"), []),
    executeProvider: async () => {
      providerCalls += 1;
      return inquiryListResult("temu");
    },
  });
  assert.equal(response.status, 503);
  assert.equal(providerCalls, 0);
});

test("blocked price updates are terminally failed before serverless provider execution", async () => {
  const priceJob = {
    ...claim("qoo10", "inquiries.list"),
    operation: "price.update" as const,
    request: {
      arguments: {
        params: {
          ItemCode: "100001",
          ItemPrice: 7_900,
          ItemQty: 1,
        },
      },
    },
  };
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  let providerCalls = 0;
  let claimCount = 0;
  const response = await runOneServerlessCsGatewayJob({
    rpc: async (name, arguments_ = {}) => {
      calls.push({ name, arguments_ });
      if (name === "sellerpilot_claim_serverless_gateway_job") {
        claimCount += 1;
        return { data: claimCount === 1 ? priceJob : null, error: null };
      }
      if (name === "sellerpilot_service_serverless_cs_completion_context") {
        return {
          data: {
            status: "running",
            channel: priceJob.channel,
            operation: priceJob.operation,
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
    executeProvider: async () => {
      providerCalls += 1;
      return inquiryListResult("qoo10");
    },
  }, deriveServerlessCsGatewayCredentials(CRON_SECRET).gatewayTokenHash);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: false,
    status: "failed",
    claimed: 1,
    processed: 1,
    jobId: JOB_ID,
    channel: "qoo10",
    operation: "price.update",
  });
  assert.equal(providerCalls, 0);
  assert.equal(
    calls.some(({ name }) => name === "sellerpilot_service_begin_serverless_gateway_provider_mutation"),
    false,
  );
  const complete = calls.find(({ name }) => name === "sellerpilot_service_complete_serverless_cs_transaction");
  assert.equal(complete?.arguments_.p_status, "failed");
  assert.match(
    String(complete?.arguments_.p_error_message),
    /^PRICE_UPDATE_RELEASE_BLOCKED:/,
  );
});

test("one enqueue failure is safely aggregated and does not block an existing queued job", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const logged: unknown[] = [];
  let providerCalls = 0;
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    rpc: baseRpc(claim("qoo10", "inquiries.list"), calls, {
      sellerpilot_service_enqueue_periodic_sync: (arguments_) =>
        arguments_.p_channel === "qoo10"
          ? { data: null, error: { code: "private_provider_body_must_not_escape" } }
          : { data: { status: "already_pending" }, error: null },
    }),
    logError: (...values) => logged.push(values),
    executeProvider: async () => {
      providerCalls += 1;
      return inquiryListResult("qoo10");
    },
  });
  const responseText = await response.text();
  const body = JSON.parse(responseText) as {
    ok: boolean;
    status: string;
    processed: number;
    needsAttention?: boolean;
    enqueue: { failed: number; pending: number };
  };
  assert.equal(response.status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.status, "succeeded");
  assert.equal(body.processed, 1);
  assert.equal(body.needsAttention, true);
  assert.deepEqual(body.enqueue, {
    attempted: 4,
    queued: 0,
    pending: 3,
    notConnected: 0,
    reconnectRequired: 0,
    reconciliationRequired: 0,
    fixedEgressRequired: 0,
    failed: 1,
  });
  assert.equal(providerCalls, 1);
  assert.deepEqual(logged, [
    ["publication_review_enqueue", { status: 503, code: "unexpected_rpc" }],
    ["enqueue", { status: 503, failed: 1, total: 4 }],
  ]);
  assert.doesNotMatch(responseText, /Qoo10 민감 구매자|배송 상태를 알려 주세요|private_provider_body/);
  assert.doesNotMatch(JSON.stringify(logged), /private_provider_body/);
});

test("a total enqueue transport outage is visible as 503 after bounded drain attempts", async () => {
  let claimCalls = 0;
  const logged: unknown[] = [];
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    rpc: async (name) => {
      if (name === "sellerpilot_service_enqueue_periodic_sync") {
        return { data: null, error: { code: "transport_error" } };
      }
      if (name === "sellerpilot_claim_serverless_gateway_job") {
        claimCalls += 1;
        return { data: null, error: null };
      }
      return { data: null, error: { code: "unexpected_rpc" } };
    },
    logError: (...values) => logged.push(values),
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    status: "idle",
    claimed: 0,
    processed: 0,
    capacity: SERVERLESS_CS_DRAIN_CONCURRENCY,
    enqueue: {
      attempted: 4,
      queued: 0,
      pending: 0,
      notConnected: 0,
      reconnectRequired: 0,
      reconciliationRequired: 0,
      fixedEgressRequired: 0,
      failed: 4,
    },
    needsAttention: true,
    jobs: [],
  });
  assert.equal(claimCalls, SERVERLESS_CS_DRAIN_CONCURRENCY);
  assert.deepEqual(logged, [
    ["publication_review_enqueue", { status: 503, code: "unexpected_rpc" }],
    ["enqueue", { status: 503, failed: 4, total: 4 }],
  ]);
});

test("two fenced jobs run concurrently within eight-worker drain capacity", async () => {
  const firstJob = claim("qoo10", "inquiries.list");
  const secondJob = claim("ebay", "inquiries.list");
  secondJob.id = "10000000-0000-4000-8000-000000000002";
  secondJob.claim_token = "20000000-0000-4000-8000-000000000002";
  secondJob.credential_id = "30000000-0000-4000-8000-000000000002";
  const jobs = [firstJob, secondJob];
  const byId = new Map(jobs.map((job) => [job.id, job]));
  let claimIndex = 0;
  let activeProviders = 0;
  let maxActiveProviders = 0;
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    rpc: async (name, arguments_ = {}) => {
      calls.push({ name, arguments_ });
      if (name === "sellerpilot_service_enqueue_periodic_sync") {
        return { data: { status: "already_pending" }, error: null };
      }
      if (name === "sellerpilot_claim_serverless_gateway_job") {
        const job = jobs[claimIndex] ?? null;
        claimIndex += 1;
        return { data: job, error: null };
      }
      if (name === "sellerpilot_touch_serverless_cs_job") {
        return { data: "running", error: null };
      }
      if (name === "sellerpilot_service_serverless_cs_completion_context") {
        const job = byId.get(String(arguments_.p_job_id));
        return {
          data: job ? {
            status: "running",
            channel: job.channel,
            operation: job.operation,
            normalization_timestamp: "2026-08-28T00:00:00.000Z",
          } : null,
          error: null,
        };
      }
      if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
        return { data: { status: "completed" }, error: null };
      }
      return { data: null, error: { code: "unexpected_rpc" } };
    },
    executeProvider: async ({ job }) => {
      activeProviders += 1;
      maxActiveProviders = Math.max(maxActiveProviders, activeProviders);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeProviders -= 1;
      return inquiryListResult(job.channel);
    },
  });
  const responseText = await response.text();
  const body = JSON.parse(responseText) as {
    status: string;
    claimed: number;
    processed: number;
    capacity: number;
    jobs: Array<{ channel: string }>;
  };
  assert.equal(response.status, 200);
  assert.equal(body.status, "succeeded");
  assert.equal(body.claimed, 2);
  assert.equal(body.processed, 2);
  assert.equal(body.capacity, SERVERLESS_CS_DRAIN_CONCURRENCY);
  assert.equal(maxActiveProviders, 2);
  assert.deepEqual(body.jobs.map((job) => job.channel).sort(), ["ebay", "qoo10"]);
  assert.ok(body.capacity * 5 > serverlessCsCurrentInquiryEnqueues(new Date()).length);
  assert.equal(
    calls.filter(({ name }) => name === "sellerpilot_claim_serverless_gateway_job").length,
    SERVERLESS_CS_DRAIN_CONCURRENCY,
  );
  assert.doesNotMatch(responseText, /Qoo10 민감 구매자|배송 상태를 알려 주세요|Where is my item\?|buyer-1/);
});

test("inquiry list completion normalizes provider data in the atomic transaction", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    rpc: baseRpc(claim("ebay", "inquiries.list"), calls),
    executeProvider: async () => inquiryListResult("ebay"),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    status: "succeeded",
    claimed: 1,
    processed: 1,
    capacity: SERVERLESS_CS_DRAIN_CONCURRENCY,
    enqueue: {
      attempted: 4,
      queued: 0,
      pending: 4,
      notConnected: 0,
      reconnectRequired: 0,
      reconciliationRequired: 0,
      fixedEgressRequired: 0,
      failed: 0,
    },
    jobs: [{
      status: "succeeded",
      jobId: JOB_ID,
      channel: "ebay",
      operation: "inquiries.list",
    }],
  });
  assert.equal(
    calls.filter(({ name }) => name === "sellerpilot_claim_serverless_gateway_job").length,
    SERVERLESS_CS_DRAIN_CONCURRENCY,
  );
  const complete = calls.find(({ name }) => name === "sellerpilot_service_complete_serverless_cs_transaction");
  assert.equal(complete?.arguments_.p_status, "succeeded");
  const ebayInquiries = structuredClone(complete?.arguments_.p_normalized_inquiries) as Array<Record<string, unknown>>;
  assert.match(String(ebayInquiries[0]?.inboundKey ?? ""), /^ebay:[0-9a-f]{64}$/);
  delete ebayInquiries[0]?.inboundKey;
  assert.deepEqual(ebayInquiries, [{
    externalTicketId: "ebay:message-1",
    customerName: "buyer-1",
    subject: "Test item",
    message: "Where is my item?",
    status: "waiting",
    priority: 3,
    receivedAt: "2026-08-28T01:00:00.000Z",
    remoteMessageId: "message-1",
    providerContext: {
      itemId: "123456789",
      parentMessageId: "message-1",
      recipientId: "buyer-1",
      marketplaceId: "EBAY_US",
    },
    replyContext: {
      itemId: "123456789",
      parentMessageId: "message-1",
      recipientId: "buyer-1",
      marketplaceId: "EBAY_US",
    },
    providerStatus: "waiting",
    ticketKind: "conversation",
  }]);
  assert.deepEqual(complete?.arguments_.p_response_payload, {
    ok: true,
    channel: "ebay",
    operation: "inquiries.list",
    steps: [{
      name: "inquiries-normalized",
      ok: true,
      status: 200,
      data: {
        sellerpilotMarker: "normalized_inquiries_v1",
        normalizedInquiryCount: 1,
        providerStepCount: 1,
      },
    }],
    safeMessage: "문의 동기화 결과를 정규화해 저장했습니다.",
  });
  const durableResponse = JSON.stringify(complete?.arguments_.p_response_payload);
  assert.doesNotMatch(durableResponse, /Where is my item\?|buyer-1|Test item/);
});

test("Smartstore customer inquiry arguments and reply lineage survive direct execution and atomic completion", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const customerJob = claim("smartstore", "inquiries.list");
  const customerArguments = {
    kind: "customer",
    query: {
      startSearchDate: "2026-08-22",
      endSearchDate: "2026-08-28",
      answered: false,
      page: 1,
      size: 200,
    },
  };
  customerJob.request.arguments = customerArguments;
  let observedArguments: unknown;
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    rpc: baseRpc(customerJob, calls),
    executeProvider: async ({ job }) => {
      observedArguments = structuredClone(job.request.arguments);
      return smartstoreCustomerInquiryResult();
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(observedArguments, customerArguments);
  const complete = calls.find(({ name }) => name === "sellerpilot_service_complete_serverless_cs_transaction");
  const customerInquiries = structuredClone(complete?.arguments_.p_normalized_inquiries) as Array<Record<string, unknown>>;
  assert.match(String(customerInquiries[0]?.inboundKey ?? ""), /^smartstore:[0-9a-f]{64}$/);
  delete customerInquiries[0]?.inboundKey;
  assert.deepEqual(customerInquiries, [{
    externalTicketId: "customer:987654321",
    customerName: "구매자",
    subject: "배송 문의",
    message: "배송지를 변경할 수 있나요?",
    status: "waiting",
    priority: 3,
    receivedAt: "2026-08-28T01:23:45.000Z",
    remoteMessageId: "987654321",
    providerContext: { kind: "customer", inquiryNo: "987654321" },
    replyContext: { kind: "customer", inquiryNo: "987654321" },
    providerStatus: "waiting",
    ticketKind: "conversation",
  }]);
  const durableResponse = JSON.stringify(complete?.arguments_.p_response_payload);
  assert.doesNotMatch(durableResponse, /배송지를 변경할 수 있나요\?|구매자|배송 문의|987654321/);
});

test("Qoo10 inquiry list keeps the verified one-call contract and stores only normalized PII", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const qoo10Job = claim("qoo10", "inquiries.list");
  let observedDispatch: Record<string, unknown> | undefined;
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    rpc: baseRpc(qoo10Job, calls),
    executeProvider: (input) => executeServerlessCsProviderJob(input, async (operationInput) => {
      observedDispatch = {
        channel: operationInput.channel,
        operation: operationInput.operation,
        arguments: structuredClone(operationInput.arguments),
      };
      return inquiryListResult("qoo10");
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(observedDispatch, {
    channel: "qoo10",
    operation: "inquiries.list",
    arguments: {
      params: {
        search_start_dt: "20260822",
        search_end_dt: "20260828",
        proc_status: "S1",
      },
    },
  });
  const complete = calls.find(({ name }) => name === "sellerpilot_service_complete_serverless_cs_transaction");
  const qoo10Inquiries = structuredClone(complete?.arguments_.p_normalized_inquiries) as Array<Record<string, unknown>>;
  assert.match(String(qoo10Inquiries[0]?.inboundKey ?? ""), /^qoo10:[0-9a-f]{64}$/);
  delete qoo10Inquiries[0]?.inboundKey;
  assert.deepEqual(qoo10Inquiries, [{
    externalTicketId: "qoo10:MSG:12345678:87654321",
    customerName: "Qoo10 민감 구매자",
    subject: "Qoo10 민감 문의 제목",
    message: "배송 상태를 알려 주세요.",
    status: "waiting",
    priority: 3,
    receivedAt: "2026-08-28T01:23:45.000Z",
    remoteMessageId: "87654321",
    providerContext: { inquiryType: "MSG", questionNo: "12345678", sequenceNo: "87654321" },
    replyContext: { inquiryType: "MSG", questionNo: "12345678", sequenceNo: "87654321" },
    providerStatus: "waiting",
    ticketKind: "conversation",
  }]);
  const durableResponse = JSON.stringify(complete?.arguments_.p_response_payload);
  assert.match(durableResponse, /normalized_inquiries_v1/);
  assert.doesNotMatch(
    durableResponse,
    /Qoo10 민감 구매자|Qoo10 민감 문의 제목|배송 상태를 알려 주세요|12345678|87654321/,
  );
  assert.equal(
    Object.hasOwn(complete?.arguments_.p_response_payload as object, "continuation"),
    false,
  );
});

test("Qoo10 inquiry list reconciliation also strips every raw customer field", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const uncertainResult = inquiryListResult("qoo10");
  uncertainResult.ok = false;
  uncertainResult.steps[0] = {
    ...uncertainResult.steps[0],
    ok: false,
    status: 504,
    data: {
      ...uncertainResult.steps[0].data,
      sellerpilotReconciliationRequired: true,
    },
  };
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    rpc: baseRpc(claim("qoo10", "inquiries.list"), calls),
    executeProvider: async () => uncertainResult,
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json() as { status: string }).status, "reconciliation_required");
  const complete = calls.find(({ name }) => name === "sellerpilot_service_complete_serverless_cs_transaction");
  assert.equal(complete?.arguments_.p_status, "reconciliation_required");
  assert.equal(complete?.arguments_.p_normalized_inquiries, null);
  const durableResponse = JSON.stringify(complete?.arguments_.p_response_payload);
  assert.match(durableResponse, /normalized_inquiries_v1/);
  assert.doesNotMatch(
    durableResponse,
    /Qoo10 민감 구매자|Qoo10 민감 문의 제목|배송 상태를 알려 주세요|12345678|87654321/,
  );
});

test("direct Qoo10 reply keeps the existing provider arguments behind the mutation fence", async () => {
  const job = claim("qoo10", "inquiries.reply");
  const events: string[] = [];
  const result = await executeServerlessCsProviderJob({
    job,
    signal: new AbortController().signal,
    hooks: {
      assertLeaseHealthy: async () => { events.push("lease"); },
      beginProviderMutation: async () => { events.push("mutation-fence"); },
      beginCredentialMutation: async () => { throw new Error("unexpected credential mutation"); },
      stageCredentialRefresh: async () => { throw new Error("unexpected credential refresh"); },
    },
  }, async (input) => {
    events.push("operation");
    assert.deepEqual(input.arguments, job.request.arguments);
    return inquiryReplyResult("qoo10");
  });
  assert.equal(result.ok, true);
  assert.deepEqual(events, ["lease", "mutation-fence", "lease", "operation"]);
});

test("direct Smartstore customer reply crosses the mutation fence before operation dispatch", async () => {
  const job = claim("smartstore", "inquiries.reply");
  job.request.arguments = {
    kind: "customer",
    inquiryNo: "987654321",
    reply: "bounded test reply",
  };
  const events: string[] = [];
  const result = await executeServerlessCsProviderJob({
    job,
    signal: new AbortController().signal,
    hooks: {
      assertLeaseHealthy: async () => { events.push("lease"); },
      beginProviderMutation: async () => { events.push("mutation-fence"); },
      beginCredentialMutation: async () => { throw new Error("unexpected credential mutation"); },
      stageCredentialRefresh: async () => { throw new Error("unexpected credential refresh"); },
    },
  }, async (input) => {
    events.push("operation");
    assert.deepEqual(input.arguments, job.request.arguments);
    return inquiryReplyResult("smartstore");
  });
  assert.equal(result.ok, true);
  assert.deepEqual(events, ["lease", "mutation-fence", "lease", "operation"]);
});

for (const channel of ["ebay", "coupang", "smartstore", "qoo10"] as const) {
  test(`${channel} inquiry reply crosses the exact mutation fence before execution`, async () => {
    const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
    let fenceObserved = false;
    const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
      cronSecret: CRON_SECRET,
      staticEgressChannels: channel === "coupang" ? [channel] : [],
      rpc: baseRpc(claim(channel, "inquiries.reply"), calls),
      executeProvider: async ({ hooks }) => {
        await hooks.beginProviderMutation();
        fenceObserved = calls.some(({ name }) => name === "sellerpilot_service_begin_serverless_gateway_provider_mutation");
        return inquiryReplyResult(channel);
      },
    });
    assert.equal(response.status, 200);
    assert.equal(fenceObserved, true);
    assert.equal((await response.json() as { status: string }).status, "succeeded");
    const complete = calls.find(({ name }) => name === "sellerpilot_service_complete_serverless_cs_transaction");
    assert.deepEqual(complete?.arguments_.p_response_payload, inquiryReplyResult(channel));
  });
}

test("a denied provider fence with live ownership completes as a safe pre-provider failure", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  let providerMutationDispatched = false;
  const response = await runOneServerlessCsGatewayJob({
    rpc: baseRpc(qoo10ListingUpdateClaim(), calls, {
      sellerpilot_service_begin_serverless_gateway_provider_mutation: () => ({
        data: false,
        error: null,
      }),
    }),
    executeProvider: async ({ hooks }) => {
      await hooks.beginProviderMutation();
      providerMutationDispatched = true;
      return inquiryReplyResult("qoo10");
    },
  }, deriveServerlessCsGatewayCredentials(CRON_SECRET).gatewayTokenHash);

  assert.equal(response.status, 200);
  assert.equal((await response.json() as { status: string }).status, "failed");
  assert.equal(providerMutationDispatched, false);
  assert.equal(
    calls.filter(({ name }) => name === "sellerpilot_touch_serverless_cs_job").length,
    2,
  );
  const completions = calls.filter(
    ({ name }) => name === "sellerpilot_service_complete_serverless_cs_transaction",
  );
  assert.equal(completions.length, 1);
  assert.equal(completions[0].arguments_.p_status, "failed");
  assert.equal(
    completions[0].arguments_.p_error_message,
    "GATEWAY_PROVIDER_MUTATION_NOT_STARTED",
  );
});

test("a denied provider fence with lost ownership remains 409 without completion", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  let touchCount = 0;
  let providerMutationDispatched = false;
  const response = await runOneServerlessCsGatewayJob({
    rpc: baseRpc(qoo10ListingUpdateClaim(), calls, {
      sellerpilot_touch_serverless_cs_job: () => ({
        data: ++touchCount === 1 ? "running" : "ownership_lost",
        error: null,
      }),
      sellerpilot_service_begin_serverless_gateway_provider_mutation: () => ({
        data: false,
        error: null,
      }),
    }),
    executeProvider: async ({ hooks }) => {
      await hooks.beginProviderMutation();
      providerMutationDispatched = true;
      return inquiryReplyResult("qoo10");
    },
  }, deriveServerlessCsGatewayCredentials(CRON_SECRET).gatewayTokenHash);

  assert.equal(response.status, 409);
  assert.equal(providerMutationDispatched, false);
  assert.equal(touchCount, 2);
  assert.equal(
    calls.some(({ name }) => name === "sellerpilot_service_complete_serverless_cs_transaction"),
    false,
  );
});

test("a denied provider fence with an existing mutation marker reconciles without redispatch", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  let providerMutationDispatched = false;
  const response = await runOneServerlessCsGatewayJob({
    rpc: baseRpc(qoo10ListingUpdateClaim(), calls, {
      sellerpilot_service_begin_serverless_gateway_provider_mutation: () => ({
        data: false,
        error: null,
      }),
      sellerpilot_service_serverless_cs_completion_context: () => ({
        data: {
          status: "running",
          channel: "qoo10",
          operation: "listing.update",
          normalization_timestamp: "2026-08-31T05:25:07.000Z",
          publication_verification_boundary: "2026-08-31T05:26:00.000Z",
        },
        error: null,
      }),
    }),
    executeProvider: async ({ hooks }) => {
      await hooks.beginProviderMutation();
      providerMutationDispatched = true;
      return inquiryReplyResult("qoo10");
    },
  }, deriveServerlessCsGatewayCredentials(CRON_SECRET).gatewayTokenHash);

  assert.equal(response.status, 200);
  assert.equal((await response.json() as { status: string }).status, "reconciliation_required");
  assert.equal(providerMutationDispatched, false);
  const completions = calls.filter(
    ({ name }) => name === "sellerpilot_service_complete_serverless_cs_transaction",
  );
  assert.equal(completions.length, 1);
  assert.equal(completions[0].arguments_.p_status, "reconciliation_required");
  assert.equal(
    completions[0].arguments_.p_error_message,
    "GATEWAY_PROVIDER_MUTATION_STATE_UNCERTAIN",
  );
});

test("eBay credential mutation is fenced and staged before atomic completion", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const refresh = {
    payload: {
      access_token: "private-refreshed-access-token",
      refresh_token: "private-refresh-token",
    },
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    rpc: baseRpc(claim("ebay", "inquiries.list"), calls),
    executeProvider: async ({ hooks }) => {
      await hooks.beginCredentialMutation();
      await hooks.stageCredentialRefresh(refresh);
      return inquiryListResult("ebay");
    },
  });
  assert.equal(response.status, 200);
  const names = calls.map(({ name }) => name);
  assert.ok(names.indexOf("sellerpilot_service_begin_serverless_cs_credential_refresh")
    < names.indexOf("sellerpilot_service_prepare_serverless_cs_credential_refresh"));
  assert.ok(names.indexOf("sellerpilot_service_prepare_serverless_cs_credential_refresh")
    < names.indexOf("sellerpilot_service_complete_serverless_cs_transaction"));
  const complete = calls.find(({ name }) => name === "sellerpilot_service_complete_serverless_cs_transaction");
  assert.deepEqual(complete?.arguments_.p_credential_refresh, refresh);
});

test("an error after the reply fence completes as reconciliation without leaking diagnostics", async () => {
  const privateDiagnostic = "private provider body and secret token";
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const logged: unknown[] = [];
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    staticEgressChannels: ["coupang"],
    rpc: baseRpc(claim("coupang", "inquiries.reply"), calls),
    logError: (...values) => logged.push(values),
    executeProvider: async ({ hooks }) => {
      await hooks.beginProviderMutation();
      throw new Error(privateDiagnostic);
    },
  });
  const responseText = await response.text();
  assert.equal(response.status, 200);
  assert.match(responseText, /reconciliation_required/);
  assert.doesNotMatch(responseText, new RegExp(privateDiagnostic));
  assert.doesNotMatch(JSON.stringify(logged), new RegExp(privateDiagnostic));
  const complete = calls.find(({ name }) => name === "sellerpilot_service_complete_serverless_cs_transaction");
  assert.equal(complete?.arguments_.p_status, "reconciliation_required");
  assert.equal(complete?.arguments_.p_error_message, "serverless_cs_execution_failed");
});

test("a pre-provider localized listing failure keeps its exact safe remediation code", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    rpc: baseRpc(claim("qoo10", "inquiries.list"), calls),
    executeProvider: async () => {
      throw new Error("LISTING_PUBLICATION_LOCALIZED_CONTENT_REQUIRED");
    },
  });

  assert.equal(response.status, 200);
  const complete = calls.find(({ name }) => name === "sellerpilot_service_complete_serverless_cs_transaction");
  assert.equal(complete?.arguments_.p_status, "failed");
  assert.equal(
    complete?.arguments_.p_error_message,
    "LISTING_PUBLICATION_LOCALIZED_CONTENT_REQUIRED",
  );
});

for (const safeReason of [
  "NAVER_IP_NOT_ALLOWED",
  "NAVER_AUTH_FAILED",
  "NAVER_PROVIDER_UNAVAILABLE",
  "NAVER_TOKEN_EXCHANGE_FAILED",
] as const) {
  test(`Smartstore safe token failure ${safeReason} survives completion without provider details`, async () => {
    const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
    const privateDiagnostic = "private provider response body";
    const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
      cronSecret: CRON_SECRET,
      rpc: baseRpc(claim("smartstore", "inquiries.list"), calls),
      executeProvider: async () => {
        const error = new Error(safeReason);
        Object.assign(error, { privateDiagnostic });
        throw error;
      },
    });
    assert.equal(response.status, 200);
    const complete = calls.find(({ name }) => name === "sellerpilot_service_complete_serverless_cs_transaction");
    assert.equal(complete?.arguments_.p_status, "failed");
    assert.equal(complete?.arguments_.p_error_message, safeReason);
    assert.doesNotMatch(JSON.stringify(complete), new RegExp(privateDiagnostic));
  });
}

test("atomic completion retries the exact same payload once after an uncertain response", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  let completionCalls = 0;
  const resultWithContinuation = inquiryListResult("smartstore");
  resultWithContinuation.continuation = {
    reason: "page_cap_reached",
    arguments: {
      kind: "product",
      query: { page: 2, size: 25 },
      sellerpilotPaginationDepth: 1,
    },
  };
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    rpc: baseRpc(claim("smartstore", "inquiries.list"), calls, {
      sellerpilot_service_complete_serverless_cs_transaction: () => {
        completionCalls += 1;
        return completionCalls === 1
          ? { data: null, error: { code: "request_failed" } }
          : { data: { status: "completed" }, error: null };
      },
    }),
    executeProvider: async () => resultWithContinuation,
  });
  assert.equal(response.status, 200);
  assert.equal(completionCalls, 2);
  const completions = calls.filter(({ name }) => name === "sellerpilot_service_complete_serverless_cs_transaction");
  assert.deepEqual(completions[0].arguments_, completions[1].arguments_);
  assert.deepEqual(
    (completions[0].arguments_.p_response_payload as ChannelOperationResult).continuation,
    resultWithContinuation.continuation,
  );
});

test("request deadline composition is isolated across concurrent provider executions", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_input, init) => {
      const signal = init?.signal;
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve(new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }));
        }, 30);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(signal.reason);
        }, { once: true });
      });
    };

    const firstOwner = new AbortController();
    const secondOwner = new AbortController();
    const payload = {
      access_key: "access-key",
      secret_key: "secret-key",
      vendor_id: "vendor-id",
    };
    const first = runWithChannelRequestSignal(firstOwner.signal, () => coupangRequest({
      payload,
      method: "GET",
      path: "/test/first",
    }));
    const second = runWithChannelRequestSignal(secondOwner.signal, () => coupangRequest({
      payload,
      method: "GET",
      path: "/test/second",
    }));
    firstOwner.abort(new Error("first-owner-timeout"));
    await assert.rejects(first, /first-owner-timeout/);
    assert.equal((await second).response.status, 200);

    const shortOwner = AbortSignal.timeout(5);
    await assert.rejects(
      runWithChannelRequestSignal(shortOwner, () => coupangRequest({
        payload,
        method: "GET",
        path: "/test/composed-timeout",
      })),
      (error) => error instanceof Error && error.name === "TimeoutError",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bounded drain route is direct, eight-job, Node-only, and excludes child workers", async () => {
  const [route, gateway, gatewayRuntime, provider, protocols] = await Promise.all([
    readFile(new URL("../app/api/internal/channel-gateway-drain/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/serverless-cs-gateway.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/serverless-cs-gateway-runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/serverless-gateway-provider.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/protocols.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /export const runtime = "nodejs"/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /export const maxDuration = 300/);
  assert.match(route, /export async function POST/);
  assert.match(gateway, /SERVERLESS_CS_EXECUTION_TIMEOUT_MS = 180_000/);
  assert.match(gateway, /SERVERLESS_GATEWAY_RETRY_SAFE_READ_TIMEOUT_MS = 50_000/);
  assert.match(gateway, /serverlessGatewayExecutionTimeoutMs\(/);
  assert.match(gateway, /SERVERLESS_CS_ENQUEUE_CONCURRENCY = 3/);
  assert.match(gateway, /SERVERLESS_CS_DRAIN_CONCURRENCY = 8/);
  assert.match(gateway, /SERVERLESS_GATEWAY_MAX_PERIODIC_JOBS_PER_FIVE_MINUTES = 25/);
  assert.match(gatewayRuntime, /releaseId: process\.env\.SELLERPILOT_RELEASE_SHA/);
  assert.match(gatewayRuntime, /vercelGitCommitSha: process\.env\.VERCEL_GIT_COMMIT_SHA/);
  assert.match(gatewayRuntime, /requireActiveRuntime: true/);
  assert.match(gateway, /sellerpilot_claim_serverless_gateway_job/);
  assert.match(gateway, /sellerpilot_claim_serverless_cs_job/);
  assert.match(gateway, /sellerpilot_claim_ebay_asq_serverless_job/);
  assert.match(gateway, /"qoo10",[\s\S]*"coupang",[\s\S]*"smartstore",[\s\S]*"ebay"/);
  assert.doesNotMatch(`${route}\n${gateway}`, /child_process|\bspawn\s*\(|SELLERPILOT_URL|ai-cli-worker/);
  assert.match(provider, /"listing\.create"[\s\S]*"elevenst"/);
  assert.match(provider, /import \{ channelPriceUpdateRelease \} from "\.\/price-update-release"/);
  assert.match(provider, /if \(operation === "price\.update"\) return channelPriceUpdateRelease\(channel\)\.available/);
  assert.match(protocols, /AsyncLocalStorage<AbortSignal>/);
  assert.match(protocols, /AbortSignal\.any\(\[ownerSignal, timeoutSignal\]\)/);
});
