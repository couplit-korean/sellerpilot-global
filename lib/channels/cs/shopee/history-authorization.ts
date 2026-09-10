type JsonRecord = Record<string, unknown>;

export function shopeeHistoryAuthorizationError(
  argumentsValue: JsonRecord,
  result: { ok: boolean; steps: Array<{ ok: boolean; status: number }> },
) {
  if (typeof argumentsValue.sellerpilotShopeeHistoryRunId !== "string" || result.ok) return null;
  const failure = result.steps.find((step) => !step.ok && (step.status === 401 || step.status === 403));
  return failure ? `SHOPEE_${failure.status}_AUTHORIZATION_REQUIRED` : null;
}
