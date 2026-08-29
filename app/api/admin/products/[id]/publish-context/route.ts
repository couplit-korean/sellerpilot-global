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

  const [{ data, error }, { data: commerceOperations, error: operationsError }] = await Promise.all([
    admin.userClient.rpc("sellerpilot_get_product_publish_context", { p_product_id: productId.data }),
    admin.userClient.rpc("sellerpilot_get_product_operations_v2", { p_product_id: productId.data }),
  ]);
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ message: "상품 등록 준비 정보를 불러오지 못했습니다." }, { status: 404 });
  }

  const payload = data as Record<string, unknown>;
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
    studioResult,
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
  const assetsResolvable = await Promise.all(
    resolvedAssets.value.map((asset) => detailBucket.exists(asset.path)),
  ).then(
    (results) => results.every((result) => !result.error && result.data === true),
    () => false,
  );
  if (!assetsResolvable) {
    return NextResponse.json({
      code: "DETAIL_PAGE_ASSETS_UNRESOLVED",
      message: "상세 이미지 8장 중 운영 저장소에서 불러올 수 없는 파일이 있습니다.",
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
  return NextResponse.json({ detailPage: data }, {
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
