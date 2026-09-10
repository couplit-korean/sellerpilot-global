import test from 'node:test';import assert from 'node:assert/strict';import{spawnSync}from'node:child_process';import{readFile}from'node:fs/promises';
function execute(body){const r=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',body],{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:20000});assert.equal(r.status,0,r.stderr);return r.stdout;}
test('actual repository Node/tsx dependencies resolve before configuration failure without network or Keychain',()=>{
 const output=execute(`process.env.SELLERPILOT_URL='';process.env.SELLERPILOT_SHOPEE_EXACT_SESSION='';globalThis.fetch=()=>{throw Error('UNEXPECTED_NETWORK')};try{await import('./scripts/shopee-oauth-exact-once.mjs');throw Error('missing guard');}catch(e){if(e.message!=='SHOPEE_EXACT_CONFIGURATION_REQUIRED')throw e;console.log('OFFLINE_DEPENDENCIES_OK')}`);assert.match(output,/OFFLINE_DEPENDENCIES_OK/);
});
test('actual runner rejects redirects on IP, API authorization and provider code/token transport',()=>{
 const output=execute(`
 process.env.SELLERPILOT_URL='https://sellerpilot-global.vercel.app';process.env.SELLERPILOT_SHOPEE_EXACT_SESSION='33333333-3333-4333-8333-333333333333';process.env.SELLERPILOT_GATEWAY_WORKER_TOKEN='spw_fixture_only_no_real_token';
 const session=process.env.SELLERPILOT_SHOPEE_EXACT_SESSION,shops=['1719148844','2','3','4','5','6','7','8'];let count=0;
 globalThis.fetch=async(url,init={})=>{if(init.redirect!=='error')throw Error('REDIRECT_LEAK');count++;const u=new URL(url),body=init.body?JSON.parse(init.body):{};
 if(u.hostname==='api.ipify.org')return new Response('112.172.127.206');
 if(u.hostname==='partner.shopeemobile.com') {if(u.pathname==='/api/v2/auth/token/get')return Response.json({main_account_id:'123456',access_token:'fixture-main-access',refresh_token:'fixture-main-refresh',shop_id_list:[...shops].reverse(),merchant_id_list:[]});return Response.json({access_token:'fixture-access-'+body.shop_id,refresh_token:'fixture-refresh-'+body.shop_id,expire_in:14400});}
 if(u.origin!==process.env.SELLERPILOT_URL)throw Error('UNEXPECTED_ORIGIN');if(!init.headers.authorization)throw Error('MISSING_AUTH');
 if(u.pathname.endsWith('/shopee-oauth-exact')){if(body.action==='pulse')return Response.json({status:'armed'});if(body.action==='heartbeat'){if('version'in body)throw Error('VERSION_SPOOF');return Response.json({status:'running'});}return Response.json({status:'claimed',job:{id:'11111111-1111-4111-8111-111111111111',claim_token:'44444444-4444-4444-8444-444444444444',credential_id:'22222222-2222-4222-8222-222222222222',channel:'shopee',operation:'oauth.exchange',environment:'production',attempt_count:1,request:{shopeeExactSession:session,mainAccountId:'123456',code:'fixture-code',authorizationExpiresAt:'2027-08-26T00:00:00Z'},credential:{partner_id:'2031489',partner_key:'fixture-partner-key',shop_id:'1719148844',main_account_id:'123456',shop_ids:shops}}});}
 if(u.pathname.endsWith('/credential-refresh'))return Response.json({status:body.action==='begin'?'in_flight':body.credentialRefresh.recoveryOnly?'recovery_preserved':'prepared'});
 if(u.pathname.endsWith('/complete')){if(body.status!=='succeeded'||!body.credentialRefresh.oauthComplete)throw Error('NOT_COMPLETE');return Response.json({message:'fixture complete'});}
 throw Error('GENERAL_WORKER_PATH_FORBIDDEN');};
 await import('./scripts/shopee-oauth-exact-once.mjs');if(count<25)throw Error('INCOMPLETE_EXERCISE');console.log('ALL_TRANSPORT_REDIRECTS_REJECTED');`);assert.match(output,/ALL_TRANSPORT_REDIRECTS_REJECTED/);assert.match(output,/"safeReadVerified":false/);
});
test('runner no longer calls generic heartbeat or publishes a worker version',async()=>{const text=await readFile(new URL('../scripts/shopee-oauth-exact-once.mjs',import.meta.url),'utf8');assert.doesNotMatch(text,/\/worker\/heartbeat|version:/);assert.match(text,/action:'heartbeat',sessionId/);});
test('minimum v1.59 applies to AI claims, not gateway heartbeat; old and exact versions are never falsely upgraded',async()=>{
 const {tsImport}=await import('tsx/esm/api');const {minimumResultUploadWorkerVersion,supportsLiveResultUploadAuthorization}=await tsImport('../lib/ai-worker-version.ts',import.meta.url);
 assert.equal(minimumResultUploadWorkerVersion,'sellerpilot-cli-worker/1.59');assert.equal(supportsLiveResultUploadAuthorization('sellerpilot-cli-worker/1.13'),false);assert.equal(supportsLiveResultUploadAuthorization('sellerpilot-shopee-exact-oauth/1'),false);
 for(const file of ['heartbeat','complete','credential-refresh']){const text=await readFile(new URL('../app/api/channel-gateway/worker/'+file+'/route.ts',import.meta.url),'utf8');assert.doesNotMatch(text,/supportsLiveResultUploadAuthorization|minimumResultUploadWorkerVersion/);}
});
test('exact API Supabase fetch rejects redirects even when caller requests follow',async()=>{
 const {tsImport}=await import('tsx/esm/api');const {shopeeExactAuthenticatedFetch}=await tsImport('../lib/channels/shopee-oauth-exact.ts',import.meta.url);const saved=globalThis.fetch;let observed;
 globalThis.fetch=async(_,init)=>{observed=init;return Response.json({ok:true});};try{await shopeeExactAuthenticatedFetch('https://fixture.invalid',{redirect:'follow',headers:{authorization:'Bearer fixture-only'}});assert.equal(observed.redirect,'error');assert.equal(observed.headers.authorization,'Bearer fixture-only');assert.ok(observed.signal);}finally{globalThis.fetch=saved;}
});
