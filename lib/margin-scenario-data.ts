export const recentMarginScenarioLimit = 50;
export const latestMarginScenarioLimit = 400;

type MarginScenarioRow = Record<string, unknown> & {
  id: string;
  productId: string | null;
  channelKey: string;
  inputs: Record<string, unknown>;
  result: Record<string, unknown>;
  createdAt: string;
};

type MarginScenarioRpcError = {
  code?: string | null;
  message?: string | null;
} | null;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseMarginScenario(value: unknown): MarginScenarioRow | null {
  const row = record(value);
  if (!row
    || typeof row.id !== "string"
    || row.id.length === 0
    || (row.productId !== null && typeof row.productId !== "string")
    || typeof row.channelKey !== "string"
    || row.channelKey.length === 0
    || typeof row.createdAt !== "string"
    || !record(row.inputs)
    || !record(row.result)) return null;
  return row as MarginScenarioRow;
}

function scenarioTimestamp(value: MarginScenarioRow) {
  const parsed = Date.parse(value.createdAt);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function isMissingLatestMarginScenarioRpc(error: MarginScenarioRpcError) {
  if (!error) return false;
  const code = typeof error.code === "string" ? error.code.toUpperCase() : "";
  const message = typeof error.message === "string" ? error.message : "";
  if (code === "PGRST202") return /sellerpilot_list_latest_margin_scenarios/i.test(message);
  return code === "42883"
    && /function\s+(?:public\.)?sellerpilot_list_latest_margin_scenarios\s*\(/i.test(message)
    && /does not exist/i.test(message);
}

export function mergeMarginScenarioRows(...collections: unknown[]) {
  const byId = new Map<string, MarginScenarioRow>();
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    for (const value of collection) {
      const scenario = parseMarginScenario(value);
      if (scenario && !byId.has(scenario.id)) byId.set(scenario.id, scenario);
    }
  }
  return [...byId.values()].sort((left, right) => {
    const timestampDifference = scenarioTimestamp(right) - scenarioTimestamp(left);
    return timestampDifference || right.id.localeCompare(left.id);
  });
}

export function resolveMarginScenarioRows({
  recentData,
  recentError,
  latestData,
  latestError,
}: {
  recentData: unknown;
  recentError: MarginScenarioRpcError;
  latestData: unknown;
  latestError: MarginScenarioRpcError;
}) {
  const recentReady = !recentError && Array.isArray(recentData);
  const latestReady = !latestError && Array.isArray(latestData);
  const rows = mergeMarginScenarioRows(
    latestReady ? latestData : [],
    recentReady ? recentData : [],
  );
  if (latestReady) {
    return {
      rows,
      state: "ready" as const,
      coverage: "latest-per-product-channel" as const,
      message: recentReady
        ? null
        : "상품별·채널별 최신 마진 기준은 불러왔지만 최근 계산 이력은 확인하지 못했습니다.",
    };
  }
  if (recentReady) {
    return {
      rows,
      state: "ready" as const,
      coverage: "recent-fallback" as const,
      message: isMissingLatestMarginScenarioRpc(latestError)
        ? "상품별 최신 마진 기준 마이그레이션 적용 전이라 최근 50개 저장 이력만 사용합니다. 누락 채널은 계산하지 않습니다."
        : "상품별 최신 마진 기준 조회가 실패해 최근 50개 저장 이력만 사용합니다. 누락 채널은 계산하지 않습니다.",
    };
  }
  return {
    rows: [],
    state: "unavailable" as const,
    coverage: "unavailable" as const,
    message: "저장된 마진 계산 이력을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.",
  };
}
