// Explicit invocation only. No general worker import, environment mutation or
// OAuth retry. Secrets stay in process memory; output is status-only.
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {runLazadaExactJob} from '../lib/channels/lazada-oauth-exact.ts';
export async function runExactSession({sessionId,call,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,runJob=runLazadaExactJob}) {
 const deadline=now()+9*60000;let first;
 while(now()<deadline){await call({action:'pulse',sessionId});const r=await call({action:'claim',sessionId});if(r.status==='claimed'){first=r.job;break;}if(r.status!=='waiting')throw new Error('LAZADA_EXACT_UNEXPECTED_STATE');await sleep(5000);}
 if(!first)throw new Error('LAZADA_EXACT_WAIT_EXPIRED');
 const oauth=await runJob(first,sessionId,call);
 if(oauth.status!=='readback_ready')throw new Error('LAZADA_EXACT_OAUTH_NOT_COMPLETE');
 const read=await call({action:'claim',sessionId});
 if(read.status!=='claimed'||read.job?.id!==oauth.jobId||read.job?.operation!=='shops.get')throw new Error('LAZADA_EXACT_READBACK_JOB_MISMATCH');
 const result=await runJob(read.job,sessionId,call);
 if(result.status!=='completed')throw new Error('LAZADA_EXACT_READBACK_NOT_COMPLETE');
 return {status:'completed',sellerId:'300872000183'};
}
async function main(){
 const origin=process.env.SELLERPILOT_URL,sessionId=process.env.SELLERPILOT_LAZADA_EXACT_SESSION;
 if(origin!=='https://sellerpilot-global.vercel.app'||!sessionId||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId))throw new Error('LAZADA_EXACT_CONFIG_REQUIRED');
 const token=process.env.SELLERPILOT_GATEWAY_WORKER_TOKEN||execFileSync('/usr/bin/security',['find-generic-password','-s','SellerPilot Gateway Worker','-a',origin,'-w'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
 const directFetch=globalThis.fetch.bind(globalThis);
 globalThis.fetch=(input,init)=>directFetch(input,{...init,redirect:'error',signal:init?.signal??AbortSignal.timeout(20000)});
 const call=async body=>{const r=await fetch(origin+'/api/channel-gateway/worker/lazada-oauth-exact',{method:'POST',redirect:'error',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('LAZADA_EXACT_HTTP_FAILED');return r.json();};
 console.log(JSON.stringify(await runExactSession({sessionId,call})));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('LAZADA_EXACT_REVIEW_REQUIRED_NO_RETRY');process.exitCode=2;});
