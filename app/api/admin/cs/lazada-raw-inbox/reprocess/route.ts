import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../lib/admin-api";
import { reprocessPendingLazadaRawReceipts } from "../../../../../../lib/channels/lazada-raw-reprocess";
import { supabaseUrl } from "../../../../../../lib/supabase/config";
import { createBoundedSupabaseFetch } from "../../../../../../lib/worker-rpc";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "cache-control": "private, no-store, max-age=0" };

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 8_000 });
  if (isAdminApiError(admin)) return admin;
  const serviceClient = createClient(supabaseUrl, process.env.SUPABASE_SECRET_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch(8_000) },
  });
  const summary = await reprocessPendingLazadaRawReceipts(
    (name, arguments_) => serviceClient.rpc(name, arguments_),
    5,
  );
  const attention = summary.claimFailed || summary.failed > 0 || summary.retried > 0;
  return NextResponse.json({
    ...summary,
    message: summary.claimFailed
      ? "재처리 대상을 안전하게 확보하지 못했습니다. 원문은 그대로 보존됩니다."
      : attention
        ? "재처리하지 못한 원문이 남아 있습니다. 다음 자동 실행에서 다시 시도합니다."
        : summary.claimed
          ? `${summary.normalized}건을 CS 원장에 반영했습니다.`
          : "현재 재처리할 원문이 없습니다.",
  }, { status: attention ? 207 : 200, headers });
}
