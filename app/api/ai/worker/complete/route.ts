import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { workerCompletionSchema } from "../../../../../lib/ai-cli-contract";
import { supabaseUrl } from "../../../../../lib/supabase/config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!workerToken.startsWith("spw_") || !supabaseUrl || !secretKey) {
    return NextResponse.json({ message: "CLI 작업자 인증이 필요합니다." }, { status: 401 });
  }

  const parsed = workerCompletionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "CLI 완료 응답 형식이 올바르지 않습니다." }, { status: 400 });

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const tokenHash = createHash("sha256").update(workerToken).digest("hex");
  let resultPayload: Record<string, unknown> | null = null;

  if (parsed.data.status === "succeeded") {
    resultPayload = { ...parsed.data.result };
    if (parsed.data.heroStoragePath) {
      const expectedPath = `results/${parsed.data.jobId}/hero.png`;
      if (parsed.data.heroStoragePath !== expectedPath) {
        return NextResponse.json({ message: "생성 이미지 저장 경로가 작업과 일치하지 않습니다." }, { status: 403 });
      }
      const { data: stored, error: storedError } = await serviceClient.storage
        .from("sellerpilot-ai")
        .list(`results/${parsed.data.jobId}`, { limit: 1, search: "hero.png" });
      if (storedError || !stored?.some((item) => item.name === "hero.png")) {
        return NextResponse.json({ message: "업로드된 생성 이미지를 확인하지 못했습니다." }, { status: 400 });
      }
      resultPayload.hero_storage_path = expectedPath;
    }
  }

  const { data, error } = await serviceClient.rpc("sellerpilot_complete_ai_job", {
    p_token_hash: tokenHash,
    p_job_id: parsed.data.jobId,
    p_status: parsed.data.status,
    p_result_payload: resultPayload,
    p_error_message: parsed.data.status === "failed" ? parsed.data.error : null,
  });
  if (error) return NextResponse.json({ message: "CLI 작업 완료 상태를 저장하지 못했습니다." }, { status: 401 });
  if (data !== true) return NextResponse.json({ message: "실행 중인 작업과 완료 요청이 일치하지 않습니다." }, { status: 409 });
  return NextResponse.json({ message: "CLI 작업 결과가 안전하게 저장됐습니다." });
}
