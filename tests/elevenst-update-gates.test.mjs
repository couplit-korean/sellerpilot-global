import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const qaRemoteId = "9573255804";

test("11st update route binds the trusted snapshot RPC to listing, credential, and exact remote ID", async () => {
  const route = await readFile(
    new URL("../app/api/admin/channel-operations/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /sellerpilot_service_get_elevenst_listing_snapshot/);
  assert.match(route, /p_listing_id:\s*parsed\.data\.resourceListingId!/);
  assert.match(route, /p_credential_id:\s*parsed\.data\.credentialId/);
  assert.match(route, /p_remote_id:\s*productNo/);
  assert.match(route, /mergeElevenstListingUpdateProduct\(snapshot\.product/);
  assert.match(route, /sellerpilotSnapshotMutableFingerprint/);
  assert.match(qaRemoteId, /^[1-9][0-9]{0,18}$/u);
});

test("11st provider execution requires exact GET identity and unchanged trusted mutable fingerprint before PUT", async () => {
  const operations = await readFile(
    new URL("../lib/channels/operations.ts", import.meta.url),
    "utf8",
  );
  const updateBranch = operations.slice(
    operations.indexOf('if (input.operation === "listing.update")', operations.indexOf("async function executeElevenst")),
    operations.indexOf('if (input.operation === "listing.stop")', operations.indexOf("async function executeElevenst")),
  );
  assert.match(updateBranch, /\/rest\/prodmarketservice\/prodmarket\/\$\{productNo\}/);
  assert.match(updateBranch, /beforeMutableFingerprint === snapshotMutableFingerprint/);
  assert.match(updateBranch, /if \(!beforeStep\.ok\) return/);
  assert.match(updateBranch, /method:\s*"PUT"[\s\S]*\/rest\/prodservices\/product\/\$\{productNo\}/);
  assert.ok(updateBranch.indexOf("if (!beforeStep.ok) return") < updateBranch.indexOf('method: "PUT"'));
});

test("11st serverless claim is fail-closed behind both DB policy and attested fixed-egress header", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260828210000_non_cs_release_integrity.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /\('elevenst', false\)/);
  assert.match(migration, /policy\.channel = p_channel[\s\S]*policy\.enabled/);
  assert.match(migration, /x-sellerpilot-static-egress-channels/);
  assert.match(
    migration,
    /job\.channel not in \('coupang', 'smartstore', 'elevenst', 'temu'\)[\s\S]*sellerpilot_private\.serverless_static_egress_allowed\(job\.channel\)/,
  );
});

test("11st update remains blocked while the publication release gate is closed", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260830110000_pending_publication_reverification.sql", import.meta.url),
    "utf8",
  );
  assert.match(
    migration,
    /update sellerpilot_private\.listing_mutation_release_gate gate[\s\S]*set is_open = false/,
  );
  assert.match(migration, /exact listing publication release required/);
  assert.match(migration, /all publication components must attest the exact release/);
  assert.match(migration, /active serverless runtime must match the exact release/);
  assert.match(migration, /listing mutation jobs must drain before release-gate activation/);
  assert.match(migration, /listing mutation reconciliations must be resolved before release-gate activation/);
});
