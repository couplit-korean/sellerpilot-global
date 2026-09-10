import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const proposalPatch = await readFile(new URL(
  "../docs/cs-parallel/proposals/ebay/cases-disputes-durable-scheduler.patch",
  import.meta.url,
), "utf8");
const collectionSql = await readFile(new URL(
  "../docs/cs-parallel/proposals/ebay/ebay-case-dispute-durable-collection.sql",
  import.meta.url,
), "utf8");
const gatewaySource = await readFile(new URL(
  "../lib/channels/cs/ebay/case-dispute-gateway.ts",
  import.meta.url,
), "utf8");

test("shared scheduler patch is minimal, claim-fenced, and surfaces resource-local blockers", () => {
  const changedPaths = [...proposalPatch.matchAll(/^diff --git a\/(.+) b\/(.+)$/gmu)]
    .map((match) => [match[1], match[2]]);
  assert.deepEqual(changedPaths, [
    ["lib/channels/ebay-inquiries.ts", "lib/channels/ebay-inquiries.ts"],
    ["lib/channels/serverless-gateway.ts", "lib/channels/serverless-gateway.ts"],
  ]);

  const recordIndex = proposalPatch.indexOf("await recordEbayCaseDisputeGatewayObservation");
  const rateLimitIndex = proposalPatch.indexOf("const rateLimit", recordIndex);
  assert.ok(recordIndex >= 0 && rateLimitIndex > recordIndex,
    "the provider observation must be claim-fenced before generic completion bookkeeping");
  assert.match(proposalPatch, /const ebayCaseDisputeCollection = await enqueueEbayCaseDisputeSchedule/);
  assert.match(proposalPatch, /&& !caseDisputeNeedsAttention/);
  assert.match(proposalPatch, /scopeBlocked/);
});

test("durable collection SQL is service-only and isolates a blocked resource", () => {
  assert.match(collectionSql,
    /grant execute on function public\.sellerpilot_service_enqueue_ebay_case_dispute_collection_v1\(jsonb\)[\s\S]*?to service_role;/u);
  assert.match(collectionSql,
    /grant execute on function public\.sellerpilot_service_record_ebay_case_dispute_gateway_page_v1\(text,uuid,uuid,jsonb\)[\s\S]*?to service_role;/u);
  assert.match(collectionSql,
    /sibling\.request_payload#>>'\{arguments,resourceKind\}' = v_resource/u);
  assert.match(collectionSql, /sibling\.status = 'queued'/u);
  assert.doesNotMatch(collectionSql, /\b(?:accept|contest|refund|appeal)\b/iu);
});

test("provider executor remains GET-history-only with strict collection arguments", () => {
  assert.match(gatewaySource, /readEbayPaymentDisputesPage/u);
  assert.match(gatewaySource, /readEbayResolutionCasesPage/u);
  assert.match(gatewaySource, /\.strict\(\)\.superRefine/u);
  assert.match(gatewaySource, /sellerpilot_service_record_ebay_case_dispute_gateway_page_v1/u);
  assert.doesNotMatch(gatewaySource, /\b(?:accept|contest|refund|close|appeal)\b/iu);
});
