import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("workbench does not expose the unresolved Qoo10 partial-effect tuple as writable", () => {
  const workbench = readFileSync(
    new URL("../app/product-publish-workbench.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    workbench,
    /const unresolvedPartialEffect = qoo10ExactLocalizationLedgerCandidate\(/u,
  );
  assert.match(
    workbench,
    /const unresolvedPartialEffect = qoo10ExactLocalizationRequestCandidate\(/u,
  );
  assert.match(
    workbench,
    /return Boolean\(unresolvedPartialEffect[\s\S]{0,180}failureClass !== "external_action"[\s\S]{0,180}remoteVisibility !== "unknown"\)/u,
  );
  assert.doesNotMatch(workbench, /return qoo10ExactLocalizationLedgerCandidate\(/u);
  assert.doesNotMatch(workbench, /return qoo10ExactLocalizationRequestCandidate\(/u);
});

test("channel operation stops the unresolved Qoo10 tuple before permit or provider handoff", () => {
  const route = readFileSync(
    new URL("../app/api/admin/channel-operations/route.ts", import.meta.url),
    "utf8",
  );
  const exactListingSelection = route.indexOf(
    "qoo10ExactLocalizationRequestCandidateFromLedger({",
  );
  const reconciliationFence = route.indexOf(
    'mode: "qoo10_exact_partial_manual_reconciliation_required"',
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
  assert.ok(reconciliationFence > exactListingSelection);
  assert.ok(serverBinding > reconciliationFence);
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
