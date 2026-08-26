import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError, type AdminApiContext } from "../../../../lib/admin-api";
import { rejectedUploadPaths } from "../../../../lib/ai-upload-guard";
import { studioJobRequestSchema } from "../../../../lib/ai-cli-contract";
import { verifyNormalizedStudioImages } from "../../../../lib/studio-image-validation";

export const runtime = "nodejs";

async function verifyPublishImages(paths: string[], admin: AdminApiContext) {
  return verifyNormalizedStudioImages(paths, async (path) => {
    const { data, error } = await admin.serviceClient.storage.from("sellerpilot-ai").createSignedUrl(path, 60);
    if (error || !data?.signedUrl) return null;
    return fetch(data.signedUrl, { cache: "no-store", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  });
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const payload = await request.json().catch(() => null);
  const parsed = studioJobRequestSchema.safeParse(payload);
  if (!parsed.success) {
    const orphanedPaths = rejectedUploadPaths(payload, admin.user.id);
    if (orphanedPaths.length) await admin.serviceClient.storage.from("sellerpilot-ai").remove(orphanedPaths);
    return NextResponse.json({ message: "대표 이미지를 포함한 상품 분석 요청 형식을 확인해 주세요." }, { status: 400 });
  }

  const expectedPrefix = `${admin.user.id}/${parsed.data.jobId}/input/`;
  const uploadedPaths = parsed.data.imagePaths;
  if (uploadedPaths.some((path) => !path.startsWith(expectedPrefix) || path.includes(".."))) {
    return NextResponse.json({ message: "현재 사용자의 비공개 이미지 경로만 등록할 수 있습니다." }, { status: 403 });
  }

  if (!await verifyPublishImages(uploadedPaths, admin)) {
    await admin.serviceClient.storage.from("sellerpilot-ai").remove(uploadedPaths);
    return NextResponse.json({ message: "실제 등록용 이미지는 1200×1200 JPG·3MB 이하 규격이어야 합니다." }, { status: 400 });
  }

  try {
    const { error } = await admin.userClient.rpc("sellerpilot_create_ai_job", {
      p_id: parsed.data.jobId,
      p_kind: "product_studio",
      p_request_payload: {
        description: parsed.data.manualFields.description.trim(),
        product_url: parsed.data.manualFields.productUrl.trim(),
        research_input: parsed.data.manualFields.researchInput.trim(),
        manual_fields: parsed.data.manualFields,
        competitor_context: parsed.data.competitorContext,
        image_paths: uploadedPaths,
        image_specs: parsed.data.imageSpecs,
      },
    });
    if (error) throw new Error("CLI 작업 큐 등록에 실패했습니다.");

    return NextResponse.json({
      mode: "cli",
      jobId: parsed.data.jobId,
      status: "queued",
      message: "ChatGPT CLI 작업자에게 상품 분석과 이미지 제작을 요청했습니다.",
    }, {
      status: 202,
      headers: { "cache-control": "no-store, max-age=0" },
    });
  } catch (error) {
    if (uploadedPaths.length) await admin.serviceClient.storage.from("sellerpilot-ai").remove(uploadedPaths);
    const message = error instanceof Error ? error.message : "CLI 작업을 등록하지 못했습니다.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
