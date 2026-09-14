import { z } from "zod";
import { activeChannelKeys, type ActiveChannelKey } from "./channels/catalog";
import { registrationPatches, applyRegistrationPatches, registrationValueAt, type RegistrationPatch } from "./channel-registration-form";
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

// Core copy and the separately enumerated seller policies can survive category
// selection. Category attributes, identities, product price, certification and
// brand IDs are rebuilt from the new official category.
const categoryIndependentCopyPaths: Record<ActiveChannelKey, string[][]> = {
  qoo10: [["params", "ItemTitle"], ["params", "PromotionName"], ["params", "ItemDescription"]],
  shopee: [["body", "global_item_name"], ["body", "description"], ["publish", "item", "item_name"], ["publish", "item", "description"]],
  lazada: ["name", "description", "short_description"].map(key => ["request", "Request", "Product", "Attributes", key]),
  coupang: [["body", "sellerProductName"], ["body", "displayProductName"], ["body", "items", "0", "itemName"], ["body", "items", "0", "contents", "0", "contentDetails", "0", "content"]],
  elevenst: [["product", "prdNm"], ["product", "htmlDetail"]],
  smartstore: [["body", "originProduct", "name"], ["body", "originProduct", "detailContent"], ["body", "smartstoreChannelProduct", "channelProductName"]],
  temu: [["body", "goodsBasic", "goodsName"], ["body", "goodsBasic", "goodsDesc"]],
  ebay: [["inventoryItem", "product", "title"], ["inventoryItem", "product", "description"], ["offer", "listingDescription"]],
};
const categoryIndependentPolicyPaths: Partial<Record<ActiveChannelKey, string[][]>> = {
  qoo10: [["params", "ShippingNo"]],
  ebay: [
    ...["fulfillmentPolicyId", "paymentPolicyId", "returnPolicyId"].map(key => ["offer", "listingPolicies", key]),
    ["offer", "merchantLocationKey"],
  ],
  smartstore: [
    ...["deliveryType", "deliveryAttributeType", "deliveryCompany"].map(key => ["body", "originProduct", "deliveryInfo", key]),
    ...["deliveryFeeType", "baseFee", "deliveryFeePayType"].map(key => ["body", "originProduct", "deliveryInfo", "deliveryFee", key]),
    ...["returnDeliveryCompanyPriorityType", "returnDeliveryFee", "exchangeDeliveryFee", "shippingAddressId", "returnAddressId"].map(key => ["body", "originProduct", "deliveryInfo", "claimDeliveryInfo", key]),
  ],
  coupang: ["deliveryMethod", "deliveryCompanyCode", "deliveryChargeType", "deliveryCharge", "freeShipOverAmount", "deliveryChargeOnReturn", "returnCharge", "outboundShippingPlaceCode", "returnCenterCode", "returnChargeName", "companyContactNumber", "returnZipCode", "returnAddress", "returnAddressDetail"].map(key => ["body", key]),
  elevenst: ["dlvCnAreaCd", "dlvWyCd", "dlvCstInstBasiCd", "dlvCst1", "dlvCstPayTypCd", "bndlDlvCnYn", "addrSeqOut", "addrSeqIn", "rtngdDlvCst", "exchDlvCst", "asDetail", "rtngExchDetail"].map(key => ["product", key]),
};
function policyScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

export function restoreChannelRegistrationForCategory(
  channel: ActiveChannelKey,
  base: Record<string, unknown>,
  stored: PublishRegistrationData["channels"][string] | undefined,
  categoryId: string,
) {
  if (!stored) return base;
  if (stored.categoryId === categoryId) return restoreChannelRegistrationPatches(base, stored.patches);
  const copyPatches: RegistrationPatch[] = [];
  for (const path of categoryIndependentCopyPaths[channel]) {
    if (typeof registrationValueAt(base, path) !== "string") continue;
    for (const patch of stored.patches) {
      if (patch.path.length > path.length || !patch.path.every((part, index) => part === path[index])) continue;
      // Arrays can be stored as one patch. Project only the exact approved copy
      // leaf out of that patch; never replay its sibling attributes or prices.
      const value = registrationValueAt(patch.value, path.slice(patch.path.length));
      if (typeof value === "string") copyPatches.push({ path, value });
    }
  }
  // Callers select stored by the exact channel/market/target/credential bank key.
  // Carry only existing, explicit policy leaves; never replace a whole object or
  // project sibling category/credential fields from an ancestor patch.
  for (const path of categoryIndependentPolicyPaths[channel] ?? []) {
    if (!policyScalar(registrationValueAt(base, path))) continue;
    for (const patch of stored.patches) {
      if (patch.path.length > path.length || !patch.path.every((part, index) => part === path[index])) continue;
      const value = registrationValueAt(patch.value, path.slice(patch.path.length));
      if (policyScalar(value)) copyPatches.push({ path, value });
    }
  }
  return applyRegistrationPatches(base, copyPatches);
}
