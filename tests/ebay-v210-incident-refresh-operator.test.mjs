import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtemp,rm,stat,readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {main} from "../scripts/ebay-v210-incident-refresh.mjs";
import {validateSource,validateConfirmedRefresh,writeConfirmedRefreshEvidence,readConfirmedRefreshEvidence} from "../scripts/ebay-exact-listing-read-refresh.mjs";
import {ebayDefaultScopes} from "../lib/channels/ebay-oauth-scopes.ts";

const sourceId="2ba31905-9879-44c4-88be-2204776fa303",incidentId="c9d6431c-5418-4649-9542-f30137309bf4";
const serviceKey="offline-fixture-service-key-not-a-credential";
const rpc="sellerpilot_service_store_ebay_v210_confirmed_refresh";
function source() {return {id:sourceId,version:210,status:"active",created_by:"21eb1892-0894-4f9f-b414-4c9464182dd6",channel:"ebay",environment:"production",seller_account_key_source:"provider_certified_v1",identity_verified:true,payload:{
  access_token:"fixture-expired-access",access_token_expires_at:new Date(Date.now()-3600000).toISOString(),refresh_token:"fixture-reusable-refresh",refresh_token_expires_at:"2099-01-01T00:00:00Z",
  client_id:"fixture-client",client_secret:"fixture-secret",ru_name:"fixture-ru",scopes:ebayDefaultScopes.join(" "),provider_account_identity_version:"v1",provider_account_subject:"ebay:eias:fixture-seller",
}};}
const next=s=>({...s.payload,access_token:"fixture-new-access",access_token_expires_at:new Date(Date.now()+7200000).toISOString(),ebay_user_id:"fixture-seller-name"});
const preflight={source_current:true,rpc_installed:true,running:0,incident_current:true};
const saved={credentialId:"01234567-89ab-4cde-8123-456789abcdef",version:211,sourceCredentialId:sourceId,preservedIncidentJobId:incidentId,automaticQueuedCredentialRebinds:2,inheritedLocalRoutes:0,forcedProviderJobsStarted:0,incidentPreserved:true};
async function sandbox(fn) {const directory=await mkdtemp("/private/tmp/sellerpilot-ebay-v210-test-");try{await fn(directory);}finally{await rm(directory,{recursive:true,force:true});}}
function dependencies(s,directory,override={}) {
  const calls=[],output=[];
  return {calls,output,options:{directory,serviceKey,output:value=>output.push(JSON.parse(value)),query:async sql=>{
    calls.push(sql);
    if(sql.startsWith("select\n"))return [override.preflight??preflight];
    if(sql.startsWith("select c.id"))return [s];
    if(sql.startsWith("begin;"))return [{result:override.result??saved}];
    throw new Error("UNEXPECTED_OFFLINE_QUERY");
  },refresh:async()=>{throw new Error("PROVIDER_MUST_NOT_RUN");}}};
}

test("current driver defaults to metadata-only SELECT and exact incident; all drift blocks before secret/provider access",async()=>{
  const s=source(),d=dependencies(s,"/unused");
  await main([],d.options);
  assert.equal(d.calls.length,1);assert.equal(d.output[0].mode,"read-only");
  assert.match(d.calls[0],new RegExp(incidentId));assert.match(d.calls[0],/credential_refresh_recovery_vault_id is null/);
  assert.doesNotMatch(d.calls[0],/decrypted_secret|select public\./);
  for(const patch of [{source_current:false},{running:1},{incident_current:false}]) {
    const blocked=dependencies(s,"/unused",{preflight:{...preflight,...patch}});
    await assert.rejects(main(["--execute"],blocked.options),/PREFLIGHT_DRIFT/);assert.equal(blocked.calls.length,1);
  }
  const noRpc=dependencies(s,"/unused",{preflight:{...preflight,rpc_installed:false}});
  await assert.rejects(main(["--execute"],noRpc.options),/RPC_NOT_INSTALLED/);assert.equal(noRpc.calls.length,1);
  await assert.rejects(main(["--execute","--resume-store"],d.options),/ARGUMENTS_INVALID/);
});

test("v210 source and authenticated evidence bind exact account, incident, immutable fields and proof lifetime",async()=>sandbox(async directory=>{
  const s=source(),options={source:s,directory,serviceKey,incidentKey:"v210"};
  assert.equal(validateSource(s,Date.now(),"v210"),s.payload);
  assert.throws(()=>validateSource(s),/SOURCE_DRIFT/);
  for(const patch of [{version:209},{created_by:sourceId},{identity_verified:false}])assert.throws(()=>validateSource({...s,...patch},Date.now(),"v210"),/SOURCE_DRIFT/);
  assert.throws(()=>validateSource({...s,payload:next(s)},Date.now(),"v210"),/TOKEN_STATE_INVALID/);
  const result=await writeConfirmedRefreshEvidence({...options,payload:next(s),verifiedAt:new Date().toISOString()});
  assert.match(result.path,/ebay-v210-c9d6431c-confirmed-refresh\.json$/);assert.equal((await stat(result.path)).mode&0o777,0o600);
  const record=await readConfirmedRefreshEvidence(options);assert.equal(record.incidentJobId,incidentId);
  assert.throws(()=>validateConfirmedRefresh(s,{...record,incidentJobId:sourceId},Date.now(),"v210"),/EVIDENCE_INVALID/);
  assert.throws(()=>validateConfirmedRefresh(s,{...record,payload:{...record.payload,client_id:"changed"}},Date.now(),"v210"),/EVIDENCE_INVALID/);
  assert.throws(()=>validateConfirmedRefresh(s,record,Date.now()+601000,"v210"),/PROOF_EXPIRED/);
  const envelope=JSON.parse(await readFile(result.path,"utf8"));envelope.body=envelope.body.replace("fixture-new-access","forged-new-access");envelope.digest=createHash("sha256").update(envelope.body).digest("hex");
  await writeFile(result.path,JSON.stringify(envelope));await assert.rejects(readConfirmedRefreshEvidence(options),/EVIDENCE_INVALID/);
}));

test("STORE-only management resumes durable proof with original timestamp and never invokes provider; missing proof cannot refresh",async()=>sandbox(async directory=>{
  const s=source(),d=dependencies(s,directory);
  await assert.rejects(main(["--resume-store-management"],d.options),/EVIDENCE_MISSING/);assert.equal(d.calls.length,2);
  const verifiedAt=new Date(Date.now()-1000).toISOString();
  await writeConfirmedRefreshEvidence({source:s,payload:next(s),verifiedAt,serviceKey,directory,incidentKey:"v210"});
  await main(["--resume-store-management"],d.options);
  const sql=d.calls.at(-1);assert.match(sql,new RegExp(`select public\\.${rpc}\\(`));assert.match(sql,/statement_timeout='20s'/);assert.ok(sql.includes(verifiedAt));
  assert.deepEqual(d.output,[{mode:"store-resumed-management",...saved}]);
  const invalid=dependencies(s,directory,{result:{...saved,preservedIncidentJobId:sourceId}});
  await assert.rejects(main(["--resume-store-management"],invalid.options),/STORE_READBACK_INVALID/);
  await assert.rejects(main(["--execute"],d.options),/EXISTS_USE_RESUME_STORE/);
}));

test("execute requires same-account GetUser mode, persists proof before STORE failure, then REST resume does not refresh",async t=>sandbox(async directory=>{
  const s=source(),d=dependencies(s,directory);let refreshCalls=0,storeCalls=0;
  d.options.refresh=async(...args)=>{refreshCalls++;assert.equal(args[0],s.payload);assert.equal(args[1],"production");assert.equal(args[5],true);return {refreshed:true,payload:next(s)};};
  t.mock.method(globalThis,"fetch",async(url,request)=>{
    storeCalls++;assert.equal(url,`https://sqaoqucxakebqkiygdxb.supabase.co/rest/v1/rpc/${rpc}`);
    const proof=await readConfirmedRefreshEvidence({source:s,serviceKey,directory,incidentKey:"v210"});assert.ok(proof);
    const body=JSON.parse(request.body);assert.equal(body.p_source_credential_id,sourceId);assert.deepEqual(body.p_secret_payload,proof.payload);assert.equal(body.p_provider_verified_at,proof.verifiedAt);
    if(storeCalls===1)return new Response(JSON.stringify({code:"57014",message:"private-provider-body"}),{status:500});
    return Response.json({...saved,unexpectedSecret:"DO-NOT-EMIT"});
  });
  await assert.rejects(main(["--execute"],d.options),/57014_STATEMENT_TIMEOUT/);
  assert.equal(refreshCalls,1);assert.equal(storeCalls,1);assert.equal(d.output.length,0);
  await main(["--resume-store"],d.options);assert.equal(refreshCalls,1);assert.equal(storeCalls,2);
  assert.deepEqual(d.output,[{mode:"store-resumed",...saved}]);
}));

test("scope expansion and mismatched provider identity stop before durable response or STORE",async()=>sandbox(async directory=>{
  for(const scenario of ["scope","identity"]) {
    const s=source();if(scenario==="scope")s.payload.scopes=ebayDefaultScopes[0];
    const d=dependencies(s,directory);let count=0;
    d.options.refresh=async()=>{count++;return {refreshed:true,payload:{...next(s),provider_account_subject:"ebay:eias:another"}};};
    await assert.rejects(main(["--execute"],d.options),scenario==="scope"?/SCOPE_EXPANSION_BLOCKED/:/PROVIDER_PROOF_INVALID/);
    assert.equal(count,scenario==="scope"?0:1);
    assert.equal(await readConfirmedRefreshEvidence({source:s,serviceKey,directory,incidentKey:"v210"}),null);
  }
}));

test("lost committed STORE resumes revoked v210 only with exact successor marker and original authenticated proof; no fresh provider",async t=>sandbox(async directory=>{
  const s=source(),d=dependencies(s,directory);let refreshCalls=0,stores=0;
  d.options.refresh=async()=>{refreshCalls++;return {refreshed:true,payload:next(s)};};
  const query=d.options.query;
  d.options.query=async sql=>{
    const rows=await query(sql);
    if(sql.startsWith("select\n") && s.status==="revoked")return [{...preflight,source_current:false,source_replay_ready:true}];
    return rows;
  };
  let firstBody;
  t.mock.method(globalThis,"fetch",async(_url,request)=>{
    stores++;
    if(stores===1){firstBody=request.body;s.status="revoked";throw new Error("SIMULATED_COMMITTED_RESPONSE_LOST");}
    assert.equal(request.body,firstBody);return Response.json({...saved,replayed:true});
  });
  await assert.rejects(main(["--execute"],d.options),/SIMULATED_COMMITTED_RESPONSE_LOST/);
  assert.equal(s.status,"revoked");assert.equal(refreshCalls,1);
  assert.throws(()=>validateSource(s,Date.now(),"v210"),/SOURCE_DRIFT/);
  await assert.rejects(main(["--execute"],d.options),/PREFLIGHT_DRIFT/);
  const blocked=dependencies(s,directory,{preflight:{...preflight,source_current:false,source_replay_ready:false}});
  await assert.rejects(main(["--resume-store"],blocked.options),/PREFLIGHT_DRIFT/);
  await main(["--resume-store"],d.options);
  assert.equal(refreshCalls,1);assert.equal(stores,2);assert.equal(d.output[0].mode,"store-resumed");
  assert.match(d.calls.find(sql=>sql.includes("source_replay_ready")),/successor\.seller_account_key=source\.seller_account_key/);
  const wrongOwner=dependencies({...s,created_by:sourceId},directory,{preflight:{...preflight,source_current:false,source_replay_ready:true}});
  await assert.rejects(main(["--resume-store"],wrongOwner.options),/SOURCE_DRIFT/);
}));
