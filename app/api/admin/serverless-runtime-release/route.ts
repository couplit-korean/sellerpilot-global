import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import { resolveRuntimeReleaseIdentity } from "../../../../lib/internal-scheduler-auth";
import {
  activateServerlessRuntimeRelease,
  readServerlessRuntimeReleaseStatus,
  ServerlessRuntimeReleaseError,
} from "../../../../lib/serverless-runtime-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request, { timeoutMs: 10_000 });
  if (isAdminApiError(admin)) return admin;
  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  if (body?.action !== "canary_activate") {
    return NextResponse.json({ message: "운영 일정 재검증 요청을 확인하지 못했습니다." }, { status: 400 });
  }
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
