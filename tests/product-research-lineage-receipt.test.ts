import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  createProductResearchLineageReceipt,
  productResearchInputSha256,
  verifyProductResearchLineageReceipt,
} from "../lib/product-research-lineage-receipt-core";

const secret = "test-only-worker-token-with-enough-entropy";
const expectation = {
  ownerId: "11111111-1111-4111-8111-111111111111",
  researchJobId: "22222222-2222-4222-8222-222222222222",
  researchInput: "  롯데샌드 파인애플 315g  ",
  sourcePhotoSha256: "a".repeat(64),
};

test("a signed research lineage receipt binds owner, job, trimmed input digest, and exact source photo", () => {
  const receipt = createProductResearchLineageReceipt(secret, expectation);
  assert.deepEqual(verifyProductResearchLineageReceipt(secret, receipt, expectation), {
    valid: true,
    researchInputSha256: productResearchInputSha256(expectation.researchInput),
  });

  for (const [field, value, reason] of [
    ["ownerId", "33333333-3333-4333-8333-333333333333", "owner_mismatch"],
    ["researchJobId", "44444444-4444-4444-8444-444444444444", "job_mismatch"],
    ["researchInput", "다른 상품 설명", "research_input_mismatch"],
    ["sourcePhotoSha256", "b".repeat(64), "source_photo_mismatch"],
  ] as const) {
    assert.deepEqual(verifyProductResearchLineageReceipt(secret, receipt, {
      ...expectation,
      [field]: value,
    }), { valid: false, reason });
  }
});

test("tampered, cross-secret, and malformed receipts fail closed", () => {
  const receipt = createProductResearchLineageReceipt(secret, expectation);
  const tampered = `${receipt.slice(0, -1)}${receipt.endsWith("a") ? "b" : "a"}`;
  assert.deepEqual(
    verifyProductResearchLineageReceipt(secret, tampered, expectation),
    { valid: false, reason: "signature_mismatch" },
  );
  assert.deepEqual(
    verifyProductResearchLineageReceipt("different-test-worker-token-123", receipt, expectation),
    { valid: false, reason: "signature_mismatch" },
  );
  assert.deepEqual(
    verifyProductResearchLineageReceipt(secret, "not-a-receipt", expectation),
    { valid: false, reason: "malformed" },
  );
  assert.deepEqual(
    verifyProductResearchLineageReceipt("", receipt, expectation),
    { valid: false, reason: "configuration_missing" },
  );
});

test("even a correctly signed receipt with an extra payload key fails closed", () => {
  const receipt = createProductResearchLineageReceipt(secret, expectation);
  const [, encodedPayload] = receipt.split(".");
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Record<string, unknown>;
  const encodedPayloadWithExtraKey = Buffer.from(JSON.stringify({
    ...payload,
    unexpected: "must-not-be-accepted",
  }), "utf8").toString("base64url");
  const derivedKey = createHmac("sha256", secret)
    .update("sellerpilot:product-research-lineage:v1:key", "utf8")
    .digest();
  const signature = createHmac("sha256", derivedKey)
    .update(`sellerpilot:product-research-lineage:v1:receipt.${encodedPayloadWithExtraKey}`, "utf8")
    .digest("base64url");
  const receiptWithExtraKey = `v1.${encodedPayloadWithExtraKey}.${signature}`;

  assert.deepEqual(
    verifyProductResearchLineageReceipt(secret, receiptWithExtraKey, expectation),
    { valid: false, reason: "malformed" },
  );
});
