import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { GatewayClaim } from "../lib/channels/gateway-contract";
import { coupangExactQaRecoveryIdentity } from "../lib/channels/coupang-exact-qa-recovery";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const { executeServerlessGatewayProviderJob } = await import(
  "../lib/channels/serverless-gateway-provider"
);

function claim(operation: "listing.create" | "listing.update", argumentsValue: Record<string, unknown>): GatewayClaim {
  return {
    id: "51000000-0000-4000-8000-000000000901",
    claim_token: "52000000-0000-4000-8000-000000000901",
    credential_id: "53000000-0000-4000-8000-000000000901",
    channel: "coupang",
    operation,
    environment: "production",
    request: { arguments: argumentsValue },
    credential: {
      vendor_id: "A00012345",
      access_key: "access",
      secret_key: "secret",
      requested_by: "wing-user",
    },
    attempt_count: 1,
  };
}

const noMutationHooks = {
  assertLeaseHealthy: async () => undefined,
  beginProviderMutation: async () => assert.fail("provider mutation must remain closed"),
  beginCredentialMutation: async () => assert.fail("credential mutation must remain closed"),
  stageCredentialRefresh: async () => assert.fail("credential refresh must remain closed"),
};

test("worker rejects a duplicate exact QA create before provider preparation", async () => {
  await assert.rejects(
    executeServerlessGatewayProviderJob({
      job: claim("listing.create", {
        body: { items: [{ externalVendorSku: coupangExactQaRecoveryIdentity.sellerSku }] },
      }),
      signal: new AbortController().signal,
      hooks: noMutationHooks,
    }),
    /COUPANG_EXACT_QA_DUPLICATE_CREATE_FORBIDDEN/,
  );
});

test("worker rejects a forged exact recovery marker before provider preparation", async () => {
  await assert.rejects(
    executeServerlessGatewayProviderJob({
      job: claim("listing.update", {
        sellerpilotCoupangExactQaRecovery: {
          contract: "coupang_exact_qa_recovery_v1",
          phase: "listing.update",
          productId: coupangExactQaRecoveryIdentity.productId,
          listingId: coupangExactQaRecoveryIdentity.listingId,
          sellerProductId: coupangExactQaRecoveryIdentity.sellerProductId,
          vendorItemId: "attacker-item",
          sellerSku: coupangExactQaRecoveryIdentity.sellerSku,
          sellerAccountLineage: "validated_by_service_rpc",
        },
      }),
      signal: new AbortController().signal,
      hooks: noMutationHooks,
    }),
    /COUPANG_EXACT_QA_RECOVERY_SERVER_CONTEXT_REQUIRED/,
  );
});
