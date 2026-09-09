import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gatewayJobCompletionStatus, gatewayWorkerCompletionSchema } from "../lib/channels/gateway-contract";

registerHooks({ resolve(specifier, context, next) {
  if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export default {}" };
  return next(specifier, context);
} });

const { waitForGatewayJob, ChannelGatewayReconciliationRequiredError } = await import("../lib/channels/gateway-job-runtime");
const { completeCommerceWorker } = await import("../lib/channels/commerce-worker-completion");

test("the actual commerce completion handler preserves API evidence and writes reconciliation for an optimistic worker", async () => {
  const completion = gatewayWorkerCompletionSchema.parse({
    jobId: "10000000-0000-4000-8000-000000000001",
    claimToken: "20000000-0000-4000-8000-000000000001",
    status: "succeeded",
    result: {
      ok: true, channel: "elevenst", operation: "listing.create", remoteId: "1234567890",
      safeMessage: "Provider API completed; more evidence is required.",
      publicationIntent: "live", publicationStateContract: "verified_remote_state_v1", publicationFulfilled: true,
      remoteState: {
        verified: true, visibility: "live", providerStatus: "103", verifiedAt: "2026-09-09T00:00:00.000Z",
        evidence: { identityVerified: true, statusVerified: true, localeVerified: true, fingerprintVerified: true, imageCountVerified: true },
        resources: { productNo: "1234567890" }, locale: "ko-KR", fingerprint: "b".repeat(64), imageCount: 8,
      },
      steps: [{ name: "product-publication-readback", ok: true, status: 200,
        data: { sellerpilotAdditionalEvidenceRequired: true } }],
    },
  });
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return { data: { status: "completed" }, error: null };
  } } as unknown as SupabaseClient;
  const reply = await completeCommerceWorker({ serviceClient: client, tokenHash: "fixture-token-hash",
    job: { operation: "listing.create", channel: "elevenst", publication_verification_boundary: "2026-09-09T00:00:00.000Z" }, completion });
  assert.equal(reply.status, 200, "HTTP completion acknowledgement is not listing completion");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "sellerpilot_service_complete_gateway_transaction");
  assert.equal(calls[0].args.p_status, "reconciliation_required");
  assert.equal(calls[0].args.p_error_message, "LISTING_ADDITIONAL_EVIDENCE_REQUIRED");
  assert.deepEqual(calls[0].args.p_response_payload, completion.result);
  assert.equal(calls[0].args.p_normalized_orders, null);
  assert.equal(calls[0].args.p_normalized_inquiries, null);
});

test("a completed provider API response stays blocked after the gateway status read when evidence is missing", async () => {
  const response = { ok: true, operation: "listing.create", remoteId: "1234567890",
    steps: [{ name: "product-publication-readback", ok: true, status: 200,
      data: { sellerpilotAdditionalEvidenceRequired: true, sellerpilotProviderReadbackUnavailableFields: ["prdImage01", "dlvCst1"] } }] };
  const status = gatewayJobCompletionStatus(response.operation, response.ok, response.steps);
  const calls: string[] = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push(name);
    assert.deepEqual(args, { p_job_id: "job-1" });
    return { data: { status, response }, error: null };
  } } as unknown as SupabaseClient;
  await assert.rejects(waitForGatewayJob(client, "job-1", 1000, "attempt-1", "listing-1"), (error: unknown) => {
    assert.ok(error instanceof ChannelGatewayReconciliationRequiredError);
    assert.equal(error.additionalEvidenceRequired, true);
    assert.equal(error.jobId, "job-1");
    assert.equal(error.attemptId, "attempt-1");
    assert.equal(error.listingId, "listing-1");
    return true;
  });
  assert.deepEqual(calls, ["sellerpilot_get_channel_gateway_job"]);
  assert.equal(response.ok, true, "provider receipt remains evidence, it is not rewritten as provider failure");
});

test("uncertain provider acceptance remains distinct from additional evidence", async () => {
  for (const response of [null, {}, { steps: [null, [], { data: [] }] }]) {
    const client = { rpc: async () => ({ data: { status: "reconciliation_required", response }, error: null }) } as unknown as SupabaseClient;
    await assert.rejects(waitForGatewayJob(client, "job-2", 1000), (error: unknown) => {
      assert.ok(error instanceof ChannelGatewayReconciliationRequiredError);
      assert.equal(error.additionalEvidenceRequired, false);
      return true;
    });
  }
});
