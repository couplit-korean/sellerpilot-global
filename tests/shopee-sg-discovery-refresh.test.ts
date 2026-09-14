import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import test from 'node:test';
registerHooks({resolve(specifier,context,next){if(specifier==='server-only')return{shortCircuit:true,url:'data:text/javascript,export default {}'};return next(specifier,context);}});
const {executeServerlessGatewayProviderJob}=await import('../lib/channels/commerce-provider');
function payload(shop='1719148844'){
 const expired=new Date(Date.now()-3600000).toISOString(),valid=new Date(Date.now()+2592000000).toISOString();
 return{partner_id:'12345',partner_key:'fixture-partner-key',provider_account_subject:'shopee:main:4940266',provider_account_identity_version:'v1',main_account_id:'4940266',authorization_expires_at:valid,shopee_targets:[{type:'shop',id:shop,access_token:'expired-shop-access',refresh_token:'shop-refresh',access_token_expires_at:expired,refresh_token_expires_at:valid},{type:'merchant',id:'5511564',access_token:'expired-merchant-access',refresh_token:'merchant-refresh',access_token_expires_at:expired,refresh_token_expires_at:valid}]};
}
async function run({shop='1719148844',failRecovery=false}={}){
 const previous=globalThis.fetch,events:string[]=[],snapshots:Record<string,unknown>[]=[];let merchantRequests=0;
 globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input));
  if(url.pathname==='/api/v2/auth/access_token/get'){
   const b=JSON.parse(String(init?.body));assert.equal(b.main_account_id,undefined);
   const kind=b.shop_id?'shop':'merchant';assert.ok(events.includes(`begin:${kind}`));events.push(`exchange:${kind}`);
   if(kind==='merchant'){merchantRequests++;assert.equal(b.merchant_id,5511564);assert.equal(b.refresh_token,'merchant-refresh');}
   else{assert.equal(String(b.shop_id),shop);assert.equal(b.refresh_token,'shop-refresh');}
   return Response.json({access_token:`new-${kind}-access`,refresh_token:`new-${kind}-refresh`,expire_in:14400});
  }
  if(url.pathname==='/api/v2/shop/get_shop_info'){
   assert.equal(url.searchParams.get('shop_id'),shop);assert.equal(url.searchParams.get('access_token'),'new-shop-access');events.push('shop-info');
   return Response.json({error:'',response:{shop_id:Number(shop),shop_name:'Fixture SG shop',region:'SG',status:'NORMAL'}});
  }
  throw new Error(`Unexpected provider path ${url.pathname}`);
 };
 try{
  const result=await executeServerlessGatewayProviderJob({job:{id:'4a45f463-bc16-41fe-847b-ce5dde2a0172',claim_token:'00000000-0000-4000-8000-000000000001',credential_id:'550d04ed-1e86-44a3-85a0-12ba17ce2374',channel:'shopee',operation:'shops.get',environment:'production',request:{shopId:shop},credential:payload(shop),attempt_count:1},signal:new AbortController().signal,hooks:{assertLeaseHealthy:async()=>{},beginProviderMutation:async()=>{throw new Error('Product mutation not permitted');},beginCredentialMutation:async t=>{events.push(`begin:${t?.targetType??'identity'}`);},stageCredentialRefresh:async r=>{events.push(`${r.recoveryOnly?'recovery':'prepare'}:${r.target?.targetType??'identity'}`);snapshots.push(r.payload);if(failRecovery&&r.recoveryOnly)throw new Error('durable recovery unavailable');}}});
  return{result,events,snapshots,merchantRequests};
 }finally{globalThis.fetch=previous;}
}
test('same SG discovery preserves shop then merchant rotations and signs final shop read with shop token',async()=>{
 const r=await run();assert.equal(r.result.ok,true);assert.equal(r.merchantRequests,1);
 const e=r.events;assert.ok(e.indexOf('begin:shop')<e.indexOf('exchange:shop'));assert.ok(e.indexOf('exchange:shop')<e.indexOf('recovery:shop'));assert.ok(e.indexOf('recovery:shop')<e.indexOf('shop-info'));assert.ok(e.indexOf('prepare:shop')<e.indexOf('exchange:merchant'));assert.ok(e.indexOf('recovery:merchant')<e.indexOf('prepare:merchant'));assert.ok(e.lastIndexOf('shop-info')>e.indexOf('prepare:merchant'));
 const last=r.snapshots.at(-1)!;const targets=last.shopee_targets as Array<Record<string,unknown>>;assert.equal(targets.find(t=>t.type==='shop')?.refresh_token,'new-shop-refresh');assert.equal(targets.find(t=>t.type==='merchant')?.refresh_token,'new-merchant-refresh');assert.equal(e.filter(v=>v==='exchange:shop').length,1);
});
test('other shop discovery does not start the SG merchant refresh',async()=>{const r=await run({shop:'1758392135'});assert.equal(r.result.ok,true);assert.equal(r.merchantRequests,0);});
test('failed durable recovery stops before merchant exchange and cannot report discovery success',async()=>{await assert.rejects(run({failRecovery:true}),/durable recovery unavailable/);});
