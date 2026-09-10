import { z } from "zod";
import { activeChannelKeys, type ActiveChannelKey } from "./channels/catalog";
import { registrationPatches, applyRegistrationPatches, type RegistrationPatch } from "./channel-registration-form";
const fieldsSchema=z.object({productName:z.string(),description:z.string(),brandName:z.string(),manufacturer:z.string(),countryOfOrigin:z.string(),material:z.string(),packageContents:z.string()}).partial();
export const publishRegistrationDataSchema=z.object({
  schemaVersion:z.literal(1),sourceFingerprint:z.string().max(50000),
  common:z.object({fields:fieldsSchema,price:z.number().finite(),globalBaseUsdPrice:z.number().finite(),quantity:z.number().finite(),packageFields:z.object({weight:z.number().finite(),length:z.number().finite(),width:z.number().finite(),height:z.number().finite()})}),
  channels:z.record(z.string(),z.object({categoryId:z.string(),patches:z.array(z.object({path:z.array(z.string().min(1)).min(1).max(16),value:z.unknown()})).max(1500)})),
}).strict();
export type PublishRegistrationData=z.infer<typeof publishRegistrationDataSchema>;
export function publishRegistrationIdentity(channel: ActiveChannelKey,market:string,targetId:string,credentialId:string) {
  return JSON.stringify([channel,market,targetId,credentialId]);
}
export function editableCommonFacts(fields:Record<string,unknown>) {
  return fieldsSchema.parse(Object.fromEntries(Object.entries(fields).filter(([key])=>["productName","description","brandName","manufacturer","countryOfOrigin","material","packageContents"].includes(key))));
}
export function preserveChannelRegistrationEdits(base:Partial<Record<ActiveChannelKey,string>>,current:Partial<Record<ActiveChannelKey,string>>,next:Partial<Record<ActiveChannelKey,string>>) {
  const output={...next};
  for(const channel of activeChannelKeys) {
    if(!base[channel]||!current[channel]||!next[channel])continue;
    try {
      const before=JSON.parse(base[channel]!);const edited=JSON.parse(current[channel]!);const after=JSON.parse(next[channel]!);
      output[channel]=JSON.stringify(applyRegistrationPatches(after,registrationPatches(before,edited)),null,2);
    } catch { output[channel]=current[channel]; }
  }
  return output;
}
export function restoreChannelRegistrationPatches(base:Record<string,unknown>,patches:unknown) {
  if(!Array.isArray(patches))throw Error("REGISTRATION_PATCHES_INVALID");
  return applyRegistrationPatches(base,patches as RegistrationPatch[]);
}
