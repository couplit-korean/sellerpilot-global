import { NextResponse } from "next/server";

// Retired mixed entry point. Current CS requests use /api/admin/cs/sync;
// order scheduling owns its own enqueue path. A stale tab must never fan out
// one request into both domains or bypass their worker ownership checks.
function retiredMixedSync() {
  return NextResponse.json({
    ok: false,
    code: "MIXED_SYNC_RETIRED",
    message: "화면을 새로고침해 주세요. 문의 동기화는 문의함에서, 주문 동기화는 주문 스케줄러에서 각각 처리합니다.",
  }, { status: 410, headers: { "cache-control": "no-store, max-age=0" } });
}
export const GET = retiredMixedSync;
export const POST = retiredMixedSync;
