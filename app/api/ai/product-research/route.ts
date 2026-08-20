import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import { productResearchJobRequestSchema } from "../../../../lib/ai-cli-contract";

export const runtime = "nodejs";

function legacyResearchPayload(jobId: string, researchInput: string) {
  const firstUrl = researchInput.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[),.;!?\]}]+$/g, "")
    ?? "https://sellerpilot-global.vercel.app/";
  return {
    research_only: true,
    research_input: researchInput,
    description: "상품 등록 전 CLI 상세정보 조사 전용 작업입니다.",
    product_url: firstUrl,
    image_paths: [`research-only/${jobId}.jpg`],
    image_specs: [{ id: "research-only", angle: "reference" }],
    manual_fields: {
      researchInput,
      productName: researchInput.slice(0, 160),
      sellerSku: `RESEARCH-${jobId.replaceAll("-", "")}`,
      categoryHint: "상품정보 조사",
      brandName: "확인 필요",
      manufacturer: "확인 필요",
      countryOfOrigin: "확인 필요",
      material: "CLI 조사 후 판매자 확인 필요",
      packageContents: "CLI 조사 후 판매자 확인 필요",
      description: "상품 등록 전에 링크 또는 판매자 설명에서 상세정보를 조사하는 전용 작업입니다.",
      productUrl: firstUrl,
      imageRightsConfirmed: true,
      productFactsConfirmed: true,
      sellingPrice: 1,
      stock: 1,
      weightKg: 1,
    },
  };
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const payload = await request.json().catch(() => null);
  const parsed = productResearchJobRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ message: "상품 링크나 설명을 2자 이상 입력해 주세요." }, { status: 400 });
  }

  const { error } = await admin.userClient.rpc("sellerpilot_create_ai_job", {
    p_id: parsed.data.jobId,
    p_kind: "product_research",
    p_request_payload: { research_input: parsed.data.researchInput },
  });
  if (error) {
    const { error: compatibilityError } = await admin.userClient.rpc("sellerpilot_create_ai_job", {
      p_id: parsed.data.jobId,
      p_kind: "product_studio",
      p_request_payload: legacyResearchPayload(parsed.data.jobId, parsed.data.researchInput),
    });
    if (compatibilityError) {
      return NextResponse.json({ message: "CLI 상품정보 수집 작업을 등록하지 못했습니다." }, { status: 500 });
    }
  }

  return NextResponse.json({
    mode: "cli-research",
    jobId: parsed.data.jobId,
    status: "queued",
    message: "ChatGPT CLI가 상품 링크와 설명을 조사하고 있습니다.",
  }, {
    status: 202,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
