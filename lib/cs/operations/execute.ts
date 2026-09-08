import { csChannelAdapters } from "./channel-adapters";
import { createHash } from "node:crypto";
import { channelCatalog } from "../../channels/catalog";
import { finiteCount } from "../../channels/operation-values";
import type { ChannelOperationStep } from "../../channels/operation-step";
import { MAX_PROVIDER_SYNC_CONTINUATIONS } from "../../channels/operation-pagination";
import { qoo10ResultMessage } from "../../channels/qoo10";
import { withShopeeHistoryContinuation } from "../../channels/cs/shopee/history-event-evidence";
import {
  isCsOperation,
  type CsExecuteInput as ExecuteInput,
  type CsOperationResult,
  type CsRetryContinuation,
} from "./contracts";

function result(
  input: ExecuteInput,
  steps: ChannelOperationStep[],
  remoteId?: string,
  continuation?: CsOperationResult["continuation"],
  retryContinuation?: CsRetryContinuation,
): CsOperationResult<ExecuteInput["operation"]> {
  const ok = steps.length > 0 && steps.every((item) => item.ok);
  const providerMessage =
    steps
      .filter((item) => !item.ok)
      .map((item) => {
        const message =
          input.channel === "qoo10"
            ? qoo10ResultMessage(item.data)
            : safeProviderError(item.data);
        return message ? `${item.name}: ${message}` : "";
      })
      .find(Boolean) ?? "";
  return {
    ok,
    channel: input.channel,
    operation: input.operation,
    steps,
    remoteId,
    ...(ok && continuation ? { continuation } : {}),
    ...(!ok && retryContinuation ? { retryContinuation } : {}),
    safeMessage: ok
      ? continuation
        ? `${channelCatalog[input.channel].name} ${input.operation} 현재 구간이 정상 응답했고 다음 페이지 구간을 이어서 처리합니다.`
        : `${channelCatalog[input.channel].name} ${input.operation} 작업이 정상 응답했습니다.`
      : `${channelCatalog[input.channel].name} ${input.operation} 작업이 원격 오류로 종료됐습니다.${providerMessage ? ` · ${providerMessage}` : ""}`,
  };
}

function paginationResult(
  input: ExecuteInput,
  steps: ChannelOperationStep[],
  nextArguments: Record<string, unknown>,
) {
  let depth = finiteCount(input.arguments.sellerpilotPaginationDepth) ?? 0;
  const durableInquiryPagination =
    input.operation === "inquiries.list" &&
    (input.channel === "lazada" ||
      input.channel === "shopee" ||
      input.channel === "ebay" ||
      input.channel === "coupang");
  let paginationEpoch =
    finiteCount(input.arguments.sellerpilotPaginationEpoch) ?? 0;
  let paginationTrail: string[] = [];
  if (durableInquiryPagination) {
    const rawTrail = input.arguments.sellerpilotPaginationTrail;
    if (
      rawTrail !== undefined &&
      (!Array.isArray(rawTrail) ||
        rawTrail.length > MAX_PROVIDER_SYNC_CONTINUATIONS ||
        rawTrail.some(
          (value) => typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value),
        ))
    ) {
      return result(input, [
        ...steps,
        {
          name: "pagination-safety-stop",
          ok: false,
          status: 409,
          data: {
            code: "PROVIDER_PAGINATION_TRAIL_INVALID",
            sellerpilotVerification: "PAGINATION_STOPPED_WITH_REMAINDER",
          },
        },
      ]);
    }
    paginationTrail = (rawTrail as string[] | undefined) ?? [];
    const cursorArguments = Object.fromEntries(
      Object.entries(nextArguments).filter(
        ([key]) =>
          ![
            "sellerpilotPaginationDepth",
            "sellerpilotPaginationEpoch",
            "sellerpilotPaginationTrail",
          ].includes(key),
      ),
    );
    const cursorDigest = createHash("sha256")
      .update(JSON.stringify(cursorArguments), "utf8")
      .digest("hex");
    if (paginationTrail.includes(cursorDigest)) {
      return result(input, [
        ...steps,
        {
          name: "pagination-safety-stop",
          ok: false,
          status: 409,
          data: {
            code: "PROVIDER_PAGINATION_CYCLE_DETECTED",
            sellerpilotVerification: "PAGINATION_STOPPED_WITH_REMAINDER",
          },
        },
      ]);
    }
    paginationTrail = [...paginationTrail, cursorDigest].slice(
      -MAX_PROVIDER_SYNC_CONTINUATIONS,
    );
    // The gateway contract and DB fence intentionally cap one continuation
    // generation at 50. Rotate only CS cursor generations, retaining a bounded
    // cursor digest trail so a provider cycle still fails closed.
    if (depth >= MAX_PROVIDER_SYNC_CONTINUATIONS - 1) {
      if (paginationEpoch >= 99) return paginationSafetyStop(input);
      depth = 0;
      paginationEpoch += 1;
    }
  }
  if (depth >= MAX_PROVIDER_SYNC_CONTINUATIONS) {
    return result(input, [
      ...steps,
      {
        name: "pagination-safety-stop",
        ok: false,
        status: 409,
        data: {
          code: "PROVIDER_PAGINATION_DEPTH_EXCEEDED",
          sellerpilotVerification: "PAGINATION_STOPPED_WITH_REMAINDER",
        },
      },
    ]);
  }
  const continuationArguments = {
    ...nextArguments,
    sellerpilotPaginationDepth: depth + 1,
    ...(durableInquiryPagination
      ? {
          sellerpilotPaginationEpoch: paginationEpoch,
          sellerpilotPaginationTrail: paginationTrail,
        }
      : {}),
  };
  const finalArguments =
    input.channel === "shopee" &&
    input.operation === "inquiries.list" &&
    typeof input.arguments.sellerpilotShopeeHistoryRunId === "string"
      ? withShopeeHistoryContinuation(input.arguments, continuationArguments)
      : continuationArguments;
  return result(input, steps, undefined, {
    reason: "page_cap_reached",
    arguments: finalArguments,
  });
}

function paginationSafetyStop(input: ExecuteInput) {
  return result(input, [
    {
      name: "pagination-safety-stop",
      ok: false,
      status: 409,
      data: {
        code: "PROVIDER_PAGINATION_DEPTH_EXCEEDED",
        sellerpilotVerification: "PAGINATION_STOPPED_WITH_REMAINDER",
      },
    },
  ]);
}

function safeProviderError(data: Record<string, unknown>) {
  const values: string[] = [];
  const keys = new Set([
    "error",
    "errors",
    "errorcode",
    "error_code",
    "errormsg",
    "error_msg",
    "errormessage",
    "error_message",
    "message",
    "resultmessage",
    "authmessage",
    "msg",
    "detail",
    "details",
    "reason",
    "failure_reason",
    "issue",
    "issues",
    "invalidinputs",
    "invalid_inputs",
  ]);
  const visit = (value: unknown, depth: number, keyed = false) => {
    if (
      depth > 6 ||
      values.length >= 16 ||
      value === null ||
      value === undefined
    )
      return;
    if (typeof value === "string" || typeof value === "number") {
      if (keyed && String(value).trim()) values.push(String(value).trim());
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1, keyed);
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const normalizedKey = key.toLocaleLowerCase().replace(/[^a-z_]/g, "");
      if (keys.has(normalizedKey)) visit(child, depth + 1, true);
      else if (keyed) visit(child, depth + 1, true);
    }
  };
  visit(data, 0);
  return [...new Set(values)]
    .join(" · ")
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .replace(
      /\b(key|token|secret|authorization|signature)=\S+/gi,
      "$1=[redacted]",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

export async function executeCsOperation(
  input: ExecuteInput,
): Promise<CsOperationResult<ExecuteInput["operation"]>> {
  if (!isCsOperation(input.operation))
    throw new Error(`CS_OPERATION_UNSUPPORTED:${input.operation}`);
  if (input.channel === "temu" && input.operation === "inquiries.reply")
    throw new Error("CHANNEL_OPERATION_UNSUPPORTED:inquiries.reply");
  const mode = channelCatalog[input.channel]?.capabilities.inquiries.mode;
  if (!mode || mode === "unsupported")
    throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${input.operation}`);
  if (mode === "vendor_docs_required")
    throw new Error(`CHANNEL_VENDOR_SPEC_REQUIRED:${input.operation}`);
  if (
    input.operation === "inquiries.list" &&
    (finiteCount(input.arguments.sellerpilotPaginationDepth) ?? 0) >=
      MAX_PROVIDER_SYNC_CONTINUATIONS
  )
    return paginationSafetyStop(input);
  const inquiry: {
    steps: ChannelOperationStep[];
    remoteId?: string;
    continuationArguments?: Record<string, unknown>;
    retryContinuation?: CsRetryContinuation;
  } = await csChannelAdapters[input.channel](input);
  if (inquiry.retryContinuation)
    return result(
      input,
      inquiry.steps,
      undefined,
      undefined,
      inquiry.retryContinuation,
    );
  return inquiry.continuationArguments
    ? paginationResult(input, inquiry.steps, inquiry.continuationArguments)
    : result(input, inquiry.steps, inquiry.remoteId);
}
