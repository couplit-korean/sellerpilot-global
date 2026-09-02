import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { temuImmutableListingIdentityFromPublishContext } from "../lib/channels/provider-temu-publication-readback";

const routeUrl = new URL(
  "../app/api/admin/channel-operations/route.ts",
  import.meta.url,
);

test("admin listing mutations require an exact open release gate before idempotency claim", async () => {
  const route = await readFile(routeUrl, "utf8");
  const fingerprintIndex = route.indexOf('const baseRequestFingerprint = createHash("sha256")');
  const releaseGateIndex = route.indexOf(
    '"sellerpilot_service_listing_mutation_release_gate_status"',
  );
  const claimIndex = route.indexOf('"sellerpilot_claim_channel_operation"');

  assert.ok(fingerprintIndex >= 0, "the exact request fingerprint must be bound");
  assert.ok(
    releaseGateIndex > fingerprintIndex,
    "the gate read must evaluate the final normalized listing request",
  );
  assert.ok(
    claimIndex > releaseGateIndex,
    "a closed or unavailable gate must not create an idempotency attempt",
  );
  assert.match(
    route,
    /listingOperationRequiresVerifiedRemoteState\(operation\)[\s\S]{0,260}serviceClient\.rpc\([\s\S]{0,120}sellerpilot_service_listing_mutation_release_gate_status/,
  );
  assert.match(
    route,
    /releaseGateStatus\.contract === "verified_publication_release_gate_v1"/,
  );
  assert.match(
    route,
    /releaseGateStatus\.open === true[\s\S]{0,180}releaseGateStatus\.state === "open"/,
  );
  assert.match(route, /typeof releaseGateStatus\.effectiveOpen === "boolean"/);
  assert.match(route, /resolveRuntimeReleaseIdentity\(\)/);
  assert.match(
    route,
    /releaseGateStatus\.openedRelease === runtimeRelease\.release[\s\S]{0,160}releaseGateStatus\.attestedRelease === runtimeRelease\.release/,
  );
  assert.match(
    route,
    /releaseGateStatus\.activeRuntimeRelease === runtimeRelease\.release/,
  );
  assert.match(
    route,
    /releaseGateStatus\.openedChannel === "qoo10"[\s\S]{0,260}releaseGateStatus\.qoo10AttestedRelease === runtimeRelease\.release/,
  );
  assert.match(
    route,
    /channel === "qoo10"[\s\S]{0,180}releaseGateStatus\.qoo10EffectiveOpen === true/,
  );
  assert.match(route, /mode: "listing_mutation_release_gate_unavailable"/);
  assert.match(route, /mode: "listing_mutation_release_gate_closed"/);
  assert.match(
    route,
    /listing_mutation_release_gate_unavailable[\s\S]{0,180}status: 503[\s\S]{0,180}cache-control/,
  );
  assert.match(
    route,
    /listing_mutation_release_gate_closed[\s\S]{0,180}status: 503[\s\S]{0,180}cache-control/,
  );
});

test("scoped and exact permits cannot authorize any unrelated channel mutation", async () => {
  const route = await readFile(routeUrl, "utf8");

  assert.match(
    route,
    /const verifiedPublicationReleaseChannels = new Set\(\[\s*"qoo10",\s*"shopee",\s*"lazada",\s*"coupang",\s*"elevenst",\s*"smartstore",\s*"ebay",\s*"temu",\s*\]\)/,
  );
  assert.match(
    route.match(/const verifiedPublicationReleaseChannels = new Set\(\[[\s\S]*?\]\);/)?.[0] ?? "",
    /temu/,
  );
  assert.match(route, /const qoo10ScopedReleaseGateIsExact/);
  assert.match(route, /releaseGateStatus\.openedChannel === "qoo10"/);
  assert.match(
    route,
    /const channelReleaseGateIsEffective = verifiedPublicationReleaseChannels\.has\(channel\)/,
  );
  assert.match(
    route,
    /: channel === "qoo10"[\s\S]{0,180}&& qoo10ScopedReleaseGateIsExact[\s\S]{0,180}&& releaseGateStatus\.qoo10EffectiveOpen === true\)/,
  );
  const closedGateGuard = route.match(
    /if \(!channelReleaseGateIsEffective\s*&& !qoo10ExactLocalizationUpdatePermitArmed\s*&& !smartstoreExactQaUpdatePermitArmed\s*&& !exactExistingUpdatePermitArmed\s*&& !shopeeSgExistingUpdatePermitArmed\)/,
  );
  assert.ok(
    closedGateGuard,
    "closed gate must admit only separately armed exact Qoo10, Smartstore, Shopee, or exact existing-update permits",
  );
  assert.ok(
    (closedGateGuard.index ?? Number.POSITIVE_INFINITY)
      < route.indexOf('"sellerpilot_claim_channel_operation"'),
    "generic requests must fail before idempotency claim under the scoped gate",
  );
});

test("Temu stop and activation bind goodsId and externalGoodsId from the immutable listing ledger", async () => {
  const [route, gateway] = await Promise.all([
    readFile(routeUrl, "utf8"),
    readFile(new URL("../lib/channels/gateway.ts", import.meta.url), "utf8"),
  ]);

  assert.match(
    route,
    /channel === "temu" && \(operation === "listing\.stop" \|\| operation === "listing\.activate"\)[\s\S]*?temuImmutableListingIdentityFromPublishContext\([\s\S]*?exactListing,[\s\S]*?requestedRemoteId[\s\S]*?temu_immutable_identity_required/,
  );
  assert.match(
    route,
    /effectiveArguments = \{[\s\S]*?\.\.\.effectiveArguments,[\s\S]*?\.\.\.boundTemuListingIdentity,[\s\S]*?\};/,
  );
  assert.match(route, /sellerpilot_service_get_temu_activation_context/);
  assert.match(route, /activationRecord\.claimIdempotencyKey/);
  assert.match(
    route,
    /p_idempotency_key: channel === "temu" && operation === "listing\.activate"[\s\S]*?temuActivationClaimIdempotencyKey![\s\S]*?: parsed\.data\.idempotencyKey/,
  );
  assert.match(gateway, /sellerpilot_service_enqueue_temu_activation/);
  assert.match(
    route,
    /channel === "temu" && \[[\s\S]*?"listing\.activate"[\s\S]*?\]\.includes\(operation\)[\s\S]*?sellerpilot_service_serverless_static_egress_status/,
  );
});

test("Temu stop reads the canonical nested publish-context identity and rejects flattened lookalikes", () => {
  const canonicalListing = {
    id: "30000000-0000-4000-8000-000000000001",
    channel: "temu",
    remoteId: "90000001",
    remoteResources: {
      resources: {
        goodsId: "90000001",
        externalGoodsId: "TEMU-KR-STRICT-001",
      },
      verification: {
        locale: "ko-KR",
        imageCount: 8,
      },
    },
  };
  assert.deepEqual(
    temuImmutableListingIdentityFromPublishContext(canonicalListing, "90000001"),
    { goodsId: "90000001", externalGoodsId: "TEMU-KR-STRICT-001" },
  );
  assert.equal(temuImmutableListingIdentityFromPublishContext({
    ...canonicalListing,
    remoteResources: {
      goodsId: "90000001",
      externalGoodsId: "TEMU-KR-STRICT-001",
    },
  }, "90000001"), null);
  assert.equal(temuImmutableListingIdentityFromPublishContext(canonicalListing, "90000002"), null);
});

test("eBay UPDATE resolves the immutable provider tuple before fingerprinting or claiming", async () => {
  const route = await readFile(routeUrl, "utf8");
  const identityReadIndex = route.indexOf(
    '"sellerpilot_service_get_ebay_listing_update_identity"',
  );
  const tupleBindingIndex = route.indexOf(
    "boundEbayListingIdentity = { offerId, sku, listingId, marketplaceId }",
  );
  const effectiveBindingIndex = route.indexOf(
    "...boundEbayListingIdentity",
  );
  const fingerprintIndex = route.indexOf('const baseRequestFingerprint = createHash("sha256")');
  const claimIndex = route.indexOf('"sellerpilot_claim_channel_operation"');

  assert.ok(identityReadIndex >= 0, "eBay UPDATE must resolve its server-owned tuple");
  assert.ok(tupleBindingIndex > identityReadIndex, "only the verified RPC result may bind the tuple");
  assert.ok(effectiveBindingIndex > tupleBindingIndex, "the verified tuple must replace browser identities");
  assert.ok(fingerprintIndex > effectiveBindingIndex, "the request fingerprint must cover the immutable tuple");
  assert.ok(claimIndex > fingerprintIndex, "a missing tuple must fail before an idempotency attempt exists");
  assert.match(route, /identity\.contract !== "ebay_listing_identity_v1"/);
  assert.match(route, /listingId !== requestedRemoteId/);
  assert.match(route, /marketplaceId !== parsed\.data\.targetId\.toUpperCase\(\)/);
  assert.match(route, /mode: "ebay_immutable_identity_required"/);
});

test("Qoo10 rollback UPDATE independently confirms the S1 create rollback before fingerprinting or claiming", async () => {
  const route = await readFile(routeUrl, "utf8");
  const lineageIndex = route.indexOf('"sellerpilot_service_validate_listing_write_lineage"');
  const rollbackCandidateIndex = route.indexOf(
    "qoo10RollbackListingUpdateCandidate(channel, listingUpdateReferenceFromLedger(exactListing))",
  );
  const rollbackIdentityIndex = route.indexOf(
    '"sellerpilot_service_get_qoo10_rollback_update_identity"',
  );
  const fingerprintIndex = route.indexOf('const baseRequestFingerprint = createHash("sha256")');
  const claimIndex = route.indexOf('"sellerpilot_claim_channel_operation"');

  assert.match(route, /listingUpdateServerCandidate\(channel, listingUpdateReferenceFromLedger\(listing\)\)/);
  assert.ok(rollbackCandidateIndex > lineageIndex, "the existing seller lineage check must remain first");
  assert.ok(rollbackIdentityIndex > rollbackCandidateIndex, "only the exact rollback candidate may invoke the identity RPC");
  assert.ok(fingerprintIndex > rollbackIdentityIndex, "rollback identity must be confirmed before fingerprinting");
  assert.ok(claimIndex > fingerprintIndex, "a failed rollback identity check must not create an attempt");
  assert.match(route, /contract: z\.literal\("qoo10_create_rollback_confirmation_v1"\)/);
  assert.match(route, /providerStatus: z\.literal\("S1"\)/);
  assert.match(route, /sourceJobId: z\.string\(\)\.uuid\(\)/);
  assert.match(route, /identity\.data\.listingId !== resourceListingId/);
  assert.match(route, /identity\.data\.remoteId !== requestedRemoteId/);
  assert.match(route, /mode: "qoo10_rollback_identity_required"/);
});

test("Qoo10 recovery capability is server-bound, survives normalization, and preserves the S1 ledger on pre-gateway retry", async () => {
  const route = await readFile(routeUrl, "utf8");
  const clientMarkerDelete = route.indexOf("delete effectiveArguments[qoo10RollbackUpdateRecoveryArgument]");
  const authoritativeRecoveryBinding = route.indexOf(
    "effectiveArguments = bindQoo10RollbackUpdateRecoveryArguments(",
  );
  const fingerprintIndex = route.indexOf('const baseRequestFingerprint = createHash("sha256")');
  const imagePreparationIndex = route.indexOf("await prepareMarketplaceImages(serviceClient, channel, effectiveArguments");

  assert.ok(clientMarkerDelete >= 0, "the route must strip every browser-supplied recovery marker");
  assert.ok(authoritativeRecoveryBinding > clientMarkerDelete, "only the independently bound RPC result may recreate the marker and ShippingNo");
  assert.ok(fingerprintIndex > authoritativeRecoveryBinding, "the server capability and remote ShippingNo must be included in the claimed request fingerprint");
  assert.ok(imagePreparationIndex > fingerprintIndex, "the exact server capability must reach image preparation and gateway enqueue");
  assert.match(route, /if \(boundQoo10RollbackUpdateRecovery\) \{[\s\S]*bindQoo10RollbackUpdateRecoveryArguments\([\s\S]*contract: qoo10RollbackUpdateRecoveryContract/);
  assert.match(route, /effectiveArguments = \{[\s\S]*\.\.\.effectiveArguments,[\s\S]*\.\.\.boundEbayListingIdentity/);
  assert.doesNotMatch(route, /\.\.\.structuredClone\(parsed\.data\.arguments\),[\s\S]{0,120}\.\.\.boundEbayListingIdentity/);
  assert.match(
    route,
    /const preserveExactPreGatewayListing = preGatewayRetryable[\s\S]{0,220}boundQoo10RollbackUpdateRecovery[\s\S]{0,700}if \(!preserveExactPreGatewayListing\) \{[\s\S]{0,120}await completeListing\(\{ success: false/,
  );
});
