import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { productResearchJobRequestSchema, serverProductResearchResultSchema } from "../../../../../lib/ai-cli-contract";
import {
  buildFirstDraftImageEnqueuePayload,
  buildFirstDraftImageLineageUpdate,
  firstDraftImageAssetIds,
  firstDraftImageAssetSpec,
  firstDraftImageWorkerPostSchema,
  type FirstDraftImageAssetId,
} from "../../../../../lib/first-draft-images";
import { productResearchInputSha256 } from "../../../../../lib/product-research-lineage-receipt-core";
import { supabaseUrl } from "../../../../../lib/supabase/config";
import {
  createBoundedSupabaseFetch,
  workerRpcErrorMessage,
  workerRpcErrorStatus,
} from "../../../../../lib/worker-rpc";

export const runtime = "nodejs";
export const maxDuration = 300;

const storageBucket = "sellerpilot-ai";
const noStore = { "cache-control": "no-store, max-age=0" } as const;
const sourceUrlSeconds = 60 * 30;
const maximumSubmittedAssetBytes = 16 * 1024 * 1024;
const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;

type SharpFactory = (typeof import("sharp"))["default"];

type WorkerAuthentication = {
  tokenHash: string;
  serviceClient: SupabaseClient;
};

function authenticateWorker(request: Request): { ok: true; auth: WorkerAuthentication } | { ok: false; response: NextResponse } {
  const authorization = request.headers.get("authorization") ?? "";
  const workerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!workerToken.startsWith("spw_") || workerToken.length < 24) {
    return { ok: false, response: NextResponse.json({ message: "CLI 작업자 인증이 필요합니다." }, { status: 401 }) };
  }
  if (!supabaseUrl || !secretKey) {
    console.error("first draft image worker server configuration is unavailable", {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseSecretKey: Boolean(secretKey),
    });
    return { ok: false, response: NextResponse.json({ message: workerRpcErrorMessage(503) }, { status: 503 }) };
  }
  return {
    ok: true,
    auth: {
      tokenHash: createHash("sha256").update(workerToken).digest("hex"),
      serviceClient: createClient(supabaseUrl, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: createBoundedSupabaseFetch() },
      }),
    },
  };
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function releaseRequest(
  serviceClient: WorkerAuthentication["serviceClient"],
  tokenHash: string,
  jobId: string,
  reason: string,
) {
  try {
    await serviceClient.rpc("sellerpilot_service_release_first_draft_image_request", {
      p_token_hash: tokenHash,
      p_job_id: jobId,
      p_safe_reason: reason.slice(0, 300),
    });
  }
  catch {
    console.error("first draft image request release failed", { jobId });
  }
}

export async function GET(request: Request) {
  const authentication = authenticateWorker(request);
  if (!authentication.ok) return authentication.response;
  const { tokenHash, serviceClient } = authentication.auth;

  const { data, error } = await serviceClient.rpc("sellerpilot_service_claim_first_draft_image_request", {
    p_token_hash: tokenHash,
  });
  if (error) {
    const status = workerRpcErrorStatus(error);
    console.error("first draft image claim RPC failed", { code: error.code ?? "unknown", status });
    return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
  }
  const claimed = recordValue(data);
  const jobId = typeof claimed?.jobId === "string" ? claimed.jobId : "";
  if (!claimed || !jobId) return new NextResponse(null, { status: 204, headers: noStore });

  const storedRequest = productResearchJobRequestSchema.safeParse({
    jobId,
    researchInput: recordValue(claimed.request)?.research_input,
    sourcePhotoFingerprint: recordValue(claimed.request)?.source_photo_sha256,
    imagePaths: recordValue(claimed.request)?.image_paths,
    imageSpecs: recordValue(claimed.request)?.image_specs,
  });
  const ownerId = typeof claimed.ownerId === "string" ? claimed.ownerId : "";
  if (!storedRequest.success || !ownerId) {
    console.error("first draft image claim payload is not adoptable", { jobId });
    await releaseRequest(serviceClient, tokenHash, jobId, "claim-payload-invalid");
    return new NextResponse(null, { status: 204, headers: noStore });
  }

  const resolved = buildFirstDraftImageEnqueuePayload({
    jobId,
    ownerId,
    data: {
      id: jobId,
      kind: "product_research",
      status: "succeeded",
      request: {
        researchInput: storedRequest.data.researchInput,
        sourcePhotoFingerprint: storedRequest.data.sourcePhotoFingerprint,
        imagePaths: storedRequest.data.imagePaths,
        imageSpecs: storedRequest.data.imageSpecs,
      },
      result: claimed.result,
    },
    error: null,
  });
  if (!resolved.ok) {
    console.error("first draft image claim lineage is not adoptable", { jobId, reason: resolved.reason });
    await releaseRequest(serviceClient, tokenHash, jobId, `lineage-${resolved.reason}`);
    return new NextResponse(null, { status: 204, headers: noStore });
  }

  const { data: signed, error: signingError } = await serviceClient.storage
    .from(storageBucket)
    .createSignedUrls([resolved.payload.sourcePath], sourceUrlSeconds);
  const signedSource = signed?.[0];
  if (signingError
      || !signedSource
      || signedSource.error
      || typeof signedSource.signedUrl !== "string"
      || !signedSource.signedUrl) {
    console.error("first draft image source signing failed", { jobId });
    await releaseRequest(serviceClient, tokenHash, jobId, "source-original-unavailable");
    return new NextResponse(null, { status: 204, headers: noStore });
  }

  const verifiedAssets = recordValue(claimed.verifiedAssets) ?? {};
  const completedAssets = firstDraftImageAssetIds.filter((assetId) => recordValue(verifiedAssets[assetId]));
  return NextResponse.json({
    ...resolved.payload,
    sourceUrl: signedSource.signedUrl,
    completedAssets: [...completedAssets],
  }, { headers: noStore });
}

function decodeSubmittedPng(entry: { id: FirstDraftImageAssetId; pngBase64: string }, sharp: SharpFactory) {
  const spec = firstDraftImageAssetSpec(entry.id);
  if (!spec) return null;
  const encoded = entry.pngBase64.trim();
  if (!encoded || encoded.length > maximumSubmittedAssetBytes * 2 || !base64Pattern.test(encoded)) return null;
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.byteLength < 1
      || bytes.byteLength > maximumSubmittedAssetBytes
      || bytes.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
    return null;
  }
  if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  return { spec, bytes, inspect: () => sharp(bytes, { failOn: "error" }).metadata() };
}

export async function POST(request: Request) {
  const authentication = authenticateWorker(request);
  if (!authentication.ok) return authentication.response;
  const { tokenHash, serviceClient } = authentication.auth;

  const parsed = firstDraftImageWorkerPostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "1차 생성 이미지 제출 형식이 올바르지 않습니다." }, { status: 400, headers: noStore });
  }

  if ("failed" in parsed.data) {
    const { data, error } = await serviceClient.rpc("sellerpilot_service_release_first_draft_image_request", {
      p_token_hash: tokenHash,
      p_job_id: parsed.data.jobId,
      p_safe_reason: parsed.data.reason,
    });
    if (error) {
      const status = workerRpcErrorStatus(error);
      return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
    }
    if (data !== true) {
      return NextResponse.json({ message: "1차 이미지 생성 요청 상태를 되돌리지 못했습니다." }, { status: 409, headers: noStore });
    }
    return NextResponse.json({ ok: true, status: "released" }, { headers: noStore });
  }

  const { jobId, assets } = parsed.data;
  const state = await serviceClient.rpc("sellerpilot_service_get_first_draft_image_request", {
    p_token_hash: tokenHash,
    p_job_id: jobId,
  });
  if (state.error) {
    const status = workerRpcErrorStatus(state.error);
    return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
  }
  const stateRecord = recordValue(state.data);
  const storedResult = serverProductResearchResultSchema.safeParse(stateRecord?.result);
  const storedRequest = productResearchJobRequestSchema.safeParse({
    jobId,
    researchInput: recordValue(stateRecord?.request)?.research_input,
    sourcePhotoFingerprint: recordValue(stateRecord?.request)?.source_photo_sha256,
    imagePaths: recordValue(stateRecord?.request)?.image_paths,
    imageSpecs: recordValue(stateRecord?.request)?.image_specs,
  });
  if (!stateRecord || !storedRequest.success || !storedResult.success) {
    return NextResponse.json({
      message: "실행 중인 1차 이미지 요청과 제출 내용이 일치하지 않습니다.",
    }, { status: 409, headers: noStore });
  }
  const canonicalPaths = storedResult.data.asset_storage_paths;
  if (!canonicalPaths) {
    return NextResponse.json({ message: "1차 이미지 저장 경로를 확인하지 못했습니다." }, { status: 409, headers: noStore });
  }

  const sharp = (await import("sharp")).default;
  const recorded: Array<Record<string, unknown>> = [];
  const digests: Partial<Record<FirstDraftImageAssetId, string>> = {};
  const previousVerified = recordValue(stateRecord.verifiedAssets) ?? {};
  for (const assetId of firstDraftImageAssetIds) {
    const previous = recordValue(previousVerified[assetId]);
    if (previous && typeof previous.digest === "string") digests[assetId] = previous.digest;
  }

  for (const entry of assets) {
    const decoded = decodeSubmittedPng(entry, sharp);
    if (!decoded) {
      return NextResponse.json({ message: "1차 생성 이미지 바이트를 확인하지 못했습니다." }, { status: 400, headers: noStore });
    }
    const metadata = await decoded.inspect().catch(() => null);
    if (!metadata
        || metadata.format !== "png"
        || metadata.width !== decoded.spec.width
        || metadata.height !== decoded.spec.height) {
      return NextResponse.json({
        message: `1차 생성 이미지 규격이 ${decoded.spec.width}x${decoded.spec.height} PNG가 아닙니다.`,
      }, { status: 400, headers: noStore });
    }
    const path = canonicalPaths[entry.id];
    const upload = await serviceClient.storage.from(storageBucket).upload(path, decoded.bytes, {
      contentType: "image/png",
      upsert: true,
    });
    if (upload.error) {
      console.error("first draft image upload failed", { jobId, assetId: entry.id, code: upload.error.name });
      return NextResponse.json({ message: "1차 생성 이미지를 저장하지 못했습니다." }, { status: 503, headers: noStore });
    }
    const digest = createHash("sha256").update(decoded.bytes).digest("hex");
    digests[entry.id] = digest;
    recorded.push({
      id: entry.id,
      path,
      digest,
      bytes: decoded.bytes.byteLength,
      width: decoded.spec.width,
      height: decoded.spec.height,
    });
  }

  // Adoption is fail-closed: before any research result can change, the fully
  // assembled lineage must already satisfy the stored contracts.
  const complete = firstDraftImageAssetIds.every((assetId) => typeof digests[assetId] === "string");
  if (complete) {
    const preview = buildFirstDraftImageLineageUpdate({
      jobId,
      result: storedResult.data,
      digests,
      expectedResearchInputSha256: productResearchInputSha256(storedRequest.data.researchInput),
      expectedSourcePhotoSha256: storedRequest.data.sourcePhotoFingerprint,
    });
    if (!preview.ok) {
      return NextResponse.json({
        message: "1차 생성 이미지 계보를 확정하지 못했습니다.",
        code: preview.reason,
      }, { status: 409, headers: noStore });
    }
  }

  const recordedResult = await serviceClient.rpc("sellerpilot_service_record_first_draft_image_assets", {
    p_token_hash: tokenHash,
    p_job_id: jobId,
    p_assets: recorded,
  });
  if (recordedResult.error) {
    const status = workerRpcErrorStatus(recordedResult.error);
    console.error("first draft image record RPC failed", { jobId, code: recordedResult.error.code ?? "unknown", status });
    return NextResponse.json({ message: workerRpcErrorMessage(status) }, { status });
  }
  const outcome = recordValue(recordedResult.data);
  const outcomeStatus = typeof outcome?.status === "string" ? outcome.status : "";
  if (outcomeStatus === "recorded") {
    return NextResponse.json({
      ok: true,
      jobId,
      status: "recorded",
      pending: Array.isArray(outcome?.pending) ? outcome.pending : [],
    }, { headers: noStore });
  }
  if (outcomeStatus !== "done") {
    return NextResponse.json({
      message: "1차 생성 이미지 업로드 상태를 저장하지 못했습니다.",
      code: outcomeStatus || "record_failed",
    }, { status: 409, headers: noStore });
  }

  // The stored research result must stay readable through
  // /api/ai/product-research/recover: same schema, same source photo, same six
  // canonical claim paths, now with generated digests.
  const adopted = recordValue(outcome?.result);
  const adoptedParsed = serverProductResearchResultSchema.safeParse(adopted);
  if (!adoptedParsed.success
      || !adoptedParsed.data.preflightAssetLineage
      || firstDraftImageAssetIds.some(
        (assetId) => adoptedParsed.data.preflightAssetLineage![assetId].auditMode !== "segmented-source-composite"
          || adoptedParsed.data.preflightAssetLineage![assetId].digest !== digests[assetId],
      )) {
    console.error("first draft image adoption readback is invalid", { jobId });
    return NextResponse.json({ message: "1차 생성 이미지 계보를 다시 확인하지 못했습니다." }, { status: 500, headers: noStore });
  }

  return NextResponse.json({ ok: true, jobId, status: "done" }, { headers: noStore });
}
