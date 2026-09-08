import { createHash } from "node:crypto";

type TemuAfterSalesRevisionInput = {
  listUpdateAt: unknown;
  lastUpdateAtMillis: unknown;
  statusGroup: string;
  parentAfterSalesStatus: string;
  afterSalesType: string;
  operateExpireTimeMs: number | null;
  availableOperations: string[];
  afterSalesCases: unknown[];
  refundSummary: Record<string, unknown>;
};

function optionalInteger(value: unknown, min: number, max: number, code: string) {
  if (value === undefined || value === null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(code);
  return number;
}

/** Builds a revision only from the allowlisted after-sales projection. */
export function temuAfterSalesRevision(input: TemuAfterSalesRevisionInput) {
  const detailMillis = optionalInteger(
    input.lastUpdateAtMillis,
    1_000_000_000_000,
    9_999_999_999_999,
    "TEMU_AFTER_SALES_DETAIL_TIMESTAMP_INVALID",
  );
  const listSeconds = optionalInteger(
    input.listUpdateAt,
    1,
    9_999_999_999,
    "TEMU_AFTER_SALES_LIST_TIMESTAMP_INVALID",
  );
  const stateDigest = createHash("sha256").update(JSON.stringify({
    contract: "temu-after-sales-state-v2",
    statusGroup: input.statusGroup,
    parentAfterSalesStatus: input.parentAfterSalesStatus,
    afterSalesType: input.afterSalesType,
    operateExpireTimeMs: input.operateExpireTimeMs,
    availableOperations: input.availableOperations,
    afterSalesCases: input.afterSalesCases,
    refundSummary: input.refundSummary,
  })).digest("hex");
  const source = detailMillis !== null
    ? "detailLastUpdateAtMillis"
    : listSeconds !== null
      ? "listUpdateAt"
      : "actionableState";
  const timestamp = detailMillis ?? listSeconds ?? "none";
  return {
    providerRevision: createHash("sha256")
      .update(`temu-after-sales-revision-v2\u001f${source}\u001f${timestamp}\u001f${stateDigest}`)
      .digest("hex"),
    providerRevisionSource: source,
    detailUpdatedAt: detailMillis === null ? null : new Date(detailMillis).toISOString(),
    stateDigest,
  } as const;
}
