import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GatewayWorkerCompletion } from "../lib/channels/gateway-contract";
import {
  smartstoreListingCreateCompletionReceiptFromWorkerResult,
} from "../lib/server-smartstore-listing-create-completion";

registerHooks({ resolve(specifier, context, next) {
  if (specifier === "server-only") {
    return { shortCircuit: true, url: "data:text/javascript,export default {}" };
  }
  return next(specifier, context);
} });

const { completeCommerceWorker } = await import(
  "../lib/channels/commerce-worker-completion"
);

const jobId = "10000000-0000-4000-8000-000000000007";
const claimToken = "10000000-0000-4000-8000-000000000008";
const originProductNo = "10000001";
const channelProductNo = "20000001";

function originReadback(name: string, salePrice: number, stockQuantity: number) {
  return {
    originProduct: {
      name,
      salePrice,
      stockQuantity,
    },
  };
}

function listingCreateResult(
  name = "스마트스토어 전송 바이트 고정",
  salePrice = 10_000,
  stockQuantity = 1,
) {
  return {
    ok: true,
    channel: "smartstore" as const,
    operation: "listing.create" as const,
    remoteId: originProductNo,
    safeMessage: "스마트스토어 등록 결과가 확인됐습니다.",
    remoteState: {
      resources: {
        originProductNo,
        smartstoreChannelProductNo: channelProductNo,
      },
    },
    steps: [
      {
        name: "origin-product-publication-readback",
        ok: true,
        status: 200,
        data: originReadback(name, salePrice, stockQuantity),
      },
      {
        name: "product-create-identity-readback",
        ok: true,
        status: 200,
        data: {
          officialOriginProductNo: originProductNo,
          officialChannelProductNo: channelProductNo,
        },
      },
    ],
  };
}

function succeededCompletion(
  result = listingCreateResult(),
): GatewayWorkerCompletion {
  return {
    jobId,
    claimToken,
    status: "succeeded",
    result,
  } as GatewayWorkerCompletion;
}

test("worker receipt keeps official commercial fields and rejects a missing identity", () => {
  const receipt = smartstoreListingCreateCompletionReceiptFromWorkerResult(
    listingCreateResult(),
  );
  assert.equal(receipt.originProductNo, originProductNo);
  assert.equal(receipt.channelProductNo, channelProductNo);
  assert.deepEqual(receipt.responsePayload.originProduct, {
    name: "스마트스토어 전송 바이트 고정",
    salePrice: 10_000,
    stockQuantity: 1,
  });
  assert.throws(
    () => smartstoreListingCreateCompletionReceiptFromWorkerResult({
      ...listingCreateResult(),
      remoteState: { resources: {} },
      steps: [{
        name: "origin-product-publication-readback",
        ok: false,
        status: 422,
        data: originReadback("다른 제목", 990_000, 99),
      }],
    }),
    /SMARTSTORE_CREATE_COMPLETION_INVALID/u,
  );
});

test("SmartStore listing.create worker completion uses the dedicated RPC", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name !== "sellerpilot_complete_smartstore_listing_create") {
        throw new Error(`unexpected RPC ${name}`);
      }
      return {
        data: {
          contract: "smartstore_create_completion_v1",
          jobId: args.p_job_id,
          status: "completed",
          originProductNo: args.p_origin_product_no,
          channelProductNo: args.p_channel_product_no,
          bodySha256: "a".repeat(64),
          reused: false,
        },
        error: null,
      };
    },
  } as unknown as SupabaseClient;
  const reply = await completeCommerceWorker({
    serviceClient: client,
    tokenHash: "token-hash",
    job: { channel: "smartstore", operation: "listing.create" },
    completion: succeededCompletion(),
  });
  assert.equal(reply.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.name, "sellerpilot_complete_smartstore_listing_create");
  assert.equal(calls[0]?.args.p_origin_product_no, originProductNo);
  assert.equal(calls[0]?.args.p_channel_product_no, channelProductNo);
  assert.deepEqual(
    (calls[0]?.args.p_response_payload as { originProduct: unknown }).originProduct,
    { name: "스마트스토어 전송 바이트 고정", salePrice: 10_000, stockQuantity: 1 },
  );
  assert.equal(
    JSON.stringify(calls).includes("sellerpilot_service_complete_gateway_transaction"),
    false,
  );
});

test("same snapshot with a different title/price/stock body never uses generic completion", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name !== "sellerpilot_complete_smartstore_listing_create") {
        throw new Error(`unexpected RPC ${name}`);
      }
      const origin = (args.p_response_payload as {
        originProduct?: { name?: unknown; salePrice?: unknown; stockQuantity?: unknown };
      } | undefined)?.originProduct;
      if (origin?.name === "다른 제목"
          || origin?.salePrice === 990_000
          || origin?.stockQuantity === 99) {
        return {
          data: null,
          error: { code: "55000", message: "SMARTSTORE_CREATE_COMPLETION_SOURCE_MISMATCH" },
        };
      }
      throw new Error("expected mismatched commercial fields");
    },
  } as unknown as SupabaseClient;
  const reply = await completeCommerceWorker({
    serviceClient: client,
    tokenHash: "token-hash",
    job: { channel: "smartstore", operation: "listing.create" },
    completion: succeededCompletion(listingCreateResult("다른 제목", 990_000, 99)),
  });
  assert.equal(reply.status, 503);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.name, "sellerpilot_complete_smartstore_listing_create");
  assert.equal(
    JSON.stringify(calls).includes("sellerpilot_service_complete_gateway_transaction"),
    false,
  );
});

test("failed SmartStore listing.create does not fall through to generic completion", async () => {
  const calls: Array<{ name: string }> = [];
  const client = {
    rpc: async (name: string) => {
      calls.push({ name });
      throw new Error(`unexpected RPC ${name}`);
    },
  } as unknown as SupabaseClient;
  const reply = await completeCommerceWorker({
    serviceClient: client,
    tokenHash: "token-hash",
    job: { channel: "smartstore", operation: "listing.create" },
    completion: {
      jobId,
      claimToken,
      status: "failed",
      error: "NAVER_CREATE_FAILED",
    } as GatewayWorkerCompletion,
  });
  assert.equal(reply.status, 409);
  assert.deepEqual(calls, []);
});
