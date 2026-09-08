import { createHash } from "node:crypto";
import type { ActiveChannelKey } from "./catalog";
import type { ChannelOperationName } from "./operation-names";
export const csCredentialBindingContract="sellerpilot-cs-credential-binding/1" as const;
const text=(value:unknown)=>typeof value==="string"||typeof value==="number"?String(value).trim():"";
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
export function csCredentialBindingEvidence(input:{channel:ActiveChannelKey;operation:ChannelOperationName;credential:Record<string,unknown>;request:Record<string,unknown>}){
 if(!["inquiries.list","inquiries.reply"].includes(input.operation))return null;
 const args=record(input.request.arguments);const c=input.credential;
 const appParts=[c.partner_id,c.app_key,c.client_id,c.application_id,c.seller_id,c.vendor_id,c.access_key].map(text).filter(Boolean);
 const tokenParts=[c.access_token,c.api_key,c.open_api_key,c.refresh_token,c.partner_key,c.app_secret,c.client_secret,c.secret_key].map(text).filter(Boolean);
 const targetIds=new Set<string>();
 for(const value of[c.shop_id,c.account_id,args.shopId,args.shop_id,args.accountId,args.account_id,args.sellerId,args.vendorId,c.seller_id,c.vendor_id,c.provider_account_subject,c.marketplace_id,args.marketplaceId]){const id=text(value);if(id)targetIds.add(id);}
 if(Array.isArray(c.shop_ids))for(const value of c.shop_ids){const id=text(value);if(id)targetIds.add(id);}
 if(Array.isArray(c.shopee_targets))for(const value of c.shopee_targets){const id=text(record(value).id);if(id)targetIds.add(id);}
 if(!appParts.length||!tokenParts.length||!targetIds.size)return null;
 const country=text(args.country||c.country||c.region||args.marketplaceId||c.marketplace_id).toUpperCase().slice(0,40)||"UNSCOPED";
 return{contract:csCredentialBindingContract,channel:input.channel,operation:input.operation,
  appFingerprint:digest(appParts.join("\u001f")),tokenFingerprint:digest(tokenParts.join("\u001f")),
  targetFingerprints:[...targetIds].sort().map(digest),country};
}
