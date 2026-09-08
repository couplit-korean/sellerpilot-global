import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({resolve(s,c,next){return s === "server-only" ? {shortCircuit:true,url:"data:text/javascript,export default {}"} : next(s,c);}});
const {executeCsProviderJob}=await import('../lib/cs/operations/provider');
const {executeServerlessGatewayProviderJob:executeCommerce}=await import('../lib/channels/commerce-provider');
const {providerFetch,runWithProviderTransportContext}=await import('../lib/channels/protocols');
const {processCsGatewayJob}=await import('../scripts/cs-gateway-job.mjs');
const {processCommerceGatewayJob}=await import('../scripts/commerce-gateway-job.mjs');
const base={id:'10000000-0000-4000-8000-000000000001',claim_token:'10000000-0000-4000-8000-000000000002',credential_id:'10000000-0000-4000-8000-000000000003',channel:'qoo10' as const,environment:'production' as const,request:{arguments:{}},credential:{},attempt_count:1};
const noop=async()=>{};
test('Concurrent CS and commerce requests own independent budgets and cancellation signals',async()=>{
 const original=globalThis.fetch;const calls:string[]=[];const csAbort=new AbortController(), productAbort=new AbortController();
 globalThis.fetch=async(_url,init)=>{init?.signal?.throwIfAborted();return new Response('{}',{status:200});};
 try{
  const hooks=(tag:string)=>({beginCredentialMutation:noop,stageCredentialRefresh:noop,beginProviderMutation:noop,assertLeaseHealthy:noop,reserveProviderRequest:async()=>{calls.push(tag);}});
  await runWithProviderTransportContext({reserve:async()=>{throw new Error('inherited budget leaked');},signal:AbortSignal.abort()},async()=>{
   const outcomes=await Promise.allSettled([
    executeCsProviderJob({job:{...base,operation:'inquiries.list'},signal:csAbort.signal,hooks:hooks('cs')},async()=>{
     await providerFetch('https://fixture.invalid/cs');csAbort.abort();await new Promise(resolve=>setTimeout(resolve,5));
     await providerFetch('https://fixture.invalid/cs-aborted',{signal:csAbort.signal});throw new Error('must abort');
    }),
    executeCommerce({job:{...base,operation:'categories.list'},signal:productAbort.signal,hooks:hooks('commerce')},async()=>{
     await new Promise(resolve=>setTimeout(resolve,15));await providerFetch('https://fixture.invalid/product',{signal:productAbort.signal});
     return {ok:true,channel:'qoo10',operation:'categories.list',steps:[],safeMessage:'fixture'};
    }),
   ]);
   assert.equal(outcomes[0].status,'rejected');assert.equal(outcomes[1].status,'fulfilled');assert.equal(productAbort.signal.aborted,false);
  });
  assert.deepEqual(calls,['cs','cs','commerce']);
 }finally{globalThis.fetch=original;}
});
test('Each local provider handler rejects the other domain before starting a lease',async()=>{
 const deps={createGatewayHeartbeat:()=>{throw new Error('must not start');},persistWorkerCompletion:async()=>new Response()};
 await assert.rejects(processCsGatewayJob({...base,operation:'listing.create'},deps),/CS_WORKER_OPERATION_REQUIRED/);
 await assert.rejects(processCommerceGatewayJob({...base,operation:'inquiries.list'},deps),/COMMERCE_WORKER_OPERATION_REQUIRED/);
});
test('CS local reply with an uncertain accepted write stays in reconciliation and never becomes a failed retry',async()=>{
 const receipts:Array<Record<string,unknown>>=[];
 await processCsGatewayJob({...base,operation:'inquiries.reply'},{
  createGatewayHeartbeat:()=>({start:noop,stop:noop,assertHealthy:noop}),
  persistWorkerCompletion:async(_path:string,payload:Record<string,unknown>)=>{receipts.push(payload);return new Response('{}');},
  executeProvider:async()=>({ok:false,channel:'qoo10',operation:'inquiries.reply',steps:[{name:'setinquirymessage',ok:false,status:503,data:{sellerpilotMutation:'accepted'}}],safeMessage:'remote status unknown'}),
 });
 assert.equal(receipts.length,1);assert.equal(receipts[0].status,'reconciliation_required');
});
