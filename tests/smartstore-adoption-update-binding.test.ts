import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  bindSmartstoreManualAdoptionUpdateArguments,
  hasClientSmartstoreManualAdoptionUpdateMarker,
  isSmartstoreManualAdoptionListing,
  readSmartstoreManualAdoptionUpdateBinding,
  SmartstoreManualAdoptionUpdateBindingError,
  smartstoreManualAdoptionUpdateArgument,
} from "../lib/server-smartstore-adoption-update-binding";

const ids = {
  actor: "10000000-0000-4000-8000-000000000001",
  product: "20000000-0000-4000-8000-000000000002",
  listing: "30000000-0000-4000-8000-000000000003",
  sourceJob: "40000000-0000-4000-8000-000000000004",
  sourceAttempt: "50000000-0000-4000-8000-000000000005",
  credential: "60000000-0000-4000-8000-000000000006",
  receipt: "70000000-0000-4000-8000-000000000007",
  attestation: "80000000-0000-4000-8000-000000000008",
};
const originProductNo = "13688607602";
const channelProductNo = "13749310594";
const sellerSku = "AUTO-SMARTSTORE-001";
const contentSha256 = "a".repeat(64);
const manifestDigest = "b".repeat(64);

function listing() {
  return {
    id: ids.listing,
    channel: "smartstore",
    status: "published",
    requestedPublicationIntent: "live",
    remoteVisibility: "live",
    remoteId: originProductNo,
    marketplaceSku: sellerSku,
    remoteResources: {
      resources: {
        originProductNo,
        smartstoreChannelProductNo: channelProductNo,
        sellerManagementCode: sellerSku,
      },
      verification: {
        contract: "smartstore_manual_adoption_verified_v1",
        provenance: "manual_adoption_verified",
        receiptId: ids.receipt,
        attestationId: ids.attestation,
        sourceJobId: ids.sourceJob,
        sourceAttemptId: ids.sourceAttempt,
        approvalRevision: 1,
        contentSha256,
        manifestDigest,
        apiCreateSucceeded: false,
        providerMutationPerformed: false,
      },
    },
  };
}

function preparation(overrides: Record<string, unknown> = {}) {
  return {
    contract: "smartstore_manual_adoption_prepare_v1",
    status: "already_verified",
    reason: null,
    productId: ids.product,
    listingId: ids.listing,
    sourceJobId: ids.sourceJob,
    sourceAttemptId: ids.sourceAttempt,
    credentialId: ids.credential,
    sellerSku,
    originProductNo,
    channelProductNo,
    approvalRevision: 1,
    contentSha256,
    manifestDigest,
    receiptId: ids.receipt,
    attestationId: ids.attestation,
    provenance: "manual_adoption_verified",
    remoteCreationOriginAsserted: false,
    apiCreateSucceeded: false,
    providerMutationPerformed: false,
    contentVerified: true,
    normalUpdateEligible: true,
    normalUpdateEligibilityScope: "database_linkage_only",
    publicationGateOpenAsserted: false,
    reused: true,
    ...overrides,
  };
}

function serviceClient(data: unknown, error: unknown = null) {
  return {
    rpc: async () => ({ data, error }),
  } as unknown as SupabaseClient;
}

test("server derives the exact Smartstore update marker from the current verified adoption", async () => {
  const currentListing = listing();
  assert.equal(isSmartstoreManualAdoptionListing(currentListing), true);
  const binding = await readSmartstoreManualAdoptionUpdateBinding({
    serviceClient: serviceClient(preparation()),
    actorId: ids.actor,
    productId: ids.product,
    credentialId: ids.credential,
    listing: currentListing,
  });
  assert.deepEqual(binding, {
    contract: "smartstore_manual_adoption_verified_v1",
    status: "verified",
    attestationId: ids.attestation,
    receiptId: ids.receipt,
    sourceJobId: ids.sourceJob,
    listingId: ids.listing,
    originProductNo,
    channelProductNo,
    sellerSku,
    approvalRevision: 1,
    contentSha256,
    manifestDigest,
  });
  const argumentsValue = bindSmartstoreManualAdoptionUpdateArguments(
    { originProductNo, body: { originProduct: { name: "수정 상품" } } },
    binding,
  );
  assert.deepEqual(argumentsValue[smartstoreManualAdoptionUpdateArgument], binding);
  assert.equal(argumentsValue.originProductNo, originProductNo);
});

test("a later update can rebind after ordinary readback replaces adoption remote resources", async () => {
  const afterFirstUpdate = {
    ...listing(),
    remoteResources: {
      resources: { originProductNo },
      readback: { contract: "verified_remote_state_v1" },
    },
  };
  assert.equal(isSmartstoreManualAdoptionListing(afterFirstUpdate), true);
  const binding = await readSmartstoreManualAdoptionUpdateBinding({
    serviceClient: serviceClient(preparation()),
    actorId: ids.actor,
    productId: ids.product,
    credentialId: ids.credential,
    listing: afterFirstUpdate,
  });
  assert.equal(binding?.attestationId, ids.attestation);
  assert.equal(binding?.originProductNo, originProductNo);
});

test("browser marker and stale listing, credential, or evidence tuple fail closed", async () => {
  assert.equal(hasClientSmartstoreManualAdoptionUpdateMarker({}), false);
  assert.equal(hasClientSmartstoreManualAdoptionUpdateMarker({
    [smartstoreManualAdoptionUpdateArgument]: null,
  }), true);
  assert.throws(() => bindSmartstoreManualAdoptionUpdateArguments({
    [smartstoreManualAdoptionUpdateArgument]: { forged: true },
  }, {
    contract: "smartstore_manual_adoption_verified_v1",
    status: "verified",
    attestationId: ids.attestation,
    receiptId: ids.receipt,
    sourceJobId: ids.sourceJob,
    listingId: ids.listing,
    originProductNo,
    channelProductNo,
    sellerSku,
    approvalRevision: 1,
    contentSha256,
    manifestDigest,
  }), (error: unknown) => error instanceof SmartstoreManualAdoptionUpdateBindingError
    && error.code === "SMARTSTORE_MANUAL_ADOPTION_CLIENT_MARKER_FORBIDDEN");

  const ordinaryListing = await readSmartstoreManualAdoptionUpdateBinding({
    serviceClient: serviceClient(preparation({
      status: "blocked",
      reason: "SOURCE_RECONCILIATION_REQUIRED",
      originProductNo: null,
      channelProductNo: null,
      receiptId: null,
      attestationId: null,
      provenance: null,
      contentVerified: false,
      normalUpdateEligible: false,
      reused: false,
    })),
    actorId: ids.actor,
    productId: ids.product,
    credentialId: ids.credential,
    listing: listing(),
  });
  assert.equal(ordinaryListing, null);

  for (const [label, prepared, currentListing, credentialId] of [
    ["credential", preparation(), listing(), "90000000-0000-4000-8000-000000000009"],
    ["remote id", preparation(), { ...listing(), remoteId: "99999999999" }, ids.credential],
  ] as const) {
    await assert.rejects(
      readSmartstoreManualAdoptionUpdateBinding({
        serviceClient: serviceClient(prepared),
        actorId: ids.actor,
        productId: ids.product,
        credentialId,
        listing: currentListing,
      }),
      SmartstoreManualAdoptionUpdateBindingError,
      label,
    );
  }
});

test("both update entry points reject client markers and channel flow injects before fingerprint and claim", () => {
  const channelRoute = readFileSync(
    new URL("../app/api/admin/channel-operations/route.ts", import.meta.url),
    "utf8",
  );
  const remoteEditRoute = readFileSync(
    new URL("../app/api/admin/products/[id]/remote-edit/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(channelRoute, /hasClientSmartstoreManualAdoptionUpdateMarker\(parsed\.data\.arguments\)/u);
  assert.match(remoteEditRoute, /hasClientSmartstoreManualAdoptionUpdateMarker\(body\.data\.arguments\)/u);
  const serverRead = channelRoute.indexOf("readSmartstoreManualAdoptionUpdateBinding({");
  const serverBind = channelRoute.indexOf("bindSmartstoreManualAdoptionUpdateArguments(");
  const fingerprint = channelRoute.indexOf("const baseRequestFingerprint = createHash");
  const claim = channelRoute.indexOf('userClient.rpc("sellerpilot_claim_channel_operation"');
  assert.ok(serverRead > 0 && serverRead < serverBind);
  assert.ok(serverBind < fingerprint);
  assert.ok(fingerprint < claim);
  assert.doesNotMatch(remoteEditRoute, /sellerpilotSmartstoreManualAdoption\s*:/u);
});
