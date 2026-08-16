import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import { studioJobRequestSchema } from "../../../../lib/ai-cli-contract";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const parsed = studioJobRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "대표 이미지를 포함한 상품 분석 요청 형식을 확인해 주세요." }, { status: 400 });
  }

  const expectedPrefix = `${admin.user.id}/${parsed.data.jobId}/input/`;
  const uploadedPaths = parsed.data.imagePaths;
  if (uploadedPaths.some((path) => !path.startsWith(expectedPrefix) || path.includes(".."))) {
    return NextResponse.json({ message: "현재 사용자의 비공개 이미지 경로만 등록할 수 있습니다." }, { status: 403 });
  }

  try {
    const { error } = await admin.userClient.rpc("sellerpilot_create_ai_job", {
      p_id: parsed.data.jobId,
      p_kind: "product_studio",
      p_request_payload: {
        description: parsed.data.description.trim(),
        product_url: parsed.data.productUrl.trim(),
        image_paths: uploadedPaths,
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
