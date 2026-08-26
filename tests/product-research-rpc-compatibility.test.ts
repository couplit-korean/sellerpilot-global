import assert from "node:assert/strict";
import test from "node:test";
import {
  createProductResearchJobWithLegacyFallback,
  isMissingProductResearchRpcContract,
} from "../lib/product-research-rpc-compatibility";

const jobId = "11111111-1111-4111-8111-111111111111";

test("product research legacy fallback recognizes only the missing RPC contract", () => {
  assert.equal(isMissingProductResearchRpcContract({
    code: "PGRST202",
    message: "Could not find the function public.sellerpilot_create_ai_job(p_id, p_kind, p_request_payload) in the schema cache",
  }), true);
  assert.equal(isMissingProductResearchRpcContract({
    code: "PGRST202",
    message: "Could not find the function",
    details: "Searched for public.sellerpilot_create_ai_job but no matches were found in the schema cache.",
  }), true);
  assert.equal(isMissingProductResearchRpcContract({
    code: "42883",
    message: "function public.sellerpilot_create_ai_job(uuid, text, jsonb) does not exist",
  }), true);
  assert.equal(isMissingProductResearchRpcContract({
    code: "42883",
    message: "function sellerpilot_create_ai_job(uuid, text, jsonb) does not exist",
  }), true);

  for (const error of [
    { code: "PGRST202", message: "Could not find the function public.some_other_rpc() in the schema cache" },
    { code: "42883", message: "function public.some_other_rpc(uuid) does not exist" },
    { code: "42501", message: "permission denied for function sellerpilot_create_ai_job" },
    { code: "57014", message: "canceling statement due to statement timeout", details: "sellerpilot_create_ai_job" },
    { code: "PGRST000", message: "Database connection failed", details: "sellerpilot_create_ai_job" },
    { code: "503", message: "Service Unavailable", details: "sellerpilot_create_ai_job" },
    { code: "42883", message: "operator does not exist", details: "sellerpilot_create_ai_job" },
  ]) {
    assert.equal(isMissingProductResearchRpcContract(error), false, JSON.stringify(error));
  }
});

test("product research uses product_studio compatibility only after an exact missing-contract error", async () => {
  const calls: Array<{ p_kind: string; p_request_payload: Record<string, unknown> }> = [];
  const result = await createProductResearchJobWithLegacyFallback({
    jobId,
    researchInput: "롯데샌드 파인애플",
    createJob: async (arguments_) => {
      calls.push(arguments_);
      return calls.length === 1
        ? { error: { code: "PGRST202", message: "Could not find the function public.sellerpilot_create_ai_job(p_id, p_kind, p_request_payload) in the schema cache" } }
        : { error: null };
    },
  });

  assert.deepEqual(result, { error: null, usedLegacyFallback: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].p_kind, "product_research");
  assert.equal(calls[1].p_kind, "product_studio");
  assert.equal(calls[1].p_request_payload.research_only, true);
});

test("product research preserves transient, authorization, and server errors without a fallback call", async () => {
  for (const error of [
    { code: "57014", message: "canceling statement due to statement timeout" },
    { code: "42501", message: "permission denied for function sellerpilot_create_ai_job" },
    { code: "PGRST000", message: "Database connection failed" },
    { code: "503", message: "Service Unavailable" },
  ]) {
    let calls = 0;
    const result = await createProductResearchJobWithLegacyFallback({
      jobId,
      researchInput: "애플 사이다 비니거 젤리",
      createJob: async () => {
        calls += 1;
        return { error };
      },
    });
    assert.equal(calls, 1, JSON.stringify(error));
    assert.equal(result.error, error);
    assert.equal(result.usedLegacyFallback, false);
  }
});
