import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { aiGeneratedAssetPath, aiGeneratedAssetSpecs } from "../../../../../lib/ai-generated-assets";
import { studioCompetitorContextSchema } from "../../../../../lib/ai-cli-contract";
import {
  crossProductSettingAssetIds,
  crossProductSettingComparisonsSchema,
} from "../../../../../lib/cross-product-setting-comparisons";
import {
  minimumResultUploadWorkerVersion,
  supportsLiveResultUploadAuthorization,
} from "../../../../../lib/ai-worker-version";
import { sourceImagePathsForWorker } from "../../../../../lib/studio-image-paths";
import { supabasePublishableKey, supabaseUrl } from "../../../../../lib/supabase/config";
import { terminalImageFailureContextSchema } from "../../../../../lib/terminal-image-failure-context";
import {
  createBoundedSupabaseFetch,
  workerRpcErrorMessage,
  workerRpcErrorStatus,
} from "../../../../../lib/worker-rpc";

export const runtime = "nodejs";

type ClaimCompensationMode = "requeue" | "fail";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeErrorMetadata(error: unknown) {
  if (!error || typeof error !== "object") return { code: "unknown", status: "unknown" };
  const candidate = error as { code?: unknown; status?: unknown; statusCode?: unknown; name?: unknown };
  return {
    code: typeof candidate.code === "string"
      ? candidate.code
      : typeof candidate.statusCode === "string"
        ? candidate.statusCode
        : typeof candidate.name === "string"
          ? candidate.name
          : "unknown",
    status: typeof candidate.status === "number" || typeof candidate.status === "string"
      ? String(candidate.status)
      : "unknown",
  };
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!workerToken.startsWith("spw_") || workerToken.length < 24) {
    return NextResponse.json({ message: "CLI 작업자 인증이 필요합니다." }, { status: 401 });
  }
  if (!supabaseUrl || !secretKey) {
    console.error("AI worker claim server configuration is unavailable", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseSecretKey: Boolean(secretKey),
    });
    return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createBoundedSupabaseFetch() },
  });
  const tokenHash = createHash("sha256").update(workerToken).digest("hex");
  const body = await request.json().catch(() => ({})) as { version?: unknown; scope?: unknown };
  const version = typeof body.version === "string" ? body.version.slice(0, 80) : "unknown";
  if (body.scope !== undefined && body.scope !== "product") {
    return NextResponse.json({ message: "지원하지 않는 AI 작업 범위입니다." }, { status: 400 });
  }
  const productOnlyClaim = body.scope === "product";
  if (!supportsLiveResultUploadAuthorization(version)) {
    return NextResponse.json({
      message: "AI 작업자를 최신 버전으로 재시작해 주세요.",
      minimumVersion: minimumResultUploadWorkerVersion,
    }, {
      status: 426,
      headers: { "cache-control": "no-store, max-age=0" },
    });
  }
  const claimArguments = {
    p_token_hash: tokenHash,
    p_worker_version: version,
  };
  const { data, error } = productOnlyClaim
    ? await serviceClient.rpc("sellerpilot_claim_product_ai_job", claimArguments)
    : await serviceClient.rpc("sellerpilot_claim_local_ai_job", claimArguments);
  if (error) {
    const status = workerRpcErrorStatus(error);
    console.error("AI worker claim RPC failed", { code: error.code ?? "unknown", status });
    return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return new NextResponse(null, { status: 204 });

  const job = data as Record<string, unknown>;
  const jobId = typeof job.id === "string" ? job.id : "";
  const claimToken = typeof job.claim_token === "string" ? job.claim_token : "";
  if (!UUID_PATTERN.test(jobId) || !UUID_PATTERN.test(claimToken)) {
    console.error("AI worker claim RPC returned an invalid claim identity", {
      hasJobId: Boolean(jobId),
      hasClaimToken: Boolean(claimToken),
    });
    return NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 });
  }
  const compensateClaim = async (mode: ClaimCompensationMode, safeReason: string) => {
    if (!jobId) {
      console.error("AI worker claim compensation cannot identify the claimed job", { mode });
      return false;
    }
    try {
      const { data: compensated, error: compensationError } = mode === "requeue"
        ? await serviceClient.rpc("sellerpilot_service_release_ai_job_claim", {
          p_token_hash: tokenHash,
          p_job_id: jobId,
          p_claim_token: claimToken,
          p_safe_reason: safeReason,
          p_retry_after_seconds: 60,
        })
        : await serviceClient.rpc("sellerpilot_complete_ai_job", {
          p_token_hash: tokenHash,
          p_job_id: jobId,
          p_claim_token: claimToken,
          p_status: "failed",
          p_result_payload: null,
          p_error_message: safeReason,
        });
      if (compensationError || compensated !== true) {
        console.error("AI worker claim compensation failed", {
          jobId,
          mode,
          ...safeErrorMetadata(compensationError),
        });
        return false;
      }
      return true;
    } catch (compensationError) {
      console.error("AI worker claim compensation threw", {
        jobId,
        mode,
        ...safeErrorMetadata(compensationError),
      });
      return false;
    }
  };
  const preparationFailure = async ({
    message,
    safeReason,
    mode = "requeue",
    error,
  }: {
    message: string;
    safeReason: string;
    mode?: ClaimCompensationMode;
    error?: unknown;
  }) => {
    console.error("AI worker claim preparation failed", {
      jobId: jobId || "unknown",
      mode,
      reason: safeReason,
      ...safeErrorMetadata(error),
    });
    const compensated = await compensateClaim(mode, safeReason);
    if (!compensated) {
      return NextResponse.json({
        message: "작업 준비와 상태 복구에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      }, { status: 503 });
    }
    return NextResponse.json({ message }, { status: mode === "requeue" ? 503 : 500 });
  };
  const stageResultUploads = async (resultPaths: string[]) => {
    const { data: staged, error: stagingError } = await serviceClient.rpc(
      "sellerpilot_service_stage_ai_result_uploads",
      {
        p_token_hash: tokenHash,
        p_job_id: jobId,
        p_claim_token: claimToken,
        p_paths: resultPaths,
      },
    );
    if (!stagingError && staged === true) return null;
    return preparationFailure({
      message: "생성 이미지 정리 경로를 안전하게 준비하지 못했습니다.",
      safeReason: "result_upload_staging_failed",
      error: stagingError,
    });
  };
  const jobRequest = job.request && typeof job.request === "object" && !Array.isArray(job.request)
    ? job.request as Record<string, unknown>
    : {};
  const rawTerminalImageFailureContext = job.terminal_image_failure_context;
  const parsedTerminalImageFailureContext = rawTerminalImageFailureContext == null
    ? null
    : terminalImageFailureContextSchema.safeParse(rawTerminalImageFailureContext);
  if (parsedTerminalImageFailureContext && !parsedTerminalImageFailureContext.success) {
    return preparationFailure({
      message: "이전 이미지 실패 맥락을 안전하게 확인하지 못했습니다.",
      safeReason: "invalid_terminal_image_failure_context",
      mode: "fail",
    });
  }
  const jobForWorker = { ...job };
  delete jobForWorker.terminal_image_failure_context;
  jobForWorker.terminalImageFailureContext = parsedTerminalImageFailureContext?.success
    ? parsedTerminalImageFailureContext.data
    : null;
  if (job.kind === "support_reply") {
    return NextResponse.json({ ...jobForWorker, request: jobRequest }, {
      headers: { "cache-control": "no-store, max-age=0" },
    });
  }
  if (job.kind === "product_research" || jobRequest.research_only === true) {
    return NextResponse.json({
      ...jobForWorker,
      request: {
        researchInput: typeof jobRequest.research_input === "string" ? jobRequest.research_input : "",
        researchOnly: true,
      },
    }, { headers: { "cache-control": "no-store, max-age=0" } });
  }
  const rawCompetitorContext = jobRequest.competitor_context;
  const parsedCompetitorContext = rawCompetitorContext == null
    ? null
    : studioCompetitorContextSchema.safeParse(rawCompetitorContext);
  if (parsedCompetitorContext && !parsedCompetitorContext.success) {
    return preparationFailure({
      message: "동일 상품 경쟁가 근거 형식을 확인하지 못했습니다.",
      safeReason: "invalid_competitor_context",
      mode: "fail",
    });
  }
  const paths = Array.isArray(jobRequest.image_paths)
    ? jobRequest.image_paths.filter((path): path is string => typeof path === "string")
    : [];
  const imageSpecs = Array.isArray(jobRequest.image_specs)
    ? jobRequest.image_specs.filter((spec): spec is Record<string, unknown> => Boolean(spec) && typeof spec === "object" && !Array.isArray(spec))
    : [];
  let sourcePaths: string[];
  try {
    sourcePaths = sourceImagePathsForWorker(paths, imageSpecs);
  } catch (sourcePathError) {
    return preparationFailure({
      message: "원본 상품 이미지 경로가 파생 이미지와 일치하지 않습니다.",
      safeReason: "invalid_source_image_provenance",
      mode: "fail",
      error: sourcePathError,
    });
  }
  const regenerationAssetId = typeof jobRequest.asset_id === "string" ? jobRequest.asset_id : "";
  const regenerationAsset = job.kind === "product_asset_regeneration"
    ? aiGeneratedAssetSpecs.find((candidate) => candidate.id === regenerationAssetId)
    : undefined;
  if (job.kind === "product_asset_regeneration" && !regenerationAsset) {
    return preparationFailure({
      message: "재제작할 이미지 종류를 확인하지 못했습니다.",
      safeReason: "invalid_asset_regeneration_payload",
      mode: "fail",
    });
  }
  try {
    const { data: signedFiles, error: signedError } = await serviceClient.storage
      .from("sellerpilot-ai")
      .createSignedUrls(sourcePaths, 10 * 60);
    if (signedError) {
      return preparationFailure({
        message: "작업 이미지 URL을 만들지 못했습니다.",
        safeReason: "source_image_signing_failed",
        error: signedError,
      });
    }
    const signedSourceImages = (signedFiles ?? []).flatMap((file, index) => (
      typeof file.signedUrl === "string" && !file.error
        ? [{ path: sourcePaths[index], signedUrl: file.signedUrl }]
        : []
    ));
    if (signedSourceImages.length !== sourcePaths.length) {
      return preparationFailure({
        message: "일부 작업 이미지 URL을 만들지 못했습니다.",
        safeReason: "source_image_signing_incomplete",
      });
    }
    const prepareCrossProductComparisons = async () => {
      const { data: rawComparisons, error: lookupError } = await serviceClient.rpc(
        "sellerpilot_service_get_cross_product_setting_comparisons",
        {
          p_token_hash: tokenHash,
          p_job_id: jobId,
          p_claim_token: claimToken,
          p_limit_products: 8,
        },
      );
      if (lookupError) {
        return {
          comparisons: null,
          failure: await preparationFailure({
            message: "기존 상품 설정샷 비교 자료를 준비하지 못했습니다.",
            safeReason: "cross_product_comparison_lookup_failed",
            error: lookupError,
          }),
        } as const;
      }
      const parsedComparisons = crossProductSettingComparisonsSchema.safeParse(rawComparisons);
      if (!parsedComparisons.success) {
        return {
          comparisons: null,
          failure: await preparationFailure({
            message: "기존 상품 설정샷 비교 계약을 확인하지 못했습니다.",
            safeReason: "invalid_cross_product_comparison_contract",
          }),
        } as const;
      }
      const comparisonEntries = parsedComparisons.data.products.flatMap((product) => (
        crossProductSettingAssetIds.map((assetId) => ({
          sourceJobId: product.sourceJobId,
          sceneIdentity: product.sceneIdentity,
          assetId,
          path: product.assets[assetId],
        }))
      ));
      const { data: signedFiles, error: signingError } = comparisonEntries.length
        ? await serviceClient.storage.from("sellerpilot-ai").createSignedUrls(
          comparisonEntries.map((entry) => entry.path),
          10 * 60,
        )
        : { data: [], error: null };
      if (signingError) {
        return {
          comparisons: null,
          failure: await preparationFailure({
            message: "기존 상품 설정샷 비교 URL을 만들지 못했습니다.",
            safeReason: "cross_product_comparison_signing_failed",
            error: signingError,
          }),
        } as const;
      }
      const signedEntries = comparisonEntries.flatMap((entry, index) => {
        const signedFile = signedFiles?.[index];
        return signedFile
          && signedFile.path === entry.path
          && typeof signedFile.signedUrl === "string"
          && !signedFile.error
          ? [{ ...entry, signedUrl: signedFile.signedUrl }]
          : [];
      });
      if (signedEntries.length !== comparisonEntries.length) {
        return {
          comparisons: null,
          failure: await preparationFailure({
            message: "일부 기존 상품 설정샷 비교 URL을 만들지 못했습니다.",
            safeReason: "cross_product_comparison_signing_incomplete",
          }),
        } as const;
      }
      return {
        comparisons: parsedComparisons.data.products.map((product) => ({
          sourceJobId: product.sourceJobId,
          sceneIdentity: product.sceneIdentity,
          images: signedEntries
            .filter((entry) => entry.sourceJobId === product.sourceJobId)
            .map((entry) => ({ assetId: entry.assetId, signedUrl: entry.signedUrl })),
        })),
        failure: null,
      } as const;
    };
    if (job.kind === "product_asset_regeneration") {
      const assetId = regenerationAssetId;
      const asset = regenerationAsset!;
      const crossProductPreparation = crossProductSettingAssetIds.includes(
        assetId as (typeof crossProductSettingAssetIds)[number],
      )
        ? await prepareCrossProductComparisons()
        : { comparisons: [], failure: null } as const;
      if (crossProductPreparation.failure) return crossProductPreparation.failure;
      const comparisonMap = jobRequest.comparison_asset_paths && typeof jobRequest.comparison_asset_paths === "object" && !Array.isArray(jobRequest.comparison_asset_paths)
        ? jobRequest.comparison_asset_paths as Record<string, unknown>
        : {};
      const comparisonEntries = aiGeneratedAssetSpecs.flatMap((candidate) => {
        const path = comparisonMap[candidate.id];
        if (typeof path !== "string") return [];
        return [[candidate.id === assetId ? `previous:${candidate.id}` : candidate.id, path] as [string, string]];
      });
      const { data: signedComparisons, error: comparisonError } = comparisonEntries.length
        ? await serviceClient.storage.from("sellerpilot-ai").createSignedUrls(comparisonEntries.map(([, path]) => path), 10 * 60)
        : { data: [], error: null };
      if (comparisonError) {
        return preparationFailure({
          message: "기존 이미지 중복 비교 URL을 만들지 못했습니다.",
          safeReason: "comparison_image_signing_failed",
          error: comparisonError,
        });
      }
      const signedComparisonImages = comparisonEntries.flatMap(([comparisonAssetId, expectedPath], index) => {
        const signedComparison = signedComparisons?.[index];
        return signedComparison
          && signedComparison.path === expectedPath
          && typeof signedComparison.signedUrl === "string"
          && !signedComparison.error
          ? [{ assetId: comparisonAssetId, signedUrl: signedComparison.signedUrl }]
          : [];
      });
      if (signedComparisonImages.length !== comparisonEntries.length) {
        return preparationFailure({
          message: "일부 기존 이미지 중복 비교 URL을 만들지 못했습니다.",
          safeReason: "comparison_image_signing_incomplete",
        });
      }
      const assetPath = aiGeneratedAssetPath(jobId, asset, claimToken);
      const stagingFailure = await stageResultUploads([assetPath]);
      if (stagingFailure) return stagingFailure;
      return NextResponse.json({
        ...jobForWorker,
        request: {
          sourceJobId: typeof jobRequest.source_job_id === "string" ? jobRequest.source_job_id : "",
          sourceProductId: typeof jobRequest.source_product_id === "string" ? jobRequest.source_product_id : null,
          assetId,
          manualFields: jobRequest.manual_fields && typeof jobRequest.manual_fields === "object" && !Array.isArray(jobRequest.manual_fields)
            ? jobRequest.manual_fields
            : {},
          sourceResult: jobRequest.source_result && typeof jobRequest.source_result === "object" && !Array.isArray(jobRequest.source_result)
            ? jobRequest.source_result
            : null,
          imageSpecs,
          images: signedSourceImages,
          comparisonImages: signedComparisonImages,
          crossProductComparisons: crossProductPreparation.comparisons,
        },
        resultUploads: [{
          id: asset.id,
          path: assetPath,
          supabaseUrl,
          publishableKey: supabasePublishableKey,
          bucket: "sellerpilot-ai",
        }],
      }, { headers: { "cache-control": "no-store, max-age=0" } });
    }
    const crossProductPreparation = await prepareCrossProductComparisons();
    if (crossProductPreparation.failure) return crossProductPreparation.failure;
    const assetPaths = aiGeneratedAssetSpecs.map((asset) => ({
      id: asset.id,
      path: aiGeneratedAssetPath(jobId, asset, claimToken),
    }));
    const stagingFailure = await stageResultUploads(assetPaths.map((asset) => asset.path));
    if (stagingFailure) return stagingFailure;

    return NextResponse.json({
      ...jobForWorker,
      request: {
        description: typeof jobRequest.description === "string" ? jobRequest.description : "",
        productUrl: typeof jobRequest.product_url === "string" ? jobRequest.product_url : "",
        researchInput: typeof jobRequest.research_input === "string" ? jobRequest.research_input : "",
        manualFields: jobRequest.manual_fields && typeof jobRequest.manual_fields === "object" && !Array.isArray(jobRequest.manual_fields)
          ? jobRequest.manual_fields
          : {},
        imageSpecs,
        images: signedSourceImages,
        crossProductComparisons: crossProductPreparation.comparisons,
        ...(parsedCompetitorContext?.success ? { competitorContext: parsedCompetitorContext.data } : {}),
      },
      resultUploads: assetPaths.map((upload) => ({
        ...upload,
        supabaseUrl,
        publishableKey: supabasePublishableKey,
        bucket: "sellerpilot-ai",
      })),
    }, { headers: { "cache-control": "no-store, max-age=0" } });
  } catch (preparationError) {
    return preparationFailure({
      message: "작업 준비 중 일시적인 오류가 발생했습니다.",
      safeReason: "claim_preparation_exception",
      error: preparationError,
    });
  }
}
