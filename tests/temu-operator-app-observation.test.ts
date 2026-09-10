import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canonicalTemuCollectorAttestation,
  temuCollectorAttestationSchema,
  verifyTemuCollectorAttestation,
} from "../lib/product-registration/temu/operator-app-observation";
import { temuCollectorUiContractSha256 } from
  "../lib/product-registration/temu/operator-ui-contract";

const attestation = temuCollectorAttestationSchema.parse({
  contract: "temu_operator_collector_attestation_v1",
  uiContractSha256: temuCollectorUiContractSha256,
  keyId: "temu-collector-2026-09",
  receiptKeyId: "temu-receipt-2026-09",
  challengeId: "40000000-0000-4000-8000-000000000004",
  nonce: "A".repeat(43),
  ownerId: "10000000-0000-4000-8000-000000000001",
  productId: "20000000-0000-4000-8000-000000000002",
  credentialId: "30000000-0000-4000-8000-000000000003",
  credentialVersion: 3,
  credentialFingerprint: "f".repeat(64),
  credentialVaultSecretId: "70000000-0000-4000-8000-000000000007",
  productRevisionFingerprint: "a".repeat(64),
  partnerAccountSubject: `temu-account:sha256:${"1".repeat(64)}`,
  appId: "SellerPilot",
  appState: "inactive",
  complianceState: "reviewing",
  rejectionReason: null,
  observedAt: "2026-09-10T06:55:00+09:00",
  mallId: "11",
  regionId: "22",
  shipping: { defaultTemplateId: "template-1",
    warehouseVerified: true, feeRuleVerified: true,
    returnPolicyVerified: true },
  egress: { state: "static_ip_verified",
    verificationMethod: "temu_allowlist_readback" },
});

test("only an Ed25519 signature over the exact canonical collector envelope verifies", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const signature = sign(null,
    Buffer.from(canonicalTemuCollectorAttestation(attestation), "utf8"),
    privateKey).toString("base64");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  assert.equal(verifyTemuCollectorAttestation({ attestation, signature,
    publicKeyPem, expectedKeyId: attestation.keyId }), true);
  assert.equal(verifyTemuCollectorAttestation({
    attestation: { ...attestation, appState: "active" }, signature,
    publicKeyPem, expectedKeyId: attestation.keyId,
  }), false);
  assert.equal(verifyTemuCollectorAttestation({ attestation,
    signature: Buffer.alloc(64).toString("base64"), publicKeyPem,
    expectedKeyId: attestation.keyId }), false);
});

test("P-256 P1363 signatures from the non-extractable SecKey contract verify", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const signature = sign("sha256",
    Buffer.from(canonicalTemuCollectorAttestation(attestation), "utf8"),
    { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  assert.equal(verifyTemuCollectorAttestation({ attestation, signature,
    publicKeyPem, expectedKeyId: attestation.keyId }), true);
  assert.equal(verifyTemuCollectorAttestation({ attestation,
    signature: Buffer.alloc(64).toString("base64"), publicKeyPem,
    expectedKeyId: attestation.keyId }), false);
});

test("admin route requires a signed challenge and exposes no provider/claim path", async () => {
  const source = await readFile(new URL(
    "../app/api/admin/temu/operator-app-observation/route.ts",
    import.meta.url,
  ), "utf8");
  const verifyAt = source.indexOf("verifyTemuCollectorAttestation({");
  const consumeAt = source.indexOf(
    "sellerpilot_service_consume_temu_collector_attestation_v2", verifyAt,
  );
  const receiptAt = source.indexOf(
    "sellerpilot_verifier_record_temu_collector_receipt_v1", verifyAt,
  );
  assert.ok(verifyAt >= 0 && receiptAt > verifyAt && consumeAt > receiptAt);
  assert.match(source, /verifierClient\.rpc\(\s*[\s\S]*sellerpilot_verifier_record_temu_collector_receipt_v1/u);
  assert.match(source, /admin\.serviceClient\.rpc\(\s*[\s\S]*sellerpilot_service_consume_temu_collector_attestation_v2/u);
  assert.ok(source.includes("sellerpilot_service_issue_temu_collector_challenge_v1"));
  assert.equal(source.includes("recordTemuCreateAppGateObservation"), false);
  assert.equal(source.includes("sellerpilot_claim_channel_operation"), false);
  assert.equal(source.includes("executeViaChannelGateway"), false);
  assert.equal(source.includes("temuRequest"), false);
  assert.equal(source.includes("accountLogin"), false);
});
