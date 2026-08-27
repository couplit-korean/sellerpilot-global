import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  aiGeneratedAssetIds,
  aiGeneratedAssetPath,
  aiGeneratedAssetSpecs,
} from "../../../../../lib/ai-generated-assets";
import { supabaseUrl } from "../../../../../lib/supabase/config";
import {
  createBoundedSupabaseFetch,
  workerRpcErrorMessage,
  workerRpcErrorStatus,
} from "../../../../../lib/worker-rpc";

export const runtime = "nodejs";

const authorizationSchema = z.object({
  jobId: z.string().uuid(),
  claimToken: z.string().uuid(),
  assetId: z.enum(aiGeneratedAssetIds),
}).strict();

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!workerToken.startsWith("spw_") || workerToken.length < 24) {
    return NextResponse.json({ message: "CLI 작업자 인증이 필요합니다." }, { status: 401 });
  }
  if (!supabaseUrl || !secretKey) {
    console.error("AI result upload authorization server configuration is unavailable", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseSecretKey: Boolean(secretKey),
    });
    return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
  }

  const parsed = authorizationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "생성 이미지 업로드 요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const asset = aiGeneratedAssetSpecs.find((candidate) => candidate.id === parsed.data.assetId);
  if (!asset) {
    return NextResponse.json({ message: "생성 이미지 종류를 확인하지 못했습니다." }, { status: 400 });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
  const tokenHash = createHash("sha256").update(workerToken).digest("hex");
  const path = aiGeneratedAssetPath(parsed.data.jobId, asset, parsed.data.claimToken);
  const { data: staged, error: stagingError } = await serviceClient.rpc(
    "sellerpilot_service_authorize_ai_result_upload",
    {
      p_token_hash: tokenHash,
      p_job_id: parsed.data.jobId,
      p_claim_token: parsed.data.claimToken,
      p_asset_id: asset.id,
      p_path: path,
    },
  );
  if (stagingError) {
    const status = workerRpcErrorStatus(stagingError);
    console.error("AI result upload authorization RPC failed", {
      code: stagingError.code ?? "unknown",
      status,
    });
    return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
  }
  if (staged !== true) {
    return NextResponse.json({
      message: "실행 중인 작업과 이미지 업로드 요청이 일치하지 않습니다.",
    }, { status: 409 });
  }

  const { data: upload, error: uploadError } = await serviceClient.storage
    .from("sellerpilot-ai")
    .createSignedUploadUrl(path, { upsert: true });
  if (uploadError || typeof upload?.token !== "string" || !upload.token) {
    console.error("AI result upload signing failed", {
      code: uploadError?.name ?? "unknown",
      status: uploadError?.statusCode ?? "unknown",
    });
    return NextResponse.json({
      message: "생성 이미지 업로드 권한을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    }, { status: 503 });
  }

  return NextResponse.json({
    id: asset.id,
    path,
    token: upload.token,
    bucket: "sellerpilot-ai",
  }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
