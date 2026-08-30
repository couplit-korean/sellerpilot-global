import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  qoo10RollbackUpdateRecoveryArgument,
  qoo10RollbackUpdateRecoveryContract,
} from "../lib/channels/listing-update";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const { executeViaChannelGateway } = await import("../lib/channels/gateway");

const listingId = "11111111-1111-4111-8111-111111111111";
const credentialId = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333";
const sourceJobId = "44444444-4444-4444-8444-444444444444";
const gatewayJobId = "55555555-5555-4555-8555-555555555555";
const remoteId = "1234567890";
const marker = {
  status: "allowed",
  contract: qoo10RollbackUpdateRecoveryContract,
  listingId,
  remoteId,
  providerStatus: "S1",
  sourceJobId,
  expectedState: {
    categoryCode: "320002604",
    retailPriceJpy: 1871,
    sellPriceJpy: 1871,
    quantity: 1,
    shippingNo: "0",
    biContentsNo: 8461402963,
  },
} as const;

test("listing gateway enqueue receives the exact server-owned Qoo10 recovery identity in its atomic request payload", async () => {
  const calls: Array<{ name: string; argumentsValue: Record<string, unknown> }> = [];
  const serviceClient = {
    rpc: async (name: string, argumentsValue: Record<string, unknown>) => {
      calls.push({ name, argumentsValue });
      if (name === "sellerpilot_service_enqueue_listing_gateway_job") {
        return {
          data: { status: "queued", job_id: gatewayJobId, attempt_id: attemptId },
          error: null,
        };
      }
      if (name === "sellerpilot_get_channel_gateway_job") {
        return {
          data: {
            status: "succeeded",
            response: {
              ok: true,
              channel: "qoo10",
              operation: "listing.update",
              steps: [{ name: "verified", ok: true, status: 200, data: {} }],
              remoteId,
              safeMessage: "verified",
            },
          },
          error: null,
        };
      }
      throw new Error(`unexpected RPC: ${name}`);
    },
  } as unknown as SupabaseClient;
  const argumentsValue = {
    [qoo10RollbackUpdateRecoveryArgument]: marker,
    params: { ItemCode: remoteId },
  };

  await executeViaChannelGateway({
    serviceClient,
    credentialId,
    attemptId,
    channel: "qoo10",
    operation: "listing.update",
    arguments: argumentsValue,
    listingId,
    timeoutMs: 1_000,
  });

  assert.equal(calls[0]?.name, "sellerpilot_service_enqueue_listing_gateway_job");
  assert.deepEqual(calls[0]?.argumentsValue.p_request_payload, { arguments: argumentsValue });
  assert.equal(calls[1]?.name, "sellerpilot_get_channel_gateway_job");
});

test("an atomic Qoo10 recovery enqueue drift rejection never proceeds to gateway job polling", async () => {
  const calls: string[] = [];
  const serviceClient = {
    rpc: async (name: string) => {
      calls.push(name);
      if (name === "sellerpilot_service_enqueue_listing_gateway_job") {
        return {
          data: null,
          error: { message: "QOO10_ROLLBACK_UPDATE_ENQUEUE_FENCE_MISMATCH" },
        };
      }
      throw new Error(`unexpected RPC after enqueue rejection: ${name}`);
    },
  } as unknown as SupabaseClient;

  await assert.rejects(executeViaChannelGateway({
    serviceClient,
    credentialId,
    attemptId,
    channel: "qoo10",
    operation: "listing.update",
    arguments: {
      [qoo10RollbackUpdateRecoveryArgument]: marker,
      params: { ItemCode: remoteId },
    },
    listingId,
    timeoutMs: 1_000,
  }), /CHANNEL_GATEWAY_ENQUEUE_FAILED/);
  assert.deepEqual(calls, ["sellerpilot_service_enqueue_listing_gateway_job"]);
});
