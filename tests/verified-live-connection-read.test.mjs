import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { credentialFingerprint, guardedTransport, loadExistingAuthorization, runVerifiedConnection } from '../scripts/verified-live-connection-read.mjs';

const actor = '76800000-1111-4111-8111-111111111111';
const owner = '21eb1892-0894-4f9f-b414-4c9464182dd6';
const cid = '32de2968-d4b7-4fda-a84b-16a7ce0257cc';
const project = 'sqaoqucxakebqkiygdxb';
const marker = 'PRIVATE_AUTH_AND_SECRET_MARKER';
const keyFile = '/fixture-private/auth.json';
const receiptFile = keyFile + '.receipt.json';
const uid = process.getuid();
const payload = { vendor_id: 'A01601472', access_key: 'fixture-access', secret_key: marker };
const base = { contractVersion:1,channel:'coupang',projectRef:project,siteOrigin:'https://sellerpilot-global.vercel.app',actorId:actor,credentialOwnerId:owner,credentialId:cid,credentialVersion:1,credentialFingerprint:credentialFingerprint(payload),expiresAt:null,allowedIp:'112.172.127.206',accessToken:marker,publishableKey:'fixture-public',serviceKey:'fixture-service',allowSmartstoreTokenRequest:false };
function fixture(options = {}) {
  const file = {...base,...options.input};
  const files = new Map([[keyFile,JSON.stringify(file)]]), events=[];
  const st={isFile:()=>true,isSymbolicLink:()=>false,mode:0o600,uid,nlink:1,ino:1,dev:1,size:2048};
  const io={lstat:async p=>{
    if(p==='/fixture-private')return{isDirectory:()=>true,isSymbolicLink:()=>false,mode:0o700,uid};
    if(!files.has(p))throw Error(marker); return st;
  },realpath:async p=>p,open:async()=>({stat:async()=>st,readFile:async()=>JSON.stringify(file),close:async()=>events.push('close')}),unlink:async p=>{events.push('unlink');files.delete(p);},writeFile:async(p,data,opts)=>{if(opts?.flag==='wx'&&files.has(p))throw Error(marker);files.set(p,data);}};
  let authCount=0,serviceClients=0;
  const metadata=()=>({id:cid,channel:file.channel,environment:'production',status:'active',version:1,expires_at:null,fingerprint:file.credentialFingerprint});
  const createClientImpl=(_url,key)=>{
    if(key==='fixture-service'){serviceClients++;return{rpc:async(name,args)=>{
      events.push(name);if(name==='sellerpilot_decrypt_credential')return{data:options.payload??payload,error:null};
      assert.equal(name,'sellerpilot_record_credential_test');assert.equal(args.p_credential_id,cid);assert.equal(args.p_status,'passed');assert.doesNotMatch(args.p_safe_message,new RegExp(marker));
      assert.equal(JSON.parse(files.get(receiptFile)).recordingStatus,'unverified');
      if(options.recordLost)throw Error(marker);if(options.recordHang)return new Promise(()=>{});
      return{data:null,error:options.recordError?{message:marker}:null};
    }};}
    assert.equal(key,'fixture-public');return{auth:{getUser:async()=>{authCount++;events.push('getUser');return{data:{user:{id:options.wrongActor?owner:actor}},error:null};}},rpc:async name=>{
      events.push(name);
      if(name==='sellerpilot_is_admin')return{data:!options.denied,error:options.rpcUnavailable?{code:'PGRST002',message:marker}:null};
      if(name==='sellerpilot_list_credentials')return{data:[{...metadata(),...(options.rotationAt===authCount?{version:2}:{}),...(options.fingerprintAt===authCount?{fingerprint:'AAAAAAAAAAAA'}:{})}],error:null};
      assert.equal(name,'sellerpilot_verify_channel_credential_owner_v1');return{data:{contractVersion:1,authorizationModel:'shared_admin_workspace',actorId:actor,credentialOwnerId:options.ownerAt===authCount?actor:owner,credentialId:cid,credentialVersion:1,channel:file.channel,environment:'production',expiresAt:null},error:options.proofMissing?{code:'PGRST202'}:null};
    }};
  };
  const fetchImpl=async(url,init)=>{events.push(String(url));assert.equal(init.redirect,'error');assert.ok(init.signal);if(String(url).includes('ipify'))return Response.json({ip:options.ip??base.allowedIp});if(String(url).includes('/oauth2/token'))return Response.json({access_token:'fixture-only-token',expires_in:3600});if(String(url).includes('/seller/account'))return Response.json({accountId:'fixture-account'});return Response.json({code:'SUCCESS',data:[{vendorId:payload.vendor_id}]});};
  const diagnosticImpl=options.realDiagnostic?undefined:async channel=>{events.push('diagnostic');assert.equal(channel,file.channel);if(options.diagnosticHang)return new Promise(()=>{});if(!options.noFreshRead)await globalThis.fetch('https://api-gateway.coupang.com/v2/providers/seller_api/apis/api/v1/marketplace/seller-products?vendorId=A01601472&maxPerPage=1');return{status:options.diagnosticStatus??'passed',message:marker};};
  return{files,events,services:{io,createClientImpl,fetchImpl,...(diagnosticImpl?{diagnosticImpl}:{}),...(options.timeoutMs?{timeoutMs:options.timeoutMs}:{})},serviceClients:()=>serviceClients};
}
async function run(options={}){const f=fixture(options);const result=await runVerifiedConnection(keyFile,f.services);assert.doesNotMatch(JSON.stringify(result),new RegExp(marker));assert.equal(f.files.has(keyFile),false);return{...f,result};}
test('existing authorization loader does not execute legacy main and preserves actor versus lineage owner',async()=>{
  assert.equal(typeof await loadExistingAuthorization(),'function');const f=await run();assert.equal(f.result.status,'passed');assert.equal(f.result.recordingStatus,'recorded');assert.equal(f.events.filter(v=>v==='getUser').length,3);assert.equal(f.events.filter(v=>v==='sellerpilot_record_credential_test').length,1);
});
test('real runChannelDiagnostic executes fresh Coupang GET before standard recording',async()=>{
 const f=await run({realDiagnostic:true});assert.equal(f.result.status,'passed');const get=f.events.findIndex(e=>e.startsWith('https://api-gateway.coupang.com/'));assert.ok(get>f.events.indexOf('sellerpilot_decrypt_credential'));assert.ok(get<f.events.indexOf('sellerpilot_record_credential_test'));
});
for(const option of [{denied:true},{rpcUnavailable:true},{wrongActor:true},{proofMissing:true},{ownerAt:1},{rotationAt:2},{fingerprintAt:2},{ownerAt:2},{rotationAt:3},{fingerprintAt:3},{ownerAt:3},{payload:{...payload,secret_key:'changed'}},{ip:'1.2.3.4'},{diagnosticStatus:'failed'},{diagnosticStatus:'manual'}]){
 test(`no record on failed authorization/freshness/read: ${JSON.stringify(option)}`,async()=>{const f=await run(option);assert.equal(f.result.status,'unverified');assert.equal(f.events.includes('sellerpilot_record_credential_test'),false);if(option.denied||option.wrongActor||option.rpcUnavailable||option.proofMissing||option.ownerAt===1)assert.equal(f.serviceClients(),0);});
}
for(const option of [{recordError:true},{recordLost:true},{recordHang:true,timeoutMs:30}]){
 test(`record failure/loss remains unverified, never repeats: ${JSON.stringify(option)}`,async()=>{const f=await run(option);assert.equal(f.result.recordingStatus,'unverified');assert.equal(f.result.retryAllowed,false);assert.equal(f.events.filter(x=>x==='sellerpilot_record_credential_test').length,1);f.files.set(keyFile,JSON.stringify(base));const retry=await runVerifiedConnection(keyFile,f.services);assert.equal(retry.status,'unverified');assert.equal(f.events.filter(x=>x==='sellerpilot_record_credential_test').length,1);});
}
test('total deadline aborts a hung diagnostic with no record',async()=>{const f=await run({diagnosticHang:true,timeoutMs:20});assert.equal(f.result.code,'TIMEOUT');assert.equal(f.events.includes('sellerpilot_record_credential_test'),false);});
for(const input of [{channel:'shopee'},{siteOrigin:'http://sellerpilot-global.vercel.app'},{siteOrigin:'https://foreign.invalid'},{projectRef:'other'},{channel:'smartstore',allowSmartstoreTokenRequest:false}]){
 test(`input scope closes before any client/network: ${JSON.stringify(input)}`,async()=>{const f=await run({input});assert.equal(f.result.status,'unverified');assert.equal(f.events.includes('getUser'),false);});
}
test('transport rejects redirects, repetitions, alternate origins, writes and jobs',async()=>{
 const controller=new AbortController();let n=0;const transport=guardedTransport(async()=>{n++;return Response.json({});},{channel:'coupang',vendorId:'A01601472'},controller.signal);
 for(const [url,method]of [['https://evil.invalid','GET'],[`https://${project}.supabase.co/rest/v1/rpc/sellerpilot_enqueue_channel_gateway_job`,'POST'],[`https://${project}.supabase.co/rest/v1/rpc/sellerpilot_rotate_credential`,'POST'],['https://api-gateway.coupang.com/v2/providers/seller_api/apis/api/v1/marketplace/seller-products','POST']])await assert.rejects(transport(url,{method}),/OUT_OF_SCOPE/);
 const ip='https://api.ipify.org?format=json';await transport(ip);await assert.rejects(transport(ip),/REPLAY/);assert.equal(n,1);
 const redirect=guardedTransport(async()=>new Response(null,{status:302}),{channel:'coupang'},controller.signal);await assert.rejects(redirect(ip),/REDIRECT_REJECTED/);
});
test('Smartstore token POST is explicitly permitted once; no refresh/rotation destinations',async()=>{
 const controller=new AbortController();const t=guardedTransport(async()=>Response.json({}),{channel:'smartstore',allowSmartstoreTokenRequest:true},controller.signal);
 await t('https://api.commerce.naver.com/external/v1/oauth2/token',{method:'POST'});await assert.rejects(t('https://api.commerce.naver.com/external/v1/oauth2/token',{method:'POST'}),/REPLAY/);
 await t('https://api.commerce.naver.com/external/v1/seller/account');
});
test('fingerprint matches actual in-memory PostgreSQL jsonb format, not JSON.stringify',async()=>{
 const db=new PGlite();try{for(const value of [payload,{client_id:'fixture',client_secret:'secret',token_type:'SELF'},{long:true,a:null,한국:'값',nested:{bbb:['x',2,false],aa:'x'}}]){const text=(await db.query('select $1::jsonb::text as value',[JSON.stringify(value)])).rows[0].value;assert.equal(credentialFingerprint(value),createHash('sha256').update(text).digest('hex').slice(0,12).toUpperCase());}assert.throws(()=>credentialFingerprint({x:1.25}),/UNREPRESENTABLE/);}finally{await db.close();}
});
test('runner contains no environment credentials, account mutation or job completion calls',async()=>{
 const source=await readFile(new URL('../scripts/verified-live-connection-read.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/process\.env|signInWithPassword|auth\.admin|generateLink|rpc\(['"]sellerpilot_(?:enqueue|complete|rotate)/);assert.match(source,/Math\.min\(30_000, services.timeoutMs\)/);
});

test('Smartstore normal runChannelDiagnostic performs only approved token POST/account GET and records once',async()=>{
 const naver={client_id:'fixture-app',client_secret:'$2a$04$......................',token_type:'SELF'};
 const f=await run({realDiagnostic:true,payload:naver,input:{channel:'smartstore',allowSmartstoreTokenRequest:true,credentialFingerprint:credentialFingerprint(naver)}});
 assert.equal(f.result.status,'passed');assert.equal(f.events.filter(e=>e.includes('/oauth2/token')).length,1);assert.equal(f.events.filter(e=>e.includes('/seller/account')).length,1);assert.equal(f.events.filter(e=>e==='sellerpilot_record_credential_test').length,1);
});

test('a synthetic passed result without any fresh provider read cannot record',async()=>{const f=await run({noFreshRead:true});assert.equal(f.result.code,'FRESH_READ_UNVERIFIED');assert.equal(f.events.includes('sellerpilot_record_credential_test'),false);});
