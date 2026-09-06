import {createHash} from "node:crypto";
import {NextResponse} from "next/server";
import {z} from "zod";
import {authenticateAdminRequest,isAdminApiError,type AdminApiContext} from "./admin-api";
import {bindExternalDetailImportRequest,externalDetailImportRequestSchema,inspectExternalDetailImportPng,assertExternalDetailImportByteSet} from "./server-external-detail-import";
import {bindExternalDetailCopy,externalDetailAuditSchema,externalDetailDigest} from "./external-detail-copy";
export const externalDetailImportTarget='1ed4acfc-7603-48ec-a638-241131e59358';
const bucket='sellerpilot-detail-imports';
const uuid=z.string().uuid();
type Row={id:string;status:string;expires_at:string;request_sha256:string;current?:boolean;payload:ReturnType<typeof bindExternalDetailImportRequest>&{reviewedCopy:ReturnType<typeof bindExternalDetailCopy>;audit:z.infer<typeof externalDetailAuditSchema>;originalEvidence:{path:string;sha256:string}[]}};
async function rpc(admin:AdminApiContext,product:string,action:string,id:string|null=null,payload:unknown={}){
 const result=await admin.serviceClient.rpc('sellerpilot_service_external_detail_import',{p_action:action,p_actor:admin.user.id,p_product:product,p_import:id,p_payload:payload});
 if(result.error)throw Error(result.error.message.startsWith('EXTERNAL_DETAIL_')?result.error.message:'EXTERNAL_DETAIL_BACKEND_UNAVAILABLE');
 if(!result.data)throw Error('EXTERNAL_DETAIL_NOT_FOUND');return result.data;
}
async function limited(request:Request,max:number){
 if(!request.body)throw Error('EXTERNAL_DETAIL_BODY_INVALID');const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>max){await reader.cancel();throw Error('EXTERNAL_DETAIL_BODY_TOO_LARGE');}chunks.push(part.value);}}finally{reader.releaseLock();}
 return Buffer.concat(chunks);
}
async function originals(admin:AdminApiContext,paths:string[],owner:string){
 if(!paths.length||paths.length>16||paths.some(path=>!path.startsWith(`${owner}/`)||path.includes('..')))throw Error('EXTERNAL_DETAIL_ORIGINALS_REQUIRED');
 const result=[];for(const path of paths){const blob=await admin.serviceClient.storage.from('sellerpilot-ai').download(path);if(blob.error||!blob.data||blob.data.size>10*1024*1024||!blob.data.size)throw Error('EXTERNAL_DETAIL_ORIGINALS_UNAVAILABLE');result.push({path,sha256:createHash('sha256').update(Buffer.from(await blob.data.arrayBuffer())).digest('hex')});}return result;
}
export async function readExternalDetailImportContext(admin:AdminApiContext,product:string){return rpc(admin,product,'context');}
export async function externalDetailImportHandler(request:Request,product:string){
 const admin=await authenticateAdminRequest(request);if(isAdminApiError(admin))return admin;
 const respond=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'cache-control':'no-store, max-age=0'}});
 try{
  if(product!==externalDetailImportTarget)return respond({code:'EXTERNAL_DETAIL_TARGET_FORBIDDEN',message:'이 가져오기는 지정된 기존 상품 전용입니다.'},403);
  const url=new URL(request.url);
  if(request.method==='GET'){const id=url.searchParams.get('importId');if(id)return respond({import:await rpc(admin,product,'get',uuid.parse(id))});const current=await rpc(admin,product,'context');return respond({...current,originalEvidence:await originals(admin,current.sourceImagePaths,current.ownerId)});}
  if(request.method==='PUT'){
   const id=uuid.parse(url.searchParams.get('importId'));const assetId=uuid.parse(url.searchParams.get('assetId'));const row:Row=await rpc(admin,product,'get',id);
   if(!['reserved','verified'].includes(row.status)||Date.parse(row.expires_at)<=Date.now())throw Error('EXTERNAL_DETAIL_STATE_CONFLICT');
   const current=await rpc(admin,product,'context');if(current.productUpdatedAt!==row.payload.expectedProductUpdatedAt||current.detailVersion!==row.payload.expectedDetailVersion||current.aiJobId!==row.payload.expectedAiJobId)throw Error('EXTERNAL_DETAIL_VERSION_CONFLICT');
   const asset=row.payload.assets.find(a=>a.assetId===assetId);if(!asset)throw Error('EXTERNAL_DETAIL_ASSET_INVALID');
   const bytes=await limited(request,10*1024*1024);const {storagePath,...declared}=asset;const receipt=await inspectExternalDetailImportPng(declared,bytes);
   const result=await admin.serviceClient.storage.from(bucket).upload(storagePath,bytes,{contentType:'image/png',upsert:false});
   if(result.error){const existing=await admin.serviceClient.storage.from(bucket).download(storagePath);if(existing.error||!existing.data||existing.data.size!==bytes.length)throw Error('EXTERNAL_DETAIL_UPLOAD_CONFLICT');await inspectExternalDetailImportPng(declared,Buffer.from(await existing.data.arrayBuffer()));}
   return respond({ok:true,assetId,receipt});
  }
  const input=JSON.parse((await limited(request,1024*1024)).toString('utf8'));
  if(input.action==='reserve'){
   const body=z.object({action:z.literal('reserve'),request:externalDetailImportRequestSchema,reviewedCopy:z.unknown(),audit:externalDetailAuditSchema}).strict().parse(input);
   const current=await rpc(admin,product,'context');const evidence=await originals(admin,current.sourceImagePaths,current.ownerId);
   let prior:Row|null=null;try{prior=await rpc(admin,product,'get',body.request.importId);}catch(error){if(!(error instanceof Error)||error.message!=='EXTERNAL_DETAIL_NOT_FOUND')throw error;}
   const fence=prior?{...current,productUpdatedAt:prior.payload.expectedProductUpdatedAt,detailVersion:prior.payload.expectedDetailVersion,aiJobId:prior.payload.expectedAiJobId}:current;
   const base=bindExternalDetailImportRequest(body.request,{actorId:admin.user.id,ownerId:current.ownerId,productId:current.productId,productUpdatedAt:fence.productUpdatedAt,detailVersion:fence.detailVersion,aiJobId:fence.aiJobId,verifiedReferenceSha256s:evidence.map(x=>x.sha256)});
   if(evidence.some(x=>!body.request.source.referenceSha256s.includes(x.sha256)))throw Error('EXTERNAL_DETAIL_ORIGINALS_REQUIRED');
   const {requestSha256:_prior,...rest}=base;void _prior;
   const payload={...rest,originalEvidence:evidence,reviewedCopy:bindExternalDetailCopy(body.reviewedCopy,base.assets.map(a=>a.role)),audit:{...body.audit,referenceVerification:'operator_declared_not_server_downloaded',reviewerId:admin.user.id}};
   return respond({import:await rpc(admin,product,'reserve',base.importId,{...payload,requestSha256:externalDetailDigest(payload)})});
  }
  const body=z.object({action:z.enum(['verify','approve','cancel']),importId:uuid,requestSha256:z.string().regex(/^[a-f0-9]{64}$/u).optional(),reviewConfirmed:z.literal(true).optional()}).strict().parse(input);
  const row:Row=await rpc(admin,product,'get',body.importId);
  if(body.action==='cancel')return respond({import:await rpc(admin,product,'cancel',body.importId)});
  if(body.action==='approve'&&(body.requestSha256!==row.request_sha256||body.reviewConfirmed!==true))throw Error('EXTERNAL_DETAIL_REVIEW_REQUIRED');
  const current=await rpc(admin,product,'context');const evidence=await originals(admin,current.sourceImagePaths,current.ownerId);
  if(externalDetailDigest(evidence)!==externalDetailDigest(row.payload.originalEvidence))throw Error('EXTERNAL_DETAIL_ORIGINALS_CHANGED');
  const receipts=[];for(const asset of row.payload.assets){const blob=await admin.serviceClient.storage.from(bucket).download(asset.storagePath);if(blob.error||!blob.data||blob.data.size!==asset.byteLength)throw Error('EXTERNAL_DETAIL_PARTIAL_UPLOAD');const {storagePath:_path,...declared}=asset;void _path;receipts.push(await inspectExternalDetailImportPng(declared,Buffer.from(await blob.data.arrayBuffer())));}
  const {actorId:_actor,ownerId:_owner,contract:_contract,requestSha256:_sha,reviewedCopy:_copies,audit:_audit,originalEvidence:_evidence,...raw}=row.payload;void [_actor,_owner,_contract,_sha,_copies,_audit,_evidence];
  assertExternalDetailImportByteSet({...raw,assets:raw.assets.map(({storagePath,...asset})=>{void storagePath;return asset;})},receipts);
  return respond({import:await rpc(admin,product,body.action,body.importId,{requestSha256:row.request_sha256,receipts,reviewConfirmed:body.reviewConfirmed??false})});
 }catch(error){const message=error instanceof Error?error.message:'';const code=/^EXTERNAL_DETAIL_[A-Z_]+$/.test(message)?message:'EXTERNAL_DETAIL_INPUT_INVALID';return respond({code,message:'가져오기 상태를 확인하지 못했습니다. 같은 importId로 상태를 조회해 주세요.'},code.includes('UNAVAILABLE')?503:code.includes('OWNER')?403:code.includes('INPUT')||code.includes('BODY')?400:409);}
}

export async function verifyExternalDetailOriginalSnapshot(admin:AdminApiContext,current:Record<string,unknown>){
 const row=current.externalDetailImport as Row|undefined;
 if(!row)throw Error('EXTERNAL_DETAIL_APPROVAL_MISMATCH');
 const evidence=await originals(admin,current.sourceImagePaths as string[],String(current.ownerId));
 if(externalDetailDigest(evidence)!==externalDetailDigest(row.payload.originalEvidence))throw Error('EXTERNAL_DETAIL_ORIGINALS_CHANGED');
}
