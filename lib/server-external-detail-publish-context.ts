import type {AdminApiContext} from './admin-api';
import {approvedExternalDetailManifest} from './server-external-detail-manifest';
import {externalDetailDigest} from './external-detail-copy';
const record=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
/** The DTO is derived ONLY from the owned database snapshot read after approval.
 * It does not call an unguarded predecessor of the legacy Studio RPC.
 */
export function externalDetailPublishContextFromRead(input:unknown,ownerId:string,productId:string){
 const read=record(input),product=record(read?.productRow),job=record(read?.sourceJob),row=record(read?.externalDetailImport),payload=record(row?.payload);
 const manifest=approvedExternalDetailManifest(row);
 if(read?.contract!=='sellerpilot_external_detail_publish_read_v1'||!product||!job||!row||!payload||!manifest
  ||product.id!==productId||product.owner_id!==ownerId||payload.productId!==productId||payload.ownerId!==ownerId||row.product_id!==productId||row.owner_id!==ownerId
  ||product.external_detail_import_id!==row.id||product.updated_at!==row.approved_product_updated_at||product.detail_page_version!==row.approved_detail_version
  ||product.ai_job_id!==job.id||job.createdBy!==ownerId||product.ai_job_id!==payload.expectedAiJobId
  ||typeof product.sku!=='string'||!product.sku||typeof product.name!=='string'||!product.name
  ||externalDetailDigest(product.detail_page_data)!==manifest.reviewedCopy.ko.documentSha256)throw Error('EXTERNAL_DETAIL_PUBLISH_SNAPSHOT_INVALID');
 const request=record(job.requestPayload),result=record(job.resultPayload);
 if(!request||!Array.isArray(request.image_paths)||!request.image_paths.length||request.image_paths.some(p=>typeof p!=='string'||!p.startsWith(`${ownerId}/`)||p.includes('..')))throw Error('EXTERNAL_DETAIL_SOURCE_PATH_INVALID');
 const ownedRows=(value:unknown)=>{if(!Array.isArray(value)||value.some(v=>!record(v)||v.owner_id!==ownerId||v.product_id!==productId))throw Error('EXTERNAL_DETAIL_METADATA_OWNER_MISMATCH');return value as Record<string,unknown>[];};
 const assignments=ownedRows(read.assignments).map(a=>({id:a.id,channel:a.channel,environment:a.environment,market:a.market,categoryId:a.category_id,categoryPath:a.category_path,providedAttributes:a.provided_attributes,status:a.status,confirmedAt:a.confirmed_at}));
 const listingFields={id:'id',channel:'channel_key',market:'market',targetId:'target_id',remoteId:'remote_id',publicUrl:'public_url',publicPageStatus:'public_page_status',publicPageCheckedAt:'public_page_checked_at',status:'status',currency:'currency',price:'price',lastError:'last_error',failureClass:'failure_class',inventorySyncStatus:'inventory_sync_status',lastInventoryQuantity:'last_inventory_quantity',inventorySyncError:'inventory_sync_error',lastInventorySyncedAt:'last_inventory_synced_at',updatedAt:'updated_at',publishedAt:'published_at',sellerAccountKey:'seller_account_key',marketplaceSku:'marketplace_sku',operationAttemptId:'operation_attempt_id',requestedPublicationIntent:'requested_publication_intent',remoteVisibility:'remote_visibility',providerStatus:'provider_status',remoteResources:'remote_resources',remoteCreatedAt:'remote_created_at',remoteVerifiedAt:'last_verified_at'};
 const listings=ownedRows(read.listings).map(l=>Object.fromEntries(Object.entries(listingFields).map(([key,column])=>[key,l[column]??null])));
 const facts=record(product.product_facts);
 return {
  ownerId,contentMode:'external_generated',detailAssetSource:'external_generated',externalDetailImport:row,
  externalDetailSnapshot:{contract:read.contract,productId,ownerId,productUpdatedAt:product.updated_at,detailVersion:product.detail_page_version,requestSha256:manifest.requestSha256},
  product:{id:product.id,externalCode:product.external_code,sku:product.sku,name:product.name,description:product.description,sourceUrl:product.source_url,status:product.status,onHand:product.on_hand,costKrw:product.cost_krw},
  manualFields:facts&&Object.keys(facts).length?facts:record(request.manual_fields)??{},imageSpecs:request.image_specs??[],sourceImagePaths:request.image_paths,
  generatedImagePaths:result?.asset_storage_paths??{},localizedListings:result?.localizedListings??[],studioResult:job.resultPayload,studioJob:{id:job.id,status:job.status,kind:job.kind},
  assignments,listings,classification:null,
  detailPage:{data:product.detail_page_data,version:product.detail_page_version,approvedVersion:product.detail_page_approved_version,imageManifest:product.detail_page_image_manifest,updatedAt:product.detail_page_updated_at},
 };
}
export async function readApprovedExternalDetailPublishContext(admin:AdminApiContext,productId:string){
 const {data,error}=await admin.serviceClient.rpc('sellerpilot_service_external_detail_import',{p_action:'publish_read',p_actor:admin.user.id,p_product:productId,p_import:null,p_payload:{}});
 if(error)throw Error(error.message.startsWith('EXTERNAL_DETAIL_')?error.message:'EXTERNAL_DETAIL_BACKEND_UNAVAILABLE');
 return externalDetailPublishContextFromRead(data,admin.user.id,productId);
}
