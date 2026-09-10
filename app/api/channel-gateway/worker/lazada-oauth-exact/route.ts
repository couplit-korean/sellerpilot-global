import {createHash} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {NextResponse} from "next/server";
import {lazadaExactWorkerInput,lazadaExactFetch,parseLazadaExactClaim} from "../../../../../lib/channels/lazada-oauth-exact";
import {supabaseUrl} from "../../../../../lib/supabase/config";
export const runtime="nodejs";
export async function POST(request:Request){
 const token=(request.headers.get("authorization")??"").replace(/^Bearer /,"");
 if(!token.startsWith("spw_")||token.length<24)return NextResponse.json({status:"unauthorized"},{status:401});
 const parsed=lazadaExactWorkerInput.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({status:"invalid_request"},{status:400});
 const key=process.env.SUPABASE_SECRET_KEY;if(!key||!supabaseUrl)return NextResponse.json({status:"unavailable"},{status:503});
 const client=createClient(supabaseUrl,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:lazadaExactFetch}});
 const input=parsed.data;
 const {data,error}=await client.rpc("sellerpilot_lazada_exact_oauth_worker",{p_action:input.action,p_session:input.sessionId,p_token_hash:createHash("sha256").update(token).digest("hex"),p_job:input.jobId??null,p_claim:input.claimToken??null,p_payload:input.payload});
 if(error||!data)return NextResponse.json({status:"exact_executor_blocked"},{status:409});
 if(data.status==="claimed"){try{parseLazadaExactClaim(data.job,input.sessionId);}catch{return NextResponse.json({status:"invalid_claim"},{status:409});}}
 return NextResponse.json(data,{headers:{"cache-control":"no-store"}});
}
