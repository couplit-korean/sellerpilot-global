import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const heartbeatRouteUrl = new URL("../app/api/ai/worker/heartbeat/route.ts", import.meta.url);
const completionRouteUrl = new URL("../app/api/ai/worker/complete/route.ts", import.meta.url);

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
  assert.match(source, /sellerpilot-cli-worker\/1\.18/);
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
});
