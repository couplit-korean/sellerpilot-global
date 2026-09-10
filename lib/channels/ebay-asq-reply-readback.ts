import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { ebayAsqMarketplaceId, type EbayAsqMarketplaceId } from "./ebay-asq";
import {
  ebayTradingRequest,
  ebayTradingXmlEscape,
  type SecretPayload,
} from "./protocols";

export const ebayAsqReplyReadbackContract =
  "sellerpilot-ebay-asq-reply-readback/1" as const;

export type EbayAsqReplyTarget = {
  marketplaceId: EbayAsqMarketplaceId;
  itemId: string;
  parentMessageId: string;
  recipientId: string;
  reply: string;
};

export type EbayAsqReplyBaseline = {
  contract: "sellerpilot-ebay-asq-reply-baseline/1";
  bindingDigest: string;
  replyBodyDigest: string;
  responses: readonly string[];
};

export type EbayAsqReplyReadback = {
  contract: typeof ebayAsqReplyReadbackContract;
  level: "provider_observed";
  bindingDigest: string;
  replyBodyDigest: string;
  baselineResponseCount: number;
  observedResponseCount: number;
  observedAt: string;
  providerAnswerId: null;
  providerAnswerOccurredAt: null;
  providerLimitations: readonly [
    "GetMemberMessages.Response has no per-answer ID",
    "GetMemberMessages.Response has no per-answer timestamp",
  ];
};

const preparedBaseline = new AsyncLocalStorage<Readonly<EbayAsqReplyBaseline>>();

function hasForbiddenControl(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 0x7f
      || (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d);
  });
}
function exactText(value: unknown, key: string, maxLength: number, pattern?: RegExp) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maxLength || hasForbiddenControl(text)
      || (pattern && !pattern.test(text))) {
    throw new Error(`CHANNEL_ARGUMENT_INVALID:${key}`);
  }
  return text;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function bindingDigest(target: EbayAsqReplyTarget) {
  return sha256(JSON.stringify({
    itemId: target.itemId,
    marketplaceId: target.marketplaceId,
    parentMessageId: target.parentMessageId,
    recipientId: target.recipientId,
  }));
}

export function ebayAsqReplyTarget(arguments_: Record<string, unknown>): EbayAsqReplyTarget {
  return {
    marketplaceId: ebayAsqMarketplaceId(arguments_.marketplaceId),
    itemId: exactText(arguments_.itemId, "itemId", 19, /^[1-9]\d{0,18}$/),
    parentMessageId: exactText(arguments_.parentMessageId, "parentMessageId", 230),
    recipientId: exactText(arguments_.recipientId, "recipientId", 240),
    reply: exactText(arguments_.reply, "reply", 2_000),
  };
}

function finiteProviderCount(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

async function readExactEbayAsqExchange(input: {
  payload: SecretPayload;
  environment: "sandbox" | "production";
  target: EbayAsqReplyTarget;
}) {
  const requestXml = `<?xml version="1.0" encoding="utf-8"?><GetMemberMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${ebayTradingXmlEscape(input.target.itemId)}</ItemID><MailMessageType>AskSellerQuestion</MailMessageType><MemberMessageID>${ebayTradingXmlEscape(input.target.parentMessageId)}</MemberMessageID><Pagination><EntriesPerPage>25</EntriesPerPage><PageNumber>1</PageNumber></Pagination><SenderID>${ebayTradingXmlEscape(input.target.recipientId)}</SenderID></GetMemberMessagesRequest>`;
  const remote = await ebayTradingRequest({
    payload: input.payload,
    environment: input.environment,
    callName: "GetMemberMessages",
    marketplaceId: input.target.marketplaceId,
    body: requestXml,
  });
  if (!remote.response.ok || remote.data.code !== "SUCCESS") {
    throw new Error("EBAY_ASQ_REPLY_READBACK_PROVIDER_ERROR");
  }

  const messages = Array.isArray(remote.data.memberMessages)
    ? remote.data.memberMessages
    : [];
  const pagination = remote.data.paginationResult;
  const paginationRecord = pagination && typeof pagination === "object" && !Array.isArray(pagination)
    ? pagination as Record<string, unknown>
    : {};
  const totalPages = finiteProviderCount(paginationRecord.totalNumberOfPages);
  const totalEntries = finiteProviderCount(paginationRecord.totalNumberOfEntries);
  if (messages.length !== 1
      || remote.data.hasMoreItems !== false
      || totalPages !== 1
      || totalEntries !== 1) {
    throw new Error("EBAY_ASQ_REPLY_READBACK_TARGET_AMBIGUOUS");
  }

  const message = messages[0];
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new Error("EBAY_ASQ_REPLY_READBACK_TARGET_AMBIGUOUS");
  }
  const row = message as Record<string, unknown>;
  if (row.itemId !== input.target.itemId
      || row.messageId !== input.target.parentMessageId
      || row.senderId !== input.target.recipientId) {
    throw new Error("EBAY_ASQ_REPLY_READBACK_TARGET_MISMATCH");
  }
  const responses = row.responses;
  if (!Array.isArray(responses)
      || responses.some((response) => typeof response !== "string")
      || (row.messageStatus !== "Answered" && row.messageStatus !== "Unanswered")) {
    throw new Error("EBAY_ASQ_REPLY_READBACK_RESPONSE_INVALID");
  }
  return {
    messageStatus: row.messageStatus,
    responses: responses as string[],
  };
}

export async function prepareEbayAsqReplyReadback(input: {
  payload: SecretPayload;
  arguments: Record<string, unknown>;
  environment: "sandbox" | "production";
}) {
  const target = ebayAsqReplyTarget(input.arguments);
  const snapshot = await readExactEbayAsqExchange({
    payload: input.payload,
    environment: input.environment,
    target,
  });
  return Object.freeze({
    contract: "sellerpilot-ebay-asq-reply-baseline/1" as const,
    bindingDigest: bindingDigest(target),
    replyBodyDigest: sha256(target.reply),
    responses: Object.freeze([...snapshot.responses]),
  });
}

export function runWithPreparedEbayAsqReplyReadback<T>(
  baseline: EbayAsqReplyBaseline,
  execute: () => Promise<T>,
) {
  return preparedBaseline.run(Object.freeze({
    ...baseline,
    responses: Object.freeze([...baseline.responses]),
  }), execute);
}

export function currentEbayAsqReplyBaseline(target: EbayAsqReplyTarget) {
  const baseline = preparedBaseline.getStore();
  if (!baseline) return null;
  if (baseline.contract !== "sellerpilot-ebay-asq-reply-baseline/1"
      || baseline.bindingDigest !== bindingDigest(target)
      || baseline.replyBodyDigest !== sha256(target.reply)) {
    throw new Error("EBAY_ASQ_REPLY_READBACK_BASELINE_MISMATCH");
  }
  return baseline;
}

function responseCounts(responses: readonly string[]) {
  const counts = new Map<string, number>();
  for (const response of responses) {
    counts.set(response, (counts.get(response) ?? 0) + 1);
  }
  return counts;
}

export async function observeEbayAsqReply(input: {
  payload: SecretPayload;
  environment: "sandbox" | "production";
  target: EbayAsqReplyTarget;
  baseline: Readonly<EbayAsqReplyBaseline>;
}): Promise<EbayAsqReplyReadback> {
  if (input.baseline.bindingDigest !== bindingDigest(input.target)
      || input.baseline.replyBodyDigest !== sha256(input.target.reply)) {
    throw new Error("EBAY_ASQ_REPLY_READBACK_BASELINE_MISMATCH");
  }
  const observed = await readExactEbayAsqExchange({
    payload: input.payload,
    environment: input.environment,
    target: input.target,
  });
  const before = responseCounts(input.baseline.responses);
  const after = responseCounts(observed.responses);
  const bodies = new Set([...before.keys(), ...after.keys()]);
  const exactDelta = [...bodies].every((body) =>
    (after.get(body) ?? 0) === (before.get(body) ?? 0) + (body === input.target.reply ? 1 : 0));
  if (observed.messageStatus !== "Answered"
      || observed.responses.length !== input.baseline.responses.length + 1
      || !exactDelta) {
    throw new Error("EBAY_ASQ_REPLY_READBACK_NOT_OBSERVED");
  }
  return {
    contract: ebayAsqReplyReadbackContract,
    level: "provider_observed",
    bindingDigest: input.baseline.bindingDigest,
    replyBodyDigest: input.baseline.replyBodyDigest,
    baselineResponseCount: input.baseline.responses.length,
    observedResponseCount: observed.responses.length,
    observedAt: new Date().toISOString(),
    providerAnswerId: null,
    providerAnswerOccurredAt: null,
    providerLimitations: [
      "GetMemberMessages.Response has no per-answer ID",
      "GetMemberMessages.Response has no per-answer timestamp",
    ],
  };
}
