import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import {
  buildFirstDraftImageEnqueuePayload,
  firstDraftImageAssetIds,
  firstDraftImageEnqueueRequestSchema,
  type FirstDraftImageRejection,
} from "../../../../lib/first-draft-images";
import { maximumStudioSourceImageBytes } from "../../../../lib/studio-source-photo-policy";

export const runtime = "nodejs";
export const maxDuration = 120;

const storageBucket = "sellerpilot-ai";
const noStore = { "cache-control": "no-store, max-age=0" } as const;
const signedUrlSeconds = 60 * 30;

function rejectionStatus(reason: FirstDraftImageRejection) {
  if (reason === "read_failed") return 503;
  if (reason === "not_visible" || reason === "identity_mismatch" || reason === "wrong_kind") return 404;
  if (reason === "already_generated") return 409;
  return 409;
}

function rejectionMessage(reason: FirstDraftImageRejection) {
  if (reason === "read_failed") return "완료된 1차 작업을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.";
  if (reason === "already_generated") return "이미 생성된 1차 이미지가 있어 다시 만들지 않았습니다.";
  if (reason === "not_visible" || reason === "identity_mismatch" || reason === "wrong_kind") {
    return "현재 계정의 완료된 1차 작업을 찾지 못했습니다.";
  }
  if (reason === "not_succeeded") return "완료된 1차 상품정보 분석 작업이어야 이미지를 만들 수 있습니다.";
  if (reason === "source_path_unavailable") return "1차 작업의 원본 사진 경로를 확인하지 못했습니다.";
  if (reason === "result_invalid" || reason === "next_result_invalid" || reason === "preflight_invalid") {
    return "1차 작업 결과의 이미지 계보를 확인하지 못했습니다.";
  }
  return "1차 작업 결과의 이미지 6장 계보를 확인하지 못했습니다.";
}

/**
 * Operator entry point for the Mac first-draft image lane.
 *
 * The Vercel preflight cannot call the image model for this account, so a
 * completed research job whose six canonical assets are `source-photo-catalog`
 * crops is queued here. The Mac worker draws the six concept images and adopts
 * them back into the same result through the worker endpoints.
 */
export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const body = firstDraftImageEnqueueRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ message: "이미지를 생성할 1차 작업 ID를 확인해 주세요." }, { status: 400, headers: noStore });
  }
  const jobId = body.data.jobId;

  const readback = await admin.userClient.rpc("sellerpilot_get_product_research_recovery", { p_id: jobId });
  const resolved = buildFirstDraftImageEnqueuePayload({
    jobId,
    ownerId: admin.user.id,
    data: readback.data,
    error: readback.error,
  });
  if (!resolved.ok) {
    return NextResponse.json({ message: rejectionMessage(resolved.reason), code: resolved.reason }, {
      status: rejectionStatus(resolved.reason),
      headers: noStore,
    });
  }

  const assetPaths = resolved.payload.assets.map((asset) => asset.path);
  const [sourceSigning, assetSigning] = await Promise.all([
    admin.serviceClient.storage.from(storageBucket).createSignedUrls([resolved.payload.sourcePath], signedUrlSeconds),
    admin.serviceClient.storage.from(storageBucket).createSignedUrls(assetPaths, signedUrlSeconds),
  ]);
  if (sourceSigning.error || assetSigning.error) {
    return NextResponse.json({ message: "1차 작업 이미지 경로를 확인하지 못했습니다." }, { status: 503, headers: noStore });
  }
  const signedSource = sourceSigning.data?.[0];
  if (!signedSource || signedSource.error || typeof signedSource.signedUrl !== "string" || !signedSource.signedUrl) {
    return NextResponse.json({
      message: "1차 작업에서 사용한 원본 사진을 찾지 못했습니다. 1차 자동생성을 다시 실행해 주세요.",
      code: "source_original_unavailable",
    }, { status: 409, headers: noStore });
  }
  const signedAssets = assetSigning.data ?? [];
  if (signedAssets.length !== assetPaths.length
      || signedAssets.some((asset, index) => asset.path !== assetPaths[index]
        || asset.error
        || typeof asset.signedUrl !== "string"
        || !asset.signedUrl)) {
    return NextResponse.json({
      message: "1차 작업의 이미지 6장 경로를 확인하지 못했습니다. 1차 자동생성을 다시 실행해 주세요.",
      code: "asset_storage_missing",
    }, { status: 409, headers: noStore });
  }

  // The worker must draw from the exact authoritative original, never from a
  // substituted file, so the enqueue re-hashes the stored original here.
  const originalDownload = await admin.serviceClient.storage.from(storageBucket).download(resolved.payload.sourcePath);
  if (originalDownload.error || !originalDownload.data) {
    return NextResponse.json({ message: "1차 작업 원본 사진을 읽지 못했습니다." }, { status: 503, headers: noStore });
  }
  const originalBytes = new Uint8Array(await originalDownload.data.arrayBuffer());
  if (originalBytes.byteLength < 1 || originalBytes.byteLength > maximumStudioSourceImageBytes) {
    return NextResponse.json({ message: "1차 작업 원본 사진 크기가 안전 한도를 벗어났습니다." }, { status: 409, headers: noStore });
  }
  const sourcePhotoSha256 = createHash("sha256").update(originalBytes).digest("hex");
  if (sourcePhotoSha256 !== resolved.payload.sourcePhotoSha256) {
    return NextResponse.json({
      message: "1차 작업에 사용한 원본 사진과 저장된 확인값이 다릅니다. 1차 자동생성을 다시 실행해 주세요.",
      code: "source_original_mismatch",
    }, { status: 409, headers: noStore });
  }

  const enqueued = await admin.userClient.rpc("sellerpilot_enqueue_first_draft_image_request", { p_job_id: jobId });
  if (enqueued.error) {
    return NextResponse.json({
      message: "1차 이미지 생성 요청을 등록하지 못했습니다.",
      code: enqueued.error.code ?? null,
    }, { status: 500, headers: noStore });
  }
  const status = typeof (enqueued.data as { status?: unknown } | null)?.status === "string"
    ? String((enqueued.data as { status: string }).status)
    : "unknown";
  if (status === "missing" || status === "not-completed" || status === "no-assets") {
    return NextResponse.json({
      message: rejectionMessage(status === "missing" ? "not_visible" : "preflight_invalid"),
      code: status,
    }, { status: 409, headers: noStore });
  }
  if (status === "already-generated") {
    return NextResponse.json({
      message: "이미 생성된 1차 이미지가 있어 다시 만들지 않았습니다.",
      code: "already_generated",
    }, { status: 409, headers: noStore });
  }

  return NextResponse.json({
    jobId,
    queueStatus: status,
    sourcePath: resolved.payload.sourcePath,
    sourcePhotoSha256: resolved.payload.sourcePhotoSha256,
    sourceUrl: signedSource.signedUrl,
    assets: resolved.payload.assets.map((asset, index) => ({
      id: asset.id,
      path: asset.path,
      url: signedAssets[index].signedUrl,
    })),
    productFacts: resolved.payload.productFacts,
    assetIds: [...firstDraftImageAssetIds],
  }, { status: 202, headers: noStore });
}
