import assert from 'node:assert/strict';
import test from 'node:test';
import { applyRegistrationPatches, channelRegistrationFields, registrationPatches, registrationValueAt, setRegistrationValue } from '../lib/channel-registration-form';
import { preserveChannelRegistrationEdits, publishRegistrationIdentity } from '../lib/publish-registration-draft';
import { coupangCategoryInputs, shopeeCategoryAttributes, categoryScalar } from '../lib/channel-category-values';
import { getProductRegistrationDraft, putProductRegistrationDraft, ProductRegistrationDraftClientError } from '../lib/product-registration-draft-client';
import { inspectListingDraft } from '../lib/channels/listing-preflight';

test('typed fields preserve false, zero, blank and independent package/net weight',()=>{
  let value=setRegistrationValue({facts:{weightKg:0.4}},['body','originProduct','detailAttribute','unitCapacity','unitPriceYn'],false);
  value=setRegistrationValue(value,['facts','weightAttribute'],'315g');
  value=setRegistrationValue(value,['body','stockQuantity'],0);
  const restored=applyRegistrationPatches({},registrationPatches({},value));
  assert.deepEqual(restored,value);
  assert.equal((restored.facts as Record<string,unknown>).weightKg,0.4);
  assert.equal((restored.facts as Record<string,unknown>).weightAttribute,'315g');
  assert.equal(registrationValueAt(restored,['body','originProduct','detailAttribute','unitCapacity','unitPriceYn']),false);
});
test('common update regenerates inherited values and preserves edited price/notices',()=>{
  const before={body:{brand:'old',items:[{externalVendorSku:'sku-1',salePrice:10,notices:[{content:'old'}]}]}};
  const current=structuredClone(before);current.body.items[0].salePrice=12;current.body.items[0].notices[0].content='human';
  const next=structuredClone(before);next.body.brand='new';next.body.items[0].salePrice=15;
  const result=preserveChannelRegistrationEdits({coupang:JSON.stringify(before)},{coupang:JSON.stringify(current)},{coupang:JSON.stringify(next)});
  const restored=JSON.parse(result.coupang!);
  assert.equal(restored.body.brand,'new');assert.equal(restored.body.items[0].salePrice,12);assert.equal(restored.body.items[0].notices[0].content,'human');
});
test('patches cannot rebind protected SKU inside arrays or leak internal evidence',()=>{
  const patches=registrationPatches({body:{items:[{externalVendorSku:'other',salePrice:0}]}}, {sellerpilotAssets:{token:'secret'},body:{items:[{externalVendorSku:'other',salePrice:23}]}});
  assert.deepEqual(patches,[{path:['body','items','0','salePrice'],value:23}]);
  assert.throws(()=>setRegistrationValue({},['__proto__','polluted'],'bad'));
  assert.throws(()=>setRegistrationValue({body:{items:[]}},['body','items','500','name'],'bad'));
  assert.equal(registrationValueAt({},['polluted']),undefined);
});
test('restoring field edits does not reuse stale signed image URLs from evidence',()=>{
  const before={sellerpilotAssets:{galleryImageUrls:['old-signed-url']},body:{name:'auto',salePrice:10}};
  const edited=structuredClone(before);edited.body.name='human';
  const next={sellerpilotAssets:{galleryImageUrls:['fresh-signed-url']},body:{name:'auto',salePrice:20}};
  const result=applyRegistrationPatches(next,registrationPatches(before,edited));
  assert.deepEqual(result,{sellerpilotAssets:{galleryImageUrls:['fresh-signed-url']},body:{name:'human',salePrice:20}});
});
test('bank identities separate seller account, marketplace and target',()=>{
  assert.notEqual(publishRegistrationIdentity('ebay','US','EBAY_US','a'),publishRegistrationIdentity('ebay','GB','EBAY_GB','a'));
  assert.notEqual(publishRegistrationIdentity('ebay','US','EBAY_US','a'),publishRegistrationIdentity('ebay','US','EBAY_US','b'));
});
test('category multi-values and Coupang notices/certificates reach native fields',()=>{
  assert.deepEqual(shopeeCategoryAttributes({'12':['3','plain text']}),[{attribute_id:12,attribute_value_list:[{value_id:3},{original_value_name:'plain text'}]}]);
  const result=coupangCategoryInputs({'중량':'315g','notice:가공식품:원산지':'대한민국','certification:CODE_A':'AUTH-1'});
  assert.deepEqual(result.attributes,[{attributeTypeName:'중량',attributeValueName:'315g'}]);
  assert.deepEqual(result.notices,[{noticeCategoryName:'가공식품',noticeCategoryDetailName:'원산지',content:'대한민국'}]);
  assert.deepEqual(result.certifications,[{certificationType:'CODE_A',certificationCode:'AUTH-1'}]);
  assert.throws(()=>categoryScalar(['one','two']));
});
test('Smartstore required typed unit-capacity fields are available before payload keys exist',()=>{
  const draft={body:{originProduct:{detailAttribute:{}}}};
  const fields=channelRegistrationFields('smartstore',draft,inspectListingDraft('smartstore',draft));
  assert.ok(fields.some(field=>field.path.at(-1)==='unitPriceYn'&&field.inputType==='boolean'));
  const confirmed=setRegistrationValue(draft,['body','originProduct','detailAttribute','unitCapacity','unitPriceYn'],true);
  assert.ok(channelRegistrationFields('smartstore',confirmed,inspectListingDraft('smartstore',confirmed)).some(field=>field.path.at(-1)==='totalCapacityValue'));
});
const draftId='88ab2c29-7381-4bee-8191-19bf59933c97';
const row={draftId,kind:'publish',productId:draftId,version:1,data:{incomplete:true},updatedAt:'2026-09-07T01:00:00.000Z'};
test('draft client does not call a failed or mismatched response saved',async()=>{
  const query={draftId,kind:'publish' as const};
  assert.equal(await getProductRegistrationDraft(async()=>Response.json({draft:null}),query),null);
  await assert.rejects(getProductRegistrationDraft(async()=>Response.json({draft:{...row,draftId:'wrong'}}),query),ProductRegistrationDraftClientError);
  await assert.rejects(putProductRegistrationDraft(async()=>Response.json({message:'conflict',code:'PRODUCT_REGISTRATION_DRAFT_VERSION_CONFLICT'},{status:409}),{...query,expectedVersion:0,data:{}}),(error:unknown)=>error instanceof ProductRegistrationDraftClientError&&error.status===409);
  await assert.rejects(putProductRegistrationDraft(async()=>Response.json({draft:{...row,version:2}}),{...query,expectedVersion:0,data:{}}),ProductRegistrationDraftClientError);
  assert.equal((await putProductRegistrationDraft(async()=>Response.json({draft:row}),{...query,productId:draftId,expectedVersion:0,data:{incomplete:true}})).version,1);
});

test('native notice deletion is durable rather than resurrecting old rows',()=>{
  const before={body:{items:[{externalVendorSku:'sku',notices:[{noticeCategoryName:'식품',noticeCategoryDetailName:'원산지',content:'대한민국'}]}]}};
  const edited=structuredClone(before);edited.body.items[0].notices=[];
  const restored=applyRegistrationPatches(before,registrationPatches(before,edited));
  assert.deepEqual(registrationValueAt(restored,['body','items','0','notices']),[]);
  assert.equal(registrationValueAt(restored,['body','items','0','externalVendorSku']),'sku');
});
