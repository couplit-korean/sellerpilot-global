import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import { productIntakeSchema } from "../../../../lib/product-intake";
import { issueProductResearchLineageReceipt } from "../../../../lib/product-research-lineage-receipt";
import { productResearchInputSha256 } from "../../../../lib/product-research-lineage-receipt-core";
import {
  validateSucceededProductResearchPreflight,
  validateVisibleSucceededProductResearchJob,
} from "../../../../lib/product-studio-lineage";

export const runtime = "nodejs";
export const maxDuration = 120;

const storageBucket = "sellerpilot-ai";
const noStore = { "cache-control": "no-store, max-age=0" } as const;

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function rewriteJobPath(path: unknown, sourceJobId: string, targetJobId: string) {
  if (typeof path !== "string" || !path) return "";
  return path.split(sourceJobId).join(targetJobId);
}

// Operator entry point that starts the detail-page generation without relying on
// the client photo upload or the publishing screen's client-side guard chain.
// The source photos of a completed first draft are copied server-side with the
// service role, so the same validated contract the worker expects is preserved.
export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const body = record(await request.json().catch(() => null));
  const sourceResearchJobId = typeof body?.sourceResearchJobId === "string" ? body.sourceResearchJobId : "";
  const parsedIntake = productIntakeSchema.safeParse(body?.manualFields);
  if (!sourceResearchJobId || !parsedIntake.success) {
    return NextResponse.json({
      message: parsedIntake.success
        ? "1차 작업 ID를 확인해 주세요."
        : parsedIntake.error.issues[0]?.message ?? "판매자 필수 상품 정보를 확인해 주세요.",
    }, { status: 400, headers: noStore });
  }
  const manualFields = parsedIntake.data;

  const readback = await admin.userClient.rpc("sellerpilot_get_ai_job", { p_id: sourceResearchJobId });
  const source = validateVisibleSucceededProductResearchJob({
    expectedJobId: sourceResearchJobId,
    data: readback.data,
    error: readback.error,
  });
  if (!source.valid) {
    return NextResponse.json({
      message: source.reason === "read_failed"
        ? "1차 상품정보 분석 결과를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요."
        : "완료된 1차 상품정보 분석 작업이 있어야 상세페이지 제작을 시작할 수 있습니다.",
      code: source.reason,
    }, { status: source.reason === "read_failed" ? 503 : 409, headers: noStore });
  }

  const jobResult = record(record(readback.data)?.result);
  const sourcePhotoSha256 = typeof jobResult?.sourcePhotoSha256 === "string" ? jobResult.sourcePhotoSha256 : "";
  const userId = admin.user.id;
  const inputPath = `${userId}/${sourceResearchJobId}/input/001.jpg`;
  const originalPath = `${userId}/${sourceResearchJobId}/original/001.source`;
  const [inputObject, originalObject] = await Promise.all([
    admin.serviceClient.storage.from(storageBucket).download(inputPath),
    admin.serviceClient.storage.from(storageBucket).download(originalPath),
  ]);
  if (inputObject.error || originalObject.error || !inputObject.data || !originalObject.data) {
    return NextResponse.json({ message: "1차 자동생성에 사용한 사진을 찾지 못했습니다. 1차 자동생성을 다시 실행해 주세요." }, { status: 409, headers: noStore });
  }
  const sharp = (await import("sharp")).default;
  const inputBytes = new Uint8Array(await inputObject.data.arrayBuffer());
  const originalBytes = new Uint8Array(await originalObject.data.arrayBuffer());
  const inputMeta = await sharp(inputBytes, { failOn: "warning", limitInputPixels: 16_000_000 }).metadata().catch(() => null);
  const originalMeta = await sharp(originalBytes, { failOn: "warning", limitInputPixels: 16_000_000 }).metadata().catch(() => null);
  if (!inputMeta?.width || !originalMeta?.width || !/^[a-f0-9]{64}$/.test(sourcePhotoSha256)) {
    return NextResponse.json({ message: "1차 사진 규격을 확인하지 못했습니다. 1차 자동생성을 다시 실행해 주세요." }, { status: 409, headers: noStore });
  }
  const sourceImageSpecs: Array<Record<string, unknown>> = [{
    name: "001.jpg",
    role: "main",
    bytes: inputBytes.byteLength,
    width: inputMeta.width,
    height: inputMeta.height,
    mediaType: "image/jpeg",
    originalName: "001.source",
    originalPath,
    originalBytes: originalBytes.byteLength,
    originalWidth: originalMeta.width,
    originalHeight: originalMeta.height,
    originalMediaType: "image/jpeg",
    fit: "contain",
  }];

  const preflight = validateSucceededProductResearchPreflight({
    expectedJobId: sourceResearchJobId,
    expectedResearchInputSha256: productResearchInputSha256(manualFields.researchInput),
    expectedSourcePhotoSha256: sourcePhotoSha256,
    data: readback.data,
  });
  if (!preflight.valid) {
    return NextResponse.json({
      message: preflight.reason === "research_input_mismatch"
        ? "1차 자동생성에 사용한 상품 링크·설명과 현재 검수 내용이 다릅니다. 현재 내용으로 1차 자동생성을 다시 실행해 주세요."
        : "1차 자동생성 이미지의 경로·해시 이력을 확인하지 못해 상세페이지 제작을 시작하지 않았습니다.",
      code: preflight.reason,
    }, { status: 409, headers: noStore });
  }

  const lineageReceipt = issueProductResearchLineageReceipt({
    ownerId: admin.user.id,
    researchJobId: sourceResearchJobId,
    researchInput: manualFields.researchInput,
    sourcePhotoSha256,
  });
  if (!lineageReceipt) {
    return NextResponse.json({
      message: "1차 분석과 원본 사진을 확인할 서버 설정이 완료되지 않았습니다.",
    }, { status: 503, headers: noStore });
  }

  const jobId = randomUUID();
  const imagePaths: string[] = [];
  const imageSpecs: Array<Record<string, unknown>> = [];
  for (const spec of sourceImageSpecs) {
    const nextPath = rewriteJobPath(inputPath, sourceResearchJobId, jobId);
    const nextOriginalPath = rewriteJobPath(String(spec.originalPath), sourceResearchJobId, jobId);
    if (!nextPath || !nextOriginalPath) {
      return NextResponse.json({ message: "1차 사진 경로를 옮기지 못했습니다." }, { status: 409, headers: noStore });
    }
    const copies = await Promise.all([
      admin.serviceClient.storage.from(storageBucket).copy(inputPath, nextPath),
      admin.serviceClient.storage.from(storageBucket).copy(originalPath, nextOriginalPath),
    ]);
    if (copies.some((result) => result.error)) {
      return NextResponse.json({
        message: "1차 사진을 상세페이지 작업 경로로 복사하지 못했습니다.",
        code: "STUDIO_PHOTO_COPY_FAILED",
      }, { status: 502, headers: noStore });
    }
    imagePaths.push(nextPath);
    imageSpecs.push({ ...spec, originalPath: nextOriginalPath });
  }

  const requestPayload = {
    source_research_job_id: sourceResearchJobId,
    source_research_input_sha256: productResearchInputSha256(manualFields.researchInput),
    source_photo_sha256: sourcePhotoSha256,
    description: manualFields.description.trim(),
    product_url: manualFields.productUrl.trim(),
    research_input: manualFields.researchInput.trim(),
    manual_fields: manualFields,
    image_paths: imagePaths,
    image_specs: imageSpecs,
    preflight_version: preflight.preflight.preflightVersion,
    preflight_asset_storage_paths: preflight.preflight.assetStoragePaths,
    preflight_asset_digests: preflight.preflight.assetDigests,
    preflight_asset_audit_lineage: preflight.preflight.auditLineage,
    human_review_confirmation: {
      first_draft_reviewed: true,
      source: "authenticated_admin_request",
      source_research_job_id: sourceResearchJobId,
    },
  };
  const created = await admin.userClient.rpc("sellerpilot_create_ai_job", {
    p_id: jobId,
    p_kind: "product_studio",
    p_request_payload: requestPayload,
  });
  if (created.error) {
    return NextResponse.json({
      message: "상세페이지 제작 작업을 등록하지 못했습니다.",
      code: created.error.code ?? null,
    }, { status: 500, headers: noStore });
  }
  return NextResponse.json({ jobId, status: "queued" }, { status: 202, headers: noStore });
}
