import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("workbench routes only the exact Qoo10 v2 tuple around the generic remote-edit proxy", () => {
  const workbench = readFileSync(
    new URL("../app/product-publish-workbench.tsx", import.meta.url),
    "utf8",
  );
  const exactCandidate = workbench.indexOf(
    "const exactQoo10LocalizationUpdate = qoo10ExactLocalizationWriteCandidate(",
  );
  const externalActionFence = workbench.indexOf(
    'listing?.failureClass === "external_action"',
    exactCandidate,
  );
  const remoteEditFetch = workbench.indexOf(
    "fetch(`/api/admin/products/${requestedProductId}/remote-edit`",
    externalActionFence,
  );
  const channelOperationFetch = workbench.indexOf(
    'fetch("/api/admin/channel-operations"',
    remoteEditFetch,
  );
  assert.ok(exactCandidate >= 0);
  assert.ok(externalActionFence > exactCandidate);
  assert.match(
    workbench.slice(externalActionFence, remoteEditFetch),
    /&& !exactQoo10LocalizationUpdate/u,
  );
  assert.match(
    workbench.slice(remoteEditFetch - 120, channelOperationFetch),
    /&& !exactQoo10LocalizationUpdate/u,
  );
  assert.ok(channelOperationFetch > remoteEditFetch);
  assert.match(
    workbench.slice(channelOperationFetch, channelOperationFetch + 1_500),
    /resourceListingId: listing\.id/u,
  );
  assert.match(
    workbench,
    /qoo10ExactLocalizationProductId: productId/u,
  );
});

test("channel operation rechecks the exact tuple and arms its permit before claim or provider handoff", () => {
  const route = readFileSync(
    new URL("../app/api/admin/channel-operations/route.ts", import.meta.url),
    "utf8",
  );
  const exactListingSelection = route.indexOf(
    "qoo10ExactLocalizationRequestCandidateFromLedger({",
  );
  const centralContract = route.indexOf(
    'mode: "qoo10_exact_localization_central_contract_required"',
  );
  const serverBinding = route.indexOf(
    "effectiveArguments = bindQoo10ExactLocalizationUpdateArguments(",
  );
  const permitArm = route.indexOf(
    '"sellerpilot_service_arm_exact_qoo10_localization_update"',
  );
  const claim = route.indexOf(
    'userClient.rpc("sellerpilot_claim_channel_operation"',
  );
  assert.ok(exactListingSelection >= 0);
  assert.ok(centralContract > exactListingSelection);
  assert.ok(serverBinding > centralContract);
  assert.ok(permitArm > serverBinding);
  assert.ok(claim > permitArm);
  assert.match(
    route,
    /listingUpdateServerCandidate\(channel, listingUpdateReferenceFromLedger\(listing\)\)[\s\S]{0,320}\|\| qoo10ExactLocalizationRequestCandidateFromLedger/u,
  );
  assert.match(
    route,
    /p_listing_id: parsed\.data\.resourceListingId[\s\S]{0,220}p_credential_id: parsed\.data\.credentialId[\s\S]{0,220}p_release_sha: runtimeRelease\.release[\s\S]{0,220}p_request_fingerprint: requestFingerprint/u,
  );
});
