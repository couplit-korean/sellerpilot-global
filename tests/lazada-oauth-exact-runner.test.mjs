import test from 'node:test';import assert from 'node:assert/strict';import {tsImport} from 'tsx/esm/api';
const {runExactSession}=await tsImport('../scripts/lazada-oauth-exact-once.mjs',import.meta.url);
const {runLazadaExactJob,assertLazadaExactRefresh}=await tsImport('../lib/channels/lazada-oauth-exact.ts',import.meta.url);
const {withLazadaProviderAccountIdentity}=await tsImport('../lib/channels/provider-account-identity.ts',import.meta.url);
const session='33333333-3333-4333-8333-333333333333';
for(const scenario of ['success','claim-network-failure','oauth-failure','wrong-read-job','readback-pending'])test('mock-only runner '+scenario,async()=>{
 let claims=0,runs=0;
 const call=async b=>{if(b.action==='pulse')return {status:'armed'};claims++;if(scenario==='claim-network-failure')throw Error('fixture_network');return {status:'claimed',job:claims===1?{id:'oauth'}:{id:scenario==='wrong-read-job'?'other':'read',operation:'shops.get'}};};
 const runJob=async()=>{runs++;if(scenario==='oauth-failure')throw Error('fixture_exchange');return runs===1?{status:'readback_ready',jobId:'read'}:{status:scenario==='readback-pending'?'seller_verified_reconciliation_pending':'completed'};};
 if(scenario==='success')assert.equal((await runExactSession({sessionId:session,call,runJob})).status,'completed');else await assert.rejects(runExactSession({sessionId:session,call,runJob}));
 assert.equal(claims,scenario==='claim-network-failure'||scenario==='oauth-failure'?1:2);assert.ok(runs<=2);
});
const source={app_key:'137451',app_secret:'fixture-app',country:'my',im_app_key:'137571',im_app_secret:'fixture-im',im_access_token:'fixture-im-token'};
// Use the public normalizer result identity through its documented helper.
const {withProviderAccountIdentity}=await tsImport('../lib/channels/provider-account-identity.ts',import.meta.url);
const normalized=withLazadaProviderAccountIdentity({}, {account_platform:'seller_center',country_user_info:[{country:'my',seller_id:'300872000183',user_id:'900001'}]});
const active=withProviderAccountIdentity({...source,account_platform:normalized.accountPlatform,country_user_info:normalized.countryUserInfo,access_token:'fixture-access'},normalized.identity);
test('IM mutation rejected independently of seller identity',()=>{assert.doesNotThrow(()=>assertLazadaExactRefresh(source,active));assert.throws(()=>assertLazadaExactRefresh(source,{...active,im_access_token:'changed'}),/IM_CHANGED/);});
for(const scenario of ['heartbeat-rejected','wrong-seller','network-error'])test('GET controller fail closed '+scenario,async()=>{
 const calls=[];let gets=0;
 const call=async b=>{calls.push(b.action);return {status:b.action==='review'?'review':scenario==='heartbeat-rejected'?'rejected':'running'};};
 const job={id:'11111111-1111-4111-8111-111111111111',claim_token:'22222222-2222-4222-8222-222222222222',credential_id:'44444444-4444-4444-8444-444444444444',channel:'lazada',operation:'shops.get',environment:'production',attempt_count:1,request:{country:'my',lazadaExactSession:session},credential:active};
 await assert.rejects(runLazadaExactJob(job,session,call,async()=>{gets++;if(scenario==='network-error')throw Error('fixture_network');return Response.json({code:'0',data:{seller_id:'999',short_code:'MY4NNISR2D',status:'ACTIVE'}});}),/NO_REPLAY/);
 assert.ok(!calls.includes('complete'));assert.equal(calls.at(-1),'review');assert.equal(gets,scenario==='heartbeat-rejected'?0:1);
});
