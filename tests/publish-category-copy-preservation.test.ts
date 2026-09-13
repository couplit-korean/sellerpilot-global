import assert from 'node:assert/strict';
import test from 'node:test';
import {restoreChannelRegistrationForCategory} from '../lib/publish-registration-draft';
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
