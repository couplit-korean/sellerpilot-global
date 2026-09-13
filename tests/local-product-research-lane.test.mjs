import test from 'node:test';
import assert from 'node:assert/strict';
import { runLocalProductResearchOnce } from '../scripts/local-product-research-lane.mjs';
const id='10000000-0000-4000-8000-000000000001';
const claim_token='20000000-0000-4000-8000-000000000001';
const draft={mode:'server-research',summary:'테스트 상품의 입력 자료와 확인되지 않은 사실을 구분한 상품정보 분석 결과입니다.',suggestedFields:{productName:'테스트 상품',categoryHint:null,brandName:null,manufacturer:null,countryOfOrigin:null,material:null,packageContents:null,description:null,gtin:null},searchQueries:[{locale:'ko-KR',query:'테스트 상품'},{locale:'en-US',query:'test product'},{locale:'ja-JP',query:'テスト商品'},{locale:'zh-TW',query:'測試商品'},{locale:'ms-MY',query:'produk ujian'},{locale:'id-ID',query:'produk uji'}],details:{features:[],specifications:[],usage:[],cautions:[]},sources:[],warnings:[]};
test('idle does not launch Codex or invent a job',async()=>{
 const outcome=await runLocalProductResearchOnce({api:async()=>Response.json({data:null}),invokeSegment:()=>assert.fail('must not generate')});
 assert.equal(outcome.status,'idle');
});
test('local Codex result goes through existing validation, touch and fenced completion',async()=>{
 const actions=[];
 const outcome=await runLocalProductResearchOnce({api:async(_path,init)=>{
  const body=JSON.parse(init.body);actions.push(body.action);
  if(body.action==='claim') return Response.json({data:{id,claim_token,kind:'product_research',claim_scope:'server_product_research',request:{research_input:'테스트 상품 사진 설명'},attempt_count:2}});
  assert.equal(body.arguments.p_job_id,id);assert.equal(body.arguments.p_claim_token,claim_token);
  if(body.action==='touch')return Response.json({data:'running'});
  assert.equal(body.action,'complete');assert.equal(body.arguments.p_result_payload.mode,'server-research');
  return Response.json({data:true});
 },invokeSegment:async args=>{assert.equal(args.schema.properties.mode.const,'server-research');return draft;}});
 assert.equal(outcome.status,'succeeded');assert.deepEqual(actions,['claim','touch','complete']);
});
test('lost claim cannot complete',async()=>{
 let complete=false;
 await assert.rejects(runLocalProductResearchOnce({api:async(_path,init)=>{
  const body=JSON.parse(init.body);
  if(body.action==='claim')return Response.json({data:{id,claim_token,kind:'product_research',claim_scope:'server_product_research',request:{research_input:'테스트 상품 설명'},attempt_count:2}});
  if(body.action==='touch')return Response.json({data:'ownership_lost'});
  if(body.action==="complete") complete=true;return Response.json({data:true});
 },invokeSegment:async()=>draft}));
 assert.equal(complete,false);
});
