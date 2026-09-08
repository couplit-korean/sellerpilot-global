import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { ChannelOperationResult } from "../lib/channels/operations";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export default {}" };
  return nextResolve(specifier, context);
} });
const { runOneServerlessCsGatewayJob } = await import("../lib/channels/serverless-gateway");
const jobId = "10000000-0000-4000-8000-000000000010";
const claimToken = "20000000-0000-4000-8000-000000000010";
const deliveryId = "30000000-0000-4000-8000-000000000010";
type Call = { name: string; args: Record<string, unknown> };

async function run(options: { sequence?: string; transportFailure?: boolean; ownershipLost?: boolean } = {}) {
  const calls: Call[] = [];
  const providerResult: ChannelOperationResult = {
    ok: true, channel: "qoo10", operation: "inquiries.list",
    safeMessage: "fixture read",
    steps: [{ name: "GetInquiryMessage", ok: true, status: 200, data: {
      ResultCode: 0,
      ResultObject: [{ INQ_TYPE: "MSG", QUESTION_NO: "700", SEQ_NO: options.sequence ?? "701",
        STATUS: "S3", CONTENTS: "must-not-persist", BUYER_EMAIL: "fixture@example.invalid" }],
    } }],
  };
  const response = await runOneServerlessCsGatewayJob({
    logError: () => {},
    executeProvider: async () => {
      if (options.transportFailure) throw new Error("fixture transport failure");
      return providerResult;
    },
    rpc: async (name, args = {}) => {
      calls.push({ name, args: structuredClone(args) });
      if (name === "sellerpilot_claim_serverless_gateway_job") return { data: {
        id: jobId, claim_token: claimToken,
        credential_id: "40000000-0000-4000-8000-000000000010",
        channel: "qoo10", operation: "inquiries.list", environment: "sandbox", attempt_count: 1,
        credential: { api_key: "fixture-secret" },
        request: { arguments: {
          params: { proc_status: "S3", search_start_dt: "20260908000000", search_end_dt: "20260908235959" },
          sellerpilotQoo10ReplyReadback: { contractVersion: "sellerpilot-qoo10-reply-readback/1",
            deliveryId, inquiryType: "MSG", questionNo: "700", sequenceNo: "701" },
        } },
      }, error: null };
      if (name === "sellerpilot_service_reserve_provider_rate_budget_v1") return { data: {
        contract: "sellerpilot-provider-rate-budget/1", status: "reserved", retryAfterSeconds: 0,
      }, error: null };
      if (name === "sellerpilot_touch_serverless_cs_job") return { data: "running", error: null };
      if (name === "sellerpilot_service_serverless_cs_completion_context") return { data: {
        status: "running", channel: "qoo10", operation: "inquiries.list",
        normalization_timestamp: "2026-09-08T13:00:00.000Z",
      }, error: null };
      if (name === "sellerpilot_service_complete_serverless_cs_transaction") return {
        data: { status: options.ownershipLost ? "ownership_lost" : "completed" }, error: null,
      };
      if (name === "sellerpilot_service_record_qoo10_reply_s3_readback_v1") return { data: {
        contract: "sellerpilot-qoo10-s3-readback-result/1", deliveryId,
        state: args.p_state, replyContentObserved: false, automaticResendAllowed: false,
      }, error: null };
      return { data: null, error: { code: "unexpected_rpc" } };
    },
  }, "fixture-worker-token-hash");
  return { calls, response };
}

test("actual Qoo10 runOne stores sealed status rows before recording status, with no general inquiry ingestion", async () => {
  const { calls, response } = await run();
  assert.equal(response.status, 200);
  const completed = calls.find(call => call.name === "sellerpilot_service_complete_serverless_cs_transaction")!;
  assert.equal(completed.args.p_normalized_inquiries, null);
  const stored = completed.args.p_response_payload as ChannelOperationResult;
  assert.equal(stored.steps[0].name, "GetInquiryMessage");
  assert.equal(stored.steps[0].data.sellerpilotMarker, "sellerpilot-qoo10-s3-stored-evidence/1");
  assert.doesNotMatch(JSON.stringify(stored), /must-not-persist|BUYER_EMAIL|fixture-secret/);
  const recorded = calls.find(call => call.name === "sellerpilot_service_record_qoo10_reply_s3_readback_v1")!;
  assert.equal(recorded.args.p_state, "verified");
  assert.equal(recorded.args.p_reply_content_observed, false);
  assert.equal(recorded.args.p_resend_allowed, false);
  assert.ok(calls.indexOf(recorded) > calls.indexOf(completed));
});

test("actual Qoo10 runOne keeps a wrong reply sequence incomplete", async () => {
  const { calls, response } = await run({ sequence: "702" });
  assert.equal(response.status, 200);
  const recorded = calls.find(call => call.name === "sellerpilot_service_record_qoo10_reply_s3_readback_v1")!;
  assert.equal(recorded.args.p_state, "incomplete");
  assert.equal(recorded.args.p_reason, "wrong_sequence_observed");
});

test("actual Qoo10 runOne never invents provider rows after transport failure", async () => {
  const { calls, response } = await run({ transportFailure: true });
  assert.equal(response.status, 200);
  const completed = calls.find(call => call.name === "sellerpilot_service_complete_serverless_cs_transaction")!;
  assert.equal(completed.args.p_status, "failed");
  assert.equal(completed.args.p_response_payload, null);
  const recorded = calls.find(call => call.name === "sellerpilot_service_record_qoo10_reply_s3_readback_v1")!;
  assert.equal(recorded.args.p_state, "incomplete");
  assert.equal(recorded.args.p_matching_rows, 0);
});

test("actual Qoo10 runOne does not record status when common completion loses ownership", async () => {
  const { calls, response } = await run({ ownershipLost: true });
  assert.ok(response.status >= 400);
  assert.equal(calls.filter(call => call.name === "sellerpilot_service_record_qoo10_reply_s3_readback_v1").length, 0);
});
