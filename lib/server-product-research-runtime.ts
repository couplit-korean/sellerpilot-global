import "server-only";
import { createClient } from "@supabase/supabase-js";
import {
  analyzeServerProductResearch,
  runOneServerProductResearch,
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
    rpc: serviceClient
      ? async (name, arguments_ = {}) => {
        const { data, error } = await serviceClient.rpc(name, arguments_);
        return { data, error };
      }
      : undefined,
    analyze: analyzeServerProductResearch,
  };
}

export async function wakeServerProductResearchAfterResponse() {
  try {
    const response = await runOneServerProductResearch(
      configuredServerProductResearchDependencies(),
    );
    if (response.status >= 500) {
      console.error("server product research after wakeup failed", {
        status: response.status,
      });
    }
  } catch {
    console.error("server product research after wakeup threw", { status: 503 });
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
