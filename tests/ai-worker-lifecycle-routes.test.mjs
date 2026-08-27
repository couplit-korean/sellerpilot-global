import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const heartbeatRouteUrl = new URL("../app/api/ai/worker/heartbeat/route.ts", import.meta.url);
const completionRouteUrl = new URL("../app/api/ai/worker/complete/route.ts", import.meta.url);
const uploadAuthorizationRouteUrl = new URL("../app/api/ai/worker/result-upload-authorize/route.ts", import.meta.url);
const claimRouteUrl = new URL("../app/api/ai/worker/claim/route.ts", import.meta.url);
const uploadAuthorizationMigrationUrl = new URL("../supabase/migrations/20260827000726_authorize_live_ai_result_uploads.sql", import.meta.url);

function assertResilientWorkerRoute(source) {
  assert.match(source, /if \(!workerToken\.startsWith\("spw_"\) \|\| workerToken\.length < 24\)/);
  assert.match(source, /if \(!supabaseUrl \|\| !secretKey\)/);
  assert.match(source, /workerRpcErrorMessage\(503\)/);
  assert.match(source, /global: \{ fetch: createBoundedSupabaseFetch\(\) \}/);
  assert.doesNotMatch(source, /!workerToken\.startsWith\("spw_"\)[^\n]+!supabaseUrl/);
}

test("AI heartbeat keeps authentication, server configuration, and transient RPC failures distinct", async () => {
  const source = await readFile(heartbeatRouteUrl, "utf8");

  assertResilientWorkerRoute(source);
  assert.match(source, /const status = workerRpcErrorStatus\(error\)/);
  assert.match(source, /workerRpcErrorMessage\(status\)/);
  assert.match(source, /AI 작업을 찾지 못했습니다[^\n]+status: 404/);
  assert.match(source, /data !== "running"[\s\S]*status: 409/);
  assert.match(source, /claimToken: z\.string\(\)\.uuid\(\)/);
  assert.match(source, /p_claim_token: parsed\.data\.claimToken/);
  assert.match(source, /p_worker_version: parsed\.data\.version \?\? "sellerpilot-cli-worker\/unknown"/);
  assert.doesNotMatch(source, /supportsLiveResultUploadAuthorization|minimumResultUploadWorkerVersion/);
});

test("AI completion bounds Supabase calls and maps both lifecycle RPC failures", async () => {
  const source = await readFile(completionRouteUrl, "utf8");

  assertResilientWorkerRoute(source);
  assert.equal((source.match(/workerRpcErrorStatus\(/g) ?? []).length, 2);
  assert.equal((source.match(/workerRpcErrorMessage\(status\)/g) ?? []).length, 2);
  assert.match(source, /완료 응답 형식이 올바르지 않습니다/);
  assert.match(source, /실행 중인 작업과 완료 요청이 일치하지 않습니다[^\n]+status: 409/);
  assert.match(source, /p_claim_token: completion\.claimToken/);
  assert.match(source, /aiGeneratedAssetPath\(completion\.jobId, asset, completion\.claimToken\)/);
  assert.match(source, /const payload = normalizeWorkerCompletionPayload\(receivedPayload\)/);
  assert.match(source, /normalizeStudioResultForTerminalValidation\(result\)/);
  assert.ok(
    source.indexOf("normalizeWorkerCompletionPayload(receivedPayload)")
      < source.indexOf("workerCompletionSchema.safeParse(payload)"),
    "studio results must be normalized before terminal schema validation",
  );
  assert.ok(
    source.indexOf("workerCompletionSchema.safeParse(payload)")
      < source.indexOf('serviceClient.rpc("sellerpilot_complete_ai_job"'),
    "normalized studio results must be schema-validated before DB storage",
  );
});

test("AI result upload authorization signs only an exact live claim path", async () => {
  const [source, claimSource, migration] = await Promise.all([
    readFile(uploadAuthorizationRouteUrl, "utf8"),
    readFile(claimRouteUrl, "utf8"),
    readFile(uploadAuthorizationMigrationUrl, "utf8"),
  ]);

  assertResilientWorkerRoute(source);
  assert.match(source, /authorizationSchema[\s\S]*jobId: z\.string\(\)\.uuid\(\)/);
  assert.match(source, /claimToken: z\.string\(\)\.uuid\(\)/);
  assert.match(source, /assetId: z\.enum\(aiGeneratedAssetIds\)/);
  assert.match(source, /\.strict\(\)/);
  assert.match(source, /aiGeneratedAssetPath\(parsed\.data\.jobId, asset, parsed\.data\.claimToken\)/);
  assert.match(source, /sellerpilot_service_authorize_ai_result_upload/);
  assert.match(source, /p_asset_id: asset\.id/);
  assert.match(source, /p_path: path/);
  assert.match(source, /staged !== true[\s\S]*status: 409/);
  assert.match(source, /createSignedUploadUrl\(path, \{ upsert: true \}\)/);
  assert.ok(source.indexOf("staged !== true") < source.indexOf("createSignedUploadUrl"));
  assert.match(source, /cache-control": "no-store, max-age=0"/);
  assert.doesNotMatch(source, /parsed\.data\.(?:path|bucket)/);
  assert.doesNotMatch(claimSource, /createSignedUploadUrl/);
  assert.doesNotMatch(claimSource, /token: upload\.token/);
  assert.match(claimSource, /supportsLiveResultUploadAuthorization\(version\)/);
  assert.ok(
    claimSource.indexOf("supportsLiveResultUploadAuthorization(version)")
      < claimSource.indexOf('serviceClient.rpc("sellerpilot_claim_ai_job"'),
  );
  assert.match(migration, /token\.scope in \('ai', 'legacy_combined'\)/);
  assert.match(migration, /job\.status = 'running'/);
  assert.match(migration, /job\.worker_token_id = v_token_id/);
  assert.match(migration, /job\.claim_token = p_claim_token/);
  assert.match(migration, /job\.lease_expires_at > clock_timestamp\(\)/);
  assert.match(migration, /v_kind = 'product_studio'/);
  assert.match(migration, /v_kind = 'product_asset_regeneration'[\s\S]*v_request->>'asset_id' = p_asset_id/);
  assert.match(migration, /else[\s\S]*return false/);
  assert.match(migration, /p_path <> v_expected_path then return false/);
  assert.match(migration, /for update/);
});
