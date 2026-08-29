import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError, type AdminApiContext } from "../../../../../lib/admin-api";
import { aiGeneratedAssetSpecs, coreFirstDraftAssetIds } from "../../../../../lib/ai-generated-assets";
import {
  productResearchJobRequestSchema,
  serverProductResearchResultSchema,
} from "../../../../../lib/ai-cli-contract";
import {
  issueProductResearchLineageReceipt,
  productResearchLineageReceiptConfigured,
} from "../../../../../lib/product-research-lineage-receipt";
import { productResearchInputSha256 } from "../../../../../lib/product-research-lineage-receipt-core";
import { withPromiseTimeout } from "../../../../../lib/promise-timeout";
import {
  validateSucceededProductResearchPreflight,
  validateVisibleSucceededProductResearchJob,
} from "../../../../../lib/product-studio-lineage";
import { validatePreservedStudioUploadPaths } from "../../../../../lib/studio-image-paths";
import {
  createSignedStudioImageDownloader,
  sha256PreservedStudioOriginalImage,
  verifyGeneratedStudioImages,
  verifyPreservedStudioImages,
} from "../../../../../lib/studio-image-validation";

export const runtime = "nodejs";
export const maxDuration = 300;

const recoveryRequestSchema = z.object({ jobId: z.string().uuid() }).strict();
const noStoreHeaders = { "cache-control": "no-store, max-age=0" } as const;

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function signedDownloader(paths: string[], admin: AdminApiContext) {
  return createSignedStudioImageDownloader({
    paths,
    sign: () => withPromiseTimeout(
      admin.serviceClient.storage.from("sellerpilot-ai").createSignedUrls(paths, 10 * 60),
      30_000,
      "완료된 1차 작업 이미지 검증 URL 생성 제한시간을 초과했습니다.",
    ),
  });
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const body = recoveryRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ message: "이어갈 1차 작업 ID를 확인해 주세요." }, { status: 400, headers: noStoreHeaders });
  }
  if (!productResearchLineageReceiptConfigured()) {
    return NextResponse.json({
      code: "PRODUCT_RESEARCH_LINEAGE_UNAVAILABLE",
      message: "1차 분석과 원본 사진을 안전하게 연결할 서버 설정이 완료되지 않았습니다.",
    }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const recoveryRead = await withPromiseTimeout(
    admin.userClient.rpc(
      "sellerpilot_get_product_research_recovery",
      { p_id: body.data.jobId },
    ),
    15_000,
    "완료된 1차 작업 조회 제한시간을 초과했습니다.",
  ).catch(() => null);
  if (!recoveryRead) {
    return NextResponse.json({ message: "완료된 1차 작업 조회 시간이 초과되었습니다." }, {
      status: 503,
      headers: noStoreHeaders,
    });
  }
  const { data, error } = recoveryRead;
  const job = recordValue(data);
  if (error) {
    return NextResponse.json({ message: "완료된 1차 작업을 읽지 못했습니다." }, { status: 500, headers: noStoreHeaders });
  }
  if (!job) {
    return NextResponse.json({ message: "현재 계정의 완료된 1차 작업을 찾지 못했습니다." }, { status: 404, headers: noStoreHeaders });
  }

  const storedRequest = productResearchJobRequestSchema.safeParse(job.request);
  const storedResult = serverProductResearchResultSchema.safeParse(job.result);
  const visible = validateVisibleSucceededProductResearchJob({
    expectedJobId: body.data.jobId,
    data: job,
    error: null,
  });
  if (!storedRequest.success
      || !storedResult.success
      || !visible.valid
      || storedRequest.data.jobId !== body.data.jobId
      || storedRequest.data.imagePaths.length !== 1
      || storedRequest.data.imageSpecs.length !== 1
      || storedResult.data.preflightVersion !== 1
      || storedResult.data.researchInputSha256 !== productResearchInputSha256(storedRequest.data.researchInput)
      || storedResult.data.sourcePhotoSha256 !== storedRequest.data.sourcePhotoFingerprint) {
    return NextResponse.json({
      code: "PRODUCT_RESEARCH_RECOVERY_INVALID",
      message: "완료된 1차 작업의 원본·결과 연결을 확인하지 못했습니다.",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const preserved = validatePreservedStudioUploadPaths(
    admin.user.id,
    body.data.jobId,
    storedRequest.data.imagePaths,
    storedRequest.data.imageSpecs,
  );
  const preflight = validateSucceededProductResearchPreflight({
    expectedJobId: body.data.jobId,
    expectedResearchInputSha256: productResearchInputSha256(storedRequest.data.researchInput),
    expectedSourcePhotoSha256: storedRequest.data.sourcePhotoFingerprint,
    data: job,
  });
  if (!preserved || !preflight.valid) {
    return NextResponse.json({
      code: "PRODUCT_RESEARCH_RECOVERY_INVALID",
      message: "완료된 1차 작업의 비공개 이미지 경로를 확인하지 못했습니다.",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const generatedEntries = coreFirstDraftAssetIds.map((assetId) => [
    assetId,
    preflight.preflight.assetStoragePaths[assetId],
  ] as const);
  const generatedValidationEntries = generatedEntries.flatMap(([assetId, path]) => {
    const spec = aiGeneratedAssetSpecs.find((candidate) => candidate.id === assetId);
    return spec ? [{
      id: assetId,
      path,
      digest: preflight.preflight.assetDigests[assetId],
      width: spec.width,
      height: spec.height,
    }] : [];
  });
  if (generatedValidationEntries.length !== coreFirstDraftAssetIds.length) {
    return NextResponse.json({
      code: "PRODUCT_RESEARCH_RECOVERY_INVALID",
      message: "완료된 1차 작업의 이미지 역할 규격을 확인하지 못했습니다.",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const verificationPaths = [
    ...preserved.allPaths,
    ...generatedEntries.map(([, path]) => path),
  ];
  const download = await signedDownloader(verificationPaths, admin);
  const verified = download ? await verifyPreservedStudioImages({
    normalizedPaths: preserved.imagePaths,
    originalPaths: preserved.originalPaths,
    specs: storedRequest.data.imageSpecs,
    download,
  }) : { normalized: false, originals: false };
  const sourcePhotoSha256 = download ? await sha256PreservedStudioOriginalImage(
    preserved.originalPaths[0],
    storedRequest.data.imageSpecs[0],
    download,
  ) : null;
  const generatedVerified = download ? await verifyGeneratedStudioImages({
    entries: generatedValidationEntries,
    download,
  }) : false;
  if (!verified.normalized
      || !verified.originals
      || sourcePhotoSha256 !== storedRequest.data.sourcePhotoFingerprint) {
    return NextResponse.json({
      code: "PRODUCT_RESEARCH_SOURCE_UNAVAILABLE",
      message: "완료된 1차 작업의 원본 사진을 다시 확인하지 못했습니다.",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }
  if (!generatedVerified) {
    return NextResponse.json({
      code: "PRODUCT_RESEARCH_GENERATED_ASSETS_UNAVAILABLE",
      message: "완료된 1차 작업의 이미지 6장을 다시 확인하지 못했습니다.",
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const generatedPaths = generatedEntries.map(([, path]) => path);
  const [sourceSigning, generatedSigning] = await Promise.all([
    withPromiseTimeout(
      admin.serviceClient.storage.from("sellerpilot-ai").createSignedUrls([preserved.originalPaths[0]], 10 * 60),
      30_000,
      "완료된 원본사진 연결 제한시간을 초과했습니다.",
    ).catch(() => null),
    withPromiseTimeout(
      admin.serviceClient.storage.from("sellerpilot-ai").createSignedUrls(generatedPaths, 60 * 60),
      30_000,
      "완료된 이미지 6장 연결 제한시간을 초과했습니다.",
    ).catch(() => null),
  ]);
  const sourceSigned = sourceSigning?.data;
  const generatedSigned = generatedSigning?.data;
  if (!sourceSigning
      || sourceSigning.error
      || !sourceSigned
      || sourceSigned.length !== 1
      || typeof sourceSigned[0]?.signedUrl !== "string"
      || sourceSigned[0].signedUrl.length === 0
      || !generatedSigning
      || generatedSigning.error
      || !generatedSigned
      || generatedSigned.length !== generatedPaths.length
      || generatedSigned.some((item) => typeof item.signedUrl !== "string" || item.signedUrl.length === 0)) {
    return NextResponse.json({
      message: "완료된 1차 작업의 이미지 연결을 잠시 만들지 못했습니다.",
    }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
  }

  const sourceSpec = storedRequest.data.imageSpecs[0];
  const safeResult = { ...storedResult.data, asset_storage_paths: undefined };
  return NextResponse.json({
    jobId: body.data.jobId,
    researchInput: storedRequest.data.researchInput,
    sourcePhotoSha256: storedRequest.data.sourcePhotoFingerprint,
    lineageReceipt: issueProductResearchLineageReceipt({
      ownerId: admin.user.id,
      researchJobId: body.data.jobId,
      researchInput: storedRequest.data.researchInput,
      sourcePhotoSha256: storedRequest.data.sourcePhotoFingerprint,
    }),
    sourcePhoto: {
      url: sourceSigned[0]!.signedUrl,
      name: sourceSpec.originalName,
      mediaType: sourceSpec.originalMediaType,
      bytes: sourceSpec.originalBytes,
      width: sourceSpec.originalWidth,
      height: sourceSpec.originalHeight,
    },
    result: {
      ...safeResult,
      generatedImages: generatedEntries.map(([assetId], index) => ({
        id: assetId,
        url: generatedSigned[index]!.signedUrl,
      })),
    },
  }, { headers: { "cache-control": "no-store, max-age=0" } });
}
