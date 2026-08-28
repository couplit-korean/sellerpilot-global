import { NextResponse } from "next/server";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import {
  latestMarginScenarioLimit,
  recentMarginScenarioLimit,
  resolveMarginScenarioRows,
} from "../../../../lib/margin-scenario-data";

export const runtime = "nodejs";

const STALE_AI_QUEUED_TIMEOUT_MS = 24 * 60 * 60_000;
const STALE_AI_RECOVERY_LIMIT = 100;

type AiRecovery = {
  status: "checking" | "passed" | "failed";
  expiredCount: number;
  message: string | null;
  checkedAt: string | null;
};

function expiredCount(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const total = (value as Record<string, unknown>).total;
  return typeof total === "number" && Number.isFinite(total)
    ? Math.max(0, Math.trunc(total))
    : 0;
}

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;

  const shouldRecoverStaleAi = new URL(request.url).searchParams.get("recoverStale") !== "0";
  const recoveryResult = shouldRecoverStaleAi
    ? await admin.serviceClient.rpc(
        "sellerpilot_service_expire_stale_ai_jobs",
        {
          p_queued_before: new Date(Date.now() - STALE_AI_QUEUED_TIMEOUT_MS).toISOString(),
          p_limit: STALE_AI_RECOVERY_LIMIT,
        },
      )
    : null;
  const recoveryData = recoveryResult?.data ?? null;
  const recoveryError = recoveryResult?.error ?? null;
  const [
    { data: facts, error: factsError },
    { data: recentMarginScenarios, error: recentMarginScenariosError },
    { data: latestMarginScenarios, error: latestMarginScenariosError },
  ] = await Promise.all([
    admin.userClient.rpc("sellerpilot_get_product_readiness_facts"),
    admin.userClient.rpc("sellerpilot_list_margin_scenarios", { p_limit: recentMarginScenarioLimit }),
    admin.userClient.rpc("sellerpilot_list_latest_margin_scenarios", {
      p_product_id: null,
      p_limit: latestMarginScenarioLimit,
    }),
  ]);
  const aiRecovery: AiRecovery = {
    status: !shouldRecoverStaleAi ? "checking" : recoveryError ? "failed" : "passed",
    expiredCount: recoveryError ? 0 : expiredCount(recoveryData),
    message: !shouldRecoverStaleAi
      ? null
      : recoveryError
      ? "장기 AI 분석 작업의 자동 정리 상태를 확인하지 못했습니다. 등록 진행 화면에서 상태를 다시 확인해 주세요."
      : null,
    checkedAt: shouldRecoverStaleAi ? new Date().toISOString() : null,
  };
  const factsUnavailable = Boolean(factsError) || !Array.isArray(facts);
  const marginScenarios = resolveMarginScenarioRows({
    recentData: recentMarginScenarios,
    recentError: recentMarginScenariosError,
    latestData: latestMarginScenarios,
    latestError: latestMarginScenariosError,
  });

  return NextResponse.json({
    facts: factsUnavailable ? [] : facts,
    factsState: factsUnavailable ? "unavailable" : "ready",
    factsMessage: factsUnavailable
      ? "상품 가격·마진·카테고리·오류 상태를 불러오지 못했습니다. 마지막 정상 상태가 있으면 유지합니다."
      : null,
    aiRecovery,
    marginScenarios: marginScenarios.rows,
    marginScenarioState: marginScenarios.state,
    marginScenarioCoverage: marginScenarios.coverage,
    marginScenarioMessage: marginScenarios.message,
  }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
