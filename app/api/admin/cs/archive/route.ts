import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import { archiveCursorSchema,archiveFiltersSchema,archivePageSchema } from "../../../../../lib/cs/archive";

export const runtime="nodejs";
const headers={"cache-control":"private, no-store, max-age=0"};
export async function GET(request:Request){
 const admin=await authenticateAdminRequest(request,{timeoutMs:8000});if(isAdminApiError(admin))return admin;
 const params=new URL(request.url).searchParams;
 const filters=archiveFiltersSchema.safeParse({query:params.get("query")??"",channel:params.get("channel"),status:params.get("status"),from:params.get("from"),to:params.get("to")});
 if(!filters.success)return NextResponse.json({message:"검색어·기간·채널 조건을 확인해 주세요."},{status:400,headers});
 let cursor=null;
 try{if(params.has("cursor"))cursor=archiveCursorSchema.parse(JSON.parse(params.get("cursor")!));}
 catch{return NextResponse.json({message:"검색 페이지 위치를 확인해 주세요."},{status:400,headers});}
 const {query,channel,status,from,to}=filters.data;
 const {data,error}=await admin.userClient.rpc("sellerpilot_search_cs_archive",{p_query:query,p_channel:channel,p_status:status,p_from_date:from,p_to_date:to,p_limit:25,
  p_before_time:cursor?.beforeTime??null,p_before_id:cursor?.beforeId??null,p_as_of:cursor?.asOf??null});
 if(error)return NextResponse.json({message:"보관 문의를 조회하지 못했습니다. 다시 시도해 주세요."},{status:503,headers});
 const page=archivePageSchema.safeParse(data);
 if(!page.success)return NextResponse.json({message:"보관 문의 응답 형식을 확인하지 못했습니다."},{status:502,headers});
 return NextResponse.json(page.data,{headers});
}
