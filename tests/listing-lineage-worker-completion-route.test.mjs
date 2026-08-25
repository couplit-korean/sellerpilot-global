import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const completeRouteUrl = new URL(
  "../app/api/channel-gateway/worker/complete/route.ts",
  import.meta.url,
);
const contractUrl = new URL(
  "../lib/channels/gateway-contract.ts",
  import.meta.url,
);

test("lineage completions use the dedicated atomic RPC before generic gateway completion", async () => {
  const source = await readFile(completeRouteUrl, "utf8");
  const branch = source.indexOf('job.operation === "listing.lineage.verify"');
  const dedicated = source.indexOf('"sellerpilot_complete_listing_lineage_verification"', branch);
  const generic = source.indexOf('"sellerpilot_service_complete_gateway_transaction"', dedicated);

  assert.ok(branch > 0 && dedicated > branch && generic > dedicated);
  assert.match(source.slice(branch, generic), /p_token_hash: tokenHash/);
  assert.match(source.slice(branch, generic), /p_claim_token: parsed\.data\.claimToken/);
  assert.match(source.slice(branch, generic), /p_status: lineageStatus/);
  assert.match(source.slice(branch, generic), /p_response_payload: lineagePayload/);
  assert.match(source.slice(branch, generic), /status === "lease_lost"[\s\S]*status: 409/);
});

test("worker evidence is reduced to the strict normalized database contract", async () => {
  const source = await readFile(completeRouteUrl, "utf8");
  const successMapper = source.match(/function listingLineageSuccessPayload[\s\S]*?\n\}/)?.[0] ?? "";
  const failureMapper = source.match(/function listingLineageFailurePayload[\s\S]*?\n\}/)?.[0] ?? "";

  assert.match(successMapper, /evidenceVersion: "provider_listing_readback_v1"/);
  assert.match(successMapper, /expectedRemoteId: evidence\.expectedRemoteId/);
  assert.match(successMapper, /verifiedRemoteId: evidence\.verifiedRemoteId/);
  assert.match(successMapper, /verification: "exact_provider_readback"/);
  assert.match(successMapper, /result\.channel === "ebay"/);
  assert.doesNotMatch(successMapper, /steps|safeMessage|credential|token|subject|vault/i);

  assert.match(failureMapper, /evidenceVersion: "provider_listing_readback_v1"/);
  assert.match(failureMapper, /reason/);
  assert.doesNotMatch(failureMapper, /message|error|credential|token|subject|vault/i);
});

test("readback failures are normalized and uncertain read-only completions are retryable", async () => {
  const source = await readFile(completeRouteUrl, "utf8");
  const mapper = source.match(/function listingLineageFailureReason[\s\S]*?\n\}/)?.[0] ?? "";

  for (const reason of [
    "legacy_main_reconnect_required",
    "provider_identity_mismatch",
    "target_mismatch",
    "market_mismatch",
    "marketplace_sku_missing",
    "provider_resource_missing",
    "provider_resource_ambiguous",
    "remote_id_mismatch",
    "provider_not_found",
    "provider_readback_rejected",
  ]) {
    assert.match(mapper, new RegExp(reason));
  }
  assert.match(
    source,
    /parsed\.data\.status === "reconciliation_required"[\s\S]*lineageStatus = "retryable"[\s\S]*lineagePayload = null/,
  );
  assert.doesNotMatch(
    source,
    /p_error_message:\s*parsed\.data\.error/,
  );
});

test("gateway completion schema covers Qoo10 and the three OAuth channels", async () => {
  const contract = await readFile(contractUrl, "utf8");
  assert.match(contract, /z\.literal\("listing\.lineage\.verify"\)/);
  assert.match(contract, /channel: z\.enum\(\["qoo10", "shopee", "lazada", "ebay"\]\)/);
  assert.match(contract, /evidenceVersion: z\.literal\("provider_listing_readback_rebind_v1"\)/);
  assert.match(contract, /verificationStatus: z\.literal\("verified"\)/);
});
