import { NextResponse } from "next/server";
export const runtime = "nodejs";
export async function POST() {
  return NextResponse.json({ code: "CS_DRAFT_ENDPOINT_MOVED", message: "화면을 새로고침해 주세요. 답변 초안은 CS 전용 작업자로 처리합니다." }, { status: 410, headers: { "cache-control": "no-store" } });
}
