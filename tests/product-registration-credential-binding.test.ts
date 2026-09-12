import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { activeChannelKeys } from "../lib/channels/catalog";
import {
  productRegistrationCredentialBinding,
  productRegistrationCredentialBindingContract,
  productRegistrationCredentialRequestIdentity,
  productRegistrationRequestIdentityContract,
} from "../lib/product-registration/credential-execution-binding";

const credentialId = "10000000-0000-4000-8000-000000000001";
const future = "2030-01-01T00:00:00.000Z";
const now = new Date("2026-09-13T00:00:00.000Z");

function metadata(channel: string, overrides: Record<string, unknown> = {}) {
  return {
    id: credentialId,
    channel,
    status: "active",
    environment: "production",
    version: 7,
    fingerprint: "A1B2C3D4E5F6",
    expires_at: future,
    ...overrides,
  };
}

test("all eight product channels bind the exact active credential incarnation", () => {
  for (const channel of activeChannelKeys) {
    const result = productRegistrationCredentialBinding({
      metadata: metadata(channel),
      credentialId,
      channel,
      requestedVersion: 7,
      now,
    });
    assert.equal(result.ok, true, channel);
    if (!result.ok) continue;
    assert.deepEqual(result.binding, {
      contract: productRegistrationCredentialBindingContract,
      credentialId,
      credentialVersion: 7,
      credentialFingerprint: "A1B2C3D4E5F6",
      channel,
      environment: "production",
      expiresAt: future,
    });
  }
});

test("wrong, inactive, expired, malformed, and rotated credentials fail closed", () => {
  const cases = [
    ["wrong id", metadata("ebay", { id: "20000000-0000-4000-8000-000000000002" }), undefined, "identity_mismatch"],
    ["wrong channel", metadata("lazada"), undefined, "identity_mismatch"],
    ["inactive", metadata("ebay", { status: "revoked" }), undefined, "inactive"],
    ["expired", metadata("ebay", { expires_at: "2026-09-12T23:59:59.000Z" }), undefined, "expired"],
    ["invalid expiry", metadata("ebay", { expires_at: "not-a-date" }), undefined, "revision_invalid"],
    ["invalid version", metadata("ebay", { version: 0 }), undefined, "revision_invalid"],
    ["invalid fingerprint", metadata("ebay", { fingerprint: "bad value" }), undefined, "revision_invalid"],
    ["rotated", metadata("ebay", { version: 8 }), 7, "revision_mismatch"],
  ] as const;
  for (const [label, row, requestedVersion, reason] of cases) {
    const result = productRegistrationCredentialBinding({
      metadata: row,
      credentialId,
      channel: "ebay",
      ...(requestedVersion === undefined ? {} : { requestedVersion }),
      now,
    });
    assert.deepEqual(result, { ok: false, reason }, label);
  }
});

test("credential rotation changes the request identity material without exposing the secret", () => {
  const before = productRegistrationCredentialBinding({
    metadata: metadata("smartstore"), credentialId, channel: "smartstore", now,
  });
  const after = productRegistrationCredentialBinding({
    metadata: metadata("smartstore", { version: 8, fingerprint: "ABCDEF123456" }),
    credentialId,
    channel: "smartstore",
    now,
  });
  assert.equal(before.ok, true);
  assert.equal(after.ok, true);
  if (!before.ok || !after.ok) return;
  const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  assert.notEqual(digest(before.binding), digest(after.binding));
  assert.equal("secret" in before.binding, false);
});

test("expiry policy changes do not change immutable credential request identity", () => {
  const before = productRegistrationCredentialBinding({
    metadata: metadata("ebay", { expires_at: "2030-01-01T00:00:00.000Z" }),
    credentialId,
    channel: "ebay",
    requestedVersion: 7,
    now,
  });
  const extended = productRegistrationCredentialBinding({
    metadata: metadata("ebay", { expires_at: "2031-01-01T00:00:00.000Z" }),
    credentialId,
    channel: "ebay",
    requestedVersion: 7,
    now,
  });
  assert.equal(before.ok, true);
  assert.equal(extended.ok, true);
  if (!before.ok || !extended.ok) return;
  assert.notEqual(before.binding.expiresAt, extended.binding.expiresAt);
  assert.deepEqual(
    productRegistrationCredentialRequestIdentity(before.binding),
    productRegistrationCredentialRequestIdentity(extended.binding),
  );
});

test("workbench, proxy, and admin route preserve one credential version through claim fingerprinting", async () => {
  const [workbench, proxy, route] = await Promise.all([
    readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/products/[id]/remote-edit/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/channel-operations/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(workbench, /credentialId: credential\.id,\s*credentialVersion: requestCredentialVersion,\s*requestIdentityContract: productRegistrationRequestIdentityContract,\s*listingId:/u);
  assert.match(workbench, /requestIdentityContract: productRegistrationRequestIdentityContract/u);
  assert.match(workbench, /const mutationContract = \{[\s\S]*credentialId: credential\.id,[\s\S]*credentialVersion: requestCredentialVersion/u);
  assert.match(proxy, /credentialVersion: z\.number\(\)\.int\(\)\.positive\(\)\.optional\(\)/u);
  assert.match(proxy, /requestIdentityContract: z\.literal\(productRegistrationRequestIdentityContract\)\.optional\(\)/u);
  assert.match(proxy, /credentialId: body\.data\.credentialId,[\s\S]*credentialVersion: body\.data\.credentialVersion/u);
  const binding = route.indexOf("const credentialBindingResult = productRegistrationCredentialBinding");
  const fingerprint = route.indexOf("const requestFingerprint = createHash");
  assert.ok(binding >= 0 && fingerprint > binding);
  assert.match(route, /requestIdentityContract: z\.literal\(productRegistrationRequestIdentityContract\)\.optional\(\)/u);
  assert.match(route.slice(binding, fingerprint + 2_000), /productRegistrationCredentialRequestIdentity\(credentialExecutionBinding\)/u);
  assert.equal(productRegistrationRequestIdentityContract, "product_registration_request_identity_v2");
});
