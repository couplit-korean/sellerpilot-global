import test from 'node:test';
import assert from 'node:assert/strict';
import {gatewayClaimSchema,gatewayWorkerCompletionSchema} from '../lib/channels/gateway-contract.ts';
const id='11111111-1111-4111-8111-111111111111';
const claimToken='22222222-2222-4222-8222-222222222222';
const claim={id,claimToken,credential_id:id,channel:'smartstore',operation:'listing.create',environment:'production',request:{arguments:{}},credential:{},attempt_count:1};
test('restored worker receives the nonce required by current database completion',()=>{
 assert.equal(gatewayClaimSchema.parse(claim).claimToken,claimToken);
 const {claimToken:omitted,...legacy}=claim;
 assert.equal(gatewayClaimSchema.safeParse(legacy).success,false);
});
test('completion without a claim nonce cannot reach credential refresh or result storage',()=>{
 assert.equal(gatewayWorkerCompletionSchema.safeParse({jobId:id,status:'failed',error:'provider not called'}).success,false);
 assert.equal(gatewayWorkerCompletionSchema.safeParse({jobId:id,claimToken:'wrong',status:'failed',error:'provider not called'}).success,false);
});
test('valid failed completion preserves the exact nonce and never creates a success result',()=>{
 const value=gatewayWorkerCompletionSchema.parse({jobId:id,claimToken,status:'failed',error:'provider not called'});
 assert.equal(value.claimToken,claimToken);assert.equal(value.status,'failed');assert.equal('result' in value,false);
});
test('all seven restored channels fit the worker contract',()=>{
 for(const channel of ['smartstore','coupang','elevenst','shopee','lazada','qoo10','ebay']) assert.equal(gatewayClaimSchema.safeParse({...claim,channel}).success,true,channel);
});
