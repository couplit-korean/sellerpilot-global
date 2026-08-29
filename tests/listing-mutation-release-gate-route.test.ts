import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeUrl = new URL(
  "../app/api/admin/channel-operations/route.ts",
  import.meta.url,
);

test("admin listing mutations require an exact open release gate before idempotency claim", async () => {
  const route = await readFile(routeUrl, "utf8");
  const fingerprintIndex = route.indexOf('createHash("sha256")');
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
    /releaseGateStatus\.open !== true \|\| releaseGateStatus\.effectiveOpen !== true/,
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
