import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError, type AdminApiContext } from "../../../../lib/admin-api";
import { rejectedUploadPaths } from "../../../../lib/ai-upload-guard";
import { studioJobRequestSchema } from "../../../../lib/ai-cli-contract";
import { withPromiseTimeout } from "../../../../lib/promise-timeout";
import { expandStudioCleanupStoragePaths, validatePreservedStudioUploadPaths } from "../../../../lib/studio-image-paths";
import { createSignedStudioImageDownloader, verifyPreservedStudioImages } from "../../../../lib/studio-image-validation";
import { resolveStudioAdmission } from "../../../../lib/studio-job-admission";

export const runtime = "nodejs";
export const maxDuration = 300;

async function studioValidationDownloader(paths: string[], admin: AdminApiContext) {
  return createSignedStudioImageDownloader({
    paths,
    sign: () => withPromiseTimeout(
      admin.serviceClient.storage.from("sellerpilot-ai").createSignedUrls(paths, 10 * 60),
      30_000,
      "상품 이미지 검증 URL 생성 제한시간을 초과했습니다.",
    ),
  });
}

async function cleanupStudioUploadsOnlyWhenJobIsAbsent(
  admin: AdminApiContext,
  jobId: string,
  paths: string[],
) {
  const readback = await withPromiseTimeout(
    admin.userClient.rpc("sellerpilot_get_ai_job", { p_id: jobId }),
    15_000,
    "CLI 작업 큐 확인 제한시간을 초과했습니다.",
  ).catch(() => null);
  // An unreadable or non-null exact job state is never safe to delete. This
  // also protects a duplicate POST whose first response was lost after commit.
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
    const orphanedPaths = expandStudioCleanupStoragePaths(rejectedUploadPaths(payload, admin.user.id));
    const candidateJobId = payload && typeof payload === "object" && !Array.isArray(payload)
      && typeof (payload as Record<string, unknown>).jobId === "string"
      ? (payload as Record<string, unknown>).jobId as string
      : "";
    if (orphanedPaths.length && candidateJobId) {
      await cleanupStudioUploadsOnlyWhenJobIsAbsent(admin, candidateJobId, orphanedPaths);
    }
    return NextResponse.json({ message: "대표 이미지를 포함한 상품 분석 요청 형식을 확인해 주세요." }, { status: 400 });
  }

  const preservedPaths = validatePreservedStudioUploadPaths(
    admin.user.id,
    parsed.data.jobId,
    parsed.data.imagePaths,
    parsed.data.imageSpecs,
  );
  if (!preservedPaths) {
    return NextResponse.json({ message: "현재 사용자의 비공개 이미지 경로만 등록할 수 있습니다." }, { status: 403 });
  }
  const uploadedPaths = preservedPaths.imagePaths;
  const allUploadedPaths = preservedPaths.allPaths;

  const download = await studioValidationDownloader(allUploadedPaths, admin);
  const verified = download ? await verifyPreservedStudioImages({
    normalizedPaths: uploadedPaths,
    originalPaths: preservedPaths.originalPaths,
    specs: parsed.data.imageSpecs,
    download,
  }) : { normalized: false, originals: false };
  if (!verified.normalized) {
    await cleanupStudioUploadsOnlyWhenJobIsAbsent(admin, parsed.data.jobId, allUploadedPaths);
    return NextResponse.json({ message: "실제 등록용 이미지는 1200×1200 JPG·3MB 이하 규격이어야 합니다." }, { status: 400 });
  }
  if (!verified.originals) {
    await cleanupStudioUploadsOnlyWhenJobIsAbsent(admin, parsed.data.jobId, allUploadedPaths);
    return NextResponse.json({ message: "원본 이미지의 형식·크기·픽셀 정보가 업로드 요청과 일치하지 않습니다." }, { status: 400 });
  }

  const requestPayload = {
    description: parsed.data.manualFields.description.trim(),
    product_url: parsed.data.manualFields.productUrl.trim(),
    research_input: parsed.data.manualFields.researchInput.trim(),
    manual_fields: parsed.data.manualFields,
    competitor_context: parsed.data.competitorContext,
    image_paths: uploadedPaths,
    image_specs: parsed.data.imageSpecs,
  };
  const admission = await resolveStudioAdmission({
    jobId: parsed.data.jobId,
    createJob: () => withPromiseTimeout(
      admin.userClient.rpc("sellerpilot_create_ai_job", {
        p_id: parsed.data.jobId,
        p_kind: "product_studio",
        p_request_payload: requestPayload,
      }),
      15_000,
      "CLI 작업 큐 등록 제한시간을 초과했습니다.",
    ),
    readExactJob: () => withPromiseTimeout(
      admin.userClient.rpc("sellerpilot_get_ai_job", { p_id: parsed.data.jobId }),
      15_000,
      "CLI 작업 큐 확인 제한시간을 초과했습니다.",
    ),
    cleanupUploads: async () => {
      const { error } = await admin.serviceClient.storage.from("sellerpilot-ai").remove(allUploadedPaths);
      if (error) throw new Error("studio_upload_cleanup_failed");
    },
  });

  if (admission.outcome === "accepted") {
    return NextResponse.json({
      mode: "cli",
      jobId: parsed.data.jobId,
      status: "queued",
      reconciled: admission.reconciled,
      message: admission.reconciled
        ? "작업 큐 응답은 끊겼지만 같은 작업 ID가 접수된 것을 확인해 업로드를 보존했습니다."
        : "ChatGPT CLI 작업자에게 상품 분석과 이미지 제작을 요청했습니다.",
    }, {
      status: 202,
      headers: { "cache-control": "no-store, max-age=0" },
    });
  }
  if (admission.outcome === "ambiguous") {
    return NextResponse.json({
      jobId: parsed.data.jobId,
      reconciliationRequired: true,
      message: "상품 분석 접수 여부를 확정하지 못했습니다. 업로드를 보존하고 같은 작업 ID만 확인합니다.",
    }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
  }
  return NextResponse.json({
    jobId: parsed.data.jobId,
    cleanupPending: admission.cleanupPending,
    message: admission.cleanupPending
      ? "상품 분석 작업이 생성되지 않았습니다. 브라우저에서 임시 업로드 정리를 다시 시도합니다."
      : "상품 분석 작업이 생성되지 않아 임시 업로드를 정리했습니다.",
  }, { status: 400, headers: { "cache-control": "no-store, max-age=0" } });
}
