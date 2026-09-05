// Run offline-resolved dependencies: node --import tsx scripts/shopee-oauth-exact-once.mjs
// Dedicated one-session runner. Never imports or starts the general worker.
import { execFileSync } from 'node:child_process';
import { parseShopeeExactClaim } from '../lib/channels/shopee-oauth-exact.ts';
import { executeProviderOAuthExchange } from '../lib/channels/provider-oauth-runtime.ts';
const origin=process.env.SELLERPILOT_URL;
const sessionId=process.env.SELLERPILOT_SHOPEE_EXACT_SESSION;
if(origin!=='https://sellerpilot-global.vercel.app'||!sessionId||!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error('SHOPEE_EXACT_CONFIGURATION_REQUIRED');
// This process runs only exact OAuth. Force redirect rejection also for the
// existing provider transport, which receives fresh code/token credentials.
const directFetch=globalThis.fetch.bind(globalThis);
globalThis.fetch=(input,init)=>directFetch(input,{...init,redirect:'error'});
const token=process.env.SELLERPILOT_GATEWAY_WORKER_TOKEN||execFileSync('/usr/bin/security',['find-generic-password','-s','SellerPilot Gateway Worker','-a',origin,'-w'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
async function call(path,body){const r=await fetch(origin+path,{method:'POST',redirect:'error',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('SHOPEE_EXACT_HTTP_'+r.status);return r.json();}
async function attestIp(){const r=await fetch('https://api.ipify.org',{redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok||(await r.text()).trim()!=='112.172.127.206')throw new Error('SHOPEE_EXACT_EGRESS_MISMATCH');}
const path='/api/channel-gateway/worker/shopee-oauth-exact';
const deadline=Date.now()+9*60000;
let job;
while(Date.now()<deadline){await attestIp();await call(path,{action:'pulse',sessionId});const r=await call(path,{action:'claim',sessionId});if(r.status==='claimed'){job=parseShopeeExactClaim(r.job,sessionId);break;}if(r.status!=='waiting')throw new Error('SHOPEE_EXACT_UNEXPECTED_STATE');await new Promise(r=>setTimeout(r,5000));}
if(!job)throw new Error('SHOPEE_EXACT_SESSION_WAIT_EXPIRED');
const binding={jobId:job.id,claimToken:job.claim_token};
// All subsequent calls are existing exact job/claim/token fenced lifecycles.
const healthy=async()=>{const r=await call(path,{action:'heartbeat',sessionId,...binding});if(r.status!=='running')throw new Error('SHOPEE_EXACT_LEASE_LOST');};
let finalRefresh;
try{
 const result=await executeProviderOAuthExchange(job,{
  assertLeaseHealthy:healthy,
  beginCredentialMutation:async()=>{await attestIp();await call('/api/channel-gateway/worker/credential-refresh',{action:'begin',...binding});},
  stageCredentialRefresh:async credentialRefresh=>{finalRefresh=credentialRefresh;await call('/api/channel-gateway/worker/credential-refresh',{action:'stage',...binding,credentialRefresh});},
 });
 await call('/api/channel-gateway/worker/complete',{...binding,status:'succeeded',result,credentialRefresh:finalRefresh});
 console.log(JSON.stringify({status:'oauth_completed',jobId:job.id,shopId:'1719148844',safeReadVerified:false}));
}catch{
 // A consumed code or staged partial is never silently replayed or failed-safe.
 await call('/api/channel-gateway/worker/complete',{...binding,status:'reconciliation_required',error:'SHOPEE_EXACT_OAUTH_REVIEW_REQUIRED'}).catch(()=>{});
 throw new Error('SHOPEE_EXACT_OAUTH_REVIEW_REQUIRED');
}
