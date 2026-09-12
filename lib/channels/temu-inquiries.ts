import { temuRequest, type SecretPayload } from "./protocols";
import { step, type ChannelOperationStep } from "./operation-step";
import { temuResultRecords } from "./temu-response";
import { MAX_PROVIDER_SYNC_PAGES } from "./operation-pagination";
import { integerArgument } from "./operation-values";

type TemuInquiryInput = { operation: "inquiries.list"; payload: SecretPayload; arguments: Record<string, unknown> };
export type TemuInquiryExecution = { steps: ChannelOperationStep[]; continuationArguments?: Record<string, unknown> };

const TEMU_AFTER_SALES_PAGE_SIZE = 200;
const TEMU_AFTER_SALES_DETAILS_PER_JOB = 10;
const TEMU_LOCAL_ARGUMENTS = new Set([
  "kind",
  "includeDetails",
  "detailQueue",
  "retryReplayQueue",
  "nextPageNo",
  "sellerpilotPaginationDepth",
  "sellerpilotPaginationEpoch",
  "sellerpilotPaginationTrail",
  "sellerpilotTemuDetailRetryCount",
  "sellerpilotTemuHistoryRunId",
  "sellerpilotTemuHistoryCursor",
]);

type TemuAfterSalesSummary = {
  parentAfterSalesSn: string;
  parentOrderSn: string;
  afterSalesStatusGroup: number | string | null;
  operateExpireTimeMs: number | null;
  availableOperateList: unknown[];
  returnDeliveryType: number | string | null;
  parentAfterSalesStatus: number | string | null;
  updateAt: number | string | null;
  afterSalesType: number | string | null;
  createAt: number | string | null;
};

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("TEMU_AFTER_SALES_RESPONSE_INVALID");
  }
  return value as Record<string, unknown>;
}

function exactSerial(value: unknown, code: string) {
  const serial = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(serial)) throw new Error(code);
  return serial;
}

function afterSalesChildMatchesOrder(value: unknown, parentOrderSn: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    return exactSerial(
      (value as Record<string, unknown>).orderSn,
      "TEMU_AFTER_SALES_DETAIL_MISMATCH",
    ) === parentOrderSn;
  } catch {
    return false;
  }
}

function optionalScalar(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function afterSalesSummary(value: unknown): TemuAfterSalesSummary {
  const row = record(value);
  const availableOperateList = row.availableOperateList === undefined
    ? []
    : Array.isArray(row.availableOperateList)
        && row.availableOperateList.length <= 100
        && row.availableOperateList.every((item) => typeof item === "string" || typeof item === "number")
      ? row.availableOperateList
      : (() => { throw new Error("TEMU_AFTER_SALES_OPERATIONS_INVALID"); })();
  const rawDeadline = Number(row.operateExpireTimeMs);
  return {
    parentAfterSalesSn: exactSerial(row.parentAfterSalesSn, "TEMU_AFTER_SALES_SERIAL_INVALID"),
    parentOrderSn: exactSerial(row.parentOrderSn, "TEMU_AFTER_SALES_ORDER_INVALID"),
    afterSalesStatusGroup: optionalScalar(row.afterSalesStatusGroup),
    operateExpireTimeMs: Number.isSafeInteger(rawDeadline) && rawDeadline > 0 ? rawDeadline : null,
    availableOperateList,
    returnDeliveryType: optionalScalar(row.returnDeliveryType),
    parentAfterSalesStatus: optionalScalar(row.parentAfterSalesStatus),
    updateAt: optionalScalar(row.updateAt),
    afterSalesType: optionalScalar(row.afterSalesType),
    createAt: optionalScalar(row.createAt),
  };
}

function detailQueue(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > TEMU_AFTER_SALES_PAGE_SIZE) {
    throw new Error("TEMU_AFTER_SALES_DETAIL_QUEUE_INVALID");
  }
  const queue = value.map(afterSalesSummary);
  if (new Set(queue.map((item) => item.parentAfterSalesSn)).size !== queue.length) {
    throw new Error("TEMU_AFTER_SALES_DETAIL_QUEUE_INVALID");
  }
  return queue;
}

function secondsArgument(arguments_: Record<string, unknown>, key: string) {
  if (arguments_[key] === undefined) return null;
  const raw = integerArgument(arguments_, key, { min: 1, max: 9_999_999_999_999 });
  // Temu expects ten-digit epoch seconds. Older stored plans and the seller CS
  // screen still send epoch milliseconds, which used to fail the range check
  // without telling anyone why, so the unit is normalized here.
  return raw > 9_999_999_999 ? Math.floor(raw / 1_000) : raw;
}

function assertAfterSalesTimeRange(arguments_: Record<string, unknown>) {
  const createAtStart = secondsArgument(arguments_, "createAtStart");
  const createAtEnd = secondsArgument(arguments_, "createAtEnd");
  const updateAtStart = secondsArgument(arguments_, "updateAtStart");
  const updateAtEnd = secondsArgument(arguments_, "updateAtEnd");
  if ((createAtStart === null) !== (createAtEnd === null)
      || (updateAtStart === null) !== (updateAtEnd === null)
      || createAtStart === null && updateAtStart === null
      || createAtStart !== null && createAtEnd !== null && createAtStart > createAtEnd
      || updateAtStart !== null && updateAtEnd !== null && updateAtStart > updateAtEnd) {
    throw new Error("TEMU_AFTER_SALES_TIME_RANGE_INVALID");
  }
}

function providerListArguments(arguments_: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(arguments_).filter(([key]) => !TEMU_LOCAL_ARGUMENTS.has(key)),
  );
}

function temuHistoryCursor(arguments_: Record<string, unknown>) {
  if (arguments_.sellerpilotTemuHistoryCursor === undefined) return null;
  const value = record(arguments_.sellerpilotTemuHistoryCursor);
  const keys = Object.keys(value).sort();
  const date = typeof value.date === "string" ? value.date : "";
  const statusGroup = Number(value.statusGroup);
  const pageNo = Number(value.pageNo);
  const start = Date.parse(`${date}T00:00:00+09:00`);
  if (keys.join(",") !== "date,pageNo,statusGroup"
      || !/^\d{4}-\d{2}-\d{2}$/u.test(date)
      || !Number.isFinite(start)
      || !Number.isInteger(statusGroup) || statusGroup < 1 || statusGroup > 7
      || !Number.isInteger(pageNo) || pageNo < 1 || pageNo > 1_000_000
      || Number(arguments_.afterSalesStatusGroup) !== statusGroup
      || Number(arguments_.updateAtStart) !== Math.floor(start / 1_000)
      || Number(arguments_.updateAtEnd) !== Math.floor((start + 86_400_000 - 1_000) / 1_000)) {
    throw new Error("TEMU_HISTORY_CURSOR_INVALID");
  }
  return { date, statusGroup, pageNo };
}

function detailContinuationArguments({
  arguments: arguments_,
  pageNo,
  pageSize,
  queue,
  nextPageNo,
}: {
  arguments: Record<string, unknown>;
  pageNo: number;
  pageSize: number;
  queue: TemuAfterSalesSummary[];
  nextPageNo: number | null;
}) {
  const historyCursor = temuHistoryCursor(arguments_);
  return {
    ...Object.fromEntries(Object.entries(arguments_).filter(([key]) =>
      !["detailQueue", "retryReplayQueue", "nextPageNo", "sellerpilotPaginationDepth", "sellerpilotPaginationEpoch", "sellerpilotPaginationTrail", "sellerpilotTemuDetailRetryCount"].includes(key))),
    includeDetails: true,
    pageNo: nextPageNo ?? pageNo,
    pageSize,
    ...(historyCursor ? { sellerpilotTemuHistoryCursor: {
      ...historyCursor,
      pageNo: queue.length ? historyCursor.pageNo : nextPageNo ?? historyCursor.pageNo,
    } } : {}),
    ...(queue.length ? {
      detailQueue: queue,
      ...(nextPageNo !== null ? { nextPageNo } : {}),
    } : {}),
  };
}

const TEMU_RETRYABLE_DETAIL_STATUSES = new Set([408, 425, 500, 502, 503, 504]);

export type TemuInquiryRetryContinuation = {
  reason: "retryable_read_failure";
  arguments: Record<string, unknown>;
  retryCount: number;
  retryAfterSeconds: number;
  deferredCount: number;
  replayCount: number;
  providerStatus: number;
};

/**
 * Produces a durable-retry descriptor without changing the failed provider
 * steps. The common gateway must atomically persist the descriptor before
 * requeueing; it must never attach this to the successful pagination path.
 */
export function temuInquiryRetryContinuation(
  execution: TemuInquiryExecution,
): TemuInquiryRetryContinuation | null {
  if (!execution.continuationArguments) return null;
  const failedIndexes = execution.steps
    .map((item, index) => item.ok ? -1 : index)
    .filter((index) => index >= 0);
  if (failedIndexes.length === 0) return null;
  const failedIndex = failedIndexes[0]!;
  const failedStep = execution.steps[failedIndex]!;
  if (failedIndexes.length !== 1
      || failedIndex !== execution.steps.length - 1
      || !TEMU_RETRYABLE_DETAIL_STATUSES.has(failedStep.status)) {
    return null;
  }
  const summary = record(failedStep.data.sellerpilotListSummary);
  const failedAfterSalesSn = exactSerial(
    summary.parentAfterSalesSn,
    "TEMU_AFTER_SALES_RETRY_IDENTITY_INVALID",
  );
  const failedOrderSn = exactSerial(
    summary.parentOrderSn,
    "TEMU_AFTER_SALES_RETRY_IDENTITY_INVALID",
  );
  const queue = detailQueue(execution.continuationArguments.detailQueue);
  const replayQueue = detailQueue(execution.continuationArguments.retryReplayQueue);
  if (!queue.length
      || queue[0]?.parentAfterSalesSn !== failedAfterSalesSn
      || queue[0]?.parentOrderSn !== failedOrderSn
      || replayQueue.length + queue.length > TEMU_AFTER_SALES_PAGE_SIZE
      || new Set([...replayQueue, ...queue].map((item) => item.parentAfterSalesSn)).size
        !== replayQueue.length + queue.length) {
    throw new Error("TEMU_AFTER_SALES_RETRY_IDENTITY_MISMATCH");
  }
  const retryCount = Number(execution.continuationArguments.sellerpilotTemuDetailRetryCount);
  if (!Number.isSafeInteger(retryCount) || retryCount < 1 || retryCount > 3) {
    throw new Error("TEMU_AFTER_SALES_RETRY_COUNT_INVALID");
  }
  return {
    reason: "retryable_read_failure",
    arguments: execution.continuationArguments,
    retryCount,
    retryAfterSeconds: 5 * 2 ** (retryCount - 1),
    deferredCount: queue.length,
    replayCount: replayQueue.length,
    providerStatus: failedStep.status,
  };
}

// Temu after-sales retrieval is separate from chat, reply and fulfillment.
export async function executeTemuInquiry(input: TemuInquiryInput): Promise<TemuInquiryExecution> {
  if (input.operation === "inquiries.list") {
    if (input.arguments.kind !== undefined && input.arguments.kind !== "after_sales") {
      throw new Error("TEMU_AFTER_SALES_KIND_INVALID");
    }
    if (input.arguments.includeDetails !== undefined && input.arguments.includeDetails !== true) {
      throw new Error("CHANNEL_ARGUMENT_INVALID:includeDetails");
    }
    if (input.arguments.pageSize !== undefined && typeof input.arguments.pageSize !== "number") {
      throw new Error("CHANNEL_ARGUMENT_INVALID:pageSize");
    }
    if (input.arguments.pageNo !== undefined && typeof input.arguments.pageNo !== "number") {
      throw new Error("CHANNEL_ARGUMENT_INVALID:pageNo");
    }
    const pageSize = input.arguments.pageSize === undefined
      ? TEMU_AFTER_SALES_PAGE_SIZE
      : integerArgument(input.arguments, "pageSize", { min: 1, max: TEMU_AFTER_SALES_PAGE_SIZE });
    let pageNo = input.arguments.pageNo === undefined
      ? 1
      : integerArgument(input.arguments, "pageNo", { min: 1, max: 1_000_000 });
    const detailRetryCount = input.arguments.sellerpilotTemuDetailRetryCount === undefined
      ? 0
      : integerArgument(input.arguments, "sellerpilotTemuDetailRetryCount", { min: 1, max: 3 });
    temuHistoryCursor(input.arguments);
    assertAfterSalesTimeRange(input.arguments);
    if (input.arguments.includeDetails === true) {
      let queue = detailQueue(input.arguments.detailQueue);
      const replayQueue = detailQueue(input.arguments.retryReplayQueue);
      if (replayQueue.length) {
        const combinedQueue = [...replayQueue, ...queue];
        if (!queue.length
            || combinedQueue.length > TEMU_AFTER_SALES_PAGE_SIZE
            || new Set(combinedQueue.map((item) => item.parentAfterSalesSn)).size !== combinedQueue.length) {
          throw new Error("TEMU_AFTER_SALES_RETRY_REPLAY_QUEUE_INVALID");
        }
        queue = combinedQueue;
      }
      let nextPageNo = input.arguments.nextPageNo === undefined
        ? null
        : integerArgument(input.arguments, "nextPageNo", { min: 2, max: 1_000_001 });
      const steps: ChannelOperationStep[] = [];
      if (queue.length === 0) {
        if (nextPageNo !== null) throw new Error("TEMU_AFTER_SALES_CONTINUATION_INVALID");
        const providerArguments = providerListArguments(input.arguments);
        const listRemote = await temuRequest({
          payload: input.payload,
          type: "bg.aftersales.parentaftersales.list.get",
          arguments: { ...providerArguments, pageNo, pageSize },
        });
        const discovery = step("after-sales-list-discovery", listRemote);
        steps.push(discovery);
        if (!discovery.ok) return { steps };
        const result = record(listRemote.data.result);
        const rows = temuResultRecords(listRemote.data, "data");
        if (rows.length > pageSize) throw new Error("TEMU_AFTER_SALES_PAGE_INVALID");
        queue = rows.map(afterSalesSummary);
        if (new Set(queue.map((item) => item.parentAfterSalesSn)).size !== queue.length) {
          throw new Error("TEMU_AFTER_SALES_PAGE_INVALID");
        }
        const total = result.total === undefined ? null : Number(result.total);
        const returnedPage = result.pageNumber === undefined ? pageNo : Number(result.pageNumber);
        if ((total !== null && (!Number.isSafeInteger(total) || total < 0))
            || !Number.isSafeInteger(returnedPage) || returnedPage !== pageNo) {
          throw new Error("TEMU_AFTER_SALES_PAGINATION_INVALID");
        }
        const hasNextPage = total === null
          ? rows.length === pageSize
          : pageNo * pageSize < total;
        if (hasNextPage && rows.length === 0) throw new Error("TEMU_AFTER_SALES_PAGINATION_INVALID");
        nextPageNo = hasNextPage ? pageNo + 1 : null;
        if (queue.length === 0) {
          discovery.name = "inquiries";
          return { steps };
        }
      }

      const selected = queue.slice(0, TEMU_AFTER_SALES_DETAILS_PER_JOB);
      for (let detailIndex = 0; detailIndex < selected.length; detailIndex += 1) {
        const summary = selected[detailIndex]!;
        const detailRemote = await temuRequest({
          payload: input.payload,
          type: "temu.aftersales.parentaftersales.detail.get",
          arguments: {
            parentOrderSn: summary.parentOrderSn,
            parentAfterSalesSn: summary.parentAfterSalesSn,
          },
        });
        detailRemote.data = { ...detailRemote.data, sellerpilotListSummary: summary };
        const detailStep = step(steps.some((item) => /^inquiries(?::\d+)?$/.test(item.name))
          ? `inquiries:${steps.filter((item) => /^inquiries(?::\d+)?$/.test(item.name)).length + 1}`
          : "inquiries", detailRemote);
        steps.push(detailStep);
        if (!detailStep.ok) {
          const continuationArguments = detailContinuationArguments({
            arguments: input.arguments,
            pageNo,
            pageSize,
            queue: queue.slice(detailIndex),
            nextPageNo,
          });
          return {
            steps,
            ...(detailRetryCount < 3 ? {
              continuationArguments: {
                ...continuationArguments,
                ...(detailIndex > 0 ? { retryReplayQueue: queue.slice(0, detailIndex) } : {}),
                sellerpilotTemuDetailRetryCount: detailRetryCount + 1,
              },
            } : {}),
          };
        }
        const detail = record(detailRemote.data.result);
        if (exactSerial(detail.parentAfterSalesSn, "TEMU_AFTER_SALES_DETAIL_INVALID") !== summary.parentAfterSalesSn
            || exactSerial(detail.parentOrderSn, "TEMU_AFTER_SALES_DETAIL_INVALID") !== summary.parentOrderSn
            || !Array.isArray(detail.afterSalesList)
            || detail.afterSalesList.length === 0
            || detail.afterSalesList.length > 200
            || detail.afterSalesList.some((item) => !afterSalesChildMatchesOrder(item, summary.parentOrderSn))) {
          throw new Error("TEMU_AFTER_SALES_DETAIL_MISMATCH");
        }
      }

      const remaining = queue.slice(selected.length);
      if (remaining.length || nextPageNo !== null) {
        return {
          steps,
          continuationArguments: detailContinuationArguments({
            arguments: input.arguments,
            pageNo,
            pageSize,
            queue: remaining,
            nextPageNo,
          }),
        };
      }
      return { steps };
    }
    const providerArguments = providerListArguments(input.arguments);
    const steps: ChannelOperationStep[] = [];
    for (let pageIndex = 0; pageIndex < MAX_PROVIDER_SYNC_PAGES; pageIndex += 1) {
      const remote = await temuRequest({
        payload: input.payload,
        type: "bg.aftersales.parentaftersales.list.get",
        arguments: { ...providerArguments, pageNo, pageSize },
      });
      const pageStep = step(pageIndex === 0 ? "inquiries" : `inquiries:${pageNo}`, remote);
      steps.push(pageStep);
      if (!pageStep.ok || temuResultRecords(remote.data, "data").length < pageSize) break;
      const nextPageNo = pageNo + 1;
      if (pageIndex === MAX_PROVIDER_SYNC_PAGES - 1) {
        return { steps: steps, continuationArguments: { ...input.arguments, pageNo: nextPageNo, pageSize } };
      }
      pageNo = nextPageNo;
    }
    return { steps: steps };
  }
  throw new Error("TEMU_INQUIRY_OPERATION_REQUIRED");
}
