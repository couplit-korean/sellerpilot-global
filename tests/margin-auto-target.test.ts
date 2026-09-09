import assert from 'node:assert/strict';
import test from 'node:test';
import {calculateChannelMargins,createPlatformFeeOverrides,createPaymentFeeOverrides,createChannelCostOverrides,marginChannelProfiles} from '../lib/pricing/channel-margin';
import {calculateMargin} from '../lib/pricing/margin-engine';

test('automatic target applies channel costs and recomputes saved engine input at 30 percent',()=>{
  const form={sellingPrice:1234,marketReferencePrice:0,purchaseCost:10000,taxRate:10,adRate:0,reserveRate:0,targetMargin:30};
  const fees=createPlatformFeeOverrides(), payments=createPaymentFeeOverrides(), costs=createChannelCostOverrides();
  const profiles=marginChannelProfiles.map(p=>({...p,rateToKrw:p.currency==='KRW'?1:p.currency==='JPY'?9.2:1378.25}));
  for(const p of profiles){fees[p.key]=10;payments[p.key]=0;costs[p.key]={localShipping:3000,internationalShipping:5000,fulfillmentCost:0,fixedCost:2000};}
  const run=()=>calculateChannelMargins(form,fees,payments,costs,profiles,'target');
  for(const r of run()){
    assert.equal(r.plannedSellingPriceKrw,40000);
    assert.ok(r.margin!>=30 && r.margin!<31);
    assert.deepEqual(calculateMargin(r.engineInput).profit,r.profit);
    assert.equal(r.engineInput.sellingPrice,r.effectiveSellingPriceKrw);
    assert.equal(r.localSellingPrice,r.localRecommendedPrice);
  }
  costs.qoo10.internationalShipping+=5000;
  assert.equal(run().find(r=>r.key==='qoo10')!.plannedSellingPriceKrw,50000);
  assert.equal(run().find(r=>r.key==='smartstore')!.plannedSellingPriceKrw,40000);
  form.targetMargin=40;
  assert.ok(run().every(r=>r.margin!>=40));
  profiles.find(p=>p.key==='ebay')!.rateToKrw=1500;
  assert.ok(run().find(r=>r.key==='ebay')!.margin!>=40);
  fees.elevenst=null;
  assert.equal(run().find(r=>r.key==='elevenst')!.calculationReady,false);
  form.targetMargin=85;
  assert.ok(run().every(r=>!r.calculationReady));
  assert.ok(run().every(r=>r.plannedSellingPriceKrw===0));
});
