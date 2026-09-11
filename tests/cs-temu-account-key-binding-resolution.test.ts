import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  readVerifiedTemuCsBindingFromResult,
  temuCsAccountBindingEvidence,
  temuCsAccountBindingFailureDetail,
  temuSellerAccountKeyFromMallId,
} from "../lib/channels/cs/temu/account-binding";
import { csCredentialBindingEvidence } from "../lib/channels/cs-credential-binding";
import { executeCsProviderJob } from "../lib/cs/operations/provider";
import type { RemoteResponse } from "../lib/channels/protocols";
import {
  attestTemuCredentialIdentityForSave,
  temuAccountIdentityContract,
  temuAccountIdentityEndpointHost,
  temuAccountIdentityPayloadKeys,
  temuCredentialReadinessRequiredApiScopes,
} from "../lib/product-registration/temu/account-identity";

const mallId = "1024";
const otherMallId = "999";
const regionId = "211";
const observedAt = new Date("2026-09-10T02:30:00.000Z");

function sellerAccountKey(value = mallId) {
  const derived = temuSellerAccountKeyFromMallId(value);
  assert.ok(derived);
  return derived.sellerAccountKey;
}

function credentialPayload(overrides: Record<string, unknown> = {}) {
  return {
    app_key: "fixture-app",
    app_secret: "fixture-secret",
    access_token: "fixture-token",
    [temuAccountIdentityPayloadKeys.contract]: temuAccountIdentityContract,
    [temuAccountIdentityPayloadKeys.endpointHost]: temuAccountIdentityEndpointHost,
    [temuAccountIdentityPayloadKeys.mallId]: mallId,
    [temuAccountIdentityPayloadKeys.regionId]: regionId,
    [temuAccountIdentityPayloadKeys.mallType]: "100",
    ...overrides,
  };
}

function accessTokenInfo(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    data: {
      success: true,
      result: {
        mallId,
        apiScopeList: [
          "bg.open.accesstoken.info.get",
          "bg.aftersales.parentaftersales.list.get",
        ],
        ...overrides,
      },
    },
  };
}

function evidence(
  overrides: Partial<Parameters<typeof temuCsAccountBindingEvidence>[0]> = {},
) {
  return temuCsAccountBindingEvidence({
    credential: credentialPayload(),
    environment: "production",
    accessTokenInfo: accessTokenInfo(),
    expectedSellerAccountKey: sellerAccountKey(),
    expectedSellerAccountKeySource: "provider_certified_v1",
    observedAt,
    ...overrides,
  });
}

function blocked(
  overrides: Partial<Parameters<typeof temuCsAccountBindingEvidence>[0]> = {},
) {
  const result = evidence(overrides);
  assert.equal(result.status, "blocked");
  if (result.status !== "blocked") throw new Error("expected blocked evidence");
  return result;
}

test("a provider-certified key that matches the token-info mall verifies the Temu binding", () => {
  const verified = evidence();
  assert.equal(verified.status, "verified");
  if (verified.status !== "verified") return;
  assert.equal(verified.resolution, "relational_provider_certified_key");
  assert.equal(verified.identity.mallId, mallId);
  assert.equal(verified.identity.sellerAccountKey, sellerAccountKey());
  const mallField = verified.comparison.fields.find((field) => field.field === "mallId");
  assert.equal(mallField?.equal, true);
  assert.equal(verified.comparison.relationalKeyMatchesProviderIdentity, true);
  assert.equal(verified.comparison.relationalKeySourceCertified, true);
  assert.doesNotMatch(JSON.stringify(verified), /fixture-app|fixture-secret|fixture-token/);
});

test("a mismatched mallId fails with the attested-identity code and both sides recorded", () => {
  const result = blocked({
    credential: credentialPayload({
      [temuAccountIdentityPayloadKeys.mallId]: otherMallId,
    }),
  });
  assert.equal(result.blocker, "TEMU_ACCOUNT_IDENTITY_BINDING_MISMATCH");
  const comparison = result.comparison;
  assert.ok(comparison);
  const mallField = comparison.fields.find((field) => field.field === "mallId");
  assert.equal(mallField?.expected, otherMallId);
  assert.equal(mallField?.observed, mallId);
  assert.equal(mallField?.equal, false);
  const detail = temuCsAccountBindingFailureDetail(result);
  assert.match(detail, new RegExp(`mallId=${otherMallId}->${mallId}!`, "u"));
  assert.match(detail, /attestedBinding=present/u);
  assert.doesNotMatch(detail, /fixture-token/u);
});

test("a credential-incarnation key is reported by provenance instead of a bare mismatch", () => {
  // Production shape: the Temu credential ledger carries a random incarnation
  // digest, so comparing it to the provider-derived digest always mismatches.
  const incarnationKey = createHash("sha256").update("random-incarnation").digest("hex");
  const result = blocked({
    expectedSellerAccountKey: incarnationKey,
    expectedSellerAccountKeySource: "credential_incarnation_v1",
  });
  assert.equal(result.blocker, "TEMU_SELLER_ACCOUNT_KEY_SOURCE_UNVERIFIED");
  const comparison = result.comparison;
  assert.ok(comparison);
  assert.equal(comparison.relationalKeySource, "credential_incarnation_v1");
  assert.equal(comparison.relationalKeySourceCertified, false);
  assert.equal(comparison.relationalKeyPrefix, incarnationKey.slice(0, 12));
  assert.equal(comparison.providerSellerAccountKeyPrefix, sellerAccountKey().slice(0, 12));
  assert.equal(comparison.relationalKeyMatchesProviderIdentity, false);
  const detail = temuCsAccountBindingFailureDetail(result);
  assert.match(detail, /source=credential_incarnation_v1/u);
  assert.match(detail, new RegExp(incarnationKey.slice(0, 12), "u"));
  assert.ok(detail.length <= 320);
});

test("an unrecognised key provenance fails closed", () => {
  const result = blocked({ expectedSellerAccountKeySource: "manual_operator_v2" });
  assert.equal(result.blocker, "TEMU_SELLER_ACCOUNT_KEY_SOURCE_UNVERIFIED");
  assert.equal(result.comparison?.relationalKeySourceCertified, false);
});

test("a credential without a provider-attested identity cannot certify an incarnation key", () => {
  const result = blocked({
    credential: {
      app_key: "fixture-app",
      app_secret: "fixture-secret",
      access_token: "fixture-token",
    },
    expectedSellerAccountKey: createHash("sha256").update("random-incarnation").digest("hex"),
    expectedSellerAccountKeySource: "credential_incarnation_v1",
  });
  assert.equal(result.blocker, "TEMU_ACCOUNT_IDENTITY_BINDING_REQUIRED");
  assert.equal(result.comparison?.credentialAttestedBindingPresent, false);
});

test("a failed attestation writes no identity fields and leaves the binding blocked", async () => {
  const remote = (data: Record<string, unknown>, status = 200): RemoteResponse => {
    const text = JSON.stringify(data);
    return {
      response: new Response(text, { status, headers: { "content-type": "application/json" } }),
      data,
      text,
    };
  };
  const unboundPayload = {
    app_key: "fixture-app",
    app_secret: "fixture-secret",
    access_token: "fixture-token",
  };
  await assert.rejects(attestTemuCredentialIdentityForSave({
    payload: unboundPayload,
    nowSeconds: 1_800_000_000,
    request: async () => remote({ success: false, errorCode: "1200001" }),
  }), /TEMU_ACCOUNT_IDENTITY_READ_UNVERIFIED/u);
  // The rejected attestation returns nothing, so no identity field can be
  // persisted and no seller-account key may be promoted from it.
  assert.deepEqual(Object.keys(unboundPayload), ["app_key", "app_secret", "access_token"]);
  const result = blocked({
    credential: unboundPayload,
    expectedSellerAccountKey: createHash("sha256").update("random-incarnation").digest("hex"),
    expectedSellerAccountKeySource: "credential_incarnation_v1",
  });
  assert.equal(result.blocker, "TEMU_ACCOUNT_IDENTITY_BINDING_REQUIRED");
  assert.equal(result.status, "blocked");

  const attested = await attestTemuCredentialIdentityForSave({
    payload: unboundPayload,
    nowSeconds: 1_800_000_000,
    request: async () => remote({
      success: true,
      result: {
        mallId,
        regionId,
        mallType: 100,
        expiredTime: "4102444800",
        apiScopeList: [...temuCredentialReadinessRequiredApiScopes],
      },
    }),
  });
  assert.equal(attested.sellerAccount.sellerAccountKey, sellerAccountKey());
  assert.equal(attested.sellerAccount.sellerSubject, `temu:mall:${mallId}`);
  assert.equal(attested.sellerAccount.sellerAccountKeySource, "provider_certified_v1");
  assert.equal(attested.sellerAccount.mallId, attested.identity.mallId);
  assert.equal(
    attested.payload[temuAccountIdentityPayloadKeys.mallId],
    mallId,
  );
});

test("Temu CS evidence is only produced from the provider-verified binding step", () => {
  const verifiedStep = {
    name: "credential-binding:temu",
    ok: true,
    status: 200,
    data: evidence(),
  };
  const read = readVerifiedTemuCsBindingFromResult({ steps: [verifiedStep] });
  assert.equal(read?.sellerAccountKey, sellerAccountKey());
  assert.equal(read?.mallId, mallId);

  const request = { arguments: { seller_id: "caller-must-not-be-trusted" } };
  const credential = {
    app_key: "fixture-app",
    app_secret: "fixture-secret",
    access_token: "fixture-token",
  };
  const generated = csCredentialBindingEvidence({
    channel: "temu",
    operation: "inquiries.list",
    credential,
    request,
    providerResult: { steps: [verifiedStep] },
    credentialBindingContext: {
      status: "verified",
      sellerAccountKey: sellerAccountKey(),
      sellerAccountKeySource: "provider_certified_v1",
    },
  });
  assert.equal(generated?.sellerAccountKey, sellerAccountKey());
  assert.deepEqual(generated?.targetFingerprints, [sellerAccountKey()]);
  assert.equal(generated?.country, "UNSCOPED");
  assert.doesNotMatch(JSON.stringify(generated), /fixture-secret|fixture-token/u);

  // No verified binding step, or a blocked one, must not produce any target.
  assert.equal(csCredentialBindingEvidence({
    channel: "temu",
    operation: "inquiries.list",
    credential,
    request,
    providerResult: { steps: [] },
  }), null);
  assert.equal(readVerifiedTemuCsBindingFromResult({
    steps: [{
      name: "credential-binding:temu",
      ok: true,
      status: 200,
      data: blocked({
        expectedSellerAccountKeySource: "credential_incarnation_v1",
        expectedSellerAccountKey: "f".repeat(64),
      }),
    }],
  }), null);
  // A context key that disagrees with the provider-verified identity is refused.
  assert.equal(csCredentialBindingEvidence({
    channel: "temu",
    operation: "inquiries.list",
    credential,
    request,
    providerResult: { steps: [verifiedStep] },
    credentialBindingContext: { status: "verified", sellerAccountKey: "f".repeat(64) },
  }), null);
});

test("the provider lane records which side of the binding mismatched", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    success: true,
    result: {
      mallId,
      apiScopeList: [
        "bg.open.accesstoken.info.get",
        "bg.aftersales.parentaftersales.list.get",
      ],
    },
  });
  const incarnationKey = createHash("sha256").update("random-incarnation").digest("hex");
  try {
    await assert.rejects(executeCsProviderJob({
      job: {
        id: "00000000-0000-4000-8000-00000000d301",
        claim_token: "00000000-0000-4000-8000-00000000d302",
        credential_id: "00000000-0000-4000-8000-00000000d303",
        channel: "temu",
        operation: "inquiries.list",
        environment: "production",
        request: { arguments: { kind: "after_sales" } },
        credential: credentialPayload(),
        attempt_count: 1,
        credential_binding_context: {
          status: "verified",
          sellerAccountKey: incarnationKey,
          sellerAccountKeySource: "credential_incarnation_v1",
        },
      },
      signal: new AbortController().signal,
      hooks: {
        beginCredentialMutation: async () => {},
        stageCredentialRefresh: async () => {},
        beginProviderMutation: async () => {},
        assertLeaseHealthy: async () => {},
      },
    }, async () => {
      throw new Error("TEMU_CS_INQUIRY_MUST_NOT_RUN");
    }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message,
        /^TEMU_CS_ACCOUNT_BINDING_UNAVAILABLE:TEMU_SELLER_ACCOUNT_KEY_SOURCE_UNVERIFIED:source=credential_incarnation_v1/u);
      assert.match(error.message, new RegExp(incarnationKey.slice(0, 12), "u"));
      assert.match(error.message, new RegExp(sellerAccountKey().slice(0, 12), "u"));
      assert.doesNotMatch(error.message, /fixture-secret|fixture-token/u);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
