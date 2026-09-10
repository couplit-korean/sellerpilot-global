import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { channelCatalog, requiredCredentialKeys } from "../lib/channels/catalog";
import {
  temuAccountIdentityOperation,
  temuCsAccountBindingEvidence,
} from "../lib/channels/cs/temu/account-binding";

const credential = {
  app_key: "fixture-app",
  app_secret: "fixture-secret",
  access_token: "fixture-token",
};
const observedAt = new Date("2026-09-09T10:20:00.000Z");
const expectedSellerAccountKey = createHash("sha256")
  .update("temu\u001fproduction\u001ftemu:mall:1024", "utf8")
  .digest("hex");

function accessTokenInfo(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    data: {
      success: true,
      result: {
        mallId: 1024,
        apiScopeList: [
          temuAccountIdentityOperation,
          "bg.aftersales.parentaftersales.list.get",
        ],
        ...overrides,
      },
    },
  };
}

function evidence(overrides: Partial<Parameters<typeof temuCsAccountBindingEvidence>[0]> = {}) {
  return temuCsAccountBindingEvidence({
    credential,
    environment: "production",
    accessTokenInfo: accessTokenInfo(),
    expectedSellerAccountKey,
    observedAt,
    ...overrides,
  });
}

test("Temu catalog secrets do not claim a seller identity without provider readback", () => {
  assert.deepEqual(requiredCredentialKeys("temu"), ["app_key", "app_secret", "access_token"]);
  assert.equal(channelCatalog.temu.fields.some((field) => /seller|mall/i.test(field.key)), false);
  const blocked = evidence({
    credential: { ...credential, seller_id: "invented-seller" },
    accessTokenInfo: null,
  });
  assert.deepEqual(blocked, {
    contract: "sellerpilot-temu-cs-account-binding/1",
    channel: "temu",
    environment: "production",
    sourceOperation: "bg.open.accesstoken.info.get",
    credentialFieldKeys: ["app_key", "app_secret", "access_token"],
    status: "blocked",
    verified: false,
    blocker: "TEMU_ACCOUNT_IDENTITY_READBACK_REQUIRED",
  });
  assert.equal(Object.hasOwn(blocked, "identity"), false);
  assert.equal(Object.hasOwn(blocked, "observedIdentity"), false);
});

test("authenticated access-token-info mallId produces exact production seller binding", () => {
  const verified = evidence();
  assert.equal(verified.status, "verified");
  if (verified.status !== "verified") return;
  assert.equal(verified.identity.mallId, "1024");
  assert.equal(verified.identity.sellerSubject, "temu:mall:1024");
  assert.equal(verified.identity.sellerAccountKey, expectedSellerAccountKey);
  assert.equal(verified.identity.apiScopeCount, 2);
  assert.match(verified.identity.apiScopeDigest, /^[a-f0-9]{64}$/u);
  assert.match(verified.identity.digest, /^[a-f0-9]{64}$/u);
  assert.equal(verified.identity.observedAt, observedAt.toISOString());
  const serialized = JSON.stringify(verified);
  assert.doesNotMatch(serialized, /fixture-app|fixture-secret|fixture-token/);
});

test("provider identity without an attested expected seller key remains explicitly blocked", () => {
  const missingExpected = evidence({ expectedSellerAccountKey: undefined });
  assert.equal(missingExpected.status, "blocked");
  if (missingExpected.status !== "blocked") return;
  assert.equal(missingExpected.blocker, "TEMU_EXPECTED_SELLER_ACCOUNT_KEY_UNVERIFIED");
  assert.equal(missingExpected.observedIdentity?.sellerSubject, "temu:mall:1024");

  const mismatch = evidence({ expectedSellerAccountKey: "f".repeat(64) });
  assert.equal(mismatch.status, "blocked");
  if (mismatch.status !== "blocked") return;
  assert.equal(mismatch.blocker, "TEMU_SELLER_ACCOUNT_KEY_MISMATCH");
  assert.equal(mismatch.observedIdentity?.sellerAccountKey, expectedSellerAccountKey);
});

test("Temu account binding rejects malformed credentials, transport and identity contracts", () => {
  const scenarios: Array<{
    input: Partial<Parameters<typeof temuCsAccountBindingEvidence>[0]>;
    blocker: string;
  }> = [
    { input: { credential: { ...credential, access_token: "" } }, blocker: "TEMU_CREDENTIAL_FIELDS_INCOMPLETE" },
    { input: { environment: "sandbox" }, blocker: "TEMU_ACCOUNT_BINDING_ENVIRONMENT_UNVERIFIED" },
    { input: { accessTokenInfo: { ok: false, status: 503, data: {} } }, blocker: "TEMU_ACCOUNT_IDENTITY_READBACK_REJECTED" },
    { input: { accessTokenInfo: { ok: true, status: 200, data: { success: false } } }, blocker: "TEMU_ACCOUNT_IDENTITY_RESPONSE_INVALID" },
    { input: { accessTokenInfo: accessTokenInfo({ mallId: " 1024" }) }, blocker: "TEMU_ACCOUNT_IDENTITY_MALL_INVALID" },
    { input: { accessTokenInfo: accessTokenInfo({ mallId: Number.MAX_SAFE_INTEGER + 1 }) }, blocker: "TEMU_ACCOUNT_IDENTITY_MALL_INVALID" },
    { input: { accessTokenInfo: accessTokenInfo({ apiScopeList: [] }) }, blocker: "TEMU_ACCOUNT_IDENTITY_SCOPES_INVALID" },
    { input: { accessTokenInfo: accessTokenInfo({ apiScopeList: [temuAccountIdentityOperation, temuAccountIdentityOperation] }) }, blocker: "TEMU_ACCOUNT_IDENTITY_SCOPES_INVALID" },
    { input: { accessTokenInfo: accessTokenInfo({ apiScopeList: ["bg.local.goods.list.retrieve"] }) }, blocker: "TEMU_ACCOUNT_IDENTITY_SCOPE_MISSING" },
    { input: { accessTokenInfo: accessTokenInfo({ apiScopeList: [`${temuAccountIdentityOperation}\n`] }) }, blocker: "TEMU_ACCOUNT_IDENTITY_SCOPES_INVALID" },
    { input: { observedAt: new Date("invalid") }, blocker: "TEMU_ACCOUNT_IDENTITY_OBSERVED_AT_INVALID" },
  ];
  for (const scenario of scenarios) {
    const result = evidence(scenario.input);
    assert.equal(result.status, "blocked");
    if (result.status === "blocked") assert.equal(result.blocker, scenario.blocker);
  }
});
