import {bindExternalDetailCopy,externalDetailDigest} from "./external-detail-copy";
import {externalDetailImportRequestSchema,assertExternalDetailImportByteSet} from "./server-external-detail-import";
export const externalDetailManifestContract='sellerpilot_external_detail_manifest_v1';
/** Separate approval source. Never relabels a Studio result or approves its old copy. */
export function approvedExternalDetailManifest(value:unknown){
 try{
  if(!value||typeof value!=='object')return null;
  const row=value as {status:string;current:boolean;request_sha256:string;id:string;approved_detail_version:number;payload:Record<string,unknown>;receipts:Parameters<typeof assertExternalDetailImportByteSet>[1]};
  if(row.status!=='approved'||row.current!==true)return null;
  const {requestSha256,...payload}=row.payload;
  if(requestSha256!==row.request_sha256||externalDetailDigest(payload)!==requestSha256)return null;
  const {actorId,ownerId,contract,originalEvidence,reviewedCopy,audit,...request}=payload;void [actorId,ownerId,contract,originalEvidence,audit];
  const assets=request.assets as {storagePath:string}[];
  const parsed=externalDetailImportRequestSchema.parse({...request,assets:assets.map(({storagePath,...asset})=>{void storagePath;return asset;})});
  assertExternalDetailImportByteSet(parsed,row.receipts);
  const copies=reviewedCopy as Record<string,{document:unknown;reviewNote:string;documentSha256:string}>;
  const validated=bindExternalDetailCopy(Object.fromEntries(Object.entries(copies).map(([locale,entry])=>[locale,{document:entry.document,reviewNote:entry.reviewNote}])),parsed.assets.map(a=>a.role));
  if(externalDetailDigest(validated)!==externalDetailDigest(copies))return null;
  if(assets.some((a,index)=>a.storagePath!==`external-detail/${ownerId}/${parsed.productId}/${parsed.importId}/${parsed.assets[index].assetId}/${parsed.assets[index].sourceSha256}.png`))return null;
  return {contract:externalDetailManifestContract,source:'external_generated' as const,importId:row.id,version:row.approved_detail_version,requestSha256,images:parsed.assets.map((asset,index)=>({...asset,path:assets[index].storagePath,pixelSha256:row.receipts[index].decodedRgbaSha256})),reviewedCopy:validated,publicationScope:'reviewed_external_documents_only' as const};
 }catch{return null;}
}
