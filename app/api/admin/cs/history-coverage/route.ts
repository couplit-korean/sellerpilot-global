import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import { csHistoryCoverageSchema } from "../../../../../lib/cs/history-coverage";

export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;
  try {
    const { data, error } = await admin.userClient.rpc("sellerpilot_read_cs_history_coverage_v1");
    if (error) return NextResponse.json({ message: "과거 문의 수집 범위를 조회하지 못했습니다." }, { status: 503, headers });
    const coverage = csHistoryCoverageSchema.safeParse(data);
    if (!coverage.success) return NextResponse.json({ message: "과거 문의 수집 범위 응답을 확인하지 못했습니다." }, { status: 502, headers });
    return NextResponse.json(coverage.data, { headers });
  } catch {
    return NextResponse.json({ message: "과거 문의 수집 범위를 조회하지 못했습니다." }, { status: 503, headers });
  }
}
