import { after, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import { aiGeneratedAssetIds } from "../../../../../lib/ai-generated-assets";
import { readServerProductStudioReadiness, wakeServerProductStudioAfterResponse } from "../../../../../lib/server-product-studio-runtime";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  jobId: z.string().uuid(),
  sourceJobId: z.string().uuid(),
  sourceProductId: z.string().uuid().nullable().optional(),
  assetId: z.enum(aiGeneratedAssetIds),
});

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "재제작할 이미지 정보를 확인해 주세요." }, { status: 400 });
  }

  const readiness = await readServerProductStudioReadiness(admin, request);
  if (!readiness.available) {
    return NextResponse.json({
      code: "AI_WORKER_UNAVAILABLE",
      workerAvailable: false,
      message: readiness.message,
    }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const { data, error } = await admin.userClient.rpc("sellerpilot_create_asset_regeneration_job", {
    p_id: parsed.data.jobId,
    p_source_job_id: parsed.data.sourceJobId,
    p_source_product_id: parsed.data.sourceProductId ?? null,
    p_asset_id: parsed.data.assetId,
  });
  if (error || typeof data !== "string") {
    return NextResponse.json({ message: "선택한 이미지 재제작 작업을 등록하지 못했습니다." }, { status: 500 });
  }
  after(wakeServerProductStudioAfterResponse);
  return NextResponse.json({
    jobId: data,
    status: "queued",
    deduplicated: data !== parsed.data.jobId,
    requestedJobId: parsed.data.jobId,
  }, {
    status: 202,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
