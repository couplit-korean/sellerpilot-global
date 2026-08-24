import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { aiGeneratedAssetPath, aiGeneratedAssetSpecs } from "../../../../../lib/ai-generated-assets";
import { supabasePublishableKey, supabaseUrl } from "../../../../../lib/supabase/config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!workerToken.startsWith("spw_") || !supabaseUrl || !secretKey) {
    return NextResponse.json({ message: "CLI 작업자 인증이 필요합니다." }, { status: 401 });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const tokenHash = createHash("sha256").update(workerToken).digest("hex");
  const body = await request.json().catch(() => ({})) as { version?: unknown };
  const version = typeof body.version === "string" ? body.version.slice(0, 80) : "unknown";
  const { data, error } = await serviceClient.rpc("sellerpilot_claim_ai_job", {
    p_token_hash: tokenHash,
    p_worker_version: version,
  });
  if (error) return NextResponse.json({ message: "CLI 작업자 토큰이 유효하지 않습니다." }, { status: 401 });
  if (!data || typeof data !== "object" || Array.isArray(data)) return new NextResponse(null, { status: 204 });

  const job = data as Record<string, unknown>;
  const jobRequest = job.request && typeof job.request === "object" && !Array.isArray(job.request)
    ? job.request as Record<string, unknown>
    : {};
  if (job.kind === "support_reply") {
    return NextResponse.json({ ...job, request: jobRequest }, {
      headers: { "cache-control": "no-store, max-age=0" },
    });
  }
  if (job.kind === "product_research" || jobRequest.research_only === true) {
    return NextResponse.json({
      ...job,
      request: {
        researchInput: typeof jobRequest.research_input === "string" ? jobRequest.research_input : "",
        researchOnly: true,
      },
    }, { headers: { "cache-control": "no-store, max-age=0" } });
  }
  const paths = Array.isArray(jobRequest.image_paths)
    ? jobRequest.image_paths.filter((path): path is string => typeof path === "string")
    : [];
  const imageSpecs = Array.isArray(jobRequest.image_specs)
    ? jobRequest.image_specs.filter((spec): spec is Record<string, unknown> => Boolean(spec) && typeof spec === "object" && !Array.isArray(spec))
    : [];
  const { data: signedFiles, error: signedError } = await serviceClient.storage
    .from("sellerpilot-ai")
    .createSignedUrls(paths, 10 * 60);
  if (signedError) return NextResponse.json({ message: "작업 이미지 URL을 만들지 못했습니다." }, { status: 500 });
  if (job.kind === "product_asset_regeneration") {
    const assetId = typeof jobRequest.asset_id === "string" ? jobRequest.asset_id : "";
    const asset = aiGeneratedAssetSpecs.find((candidate) => candidate.id === assetId);
    if (!asset) return NextResponse.json({ message: "재제작할 이미지 종류를 확인하지 못했습니다." }, { status: 500 });
    const assetPath = aiGeneratedAssetPath(String(job.id), asset);
    const { data: upload, error: uploadError } = await serviceClient.storage
      .from("sellerpilot-ai")
      .createSignedUploadUrl(assetPath, { upsert: true });
    if (uploadError || !upload?.token) {
      return NextResponse.json({ message: "재제작 이미지 업로드 URL을 만들지 못했습니다." }, { status: 500 });
    }
    return NextResponse.json({
      ...job,
      request: {
        sourceJobId: typeof jobRequest.source_job_id === "string" ? jobRequest.source_job_id : "",
        sourceProductId: typeof jobRequest.source_product_id === "string" ? jobRequest.source_product_id : null,
        assetId,
        sourceResult: jobRequest.source_result && typeof jobRequest.source_result === "object" && !Array.isArray(jobRequest.source_result)
          ? jobRequest.source_result
          : null,
        imageSpecs,
        images: (signedFiles ?? []).map((file, index) => ({ path: paths[index], signedUrl: file.signedUrl })),
      },
      resultUploads: [{
        id: asset.id,
        path: assetPath,
        token: upload.token,
        supabaseUrl,
        publishableKey: supabasePublishableKey,
        bucket: "sellerpilot-ai",
      }],
    }, { headers: { "cache-control": "no-store, max-age=0" } });
  }
  const assetPaths = aiGeneratedAssetSpecs.map((asset) => ({
    id: asset.id,
    path: aiGeneratedAssetPath(String(job.id), asset),
  }));
  const assetUploads = await Promise.all(assetPaths.map(async (asset) => {
    const { data: upload, error: uploadError } = await serviceClient.storage
      .from("sellerpilot-ai")
      .createSignedUploadUrl(asset.path, { upsert: true });
    return uploadError || !upload?.token ? null : { ...asset, token: upload.token };
  }));
  if (assetUploads.some((upload) => !upload)) {
    return NextResponse.json({ message: "생성 이미지 업로드 URL을 만들지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({
    ...job,
    request: {
      description: typeof jobRequest.description === "string" ? jobRequest.description : "",
      productUrl: typeof jobRequest.product_url === "string" ? jobRequest.product_url : "",
      researchInput: typeof jobRequest.research_input === "string" ? jobRequest.research_input : "",
      manualFields: jobRequest.manual_fields && typeof jobRequest.manual_fields === "object" && !Array.isArray(jobRequest.manual_fields)
        ? jobRequest.manual_fields
        : {},
      imageSpecs,
      images: (signedFiles ?? []).map((file, index) => ({
        path: paths[index],
        signedUrl: file.signedUrl,
      })),
    },
    resultUploads: assetUploads.map((upload) => ({
      ...upload,
      supabaseUrl,
      publishableKey: supabasePublishableKey,
      bucket: "sellerpilot-ai",
    })),
  }, { headers: { "cache-control": "no-store, max-age=0" } });
}
