import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260901173500_fence_exact_qoo10_adopted_localization_update.sql",
  import.meta.url,
);
const shortRpcMigrationUrl = new URL(
  "../supabase/migrations/20260901173680_expose_qoo10_adopted_localization_short_rpcs.sql",
  import.meta.url,
);

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const bodyStart = source.indexOf("as $$", start);
  assert.notEqual(bodyStart, -1);
  const end = source.indexOf("$$;", bodyStart + 5);
  assert.notEqual(end, -1);
  return source.slice(start, end + 3);
}

test("adopted localization arguments accept only the snapshot-bound content-only marker", async () => {
  const source = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  try {
    await db.exec("create schema sellerpilot_private");
    await db.exec(`
      create function sellerpilot_private.qoo10_exact_localization_v2_arguments_valid(
        arguments jsonb, release_sha text
      ) returns boolean language sql immutable as $$ select true $$;
    `);
    await db.exec(extractFunction(
      source,
      "create function sellerpilot_private.qoo10_exact_adopted_localization_arguments_valid(",
    ));
    const marker = {
      status: "allowed",
      contract: "qoo10_exact_adopted_live_localization_v1",
      sourceJobId: "fac9c5c4-940d-4600-88f3-8f97a069dfbf",
      observationSha256: "b".repeat(64),
      prewriteSnapshotSha256: "c".repeat(64),
    };
    const valid = await db.query(
      "select sellerpilot_private.qoo10_exact_adopted_localization_arguments_valid($1::jsonb,$2,$3,$4) value",
      [JSON.stringify({ sellerpilotQoo10AdoptedLocalization: marker, params: {} }), "a".repeat(40), "b".repeat(64), "c".repeat(64)],
    );
    assert.equal(valid.rows[0].value, true);
    for (const argumentsValue of [
      { sellerpilotQoo10AdoptedLocalization: { ...marker, observationSha256: "d".repeat(64) }, params: {} },
      { sellerpilotQoo10AdoptedLocalization: { ...marker, extra: true }, params: {} },
      { sellerpilotQoo10AdoptedLocalization: marker, params: { StandardImage: "https://example.test/image.jpg" } },
    ]) {
      const result = await db.query(
        "select sellerpilot_private.qoo10_exact_adopted_localization_arguments_valid($1::jsonb,$2,$3,$4) value",
        [JSON.stringify(argumentsValue), "a".repeat(40), "b".repeat(64), "c".repeat(64)],
      );
      assert.equal(result.rows[0].value, false);
    }
  } finally {
    await db.close();
  }
});

test("173500 is an exact one-shot permit and fresh-readback completion fence", async () => {
  const source = await readFile(migrationUrl, "utf8");
  for (const value of [
    "qoo10_exact_already_live_adoption_v1",
    "qoo10_adopted_localization_update_permit_v1",
    "sellerpilot_service_get_exact_qoo10_adopted_localization_identity",
    "sellerpilot_service_arm_exact_qoo10_adopted_localization_update",
    "prewrite_snapshot_sha256",
    "qoo10-exact-adopted-localization-postwrite-readback",
    "QOO10_EXACT_ADOPTED_S2_LOCALIZATION_VERIFIED",
  ]) assert.ok(source.includes(value), value);
  assert.match(source, /new\.status = 'failed'[\s\S]*sellerpilotNoWriteConfirmed[\s\S]*uncertain Qoo10 adopted localization must reconcile/u);
  assert.match(source, /new\.status = 'succeeded'[\s\S]*jsonb_array_length\(new\.response_payload->'steps'\) = 3[\s\S]*providerStatus[\s\S]*S2[\s\S]*visibility[\s\S]*live/u);

  const arm = extractFunction(
    source,
    "create function public.sellerpilot_service_arm_exact_qoo10_adopted_localization_update(",
  );
  assert.doesNotMatch(arm, /insert into sellerpilot_private\.channel_gateway_jobs/iu);
  assert.doesNotMatch(arm, /EditGoodsContents|UpdateGoods|EditGoodsStatus|fetch\s*\(/iu);
});

test("the API resolves the immutable adoption snapshot and arms its permit before claim", async () => {
  const route = await readFile(
    new URL("../app/api/admin/channel-operations/route.ts", import.meta.url),
    "utf8",
  );
  const identityIndex = route.indexOf(
    '"sellerpilot_service_get_qoo10_adopted_localization_identity"',
  );
  const armIndex = route.indexOf(
    '"sellerpilot_service_arm_qoo10_adopted_localization_update"',
  );
  const claimIndex = route.indexOf(
    '"sellerpilot_claim_channel_operation"',
  );
  assert.ok(identityIndex >= 0, "adoption identity RPC must be called");
  assert.ok(armIndex > identityIndex, "permit must follow the immutable identity read");
  assert.ok(claimIndex > armIndex, "the provider job claim must follow the one-shot permit");
});

test("the adopted route rebuilds server-owned commerce and markers before the exact enqueue payload", async () => {
  const route = await readFile(
    new URL("../app/api/admin/channel-operations/route.ts", import.meta.url),
    "utf8",
  );
  const stripExactMarker = route.indexOf(
    "delete effectiveArguments[qoo10ExactLocalizationUpdateArgument]",
  );
  const stripAdoptedMarker = route.indexOf(
    "delete effectiveArguments[qoo10ExactAdoptedLocalizationArgument]",
  );
  const bindCommerce = route.indexOf(
    "effectiveArguments = bindQoo10ExactAdoptedCommerceArguments(effectiveArguments)",
  );
  const bindExactMarker = route.indexOf(
    "effectiveArguments = bindQoo10ExactLocalizationUpdateArguments(",
  );
  const fingerprint = route.indexOf("const manifestFingerprintArguments =");
  const armPermit = route.indexOf(
    '"sellerpilot_service_arm_qoo10_adopted_localization_update"',
  );
  const bindAdoptedMarker = route.indexOf(
    "effectiveArguments = bindQoo10ExactAdoptedLocalizationArguments(",
  );
  const enqueue = route.indexOf("const gatewayExecution = await executeViaChannelGateway({");

  assert.ok(stripExactMarker >= 0 && stripAdoptedMarker > stripExactMarker);
  assert.ok(bindCommerce > stripAdoptedMarker);
  assert.ok(bindExactMarker > bindCommerce);
  assert.ok(fingerprint > bindExactMarker);
  assert.ok(armPermit > fingerprint);
  assert.ok(bindAdoptedMarker > armPermit);
  assert.ok(enqueue > bindAdoptedMarker);
});

test("the adopted-localization RPCs use exact PostgREST-safe names and fail closed by cause", async () => {
  const migration = await readFile(shortRpcMigrationUrl, "utf8");
  const route = await readFile(
    new URL("../app/api/admin/channel-operations/route.ts", import.meta.url),
    "utf8",
  );
  const identityRpc =
    "sellerpilot_service_get_qoo10_adopted_localization_identity";
  const armRpc =
    "sellerpilot_service_arm_qoo10_adopted_localization_update";
  assert.equal(Buffer.byteLength(identityRpc, "utf8"), 59);
  assert.equal(Buffer.byteLength(armRpc, "utf8"), 57);
  for (const value of [
    identityRpc,
    armRpc,
    "sellerpilot_service_get_exact_qoo10_adopted_localization_identi",
    "sellerpilot_service_arm_exact_qoo10_adopted_localization_update",
    "68aabb874e63e8ebf690b86f9f8fe324d33729edbb7dd26678d5a02fa8486f86",
    "194611a4d9a74a4797644bbc66c1793b6614a2a3edd33500656de4011d579aad",
    "from public, anon, authenticated, service_role",
    "notify pgrst, 'reload schema'",
  ]) assert.ok(migration.includes(value), value);
  assert.match(
    migration,
    /alter function[\s\S]*sellerpilot_service_get_exact_qoo10_adopted_localization_identi[\s\S]*rename to sellerpilot_service_get_qoo10_adopted_localization_identity/u,
  );
  assert.match(
    migration,
    /alter function[\s\S]*sellerpilot_service_arm_exact_qoo10_adopted_localization_update[\s\S]*rename to sellerpilot_service_arm_qoo10_adopted_localization_update/u,
  );
  assert.match(route, new RegExp(`serviceClient\\.rpc\\(\\s*"${identityRpc}"`, "u"));
  assert.match(route, new RegExp(`serviceClient\\.rpc\\(\\s*"${armRpc}"`, "u"));
  assert.doesNotMatch(
    route,
    /serviceClient\.rpc\(\s*"sellerpilot_service_(?:get|arm)_exact_qoo10_adopted_localization/u,
  );
  const unavailable = route.indexOf(
    'mode: "qoo10_exact_adopted_localization_identity_unavailable"',
  );
  const identityRequired = route.indexOf(
    'mode: "qoo10_exact_adopted_localization_identity_required"',
  );
  assert.ok(unavailable >= 0);
  assert.ok(identityRequired > unavailable);
  assert.match(
    route.slice(unavailable - 320, unavailable + 240),
    /if \(identityError\)[\s\S]*status: 503/u,
  );
  assert.match(
    route.slice(identityRequired - 320, identityRequired + 240),
    /if \(!identity\.success\)[\s\S]*status: 409/u,
  );
});
