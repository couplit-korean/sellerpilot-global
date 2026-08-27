import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { aiGeneratedAssetPath, aiGeneratedAssetSpecs } from "../../../../../lib/ai-generated-assets";
import { sellerSafeAiJobFailure } from "../../../../../lib/ai-worker-error-safety";
import { workerCompletionSchema } from "../../../../../lib/ai-cli-contract";
import { supabaseUrl } from "../../../../../lib/supabase/config";
import {
  createBoundedSupabaseFetch,
  workerRpcErrorMessage,
  workerRpcErrorStatus,
} from "../../../../../lib/worker-rpc";

export const runtime = "nodejs";

type LegacyWorkerSuccess = {
  jobId: string;
  claimToken: string;
  status: "succeeded";
  result: Record<string, unknown>;
  assetStoragePaths: Record<string, string>;
};

const legacyLocalizedMarkets = new Set([
  "shopee:SG", "shopee:MY", "shopee:PH", "shopee:VN", "shopee:TH", "shopee:TW", "shopee:BR", "shopee:MX",
  "lazada:MY", "lazada:SG", "lazada:PH", "lazada:TH", "lazada:VN", "lazada:ID",
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isLegacyWorkerSuccess(value: unknown): value is LegacyWorkerSuccess {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  const result = payload.result;
  const assetStoragePaths = payload.assetStoragePaths;
  if (payload.status !== "succeeded"
      || typeof payload.jobId !== "string"
      || !UUID_PATTERN.test(payload.jobId)
      || typeof payload.claimToken !== "string"
      || !UUID_PATTERN.test(payload.claimToken)
      || !result
      || typeof result !== "object") return false;
  if (!assetStoragePaths || typeof assetStoragePaths !== "object") return false;
  const listings = (result as Record<string, unknown>).localizedListings;
  if ((result as Record<string, unknown>).mode !== "cli" || !Array.isArray(listings) || listings.length !== legacyLocalizedMarkets.size) return false;
  const receivedMarkets = new Set(listings.map((listing) => {
    if (!listing || typeof listing !== "object") return "";
    const entry = listing as Record<string, unknown>;
    return `${String(entry.channel ?? "")}:${String(entry.market ?? "")}`;
  }));
  return receivedMarkets.size === legacyLocalizedMarkets.size
    && [...legacyLocalizedMarkets].every((market) => receivedMarkets.has(market));
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!workerToken.startsWith("spw_") || workerToken.length < 24) {
    return NextResponse.json({ message: "CLI 작업자 인증이 필요합니다." }, { status: 401 });
  }
  if (!supabaseUrl || !secretKey) {
    console.error("AI worker completion server configuration is unavailable", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseSecretKey: Boolean(secretKey),
    });
    return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = workerCompletionSchema.safeParse(payload);
  const completion = parsed.success ? parsed.data : isLegacyWorkerSuccess(payload) ? payload : null;
  if (!completion) {
    return NextResponse.json({
      message: "CLI 완료 응답 형식이 올바르지 않습니다.",
      issues: parsed.success ? [] : parsed.error.issues.slice(0, 12).map((issue) => ({ path: issue.path, message: issue.message })),
    }, { status: 400 });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
  const tokenHash = createHash("sha256").update(workerToken).digest("hex");
  const { data: completionAuthorized, error: completionAuthorizationError } = await serviceClient.rpc(
    "sellerpilot_service_begin_ai_job_completion",
    {
      p_token_hash: tokenHash,
      p_job_id: completion.jobId,
      p_claim_token: completion.claimToken,
    },
  );
  if (completionAuthorizationError) {
    const status = workerRpcErrorStatus(completionAuthorizationError);
    console.error("AI worker completion authorization RPC failed", {
      code: completionAuthorizationError.code ?? "unknown",
      status,
    });
    return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
  }
  if (completionAuthorized !== true) {
    return NextResponse.json({ message: "실행 중인 작업과 완료 요청이 일치하지 않습니다." }, { status: 409 });
  }
  let resultPayload: Record<string, unknown> | null = null;

  if (completion.status === "succeeded") {
    resultPayload = { ...completion.result };
    if (completion.result.mode === "cli") {
      if (!("assetStoragePaths" in completion)) {
        return NextResponse.json({ message: "생성 이미지 저장 경로가 없습니다." }, { status: 400 });
      }
      const expectedPaths = Object.fromEntries(aiGeneratedAssetSpecs.map((asset) => [
        asset.id,
        aiGeneratedAssetPath(completion.jobId, asset, completion.claimToken),
      ]));
      for (const asset of aiGeneratedAssetSpecs) {
        const expectedPath = expectedPaths[asset.id];
        if (completion.assetStoragePaths[asset.id] !== expectedPath) {
          return NextResponse.json({ message: "생성 이미지 저장 경로가 작업과 일치하지 않습니다." }, { status: 403 });
        }
      }
      resultPayload.asset_storage_paths = completion.assetStoragePaths;
    } else if (completion.result.mode === "asset-regeneration") {
      if (!("assetStoragePaths" in completion)) {
        return NextResponse.json({ message: "재제작 이미지 저장 경로가 없습니다." }, { status: 400 });
      }
      const regenerated = completion.result as { mode: "asset-regeneration"; assetId: string };
      const asset = aiGeneratedAssetSpecs.find((candidate) => candidate.id === regenerated.assetId);
      const paths = Object.entries(completion.assetStoragePaths);
      const expectedPath = asset ? aiGeneratedAssetPath(completion.jobId, asset, completion.claimToken) : "";
      if (!asset || paths.length !== 1 || paths[0]?.[0] !== asset.id || paths[0]?.[1] !== expectedPath) {
        return NextResponse.json({ message: "재제작 이미지 저장 경로가 작업과 일치하지 않습니다." }, { status: 403 });
      }
      resultPayload.asset_storage_paths = completion.assetStoragePaths;
    }
  }

  const { data, error } = await serviceClient.rpc("sellerpilot_complete_ai_job", {
    p_token_hash: tokenHash,
    p_job_id: completion.jobId,
    p_claim_token: completion.claimToken,
    p_status: completion.status,
    p_result_payload: resultPayload,
    p_error_message: completion.status === "failed" ? sellerSafeAiJobFailure(completion.error) : null,
  });
  if (error || data !== true) {
    if (error) {
      const status = workerRpcErrorStatus(error);
      console.error("AI worker completion RPC failed", { code: error.code ?? "unknown", status });
      return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
    }
    return NextResponse.json({ message: "실행 중인 작업과 완료 요청이 일치하지 않습니다." }, { status: 409 });
  }
  return NextResponse.json({ message: "CLI 작업 결과가 안전하게 저장됐습니다." });
}
