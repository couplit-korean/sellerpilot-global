import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import type { ChannelOperationName, ChannelOperationResult } from "../lib/channels/operations";
import {
  coupangRequest,
  runWithChannelRequestSignal,
} from "../lib/channels/protocols";
import { replyAcceptanceMarker } from "../lib/channels/reply-verification";

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
  serverlessCsRepairInquiryEnqueues,
} = await import("../lib/channels/serverless-gateway");

const CRON_SECRET = "serverless-cs-gateway-cron-secret";
const JOB_ID = "10000000-0000-4000-8000-000000000001";
const CLAIM_TOKEN = "20000000-0000-4000-8000-000000000001";
const CREDENTIAL_ID = "30000000-0000-4000-8000-000000000001";
const PREPARED_CREDENTIAL_ID = "40000000-0000-4000-8000-000000000001";
const QOO10_OWNER_ID = "50000000-0000-4000-8000-000000000001";
const QOO10_SELLER_ACCOUNT_KEY = "a".repeat(64);

function authorizedRequest(extraHeaders: Record<string, string> = {}) {
  const { wakeBearer } = deriveServerlessCsGatewayCredentials(CRON_SECRET);
  return new Request("https://sellerpilot.example/api/internal/channel-gateway-drain", {
    method: "POST",
    headers: { authorization: `Bearer ${wakeBearer}`, ...extraHeaders },
  });
}

function claim(
  channel: "ebay" | "coupang" | "elevenst" | "smartstore" | "qoo10" | "lazada" = "ebay",
  operation: ChannelOperationName = "inquiries.list",
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
            : channel === "elevenst"
              ? { brdInfoNo: "81234567", prdNo: "13749310594", reply: "bounded test reply" }
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
            : channel === "elevenst"
              ? { startDate: "20260902", endDate: "20260908", answerStatus: "00" }
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
        : channel === "elevenst"
          ? { api_key: "private-elevenst-api-key" }
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
  channel: "ebay" | "coupang" | "elevenst" | "smartstore" | "qoo10",
): ChannelOperationResult {
  return {
    ok: true,
    channel,
    operation: "inquiries.reply",
    steps: [{
      name: "inquiry-reply",
      ok: true,
      status: 200,
      data: {
        accepted: true,
        sellerpilotReplyAcceptance: replyAcceptanceMarker(channel, "fixture", {
          remoteId: "reply-parent-1",
        }),
      },
    }],
    remoteId: "reply-parent-1",
    safeMessage: "Inquiry reply accepted.",
  };
}

function elevenstInquiryListResult(): ChannelOperationResult {
  return {
    ok: true,
    channel: "elevenst",
    operation: "inquiries.list",
    steps: [{
      name: "inquiries",
      ok: true,
      status: 200,
      data: {
        accepted: true,
        sellerpilotInquiryKind: "product_qna",
        sellerpilotElevenstProductQnaParseContract: "sellerpilot-elevenst-product-qna-parser/1",
        productQnas: [{
          answerCont: "",
          answerDt: "",
          answerYn: "N",
          brdInfoClfNo: "13749310594",
          brdInfoCont: "배송은 언제 시작하나요?",
          brdInfoNo: "81234567",
          brdInfoSbjct: "배송 문의",
          buyYn: "Y",
          createDt: "2026-09-08 10:15:30",
          dispYn: "Y",
          customerName: "11번가 고객",
          prdNm: "테스트 상품",
          qnaDtlsCd: "02",
          qnaDtlsCdNm: "배송",
          ordNoDe: "202609080001",
          ordStlEndDt: "2026-09-08",
        }],
      },
    }],
    safeMessage: "11번가 상품 Q&A 동기화를 완료했습니다.",
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
    if (name === "sellerpilot_service_escalate_smartstore_reply_v1") {
      return { data: {
        contract: "sellerpilot-smartstore-stale-reply-escalation/1",
        escalated: 0,
        automaticResendAllowed: false,
      }, error: null };
    }
    if (name === "sellerpilot_service_enqueue_ebay_case_dispute_collection_v2") {
      return { data: {
        contract: "sellerpilot-ebay-case-dispute-collection-enqueue/1",
        anchorAt: (arguments_.p_plan as { anchorAt: string }).anchorAt,
        attempted: 3, queued: 0, pending: 1, scopeBlocked: 0, deferred: 2,
        status: "accepted",
      }, error: null };
    }
    if (name === "sellerpilot_service_enqueue_lazada_inquiry_fanout") {
      return {
        data: { status: "already_pending", accounts: [{ status: "already_pending" }] },
        error: null,
      };
    }
    if (name === "sellerpilot_claim_serverless_gateway_job") {
      claimCount += 1;
      return { data: claimCount === 1 ? claimedJob : null, error: null };
    }
    if (name === "sellerpilot_service_reserve_provider_rate_budget_v1") {
      return {
        data: {
          contract: "sellerpilot-provider-rate-budget/1",
          status: "reserved",
          retryAfterSeconds: 0,
        },
        error: null,
      };
    }
    if (name === "sellerpilot_service_reserve_provider_request_rate_budget_v1") {
      return { data: { contract: "sellerpilot-provider-request-rate-budget/1", status: "reserved", retryAfterMs: 0, operationLane: "cs_current" }, error: null };
    }
    if (name === "sellerpilot_service_report_provider_rate_limit_v1") {
      return {
        data: {
          contract: "sellerpilot-provider-rate-budget/1",
          status: "recorded",
          retryAfterSeconds: Number(arguments_.p_retry_after_seconds ?? 60),
        },
        error: null,
      };
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
    if (name === "sellerpilot_service_elevenst_cs_account_identity_v1") {
      return { data: {
        contract: "sellerpilot-elevenst-cs-account-identity/1",
        credentialId: claimedJob.credential_id,
        sellerId: "couplit", sellerName: "커플릿", environment: "production",
        version: 1, verifiedAt: "2026-09-09T09:00:00.000Z",
      }, error: null };
    }
    if (name === "sellerpilot_service_qoo10_inquiry_identity_context_v1") {
      return { data: {
        contract: "sellerpilot-qoo10-inquiry-identity-context/1",
        ownerId: QOO10_OWNER_ID,
        sellerAccountKey: QOO10_SELLER_ACCOUNT_KEY,
        sourceCredentialId: claimedJob.credential_id,
        environment: claimedJob.environment,
      }, error: null };
    }
    if (name === "sellerpilot_service_record_elevenst_cs_read_v1") {
      return {
        data: { contract: "sellerpilot-elevenst-cs-read-record/1" },
        error: null,
      };
    }
    if (name === "sellerpilot_service_observe_inquiry_replies_v1") {
      const received = Array.isArray(arguments_.p_observations)
        ? arguments_.p_observations.length
        : 0;
      return {
        data: {
          contract: "sellerpilot-reply-observation-result/1",
          received,
          stored: received,
          matched: 0,
          unmatched: received,
          ambiguous: 0,
        },
        error: null,
      };
    }
    if (name === "sellerpilot_service_record_cs_history_page_v1") {
      return {
        data: {
          contract: "cs_history_coverage_v1",
          status: "completed",
          jobId: claimedJob.id,
        },
        error: null,
      };
    }
    if (name === "sellerpilot_service_record_cs_credential_binding_v1") {
      return {
        data: {
          contract: "sellerpilot-cs-credential-binding/1",
          status: "recorded",
          bindingCount: Array.isArray((arguments_.p_evidence as { targetFingerprints?: unknown[] } | undefined)?.targetFingerprints)
            ? (arguments_.p_evidence as { targetFingerprints: unknown[] }).targetFingerprints.length
            : 0,
        },
        error: null,
      };
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

test("a missing publication review RPC is reported even while other reads continue", async () => {
  const logged: unknown[] = [];
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    rpc: baseRpc(claim("qoo10"),calls,{
      sellerpilot_service_enqueue_due_publication_reviews: () => ({data:null,error:{code:"PGRST202"}}),
    }),
    logError: (...values) => logged.push(values),
    executeProvider: async () => inquiryListResult("qoo10"),
  });
  assert.equal(response.status,200);
  assert.ok(calls.some((call) =>
    call.name === "sellerpilot_service_enqueue_periodic_sync"));
  assert.ok(calls.some((call) =>
    call.name === "sellerpilot_service_complete_serverless_cs_transaction"));
  assert.ok(calls.some((call) => call.name === "sellerpilot_service_enqueue_due_publication_reviews"));
  assert.deepEqual(logged[0],["publication_review_enqueue",{status:503,code:"PGRST202"}]);
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

test("normal drain enqueues only current supported inquiries before bounded concurrent claims", async () => {
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
      if (name === "sellerpilot_service_enqueue_ebay_case_dispute_collection_v2") {
      return { data: {
        contract: "sellerpilot-ebay-case-dispute-collection-enqueue/1",
        anchorAt: (arguments_.p_plan as { anchorAt: string }).anchorAt,
        attempted: 3, queued: 0, pending: 1, scopeBlocked: 0, deferred: 2,
        status: "accepted",
      }, error: null };
    }
    if (name === "sellerpilot_service_enqueue_lazada_inquiry_fanout") {
        return {
          data: { status: "already_pending", accounts: [{ status: "already_pending" }] },
          error: null,
        };
      }
      assert.equal(completedEnqueues, 10);
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
      attempted: 12,
      queued: 0,
      pending: 12,
      notConnected: 0,
      reconnectRequired: 0,
      reconciliationRequired: 0,
      fixedEgressRequired: 0,
      failed: 0,
    },
    jobs: [],
  });
  const enqueues = calls.filter(({ name }) => name === "sellerpilot_service_enqueue_periodic_sync");
  assert.equal(enqueues.length, 10);
  const lazadaFanout = calls.filter(({ name }) =>
    name === "sellerpilot_service_enqueue_lazada_inquiry_fanout");
  assert.equal(lazadaFanout.length, 1);
  assert.deepEqual(lazadaFanout[0]?.arguments_.p_request_payload, {
    periodicKey: "inquiries:bootstrap",
    arguments: {
      bootstrap: true,
      startTime: fixedNow.getTime(),
      pageSize: 20,
      sessionLimit: 100,
      messageLimit: 100,
    },
  });
  assert.equal(lazadaFanout[0]?.arguments_.p_min_interval_minutes, 1);
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
  assert.equal(SERVERLESS_GATEWAY_MAX_PERIODIC_JOBS_PER_FIVE_MINUTES, 79);
  assert.ok(
    SERVERLESS_CS_DRAIN_CONCURRENCY * 10
      > SERVERLESS_GATEWAY_MAX_PERIODIC_JOBS_PER_FIVE_MINUTES,
  );
  assert.equal(SERVERLESS_CS_PERIODIC_MIN_INTERVAL_MINUTES, 1);
  assert.deepEqual(
    enqueues.map(({ arguments_ }) => arguments_.p_channel).sort(),
    ["ebay", "ebay", "ebay", "ebay", "qoo10", "qoo10", "qoo10", "qoo10", "shopee", "shopee"],
  );
  assert.ok(enqueues.every(({ arguments_ }) =>
    arguments_.p_operation === "inquiries.list"
      && arguments_.p_min_interval_minutes === 1));
  assert.deepEqual(
    enqueues.map(({ arguments_ }) => {
      const payload = arguments_.p_request_payload as { periodicKey: string };
      return `${arguments_.p_channel}:${payload.periodicKey}`;
    }).sort(),
    [
      "ebay:inquiries:asq",
      "ebay:inquiries:conversation:from_ebay",
      "ebay:inquiries:conversation:from_members",
      "ebay:inquiries:mailbox",
      "qoo10:inquiries:0",
      "qoo10:inquiries:1",
      "qoo10:inquiries:2",
      "qoo10:inquiries:claim:all",
      "shopee:inquiries:product_review",
      "shopee:inquiries:return_refund",
    ],
  );
  const serializedEnqueues = JSON.stringify(enqueues);
  assert.doesNotMatch(serializedEnqueues, /orders\.list|inquiries:history|lazada|elevenst|temu/i);
  assert.deepEqual(enqueues.filter(({ arguments_ }) => arguments_.p_channel === "ebay")
    .map(({ arguments_ }) => (arguments_.p_request_payload as { periodicKey?: string }).periodicKey)
    .sort(), [
      "inquiries:asq",
      "inquiries:conversation:from_ebay",
      "inquiries:conversation:from_members",
      "inquiries:mailbox",
    ]);
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

test("Smartstore and Coupang current reads require explicit static egress", () => {
  const enqueues = serverlessCsCurrentInquiryEnqueues(
    new Date("2026-08-28T07:00:00.000Z"),
    ["coupang", "smartstore"],
  );
  assert.equal(enqueues.length, 18);
  assert.deepEqual(
    enqueues.map(({ channel }) => channel).sort(),
    ["coupang", "coupang", "coupang", "coupang", "coupang", "ebay", "ebay", "ebay", "ebay", "lazada", "qoo10", "qoo10", "qoo10", "qoo10", "shopee", "shopee", "smartstore", "smartstore"],
  );
});

test("explicit Temu static egress enables its current inquiry read", () => {
  const enqueues = serverlessCsCurrentInquiryEnqueues(
    new Date("2026-08-28T07:00:00.000Z"),
    ["temu"],
  );
  assert.equal(enqueues.length, 12);
  assert.deepEqual(
    enqueues.map(({ channel }) => channel).sort(),
    ["ebay", "ebay", "ebay", "ebay", "lazada", "qoo10", "qoo10", "qoo10", "qoo10", "shopee", "shopee", "temu"],
  );
  const temu = enqueues.find(({ channel }) => channel === "temu");
  assert.equal(temu?.operation, "inquiries.list");
  assert.equal(temu?.payload.periodicKey, "inquiries:after_sales");
  assert.equal(temu?.payload.arguments.includeDetails, true);
  assert.ok(Number(temu?.payload.arguments.updateAtEnd) < 10_000_000_000);
});

test("explicit 11st static egress enables the exact Product Q&A current read", () => {
  const enqueues = serverlessCsCurrentInquiryEnqueues(
    new Date("2026-09-08T03:00:00.000Z"),
    ["elevenst"],
  );
  const elevenst = enqueues.filter(({ channel }) => channel === "elevenst");
  assert.equal(elevenst.length, 2);
  assert.equal(elevenst[0]?.payload.periodicKey, "inquiries:product_qna:all");
  assert.deepEqual(elevenst[0]?.payload.arguments, {
    kind: "product_qna", startDate: "20260902", endDate: "20260908", answerStatus: "00",
  });
});

test("daily repair pass rechecks Qoo10, Shopee and Temu returns, retained eBay history and Smartstore while rotating one bounded Coupang window", () => {
  const repair = serverlessCsRepairInquiryEnqueues(
    new Date("2026-09-06T18:02:00.000Z"),
    ["coupang", "smartstore", "temu"],
  );
  assert.equal(repair.length, 167);
  assert.equal(repair.filter(({ channel }) => channel === "coupang").length, 5);
  assert.equal(repair.filter(({ channel }) => channel === "smartstore").length, 2);
  const qoo10Repair = repair.filter(({ channel }) => channel === "qoo10");
  assert.equal(qoo10Repair.length, 120);
  assert.equal(new Set(qoo10Repair.map(({ payload }) => payload.periodicKey)).size, 120);
  assert.equal(repair.filter(({ channel }) => channel === "shopee").length, 2);
  assert.equal(repair.filter(({ channel }) => channel === "temu").length, 1);
  assert.equal(repair.filter(({ channel }) => channel === "ebay").length, 37);
  assert.ok(repair.every(({ payload }) => payload.periodicKey.startsWith("inquiries:history:")));
  const coupangRanges = new Set(repair.filter(({ channel }) => channel === "coupang")
    .map(({ payload }) => payload.periodicKey.split(":").slice(2, 4).join(":")));
  assert.equal(coupangRanges.size, 1);
  assert.deepEqual(serverlessCsRepairInquiryEnqueues(
    new Date("2026-09-06T18:05:00.000Z"),
    ["coupang", "smartstore", "temu"],
  ), []);
  const repairWithoutStaticEgress = serverlessCsRepairInquiryEnqueues(
    new Date("2026-09-06T18:02:00.000Z"),
    [],
  );
  assert.equal(repairWithoutStaticEgress.filter(({ channel }) => channel === "qoo10").length, 120);
  assert.equal(repairWithoutStaticEgress.filter(({ channel }) => channel === "shopee").length, 2);
  assert.equal(repairWithoutStaticEgress.filter(({ channel }) => channel === "ebay").length, 37);
  assert.equal(serverlessCsRepairInquiryEnqueues(
    new Date("2026-09-06T19:02:00.000Z"),
    ["coupang", "smartstore", "temu"],
  ).length, 167, "the next KST hour catches up after a missed 03:00 run");
});

test("11st daily repair offers five disjoint seven-day-or-smaller Product Q&A windows", () => {
  const repair = serverlessCsRepairInquiryEnqueues(
    new Date("2026-09-06T18:02:00.000Z"),
    ["elevenst"],
  ).filter(({ channel }) => channel === "elevenst");
  assert.equal(repair.length, 6);
  assert.equal(repair.filter(({ payload }) => payload.periodicKey.endsWith(":product_qna:all")).length, 5);
  assert.equal(repair.filter(({ payload }) => payload.periodicKey.endsWith(":urgent_alimi:all")).length, 1);
});

test("configured repair enqueues use a daily cooldown with hourly catch-up offers", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  let activeEnqueues = 0;
  let maxActiveEnqueues = 0;
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    now: () => new Date("2026-09-06T18:02:00.000Z"),
    staticEgressChannels: ["coupang", "smartstore", "temu"],
    enableHistoryRepair: true,
    rpc: async (name, arguments_ = {}) => {
      calls.push({ name, arguments_ });
      if (name === "sellerpilot_service_enqueue_periodic_sync") {
        activeEnqueues += 1;
        maxActiveEnqueues = Math.max(maxActiveEnqueues, activeEnqueues);
        await new Promise((resolve) => setTimeout(resolve, 1));
        activeEnqueues -= 1;
        return { data: { status: "already_pending" }, error: null };
      }
      if (name === "sellerpilot_service_enqueue_ebay_case_dispute_collection_v2") {
      return { data: {
        contract: "sellerpilot-ebay-case-dispute-collection-enqueue/1",
        anchorAt: (arguments_.p_plan as { anchorAt: string }).anchorAt,
        attempted: 3, queued: 0, pending: 1, scopeBlocked: 0, deferred: 2,
        status: "accepted",
      }, error: null };
    }
    if (name === "sellerpilot_service_enqueue_lazada_inquiry_fanout") {
        return {
          data: { status: "already_pending", accounts: [{ status: "already_pending" }] },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  });
  assert.equal(response.status, 200);
  const enqueues = calls.filter(({ name }) => name === "sellerpilot_service_enqueue_periodic_sync");
  assert.equal(enqueues.length, 185);
  const repair = enqueues.filter(({ arguments_ }) =>
    String((arguments_.p_request_payload as { periodicKey?: string }).periodicKey).startsWith("inquiries:history:"));
  assert.equal(repair.length, 167);
  assert.equal(maxActiveEnqueues, SERVERLESS_CS_ENQUEUE_CONCURRENCY);
  assert.ok(repair.every(({ arguments_ }) => arguments_.p_min_interval_minutes === 1440));
  assert.ok(enqueues.filter((entry) => !repair.includes(entry))
    .every(({ arguments_ }) => arguments_.p_min_interval_minutes === 1));
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
          && (arguments_.p_request_payload as { periodicKey: string }).periodicKey === "inquiries:0"
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
    attempted: 12,
    queued: 0,
    pending: 11,
    notConnected: 0,
    reconnectRequired: 0,
    reconciliationRequired: 0,
    fixedEgressRequired: 0,
    failed: 1,
  });
  assert.equal(providerCalls, 1);
  assert.deepEqual(logged, [
    ["publication_review_enqueue", { status: 503, code: "unexpected_rpc" }],
    ["enqueue", { status: 503, failed: 1, total: 12 }],
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
      attempted: 12,
      queued: 0,
      pending: 0,
      notConnected: 0,
      reconnectRequired: 0,
      reconciliationRequired: 0,
      fixedEgressRequired: 0,
      failed: 12,
    },
    needsAttention: true,
    jobs: [],
  });
  assert.equal(claimCalls, SERVERLESS_CS_DRAIN_CONCURRENCY);
  assert.deepEqual(logged, [
    ["publication_review_enqueue", { status: 503, code: "unexpected_rpc" }],
    ["enqueue", { status: 503, failed: 12, total: 12 }],
  ]);
});

test("two fenced jobs run concurrently within configured drain capacity", async () => {
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
      if (name === "sellerpilot_service_reserve_provider_rate_budget_v1") {
        return { data: { contract: "sellerpilot-provider-rate-budget/1", status: "reserved", retryAfterSeconds: 0 }, error: null };
      }
      if (name === "sellerpilot_service_qoo10_inquiry_identity_context_v1") {
        return { data: {
          contract: "sellerpilot-qoo10-inquiry-identity-context/1",
          ownerId: QOO10_OWNER_ID,
          sellerAccountKey: QOO10_SELLER_ACCOUNT_KEY,
          sourceCredentialId: firstJob.credential_id,
          environment: firstJob.environment,
        }, error: null };
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
      attempted: 12,
      queued: 0,
      pending: 12,
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
    staticEgressChannels: ["smartstore"],
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
    providerContext: {
      identityContract: "smartstore-provider-ticket-v1",
      legacyExternalTicketId: "customer:987654321",
      providerTicketKind: "customer",
      providerTicketId: "987654321",
      kind: "customer",
      inquiryNo: "987654321",
      orderReferenceState: "unavailable",
      unsequencedAnswers: [],
    },
    replyContext: { kind: "customer", inquiryNo: "987654321" },
    providerStatus: "waiting",
    ticketKind: "conversation",
  }]);
  const durableResponse = JSON.stringify(complete?.arguments_.p_response_payload);
  assert.doesNotMatch(durableResponse, /배송지를 변경할 수 있나요\?|구매자|배송 문의|987654321/);
});

test("11st Product Q&A crosses the fixed-egress executor and reaches sanitized atomic ingestion", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const job = claim("elevenst", "inquiries.list");
  let observedArguments: unknown;
  const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
    cronSecret: CRON_SECRET,
    staticEgressChannels: ["elevenst"],
    rpc: baseRpc(job, calls),
    executeProvider: input => executeServerlessCsProviderJob(input, async (operationInput) => {
      observedArguments = structuredClone(operationInput.arguments);
      return elevenstInquiryListResult();
    }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(observedArguments, {
    startDate: "20260902",
    endDate: "20260908",
    answerStatus: "00",
  });
  const complete = calls.find(({ name }) => name === "sellerpilot_service_complete_serverless_cs_transaction");
  const inquiries = structuredClone(complete?.arguments_.p_normalized_inquiries) as Array<Record<string, unknown>>;
  assert.match(String(inquiries[0]?.inboundKey ?? ""), /^elevenst:[0-9a-f]{64}$/u);
  delete inquiries[0]?.inboundKey;
  assert.deepEqual(inquiries, [{
    externalTicketId: "elevenst:81234567",
    externalOrderReference: "202609080001",
    customerName: "11번가 고객",
    subject: "배송 문의",
    message: "배송은 언제 시작하나요?",
    status: "waiting",
    priority: 2,
    receivedAt: "2026-09-08T01:15:30.000Z",
    remoteMessageId: "qna:81234567:question",
    senderRole: "customer",
    providerContext: {
      kind: "product_qna",
      brdInfoNo: "81234567",
      prdNo: "13749310594",
      qnaTypeCode: "02",
      qnaType: "배송",
      buyYn: "Y",
      dispYn: "Y",
      answerYn: "N",
      answerDate: "",
      orderNo: "202609080001",
      orderPaymentDate: "2026-09-08",
      unsequencedAnswers: [],
    },
    replyContext: { brdInfoNo: "81234567", prdNo: "13749310594" },
    providerStatus: "waiting",
    ticketKind: "conversation",
  }]);
  const durableResponse = JSON.stringify(complete?.arguments_.p_response_payload);
  assert.match(durableResponse, /normalized_inquiries_v1/u);
  assert.doesNotMatch(durableResponse, /배송은 언제 시작하나요|11번가 고객|81234567|13749310594/u);
  const readObservation = calls.find(
    ({ name }) => name === "sellerpilot_service_record_elevenst_cs_read_v1",
  );
  assert.deepEqual(readObservation?.arguments_.p_inquiries, []);
  assert.equal((readObservation?.arguments_.p_observation as { accepted?: boolean }).accepted, true);
  assert.doesNotMatch(JSON.stringify(readObservation), /배송은 언제 시작하나요|11번가 고객|81234567|13749310594/u);
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
  const normalized = qoo10Inquiries[0] ?? {};
  const providerContext = normalized.providerContext as Record<string, unknown>;
  const replyContext = normalized.replyContext as Record<string, unknown>;
  assert.match(String(normalized.inboundKey ?? ""), /^qoo10:inbound:[0-9a-f]{64}$/);
  assert.match(String(normalized.externalTicketId ?? ""), /^qoo10:conversation:[0-9a-f]{64}$/);
  assert.match(String(providerContext.accountIdentityDigest ?? ""), /^[0-9a-f]{64}$/);
  assert.equal(
    normalized.inboundKey,
    `qoo10:inbound:${providerContext.messageIdentityDigest}`,
  );
  assert.equal(
    normalized.externalTicketId,
    `qoo10:conversation:${providerContext.conversationIdentityDigest}`,
  );
  assert.deepEqual(providerContext.legacyExternalTicketIds, ["qoo10:MSG:12345678:87654321"]);
  assert.equal(replyContext.legacyExternalTicketId, "qoo10:MSG:12345678:87654321");
  delete normalized.inboundKey;
  delete normalized.externalTicketId;
  delete providerContext.accountIdentityDigest;
  delete providerContext.accountScopedInboundKey;
  delete providerContext.conversationIdentityDigest;
  delete providerContext.legacyExternalTicketIds;
  delete providerContext.messageIdentityDigest;
  delete providerContext.messageIdentityVersion;
  delete providerContext.providerExternalTicketId;
  delete providerContext.ticketIdentityVersion;
  delete replyContext.legacyExternalTicketId;
  assert.deepEqual(qoo10Inquiries, [{
    customerName: "Qoo10 민감 구매자",
    subject: "Qoo10 민감 문의 제목",
    message: "배송 상태를 알려 주세요.",
    status: "waiting",
    priority: 3,
    receivedAt: "2026-08-28T01:23:45.000Z",
    remoteMessageId: "87654321",
    providerContext: { inquiryType: "MSG", questionNo: "12345678", sequenceNo: "87654321", processingStatus: "S1" },
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

for (const channel of ["ebay", "coupang", "elevenst", "smartstore", "qoo10"] as const) {
  test(`${channel} inquiry reply crosses the exact mutation fence before execution`, async () => {
    const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
    let fenceObserved = false;
    const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
      cronSecret: CRON_SECRET,
      staticEgressChannels: channel === "coupang"
        || channel === "elevenst"
        || channel === "smartstore"
        ? [channel]
        : [],
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
  "LISTING_SHIPPING_CONFIRMATION_REQUIRED",
  "COUPANG_SHIPPING_FEE_CONFIRMATION_REQUIRED",
  "SMARTSTORE_SHIPPING_POLICY_CONFIRMATION_REQUIRED",
  "QOO10_UPDATE_SHIPPING_UNVERIFIED",
]) {
  for (const mutationStarted of [false, true]) {
    test(`shipping setup ${safeReason} keeps remediation and mutation boundary ${mutationStarted}`, async () => {
      const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
      const response = await runServerlessCsGatewayDrain(authorizedRequest(), {
        cronSecret: CRON_SECRET,
        // An existing listing exercises the generic write fence. A bare
        // listing.create fixture fails the Qoo10 durable-fulfillment gate
        // before any provider mutation can start.
        rpc: baseRpc(qoo10ListingUpdateClaim(), calls),
        executeProvider: async ({ hooks }) => {
          if (mutationStarted) await hooks.beginProviderMutation();
          throw new Error(`${safeReason}:private provider diagnostic`);
        },
      });
      assert.equal(response.status, 200);
      const complete = calls.find(({ name }) => name === "sellerpilot_service_complete_serverless_cs_transaction");
      assert.equal(complete?.arguments_.p_status, mutationStarted ? "reconciliation_required" : "failed");
      assert.equal(complete?.arguments_.p_error_message, safeReason);
      assert.doesNotMatch(JSON.stringify(complete), /private provider diagnostic/);
    });
  }
}

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
      staticEgressChannels: ["smartstore"],
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
    staticEgressChannels: ["smartstore"],
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

test("bounded drain route is direct, uses configured capacity, is Node-only, and excludes child workers", async () => {
  const [route, gateway, gatewayRuntime, provider, protocols] = await Promise.all([
    readFile(new URL("../app/api/internal/channel-gateway-drain/route.ts", import.meta.url), "utf8"),
    Promise.all(["../lib/channels/serverless-gateway.ts", "../lib/cs/operations/schedule.ts"].map(path => readFile(new URL(path, import.meta.url), "utf8"))).then(parts => parts.join("\n")),
    readFile(new URL("../lib/channels/serverless-gateway-runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/channels/commerce-provider.ts", import.meta.url), "utf8"),
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
  assert.match(gateway, /SERVERLESS_CS_DRAIN_CONCURRENCY = 10/);
  assert.match(gateway, /SERVERLESS_GATEWAY_MAX_PERIODIC_JOBS_PER_FIVE_MINUTES = 79/);
  assert.match(gatewayRuntime, /releaseId: process\.env\.SELLERPILOT_RELEASE_SHA/);
  assert.match(gatewayRuntime, /vercelGitCommitSha: process\.env\.VERCEL_GIT_COMMIT_SHA/);
  assert.match(gatewayRuntime, /requireActiveRuntime: true/);
  assert.match(gatewayRuntime, /enableHistoryRepair: true/);
  assert.match(gateway, /sellerpilot_claim_serverless_gateway_job/);
  assert.match(gateway, /sellerpilot_claim_serverless_cs_job/);
  assert.match(gateway, /sellerpilot_claim_ebay_asq_serverless_job/);
  assert.match(gateway, /"qoo10",[\s\S]*"coupang",[\s\S]*"smartstore",[\s\S]*"ebay"/);
  assert.doesNotMatch(`${route}\n${gateway}`, /child_process|\bspawn\s*\(|SELLERPILOT_URL|ai-cli-worker/);
  assert.match(provider, /"listing\.create"[\s\S]*"elevenst"/);
  assert.match(provider, /import \{ channelPriceUpdateRelease \} from "\.\/price-update-release"/);
  assert.match(provider, /if \(operation === "price\.update"\) return channelPriceUpdateRelease\(channel\)\.available/);
  assert.match(protocols, /AsyncLocalStorage<Readonly<ProviderTransportContext>>/);
  assert.match(protocols, /AbortSignal\.any\(\[ownerSignal, timeoutSignal\]\)/);
});


test("Lazada partial V3 ingestion does not complete a gateway job; complete retries avoid double ingestion", async () => {
  for (const status of ["partial", "complete"]) {
    const calls: Array<{name:string;arguments_:Record<string,unknown>}> = [];
    const lazadaJob = { ...claim("lazada"), request: { arguments: { bootstrap: true } } };
    const response = await runOneServerlessCsGatewayJob({
      rpc: baseRpc(lazadaJob, calls, {
        sellerpilot_service_store_lazada_im_raw_event_v1: () => ({ data: {
          contract: "lazada_im_raw_inbox_v1", status: "stored",
          id: "00000000-0000-4000-8000-000000000099", processingStatus: "pending",
        }, error: null }),
        sellerpilot_service_mark_lazada_im_raw_event_v1: (arguments_) => ({ data: {
          contract: "lazada_im_raw_mark_v1", status: arguments_.p_processing_status, id: arguments_.p_id,
        }, error: null }),
        sellerpilot_service_lazada_im_ingest_ready_v3: () => ({ data: true, error: null }),
        sellerpilot_service_lazada_quarantine_ready_v3: () => ({ data: true, error: null }),
        sellerpilot_service_ingest_lazada_gateway_v3: () => ({ data: { contract: "lazada_ingest_v3", status, normalCount: 1, pendingCount: status === "partial" ? 1 : 0 }, error: null }),
      }),
      executeProvider: async () => ({ ok: true, channel: "lazada", operation: "inquiries.list", safeMessage: "fixture", steps: [{ name: "inquiries-message:s:1", ok: true, status: 200, data: { sellerpilotSession: { session_id: "s" }, data: { message_list: [
        { message_id: "buyer", from_account_type: 1, send_time: "2026-09-05T09:01:00Z", content: { txt: "buyer" } },
        { message_id: "seller", from_account_type: 2, content: { txt: "unordered original" } },
      ] } } }] }),
    }, deriveServerlessCsGatewayCredentials(CRON_SECRET).gatewayTokenHash);
    const ingest = calls.find(call => call.name === "sellerpilot_service_ingest_lazada_gateway_v3");
    assert.ok(ingest);
    assert.equal(ingest.arguments_.p_job_id, JOB_ID);
    assert.equal(ingest.arguments_.p_claim_token, CLAIM_TOKEN);
    assert.equal((ingest.arguments_.p_inquiries as unknown[]).length, 2);
    const completion = calls.find(call => call.name === "sellerpilot_service_complete_serverless_cs_transaction");
    const rawStore = calls.find(call => call.name === "sellerpilot_service_store_lazada_im_raw_event_v1");
    assert.equal(rawStore?.arguments_.p_source_kind, "history_page");
    if (status === "partial") {
      assert.equal(completion, undefined);
      assert.equal(response.status, 503);
    } else {
      assert.ok(completion);
      assert.ok(calls.some(call => call.name === "sellerpilot_service_mark_lazada_im_raw_event_v1"));
      assert.deepEqual(completion.arguments_.p_normalized_inquiries, []);
      assert.equal(response.status, 200);
    }
  }
});


for (const allowSecondWrite of [true, false]) {
  test(`Lazada shipment repeats the durable fence before every write: second allowed=${allowSecondWrite}`, async () => {
    const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
    let fenceCalls = 0;
    let providerWrites = 0;
    const response = await runOneServerlessCsGatewayJob({
      staticEgressChannels: ["lazada"],
      rpc: baseRpc(claim("lazada", "shipment.confirm"), calls, {
        sellerpilot_service_begin_serverless_gateway_provider_mutation: () => ({
          data: ++fenceCalls === 1 || allowSecondWrite,
          error: null,
        }),
      }),
      executeProvider: async ({ hooks }) => {
        await hooks.beginProviderMutation({ fresh: true });
        providerWrites += 1; // Pack has already changed remote state.
        await hooks.beginProviderMutation({ fresh: true });
        providerWrites += 1; // RTS must not run after a newly denied fence.
        return { ok: true, channel: "lazada", operation: "shipment.confirm", steps: [{ name: "shipment", ok: true, status: 200, data: { accepted: true } }], remoteId: "test-order-1", safeMessage: "Test shipment complete." };
      },
    }, deriveServerlessCsGatewayCredentials(CRON_SECRET).gatewayTokenHash);
    assert.equal(response.status, 200);
    assert.equal(fenceCalls, 2);
    assert.equal(providerWrites, allowSecondWrite ? 2 : 1);
    const completion = calls.find(({ name }) => name === "sellerpilot_service_complete_serverless_cs_transaction");
    assert.equal(completion?.arguments_.p_status, allowSecondWrite ? "succeeded" : "reconciliation_required");
  });
}

test("non-shipment operations retain their existing one-time provider fence", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const response = await runOneServerlessCsGatewayJob({
    rpc: baseRpc(claim("qoo10", "inquiries.reply"), calls),
    executeProvider: async ({ hooks }) => {
      await hooks.beginProviderMutation();
      await hooks.beginProviderMutation();
      return inquiryReplyResult("qoo10");
    },
  }, deriveServerlessCsGatewayCredentials(CRON_SECRET).gatewayTokenHash);
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { status: string }).status, "succeeded");
  assert.equal(calls.filter(({ name }) => name === "sellerpilot_service_begin_serverless_gateway_provider_mutation").length, 1);
});

test("a denied provider rate reservation is durably deferred before execution", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  let executed = false;
  const response = await runOneServerlessCsGatewayJob({
    rpc: baseRpc(claim("ebay", "inquiries.list"), calls, {
      sellerpilot_service_reserve_provider_rate_budget_v1: () => ({
        data: {
          contract: "sellerpilot-provider-rate-budget/1",
          status: "deferred",
          retryAfterSeconds: 17,
        },
        error: null,
      }),
    }),
    executeProvider: async () => {
      executed = true;
      return inquiryListResult("ebay");
    },
  }, deriveServerlessCsGatewayCredentials(CRON_SECRET).gatewayTokenHash);
  assert.equal(response.status, 200);
  assert.equal(executed, false);
  assert.equal((await response.json() as { deferred: number; retryAfterSeconds: number }).deferred, 1);
  assert.equal(calls.some(({ name }) => name === "sellerpilot_touch_serverless_cs_job"), false);
});

test("the first HTTP request consumes the job reservation and later requests reserve individually", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const response = await runOneServerlessCsGatewayJob({
    rpc: baseRpc(claim("ebay", "inquiries.list"), calls),
    executeProvider: async ({ hooks }) => {
      await hooks.reserveProviderRequest?.();
      await hooks.reserveProviderRequest?.();
      await hooks.reserveProviderRequest?.();
      return inquiryListResult("ebay");
    },
  }, deriveServerlessCsGatewayCredentials(CRON_SECRET).gatewayTokenHash);
  assert.equal(response.status,200);
  assert.equal(calls.filter(({name})=>name==="sellerpilot_service_reserve_provider_rate_budget_v1").length,1);
  assert.equal(calls.filter(({name})=>name==="sellerpilot_service_reserve_provider_request_rate_budget_v1").length,2);
});

test("a retry-safe 429 is requeued through the durable rate ledger without completion", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const limited = inquiryListResult("ebay");
  limited.ok = false;
  limited.steps[0] = {
    ...limited.steps[0],
    ok: false,
    status: 429,
    data: { responseHeaders: { "retry-after": "23" } },
  };
  const response = await runOneServerlessCsGatewayJob({
    rpc: baseRpc(claim("ebay", "inquiries.list"), calls, {
      sellerpilot_service_report_provider_rate_limit_v1: (arguments_) => ({
        data: {
          contract: "sellerpilot-provider-rate-budget/1",
          status: "deferred",
          retryAfterSeconds: arguments_.p_retry_after_seconds,
        },
        error: null,
      }),
    }),
    executeProvider: async () => limited,
  }, deriveServerlessCsGatewayCredentials(CRON_SECRET).gatewayTokenHash);
  const body = await response.json() as { deferred: number; retryAfterSeconds: number };
  assert.equal(body.deferred, 1);
  assert.equal(body.retryAfterSeconds, 23);
  assert.equal(calls.some(({ name }) => name === "sellerpilot_service_complete_serverless_cs_transaction"), false);
});
