import { after, NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError, type AdminApiContext } from "../../../../lib/admin-api";
import { rejectedUploadPaths } from "../../../../lib/ai-upload-guard";
import {
  productResearchJobRequestSchema,
  serverProductResearchResultSchema,
} from "../../../../lib/ai-cli-contract";
import { withPromiseTimeout } from "../../../../lib/promise-timeout";
import {
  issueProductResearchLineageReceipt,
  productResearchLineageReceiptConfigured,
} from "../../../../lib/product-research-lineage-receipt";
import { productResearchInputSha256 } from "../../../../lib/product-research-lineage-receipt-core";
import {
  createProductResearchJobWithLegacyFallback,
  isMissingProductResearchRpcContract,
} from "../../../../lib/product-research-rpc-compatibility";
import { wakeServerProductResearchAfterResponse } from "../../../../lib/server-product-research-runtime";
import { readServerProductStudioReadiness } from "../../../../lib/server-product-studio-runtime";
import { expandStudioCleanupStoragePaths, validatePreservedStudioUploadPaths } from "../../../../lib/studio-image-paths";
import {
  createSignedStudioImageDownloader,
  sha256PreservedStudioOriginalImage,
  verifyPreservedStudioImages,
} from "../../../../lib/studio-image-validation";

export const runtime = "nodejs";
export const maxDuration = 300;

async function researchValidationDownloader(paths: string[], admin: AdminApiContext) {
  return createSignedStudioImageDownloader({
    paths,
    sign: () => withPromiseTimeout(
      admin.serviceClient.storage.from("sellerpilot-ai").createSignedUrls(paths, 10 * 60),
      30_000,
      "1차 상품 이미지 검증 URL 생성 제한시간을 초과했습니다.",
    ),
  });
}

async function readExactProductResearchJob(admin: AdminApiContext, jobId: string) {
  return withPromiseTimeout(
    admin.userClient.rpc("sellerpilot_get_ai_job", { p_id: jobId }),
    15_000,
    "1차 상품정보 작업 큐 확인 제한시간을 초과했습니다.",
  ).catch(() => null);
}

async function cleanupResearchUploadsOnlyWhenJobIsAbsent(
  admin: AdminApiContext,
  jobId: string,
  paths: string[],
) {
  const readback = await readExactProductResearchJob(admin, jobId);
  // A missing response is not proof that enqueue failed. Only a readable null
  // for this exact creator-visible UUID permits source-upload deletion.
  if (!readback || readback.error || readback.data != null) return false;
  const { error } = await admin.serviceClient.storage.from("sellerpilot-ai").remove(paths);
  return !error;
}

function exactAcceptedProductResearchJob(input: {
  data: unknown;
  jobId: string;
  researchInput: string;
  sourcePhotoSha256: string;
}) {
  const { data, jobId, researchInput, sourcePhotoSha256 } = input;
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const job = data as Record<string, unknown>;
  if (job.id !== jobId || job.kind !== "product_research" || job.status !== "succeeded") return false;
  const result = serverProductResearchResultSchema.safeParse(job.result);
  return result.success
    && result.data.preflightVersion === 1
    && result.data.researchInputSha256 === productResearchInputSha256(researchInput)
    && result.data.sourcePhotoSha256 === sourcePhotoSha256;
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const payload = await request.json().catch(() => null);
  const parsed = productResearchJobRequestSchema.safeParse(payload);
  if (!parsed.success) {
    const orphanedPaths = expandStudioCleanupStoragePaths(rejectedUploadPaths(payload, admin.user.id));
    const candidateJobId = payload && typeof payload === "object" && !Array.isArray(payload)
      && typeof (payload as Record<string, unknown>).jobId === "string"
      ? (payload as Record<string, unknown>).jobId as string
      : "";
    if (orphanedPaths.length && candidateJobId) {
      await cleanupResearchUploadsOnlyWhenJobIsAbsent(admin, candidateJobId, orphanedPaths);
    }
    return NextResponse.json({ message: "상품 링크나 설명을 2자 이상 입력해 주세요." }, { status: 400 });
  }

  const preservedPaths = validatePreservedStudioUploadPaths(
    admin.user.id,
    parsed.data.jobId,
    parsed.data.imagePaths,
    parsed.data.imageSpecs,
  );
  if (!preservedPaths) {
    return NextResponse.json({ message: "현재 사용자의 비공개 이미지 경로만 1차 분석에 등록할 수 있습니다." }, { status: 403 });
  }
  const uploadedPaths = preservedPaths.imagePaths;
  const allUploadedPaths = preservedPaths.allPaths;

  const readiness = await readServerProductStudioReadiness(admin, request);
  if (!readiness.available) {
    const cleaned = await cleanupResearchUploadsOnlyWhenJobIsAbsent(
      admin,
      parsed.data.jobId,
      allUploadedPaths,
    );
    return NextResponse.json({
      code: "AI_WORKER_UNAVAILABLE",
      workerAvailable: false,
      cleanupPending: !cleaned,
      message: readiness.message,
    }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
  }

  if (!productResearchLineageReceiptConfigured()) {
    const cleaned = await cleanupResearchUploadsOnlyWhenJobIsAbsent(
      admin,
      parsed.data.jobId,
      allUploadedPaths,
    );
    return NextResponse.json({
      code: "PRODUCT_RESEARCH_LINEAGE_UNAVAILABLE",
      workerAvailable: false,
      cleanupPending: !cleaned,
      message: "1차 분석과 원본 사진을 안전하게 연결할 서버 설정이 완료되지 않았습니다.",
    }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const download = await researchValidationDownloader(allUploadedPaths, admin);
  const verified = download ? await verifyPreservedStudioImages({
    normalizedPaths: uploadedPaths,
    originalPaths: preservedPaths.originalPaths,
    specs: parsed.data.imageSpecs,
    download,
  }) : { normalized: false, originals: false };
  if (!verified.normalized || !verified.originals) {
    const cleaned = await cleanupResearchUploadsOnlyWhenJobIsAbsent(
      admin,
      parsed.data.jobId,
      allUploadedPaths,
    );
    return NextResponse.json({
      code: "SOURCE_IMAGE_INVALID",
      cleanupPending: !cleaned,
      message: !verified.normalized
        ? "1차 분석용 이미지는 1200×1200 JPG·3MB 이하 규격이어야 합니다."
        : "1차 분석용 원본 이미지의 형식·크기·픽셀 정보가 업로드 요청과 일치하지 않습니다.",
    }, { status: 400, headers: { "cache-control": "no-store, max-age=0" } });
  }
  const uploadedMainSourceSha256 = download ? await sha256PreservedStudioOriginalImage(
    preservedPaths.originalPaths[0],
    parsed.data.imageSpecs[0],
    download,
  ) : null;
  if (!uploadedMainSourceSha256 || uploadedMainSourceSha256 !== parsed.data.sourcePhotoFingerprint) {
    const cleaned = await cleanupResearchUploadsOnlyWhenJobIsAbsent(
      admin,
      parsed.data.jobId,
      allUploadedPaths,
    );
    return NextResponse.json({
      code: "SOURCE_PHOTO_MISMATCH",
      cleanupPending: !cleaned,
      message: "브라우저에서 선택한 대표사진과 1차 분석용 원본이 일치하지 않습니다.",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const { error } = await createProductResearchJobWithLegacyFallback({
    jobId: parsed.data.jobId,
    researchInput: parsed.data.researchInput,
    sourcePhotoSha256: parsed.data.sourcePhotoFingerprint,
    imagePaths: uploadedPaths,
    imageSpecs: parsed.data.imageSpecs,
    preflightVersion: 1,
    createJob: async (arguments_) => {
      const result = await admin.userClient.rpc("sellerpilot_create_ai_job", arguments_);
      return { error: result.error };
    },
  });
  let reconciled = false;
  if (error) {
    const readback = await readExactProductResearchJob(admin, parsed.data.jobId);
    if (readback && !readback.error && exactAcceptedProductResearchJob({
      data: readback.data,
      jobId: parsed.data.jobId,
      researchInput: parsed.data.researchInput,
      sourcePhotoSha256: parsed.data.sourcePhotoFingerprint,
    })) {
      reconciled = true;
    } else if (readback && !readback.error && readback.data == null) {
      const { error: cleanupError } = await admin.serviceClient.storage
        .from("sellerpilot-ai")
        .remove(allUploadedPaths);
      const missingContract = isMissingProductResearchRpcContract(error);
      return NextResponse.json({
        code: missingContract ? "PRODUCT_RESEARCH_PREFLIGHT_UNAVAILABLE" : "PRODUCT_RESEARCH_ENQUEUE_FAILED",
        cleanupPending: Boolean(cleanupError),
        message: missingContract
          ? "현재 데이터베이스가 이미지 기반 1차 분석 작업 계약을 지원하지 않습니다. 구형 최종작성 작업으로 대체하지 않았습니다."
          : "AI 상품정보 수집 작업을 등록하지 못했습니다.",
      }, { status: missingContract ? 503 : 500, headers: { "cache-control": "no-store, max-age=0" } });
    } else {
      return NextResponse.json({
        code: "PRODUCT_RESEARCH_RECONCILIATION_REQUIRED",
        reconciliationRequired: true,
        cleanupPending: true,
        message: "1차 분석 접수 여부를 확정하지 못해 원본 이미지를 보존했습니다. 같은 작업 ID로 상태를 다시 확인해 주세요.",
      }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
    }
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
    reconciled,
    message: reconciled
      ? "접수 응답은 끊겼지만 동일한 1차 분석 작업이 생성된 것을 확인해 원본 이미지를 보존했습니다."
      : "Vercel 서버 AI가 상품 링크·설명과 원본 사진을 함께 조사하고 있습니다.",
  }, {
    status: 202,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
