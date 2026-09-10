import { NextResponse } from "next/server";
import { authenticateAdminRequest,isAdminApiError } from "../../../../../lib/admin-api";
import { csScopeHealthSchema } from "../../../../../lib/cs/scope-health";
export const runtime="nodejs";
const headers={"cache-control":"private, no-store, max-age=0"};
export async function GET(request:Request){
 const admin=await authenticateAdminRequest(request,{timeoutMs:8_000});if(isAdminApiError(admin))return admin;
 const {data,error}=await admin.userClient.rpc("sellerpilot_read_cs_scope_health_v1");
 if(error)return NextResponse.json({message:"CS 범위별 상태를 읽지 못했습니다."},{status:503,headers});
 const parsed=csScopeHealthSchema.safeParse(data);
 return parsed.success?NextResponse.json(parsed.data,{headers}):NextResponse.json({message:"CS 범위별 상태 형식을 확인하지 못했습니다."},{status:502,headers});
}
