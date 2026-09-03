import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  lazadaExactRemoteEditReadinessBlock,
} from "../lib/channels/lazada-exact-remote-edit-readiness";

const listingId = "42021335-9793-4834-8cd5-b73169fd1f48";
const productId = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const credentialId = "11111111-1111-4111-8111-111111111111";
const targetId = "200100300";
const sellerAccountKey = "a".repeat(64);
const lineageAttestationId = "22222222-2222-4222-8222-222222222222";

function preparation(status: "ready" | "already_bound" | "manual_required") {
  return { status, listing_id: listingId, channel: "lazada", market: "MY" };
}

function providerIdentity(overrides: Record<string, unknown> = {}) {
  return {
    contract: "lazada_exact_existing_my_live_update_v1",
    productId,
    listingId,
    credentialId,
    itemId: "14976038919",
    sellerSku: "QA-20260823-CC-001-MY",
    sellerAccountKey,
    targetId,
    lineageAttestationId,
    lineageEvidenceDigest: "b".repeat(64),
    ...overrides,
  };
}

test("Lazada lineage manual_required and adoption-ready states remain fail-closed", () => {
  for (const status of ["manual_required", "ready"] as const) {
    const block = lazadaExactRemoteEditReadinessBlock({
      credentialId,
      targetId,
      preparationData: preparation(status),
      providerIdentityData: providerIdentity(),
    });
    assert.equal(block?.mode, "lazada_exact_lineage_adoption_required");
  }
});

test("Lazada blank target or provider identity without a seller key remains fail-closed", () => {
  const blankTarget = lazadaExactRemoteEditReadinessBlock({
    credentialId,
    targetId: "",
    preparationData: preparation("already_bound"),
    providerIdentityData: providerIdentity(),
  });
  const missingSellerKey = lazadaExactRemoteEditReadinessBlock({
    credentialId,
    targetId,
    preparationData: preparation("already_bound"),
    providerIdentityData: providerIdentity({ sellerAccountKey: null }),
  });
  assert.equal(blankTarget?.mode, "lazada_exact_lineage_adoption_required");
  assert.equal(missingSellerKey?.mode, "lazada_exact_provider_lineage_required");
});

test("Lazada provider identity mismatch and read failure remain fail-closed", () => {
  const mismatch = lazadaExactRemoteEditReadinessBlock({
    credentialId,
    targetId,
    preparationData: preparation("already_bound"),
    providerIdentityData: providerIdentity({ targetId: "999999999" }),
  });
  const unavailable = lazadaExactRemoteEditReadinessBlock({
    credentialId,
    targetId,
    preparationData: preparation("already_bound"),
    providerIdentityData: null,
    providerIdentityError: true,
  });
  assert.equal(mismatch?.mode, "lazada_exact_provider_lineage_required");
  assert.equal(unavailable?.mode, "lazada_exact_lineage_readiness_unavailable");
});

test("Lazada publish-context DTO needs no seller key when provider identity is attested", () => {
  const publishContextListing = {
    id: listingId,
    channel: "lazada",
    market: "MY",
    targetId,
    remoteId: "14976038919",
    status: "failed",
  };
  assert.equal("sellerAccountKey" in publishContextListing, false);
  assert.equal(lazadaExactRemoteEditReadinessBlock({
    credentialId,
    targetId: publishContextListing.targetId,
    preparationData: preparation("already_bound"),
    providerIdentityData: providerIdentity(),
  }), null);
});

test("Lazada null or non-object provider RPC payload is readiness unavailable", () => {
  for (const providerIdentityData of [null, "", []]) {
    const block = lazadaExactRemoteEditReadinessBlock({
      credentialId,
      targetId,
      preparationData: preparation("already_bound"),
      providerIdentityData,
      providerIdentityError: false,
    });
    assert.equal(block?.mode, "lazada_exact_lineage_readiness_unavailable");
  }
});

test("remote-edit GET wires both authoritative Lazada lineage RPCs before availability", () => {
  const route = readFileSync(
    new URL("../app/api/admin/products/[id]/remote-edit/route.ts", import.meta.url),
    "utf8",
  );
  const prepare = route.indexOf('"sellerpilot_service_prepare_exact_lazada_live_adoption"');
  const providerIdentity = route.indexOf('"sellerpilot_service_get_lazada_exact_update_id"');
  const readiness = route.indexOf("exactLazadaReadinessBlock = lazadaExactRemoteEditReadinessBlock");
  const availability = route.indexOf("listing.id === exactLazadaListing?.id");
  assert.ok(prepare >= 0);
  assert.ok(providerIdentity > prepare);
  assert.ok(readiness > providerIdentity);
  assert.ok(availability > readiness);
  assert.doesNotMatch(route, /exactLazadaListing\.sellerAccountKey/u);
});
