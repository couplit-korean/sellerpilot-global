import { createHash } from "node:crypto";
import type { ActiveChannelKey } from "./catalog.ts";
import type { NormalizedChannelInquiry } from "../cs/operations/inquiry-contracts";
import type { CsOperationResult as ChannelOperationResult } from "../cs/operations/contracts";

export const replyAcceptanceContract = "sellerpilot-reply-acceptance/1" as const;
export const replyObservationContract = "sellerpilot-reply-observation/1" as const;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function replyAcceptanceMarker(
  channel: ActiveChannelKey,
  kind: string,
  binding: Record<string, unknown>,
) {
  return {
    contract: replyAcceptanceContract,
    level: "provider_accepted" as const,
    channel,
    kind,
    bindingDigest: sha256(canonical(binding)),
  };
}

export function hasProviderReplyAcceptance(result: ChannelOperationResult) {
  if (result.operation !== "inquiries.reply" || !result.ok || result.steps.length !== 1) return false;
  const marker = result.steps[0]?.data?.sellerpilotReplyAcceptance;
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) return false;
  const value = marker as Record<string, unknown>;
  return value.contract === replyAcceptanceContract
    && value.level === "provider_accepted"
    && value.channel === result.channel
    && typeof value.kind === "string"
    && /^[a-z0-9:_-]{1,80}$/.test(value.kind)
    && typeof value.bindingDigest === "string"
    && /^[a-f0-9]{64}$/.test(value.bindingDigest);
}

export type InquiryReplyObservation = {
  contract: typeof replyObservationContract;
  externalTicketId: string;
  inboundKey: string;
  remoteMessageId: string;
  occurredAt: string;
  body: string;
  replyFingerprint: string;
  binding: Record<string, unknown>;
};

function observationBinding(channel: ActiveChannelKey, inquiry: NormalizedChannelInquiry) {
  const context = { ...(inquiry.providerContext ?? {}), ...(inquiry.replyContext ?? {}) };
  if (channel === "lazada") return {
    ...context,
    sessionId: inquiry.externalTicketId.startsWith("lazada-im:")
      ? inquiry.externalTicketId.slice("lazada-im:".length)
      : "",
  };
  if (channel === "qoo10") {
    const match = /^qoo10:(MSG|HELP|ITEM):(\d+):(\d+)$/i.exec(inquiry.externalTicketId);
    return { ...context, ...(match ? {
      inquiryType: match[1].toUpperCase(), questionNo: match[2], sequenceNo: match[3],
    } : {}) };
  }
  if (channel === "coupang") {
    const separator = inquiry.externalTicketId.indexOf(":");
    return { ...context,
      kind: separator > 0 ? inquiry.externalTicketId.slice(0, separator) : context.kind,
      inquiryId: separator > 0 ? inquiry.externalTicketId.slice(separator + 1) : context.inquiryId,
    };
  }
  if (channel === "smartstore") {
    return inquiry.externalTicketId.startsWith("customer:")
      ? { ...context, kind: "customer", inquiryNo: inquiry.externalTicketId.slice("customer:".length) }
      : { ...context, kind: "product", questionId: inquiry.externalTicketId.replace(/^smartstore:product-qna:/, "") };
  }
  if (channel === "elevenst") {
    const match = /^elevenst:([1-9]\d{0,19})$/u.exec(inquiry.externalTicketId);
    return {
      ...context,
      brdInfoNo: match?.[1] ?? context.brdInfoNo,
      prdNo: context.prdNo,
    };
  }
  return context;
}

export function inquiryReplyObservations(
  channel: ActiveChannelKey,
  inquiries: NormalizedChannelInquiry[],
): InquiryReplyObservation[] {
  return inquiries.filter((inquiry) => inquiry.senderRole === "seller"
    && Boolean(inquiry.receivedAt)
    && Boolean(inquiry.remoteMessageId)).map((inquiry) => ({
      contract: replyObservationContract,
      externalTicketId: inquiry.externalTicketId,
      inboundKey: inquiry.inboundKey,
      remoteMessageId: inquiry.remoteMessageId!,
      occurredAt: new Date(inquiry.receivedAt).toISOString(),
      body: inquiry.message,
      replyFingerprint: sha256(inquiry.message.trim()),
      binding: observationBinding(channel, inquiry),
    })).filter((observation) => observation.body.length >= 1
      && observation.body.length <= 20_000
      && observation.externalTicketId.length <= 240
      && observation.remoteMessageId.length <= 240
      && observation.inboundKey.startsWith(`${channel}:`)
      && Buffer.byteLength(JSON.stringify(observation.binding), "utf8") <= 64_000);
}
