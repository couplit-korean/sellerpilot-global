import { after, NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import { productResearchJobRequestSchema } from "../../../../lib/ai-cli-contract";
import {
  issueProductResearchLineageReceipt,
  productResearchLineageReceiptConfigured,
} from "../../../../lib/product-research-lineage-receipt";
import { createProductResearchJobWithLegacyFallback } from "../../../../lib/product-research-rpc-compatibility";
import { wakeServerProductResearchAfterResponse } from "../../../../lib/server-product-research-runtime";
import { readServerProductStudioReadiness } from "../../../../lib/server-product-studio-runtime";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const payload = await request.json().catch(() => null);
  const parsed = productResearchJobRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ message: "상품 링크나 설명을 2자 이상 입력해 주세요." }, { status: 400 });
  }

  const readiness = await readServerProductStudioReadiness(admin, request);
  if (!readiness.available) {
    return NextResponse.json({
      code: "AI_WORKER_UNAVAILABLE",
      workerAvailable: false,
      message: readiness.message,
    }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
  }

  if (!productResearchLineageReceiptConfigured()) {
    return NextResponse.json({
      code: "PRODUCT_RESEARCH_LINEAGE_UNAVAILABLE",
      workerAvailable: false,
      message: "1차 분석과 원본 사진을 안전하게 연결할 서버 설정이 완료되지 않았습니다.",
    }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const { error } = await createProductResearchJobWithLegacyFallback({
    jobId: parsed.data.jobId,
    researchInput: parsed.data.researchInput,
    sourcePhotoSha256: parsed.data.sourcePhotoFingerprint,
    createJob: async (arguments_) => {
      const result = await admin.userClient.rpc("sellerpilot_create_ai_job", arguments_);
      return { error: result.error };
    },
  });
  if (error) {
    return NextResponse.json({ message: "AI 상품정보 수집 작업을 등록하지 못했습니다." }, { status: 500 });
  }

  const lineageReceipt = issueProductResearchLineageReceipt({
    ownerId: admin.user.id,
    researchJobId: parsed.data.jobId,
    researchInput: parsed.data.researchInput,
    sourcePhotoSha256: parsed.data.sourcePhotoFingerprint,
  });

  after(wakeServerProductResearchAfterResponse);
  return NextResponse.json({
    mode: "server-research",
    jobId: parsed.data.jobId,
    lineageReceipt,
    status: "queued",
    message: "Vercel 서버 AI가 상품 링크와 설명을 조사하고 있습니다.",
  }, {
    status: 202,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
