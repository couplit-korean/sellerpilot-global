import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError, type AdminApiContext } from "../../../../../lib/admin-api";
import { rejectedUploadPaths } from "../../../../../lib/ai-upload-guard";
import { studioJobRequestSchema } from "../../../../../lib/ai-cli-contract";
import { withPromiseTimeout } from "../../../../../lib/promise-timeout";
import {
  expandStudioCleanupStoragePaths,
  validatePreservedStudioUploadPaths,
} from "../../../../../lib/studio-image-paths";
import {
  createSignedStudioImageDownloader,
  verifyPreservedStudioImages,
} from "../../../../../lib/studio-image-validation";

export const runtime = "nodejs";
export const maxDuration = 300;

async function validationDownloader(paths: string[], admin: AdminApiContext) {
  return createSignedStudioImageDownloader({
    paths,
    sign: () => withPromiseTimeout(
      admin.serviceClient.storage.from("sellerpilot-ai").createSignedUrls(paths, 10 * 60),
      30_000,
      "상품 이미지 검증 URL 생성 제한시간을 초과했습니다.",
    ),
  });
}

async function cleanupOnlyWhenManualJobIsAbsent(
  admin: AdminApiContext,
  jobId: string,
  paths: string[],
) {
  if (!paths.length) return false;
  const readback = await withPromiseTimeout(
    admin.userClient.rpc("sellerpilot_get_ai_job", { p_id: jobId }),
    15_000,
    "수동 등록 원장 확인 제한시간을 초과했습니다.",
  ).catch(() => null);
  if (!readback || readback.error || readback.data != null) return false;
  const { error } = await admin.serviceClient.storage.from("sellerpilot-ai").remove(paths);
  return !error;
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const payload = await request.json().catch(() => null);
  const parsed = studioJobRequestSchema.safeParse(payload);
  if (!parsed.success) {
    const candidateJobId = payload && typeof payload === "object" && !Array.isArray(payload)
      && typeof (payload as Record<string, unknown>).jobId === "string"
      ? (payload as Record<string, unknown>).jobId as string
      : "";
    const orphanedPaths = expandStudioCleanupStoragePaths(rejectedUploadPaths(payload, admin.user.id));
    if (candidateJobId && orphanedPaths.length) {
      await cleanupOnlyWhenManualJobIsAbsent(admin, candidateJobId, orphanedPaths);
    }
    return NextResponse.json({
      code: "INVALID_MANUAL_PRODUCT",
      message: parsed.error.issues[0]?.message ?? "원본 사진과 판매자 필수 입력값을 확인해 주세요.",
    }, { status: 400 });
  }

  const preservedPaths = validatePreservedStudioUploadPaths(
    admin.user.id,
    parsed.data.jobId,
    parsed.data.imagePaths,
    parsed.data.imageSpecs,
  );
  if (!preservedPaths) {
    return NextResponse.json({
      code: "INVALID_IMAGE_OWNERSHIP",
      message: "현재 사용자의 비공개 이미지 경로만 등록할 수 있습니다.",
    }, { status: 403 });
  }

  const download = await validationDownloader(preservedPaths.allPaths, admin);
  const verified = download ? await verifyPreservedStudioImages({
    normalizedPaths: preservedPaths.imagePaths,
    originalPaths: preservedPaths.originalPaths,
    specs: parsed.data.imageSpecs,
    download,
  }) : { normalized: false, originals: false };
  if (!verified.normalized || !verified.originals) {
    await cleanupOnlyWhenManualJobIsAbsent(admin, parsed.data.jobId, preservedPaths.allPaths);
    return NextResponse.json({
      code: "INVALID_PRESERVED_IMAGES",
      message: !verified.normalized
        ? "등록용 이미지는 1200×1200 JPG·3MB 이하 규격이어야 합니다."
        : "원본 이미지의 형식·크기·픽셀 정보가 업로드 요청과 일치하지 않습니다.",
    }, { status: 400 });
  }

  const requestPayload = {
    description: parsed.data.manualFields.description.trim(),
    product_url: parsed.data.manualFields.productUrl.trim(),
    research_input: parsed.data.manualFields.researchInput.trim(),
    manual_fields: parsed.data.manualFields,
    competitor_context: parsed.data.competitorContext,
    image_paths: preservedPaths.imagePaths,
    image_specs: parsed.data.imageSpecs,
  };
  const { data, error } = await withPromiseTimeout(
    admin.userClient.rpc("sellerpilot_create_manual_product_v1", {
      p_id: parsed.data.jobId,
      p_request_payload: requestPayload,
    }),
    60_000,
    "원본 사진 상품 원장 저장 제한시간을 초과했습니다.",
  ).catch((caught) => ({ data: null, error: caught instanceof Error ? caught : new Error("수동 상품 저장 실패") }));

  if (error || typeof data !== "string") {
    // The RPC is idempotent. A response loss may mean the transaction already
    // committed, so retain uploads whenever the exact job can no longer be
    // proven absent.
    await cleanupOnlyWhenManualJobIsAbsent(admin, parsed.data.jobId, preservedPaths.allPaths);
    const errorCode = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    if (errorCode === "23505") {
      return NextResponse.json({
        code: "DUPLICATE_SELLER_SKU",
        message: "같은 판매자 SKU가 이미 있습니다. 기존 상품을 확인하거나 새 SKU를 입력해 주세요.",
      }, { status: 409 });
    }
    return NextResponse.json({
      code: "MANUAL_PRODUCT_SAVE_FAILED",
      message: "원본 사진 상품 원장 저장을 확인하지 못했습니다. 같은 요청 ID로 다시 시도해 주세요.",
    }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    mode: "manual_mvp",
    jobId: parsed.data.jobId,
    productId: data,
  }, { headers: { "cache-control": "no-store, max-age=0" } });
}
