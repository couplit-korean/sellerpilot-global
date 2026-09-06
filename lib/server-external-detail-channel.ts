import { listingPublicationContentProjection } from "./channels/listing-publication-content";
import {createHash} from 'node:crypto';
import {productDetailDataToHtml} from '../app/_publishing/product-detail-html';
import type {ProductDetailData} from '../app/product-detail-puck';
import {listingExpectedPublicationLocale} from './channels/listing-publication-state';
import {approvedExternalDetailManifest} from './server-external-detail-manifest';
import {canonicalProductDetailImageManifestInput,productDetailImageManifestContract} from './product-detail-image-manifest';
import {externalDetailDigest} from './external-detail-copy';
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export function selectExternalDetailChannel(context:Record<string,unknown>){
 const manifest=approvedExternalDetailManifest(context.externalDetailImport);
 const row=record(context.externalDetailImport),payload=record(row.payload);
 const channel=String(context.externalDetailChannel??''),market=String(context.externalDetailMarket??'');
 const locale=listingExpectedPublicationLocale(channel,market),language=locale?.split('-')[0];
 if(!manifest||context.externalDetailProductId!==payload.productId||row.id!==manifest.importId||Number(row.approved_detail_version)!==manifest.version)throw Error('EXTERNAL_DETAIL_APPROVAL_MISMATCH');
 if(!locale||!language||!['ko','ja','en'].includes(language))throw Error('EXTERNAL_DETAIL_MARKET_LOCALE_NOT_REVIEWED');
 const copy=manifest.reviewedCopy[language];if(!copy||externalDetailDigest(copy.document)!==copy.documentSha256)throw Error('EXTERNAL_DETAIL_COPY_HASH_MISMATCH');
 const document=copy.document as unknown as ProductDetailData;
 const html=productDetailDataToHtml(document,locale);
 const plain=html.replace(/\{\{SELLERPILOT_IMAGE:detail-[a-z-]+\}\}/gu,'').replace(/<\/(?:p|h[1-6]|section|li|div)>/gu,'\n').replace(/<[^>]*>/gu,'').replace(/&quot;/gu,'"').replace(/&#39;/gu,"'").replace(/&lt;/gu,'<').replace(/&gt;/gu,'>').replace(/&amp;/gu,'&').replace(/\n{3,}/gu,'\n\n').trim();
 const blocks=copy.document.content;
 const title=blocks.map(block=>record(block.props).title).find(value=>typeof value==='string'&&value.trim());
 if(typeof title!=='string'||!html||!plain)throw Error('EXTERNAL_DETAIL_REVIEWED_TITLE_REQUIRED');
 const sections=blocks.filter(block=>block.type==='ImageStoryBlock').map(block=>({type:'overview',heading:String(block.props.title??''),body:String(block.props.body??''),imageAsset:String(block.props.imageRole),imageAltText:String(block.props.imageAlt),...(typeof block.props.evidence==='string'?{evidence:block.props.evidence}:{})}));
 if(sections.some(s=>!s.heading||!s.body))throw Error('EXTERNAL_DETAIL_SECTION_COPY_REQUIRED');
 const images=manifest.images.map(image=>({role:image.role,path:image.path,sourceSha256:image.sourceSha256}));
 return {version:manifest.version,manifest:{contract:productDetailImageManifestContract as typeof productDetailImageManifestContract,algorithm:'sha256' as const,digest:createHash('sha256').update(canonicalProductDetailImageManifestInput(images)).digest('hex'),images},external:{contract:'sellerpilot_external_detail_channel_v1',productId:payload.productId,ownerId:payload.ownerId,importId:manifest.importId,version:manifest.version,productUpdatedAt:row.approved_product_updated_at,requestSha256:manifest.requestSha256,locale,language,channel,market,documentSha256:copy.documentSha256,allLocaleDocumentSha256:Object.fromEntries(Object.entries(manifest.reviewedCopy).map(([key,value])=>[key,value.documentSha256])),imageSha256s:images.map(i=>i.sourceSha256),pixelSha256s:manifest.images.map(i=>i.pixelSha256),title:title.trim(),html,plain,sections}};
}
export type ExternalDetailChannelSelection=ReturnType<typeof selectExternalDetailChannel>['external'];
/** Replaces all provider detail copy; no old localized listing or client detail survives. */
export function bindExternalDetailChannelCopy(input:Record<string,unknown>,selection:ExternalDetailChannelSelection){
 const next=structuredClone(input);const body=record(next.body);const product=record(next.product);const params=record(next.params);
 const {channel,title,plain,html}=selection;
 const limits:Record<string,number>={qoo10:100,shopee:120,lazada:255,coupang:100,elevenst:100,smartstore:100,ebay:80,temu:500};
 if([...title].length>(limits[channel]??0)||(channel==='shopee'&&[...plain].length>3000)||(channel==='temu'&&[...plain].length>10000))throw Error('EXTERNAL_DETAIL_COPY_CHANNEL_LIMIT');
 if(channel==='qoo10'){if(!next.params)throw Error('EXTERNAL_DETAIL_PROVIDER_SHAPE');Object.assign(params,{ItemTitle:title,ItemDescription:html,PromotionName:'',Keyword:''});}
 else if(channel==='shopee'){
  if(!next.body)throw Error('EXTERNAL_DETAIL_PROVIDER_SHAPE');const targets=[body,...(record(next.publish).item?[record(record(next.publish).item)]:[])];
  for(const item of targets){item.description=plain;delete item.description_info;if('description_type'in item)item.description_type='normal';if('global_item_name'in item)item.global_item_name=title;else item.item_name=title;}
 }else if(channel==='lazada'){const attributes=record(record(record(record(next.request).Request).Product).Attributes);if(!Object.keys(attributes).length)throw Error('EXTERNAL_DETAIL_PROVIDER_SHAPE');Object.assign(attributes,{name:title,description:html,short_description:''});}
 else if(channel==='coupang'){if(!Array.isArray(body.items))throw Error('EXTERNAL_DETAIL_PROVIDER_SHAPE');Object.assign(body,{sellerProductName:title,displayProductName:title});for(const raw of body.items){const item=record(raw);item.itemName=title;item.contents=[{contentsType:'TEXT',contentDetails:[{content:html,detailType:'TEXT'}]}];}}
 else if(channel==='elevenst'){if(!next.product)throw Error('EXTERNAL_DETAIL_PROVIDER_SHAPE');Object.assign(product,{prdNm:title,htmlDetail:html});if(next.productPatch)Object.assign(record(next.productPatch),{prdNm:title,htmlDetail:html});}
 else if(channel==='smartstore'){const origin=record(body.originProduct);if(!body.originProduct)throw Error('EXTERNAL_DETAIL_PROVIDER_SHAPE');Object.assign(origin,{name:title,detailContent:html});const detail=record(origin.detailAttribute);if(detail.seoInfo)delete detail.seoInfo;}
 else if(channel==='temu'){const goods=record(body.goodsBasic);if(!body.goodsBasic)throw Error('EXTERNAL_DETAIL_PROVIDER_SHAPE');body.language=selection.language;Object.assign(goods,{goodsName:title,goodsDesc:plain,bulletPoints:[]});}
 else if(channel==='ebay'){const inventory=record(next.inventoryItem),item=record(inventory.product);if(!inventory.product)throw Error('EXTERNAL_DETAIL_PROVIDER_SHAPE');Object.assign(item,{title,description:html});if(next.offer)record(next.offer).listingDescription=html;}
 else throw Error('EXTERNAL_DETAIL_CHANNEL_UNSUPPORTED');
 const assets=record(next.sellerpilotAssets);delete assets.classification;
 Object.assign(assets,{localizedDetailSections:selection.sections,thumbnailAltText:title,detailSource:'external_generated'});next.sellerpilotAssets=assets;
 // Request fingerprint binds complete export + locale and source digests, not signed URL expiry.
 next.sellerpilotExternalDetail={...selection,exportSha256:externalDetailDigest({title,html,plain,sections:selection.sections})};
 return next;
}

/** Dedicated source branch: do not invent Studio classification/questions to pass its learned-section gate. */
export function externalDetailPreparedSectionsMatch(argumentsValue:Record<string,unknown>,assets:Record<string,unknown>){
 const binding=record(argumentsValue.sellerpilotExternalDetail);
 if(binding.contract!=='sellerpilot_external_detail_channel_v1'||assets.detailSource!=='external_generated'||!Array.isArray(binding.sections)||binding.sections.length!==8)return false;
 if(externalDetailDigest({title:binding.title,html:binding.html,plain:binding.plain,sections:binding.sections})!==binding.exportSha256)return false;
 if(externalDetailDigest(assets.localizedDetailSections)!==externalDetailDigest(binding.sections))return false;
 const roles=assets.detailImageRoles,alts=assets.detailImageAltTexts,hashes=assets.approvedDetailImageSha256s;
 if(!Array.isArray(roles)||!Array.isArray(alts)||roles.length!==8||alts.length!==8||new Set(roles).size!==8||externalDetailDigest(hashes)!==externalDetailDigest(binding.imageSha256s))return false;
 const sections=binding.sections as unknown[];
 return roles.every((role,index)=>{const section=sections.find((raw:unknown)=>record(raw).imageAsset===role);return section&&record(section).imageAltText===alts[index]&&typeof record(section).body==='string'&&String(record(section).body).trim().length>0;});
}

export function externalDetailChannelPayloadMatches(input:Record<string,unknown>){
 if(input.sellerpilotExternalDetail===undefined)return true;
 try{
  const binding=record(input.sellerpilotExternalDetail) as ExternalDetailChannelSelection & {exportSha256:string};
  if(binding.contract!=="sellerpilot_external_detail_channel_v1"||externalDetailDigest({title:binding.title,html:binding.html,plain:binding.plain,sections:binding.sections})!==binding.exportSha256)return false;
  const expected=bindExternalDetailChannelCopy(input,binding);
  const channel=binding.channel as Parameters<typeof listingPublicationContentProjection>[0];
  const actualProjection=listingPublicationContentProjection(channel,"source",input,"");
  const expectedProjection=listingPublicationContentProjection(channel,"source",expected,"");
  return externalDetailDigest(actualProjection.titleParts)===externalDetailDigest(expectedProjection.titleParts)&&actualProjection.description===expectedProjection.description;
 }catch{return false;}
}
