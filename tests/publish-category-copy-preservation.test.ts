import assert from 'node:assert/strict';
import test from 'node:test';
import {restoreChannelRegistrationForCategory,publishRegistrationIdentity} from '../lib/publish-registration-draft';
import {registrationPatches,registrationValueAt,setRegistrationValue} from '../lib/channel-registration-form';
import type {ActiveChannelKey} from '../lib/channels/catalog';

test('Qoo10 category selection preserves saved food copy through the next save and reload',()=>{
 const before={params:{SecondSubCat:'',ItemTitle:'自動商品名',ItemDescription:'自動説明',BrandNo:'',ItemPrice:'1000'}};
 const edited={params:{...before.params,ItemTitle:'確認済み商品名',ItemDescription:'販売者が確認した原材料と栄養表示',BrandNo:'old-brand',ItemPrice:'999'}};
 const stored={categoryId:'',patches:registrationPatches(before,edited)};
 const next={params:{...before.params,SecondSubCat:'320000596',BrandNo:'official-brand',ItemPrice:'3000'}};
 const restored=restoreChannelRegistrationForCategory('qoo10',next,stored,'320000596');
 assert.equal(registrationValueAt(restored,['params','ItemDescription']),edited.params.ItemDescription);
 assert.equal(registrationValueAt(restored,['params','ItemTitle']),edited.params.ItemTitle);
 assert.equal(registrationValueAt(restored,['params','SecondSubCat']),'320000596');
 assert.equal(registrationValueAt(restored,['params','BrandNo']),'official-brand');
 assert.equal(registrationValueAt(restored,['params','ItemPrice']),'3000');
 const saved={categoryId:'320000596',patches:registrationPatches(next,restored)};
 assert.deepEqual(restoreChannelRegistrationForCategory('qoo10',next,saved,'320000596'),restored);
});

test('every channel restores only its exact scalar copy paths on category change',()=>{
 const cases: [ActiveChannelKey,string[],string[]][]=[
  ['qoo10',['params','ItemDescription'],['params','BrandNo']],
  ['shopee',['body','description'],['body','attribute_list']],
  ['lazada',['request','Request','Product','Attributes','description'],['request','Request','Product','Attributes','flavour']],
  ['coupang',['body','items','0','contents','0','contentDetails','0','content'],['body','displayCategoryCode']],
  ['elevenst',['product','htmlDetail'],['product','dispCtgrNo']],
  ['smartstore',['body','originProduct','detailContent'],['body','originProduct','leafCategoryId']],
  ['temu',['body','goodsBasic','goodsDesc'],['body','goodsBasic','extCatName']],
  ['ebay',['offer','listingDescription'],['offer','categoryId']],
 ];
 for(const [channel,path,dependent] of cases){
  const base=setRegistrationValue(setRegistrationValue({},path,'generated'),dependent,'new-official');
  const result=restoreChannelRegistrationForCategory(channel,base,{categoryId:'old',patches:[{path,value:'seller-confirmed'},{path:dependent,value:'old-dependent'},{path:['shipping'],value:'old-logistics'},{path:['price'],value:5}]},'new');
  assert.equal(registrationValueAt(result,path),'seller-confirmed',channel);
  assert.equal(registrationValueAt(result,dependent),'new-official',channel);
  assert.equal(registrationValueAt(result,['shipping']),undefined);
  assert.equal(registrationValueAt(result,['price']),undefined);
 }
});

test('array patches project only scalar copy leaves and reject injected objects or missing paths',()=>{
 const base={body:{items:[{contents:[{contentDetails:[{content:'generated'}]}],salePrice:3000}]}};
 const patch={path:['body','items'],value:[{contents:[{contentDetails:[{content:'corrected facts'}]}],salePrice:1,attributes:[{name:'old'}]}]};
 const result=restoreChannelRegistrationForCategory('coupang',base,{categoryId:'old',patches:[patch]},'new');
 assert.equal(registrationValueAt(result,['body','items','0','contents','0','contentDetails','0','content']),'corrected facts');
 assert.equal(registrationValueAt(result,['body','items','0','salePrice']),3000);
 assert.equal(registrationValueAt(result,['body','items','0','attributes']),undefined);
 assert.deepEqual(restoreChannelRegistrationForCategory('qoo10',{params:{ItemDescription:'new'}},{categoryId:'old',patches:[{path:['params','ItemDescription'],value:{categoryId:'injected'}},{path:['params','ItemTitle'],value:'absent field'}]},'new'),{params:{ItemDescription:'new'}});
});

test('same-category restoration keeps existing price and other editable patch semantics',()=>{
 const base={params:{SecondSubCat:'same',ItemDescription:'auto',ItemPrice:'1000',ShippingNo:'new'}};
 const edited={params:{...base.params,ItemDescription:'saved',ItemPrice:'2000',ShippingNo:'seller-approved'}};
 assert.deepEqual(restoreChannelRegistrationForCategory('qoo10',base,{categoryId:'same',patches:registrationPatches(base,edited)},'same'),edited);
});

test('initial category selection preserves eBay policies and warehouse through save/reload, but replaces category, brand and price',()=>{
 const base={offer:{categoryId:'',listingDescription:'copy',listingPolicies:{fulfillmentPolicyId:'SERVER_MANAGED',paymentPolicyId:'SERVER_MANAGED',returnPolicyId:'SERVER_MANAGED'},merchantLocationKey:'SERVER_MANAGED',pricingSummary:{price:{value:'10'}}},inventoryItem:{product:{brand:'generated'}}};
 const edited=structuredClone(base);
 edited.offer.listingPolicies={fulfillmentPolicyId:'fulfillment',paymentPolicyId:'payment',returnPolicyId:'returns'};
 edited.offer.merchantLocationKey='warehouse';edited.offer.pricingSummary.price.value='99';edited.inventoryItem.product.brand='old-brand';
 const next=structuredClone(base);next.offer.categoryId='179188';next.offer.pricingSummary.price.value='12';next.inventoryItem.product.brand='current-brand';
 const restored=restoreChannelRegistrationForCategory('ebay',next,{categoryId:'',patches:registrationPatches(base,edited)},'179188') as typeof next;
 assert.deepEqual(restored.offer.listingPolicies,edited.offer.listingPolicies);
 assert.equal(restored.offer.merchantLocationKey,'warehouse');
 assert.equal(restored.offer.categoryId,'179188');assert.equal(restored.offer.pricingSummary.price.value,'12');assert.equal(restored.inventoryItem.product.brand,'current-brand');
 const saved={categoryId:'179188',patches:registrationPatches(next,restored)};
 assert.deepEqual(restoreChannelRegistrationForCategory('ebay',next,saved,'179188'),restored);
});

test('SmartStore policy scalar values survive while certification and unit-price declarations require category review',()=>{
 const base={body:{originProduct:{leafCategoryId:'new',salePrice:3000,deliveryInfo:{deliveryCompany:'',deliveryFee:{baseFee:null as number|null},claimDeliveryInfo:{shippingAddressId:'',returnAddressId:'',returnDeliveryFee:''}},detailAttribute:{certificationTargetExcludeContent:{childCertifiedProductExclusionYn:null},unitPrice:{totalCapacityValue:''},optionInfo:{}}}}};
 const ancestor={path:['body','originProduct'],value:{leafCategoryId:'old',salePrice:1,deliveryInfo:{deliveryCompany:'CJGLS',deliveryFee:{baseFee:3000},claimDeliveryInfo:{shippingAddressId:'123',returnAddressId:'456',returnDeliveryFee:3000,extraUnsafe:'not-carried'}},detailAttribute:{certificationTargetExcludeContent:{childCertifiedProductExclusionYn:true},unitPrice:{totalCapacityValue:500},optionInfo:{old:'not-carried'}}}};
 const result=restoreChannelRegistrationForCategory('smartstore',base,{categoryId:'',patches:[ancestor]},'new') as typeof base;
 assert.deepEqual(result.body.originProduct.deliveryInfo,{deliveryCompany:'CJGLS',deliveryFee:{baseFee:3000},claimDeliveryInfo:{shippingAddressId:'123',returnAddressId:'456',returnDeliveryFee:3000}});
 assert.deepEqual(result.body.originProduct.detailAttribute,base.body.originProduct.detailAttribute);
 assert.equal(result.body.originProduct.salePrice,3000);assert.equal(result.body.originProduct.leafCategoryId,'new');
});

test('only explicit policy leaves carry across categories; malformed objects and absent fields do not',()=>{
 const cases:[ActiveChannelKey,string[]][]=[['qoo10',['params','ShippingNo']],['coupang',['body','outboundShippingPlaceCode']],['elevenst',['product','addrSeqOut']]];
 for(const [channel,path] of cases){
  const base=setRegistrationValue({},path,'');
  assert.equal(registrationValueAt(restoreChannelRegistrationForCategory(channel,base,{categoryId:'old',patches:[{path,value:'123'}]},'new'),path),'123');
  assert.deepEqual(restoreChannelRegistrationForCategory(channel,base,{categoryId:'old',patches:[{path,value:{categoryId:'bad'}}]},'new'),base);
  assert.deepEqual(restoreChannelRegistrationForCategory(channel,{}, {categoryId:'old',patches:[{path,value:'123'}]},'new'),{});
 }
});


test('registration bank does not transfer policies across channel, credential, market or target',()=>{
 const base={offer:{categoryId:'new',listingPolicies:{fulfillmentPolicyId:''},merchantLocationKey:''}};
 const identity=publishRegistrationIdentity('ebay','US','EBAY_US','credential-a');
 const bank:Record<string,{categoryId:string;patches:{path:string[];value:string}[]}>= {
  [identity]:{categoryId:'',patches:[{path:['offer','listingPolicies','fulfillmentPolicyId'],value:'seller-policy'},{path:['offer','merchantLocationKey'],value:'seller-warehouse'}]},
 };
 const cases:[ActiveChannelKey,string,string,string][]=[['ebay','US','EBAY_US','credential-b'],['ebay','GB','EBAY_US','credential-a'],['ebay','US','EBAY_GB','credential-a'],['coupang','US','EBAY_US','credential-a']];
 for(const [channel,market,target,credential] of cases) assert.deepEqual(restoreChannelRegistrationForCategory(channel,base,bank[publishRegistrationIdentity(channel,market,target,credential)],'new'),base);
 const same=restoreChannelRegistrationForCategory('ebay',base,bank[identity],'new');
 assert.equal(registrationValueAt(same,['offer','listingPolicies','fulfillmentPolicyId']),'seller-policy');
 assert.equal(registrationValueAt(same,['offer','merchantLocationKey']),'seller-warehouse');
});
