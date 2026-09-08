import {
  shippingOperationCapabilities as channelOperationCapabilities,
  type ShippingOperationName as ChannelOperationName,
  type ShippingOperationResult as ChannelOperationResult,
  type ShippingExecuteInput as ExecuteInput,
} from "./contracts";
import { MAX_PROVIDER_SYNC_CONTINUATIONS } from "../channels/operation-pagination";
import { type ChannelOperationStep } from "../channels/operation-step";
import { finiteCount } from "../channels/operation-values";
import { channelCatalog, type ActiveChannelKey } from "../channels/catalog";
import { qoo10ResultMessage } from "../channels/qoo10";

export function providerBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  return (
    typeof value === "string" &&
    ["true", "1", "yes"].includes(value.trim().toLowerCase())
  );
}

export function result(
  input: ExecuteInput,
  steps: ChannelOperationStep[],
  remoteId?: string,
  continuation?: ChannelOperationResult["continuation"],
): ChannelOperationResult {
  const ok = steps.length > 0 && steps.every((s) => s.ok);
  const providerMessage =
    steps
      .filter((s) => !s.ok)
      .map((s) =>
        input.channel === "qoo10"
          ? qoo10ResultMessage(s.data)
          : safeProviderError(s.data),
      )
      .find(Boolean) ?? "";
  return {
    ok,
    channel: input.channel,
    operation: input.operation,
    steps,
    remoteId,
    ...(ok && continuation ? { continuation } : {}),
    safeMessage: ok
      ? continuation
        ? `${channelCatalog[input.channel].name} ${input.operation} 현재 구간이 정상 응답했고 다음 페이지 구간을 이어서 처리합니다.`
        : `${channelCatalog[input.channel].name} ${input.operation} 작업이 정상 응답했습니다.`
      : `${channelCatalog[input.channel].name} ${input.operation} 작업이 원격 오류로 종료됐습니다.${providerMessage ? ` · ${providerMessage}` : ""}`,
  };
}

export function paginationResult(
  input: ExecuteInput,
  steps: ChannelOperationStep[],
  nextArguments: Record<string, unknown>,
) {
  const depth = finiteCount(input.arguments.sellerpilotPaginationDepth) ?? 0;
  if (depth >= MAX_PROVIDER_SYNC_CONTINUATIONS)
    return paginationSafetyStop(input);
  return result(input, steps, undefined, {
    reason: "page_cap_reached",
    arguments: { ...nextArguments, sellerpilotPaginationDepth: depth + 1 },
  });
}

export function paginationSafetyStop(input: ExecuteInput) {
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

export function safeProviderError(data: Record<string, unknown>) {
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

export function ensureProviderSupport(
  channel: ActiveChannelKey,
  operation: ChannelOperationName,
) {
  if (
    ["ebay", "temu"].includes(channel) &&
    operation === "shipment.acknowledge"
  ) {
    throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${operation}`);
  }
  const capability =
    channelCatalog[channel].capabilities[
      channelOperationCapabilities[operation]
    ];
  if (capability.mode === "unsupported")
    throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${operation}`);
  if (capability.mode === "vendor_docs_required")
    throw new Error(`CHANNEL_VENDOR_SPEC_REQUIRED:${operation}`);
}
