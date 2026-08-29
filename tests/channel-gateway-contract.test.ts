import assert from "node:assert/strict";
import test from "node:test";
import {
  gatewayClaimSchema,
  gatewayCredentialRefreshLifecycleSchema,
  gatewayJobCompletionStatus,
  gatewayJobCompletionStatusAtJobBoundary,
  gatewayResultHasObservedMutation,
  gatewayWorkerCompletionSchema,
} from "../lib/channels/gateway-contract";
import {
  listingRemoteStateFulfillsIntent,
  persistedListingPublicationReplay,
  verifiedListingPublicationResult,
} from "../lib/channels/listing-publication-state";

test("gateway canonicalizes PostgreSQL timezone offsets before credential staging", () => {
  const parsed = gatewayCredentialRefreshLifecycleSchema.safeParse({
    action: "stage",
    jobId: "51fc7348-3e07-45ba-94c7-62e5244b511b",
    claimToken: "f0308779-b8dd-4fbb-8cad-f55fe0d33f2d",
    credentialRefresh: {
      payload: { access_token: "new-access-token" },
      expiresAt: "2027-08-25T00:00:00+00:00",
      recoveryOnly: true,
    },
  });

  assert.equal(parsed.success, true);
  if (parsed.success && parsed.data.action === "stage") {
    assert.equal(parsed.data.credentialRefresh.expiresAt, "2027-08-25T00:00:00.000Z");
  }
});

test("OAuth completion accepts and canonicalizes a timezone offset", () => {
  const parsed = gatewayWorkerCompletionSchema.safeParse({
    jobId: "51fc7348-3e07-45ba-94c7-62e5244b511b",
    claimToken: "f0308779-b8dd-4fbb-8cad-f55fe0d33f2d",
    status: "succeeded",
    result: {
      ok: true,
      channel: "shopee",
      operation: "oauth.exchange",
      expiresAt: "2027-08-25T09:00:00+09:00",
      safeMessage: "Shopee OAuth 토큰 교환을 완료했습니다.",
    },
    credentialRefresh: {
      payload: { access_token: "new-access-token" },
      expiresAt: "2027-08-25T09:00:00+09:00",
      oauthComplete: true,
    },
  });

  assert.equal(parsed.success, true);
  if (parsed.success && parsed.data.status === "succeeded" && parsed.data.result.operation === "oauth.exchange") {
    assert.equal(parsed.data.result.expiresAt, "2027-08-25T00:00:00.000Z");
  }
});

test("channel gateway accepts the full Shopee asynchronous verification trail", () => {
  const parsed = gatewayWorkerCompletionSchema.safeParse({
    jobId: "1b1f43a7-16d1-4a59-93df-22e76e9c8726",
    claimToken: "b9af413b-8ed5-4d47-956e-e7594bfbb902",
    status: "succeeded",
    result: {
      ok: false,
      channel: "shopee",
      operation: "listing.create",
      remoteId: "48366301456",
      safeMessage: "Shopee 게시 결과를 다시 확인해야 합니다.",
      steps: Array.from({ length: 25 }, (_, index) => ({
        name: `published-item-readback-${index + 1}`,
        ok: index < 24,
        status: 200,
        data: {},
      })),
    },
  });

  assert.equal(parsed.success, true);
});

test("channel gateway reconciliation can preserve a structured partial-write result", () => {
  const parsed = gatewayWorkerCompletionSchema.safeParse({
    jobId: "4c547930-1f56-46ea-b65d-a628fb440e9b",
    claimToken: "cb3b9b9b-9830-4997-8bd8-af1e6657e2f3",
    status: "reconciliation_required",
    error: "재고 변경 후 읽기 검증을 확정하지 못했습니다.",
    result: {
      ok: false,
      channel: "ebay",
      operation: "inventory.update",
      remoteId: "seller-sku-1",
      safeMessage: "재고 변경 후 읽기 검증을 확정하지 못했습니다.",
      steps: [
        { name: "bulk-inventory", ok: true, status: 204, data: {} },
        { name: "inventory-readback", ok: false, status: 503, data: {} },
      ],
    },
  });
  assert.equal(parsed.success, true);
});

test("verified listing exposure remains attached to the reconciliation completion", () => {
  const result = {
    ok: false,
    channel: "smartstore" as const,
    operation: "listing.create" as const,
    remoteId: "origin-product-123",
    publicationIntent: "safe_test" as const,
    publicationStateContract: "verified_remote_state_v1" as const,
    publicationFulfilled: false,
    remoteState: {
      verified: true as const,
      visibility: "live" as const,
      providerStatus: "SALE",
      verifiedAt: "2020-08-30T10:01:00.000Z",
      evidence: {
        identityVerified: true,
        statusVerified: true,
        localeVerified: true,
        fingerprintVerified: true,
        imageCountVerified: true,
      },
      resources: { originProductNo: "origin-product-123" },
      locale: "ko-KR",
      fingerprint: "a".repeat(64),
      imageCount: 8,
    },
    steps: [
      { name: "listing.create", ok: true, status: 200, data: {} },
      { name: "listing-readback", ok: true, status: 200, data: {} },
    ],
    safeMessage: "안전 등록 상품이 원격에서 공개 상태로 확인됐습니다.",
  };
  assert.equal(
    gatewayJobCompletionStatus(result.operation, result.ok, result.steps),
    "reconciliation_required",
  );
  assert.equal(gatewayWorkerCompletionSchema.safeParse({
    jobId: "4c547930-1f56-46ea-b65d-a628fb440e9b",
    claimToken: "cb3b9b9b-9830-4997-8bd8-af1e6657e2f3",
    status: "reconciliation_required",
    error: result.safeMessage,
    result,
  }).success, true);
});

test("channel gateway accepts sanitized 11st competitor search candidates", () => {
  const parsed = gatewayWorkerCompletionSchema.safeParse({
    jobId: "21f486a3-f6c5-4e68-8a67-31368874af04",
    claimToken: "808d1bb4-8437-4df0-ac3f-b72a3aa730d3",
    status: "succeeded",
    result: {
      ok: true,
      channel: "elevenst",
      operation: "competitor.search",
      items: [{
        provider: "elevenst_product_search",
        externalId: "123456789",
        title: "켈로그 첵스초코 570g",
        url: "https://www.11st.co.kr/products/123456789",
        imageUrl: "https://image.11st.co.kr/example.jpg",
        mallName: "공식 판매처",
        marketplace: "elevenst",
        price: 7_900,
        currency: "KRW",
      }],
      safeMessage: "11번가 공식 상품검색에서 후보 1건을 확인했습니다.",
    },
  });
  assert.equal(parsed.success, true);
});

test("channel gateway accepts a staged eBay OAuth completion", () => {
  const parsed = gatewayWorkerCompletionSchema.safeParse({
    jobId: "51fc7348-3e07-45ba-94c7-62e5244b511b",
    claimToken: "f0308779-b8dd-4fbb-8cad-f55fe0d33f2d",
    status: "succeeded",
    result: {
      ok: true,
      channel: "ebay",
      operation: "oauth.exchange",
      expiresAt: "2027-08-25T00:00:00.000Z",
      safeMessage: "eBay OAuth 토큰 교환을 완료했습니다.",
    },
    credentialRefresh: {
      payload: {
        client_id: "test-client",
        client_secret: "test-secret",
        ru_name: "test-redirect",
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
      },
      expiresAt: "2027-08-25T00:00:00.000Z",
      oauthComplete: true,
    },
  });

  assert.equal(parsed.success, true);
});

test("OAuth completion rejects credentials in response payload or a missing terminal stage", () => {
  const base = {
    jobId: "51fc7348-3e07-45ba-94c7-62e5244b511b",
    claimToken: "f0308779-b8dd-4fbb-8cad-f55fe0d33f2d",
    status: "succeeded",
    result: {
      ok: true,
      channel: "ebay",
      operation: "oauth.exchange",
      expiresAt: "2027-08-25T00:00:00.000Z",
      safeMessage: "eBay OAuth 토큰 교환을 완료했습니다.",
    },
  } as const;
  assert.equal(gatewayWorkerCompletionSchema.safeParse(base).success, false);
  assert.equal(gatewayWorkerCompletionSchema.safeParse({
    ...base,
    result: { ...base.result, credentialPayload: { access_token: "must-not-escape" } },
    credentialRefresh: {
      payload: { access_token: "staged-only" },
      expiresAt: "2027-08-25T00:00:00.000Z",
      oauthComplete: true,
    },
  }).success, false);
});

for (const status of ["failed", "reconciliation_required"] as const) {
  test(`channel gateway preserves a known credential refresh for ${status}`, () => {
    const parsed = gatewayWorkerCompletionSchema.safeParse({
      jobId: "0a29a4ca-4502-49fb-af23-4299d01cbd9c",
      claimToken: "7976da2d-6cc2-4ac2-9c99-1e10ddb0c30b",
      status,
      error: "provider outcome requires reconciliation",
      credentialRefresh: {
        payload: {
          app_key: "123456",
          app_secret: "secret-value",
          access_token: "next-access-token",
          refresh_token: "next-refresh-token",
        },
        expiresAt: "2027-08-25T00:00:00.000Z",
      },
    });

    assert.equal(parsed.success, true);
  });
}

test("inquiry reply provider uncertainty is never classified as safely retryable", () => {
  assert.equal(gatewayResultHasObservedMutation("inquiries.reply", false, [
    { name: "inquiry-reply", ok: true, status: 200 },
    { name: "reply-readback", ok: false, status: 503 },
  ]), true);
  assert.equal(gatewayJobCompletionStatus("inquiries.reply", false, [
    { name: "inquiry-reply", ok: false, status: 503 },
  ]), "reconciliation_required");
  assert.equal(gatewayJobCompletionStatus("inquiries.reply", false, [
    { name: "inquiry-preflight", ok: false, status: 422 },
  ]), "succeeded");
});

const listingCompletionBase = {
  jobId: "16bc7199-5adf-479d-a8a4-1e56d3516d78",
  claimToken: "ca3a8043-4565-4543-a467-65e4bf445523",
  status: "succeeded" as const,
  result: {
    ok: true,
    channel: "smartstore" as const,
    operation: "listing.create" as const,
    remoteId: "origin-product-123",
    publicationIntent: "safe_test" as const,
    publicationStateContract: "verified_remote_state_v1" as const,
    steps: [{
      name: "listing-readback",
      ok: true,
      status: 200,
      data: { sellerpilotVerification: "REMOTE_LISTING_STATE_VERIFIED" },
    }],
    safeMessage: "스마트스토어 비공개 검증 상품을 확인했습니다.",
  },
};

test("new successful listing writes require a verified remote state", () => {
  assert.equal(gatewayWorkerCompletionSchema.safeParse(listingCompletionBase).success, false);

  const parsed = gatewayWorkerCompletionSchema.safeParse({
    ...listingCompletionBase,
    result: {
      ...listingCompletionBase.result,
      remoteState: {
        verified: true,
        visibility: "non_public",
        providerStatus: "SUSPENSION",
        verifiedAt: "2020-08-30T18:00:00+09:00",
        evidence: {
          version: "provider_listing_state_v1",
          readbackStep: "listing-readback",
          identityVerified: true,
          statusVerified: true,
          localeVerified: true,
          fingerprintVerified: true,
          imageCountVerified: true,
        },
        resources: { originProductNo: "origin-product-123" },
        locale: "ko-KR",
        fingerprint: "a".repeat(64),
        imageCount: 8,
      },
      publicationFulfilled: true,
    },
  });

  assert.equal(parsed.success, true);
  if (parsed.success && parsed.data.status === "succeeded" && "remoteState" in parsed.data.result) {
    assert.equal(parsed.data.result.remoteState?.verifiedAt, "2020-08-30T09:00:00.000Z");
    assert.equal(parsed.data.result.remoteState?.visibility, "non_public");
  }
});

test("publication intent cannot be satisfied by an unsafe or unknown visibility", () => {
  const remoteState = {
    verified: true,
    visibility: "live",
    providerStatus: "SALE",
    verifiedAt: "2020-08-30T09:00:00.000Z",
    evidence: { version: "provider_listing_state_v1", identityVerified: true, statusVerified: true, localeVerified: true, fingerprintVerified: true, imageCountVerified: true },
    resources: { originProductNo: "origin-product-123" },
    locale: "ko-KR",
    fingerprint: "b".repeat(64),
    imageCount: 8,
  };
  assert.equal(gatewayWorkerCompletionSchema.safeParse({
    ...listingCompletionBase,
    result: { ...listingCompletionBase.result, remoteState },
  }).success, false);
  assert.equal(gatewayWorkerCompletionSchema.safeParse({
    ...listingCompletionBase,
    result: {
      ...listingCompletionBase.result,
      remoteState: { ...remoteState, visibility: "unknown" },
    },
  }).success, false);
});

test("legacy listing successes fail closed while non-listing results remain compatible", () => {
  const { publicationIntent: _intent, publicationStateContract: _contract, ...legacyResult } = listingCompletionBase.result;
  void _intent;
  void _contract;
  assert.equal(gatewayWorkerCompletionSchema.safeParse({
    ...listingCompletionBase,
    result: legacyResult,
  }).success, false);
  assert.equal(gatewayWorkerCompletionSchema.safeParse({
    ...listingCompletionBase,
    result: {
      ok: true,
      channel: "smartstore",
      operation: "orders.get",
      steps: [{ name: "order", ok: true, status: 200, data: {} }],
      safeMessage: "주문을 확인했습니다.",
    },
  }).success, true);
});

test("gateway claims reject malformed publication intent but preserve legacy queued writes", () => {
  const claim = {
    id: "e8a576dd-bc83-4620-8652-f469fc4aa78e",
    claim_token: "451da96f-c8eb-42c9-8630-260f9ab36750",
    credential_id: "e26b3dbf-b950-430b-a35a-6a280780ce03",
    channel: "smartstore",
    operation: "listing.create",
    environment: "production",
    request: { arguments: {} },
    credential: { access_token: "secret" },
    attempt_count: 1,
  };
  assert.equal(gatewayClaimSchema.safeParse(claim).success, true);
  assert.equal(gatewayClaimSchema.safeParse({
    ...claim,
    request: { arguments: { publicationIntent: "publish_now" } },
  }).success, false);
  assert.equal(gatewayClaimSchema.safeParse({
    ...claim,
    request: {
      arguments: {
        publicationIntent: "safe_test",
        publicationStateContract: "verified_remote_state_v1",
        publicationExpectedLocale: "ko-KR",
        publicationExpectedFingerprint: "a".repeat(64),
        publicationExpectedImageCount: 8,
      },
    },
  }).success, true);
  assert.equal(gatewayClaimSchema.safeParse({
    ...claim,
    request: { arguments: { publicationIntent: "safe_test", publicationStateContract: "v0" } },
  }).success, false);
  assert.equal(gatewayClaimSchema.safeParse({
    ...claim,
    operation: "listing.stop",
    request: { arguments: { publicationIntent: "safe_test", publicationStateContract: "verified_remote_state_v1" } },
  }).success, false);
});

test("pending provider review is known but does not fulfill either publication intent", () => {
  const state = {
    verified: true as const,
    visibility: "pending_review" as const,
    providerStatus: "PENDING_REVIEW",
    verifiedAt: "2020-08-30T09:00:00.000Z",
    evidence: { version: "provider_listing_state_v1", identityVerified: true, statusVerified: true, localeVerified: true, fingerprintVerified: true, imageCountVerified: true },
    resources: { listingId: "listing-123" },
    locale: "en-US",
    fingerprint: "c".repeat(64),
    imageCount: 8,
  };
  assert.equal(listingRemoteStateFulfillsIntent("safe_test", state), false);
  assert.equal(listingRemoteStateFulfillsIntent("live", state), false);

  const parsed = gatewayWorkerCompletionSchema.safeParse({
    ...listingCompletionBase,
    result: {
      ...listingCompletionBase.result,
      publicationIntent: "live",
      remoteState: state,
      publicationFulfilled: false,
    },
  });
  assert.equal(parsed.success, true, "a verified pending state remains a known provider-operation result");
  assert.equal(gatewayWorkerCompletionSchema.safeParse({
    ...listingCompletionBase,
    result: {
      ...listingCompletionBase.result,
      remoteState: state,
      publicationFulfilled: false,
    },
  }).success, false, "safe-test pending review can auto-go-live and is not an acceptable safe state");
  assert.equal(gatewayWorkerCompletionSchema.safeParse({
    ...listingCompletionBase,
    result: {
      ...listingCompletionBase.result,
      publicationIntent: "live",
      remoteState: state,
      publicationFulfilled: true,
    },
  }).success, false, "pending review cannot be presented as completed live publication");
});

test("listing stop requires verified non-public readback without a publication intent", () => {
  const result = {
    ok: true,
    channel: "smartstore",
    operation: "listing.stop",
    remoteId: "origin-product-123",
    publicationStateContract: "verified_remote_state_v1",
    remoteState: {
      verified: true,
      visibility: "withdrawn",
      providerStatus: "STOPPED",
      verifiedAt: "2020-08-30T09:00:00.000Z",
      evidence: { version: "provider_listing_state_v1", identityVerified: true, statusVerified: true, localeVerified: true, fingerprintVerified: true, imageCountVerified: true },
      resources: { originProductNo: "origin-product-123" },
      locale: "ko-KR",
      fingerprint: "f".repeat(64),
      imageCount: 8,
    },
    publicationFulfilled: true,
    steps: [{ name: "listing-stop-readback", ok: true, status: 200, data: {} }],
    safeMessage: "판매 중지 상태를 확인했습니다.",
  };
  assert.equal(gatewayWorkerCompletionSchema.safeParse({
    ...listingCompletionBase,
    result,
  }).success, true);
  assert.equal(gatewayWorkerCompletionSchema.safeParse({
    ...listingCompletionBase,
    result: { ...result, publicationIntent: "safe_test" },
  }).success, false);
  assert.equal(gatewayWorkerCompletionSchema.safeParse({
    ...listingCompletionBase,
    result: {
      ...result,
      remoteState: { ...result.remoteState, visibility: "pending_review" },
      publicationFulfilled: false,
    },
  }).success, false);
});

test("persisted duplicate listing results require exact verified state", () => {
  const state = {
    verified: true as const,
    visibility: "non_public" as const,
    providerStatus: "SUSPENSION",
    verifiedAt: "2020-08-30T09:00:00.000Z",
    evidence: { version: "provider_listing_state_v1", identityVerified: true, statusVerified: true, localeVerified: true, fingerprintVerified: true, imageCountVerified: true },
    resources: { originProductNo: "origin-product-123" },
    locale: "ko-KR",
    fingerprint: "d".repeat(64),
    imageCount: 8,
  };
  assert.deepEqual(persistedListingPublicationReplay("listing.create", null, null, "safe_test"), { status: "invalid" });
  assert.deepEqual(persistedListingPublicationReplay("listing.create", undefined, undefined, "safe_test"), { status: "invalid" });
  assert.deepEqual(persistedListingPublicationReplay("listing.update", "safe_test", state, "live"), { status: "invalid" });
  const verified = persistedListingPublicationReplay("listing.create", "safe_test", state, "safe_test");
  assert.equal(verified.status, "verified");
  if (verified.status === "verified") {
    assert.equal(verified.publicationFulfilled, true);
    assert.equal(verified.remoteState.providerStatus, "SUSPENSION");
  }

  const stoppedState = { ...state, visibility: "withdrawn" as const, providerStatus: "STOPPED" };
  const stopped = persistedListingPublicationReplay("listing.stop", "live", stoppedState);
  assert.equal(stopped.status, "verified");
  if (stopped.status === "verified") {
    assert.equal(stopped.publicationIntent, undefined);
    assert.equal(stopped.publicationFulfilled, true);
  }
  assert.deepEqual(persistedListingPublicationReplay("listing.stop", "live", {
    ...state,
    visibility: "pending_review",
  }), { status: "invalid" });
});

test("remote publication schema stays byte-compatible with the DB bounds", () => {
  const baseState = {
    verified: true,
    visibility: "non_public",
    providerStatus: "S".repeat(160),
    verifiedAt: "2020-08-30T09:00:00.000Z",
    evidence: { version: "provider_listing_state_v1", identityVerified: true, statusVerified: true, localeVerified: true, fingerprintVerified: true, imageCountVerified: true },
    resources: { listingId: "listing-123" },
    locale: "zh-Hant-TW",
    fingerprint: "e".repeat(64),
    imageCount: 64,
  };
  const completion = (remoteState: Record<string, unknown>) => ({
    ...listingCompletionBase,
    result: {
      ...listingCompletionBase.result,
      remoteState,
      publicationFulfilled: true,
    },
  });
  assert.equal(gatewayWorkerCompletionSchema.safeParse(completion(baseState)).success, true);
  assert.equal(gatewayWorkerCompletionSchema.safeParse(completion({
    ...baseState,
    providerStatus: "S".repeat(161),
  })).success, false);
  assert.equal(gatewayWorkerCompletionSchema.safeParse(completion({
    ...baseState,
    providerStatus: "SALE\nLIVE",
  })).success, false);
  assert.equal(gatewayWorkerCompletionSchema.safeParse(completion({
    ...baseState,
    evidence: { ...baseState.evidence, note: "가".repeat(12_000) },
  })).success, false, "UTF-8 byte size, not JavaScript character count, controls the evidence bound");
  assert.equal(gatewayWorkerCompletionSchema.safeParse(completion({
    ...baseState,
    locale: "zh_Hant_TW",
  })).success, false);
  assert.equal(gatewayWorkerCompletionSchema.safeParse(completion({
    ...baseState,
    imageCount: 65,
  })).success, false);
});

test("route-facing publication verification binds intent, remote ID, and create image evidence", () => {
  const result = {
    ...listingCompletionBase.result,
    remoteState: {
      verified: true,
      visibility: "non_public",
      providerStatus: "SUSPENSION",
      verifiedAt: "2020-08-30T09:00:00.000Z",
      evidence: { version: "provider_listing_state_v1", identityVerified: true, statusVerified: true, localeVerified: true, fingerprintVerified: true, imageCountVerified: true },
      resources: { originProductNo: "origin-product-123" },
      locale: "ko-KR",
      fingerprint: "1".repeat(64),
      imageCount: 8,
    },
    publicationFulfilled: true,
  };
  assert.equal(verifiedListingPublicationResult(
    "listing.create",
    result,
    "safe_test",
    {
      locale: "ko-KR",
      fingerprint: "1".repeat(64),
      minimumImageCount: 8,
      jobBoundary: "2020-08-30T09:00:00.000Z",
    },
  ).status, "verified");
  assert.equal(verifiedListingPublicationResult(
    "listing.create",
    result,
    "safe_test",
    { jobBoundary: "2020-08-30T09:00:00.001Z" },
  ).status, "invalid");
  assert.equal(verifiedListingPublicationResult("listing.create", result, "live").status, "invalid");
  assert.equal(verifiedListingPublicationResult("listing.create", {
    ...result,
    remoteState: { ...result.remoteState, resources: { originProductNo: "different" } },
  }, "safe_test").status, "invalid");
  assert.equal(verifiedListingPublicationResult("listing.create", {
    ...result,
    remoteState: { ...result.remoteState, imageCount: 7 },
  }, "safe_test", { minimumImageCount: 8 }).status, "invalid");
  assert.equal(verifiedListingPublicationResult("listing.create", {
    ...result,
    remoteState: { ...result.remoteState, imageCount: 9 },
  }, "safe_test", { minimumImageCount: 8 }).status, "invalid");
});

test("publication reverification accepts exact terminal states but fulfills only a live readback", () => {
  const makeResult = (visibility: "pending_review" | "live" | "rejected" | "withdrawn" | "non_public") => ({
    ...listingCompletionBase.result,
    operation: "listing.publication.verify" as const,
    publicationIntent: "live" as const,
    remoteState: {
      verified: true as const,
      visibility,
      providerStatus: visibility.toUpperCase(),
      verifiedAt: "2020-08-30T09:00:00.000Z",
      evidence: {
        identityVerified: true,
        statusVerified: true,
        localeVerified: true,
        fingerprintVerified: true,
        imageCountVerified: true,
      },
      resources: { originProductNo: "origin-product-123" },
      locale: "ko-KR",
      fingerprint: "3".repeat(64),
      imageCount: 8,
    },
    publicationFulfilled: visibility === "live",
  });
  for (const visibility of ["pending_review", "live", "rejected", "withdrawn", "non_public"] as const) {
    const result = makeResult(visibility);
    assert.equal(gatewayWorkerCompletionSchema.safeParse({
      ...listingCompletionBase,
      result,
    }).success, true, visibility);
    assert.equal(verifiedListingPublicationResult(
      "listing.publication.verify",
      result,
      "live",
      {
        locale: "ko-KR",
        fingerprint: "3".repeat(64),
        minimumImageCount: 8,
        jobBoundary: "2020-08-30T09:00:00.000Z",
      },
    ).status, "verified", visibility);
  }
});

test("successful listing completion is reconciled unless readback is at the provider-mutation boundary or later", () => {
  const result = {
    ok: true,
    operation: "listing.create",
    remoteState: {
      verified: true,
      visibility: "non_public",
      providerStatus: "SUSPENSION",
      verifiedAt: "2026-08-29T20:00:00.000Z",
      evidence: {
        identityVerified: true,
        statusVerified: true,
        localeVerified: true,
        fingerprintVerified: true,
        imageCountVerified: true,
      },
      resources: { originProductNo: "origin-product-123" },
      locale: "ko-KR",
      fingerprint: "2".repeat(64),
      imageCount: 8,
    },
  };

  assert.equal(gatewayJobCompletionStatusAtJobBoundary(
    "succeeded",
    result,
    "2026-08-29T20:00:00.000Z",
  ), "succeeded");
  assert.equal(gatewayJobCompletionStatusAtJobBoundary(
    "succeeded",
    result,
    "2026-08-29T20:00:00.001Z",
  ), "reconciliation_required");
  assert.equal(gatewayJobCompletionStatusAtJobBoundary(
    "succeeded",
    result,
    null,
  ), "reconciliation_required");
  assert.equal(gatewayJobCompletionStatusAtJobBoundary(
    "succeeded",
    { ok: false, operation: "listing.create" },
    "2026-08-29T20:00:00.001Z",
  ), "succeeded", "definite provider rejection keeps the existing retry path");
  assert.equal(gatewayJobCompletionStatusAtJobBoundary(
    "succeeded",
    { ok: true, operation: "orders.list" },
    null,
  ), "succeeded", "non-listing completion remains backward compatible");
  assert.equal(gatewayJobCompletionStatusAtJobBoundary(
    "failed",
    result,
    "2026-08-29T20:00:00.001Z",
  ), "failed");
});
