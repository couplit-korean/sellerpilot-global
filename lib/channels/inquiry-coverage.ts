import "server-only";
import { createHash } from "node:crypto";
import type { ActiveChannelKey } from "./catalog.ts";
import type { NormalizedChannelInquiry } from "./inquiry-sync.ts";
import type { CsOperationResult as ChannelOperationResult } from "../cs/operations/contracts";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function rows(...values: unknown[]) {
  const value = values.find(Array.isArray);
  if (!Array.isArray(value) || value.some(item => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error("INQUIRY_COVERAGE_PROVIDER_ROWS_INVALID");
  }
  return value.length;
}

function standardStepRows(channel: ActiveChannelKey, data: Record<string, unknown>) {
  if (channel === "qoo10") {
    const result = data.ResultObject;
    return rows(result, record(result).InquiryInfo, record(result).InquiryMessage, record(result).ClaimInfo);
  }
  if (channel === "temu") {
    const result = record(data.result);
    if (Array.isArray(result.afterSalesList)) return 1;
    return rows(result.data);
  }
  if (channel === "ebay") return rows(data.conversationMessages, data.myMessages, data.memberMessages);
  if (channel === "shopee") {
    const response = record(data.response);
    if (record(data.sellerpilotProviderContext).kind === "return_refund") {
      if (!response.return_sn) return rows(response.return);
      return 1;
    }
    return rows(response.item_comment_list);
  }
  if (channel === "coupang") {
    const root = data.data;
    return rows(Array.isArray(root) ? root : undefined, record(root).content);
  }
  if (channel === "smartstore") {
    const root = Object.keys(record(data.data)).length ? record(data.data) : data;
    return rows(root.contents, root.content, Array.isArray(data.data) ? data.data : undefined);
  }
  if (channel === "elevenst") return rows(data.productQnas);
  throw new Error(`INQUIRY_COVERAGE_CHANNEL_UNSUPPORTED:${channel}`);
}

export type InquiryCoverageEvidence = {
  contractVersion: "sellerpilot-inquiry-coverage/1";
  providerRowCount: number;
  projectedEventCount: number;
  excludedCount: number;
  eventRowComparable: boolean;
  observationDigests: string[];
  hasContinuation: boolean;
};

export function inquiryCoverageEvidence(
  channel: ActiveChannelKey,
  result: ChannelOperationResult,
  inquiries: NormalizedChannelInquiry[],
): InquiryCoverageEvidence {
  if (!result.ok || result.operation !== "inquiries.list" || result.channel !== channel
      || result.steps.some(step => !step.ok)) {
    throw new Error("INQUIRY_COVERAGE_RESULT_INVALID");
  }
  const providerRowCount = channel === "lazada"
    ? result.steps.filter(step => step.name.startsWith("inquiries-message:")).reduce((count, step) => {
      const root = record(step.data.data);
      return count + rows(root.message_list, root.messages, step.data.message_list);
    }, 0)
    : result.steps.filter(step => /^inquiries(?::\d+)?$/.test(step.name)
      || channel === "qoo10" && ["GetInquiryMessage", "GetClaimInfo_V3"].includes(step.name))
      .reduce((count, step) => count + standardStepRows(channel, step.data), 0);
  const projectedEventCount = inquiries.length;
  const coupangAfterSales = channel === "coupang"
    && result.steps.every(step => ["return_request", "cancel_request", "exchange_request"]
      .includes(String(record(step.data).sellerpilotInquiryKind ?? "")));
  const oneEventPerProviderRow = ["qoo10", "temu", "ebay", "lazada"].includes(channel)
    || coupangAfterSales;
  const excludedCount = oneEventPerProviderRow && providerRowCount >= projectedEventCount
    ? providerRowCount - projectedEventCount
    : 0;
  return {
    contractVersion: "sellerpilot-inquiry-coverage/1",
    providerRowCount,
    projectedEventCount,
    excludedCount,
    eventRowComparable: oneEventPerProviderRow,
    observationDigests: inquiries.map(inquiry => createHash("sha256").update(inquiry.inboundKey).digest("hex")),
    hasContinuation: Boolean(result.continuation),
  };
}
