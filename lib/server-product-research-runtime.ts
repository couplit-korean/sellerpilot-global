import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  analyzeServerProductResearch,
  runOneServerProductResearch,
  runServerProductResearchWakeBurst,
  type ServerProductResearchDependencies,
} from "./server-product-research";
import { supabaseUrl } from "./supabase/config";
import { createBoundedSupabaseFetch } from "./worker-rpc";
import {
  internalScheduleAuthorization,
  internalScheduleCanaryPayload,
  internalScheduleRequestMode,
  runtimeStatusMatchesCurrentRelease,
} from "./internal-scheduler-auth";
import { runOneServerProductStudio } from "./server-product-studio";
import { configuredServerProductStudioDependencies } from "./server-product-studio-runtime";

const MAX_RESEARCH_STORAGE_OBJECT_BYTES = 24 * 1024 * 1024;

function checkedResearchStorageBytes(value: ArrayBuffer) {
  if (value.byteLength < 1 || value.byteLength > MAX_RESEARCH_STORAGE_OBJECT_BYTES) {
    throw new Error("storage_object_size_invalid");
  }
  return new Uint8Array(value);
}

export function configuredServerProductResearchDependencies(): ServerProductResearchDependencies {
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() ?? "";
  const serviceClient = supabaseUrl && secretKey
    ? createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: createBoundedSupabaseFetch(10_000) },
    })
    : null;

  return {
    cronSecret: process.env.CRON_SECRET,
    releaseId: process.env.SELLERPILOT_RELEASE_SHA,
    vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA,
    requireActiveRuntime: true,
    preflightImageMode: process.env.SELLERPILOT_PRODUCT_RESEARCH_IMAGE_MODE === "gateway-composite"
      ? "gateway-composite"
      : "source-photo-catalog",
    rpc: serviceClient
      ? async (name, arguments_ = {}) => {
        const { data, error } = await serviceClient.rpc(name, arguments_);
        return { data, error };
      }
      : undefined,
    download: serviceClient
      ? async (path, signal) => {
        if (signal.aborted) throw signal.reason;
        const { data, error } = await serviceClient.storage.from("sellerpilot-ai").download(path);
        if (error || !data) throw new Error("storage_download_failed");
        if (signal.aborted) throw signal.reason;
        return checkedResearchStorageBytes(await data.arrayBuffer());
      }
      : undefined,
    upload: serviceClient
      ? async (path, bytes, signal) => {
        if (signal.aborted) throw signal.reason;
        const { error } = await serviceClient.storage.from("sellerpilot-ai").upload(path, bytes, {
          contentType: "image/png",
          cacheControl: "31536000",
          upsert: false,
        });
        if (!error) return "uploaded" as const;

        // The upload may have committed before the response was lost. Never
        // overwrite a claim-scoped result; prove exact identity instead.
        const { data: existing, error: readError } = await serviceClient.storage
          .from("sellerpilot-ai")
          .download(path);
        if (readError || !existing) throw new Error("storage_upload_failed");
        const existingBytes = checkedResearchStorageBytes(await existing.arrayBuffer());
        const expectedDigest = createHash("sha256").update(bytes).digest("hex");
        const existingDigest = createHash("sha256").update(existingBytes).digest("hex");
        if (expectedDigest !== existingDigest) throw new Error("storage_upload_conflict");
        return "identical" as const;
      }
      : undefined,
    remove: serviceClient
      ? async (paths) => {
        if (!paths.length) return;
        const { error } = await serviceClient.storage.from("sellerpilot-ai").remove(paths);
        if (error) throw new Error("storage_remove_failed");
      }
      : undefined,
    analyze: analyzeServerProductResearch,
  };
}

export async function wakeServerProductResearchAfterResponse() {
  const outcomes = await runServerProductResearchWakeBurst(
    configuredServerProductResearchDependencies(),
  );
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      console.error("server product research after wakeup threw", { status: 503 });
    } else if (outcome.value.status >= 500) {
      console.error("server product research after wakeup failed", {
        status: outcome.value.status,
      });
    }
  }
}

function scheduleJson(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * Reuses the existing Supabase-owned product-research schedule as the Studio
 * recovery drain. Canary requests never claim, and research runs only when
 * the higher-cost Studio queue is idle. No Vercel Cron is introduced.
 */
export async function runServerProductRecoverySchedule(request: Request) {
  const research = configuredServerProductResearchDependencies();
  const authorization = internalScheduleAuthorization(
    request.headers.get("authorization"),
    research.cronSecret?.trim() ?? "",
  );
  if (authorization === "missing") return scheduleJson({ message: "상품 AI 일정 인증값이 설정되지 않았습니다." }, 503);
  if (authorization !== "authorized") return scheduleJson({ message: "상품 AI 일정 인증이 필요합니다." }, 401);
  const mode = internalScheduleRequestMode(request);
  if (mode === "invalid") return scheduleJson({ message: "상품 AI 일정 실행 모드를 확인하지 못했습니다." }, 400);
  if (mode === "canary") {
    return scheduleJson(internalScheduleCanaryPayload({
      sellerpilotReleaseSha: research.releaseId,
      vercelGitCommitSha: research.vercelGitCommitSha,
    }));
  }
  if (!research.rpc) return scheduleJson({ message: "상품 AI 서버 연결이 완료되지 않았습니다." }, 503);
  const runtime = await research.rpc("sellerpilot_service_serverless_cs_wakeup_status");
  if (runtime.error || !runtimeStatusMatchesCurrentRelease(runtime.data, {
    sellerpilotReleaseSha: research.releaseId,
    vercelGitCommitSha: research.vercelGitCommitSha,
  })) {
    return scheduleJson({ message: "서버 일정이 활성화되지 않았습니다." }, 503);
  }

  const studio = await runOneServerProductStudio(configuredServerProductStudioDependencies());
  if (studio.status >= 500) return studio;
  const body = await studio.clone().json().catch(() => null) as Record<string, unknown> | null;
  return body?.status === "idle"
    ? runOneServerProductResearch(research)
    : studio;
}
