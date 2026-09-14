import { activeChannelKeys } from "./channels/catalog";

export const categoryJobOperations = ["categories.suggest", "categories.attributes", "categories.validate"] as const;
export type CategoryJobOperation = typeof categoryJobOperations[number];
export type CategoryJobPayload = { ok?: boolean; channel?: string; operation?: string; jobId?: string; inProgress?: boolean; code?: string; message?: string; steps?: { name: string; ok: boolean; status: number; data: Record<string, unknown> }[]; remoteId?: string };
export const categoryJobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const categorySteps = new Set([
  "GetCatagoryListAll", "categories", "category", "category-tree", "category-list",
  "category-suggestion", "category-suggestions", "category-recommend", "category-metadata",
  "category-attributes", "category-validation", "category-status", "category-aspects",
  "default-category-tree", "global-categories", "global-category-attribute-tree",
  "global-category-exact-leaf", "category-attribute-tree", "category-attributes-compatibility",
  "attributes", "attribute-values", "standard-options", "attribute-value-units",
]);
const hiddenKeys = /^(?:.*token.*|.*secret.*|password|authorization|cookie|credential|credentials|headers|request|requestpayload|raw|rawbody|tickets|conversations|messages|orders|buyers|customers)$/i;
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function categoryData(value: unknown, depth = 0): unknown {
  if (depth > 40) throw new Error("CATEGORY_DATA_DEPTH");
  if (Array.isArray(value)) return value.map(item => categoryData(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !hiddenKeys.test(key.replace(/[_-]/g, ""))).map(([key, item]) => [key, categoryData(item, depth + 1)]));
  return value;
}
export function validCategoryJobQuery(jobId: string, channel: string, operation: string) {
  return categoryJobIdPattern.test(jobId) && (activeChannelKeys as readonly string[]).includes(channel)
    && (categoryJobOperations as readonly string[]).includes(operation);
}
export function categoryJobResponse(value: unknown, expected: { jobId: string; channel: string; operation: string }): { status: number; body: CategoryJobPayload } {
  const job = record(value);
  const error = (status: number, code: string, message: string) => ({ status, body: { ok: false, code, message } });
  if (!job.id) return error(404, "CATEGORY_JOB_NOT_FOUND", "저장된 카테고리 작업을 찾지 못했습니다.");
  if (job.id !== expected.jobId || job.channel !== expected.channel || job.operation !== expected.operation) return error(409, "CATEGORY_JOB_MISMATCH", "카테고리 작업의 채널 또는 종류가 일치하지 않습니다.");
  if (job.status === "queued" || job.status === "running") return { status: 202, body: { ok: false, inProgress: true, jobId: expected.jobId, channel: expected.channel, operation: expected.operation } };
  if (["failed", "cancelled", "reconciliation_required"].includes(String(job.status))) return error(409, "CATEGORY_JOB_FAILED", "카테고리 조회가 완료되지 못했습니다. 다시 확인해 주세요.");
  const response = record(job.response);
  if (job.status !== "succeeded" || response.channel !== expected.channel || response.operation !== expected.operation || response.ok !== true || !Array.isArray(response.steps)) return error(409, "CATEGORY_JOB_RESULT_INVALID", "카테고리 작업의 완료 결과를 확인하지 못했습니다.");
  const steps = response.steps.map(record).filter(step => typeof step.name === "string" && categorySteps.has(step.name));
  if (!steps.length || steps.some(step => typeof step.ok !== "boolean" || typeof step.status !== "number" || !step.data || typeof step.data !== "object")) return error(409, "CATEGORY_JOB_RESULT_INVALID", "카테고리 결과 형식을 확인하지 못했습니다.");
  try {
    return { status: 200, body: { ok: true, channel: expected.channel, operation: expected.operation, jobId: expected.jobId,
      steps: steps.map(step => ({ name: step.name as string, ok: step.ok as boolean, status: step.status as number, data: categoryData(step.data) as Record<string, unknown> })),
      ...(typeof response.remoteId === "string" ? { remoteId: response.remoteId } : {}),
    } };
  } catch { return error(409, "CATEGORY_JOB_RESULT_INVALID", "카테고리 결과 형식을 확인하지 못했습니다."); }
}
