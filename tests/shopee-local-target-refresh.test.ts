import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as crypto from "node:crypto";
import * as contract from "../lib/channels/gateway-contract";
import { processCsGatewayJob } from "../scripts/cs-gateway-job.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const claim = "22222222-2222-4222-8222-222222222222";
const target = { channel: "shopee", targetType: "shop", targetId: "1234567" };
const source = await readFile(new URL("../app/api/channel-gateway/worker/credential-refresh/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
async function route(body: unknown, busy = false) {
  const calls: Array<{name:string; args: Record<string, unknown>}> = [];
  const sandbox = vm.createContext({ exports: {}, Request, Response, console,
    process: { env: { SUPABASE_SECRET_KEY: "fixture-secret" } }, require(name: string) {
      if (name === "node:crypto") return crypto;
      if (name === "next/server") return { NextResponse: Response };
      if (name.endsWith("/gateway-contract")) return contract;
      if (name.endsWith("/supabase/config")) return { supabaseUrl: "https://fixture.test" };
      if (name.endsWith("/worker-rpc")) return { createBoundedSupabaseFetch: () => fetch, workerRpcErrorStatus: () => 503, workerRpcErrorMessage: () => "unavailable" };
      if (name === "@supabase/supabase-js") return { createClient: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({name,args});
        const data = name.includes("begin_cs_shopee") ? { contract: "sellerpilot-shopee-target-refresh-claim/1", status: busy ? "busy" : "acquired" }
          : name.includes("prepare_cs_shopee") ? { status: "prepared", credential_id: id }
          : name.includes("begin_gateway") ? true : null;
        return {data,error:null};
      } }) };
      throw new Error(`unexpected import ${name}`);
    } });
  vm.runInContext(compiled, sandbox);
  const response = await sandbox.exports.POST(new Request("https://fixture.test/api/channel-gateway/worker/credential-refresh", {
    method: "POST", headers: { authorization: "Bearer spw_fixture_worker_token_123456789" }, body: JSON.stringify(body),
  })) as Response;
  return { response, calls };
}

test("Mac CS lifecycle retains shop target through begin, stage schema and API RPC", async () => {
  const requests: Record<string, unknown>[] = [];
  await processCsGatewayJob({ id,claim_token:claim,channel:"shopee",operation:"inquiries.list",credential:{},request:{arguments:{}} }, {
    createGatewayHeartbeat: () => ({ start:async()=>{},assertHealthy:async()=>{},stop:async()=>{} }),
    persistWorkerCompletion: async (_path: string, body: Record<string, unknown>) => { requests.push(body); return Response.json({ status:"prepared" }); },
    reserveProviderRequest: async()=>{},
    executeProvider: async ({hooks}: any) => {
      await hooks.beginCredentialMutation(target);
      await hooks.stageCredentialRefresh({ payload:{access_token:"fixture-access"}, expiresAt:null, target });
      throw new Error("SYNTHETIC_READ_FAILURE");
    },
  });
  const begin = requests.find(row=>row.action==="begin")!;
  const stage = requests.find(row=>row.action==="stage")!;
  assert.deepEqual(contract.gatewayCredentialRefreshLifecycleSchema.parse(begin).target, target);
  const started = await route(begin);
  assert.equal(started.response.status,200);
  assert.equal(started.calls[0].name,"sellerpilot_service_begin_cs_shopee_target_refresh_v1");
  assert.equal(started.calls[0].args.p_target_id,target.targetId);
  const staged = await route(stage);
  assert.equal(staged.response.status,200);
  assert.equal(staged.calls[0].name,"sellerpilot_service_prepare_cs_shopee_target_refresh_v1");
  assert.equal(staged.calls[0].args.p_target_type,"shop");
  assert.deepEqual(staged.calls[0].args.p_candidate_payload,{access_token:"fixture-access"});
  assert.equal("p_secret_payload" in staged.calls[0].args,false);
});
test("busy shop lock is rejected before provider mutation; unbound legacy begin stays compatible", async()=>{
  const rejected=await route({action:"begin",jobId:id,claimToken:claim,target},true);
  assert.equal(rejected.response.status,409);
  const legacy=await route({action:"begin",jobId:id,claimToken:claim});
  assert.equal(legacy.response.status,200);
  assert.equal(legacy.calls[0].name,"sellerpilot_service_begin_gateway_credential_refresh");
});
test("malformed or wrong-channel local target cannot reach credential RPC", async()=>{
  for (const invalid of [{...target,channel:"lazada"},{...target,targetId:"0"},{...target,targetId:"1.1"}]) {
    const result=await route({action:"begin",jobId:id,claimToken:claim,target:invalid});
    assert.equal(result.response.status,400);assert.equal(result.calls.length,0);
  }
});
