import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError, type AdminApiContext } from "../../../../lib/admin-api";
import { rejectedUploadPaths } from "../../../../lib/ai-upload-guard";
import { studioJobRequestSchema } from "../../../../lib/ai-cli-contract";

export const runtime = "nodejs";

function jpegDimensions(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 8 < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 1 >= bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if (startOfFrame.has(marker) && length >= 7) {
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }
    offset += length;
  }
  return null;
}

async function verifyPublishImages(paths: string[], admin: AdminApiContext) {
  const inspections = await Promise.all(paths.slice(0, 9).map(async (path) => {
    const { data, error } = await admin.serviceClient.storage.from("sellerpilot-ai").download(path);
    if (error || !data || data.size > 3 * 1024 * 1024 || data.type !== "image/jpeg") return false;
    const size = jpegDimensions(new Uint8Array(await data.arrayBuffer()));
    return size?.width === 1200 && size.height === 1200;
  }));
  return inspections.every(Boolean);
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
        manual_fields: parsed.data.manualFields,
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
