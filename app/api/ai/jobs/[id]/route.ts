import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../../lib/admin-api";
import { serverProductResearchResultSchema } from "../../../../../lib/ai-cli-contract";
import { coreFirstDraftAssetIds } from "../../../../../lib/ai-generated-assets";
import { sellerSafeAiJobFailure } from "../../../../../lib/ai-worker-error-safety";
import { productResearchFailureMessage } from "../../../../../lib/product-research-failure";
import {
  validateSucceededProductResearchPreflight,
  validateVisibleSucceededProductResearchJob,
} from "../../../../../lib/product-studio-lineage";
import { validateFinalStudioAssetStoragePaths } from "../../../../../lib/studio-result-assets";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const { id } = await context.params;
  const { data, error } = await admin.userClient.rpc("sellerpilot_get_ai_job", { p_id: id });
  if (error) return NextResponse.json({ message: "AI 작업 상태를 읽지 못했습니다." }, { status: 500 });
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ message: "요청한 AI 작업을 찾지 못했습니다." }, { status: 404 });
  }

  const job = data as Record<string, unknown>;
  let result = job.result && typeof job.result === "object" && !Array.isArray(job.result)
    ? { ...(job.result as Record<string, unknown>) }
    : null;

  const hasProductResearchPreflight = job.kind === "product_research"
    && result != null
    && (result.preflightVersion !== undefined
      || result.researchInputSha256 !== undefined
      || result.sourcePhotoSha256 !== undefined
      || result.asset_storage_paths !== undefined
      || result.preflightAssetLineage !== undefined);

  if (hasProductResearchPreflight) {
    // Never sign arbitrary storage paths from a malformed worker result. The
    // six first-draft paths, roles, hashes and shared claim scope are validated
    // as one contract before any URL leaves the server.
    const parsedResult = serverProductResearchResultSchema.safeParse(result);
    const visible = validateVisibleSucceededProductResearchJob({
      expectedJobId: id,
      data: job,
      error: null,
    });
    const preflight = parsedResult.success
      && parsedResult.data.preflightVersion === 1
      && parsedResult.data.researchInputSha256
      && parsedResult.data.sourcePhotoSha256
      ? validateSucceededProductResearchPreflight({
        expectedJobId: id,
        expectedResearchInputSha256: parsedResult.data.researchInputSha256,
        expectedSourcePhotoSha256: parsedResult.data.sourcePhotoSha256,
        data: job,
      })
      : { valid: false as const, reason: "preflight_invalid" as const };
    if (!parsedResult.success || !visible.valid || !preflight.valid) {
      return NextResponse.json({
        ...job,
        status: "failed",
        result: null,
        error: productResearchFailureMessage("gateway_result_invalid"),
      }, { headers: { "cache-control": "no-store, max-age=0" } });
    }
    const entries = coreFirstDraftAssetIds.map((assetId) => [
      assetId,
      preflight.preflight.assetStoragePaths[assetId],
    ] as const);
    const { data: signed, error: signingError } = await admin.serviceClient.storage
      .from("sellerpilot-ai")
      .createSignedUrls(entries.map(([, path]) => path), 60 * 60);
    if (signingError
        || !signed
        || signed.length !== entries.length
        || signed.some((item) => typeof item.signedUrl !== "string" || item.signedUrl.length === 0)) {
      return NextResponse.json({ message: "1차 생성 이미지 연결을 잠시 확인하지 못했습니다. 같은 작업을 다시 확인해 주세요." }, {
        status: 503,
        headers: { "cache-control": "no-store, max-age=0" },
      });
    }
    result = {
      ...parsedResult.data,
      generatedImages: entries.map(([assetId], index) => ({
        id: assetId,
        url: signed[index]!.signedUrl,
      })),
    };
    delete result.asset_storage_paths;
  } else if (job.kind === "product_studio" && result?.mode === "cli") {
    const entries = validateFinalStudioAssetStoragePaths(id, result.asset_storage_paths);
    if (!entries) {
      return NextResponse.json({
        ...job,
        status: "failed",
        result: null,
        error: sellerSafeAiJobFailure("generated_asset_set_incomplete"),
      }, { headers: { "cache-control": "no-store, max-age=0" } });
    }
    const { data: signed, error: signingError } = await admin.serviceClient.storage
      .from("sellerpilot-ai")
      .createSignedUrls(entries.map(([, path]) => path), 60 * 60);
    if (signingError
        || !signed
        || signed.length !== entries.length
        || signed.some((item) => typeof item.signedUrl !== "string" || item.signedUrl.length === 0)) {
      return NextResponse.json({ message: "상세페이지 이미지 연결을 잠시 확인하지 못했습니다. 같은 작업을 다시 확인해 주세요." }, {
        status: 503,
        headers: { "cache-control": "no-store, max-age=0" },
      });
    }
    result.heroUrl = signed[entries.findIndex(([assetId]) => assetId === "hero")]!.signedUrl;
    result.generatedImages = entries.map(([assetId], index) => ({ id: assetId, url: signed[index]!.signedUrl }));
    delete result.asset_storage_paths;
  } else if (result && result.asset_storage_paths && typeof result.asset_storage_paths === "object" && !Array.isArray(result.asset_storage_paths)) {
    const entries = Object.entries(result.asset_storage_paths as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string");
    const { data: signed } = await admin.serviceClient.storage
      .from("sellerpilot-ai")
      .createSignedUrls(entries.map(([, path]) => path), 60 * 60);
    result.heroUrl = signed?.[entries.findIndex(([id]) => id === "hero")]?.signedUrl ?? null;
    result.generatedImages = entries.map(([id], index) => ({ id, url: signed?.[index]?.signedUrl ?? null }));
    delete result.asset_storage_paths;
  } else if (result && typeof result.hero_storage_path === "string") {
    const { data: signed } = await admin.serviceClient.storage
      .from("sellerpilot-ai")
      .createSignedUrl(result.hero_storage_path, 60 * 60);
    result.heroUrl = signed?.signedUrl ?? null;
    delete result.hero_storage_path;
  }

  if (job.kind === "product_research" && typeof job.error === "string") {
    job.error = productResearchFailureMessage(job.error);
  } else if (typeof job.error === "string") {
    job.error = sellerSafeAiJobFailure(job.error);
  }

  return NextResponse.json({ ...job, result }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
