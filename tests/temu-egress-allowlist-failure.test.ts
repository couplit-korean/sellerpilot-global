import assert from "node:assert/strict";
import test from "node:test";

import {
  egressIpSha256,
  recordObservedLocalEgressSha256,
} from "../lib/channels/local-channel-executor";
import type { RemoteResponse } from "../lib/channels/protocols";
import {
  attestTemuCredentialIdentityForSave,
  temuCredentialReadinessRequiredApiScopes,
  verifyTemuAccountIdentity,
} from "../lib/product-registration/temu/account-identity";
import {
  classifyTemuEgressAllowlistFailure,
  isTemuEgressIpNotAllowlistedError,
  temuEgressAllowlistConsoleUrl,
  temuEgressAllowlistMessage,
  temuEgressAllowlistProviderErrorCode,
  temuEgressAllowlistStepData,
  temuEgressIpNotAllowlistedCode,
  resolveTemuEgressFingerprint,
} from "../lib/product-registration/temu/egress-allowlist-failure";
import {
  createTemuAuthoritativeProviderReadAdapter,
  TemuAuthoritativeProviderReadError,
} from "../lib/product-registration/temu/authoritative-provider-read-adapter";

// Synthetic provider bodies. They intentionally carry an IP and a private trace
// token so the assertions can prove nothing from the raw payload is echoed.
const operatorEgressIp = "203.0.113.8";
const operatorEgressSha256 = egressIpSha256(operatorEgressIp) as string;
const operatorEgressPrefix = operatorEgressSha256.slice(0, 11);

const whitelistBody = {
  success: false,
  errorCode: temuEgressAllowlistProviderErrorCode,
  errorMsg: `not in ip white list, request from ${operatorEgressIp} trace 7f3a1c9b`,
};

const whitelistMessageOnlyBody = {
  success: false,
  errorMsg: "NOT_IN_IP_WHITE_LIST",
};

const otherProviderErrorBody = {
  success: false,
  errorCode: "1200001",
  errorMsg: "invalid parameter goodsName for mall 608573962731830",
};

const mallId = "608573962731830";
const regionId = "211";
const externalId = "AUTO-780720401E2D4E4EA45F";

function credentialPayload(overrides: Record<string, unknown> = {}) {
  return {
    app_key: "fixture-app",
    app_secret: "fixture-secret",
    access_token: "fixture-token",
    temu_account_identity_contract: "temu_access_token_identity_v1",
    temu_account_identity_endpoint_host: "openapi-b-global.temu.com",
    temu_account_identity_mall_id: mallId,
    temu_account_identity_region_id: regionId,
    temu_account_identity_mall_type: "100",
    ...overrides,
  };
}

function successTokenBody() {
  return {
    success: true,
    result: {
      mallId,
      regionId,
      mallType: 100,
      expiredTime: "4102444800",
      apiScopeList: [...temuCredentialReadinessRequiredApiScopes],
    },
  };
}

function remote(data: Record<string, unknown>, status = 200): RemoteResponse {
  const text = JSON.stringify(data);
  return {
    response: new Response(text, {
      status,
      headers: { "content-type": "application/json" },
    }),
    data,
    text,
  };
}

function createBody() {
  return {
    language: "ko",
    goodsBasic: {
      externalGoodsId: externalId,
      goodsName: "한국어로 검증된 테무 등록 상품",
      extCatName: "Home & Kitchen / Storage / Cable Management",
      goodsDesc: "상품의 구성과 사용 방법을 한국어로 설명합니다.",
      bulletPoints: ["검증된 구성 정보를 안내합니다."],
      goodsCarouselImage: ["https://cdn.example.test/temu/hero.jpg"],
      detailImage: Array.from(
        { length: 8 },
        (_, index) => `https://cdn.example.test/temu/detail-${index + 1}.jpg`,
      ),
    },
    attributes: [{ name: "Material", value: ["ABS"] }],
    skuList: [{
      images: ["https://cdn.example.test/temu/hero.jpg"],
      packageInfo: { weight: "400", length: "28", width: "20", height: "7" },
      variations: [{ name: "판매 구성", value: "6봉" }],
      externalSkuId: externalId,
      price: { basePrice: { amount: "3190", currency: "KRW" } },
      quantity: 1,
    }],
  };
}

function providerReadAdapter(request: (input: {
  type: string;
}) => Promise<RemoteResponse>) {
  return createTemuAuthoritativeProviderReadAdapter({
    payload: credentialPayload(),
    expectedMallId: mallId,
    expectedRegionId: regionId,
    productRevisionFingerprint: "b".repeat(64),
    externalGoodsId: externalId,
    externalSkuId: externalId,
    createBody: createBody(),
    request: async (input) => request({ type: input.type }),
    clock: { nowEpochMs: () => 1_800_000_000_000 },
    egress: { sha256: operatorEgressSha256 },
  });
}

test("a whitelist rejection carries the stable code and the observed egress prefix", () => {
  const evidence = classifyTemuEgressAllowlistFailure({
    status: 200,
    data: whitelistBody,
    egress: { sha256: operatorEgressSha256 },
  });
  assert.equal(evidence.notAllowlisted, true);
  assert.equal(evidence.code, temuEgressIpNotAllowlistedCode);
  assert.equal(evidence.providerErrorCode, temuEgressAllowlistProviderErrorCode);
  assert.equal(evidence.egress.sha256, operatorEgressSha256);
  assert.equal(evidence.egress.prefix, operatorEgressPrefix);
  assert.equal(evidence.egress.prefix.length, 11);
  const message = String(evidence.message);
  assert.match(message, /TEMU_EGRESS_IP_NOT_ALLOWLISTED/u);
  assert.match(message, /5000003/u);
  assert.match(message, /허용 목록/u);
  assert.match(message, new RegExp(operatorEgressPrefix, "u"));
  assert.ok(message.includes(temuEgressAllowlistConsoleUrl));
  // No provider prose, no raw source IP, no private trace token.
  assert.doesNotMatch(message, new RegExp(operatorEgressIp.replaceAll(".", "\\."), "u"));
  assert.doesNotMatch(message, /7f3a1c9b/u);
  assert.doesNotMatch(message, /not in ip white list/u);
});

test("a whitelist rejection is detected from the provider message alone", () => {
  for (const data of [whitelistMessageOnlyBody, {
    success: false,
    errorMsg: "ip whitelist blocked",
  }]) {
    const evidence = classifyTemuEgressAllowlistFailure({
      status: 200,
      data,
      egress: operatorEgressIp,
    });
    assert.equal(evidence.notAllowlisted, true);
    assert.equal(evidence.code, temuEgressIpNotAllowlistedCode);
    assert.equal(evidence.egress.prefix, operatorEgressPrefix);
  }
});

test("other provider errors and successful bodies are never classified as allowlist", () => {
  for (const data of [otherProviderErrorBody, successTokenBody(), {}]) {
    const evidence = classifyTemuEgressAllowlistFailure({
      status: 200,
      data,
      egress: operatorEgressSha256,
    });
    assert.equal(evidence.notAllowlisted, false);
    assert.equal(evidence.code, null);
    assert.equal(evidence.message, null);
    assert.deepEqual(temuEgressAllowlistStepData(evidence), {});
  }
  const transport = classifyTemuEgressAllowlistFailure({
    status: 400,
    data: otherProviderErrorBody,
    egress: operatorEgressSha256,
  });
  assert.equal(transport.notAllowlisted, false);
  assert.equal(transport.providerErrorCode, "1200001");
});

test("step data exposes only bounded allowlist facts", () => {
  const evidence = classifyTemuEgressAllowlistFailure({
    status: 200,
    data: whitelistBody,
    egress: operatorEgressSha256,
  });
  assert.deepEqual(temuEgressAllowlistStepData(evidence), {
    sellerpilotTemuProviderErrorCode: temuEgressAllowlistProviderErrorCode,
    sellerpilotTemuEgressSha256: operatorEgressSha256,
    sellerpilotTemuEgressSha256Prefix: operatorEgressPrefix,
    sellerpilotTemuEgressAllowlistUrl: temuEgressAllowlistConsoleUrl,
  });
});

test("an unobserved egress stays explicitly null instead of being invented", () => {
  recordObservedLocalEgressSha256(null);
  assert.deepEqual(resolveTemuEgressFingerprint(null), {
    sha256: null,
    prefix: null,
  });
  const message = temuEgressAllowlistMessage(null);
  assert.match(message, /egress sha256 없음/u);
  assert.match(message, /허용 목록/u);
});

test("the egress measured by the local worker is used when the caller has none", () => {
  recordObservedLocalEgressSha256(operatorEgressSha256);
  try {
    const evidence = classifyTemuEgressAllowlistFailure({
      status: 200,
      data: whitelistBody,
    });
    assert.equal(evidence.egress.sha256, operatorEgressSha256);
    assert.equal(evidence.egress.prefix, operatorEgressPrefix);
    assert.match(String(evidence.message),
      new RegExp(operatorEgressPrefix, "u"));
  } finally {
    recordObservedLocalEgressSha256(null);
  }
  recordObservedLocalEgressSha256("not-a-digest");
  assert.deepEqual(resolveTemuEgressFingerprint(null), {
    sha256: null,
    prefix: null,
  });
});

test("the identity attestation surfaces the allowlist code instead of an unverified read", async () => {
  await assert.rejects(attestTemuCredentialIdentityForSave({
    payload: credentialPayload(),
    nowSeconds: 1_800_000_000,
    egress: { sha256: operatorEgressSha256 },
    request: async () => remote(whitelistBody),
  }), (error: unknown) =>
    isTemuEgressIpNotAllowlistedError(error)
    && error.code === temuEgressIpNotAllowlistedCode
    && error.providerErrorCode === temuEgressAllowlistProviderErrorCode
    && error.egressSha256 === operatorEgressSha256
    && error.egressSha256Prefix === operatorEgressPrefix
    && /허용 목록/u.test(error.message)
    && !error.message.includes(operatorEgressIp)
    && !error.message.includes("fixture-secret")
    && !error.message.includes("fixture-token"));
});

test("the identity attestation keeps its existing failure shape for other provider errors", async () => {
  await assert.rejects(attestTemuCredentialIdentityForSave({
    payload: credentialPayload(),
    nowSeconds: 1_800_000_000,
    request: async () => remote(otherProviderErrorBody),
  }), (error: unknown) =>
    error instanceof Error
    && !isTemuEgressIpNotAllowlistedError(error)
    && error.message === "TEMU_ACCOUNT_IDENTITY_READ_UNVERIFIED");

  await assert.rejects(attestTemuCredentialIdentityForSave({
    payload: credentialPayload(),
    nowSeconds: 1_800_000_000,
    request: async () => remote(whitelistBody, 500),
  }), (error: unknown) =>
    isTemuEgressIpNotAllowlistedError(error)
    && error.code === temuEgressIpNotAllowlistedCode
    && error.egressSha256 === null);

  const attested = await attestTemuCredentialIdentityForSave({
    payload: credentialPayload(),
    nowSeconds: 1_800_000_000,
    request: async () => remote(successTokenBody()),
  });
  assert.equal(attested.identity.mallId, mallId);
  assert.equal(attested.payload.access_token, "fixture-token");
});

test("token identity verification reports the allowlist code, not an unverified read", () => {
  const allowlisted = verifyTemuAccountIdentity({
    payload: credentialPayload(),
    response: whitelistBody,
    requiredScopes: temuCredentialReadinessRequiredApiScopes,
    nowSeconds: 1_800_000_000,
    egress: { sha256: operatorEgressSha256 },
  });
  assert.equal(allowlisted.ok, false);
  assert.equal(allowlisted.verification, temuEgressIpNotAllowlistedCode);

  assert.equal(verifyTemuAccountIdentity({
    payload: credentialPayload(),
    response: otherProviderErrorBody,
    requiredScopes: temuCredentialReadinessRequiredApiScopes,
    nowSeconds: 1_800_000_000,
  }).verification, "TEMU_ACCOUNT_IDENTITY_READ_UNVERIFIED");

  assert.equal(verifyTemuAccountIdentity({
    payload: credentialPayload(),
    response: successTokenBody(),
    requiredScopes: temuCredentialReadinessRequiredApiScopes,
    nowSeconds: 1_800_000_000,
  }).verification, "TEMU_ACCOUNT_IDENTITY_VERIFIED");
});

test("the authoritative provider read path reports the same allowlist code", async () => {
  const whitelisted = providerReadAdapter(async () => remote(whitelistBody));
  for (const read of [
    () => whitelisted.readTokenInfo(),
    () => whitelisted.readExactGoods({
      mallId,
      productRevisionFingerprint: "b".repeat(64),
      externalGoodsId: externalId,
    }),
    () => whitelisted.readExactSku({
      mallId,
      productRevisionFingerprint: "b".repeat(64),
      externalSkuId: externalId,
    }),
  ]) {
    await assert.rejects(read(), (error: unknown) =>
      error instanceof TemuAuthoritativeProviderReadError
      && error.code === temuEgressIpNotAllowlistedCode
      && error.egressSha256 === operatorEgressSha256
      && error.egressSha256Prefix === operatorEgressPrefix
      && /허용 목록/u.test(error.message)
      && !error.message.includes(operatorEgressIp)
      && !error.message.includes("fixture-secret"));
  }

  const other = providerReadAdapter(async () => remote(otherProviderErrorBody, 400));
  await assert.rejects(other.readTokenInfo(), (error: unknown) =>
    error instanceof TemuAuthoritativeProviderReadError
    && error.code === "TEMU_AUTHORITATIVE_READ_TRANSPORT_FAILED"
    && !error.message.includes("invalid parameter goodsName"));
});
