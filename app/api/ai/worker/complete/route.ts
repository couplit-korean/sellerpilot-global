import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { aiGeneratedAssetPath, aiGeneratedAssetSpecs } from "../../../../../lib/ai-generated-assets";
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
  if (!parsed.success) {
    return NextResponse.json({
      message: "CLI 완료 응답 형식이 올바르지 않습니다.",
      issues: parsed.error.issues.slice(0, 12).map((issue) => ({ path: issue.path, message: issue.message })),
    }, { status: 400 });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const tokenHash = createHash("sha256").update(workerToken).digest("hex");
  let resultPayload: Record<string, unknown> | null = null;

  if (parsed.data.status === "succeeded") {
    resultPayload = { ...parsed.data.result };
    const expectedPaths = Object.fromEntries(aiGeneratedAssetSpecs.map((asset) => [
      asset.id,
      aiGeneratedAssetPath(parsed.data.jobId, asset),
    ]));
    for (const asset of aiGeneratedAssetSpecs) {
      const expectedPath = expectedPaths[asset.id];
      if (parsed.data.assetStoragePaths[asset.id] !== expectedPath) {
        return NextResponse.json({ message: "생성 이미지 저장 경로가 작업과 일치하지 않습니다." }, { status: 403 });
      }
    }
    const { data: stored, error: storedError } = await serviceClient.storage
      .from("sellerpilot-ai")
      .list(`results/${parsed.data.jobId}`, { limit: 10 });
    const storedNames = new Set((stored ?? []).map((item) => item.name));
    if (storedError || Object.values(expectedPaths).some((path) => !storedNames.has(path.split("/").at(-1) ?? ""))) {
      return NextResponse.json({ message: "업로드된 대표·썸네일·상세 이미지 8종을 모두 확인하지 못했습니다." }, { status: 400 });
    }
    resultPayload.asset_storage_paths = parsed.data.assetStoragePaths;
  }

  const { data, error } = await serviceClient.rpc("sellerpilot_complete_ai_job", {
    p_token_hash: tokenHash,
    p_job_id: parsed.data.jobId,
    p_status: parsed.data.status,
    p_result_payload: resultPayload,
    p_error_message: parsed.data.status === "failed" ? parsed.data.error : null,
  });
  const uploadedAssets = parsed.data.status === "succeeded" ? Object.values(parsed.data.assetStoragePaths) : [];
  if (error || data !== true) {
    if (uploadedAssets.length) {
      await serviceClient.storage.from("sellerpilot-ai").remove(uploadedAssets);
    }
    if (error) return NextResponse.json({ message: "CLI 작업 완료 상태를 저장하지 못했습니다." }, { status: 401 });
    return NextResponse.json({ message: "실행 중인 작업과 완료 요청이 일치하지 않습니다." }, { status: 409 });
  }
  return NextResponse.json({ message: "CLI 작업 결과가 안전하게 저장됐습니다." });
}
