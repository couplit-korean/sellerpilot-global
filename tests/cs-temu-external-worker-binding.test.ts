import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { completeCsWorker, type CsWorkerCompletion } from "../lib/cs/operations/worker-completion";

const jobId = "00000000-0000-4000-8000-00000000e601";
const credentialId = "00000000-0000-4000-8000-00000000e602";
const claimToken = "00000000-0000-4000-8000-00000000e603";
const runId = "00000000-0000-4000-8000-00000000e604";
const sellerKey = "b".repeat(64);
const result = {
  ok: true,
  channel: "temu" as const,
  operation: "inquiries.list" as const,
  steps: [{
    name: "inquiries",
    ok: true,
    status: 200,
    data: { result: { data: [] } },
  }],
  safeMessage: "ok",
};
const binding = {
  contract: "sellerpilot-cs-credential-binding/1" as const,
  channel: "temu" as const,
  operation: "inquiries.list" as const,
  appFingerprint: "c".repeat(64),
  tokenFingerprint: "d".repeat(64),
  targetFingerprints: [sellerKey],
  country: "UNSCOPED",
  sellerAccountKey: sellerKey,
};
const job = {
  id: jobId,
  credential_id: credentialId,
  channel: "temu",
  operation: "inquiries.list",
  status: "running",
  normalization_timestamp: "2026-09-09T12:00:00.000Z",
  request: { arguments: { kind: "after_sales" } },
  temuHistoryRunId: runId,
};

function completion(credentialBinding?: typeof binding): CsWorkerCompletion {
  return {
    jobId,
    claimToken,
    status: "succeeded",
    result,
    ...(credentialBinding ? { credentialBinding } : {}),
  };
}

test("external Temu worker refuses a successful completion with no account binding before durable completion", async () => {
  const calls: string[] = [];
  const serviceClient = {
    rpc: async (name: string) => {
      calls.push(name);
      throw new Error("RPC must not run");
    },
  } as unknown as SupabaseClient;
  const response = await completeCsWorker({
    serviceClient,
    tokenHash: "a".repeat(64),
    job,
    completion: completion(),
  });
  assert.equal(response.status, 409);
  assert.deepEqual(calls, []);
});

test("external Temu worker exposes post-completion binding failure so the same claim can retry it", async () => {
  const calls: string[] = [];
  const serviceClient = {
    rpc: async (name: string) => {
      calls.push(name);
      if (name === "sellerpilot_service_complete_gateway_transaction") {
        return { data: { status: "completed" }, error: null };
      }
      if (name === "sellerpilot_service_record_temu_history_checkpoint_v1") {
        return { data: {
          contract: "sellerpilot-temu-history-checkpoint/1",
          runId,
          credentialId,
          completedPagesPreserved: true,
          providerRetention: { status: "unverified", earliestSupportedDate: null },
        }, error: null };
      }
      if (name === "sellerpilot_service_record_cs_credential_binding_v1") {
        return { data: null, error: { code: "TEMPORARY_BINDING_FAILURE" } };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  } as unknown as SupabaseClient;
  const response = await completeCsWorker({
    serviceClient,
    tokenHash: "a".repeat(64),
    job,
    completion: completion(binding),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(calls, [
    "sellerpilot_service_complete_gateway_transaction",
    "sellerpilot_service_record_temu_history_checkpoint_v1",
    "sellerpilot_service_record_cs_credential_binding_v1",
  ]);
});

test("external Temu worker fails visibly when durable completion succeeds but history checkpoint recording does not", async () => {
  const calls: string[] = [];
  const serviceClient = {
    rpc: async (name: string) => {
      calls.push(name);
      if (name === "sellerpilot_service_complete_gateway_transaction") {
        return { data: { status: "completed" }, error: null };
      }
      if (name === "sellerpilot_service_record_temu_history_checkpoint_v1") {
        return { data: null, error: { code: "TEMPORARY_HISTORY_FAILURE" } };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  } as unknown as SupabaseClient;
  const response = await completeCsWorker({
    serviceClient,
    tokenHash: "a".repeat(64),
    job,
    completion: completion(binding),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(calls, [
    "sellerpilot_service_complete_gateway_transaction",
    "sellerpilot_service_record_temu_history_checkpoint_v1",
  ]);
});

test("external worker retries a lost post-checkpoint binding response without advancing history twice", async () => {
  const calls: string[] = [];
  let checkpointCalls = 0;
  let bindingCalls = 0;
  const serviceClient = {
    rpc: async (name: string) => {
      calls.push(name);
      if (name === "sellerpilot_service_complete_gateway_transaction") {
        return { data: { status: "completed", replayed: calls.filter(call => call === name).length > 1 }, error: null };
      }
      if (name === "sellerpilot_service_record_temu_history_checkpoint_v1") {
        checkpointCalls += 1;
        return { data: {
          contract: "sellerpilot-temu-history-checkpoint/1",
          runId,
          credentialId,
          completedPagesPreserved: true,
          replayed: checkpointCalls > 1,
          providerRetention: { status: "unverified", earliestSupportedDate: null },
        }, error: null };
      }
      if (name === "sellerpilot_service_record_cs_credential_binding_v1") {
        bindingCalls += 1;
        return bindingCalls === 1
          ? { data: null, error: { code: "LOST_BINDING_RESPONSE" } }
          : { data: { contract: "sellerpilot-cs-credential-binding/1", status: "recorded", replayed: true }, error: null };
      }
      if (name === "sellerpilot_service_record_cs_history_page_v1") {
        return { data: { contract: "cs_history_coverage_v1", status: "completed", jobId }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  } as unknown as SupabaseClient;
  const first = await completeCsWorker({
    serviceClient,
    tokenHash: "a".repeat(64),
    job,
    completion: completion(binding),
  });
  assert.equal(first.status, 503);
  const second = await completeCsWorker({
    serviceClient,
    tokenHash: "a".repeat(64),
    job: { ...job, status: "completed_replay" },
    completion: completion(binding),
  });
  assert.equal(second.status, 200);
  assert.equal(checkpointCalls, 2);
  assert.equal(bindingCalls, 2);
  assert.deepEqual(calls.slice(0, 6), [
    "sellerpilot_service_complete_gateway_transaction",
    "sellerpilot_service_record_temu_history_checkpoint_v1",
    "sellerpilot_service_record_cs_credential_binding_v1",
    "sellerpilot_service_complete_gateway_transaction",
    "sellerpilot_service_record_temu_history_checkpoint_v1",
    "sellerpilot_service_record_cs_credential_binding_v1",
  ]);
});
