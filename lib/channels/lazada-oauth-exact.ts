import { z } from "zod";
import { gatewayClaimSchema } from "./gateway-contract";
import { normalizeLazadaProviderAccountIdentity, readProviderAccountIdentity } from "./provider-account-identity";
import { executeProviderOAuthExchange } from "./provider-oauth-runtime";
import { signLazadaRequest } from "./protocols";
export const lazadaExactAdminInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), credentialId: z.string().uuid() }).strict(),
  z.object({ action: z.enum(["start","status"]), sessionId: z.string().uuid(), credentialId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("bind"), sessionId: z.string().uuid(), credentialId: z.string().uuid(), state: z.string().min(24).max(180), code: z.string().min(1).max(8000) }).strict(),
]);
export const lazadaExactWorkerInput = z.object({ action: z.enum(["pulse","claim","heartbeat","begin","provider","stage","complete","review"]), sessionId: z.string().uuid(), jobId: z.string().uuid().optional(), claimToken: z.string().uuid().optional(), payload: z.record(z.string(),z.unknown()).default({}) }).strict();
export function lazadaExactFetch(input: RequestInfo | URL, init?: RequestInit) {
 const timeout=AbortSignal.timeout(20_000); return fetch(input,{...init,redirect:"error",signal:init?.signal?AbortSignal.any([init.signal,timeout]):timeout});
}
export function parseLazadaExactClaim(value: unknown, sessionId: string) {
 const job=gatewayClaimSchema.parse(value);
 if(job.channel!=="lazada" || !["oauth.exchange","shops.get"].includes(job.operation) || job.environment!=="production" || job.attempt_count!==1
 || job.request.lazadaExactSession!==sessionId || job.request.country!=="my" || String(job.credential.app_key)!=="137451" || String(job.credential.im_app_key)!=="137571" || job.credential.country!=="my") throw new Error("LAZADA_EXACT_CLAIM_INVALID");
 return job;
}
export function assertLazadaExactRefresh(source: Record<string,unknown>, next: Record<string,unknown>) {
 const normalized=normalizeLazadaProviderAccountIdentity(next), identity=readProviderAccountIdentity(next,"lazada");
 const my=normalized.countryUserInfo.find(s=>s.country==="my");
 if(normalized.accountPlatform!=="seller_center" || !identity || identity.subject!==normalized.identity.subject || my?.seller_id!=="300872000183"
 || (my.short_code && my.short_code!=="MY4NNISR2D") || String(next.app_key)!=="137451" || next.app_secret!==source.app_secret || next.country!=="my") throw new Error("LAZADA_EXACT_PROVIDER_IDENTITY_MISMATCH");
 const im=(s:Record<string,unknown>)=>JSON.stringify(Object.entries(s).filter(([k])=>k.startsWith("im_")).sort(([a],[b])=>a.localeCompare(b)));
 if(im(source)!==im(next) || String(next.im_app_key)!=="137571") throw new Error("LAZADA_EXACT_IM_CHANGED");
}
export type LazadaExactCall=(body:Record<string,unknown>)=>Promise<Record<string,unknown>>;
export async function runLazadaExactJob(value:unknown,sessionId:string,call:LazadaExactCall,readFetch:typeof fetch=lazadaExactFetch) {
 const job=parseLazadaExactClaim(value,sessionId), binding={sessionId,jobId:job.id,claimToken:job.claim_token};
 const action=async(name:string,payload:Record<string,unknown>={})=>{
  const result=await call({action:name,...binding,payload});
  const expected:Record<string,string[]>={heartbeat:["running"],begin:["in_flight"],provider:["provider_started"],stage:["prepared"],complete:["readback_ready","completed","seller_verified_reconciliation_pending"],review:["review"]};
  if(!expected[name]?.includes(String(result.status)))throw new Error("LAZADA_EXACT_ACTION_REJECTED");
  return result;
 };
 try {
  await action("heartbeat");
  if(job.operation==="oauth.exchange") {
   const result=await executeProviderOAuthExchange({...job,channel:"lazada",operation:"oauth.exchange"},{
    assertLeaseHealthy:async()=>{await action("heartbeat");},
    beginCredentialMutation:async()=>{await action("begin");},
    beginOAuthProviderCall:async()=>{await action("provider");},
    stageCredentialRefresh:async refresh=>{assertLazadaExactRefresh(job.credential,refresh.payload); const staged=await action("stage",{refresh}); if(staged.status!=="prepared")throw new Error("LAZADA_EXACT_STAGE_FAILED");},
   });
   return await action("complete",{result});
  }
  assertLazadaExactRefresh(job.credential,job.credential);
  const params:Record<string,string>={app_key:"137451",access_token:String(job.credential.access_token??""),sign_method:"sha256",timestamp:String(Date.now())};
  if(!params.access_token)throw new Error("LAZADA_EXACT_TOKEN_MISSING");
  params.sign=signLazadaRequest("/seller/get",params,String(job.credential.app_secret??""));
  const remote=await readFetch(`https://api.lazada.com.my/rest/seller/get?${new URLSearchParams(params)}`,{method:"GET",redirect:"error",signal:AbortSignal.timeout(20_000)});
  const data=await remote.json() as Record<string,unknown>; const seller=data.data as Record<string,unknown>|undefined;
  if(!remote.ok || String(data.code??"")!=="0" || String(seller?.seller_id)!=="300872000183" || seller?.short_code!=="MY4NNISR2D" || String(seller?.status).toUpperCase()!=="ACTIVE")throw new Error("LAZADA_EXACT_SELLER_MISMATCH");
  // Persist only identity/status, not seller contact data.
  return await action("complete",{result:{ok:true,channel:"lazada",operation:"shops.get",steps:[{name:"seller-info",ok:true,status:remote.status,data:{code:"0",data:{seller_id:"300872000183",short_code:"MY4NNISR2D",status:"ACTIVE"}}}]}});
 } catch {
  await action("review").catch(()=>{}); throw new Error("LAZADA_EXACT_REVIEW_REQUIRED_NO_REPLAY");
 }
}
