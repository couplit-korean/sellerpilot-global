import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === "server-only"
    ? { shortCircuit: true, url: "data:text/javascript,export default {}" }
    : nextResolve(specifier, context);
} });

const { completeCsClaim } = await import("../lib/cs/operations/complete.ts");
const ownerId = "00000000-0000-4000-8000-000000000001";

function result() {
  return {
    ok: true,
    channel: "qoo10" as const,
    operation: "inquiries.list" as const,
    steps: [{ name: "inquiries", ok: true, status: 200, data: {
      ResultCode: 0,
      ResultObject: [{
        INQ_TYPE: "MSG", QUESTION_NO: "700", SEQ_NO: "701",
        CONTENTS: "fixture question", STATUS: "S1", INQ_DT: "20260909010000",
      }],
    } }],
    safeMessage: "fixture only",
  };
}

async function run(input: {
  jobId: string;
  claimToken: string;
  credentialId: string;
  sellerAccountKey: string;
}) {
  let normalized: Array<Record<string, unknown>> = [];
  const job = {
    id: input.jobId,
    claim_token: input.claimToken,
    credential_id: input.credentialId,
    channel: "qoo10" as const,
    operation: "inquiries.list" as const,
    environment: "production" as const,
    request: { periodicKey: "inquiries:current:qoo10:S1", arguments: { params: {
      search_start_dt: "20260909000000", search_end_dt: "20260909235959", proc_status: "S1",
    } } },
    credential: { api_key: "fixture-only" },
    attempt_count: 1,
  };
  const outcome = await completeCsClaim({ rpc: async (name, arguments_ = {}) => {
    if (name === "sellerpilot_service_serverless_cs_completion_context") {
      return { data: { status: "running", channel: "qoo10", operation: "inquiries.list", normalization_timestamp: "2026-09-09T01:02:00.000Z" }, error: null };
    }
    if (name === "sellerpilot_service_qoo10_inquiry_identity_context_v1") {
      return { data: {
        contract: "sellerpilot-qoo10-inquiry-identity-context/1",
        ownerId,
        sellerAccountKey: input.sellerAccountKey,
        environment: "production",
        sourceCredentialId: input.credentialId,
      }, error: null };
    }
    if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
      normalized = arguments_.p_normalized_inquiries as Array<Record<string, unknown>>;
      return { data: { status: "completed" }, error: null };
    }
    if (name === "sellerpilot_service_record_cs_credential_binding_v1") {
      return { data: { contract: "sellerpilot-cs-credential-binding/1", status: "recorded" }, error: null };
    }
    return { data: null, error: { code: "unexpected_rpc" } };
  } }, "d".repeat(64), job, { status: "succeeded", result: result() });
  assert.equal(outcome, "completed");
  assert.equal(normalized.length, 1);
  return normalized[0]!;
}

test("actual completion keeps one provider question isolated across two seller accounts", async () => {
  const first = await run({
    jobId: "10000000-0000-4000-8000-000000000001",
    claimToken: "20000000-0000-4000-8000-000000000001",
    credentialId: "30000000-0000-4000-8000-000000000001",
    sellerAccountKey: "a".repeat(64),
  });
  const second = await run({
    jobId: "10000000-0000-4000-8000-000000000002",
    claimToken: "20000000-0000-4000-8000-000000000002",
    credentialId: "30000000-0000-4000-8000-000000000002",
    sellerAccountKey: "b".repeat(64),
  });
  assert.equal((first.providerContext as Record<string, unknown>).providerExternalTicketId, "qoo10:v2:MSG:700");
  assert.equal((second.providerContext as Record<string, unknown>).providerExternalTicketId, "qoo10:v2:MSG:700");
  assert.notEqual(first.externalTicketId, second.externalTicketId);
  assert.notEqual(first.inboundKey, second.inboundKey);
});
