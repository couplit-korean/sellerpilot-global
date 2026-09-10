import { createHash } from "node:crypto";
import { z } from "zod";
import { inspectProductDetailImageDocument } from "./product-detail-image-manifest";
import {externalDetailCanonical} from "./external-detail-canonical";
export {externalDetailCanonical} from "./external-detail-canonical";
export const externalDetailDigest = (value: unknown) => createHash("sha256").update(externalDetailCanonical(value)).digest("hex");
const copy = z.object({document:z.object({root:z.record(z.string(),z.unknown()),content:z.array(z.object({type:z.enum(["ImageStoryBlock","StoryBlock","BenefitBlock","CtaBlock"]),props:z.record(z.string(),z.unknown())}).strict()).max(64)}).strict(),reviewNote:z.string().trim().min(1).max(4000)}).strict();
export const externalDetailCopySchema = z.object({ko:copy,ja:copy,en:copy}).strict();
export const externalDetailAuditSchema = z.object({rightsBasis:z.string().trim().min(1).max(4000),limitations:z.string().trim().min(1).max(4000),sourceReferences:z.array(z.object({label:z.string().trim().min(1).max(240),sha256:z.string().regex(/^[a-f0-9]{64}$/u),url:z.string().url().startsWith("https://").max(2000).optional()}).strict()).min(1).max(32)}).strict();
export function bindExternalDetailCopy(input:unknown,roles:readonly string[]) {
 const copies=externalDetailCopySchema.parse(input);
 return Object.fromEntries(Object.entries(copies).map(([locale,entry])=>{
  const inspection=inspectProductDetailImageDocument(entry.document);
  if(!inspection.ok || inspection.images.some((image,index)=>image.role!==roles[index]))throw Error("EXTERNAL_DETAIL_COPY_ROLES_INVALID");
  for(const block of entry.document.content){
   if(block.type==='ImageStoryBlock' && (typeof block.props.caption!=='string'||!block.props.caption.trim()||block.props.caption.length>2000||typeof block.props.body!=="string"||!block.props.body.includes(block.props.caption)))throw Error("EXTERNAL_DETAIL_CAPTION_REQUIRED");
   for(const [key,value]of Object.entries(block.props))if(/url|html|script/i.test(key)&&key!=='imageUrl'&&value)throw Error("EXTERNAL_DETAIL_COPY_UNSAFE_FIELD");
  }
  return [locale,{...entry,documentSha256:externalDetailDigest(entry.document)}];
 }));
}
