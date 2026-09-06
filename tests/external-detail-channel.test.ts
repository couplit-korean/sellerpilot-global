import test from 'node:test';import assert from 'node:assert/strict';
import {bindExternalDetailChannelCopy,selectExternalDetailChannel,type ExternalDetailChannelSelection} from '../lib/server-external-detail-channel';
import {listingExpectedPublicationLocale} from '../lib/channels/listing-publication-state';
const selected=(channel:string)=>({channel,title:'Reviewed title',plain:'Reviewed plain body',html:'<p>Reviewed rich body</p>',language:'en',locale:'en-SG',sections:[{heading:'Reviewed section',body:'Reviewed body',imageAsset:'detail-overview',imageAltText:'Reviewed alt'}]} as ExternalDetailChannelSelection);
const base=()=>({sellerpilotAssets:{classification:{displayName:'OLD DEGRADED'},localizedDetailSections:[{body:'OLD DEGRADED'}]}});
for(const channel of ['qoo10','shopee','lazada','coupang','elevenst','smartstore','ebay','temu'])test('external replaces '+channel+' detail without retaining old copy',()=>{
 const payloads:Record<string,Record<string,unknown>>={qoo10:{params:{ItemTitle:'OLD DEGRADED',ItemDescription:'OLD DEGRADED'}},shopee:{body:{description:'OLD DEGRADED',global_item_name:'OLD DEGRADED'},publish:{item:{description:'OLD DEGRADED',item_name:'OLD DEGRADED'}}},lazada:{request:{Request:{Product:{Attributes:{name:'OLD DEGRADED',description:'OLD DEGRADED'}}}}},coupang:{body:{sellerProductName:'OLD DEGRADED',items:[{itemName:'OLD DEGRADED',contents:['OLD DEGRADED']}]}},elevenst:{product:{prdNm:'OLD DEGRADED',htmlDetail:'OLD DEGRADED'},productPatch:{htmlDetail:'OLD DEGRADED'}},smartstore:{body:{originProduct:{name:'OLD DEGRADED',detailContent:'OLD DEGRADED'}}},ebay:{inventoryItem:{product:{title:'OLD DEGRADED',description:'OLD DEGRADED'}},offer:{listingDescription:'OLD DEGRADED'}},temu:{body:{goodsBasic:{goodsName:'OLD DEGRADED',goodsDesc:'OLD DEGRADED',bulletPoints:['OLD DEGRADED']}}}};
 const input={...base(),...payloads[channel]};const snapshot=structuredClone(input);const result=bindExternalDetailChannelCopy(input,selected(channel));assert.doesNotMatch(JSON.stringify(result),/OLD DEGRADED/);assert.deepEqual(input,snapshot);assert.ok(result.sellerpilotExternalDetail);
 if(channel==='shopee')assert.equal((result.body as Record<string,unknown>).description,'Reviewed plain body');
});
test('existing market locale requirements remain authoritative, never English fallback for MY',()=>{assert.equal(listingExpectedPublicationLocale('shopee','MY'),'ms-MY');assert.equal(listingExpectedPublicationLocale('qoo10','JP'),'ja-JP');assert.equal(listingExpectedPublicationLocale('ebay','DE'),'de-DE');});
test('long approved plain copy is rejected instead of silently dropping reviewed disclosures',()=>{assert.throws(()=>bindExternalDetailChannelCopy({...base(),body:{}},{...selected('shopee'),plain:'x'.repeat(3001)}),/CHANNEL_LIMIT/);});
test('immutable approval revision reaches the final gateway payload and partial bindings fail closed',()=>{
 const context=approval();
 Object.assign(context.externalDetailImport,{approvalRevision:3,contentSha256:'b'.repeat(64)});
 const selection=selectExternalDetailChannel(context).external;
 assert.equal(selection.approvalRevision,3);
 assert.equal(selection.contentSha256,'b'.repeat(64));
 const bound=bindExternalDetailChannelCopy({...base(),params:{}},selection);
 assert.equal((bound.sellerpilotExternalDetail as Record<string,unknown>).approvalRevision,3);
 assert.equal((bound.sellerpilotExternalDetail as Record<string,unknown>).contentSha256,'b'.repeat(64));
 delete context.externalDetailImport.contentSha256;
 assert.throws(()=>selectExternalDetailChannel(context),/APPROVAL_REVISION_INVALID/);
});

import {bindExternalDetailImportRequest} from '../lib/server-external-detail-import';
import {bindExternalDetailCopy,externalDetailDigest} from '../lib/external-detail-copy';
import {defaultProductDetailImageRoles} from '../lib/product-detail-image-manifest';
import {approvedProductDetailManifestFromPublishContext,bindMarketplaceArgumentsToApprovedDetailManifest} from '../lib/server-product-detail-manifest';
import {externalDetailPreparedSectionsMatch} from '../lib/server-external-detail-channel';
export function approval(){
 const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const productId='1ed4acfc-7603-48ec-a638-241131e59358',owner=id(1),time='2026-09-05T12:00:00.123456+00:00',reference='a'.repeat(64);
 const context={actorId:owner,ownerId:owner,productId,productUpdatedAt:time,detailVersion:1,aiJobId:id(2),verifiedReferenceSha256s:[reference]};
 const assets=defaultProductDetailImageRoles.map((role,i)=>({assetId:id(i+10),role,originalFileName:`${i}.png`,mediaType:'image/png',byteLength:100,sourceSha256:String(i).repeat(64),alt:'Reviewed alt',caption:'Staged. Props excluded. Packaging varies.'}));
 const base=bindExternalDetailImportRequest({importId:id(3),productId,expectedProductUpdatedAt:time,expectedDetailVersion:1,expectedAiJobId:id(2),source:{kind:'external_generated',tool:'fixture',referenceSha256s:[reference]},assets,imageRightsConfirmed:true,regeneratedPreviewAcknowledged:true},context);
 const reviewedCopy=bindExternalDetailCopy(Object.fromEntries(['ko','ja','en'].map(locale=>[locale,{reviewNote:'Human review '+locale,document:{root:{},content:assets.map((a,i)=>({type:'ImageStoryBlock',props:{id:String(i),title:`Reviewed ${locale} ${i}`,imageRole:a.role,imageUrl:`sellerpilot-asset://${a.role}`,imageAlt:a.alt,caption:a.caption,body:`${locale} `+a.caption}}))}}])),assets.map(a=>a.role));
 const {requestSha256:prior,...rest}=base;void prior;const payload={...rest,reviewedCopy,originalEvidence:[{path:'original',sha256:reference}],audit:{rightsBasis:'owner review',limitations:'staged'}};
 const requestSha256=externalDetailDigest(payload);
 const row={id:id(3),status:'approved',current:true,approved_detail_version:2,approved_product_updated_at:time,request_sha256:requestSha256,payload:{...payload,requestSha256},receipts:assets.map(a=>({...a,decodedRgbaSha256:a.sourceSha256,verification:'bytes_only_not_approved'}))};
 return {detailAssetSource:'external_generated',externalDetailProductId:productId,externalDetailChannel:'qoo10',externalDetailMarket:'JP',externalDetailImport:row,studioResult:{degraded:true}};
}
test('approved import selects exact Japanese document and passes its independent image gate',()=>{const context=approval();const approved=approvedProductDetailManifestFromPublishContext(context);assert.equal(approved.ok,true);if(!approved.ok)return;assert.equal(approved.value.external?.language,'ja');assert.match(approved.value.external!.html,/Reviewed ja/);assert.doesNotMatch(approved.value.external!.html,/Reviewed ko/);const bound=bindMarketplaceArgumentsToApprovedDetailManifest({...base(),params:{ItemDescription:'OLD DEGRADED'}},approved.value,defaultProductDetailImageRoles.map((_,i)=>`https://example.test/${i}.png`));assert.equal(externalDetailPreparedSectionsMatch(bound,bound.sellerpilotAssets as Record<string,unknown>),true);assert.doesNotMatch(JSON.stringify(bound),/OLD DEGRADED/);});
test('missing market copy, stale approval, wrong product, modified locale document or pixel hash reject',()=>{for(const kind of ['locale','stale','product','document','pixels']){const context=approval();if(kind==='locale'){context.externalDetailChannel='shopee';context.externalDetailMarket='MY';}if(kind==='stale')context.externalDetailImport.current=false;if(kind==='product')context.externalDetailProductId='00000000-0000-4000-8000-000000000099';if(kind==='document')context.externalDetailImport.payload.reviewedCopy.ja.document.content[0].props.body='tampered';if(kind==='pixels')context.externalDetailImport.receipts[0].decodedRgbaSha256=context.externalDetailImport.receipts[1].decodedRgbaSha256;assert.equal(approvedProductDetailManifestFromPublishContext(context).ok,false,kind);}});
