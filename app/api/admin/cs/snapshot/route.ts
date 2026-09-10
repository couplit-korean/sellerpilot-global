import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import { csSnapshotSchema } from "../../../../../lib/cs/snapshot";
export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store, max-age=0" };
export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8000 });
  if (isAdminApiError(admin)) return admin;
  const { data, error } = await admin.userClient.rpc("sellerpilot_get_cs_snapshot");
  if (error) return NextResponse.json({ message: "문의 데이터를 불러오지 못했습니다." }, { status: 503, headers });
  const parsed = csSnapshotSchema.safeParse(data);
  if (!parsed.success) return NextResponse.json({ message: "문의 데이터 형식을 확인하지 못했습니다." }, { status: 502, headers });
  return NextResponse.json(parsed.data, { headers });
}
