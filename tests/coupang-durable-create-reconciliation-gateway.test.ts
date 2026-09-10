import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import type { GatewayClaim } from "../lib/channels/gateway-contract";

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

const jobId = "51000000-0000-4000-8000-000000000001";
const claimToken = "52000000-0000-4000-8000-000000000001";
const credentialId = "53000000-0000-4000-8000-000000000001";
const sourceJobId = "54000000-0000-4000-8000-000000000001";
const sourceAttemptId = "55000000-0000-4000-8000-000000000001";
const listingId = "56000000-0000-4000-8000-000000000001";
const sourceProductId = "57000000-0000-4000-8000-000000000001";
const credentialVaultSecretId = "58000000-0000-4000-8000-000000000001";
const officialSnapshotId = "59000000-0000-4000-8000-000000000001";
const transmissionId = "5a000000-0000-4000-8000-000000000001";
const providerBodySealId = "5b000000-0000-4000-8000-000000000001";
const vendorId = "A00012345";
const sellerSku = "COUPANG-DURABLE-GATEWAY";
const sellerProductId = 987654321;
const credentialSecretSha256 = createHash("sha256")
  .update('{"access_key":"access","secret_key":"secret","vendor_id":"A00012345"}')
  .digest("hex");

function sourceArguments() {
  return {
    sellerpilotCoupangBaseSku: sellerSku,
    facts: {},
    body: {
      sellerProductName: "읽기 복구 검증 상품",
      brand: "SellerPilot",
      items: [{
        itemName: "읽기 복구 검증 상품",
        externalVendorSku: sellerSku,
        barcode: "8802259030799",
        emptyBarcode: false,
        emptyBarcodeReason: "",
        modelNo: "",
        maximumBuyCount: 1,
        unitCount: 1,
        attributes: [{
          attributeTypeName: "수량",
          attributeValueName: "1개",
          exposed: "EXPOSED",
        }],
      }],
    },
  };
}

test("serverless Coupang durable CREATE reconciliation remains GET-only across the gateway", async () => {
  const job: GatewayClaim = {
    id: jobId,
    claim_token: claimToken,
    credential_id: credentialId,
    channel: "coupang",
    operation: "listing.lineage.verify",
    environment: "production",
    request: {
      sellerpilotLineageVersion: "coupang_create_reconciliation_v1",
      arguments: {
        contract: "coupang_durable_create_reconciliation_v1",
        sourceJobId,
        sourceAttemptId,
        listingId,
        sourceProductId,
        sourceRequestSha256: "a".repeat(64),
        expectedVendorId: vendorId,
        expectedCredentialId: credentialId,
        expectedCredentialVersion: 7,
        expectedCredentialFingerprint: "credential-fingerprint-7",
        expectedCredentialVaultSecretId: credentialVaultSecretId,
        expectedCredentialSecretSha256: credentialSecretSha256,
        expectedCredentialSellerAccountKeySource: "credential_incarnation_v1",
        expectedOfficialSourceSnapshotId: officialSnapshotId,
        expectedOfficialSourceSnapshotDigestSha256: "b".repeat(64),
        expectedTransmissionId: transmissionId,
        expectedTransmissionDigestSha256: "c".repeat(64),
        expectedProviderBodySealId: providerBodySealId,
        expectedProviderBodySha256: "d".repeat(64),
        expectedSellerSkus: [sellerSku],
        sourceArguments: sourceArguments(),
      },
    },
    credential: {
      vendor_id: vendorId,
      access_key: "access",
      secret_key: "secret",
    },
    attempt_count: 1,
  };
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  let providerMutationCount = 0;
  globalThis.fetch = async (input, init) => {
    const method = init?.method ?? "GET";
    methods.push(method);
    const path = new URL(String(input)).pathname;
    if (path.includes("/external-vendor-sku-codes/")) {
      return Response.json({
        code: "SUCCESS",
        data: [{ sellerProductId, vendorId, externalVendorSku: sellerSku }],
      });
    }
    return Response.json({
      code: "SUCCESS",
      data: {
        sellerProductId,
        vendorId,
        items: [{
          sellerProductItemId: 3333,
          externalVendorSku: sellerSku,
          itemName: "읽기 복구 검증 상품",
        }],
      },
    });
  };
  try {
    const result = await executeServerlessGatewayProviderJob({
      job,
      signal: new AbortController().signal,
      hooks: {
        assertLeaseHealthy: async () => undefined,
        beginProviderMutation: async () => { providerMutationCount += 1; },
        beginCredentialMutation: async () => { throw new Error("credential mutation forbidden"); },
        stageCredentialRefresh: async () => { throw new Error("credential mutation forbidden"); },
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.channel, "coupang");
    assert.equal(result.operation, "listing.lineage.verify");
    assert.deepEqual(methods, ["GET", "GET"]);
    assert.equal(providerMutationCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
