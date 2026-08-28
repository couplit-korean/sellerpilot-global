import { after, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError, type AdminApiContext } from "../../../../../../lib/admin-api";
import { productRevisionJobRequestSchema } from "../../../../../../lib/ai-cli-contract";
import { withPromiseTimeout } from "../../../../../../lib/promise-timeout";
import { expandStudioCleanupStoragePaths, validatePreservedStudioUploadPaths } from "../../../../../../lib/studio-image-paths";
import { createSignedStudioImageDownloader, verifyPreservedStudioImages } from "../../../../../../lib/studio-image-validation";
import { readServerProductStudioReadiness, wakeServerProductStudioAfterResponse } from "../../../../../../lib/server-product-studio-runtime";

export const runtime = "nodejs";
export const maxDuration = 300;

const productIdSchema = z.string().uuid();
const cleanupRequestSchema = z.object({
  jobId: z.string().uuid(),
  imagePaths: z.array(z.string().min(1).max(400)).min(1).max(100),
}).strict();

async function studioRevisionValidationDownloader(paths: string[], admin: AdminApiContext) {
  return createSignedStudioImageDownloader({
    paths,
    sign: () => withPromiseTimeout(
      admin.serviceClient.storage.from("sellerpilot-ai").createSignedUrls(paths, 10 * 60),
      30_000,
      "상품 수정 이미지 검증 URL 생성 제한시간을 초과했습니다.",
    ),
  });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const productId = productIdSchema.safeParse((await context.params).id);
  if (!productId.success) return NextResponse.json({ message: "상품 ID 형식이 올바르지 않습니다." }, { status: 400 });
  const requestedJobId = new URL(request.url).searchParams.get("jobId");
  const jobId = requestedJobId ? productIdSchema.safeParse(requestedJobId) : null;
  if (jobId && !jobId.success) return NextResponse.json({ message: "상품 수정 작업 ID 형식이 올바르지 않습니다." }, { status: 400 });

  const { data, error } = await admin.userClient.rpc("sellerpilot_get_product_revision_state", {
    p_product_id: productId.data,
    ...(jobId?.success ? { p_job_id: jobId.data } : {}),
  });
  if (error) return NextResponse.json({ message: "상품 사진 수정 상태를 불러오지 못했습니다." }, { status: 500 });
  return NextResponse.json({ revision: data ?? null }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const productId = productIdSchema.safeParse((await context.params).id);
  const payload = await request.json().catch(() => null);
  const parsed = productRevisionJobRequestSchema.safeParse(payload);
  if (!productId.success || !parsed.success) {
    return NextResponse.json({
      message: productId.success
        ? parsed.success ? "상품 사진 수정 요청을 확인해 주세요." : parsed.error.issues[0]?.message ?? "상품 사진 수정 요청을 확인해 주세요."
        : "상품 ID 형식이 올바르지 않습니다.",
    }, { status: 400 });
  }

  const preservedPaths = validatePreservedStudioUploadPaths(
    admin.user.id,
    parsed.data.jobId,
    parsed.data.imagePaths,
    parsed.data.imageSpecs,
  );
  if (!preservedPaths) {
    return NextResponse.json({ message: "현재 사용자의 이번 수정 작업 이미지 경로만 등록할 수 있습니다." }, { status: 403 });
  }
  const uploadedPaths = preservedPaths.imagePaths;
  const allUploadedPaths = preservedPaths.allPaths;

  // Cleanup must be fenced with the exact job id. A duplicate POST can arrive
  // after the first request committed but before its response reached the
  // browser; deleting those paths directly would break the active revision.
  const abandonAndCleanupIfUncreated = async () => {
    const { data: safeToRemove, error } = await admin.userClient.rpc(
      "sellerpilot_abandon_uncreated_product_revision_job",
      {
        p_product_id: productId.data,
        p_job_id: parsed.data.jobId,
        p_image_paths: uploadedPaths,
      },
    );
    if (error || !safeToRemove) return false;
    await admin.serviceClient.storage.from("sellerpilot-ai").remove(allUploadedPaths);
    return true;
  };

  const readiness = await readServerProductStudioReadiness(admin);
  if (!readiness.available) {
    const cleaned = await abandonAndCleanupIfUncreated();
    return NextResponse.json({
      code: "AI_WORKER_UNAVAILABLE",
      workerAvailable: false,
      cleanupPending: !cleaned,
      message: readiness.message,
    }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const download = await studioRevisionValidationDownloader(allUploadedPaths, admin);
  const verified = download ? await verifyPreservedStudioImages({
    normalizedPaths: uploadedPaths,
    originalPaths: preservedPaths.originalPaths,
    specs: parsed.data.imageSpecs,
    download,
  }) : { normalized: false, originals: false };
  if (!verified.normalized) {
    await abandonAndCleanupIfUncreated();
    return NextResponse.json({ message: "수정용 이미지는 1200×1200 JPG·3MB 이하 규격이어야 합니다." }, { status: 400 });
  }
  if (!verified.originals) {
    await abandonAndCleanupIfUncreated();
    return NextResponse.json({ message: "수정용 원본 이미지의 형식·크기·픽셀 정보가 요청과 일치하지 않습니다." }, { status: 400 });
  }

  try {
    const { data, error } = await admin.userClient.rpc("sellerpilot_create_product_revision_job", {
      p_id: parsed.data.jobId,
      p_product_id: productId.data,
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
    if (error) {
      const conflict = error?.message?.includes("PRODUCT_REVISION_ALREADY_PENDING");
      const missing = error?.message?.includes("PRODUCT_REVISION_PRODUCT_NOT_FOUND");
      const duplicateSku = error?.message?.includes("PRODUCT_REVISION_DUPLICATE_SKU");
      const idempotencyConflict = error?.message?.includes("PRODUCT_REVISION_IDEMPOTENCY_CONFLICT")
        || error?.message?.includes("PRODUCT_REVISION_JOB_ABANDONED");
      const definiteRejection = conflict || missing || duplicateSku || idempotencyConflict || error.message.includes("invalid product revision");
      if (!definiteRejection) {
        return NextResponse.json({
          jobId: parsed.data.jobId,
          productId: productId.data,
          reconciliationRequired: true,
          message: "상품 사진 수정 접수 응답이 불명확합니다. 같은 작업 ID로 상태를 확인해 주세요.",
        }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
      }
      if (!idempotencyConflict) await abandonAndCleanupIfUncreated();
      return NextResponse.json({
        message: conflict
          ? "이 상품의 사진·상세페이지 수정이 이미 진행 중입니다. 기존 작업이 끝난 뒤 다시 시도해 주세요."
          : missing ? "수정할 운영 상품을 찾지 못했습니다."
            : duplicateSku ? "다른 상품에서 사용 중인 판매자 SKU입니다."
              : idempotencyConflict ? "같은 작업 ID가 다른 내용으로 이미 사용되었거나 정리되었습니다." : "상품 사진 수정값을 확인해 주세요.",
      }, { status: conflict || duplicateSku || idempotencyConflict ? 409 : missing ? 404 : 400 });
    }
    if (data !== parsed.data.jobId) {
      return NextResponse.json({
        jobId: parsed.data.jobId,
        productId: productId.data,
        reconciliationRequired: true,
        message: "상품 사진 수정 접수 결과가 불명확합니다. 같은 작업 ID로 상태를 확인해 주세요.",
      }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
    }
    after(wakeServerProductStudioAfterResponse);
    return NextResponse.json({
      jobId: parsed.data.jobId,
      productId: productId.data,
      status: "queued",
      autoPublish: false,
      message: "같은 상품에 사진·상세페이지 리비전을 등록했습니다. 외부 판매채널에는 자동 반영하지 않습니다.",
    }, {
      status: 202,
      headers: { "cache-control": "no-store, max-age=0" },
    });
  } catch {
    return NextResponse.json({
      jobId: parsed.data.jobId,
      productId: productId.data,
      reconciliationRequired: true,
      message: "상품 사진 수정 접수 응답이 끊겼습니다. 같은 작업 ID로 상태를 확인해 주세요.",
    }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const productId = productIdSchema.safeParse((await context.params).id);
  const payload = cleanupRequestSchema.safeParse(await request.json().catch(() => null));
  if (!productId.success || !payload.success) {
    return NextResponse.json({ message: "정리할 상품 수정 작업을 확인해 주세요." }, { status: 400 });
  }
  const expectedPrefix = `${admin.user.id}/${payload.data.jobId}/input/`;
  if (payload.data.imagePaths.some((path, index) => (
    path !== `${expectedPrefix}${String(index + 1).padStart(3, "0")}.jpg`
    || path.includes("..")
  ))) {
    return NextResponse.json({ message: "현재 사용자의 해당 작업 이미지 경로만 정리할 수 있습니다." }, { status: 403 });
  }
  const { data: safeToRemove, error } = await admin.userClient.rpc("sellerpilot_abandon_uncreated_product_revision_job", {
    p_product_id: productId.data,
    p_job_id: payload.data.jobId,
    p_image_paths: payload.data.imagePaths,
  });
  if (error) return NextResponse.json({ message: "상품 수정 작업의 미접수 여부를 확정하지 못했습니다." }, { status: 503 });
  if (!safeToRemove) {
    return NextResponse.json({
      jobId: payload.data.jobId,
      reconciliationRequired: true,
      message: "같은 작업 ID가 서버에 존재합니다. 업로드를 유지하고 상태를 확인해 주세요.",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }
  const cleanupPaths = expandStudioCleanupStoragePaths(payload.data.imagePaths);
  const { error: cleanupError } = await admin.serviceClient.storage.from("sellerpilot-ai").remove(cleanupPaths);
  if (cleanupError) {
    return NextResponse.json({
      jobId: payload.data.jobId,
      abandoned: true,
      cleanupPending: true,
      message: "미접수 작업은 종료했으며 업로드 정리는 보관기간 작업에서 다시 처리합니다.",
    }, { status: 202, headers: { "cache-control": "no-store, max-age=0" } });
  }
  return NextResponse.json({
    jobId: payload.data.jobId,
    abandoned: true,
    cleaned: true,
    message: "서버 미접수를 확정하고 해당 임시 업로드를 정리했습니다.",
  }, { headers: { "cache-control": "no-store, max-age=0" } });
}
