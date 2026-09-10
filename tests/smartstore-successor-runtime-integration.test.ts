import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";
import { z } from "zod";

import * as gatewayContract from "../lib/channels/gateway-contract";
import * as commerceWorkerCompletion from "../lib/channels/commerce-worker-completion";
import * as localGatewayRecovery from "../lib/channels/local-gateway-recovery-lane";
import * as localChannelExecutor from "../lib/channels/local-channel-executor";
import * as repairContract from "../lib/server-smartstore-content-repair";

const jobId = "11111111-1111-4111-8111-111111111111";
const claimToken = "22222222-2222-4222-8222-222222222222";
const credentialId = "33333333-3333-4333-8333-333333333333";
const ownerId = "44444444-4444-4444-8444-444444444444";
const productId = "55555555-5555-4555-8555-555555555555";
const listingId = "66666666-6666-4666-8666-666666666666";
const sourceJobId = "77777777-7777-4777-8777-777777777777";
const sourceAttemptId = "88888888-8888-4888-8888-888888888888";
const successorId = "99999999-9999-4999-8999-999999999999";
const receiptId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const attestationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const digest = "c".repeat(64);
const workerToken = `spw_${"d".repeat(32)}`;

const readbackMarker = {
  contract: "smartstore_manual_adoption_readback_job_v1",
  ownerId,
  productId,
  listingId,
  sourceJobId,
  sourceAttemptId,
  credentialId,
  sellerAccountKey: digest,
  sellerSku: "AUTO-780720401E2D4E4EA45F",
  approvalRevision: 1,
  contentSha256: digest,
  manifestDigest: digest,
} as const;

const successorRequest = {
  sellerpilotLineageVersion: "provider_listing_readback_v1",
  arguments: { sellerpilotSmartstoreManualAdoptionReadback: readbackMarker },
  sellerpilotSmartstoreAdoptionRecheckSuccessorId: successorId,
} as const;

const readback = {
  contract: "smartstore_official_manual_adoption_readback_v1",
  source: "smartstore_official_api_readback_v1",
  observedAt: "2026-09-09T01:02:03.000Z",
  providerMutationPerformed: false,
  searchReadback: {
    method: "POST",
    path: "/v1/products/search",
    httpStatus: 200,
    request: { searchKeywordType: "SELLER_CODE" },
    response: { contents: [] },
  },
  originReadback: {
    method: "GET",
    path: "/v2/products/origin-products/13688607602",
    httpStatus: 200,
    request: null,
    response: { originProductNo: 13688607602 },
  },
  channelReadback: {
    method: "GET",
    path: "/v2/products/channel-products/13749310594",
    httpStatus: 200,
    request: null,
    response: { channelProductNo: 13749310594 },
  },
  detailImageUrls: Array.from(
    { length: 8 },
    (_, index) => `https://shop-phinf.pstatic.net/20260909/detail-${index + 1}.jpg`,
  ),
  detailImagePixelSha256s: Array.from(
    { length: 8 },
    (_, index) => (index + 1).toString(16).repeat(64).slice(0, 64),
  ),
} as const;

const workerResult = {
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
      detailImageCount: 8,
    },
  }],
  safeMessage: "스마트스토어 공식 API에서 기존 상품과 상세 이미지 8개를 읽기 전용으로 확인했습니다.",
} as const;

async function compiledRoute(relativeUrl: string) {
  const source = await readFile(new URL(relativeUrl, import.meta.url), "utf8");
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function routeContext(
  compiled: string,
  requireModule: (name: string) => unknown,
  environment: Record<string, string> = { SUPABASE_SECRET_KEY: "fixture-secret" },
) {
  const context = vm.createContext({
    exports: {},
    Buffer,
    Request,
    Response,
    URL,
    process: { env: environment },
    require: requireModule,
    console: { error() {}, warn() {}, log() {} },
  });
  vm.runInContext(compiled, context, { timeout: 1_000 });
  return context.exports as Record<string, (...args: never[]) => Promise<Response>>;
}

test("current claim and completion routes carry one exact GET-only successor into the dedicated atomic RPC", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const claimRow = {
    id: jobId,
    claim_token: claimToken,
    credential_id: credentialId,
    channel: "smartstore",
    operation: "listing.lineage.verify",
    environment: "production",
    request: successorRequest,
    credential: {},
    attempt_count: 1,
  };
  const claimCompiled = await compiledRoute(
    "../app/api/channel-gateway/worker/claim/route.ts",
  );
  const claimExports = routeContext(claimCompiled, (name) => {
    if (name === "node:crypto") return crypto;
    if (name === "next/server") return { NextResponse: Response };
    if (name === "@supabase/supabase-js") {
      return {
        createClient: () => ({
          rpc: async (rpcName: string, args: Record<string, unknown>) => {
            calls.push({ name: rpcName, args });
            if (rpcName === "sellerpilot_service_reserve_provider_rate_budget_v1") {
              return {
                data: {
                  contract: "sellerpilot-provider-rate-budget/1",
                  status: "reserved",
                },
                error: null,
              };
            }
            return { data: claimRow, error: null };
          },
        }),
      };
    }
    if (name.endsWith("/gateway-contract")) return gatewayContract;
    if (name.endsWith("/local-gateway-recovery-lane")) return localGatewayRecovery;
    if (name.endsWith("/local-channel-executor")) return localChannelExecutor;
    if (name.endsWith("/price-update-release")) {
      return { channelPriceUpdateRelease: () => ({ available: true }) };
    }
    if (name.endsWith("/supabase/config")) return { supabaseUrl: "https://fixture.supabase.co" };
    if (name.endsWith("/worker-rpc")) {
      return {
        createBoundedSupabaseFetch: () => fetch,
        workerRpcErrorMessage: () => "fixture error",
        workerRpcErrorStatus: () => 503,
      };
    }
    throw new Error(`unexpected claim import ${name}`);
  });
  const claimResponse = await claimExports.POST(new Request(
    "https://fixture.invalid/api/channel-gateway/worker/claim",
    {
      method: "POST",
      headers: { authorization: `Bearer ${workerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ version: "sellerpilot-cli-worker/integration" }),
    },
  ) as never);
  assert.equal(claimResponse.status, 200);
  const claimed = await claimResponse.json() as typeof claimRow;
  assert.equal(
    claimed.request.sellerpilotSmartstoreAdoptionRecheckSuccessorId,
    successorId,
  );
  assert.equal(
    gatewayContract.smartstoreManualAdoptionReadbackJobSchema.safeParse(
      claimed.request.arguments.sellerpilotSmartstoreManualAdoptionReadback,
    ).success,
    true,
  );
  assert.deepEqual(calls.map((call) => call.name), [
    "sellerpilot_claim_channel_gateway_job",
    "sellerpilot_service_reserve_provider_rate_budget_v1",
  ]);

  calls.length = 0;
  const completionCompiled = await compiledRoute(
    "../app/api/channel-gateway/worker/complete/route.ts",
  );
  const completeExports = routeContext(completionCompiled, (name) => {
    if (name === "node:crypto") return crypto;
    if (name === "zod") return { z };
    if (name === "next/server") return { NextResponse: Response };
    if (name === "@supabase/supabase-js") {
      return {
        createClient: () => ({
          rpc: async (rpcName: string, args: Record<string, unknown>) => {
            calls.push({ name: rpcName, args });
            if (rpcName === "sellerpilot_service_gateway_completion_context") {
              return {
                data: {
                  status: "running",
                  channel: "smartstore",
                  operation: "listing.lineage.verify",
                  normalization_timestamp: null,
                  publication_verification_boundary: null,
                },
                error: null,
              };
            }
            if (rpcName === "sellerpilot_complete_smartstore_manual_adoption_readback") {
              return {
                data: {
                  contract: "smartstore_manual_adoption_readback_completion_v1",
                  status: "verified",
                  jobId,
                  receiptId,
                  attestationId,
                  baselineId: null,
                  readbackSha256: digest,
                  reused: false,
                  reason: "ADOPTION_ALREADY_VERIFIED",
                },
                error: null,
              };
            }
            throw new Error(`unexpected completion RPC ${rpcName}`);
          },
        }),
      };
    }
    if (name.endsWith("/gateway-contract")) return gatewayContract;
    if (name.endsWith("/channels/commerce-worker-completion")) {
      return commerceWorkerCompletion;
    }
    if (name.endsWith("/shipping/contracts")) {
      return { isShippingOperation: () => false };
    }
    if (name.endsWith("/shipping/worker-completion")) {
      return {
        completeShippingWorker: () => {
          throw new Error("shipping completion must not run for SmartStore successor");
        },
      };
    }
    if (name.endsWith("/cs/operations/contracts")) {
      return { isCsOperation: () => false };
    }
    if (name.endsWith("/cs/operations/worker-completion")) {
      return {
        completeCsWorker: () => {
          throw new Error("CS completion must not run for SmartStore successor");
        },
        completeCsWorkerRetry: () => {
          throw new Error("CS retry must not run for SmartStore successor");
        },
      };
    }
    if (name.endsWith("/server-smartstore-content-repair")) return repairContract;
    if (name.endsWith("/inquiry-sync")) return { normalizeChannelInquiries: () => [] };
    if (name.endsWith("/lazada-im-webhook")) return { lazadaQuarantineReady: () => false };
    if (name.endsWith("/order-sync")) return { normalizeChannelOrders: () => [] };
    if (name.endsWith("/supabase/config")) return { supabaseUrl: "https://fixture.supabase.co" };
    if (name.endsWith("/push-notifications")) {
      return { dispatchPendingPushNotifications: async () => undefined };
    }
    if (name.endsWith("/worker-rpc")) {
      return {
        createBoundedSupabaseFetch: () => fetch,
        workerRpcErrorMessage: () => "fixture error",
        workerRpcErrorStatus: () => 503,
      };
    }
    throw new Error(`unexpected completion import ${name}`);
  });
  const completionResponse = await completeExports.POST(new Request(
    "https://fixture.invalid/api/channel-gateway/worker/complete",
    {
      method: "POST",
      headers: { authorization: `Bearer ${workerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ jobId, claimToken, status: "succeeded", result: workerResult }),
    },
  ) as never);
  assert.equal(completionResponse.status, 200);
  assert.deepEqual(calls.map((call) => call.name), [
    "sellerpilot_service_gateway_completion_context",
    "sellerpilot_complete_smartstore_manual_adoption_readback",
  ]);
  const dedicated = calls[1]?.args;
  assert.equal(dedicated?.p_job_id, jobId);
  assert.equal(dedicated?.p_claim_token, claimToken);
  assert.equal(dedicated?.p_status, "succeeded");
  assert.deepEqual(dedicated?.p_readback, readback);
  assert.equal(JSON.stringify(calls).includes("sellerpilot_service_complete_gateway_transaction"), false);
  assert.equal(JSON.stringify(calls).includes("sellerpilot_complete_smartstore_content_repair"), false);
});
