import assert from "node:assert/strict";
import test from "node:test";
import {
  exactShopeeCachedTargetForActiveCredential,
  exactShopeeTargetStoreBinding,
  shopeeShopDiscoveryEvidenceFromGatewayResult,
  type ShopeeCredentialSnapshot,
} from "../lib/product-registration/shopee/target-lineage-readiness";

const oldCredentialId = "11111111-1111-4111-8111-111111111111";
const activeCredentialId = "22222222-2222-4222-8222-222222222222";
const nextCredentialId = "33333333-3333-4333-8333-333333333333";
const targetId = "1719148844";
const subject = "shopee:main:4940266";
const nowMs = Date.parse("2026-09-09T09:30:00.000Z");

function secret(accessExpiry = "2026-09-09T14:30:00.000Z") {
  return {
    main_account_id: "4940266",
    provider_account_subject: subject,
    provider_account_identity_version: "v1",
    shopee_targets: [{
      type: "shop",
      id: targetId,
      access_token: "fixture-access-token",
      refresh_token: "fixture-refresh-token",
      access_token_expires_at: accessExpiry,
      refresh_token_expires_at: "2026-10-09T09:30:00.000Z",
    }],
  };
}

const sgTarget = {
  targetId,
  displayName: "gjrxn.sg",
  marketCode: "SG",
  locale: "en-SG",
  language: "English",
  currency: "SGD",
  verifiedAt: "2026-09-09T09:31:00.000Z",
};

test("one exact SG target can be ready without waiting for all eight markets", () => {
  const result = exactShopeeCachedTargetForActiveCredential({
    cachedTargets: [{ ...sgTarget, credentialId: activeCredentialId, credentialVersion: 80 }],
    activeCredentialId,
    activeCredentialVersion: 80,
    activeCredentialSecret: secret(),
    targetId,
    marketCode: "SG",
    nowMs,
  });
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.equal(result.target.targetId, targetId);
    assert.equal(result.target.credentialId, activeCredentialId);
  }
});

test("same shop cached under an old credential is never ready", () => {
  assert.deepEqual(exactShopeeCachedTargetForActiveCredential({
    cachedTargets: [{ ...sgTarget, credentialId: oldCredentialId, credentialVersion: 79 }],
    activeCredentialId,
    activeCredentialVersion: 80,
    activeCredentialSecret: secret(),
    targetId,
    marketCode: "SG",
    nowMs,
  }), { status: "blocked", reason: "SHOPEE_TARGET_CACHE_CREDENTIAL_MISMATCH" });
});

test("a cache RPC row without credential lineage fails closed", () => {
  assert.deepEqual(exactShopeeCachedTargetForActiveCredential({
    cachedTargets: [sgTarget],
    activeCredentialId,
    activeCredentialVersion: 80,
    activeCredentialSecret: secret(),
    targetId,
    marketCode: "SG",
    nowMs,
  }), { status: "blocked", reason: "SHOPEE_TARGET_CACHE_CREDENTIAL_UNBOUND" });
});

test("same credential id cannot relabel an older cache receipt with the current version", () => {
  assert.deepEqual(exactShopeeCachedTargetForActiveCredential({
    cachedTargets: [{ ...sgTarget, credentialId: activeCredentialId, credentialVersion: 79 }],
    activeCredentialId,
    activeCredentialVersion: 80,
    activeCredentialSecret: secret(),
    targetId,
    marketCode: "SG",
    nowMs,
  }), { status: "blocked", reason: "SHOPEE_TARGET_CACHE_VERSION_MISMATCH" });
});

test("a legacy cache row without a store-time credential version is never current evidence", () => {
  assert.deepEqual(exactShopeeCachedTargetForActiveCredential({
    cachedTargets: [{ ...sgTarget, credentialId: activeCredentialId }],
    activeCredentialId,
    activeCredentialVersion: 80,
    activeCredentialSecret: secret(),
    targetId,
    marketCode: "SG",
    nowMs,
  }), { status: "blocked", reason: "SHOPEE_TARGET_CACHE_VERSION_UNBOUND" });
});

test("a matching cache receipt cannot bypass stale target access", () => {
  assert.deepEqual(exactShopeeCachedTargetForActiveCredential({
    cachedTargets: [{ ...sgTarget, credentialId: activeCredentialId, credentialVersion: 80 }],
    activeCredentialId,
    activeCredentialVersion: 80,
    activeCredentialSecret: secret("2026-09-09T09:35:00.000Z"),
    targetId,
    marketCode: "SG",
    nowMs,
  }), { status: "blocked", reason: "SHOPEE_TARGET_CACHE_ACCESS_NOT_FRESH" });
});

function snapshot(credentialId: string, version: number, payload = secret()): ShopeeCredentialSnapshot {
  return { credentialId, version, secretPayload: payload };
}

test("store binding accepts an exact active rotation after official SG identity readback", () => {
  const binding = exactShopeeTargetStoreBinding({
    requestedCredentialId: activeCredentialId,
    requestedTargetId: targetId,
    requestedMarketCode: "SG",
    before: snapshot(activeCredentialId, 80),
    after: snapshot(nextCredentialId, 81),
    providerProfile: { response: { shop_id: Number(targetId), shop_name: "gjrxn.sg", region: "SG", status: "NORMAL" } },
    providerReadSucceeded: true,
    signedRequestBoundToTarget: true,
    observedAt: "2026-09-09T09:31:00.000Z",
    nowMs,
  });
  assert.equal(binding.credentialId, nextCredentialId);
  assert.equal(binding.rotated, true);
  assert.deepEqual(binding.target, { ...sgTarget, credentialId: nextCredentialId, status: "NORMAL" });
});

test("store binding rejects a target absent from the fresh active credential", () => {
  assert.throws(() => exactShopeeTargetStoreBinding({
    requestedCredentialId: activeCredentialId,
    requestedTargetId: targetId,
    requestedMarketCode: "SG",
    before: snapshot(activeCredentialId, 80),
    after: snapshot(nextCredentialId, 81, { ...secret(), shopee_targets: [] }),
    providerProfile: { response: { shop_id: targetId, shop_name: "gjrxn.sg", region: "SG" } },
    providerReadSucceeded: true,
    signedRequestBoundToTarget: true,
    observedAt: "2026-09-09T09:31:00.000Z",
    nowMs,
  }), /SHOPEE_TARGET_STORE_TARGET_NOT_AUTHORIZED/u);
});

test("store binding rejects identity drift across an active credential rotation", () => {
  assert.throws(() => exactShopeeTargetStoreBinding({
    requestedCredentialId: activeCredentialId,
    requestedTargetId: targetId,
    requestedMarketCode: "SG",
    before: snapshot(activeCredentialId, 80),
    after: snapshot(nextCredentialId, 81, { ...secret(), provider_account_subject: "shopee:main:9999999" }),
    providerProfile: { response: { shop_id: targetId, shop_name: "gjrxn.sg", region: "SG" } },
    providerReadSucceeded: true,
    signedRequestBoundToTarget: true,
    observedAt: "2026-09-09T09:31:00.000Z",
    nowMs,
  }), /SHOPEE_TARGET_STORE_IDENTITY_CHANGED/u);
});

test("store binding rejects stale access expiry and remote shop or market drift", () => {
  const base = {
    requestedCredentialId: activeCredentialId,
    requestedTargetId: targetId,
    requestedMarketCode: "SG",
    before: snapshot(activeCredentialId, 80),
    providerReadSucceeded: true,
    signedRequestBoundToTarget: true,
    observedAt: "2026-09-09T09:31:00.000Z",
    nowMs,
  } as const;
  assert.throws(() => exactShopeeTargetStoreBinding({
    ...base,
    after: snapshot(nextCredentialId, 81, secret("2026-09-09T09:35:00.000Z")),
    providerProfile: { response: { shop_id: targetId, shop_name: "gjrxn.sg", region: "SG" } },
  }), /SHOPEE_TARGET_STORE_ACCESS_NOT_FRESH/u);
  assert.throws(() => exactShopeeTargetStoreBinding({
    ...base,
    after: snapshot(nextCredentialId, 81),
    providerProfile: { response: { shop_id: "999999999", shop_name: "other", region: "SG" } },
  }), /SHOPEE_SHOP_IDENTITY_MISMATCH/u);
  assert.throws(() => exactShopeeTargetStoreBinding({
    ...base,
    after: snapshot(nextCredentialId, 81),
    providerProfile: { response: { shop_id: targetId, shop_name: "gjrxn.sg", region: "MY" } },
  }), /SHOPEE_TARGET_STORE_MARKET_MISMATCH/u);
});


test("nonfinite clocks or buffers cannot bypass the expired-token store guard", () => {
  for (const clock of [{ nowMs: Number.NaN }, { nowMs: Number.POSITIVE_INFINITY }, { accessBufferMs: Number.NaN }]) {
    assert.throws(() => exactShopeeTargetStoreBinding({
      requestedCredentialId: activeCredentialId,
      requestedTargetId: targetId,
      requestedMarketCode: "SG",
      before: snapshot(activeCredentialId, 80),
      after: snapshot(nextCredentialId, 81, secret("2026-09-09T09:00:00.000Z")),
      providerProfile: { response: { shop_id: targetId, shop_name: "gjrxn.sg", region: "SG" } },
      providerReadSucceeded: true,
      signedRequestBoundToTarget: true,
      observedAt: "2026-09-09T09:31:00.000Z",
      nowMs,
      ...clock,
    }), /SHOPEE_TARGET_STORE_CLOCK_INVALID/u);
  }
});

test("gateway evidence proves one successful signed Shopee shop read before store binding", () => {
  const evidence = shopeeShopDiscoveryEvidenceFromGatewayResult({
    requestedTargetId: targetId,
    result: {
      ok: true,
      channel: "shopee",
      operation: "shops.get",
      steps: [{
        name: "shop-info",
        ok: true,
        status: 200,
        data: { response: { shop_id: targetId, shop_name: "gjrxn.sg", region: "SG" } },
      }],
    },
  });
  assert.equal(evidence.providerReadSucceeded, true);
  assert.equal(evidence.signedRequestBoundToTarget, true);
  assert.deepEqual(evidence.providerProfile.response, {
    shop_id: targetId,
    shop_name: "gjrxn.sg",
    region: "SG",
  });
});

test("gateway evidence rejects failed, malformed, provider-error and wrong-shop results", () => {
  const valid = {
    ok: true,
    channel: "shopee",
    operation: "shops.get",
    steps: [{
      name: "shop-info",
      ok: true,
      status: 200,
      data: { response: { shop_id: targetId, shop_name: "gjrxn.sg", region: "SG" } },
    }],
  };
  for (const result of [
    { ...valid, ok: false },
    { ...valid, channel: "lazada" },
    { ...valid, operation: "diagnostic.test" },
    { ...valid, steps: [] },
    { ...valid, steps: [{ ...valid.steps[0], name: "seller-info" }] },
    { ...valid, steps: [{ ...valid.steps[0], ok: false }] },
    { ...valid, steps: [{ ...valid.steps[0], status: 500 }] },
    { ...valid, steps: [{ ...valid.steps[0], data: { error: "invalid_access_token" } }] },
  ]) {
    assert.throws(() => shopeeShopDiscoveryEvidenceFromGatewayResult({
      result,
      requestedTargetId: targetId,
    }), /SHOPEE_TARGET_STORE_PROVIDER_READ_FAILED/u);
  }
  assert.throws(() => shopeeShopDiscoveryEvidenceFromGatewayResult({
    result: {
      ...valid,
      steps: [{ ...valid.steps[0], data: { response: { shop_id: "999999999", shop_name: "other", region: "SG" } } }],
    },
    requestedTargetId: targetId,
  }), /SHOPEE_SHOP_IDENTITY_MISMATCH/u);
});
