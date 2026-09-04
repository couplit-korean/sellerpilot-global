import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import { resolveRuntimeReleaseIdentity } from "../../../../lib/internal-scheduler-auth";
import {
  activateServerlessRuntimeRelease,
  candidateAutomationBypassAuthorized,
  readServerlessRuntimeReleaseStatus,
  runCandidateServerlessRuntimeCanary,
  ServerlessRuntimeReleaseError,
  VERCEL_PROTECTION_BYPASS_HEADER,
} from "../../../../lib/serverless-runtime-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  if (body?.action !== "candidate_canary" && body?.action !== "canary_activate") {
    return NextResponse.json({ message: "운영 일정 재검증 요청을 확인하지 못했습니다." }, { status: 400 });
  }
  if (body.action === "candidate_canary") {
    // A generated deployment URL can be public when Deployment Protection is
    // disabled. Host/project/release checks are identity fences, not caller
    // authentication, so an application session must never open this route.
    // `vercel curl` supplies this project-scoped protection token without
    // downloading CRON_SECRET into the caller's environment.
    const candidateAutomationAuthorized = candidateAutomationBypassAuthorized(
      request.headers.get(VERCEL_PROTECTION_BYPASS_HEADER),
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
    );
    if (!candidateAutomationAuthorized) {
      return NextResponse.json({
        message: "후보 배포 자동화 인증을 확인할 수 없습니다.",
        code: "runtime_candidate_automation_auth_required",
      }, { status: 401, headers: { "cache-control": "no-store" } });
    }
    const identity = resolveRuntimeReleaseIdentity();
    if (identity.status !== "valid") {
      return NextResponse.json({
        message: "현재 운영 배포 식별자를 확인할 수 없습니다.",
        code: "runtime_release_unavailable",
      }, { status: 503, headers: { "cache-control": "no-store" } });
    }
    try {
      const result = await runCandidateServerlessRuntimeCanary({
        origin: new URL(request.url).origin,
        vercelUrl: process.env.VERCEL_URL ?? "",
        vercelProjectId: process.env.VERCEL_PROJECT_ID ?? "",
        vercelEnvironment: process.env.VERCEL_ENV ?? "",
        vercelTargetEnvironment: process.env.VERCEL_TARGET_ENV ?? "",
        release: identity.release,
        cronSecret: process.env.CRON_SECRET ?? "",
      });
      return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      const failure = error instanceof ServerlessRuntimeReleaseError
        ? error
        : new ServerlessRuntimeReleaseError("runtime_candidate_canary_failed", 503);
      return NextResponse.json({
        message: "후보 배포의 무작업 점검을 완료하지 못했습니다. 운영 일정은 변경하지 않았습니다.",
        code: failure.safeCode,
      }, { status: failure.status, headers: { "cache-control": "no-store" } });
    }
  }
  const admin = await authenticateAdminRequest(request, { timeoutMs: 30_000 });
  if (isAdminApiError(admin)) return admin;
  const identity = resolveRuntimeReleaseIdentity();
  if (identity.status !== "valid") {
    return NextResponse.json({ message: "현재 운영 배포 식별자를 확인할 수 없습니다.", code: "runtime_release_unavailable" }, { status: 503 });
  }
  try {
    const result = await activateServerlessRuntimeRelease({
      origin: new URL(request.url).origin,
      release: identity.release,
      cronSecret: process.env.CRON_SECRET ?? "",
      rpc: async (name, arguments_ = {}) => {
        const { data, error } = await admin.serviceClient.rpc(name, arguments_);
        return { data, error };
      },
    });
    return NextResponse.json({
      ...result,
      message: "현재 운영 배포의 무작업 점검 6개를 통과하고 Supabase 일정을 재시작했습니다.",
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const reconciled = await readServerlessRuntimeReleaseStatus(async (name, arguments_ = {}) => {
      const { data, error: rpcError } = await admin.serviceClient.rpc(name, arguments_);
      return { data, error: rpcError };
    }).catch(() => null);
    if (reconciled?.active === true && reconciled.activeRelease === identity.release) {
      return NextResponse.json({
        ok: true,
        release: identity.release,
        reconciled: true,
        status: reconciled,
        message: "응답이 불확실했지만 상태 재조회에서 현재 운영 배포의 일정 6개가 활성화된 것을 확인했습니다.",
      }, { headers: { "cache-control": "no-store" } });
    }
    const failure = error instanceof ServerlessRuntimeReleaseError
      ? error
      : new ServerlessRuntimeReleaseError("runtime_release_activation_failed", 503);
    return NextResponse.json({
      message: "운영 일정 재검증 결과를 확정하지 못했습니다. 현재 일정 상태를 다시 조회해 주세요.",
      code: failure.safeCode,
    }, { status: failure.status, headers: { "cache-control": "no-store" } });
  }
}
