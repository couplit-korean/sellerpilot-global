import { readApprovedExternalDetailPublishContext } from "../../../../../../lib/server-external-detail-publish-context";
import { readExternalDetailImportContext, externalDetailImportTarget } from "../../../../../../lib/server-external-detail-import-api";
import { approvedExternalDetailManifest } from "../../../../../../lib/server-external-detail-manifest";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../../lib/admin-api";
import { productEditSchema } from "../../../../../../lib/product-intake";
import { inspectProductDetailImageDocument } from "../../../../../../lib/product-detail-image-manifest";
import { resolveProductDetailDocumentAssetPaths } from "../../../../../../lib/server-product-detail-manifest";
import {
  detailAnimatedGifMaximumAltLength,
  detailAnimatedGifMaximumCaptionLength,
  detailAnimatedGifMaximumUrlLength,
  validateDetailAnimatedGif,
} from "../../../../../../lib/product-media-contract";
import { validateStoredProductGeneratedAssetPaths } from "../../../../../../lib/studio-result-assets";
import { inspectStudioResultQuality } from "../../../../../../lib/studio-result-quality";

export const runtime = "nodejs";

const productIdSchema = z.string().uuid();
const noteSchema = z.object({
  supplierName: z.string().trim().max(240),
  comparisonMemo: z.string().trim().max(4000),
  competitorQuery: z.string().trim().max(500),
  competitorMonitorEnabled: z.boolean(),
});
const detailPageBlockTypes = ["HeroBlock", "VerificationRibbonBlock", "BenefitBlock", "ImageStoryBlock", "AnimatedGifBlock", "StoryBlock", "CtaBlock"] as const;
const animatedGifPropsSchema = z.object({
  id: z.string().trim().min(1).max(120),
  gifUrl: z.string().max(detailAnimatedGifMaximumUrlLength),
  posterUrl: z.string().max(detailAnimatedGifMaximumUrlLength),
  alt: z.string().max(detailAnimatedGifMaximumAltLength),
  caption: z.string().max(detailAnimatedGifMaximumCaptionLength),
  tone: z.enum(["light", "dark"]),
}).passthrough();
const detailPageDataSchema = z.object({
  root: z.record(z.string(), z.unknown()),
  content: z.array(z.object({
    type: z.enum(detailPageBlockTypes),
    props: z.record(z.string(), z.unknown()),
  }).passthrough().superRefine((block, context) => {
    if (block.type !== "AnimatedGifBlock") return;
    const props = animatedGifPropsSchema.safeParse(block.props);
    if (!props.success || !validateDetailAnimatedGif(props.data).canAnimate) {
      context.addIssue({
        code: "custom",
        path: ["props"],
        message: "GIF 블록은 검증된 HTTPS GIF·poster URL과 대체텍스트·캡션이 모두 필요합니다.",
      });
    }
  })).max(64),
}).passthrough();
const detailPageSaveSchema = z.object({
  data: detailPageDataSchema,
  expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
}).strict();
const maximumDetailPagePayloadBytes = 256 * 1024;

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function stringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, string>;
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const params = await context.params;
  const productId = productIdSchema.safeParse(params.id);
  if (!productId.success) return NextResponse.json({ message: "상품 ID 형식이 올바르지 않습니다." }, { status: 400 });

  let approvedExternalContext: Awaited<ReturnType<typeof readApprovedExternalDetailPublishContext>> | null = null;
  let inspectedExternalContext: Record<string, unknown> | null = null;
  let externalReadUnavailable = false;
  if (productId.data === externalDetailImportTarget) {
    try {
      inspectedExternalContext = await readExternalDetailImportContext(admin, productId.data);
      const externalRow = isRecord(inspectedExternalContext?.externalDetailImport) ? inspectedExternalContext.externalDetailImport : null;
      if (externalRow?.status === "approved") {
        // This is an independent approved source, not a retry of an unchecked
        // predecessor to the Studio lineage guard.
        approvedExternalContext = await readApprovedExternalDetailPublishContext(admin, productId.data);
        inspectedExternalContext = {externalDetailImport:approvedExternalContext.externalDetailImport};
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : "EXTERNAL_DETAIL_PUBLISH_READ_FAILED";
      if (code.includes("OWNER")) return NextResponse.json({code,message:"상품 소유자 권한이 필요합니다."},{status:403});
      if (isRecord(inspectedExternalContext?.externalDetailImport)) return NextResponse.json({code,message:"현재 외부 승인 source의 상품·버전·해시를 확인하지 못했습니다."},{status:409});
      externalReadUnavailable = true;
    }
  }
  const [{ data, error }, { data: commerceOperations, error: operationsError }] = await Promise.all([
    approvedExternalContext ? Promise.resolve({data:approvedExternalContext,error:null}) : admin.userClient.rpc("sellerpilot_get_product_publish_context", { p_product_id: productId.data }),
    admin.userClient.rpc("sellerpilot_get_product_operations_v2", { p_product_id: productId.data }),
  ]);
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ message: "상품 등록 준비 정보를 불러오지 못했습니다." }, { status: 404 });
  }

  const payload = data as Record<string, unknown>;
  let externalDetailImport: unknown = null;
  let externalDetailImportStatus = "not_applicable";
  if (productId.data === externalDetailImportTarget) {
    try {
      if (externalReadUnavailable || !inspectedExternalContext) throw Error("external context unavailable");
      const externalContext = inspectedExternalContext;
      externalDetailImportStatus = "available";
      const importedRecord = isRecord(externalContext.externalDetailImport) ? externalContext.externalDetailImport : null;
      const externalManifest = approvedExternalDetailManifest(importedRecord);
      if (externalManifest && importedRecord) {
        const signed = await admin.serviceClient.storage.from("sellerpilot-detail-imports").createSignedUrls(externalManifest.images.map(image => image.path), 3600);
        if (signed.error || signed.data?.length !== 8 || signed.data.some(image => !image.signedUrl)) throw Error("signing failed");
        externalDetailImport = { ...importedRecord, manifest: externalManifest, signedImages: externalManifest.images.map((image,index) => ({...image,url:signed.data![index].signedUrl})) };
      } else { externalDetailImport = externalContext.externalDetailImport; }
    } catch { externalDetailImportStatus = "unavailable"; }
  }
  const productOwnerId = typeof payload.ownerId === "string" ? payload.ownerId : admin.user.id;
  const sourcePaths = stringList(payload.sourceImagePaths)
    .filter((path) => path.startsWith(`${productOwnerId}/`) && !path.includes(".."));
  const rawGeneratedPaths = stringRecord(payload.generatedImagePaths);
  const validatedGeneratedPaths = validateStoredProductGeneratedAssetPaths(rawGeneratedPaths);
  const generatedPaths = validatedGeneratedPaths ?? [];
  let generatedImagesStatus: "complete" | "missing" | "incomplete" | "unavailable" = Object.keys(rawGeneratedPaths).length === 0
    ? "missing"
    : validatedGeneratedPaths
      ? "complete"
      : "incomplete";
  const [sourceSigning, generatedSigning] = await Promise.all([
    sourcePaths.length
      ? admin.serviceClient.storage.from("sellerpilot-ai").createSignedUrls(sourcePaths, 2 * 60 * 60)
      : Promise.resolve({ data: [], error: null }),
    generatedPaths.length
      ? admin.serviceClient.storage.from("sellerpilot-ai").createSignedUrls(generatedPaths.map(([, path]) => path), 2 * 60 * 60)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (sourceSigning.error) {
    return NextResponse.json({ message: "상품 원본 이미지 접근 주소를 만들지 못했습니다." }, { status: 500 });
  }

  const sourceSigned = sourceSigning.data ?? [];
  if (sourceSigned.length !== sourcePaths.length
      || sourceSigned.some((item) => typeof item.signedUrl !== "string" || item.signedUrl.length === 0)) {
    return NextResponse.json({ message: "상품 원본 이미지 연결을 잠시 확인하지 못했습니다." }, { status: 503 });
  }
  const generatedSigned = generatedSigning.data ?? [];
  if (generatedImagesStatus === "complete"
      && (generatedSigning.error
        || generatedSigned.length !== generatedPaths.length
        || generatedSigned.some((item) => typeof item.signedUrl !== "string" || item.signedUrl.length === 0))) {
    generatedImagesStatus = "unavailable";
  }
  const sourceImages = sourcePaths.map((path, index) => ({ path, url: sourceSigned[index]!.signedUrl }));
  const generatedImages = generatedImagesStatus === "complete"
    ? generatedPaths.map(([id, path], index) => ({ id, path, url: generatedSigned[index]!.signedUrl }))
    : [];
  delete payload.ownerId;
  delete payload.sourceImagePaths;
  delete payload.generatedImagePaths;
  const studioResult = isRecord(payload.studioResult) && Array.isArray(payload.localizedListings)
    ? { ...payload.studioResult, localizedListings: payload.localizedListings }
    : payload.studioResult;
  return NextResponse.json({
    ...payload,
    externalDetailImport,
    externalDetailImportStatus,
    studioResult,
    studioQuality: inspectStudioResultQuality(studioResult),
    commerceOperations: operationsError ? null : commerceOperations,
    sourceImages,
    generatedImages,
    generatedImagesStatus,
  }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const productId = productIdSchema.safeParse((await context.params).id);
  const body = noteSchema.safeParse(await request.json().catch(() => null));
  if (!productId.success || !body.success) return NextResponse.json({ message: "공급처·비교 메모 입력값을 확인해 주세요." }, { status: 400 });
  const { data, error } = await admin.userClient.rpc("sellerpilot_update_product_commerce_notes", {
    p_product_id: productId.data,
    p_supplier_name: body.data.supplierName,
    p_comparison_memo: body.data.comparisonMemo,
    p_competitor_query: body.data.competitorQuery,
    p_monitor_enabled: body.data.competitorMonitorEnabled,
  });
  if (error || data !== true) return NextResponse.json({ message: "공급처·비교 메모를 저장하지 못했습니다." }, { status: 500 });
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store, max-age=0" } });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const productId = productIdSchema.safeParse((await context.params).id);
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > maximumDetailPagePayloadBytes) {
    return NextResponse.json({ message: "상세페이지 편집 결과는 256KB 이하로 저장해 주세요." }, { status: 413 });
  }
  let input: unknown = null;
  try {
    input = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ message: "상세페이지 저장 요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const body = detailPageSaveSchema.safeParse(input);
  if (!productId.success || !body.success) {
    return NextResponse.json({
      message: productId.success
        ? body.success ? "상세페이지 블록 구성을 확인해 주세요." : body.error.issues[0]?.message ?? "상세페이지 블록 구성을 확인해 주세요."
        : "상품 ID 형식이 올바르지 않습니다.",
    }, { status: 400 });
  }
  const detailImageInspection = inspectProductDetailImageDocument(body.data.data);
  if (!detailImageInspection.ok) {
    return NextResponse.json({
      code: detailImageInspection.code,
      message: detailImageInspection.message,
    }, { status: 400 });
  }
  const { data: currentContext, error: currentContextError } = await admin.userClient.rpc(
    "sellerpilot_get_product_publish_context",
    { p_product_id: productId.data },
  );
  const contextRecord = isRecord(currentContext) ? currentContext : null;
  const studioQuality = inspectStudioResultQuality(contextRecord?.studioResult);
  if (!currentContextError && contextRecord && studioQuality.blockedForPublication) {
    return NextResponse.json({
      code: "STUDIO_DEGRADED_RESULT_REGENERATION_REQUIRED",
      message: studioQuality.message,
    }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
  }
  const resolvedAssets = contextRecord
    ? resolveProductDetailDocumentAssetPaths(body.data.data, contextRecord.generatedImagePaths)
    : null;
  if (currentContextError || !resolvedAssets?.ok) {
    return NextResponse.json({
      code: resolvedAssets && !resolvedAssets.ok ? resolvedAssets.code : "DETAIL_PAGE_ASSETS_UNRESOLVED",
      message: "상세 이미지 8장의 현재 운영 저장 경로를 확인하지 못했습니다.",
    }, { status: 409 });
  }
  const detailBucket = admin.serviceClient.storage.from("sellerpilot-ai");
  const approvedSourceImages = await Promise.all(resolvedAssets.value.map(async (asset) => {
    const { data, error } = await detailBucket.download(asset.path);
    if (error || !data || data.size < 1 || data.size > 10 * 1024 * 1024) return null;
    const bytes = Buffer.from(await data.arrayBuffer());
    return {
      role: asset.role,
      path: asset.path,
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    };
  })).catch(() => []);
  if (approvedSourceImages.length !== resolvedAssets.value.length
      || approvedSourceImages.some((asset) => !asset)
      || new Set(approvedSourceImages.map((asset) => asset?.sourceSha256)).size !== resolvedAssets.value.length) {
    return NextResponse.json({
      code: "DETAIL_PAGE_ASSETS_UNRESOLVED",
      message: "상세 이미지 8장의 운영 저장소 원본 바이트를 서로 다르게 확인하지 못했습니다.",
    }, { status: 409 });
  }
  const { data, error } = await admin.userClient.rpc("sellerpilot_save_product_detail_page", {
    p_product_id: productId.data,
    p_data: body.data.data,
    p_expected_version: body.data.expectedVersion,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    const versionConflict = error?.message?.includes("DETAIL_PAGE_VERSION_CONFLICT");
    const rejectedPayload = error?.message?.includes("DETAIL_PAGE_INVALID");
    const unresolvedAssets = error?.message?.includes("DETAIL_PAGE_ASSETS_UNRESOLVED");
    return NextResponse.json({
      code: versionConflict ? "DETAIL_PAGE_VERSION_CONFLICT" : rejectedPayload ? "DETAIL_PAGE_INVALID" : unresolvedAssets ? "DETAIL_PAGE_ASSETS_UNRESOLVED" : "DETAIL_PAGE_SAVE_FAILED",
      message: versionConflict
        ? "다른 화면에서 상세페이지가 먼저 수정됐습니다. 최신 저장본을 다시 불러왔습니다."
        : rejectedPayload ? "상세페이지 블록 구성이나 크기 제한을 확인해 주세요." : unresolvedAssets ? "상세 이미지 역할과 현재 운영 저장 경로가 일치하지 않습니다. 이미지를 다시 확인해 주세요." : "상세페이지 편집 내용을 저장하지 못했습니다.",
    }, { status: versionConflict || unresolvedAssets ? 409 : rejectedPayload ? 400 : 500 });
  }
  const savedDetailPage = data as Record<string, unknown>;
  const savedManifest = isRecord(savedDetailPage.imageManifest) ? savedDetailPage.imageManifest : null;
  const savedVersion = Number(savedDetailPage.version);
  const { data: sourceBoundManifest, error: sourceBindingError } = await admin.serviceClient.rpc(
    "sellerpilot_service_bind_product_detail_page_source_digests",
    {
      p_product_id: productId.data,
      p_owner_id: admin.user.id,
      p_version: savedVersion,
      p_prior_manifest_digest: typeof savedManifest?.digest === "string" ? savedManifest.digest : "",
      p_images: approvedSourceImages,
    },
  );
  if (sourceBindingError || !isRecord(sourceBoundManifest)) {
    return NextResponse.json({
      code: "DETAIL_PAGE_SOURCE_BINDING_FAILED",
      message: "상세 이미지 8장의 승인 원본 해시를 저장하지 못했습니다. 이 페이지는 외부 채널 게시에 사용할 수 없습니다.",
    }, { status: 500 });
  }
  return NextResponse.json({
    detailPage: { ...savedDetailPage, imageManifest: sourceBoundManifest },
  }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const productId = productIdSchema.safeParse((await context.params).id);
  const fields = productEditSchema.safeParse(await request.json().catch(() => null));
  if (!productId.success || !fields.success) {
    return NextResponse.json({ message: fields.success ? "상품 ID 형식이 올바르지 않습니다." : fields.error.issues[0]?.message ?? "상품 수정값을 확인해 주세요." }, { status: 400 });
  }
  const { data, error } = await admin.userClient.rpc("sellerpilot_update_product_details", {
    p_product_id: productId.data,
    p_fields: fields.data,
  });
  if (error || data !== true) {
    const duplicateSku = error?.code === "23505";
    const reservedStock = error?.message?.includes("stock below reserved quantity");
    return NextResponse.json({
      message: duplicateSku ? "이미 사용 중인 판매자 SKU입니다." : reservedStock ? "재고는 예약 재고보다 적게 저장할 수 없습니다." : "상품 정보를 저장하지 못했습니다.",
    }, { status: duplicateSku || reservedStock ? 409 : 500 });
  }
  return NextResponse.json({
    ok: true,
    fields: fields.data,
    centralSaved: true,
    centralSaveScope: "product_details_without_inventory",
    inventoryWritePerformed: false,
    remoteWritePerformed: false,
    remoteUpdateStatus: "not_attempted",
    message: "재고를 제외한 상품 정보를 중앙 원장에 저장했습니다. 재고 적용과 외부 판매채널 수정은 자동 실행하지 않았으며, 채널별 원격 수정 지원 범위를 확인해 중앙만·일부 지원 필드는 외부 채널에 수동 반영해야 합니다.",
  }, { headers: { "cache-control": "no-store, max-age=0" } });
}
