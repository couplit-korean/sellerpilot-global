import { ebayTradingRequest, ebayTradingXmlEscape, type RemoteResponse, type SecretPayload } from "./protocols";
import { ebayAsqMarketplaceId, ebayAsqMarketplaceIdFromSiteCode, type EbayAsqMarketplaceId } from "./ebay-asq";
import { step, type ChannelOperationStep } from "./operation-step";
import { finiteCount, objectValue, stringArgument, integerArgument, objectArray } from "./operation-values";
import { replyAcceptanceMarker } from "./reply-verification";
import {
  ebayConversationMessageRole,
  ebayVerifiedMessageAccountIdentifiers,
  readEbayConversationMessagesPage,
  readEbayConversationsPage,
  sendEbayConversationMessage,
  type EbayConversationType,
} from "./ebay-message-pages";
import { executeEbayCaseDisputeGatewayPage } from "./cs/ebay/case-dispute-gateway";
import {
  currentEbayAsqReplyBaseline,
  ebayAsqReplyTarget,
  observeEbayAsqReply,
  prepareEbayAsqReplyReadback,
} from "./ebay-asq-reply-readback";

// CS owns native ASQ reading, exact listing-site verification and replies.
// Product registration and shipment operations do not enter this adapter.
type EbayInquiryInput = {
  operation: "inquiries.list" | "inquiries.reply";
  payload: SecretPayload;
  arguments: Record<string, unknown>;
  environment: "sandbox" | "production";
};
type EbayInquiryExecution = {
  steps: ChannelOperationStep[];
  remoteId?: string;
  continuationArguments?: Record<string, unknown>;
};

const EBAY_ASQ_ENTRIES_PER_PAGE = 25;
const EBAY_MAILBOX_ENTRIES_PER_PAGE = 25;
const EBAY_MAILBOX_DETAIL_BATCH = 10;

const EBAY_ASQ_GET_ITEM_CONCURRENCY = 4;

const EBAY_LISTING_SITE_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

const EBAY_LISTING_SITE_CACHE_MAX = 2_000;

const ebayListingSiteCache = new Map<string, { marketplaceId: EbayAsqMarketplaceId; expiresAt: number }>();
const EBAY_CONVERSATION_REPLY_READBACK_PAGE_CAP = 100;

function rememberEbayListingSite(cacheKey: string, marketplaceId: EbayAsqMarketplaceId, now = Date.now()) {
  if (ebayListingSiteCache.size >= EBAY_LISTING_SITE_CACHE_MAX) {
    const oldest = ebayListingSiteCache.keys().next().value;
    if (typeof oldest === "string") ebayListingSiteCache.delete(oldest);
  }
  ebayListingSiteCache.set(cacheKey, {
    marketplaceId,
    expiresAt: now + EBAY_LISTING_SITE_CACHE_TTL_MS,
  });
}

function cachedEbayListingSite(cacheKey: string, now: number) {
  const cached = ebayListingSiteCache.get(cacheKey);
  if (!cached) return undefined;
  if (cached.expiresAt <= now) {
    ebayListingSiteCache.delete(cacheKey);
    return undefined;
  }
  return cached.marketplaceId;
}

type EbayListingSiteResolution = {
  itemId: string;
  cacheKey: string;
  marketplaceId: EbayAsqMarketplaceId;
  cacheHit: boolean;
};

type EbayListingSiteFailure = {
  failure: ChannelOperationStep;
};

async function resolveEbayListingSites(
  input: EbayInquiryInput,
  requestMarketplaceId: EbayAsqMarketplaceId,
  itemIds: string[],
): Promise<{ resolutions: EbayListingSiteResolution[] } | EbayListingSiteFailure> {
  const lookupTime = Date.now();
  const lookups: Array<EbayListingSiteResolution | EbayListingSiteFailure | undefined> = new Array(itemIds.length);
  let nextIndex = 0;
  let stopScheduling = false;
  let requestThrew = false;
  let requestError: unknown;

  const worker = async () => {
    while (!stopScheduling && !requestThrew) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= itemIds.length) return;

      const itemId = itemIds[index];
      const cacheKey = `${input.environment}:${itemId}`;
      const cachedMarketplaceId = cachedEbayListingSite(cacheKey, lookupTime);
      if (cachedMarketplaceId) {
        lookups[index] = {
          itemId,
          cacheKey,
          marketplaceId: cachedMarketplaceId,
          cacheHit: true,
        };
        continue;
      }

      try {
        const itemXml = `<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${ebayTradingXmlEscape(itemId)}</ItemID><OutputSelector>ItemID</OutputSelector><OutputSelector>Site</OutputSelector></GetItemRequest>`;
        const itemRemote = await ebayTradingRequest({
          payload: input.payload,
          environment: input.environment,
          callName: "GetItem",
          marketplaceId: requestMarketplaceId,
          body: itemXml,
        });
        const itemStep = step("inquiry-listing-site-readback", itemRemote);
        const providerItem = objectValue(itemRemote.data, "item", false);
        const providerItemId = String(providerItem.itemId ?? "").trim();
        let exactMarketplaceId: EbayAsqMarketplaceId | undefined;
        try {
          exactMarketplaceId = ebayAsqMarketplaceIdFromSiteCode(providerItem.site);
        } catch {
          exactMarketplaceId = undefined;
        }
        if (!itemStep.ok || providerItemId !== itemId || !exactMarketplaceId) {
          lookups[index] = {
            failure: {
              name: "inquiry-listing-site-verification",
              ok: false,
              status: itemStep.status || 422,
              requestId: itemStep.requestId,
              data: { code: "EBAY_ASQ_LISTING_SITE_UNVERIFIED" },
            },
          };
          stopScheduling = true;
          return;
        }
        lookups[index] = {
          itemId,
          cacheKey,
          marketplaceId: exactMarketplaceId,
          cacheHit: false,
        };
      } catch (error) {
        if (!requestThrew) {
          requestThrew = true;
          requestError = error;
        }
        return;
      }
    }
  };

  const workerCount = Math.min(EBAY_ASQ_GET_ITEM_CONCURRENCY, itemIds.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (requestThrew) throw requestError;

  const failure = lookups.find((lookup): lookup is EbayListingSiteFailure => Boolean(lookup && "failure" in lookup));
  if (failure) return failure;
  const resolutions = lookups.filter((lookup): lookup is EbayListingSiteResolution => Boolean(lookup && "marketplaceId" in lookup));
  if (resolutions.length !== itemIds.length) throw new Error("EBAY_ASQ_LISTING_SITE_LOOKUP_INCOMPLETE");

  // Parallel response timing must not affect cache eviction order or expiry.
  // Commit only after the whole page is verified, in the provider message order.
  for (const resolution of resolutions) {
    if (!resolution.cacheHit) {
      rememberEbayListingSite(resolution.cacheKey, resolution.marketplaceId, lookupTime);
    }
  }
  return { resolutions };
}

function hasForbiddenEbayControl(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 0x7f
      || (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d);
  });
}

function ebayTradingTextArgument(
  source: Record<string, unknown>,
  key: string,
  options: { maxLength: number; pattern?: RegExp },
) {
  const value = stringArgument(source, key);
  if (value.length > options.maxLength
      || hasForbiddenEbayControl(value)
      || (options.pattern && !options.pattern.test(value))) {
    throw new Error(`CHANNEL_ARGUMENT_INVALID:${key}`);
  }
  return value;
}

function ebayTradingTimestampArgument(source: Record<string, unknown>, key: string) {
  const value = ebayTradingTextArgument(source, key, { maxLength: 80 });
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`CHANNEL_ARGUMENT_INVALID:${key}`);
  return new Date(timestamp).toISOString();
}

function ebayConversationTypeArgument(value: unknown): EbayConversationType {
  if (value === "FROM_MEMBERS" || value === "FROM_EBAY") return value;
  throw new Error("CHANNEL_ARGUMENT_INVALID:conversationType");
}

function ebayConversationQueueArgument(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10
      || value.some(item => typeof item !== "string" || !item || item.length > 240
        || item.trim() !== item || hasForbiddenEbayControl(item))
      || new Set(value).size !== value.length) {
    throw new Error("CHANNEL_ARGUMENT_INVALID:conversationQueue");
  }
  return value as string[];
}

async function verifyLatestEbayCustomerMessage(input: EbayInquiryInput, conversationId: string, expectedMessageId: string) {
  const identifiers = ebayVerifiedMessageAccountIdentifiers(input.payload);
  const messages = new Map<string, { createdAt: string; role: "customer" | "seller" | "system" | "unverified" }>();
  let offset = 0;
  let pages = 0;
  let complete = false;
  while (pages < EBAY_CONVERSATION_REPLY_READBACK_PAGE_CAP) {
    const page = await readEbayConversationMessagesPage({
      payload: input.payload,
      environment: input.environment,
      conversationId,
      type: "FROM_MEMBERS",
      offset,
    });
    pages += 1;
    for (const message of page.entries) {
      if (messages.has(message.messageId)) throw new Error("EBAY_MESSAGE_REPLY_READBACK_DUPLICATE");
      messages.set(message.messageId, {
        createdAt: message.createdAt,
        role: ebayConversationMessageRole(message, "FROM_MEMBERS", identifiers),
      });
    }
    if (page.nextOffset === null) {
      complete = true;
      break;
    }
    offset = page.nextOffset;
  }
  if (!complete) {
    throw new Error("EBAY_MESSAGE_REPLY_READBACK_LIMIT");
  }
  if ([...messages.values()].some(message => message.role === "unverified" || message.role === "system")) {
    throw new Error("EBAY_MESSAGE_REPLY_ACCOUNT_UNVERIFIED");
  }
  const ordered = [...messages].sort((left, right) => Date.parse(right[1].createdAt) - Date.parse(left[1].createdAt));
  const latest = ordered[0];
  if (!latest || latest[0] !== expectedMessageId || latest[1].role !== "customer") {
    throw new Error("EBAY_MESSAGE_REPLY_STALE");
  }
  if (ordered[1] && Date.parse(ordered[1][1].createdAt) === Date.parse(latest[1].createdAt)) {
    throw new Error("EBAY_MESSAGE_REPLY_ORDER_AMBIGUOUS");
  }
  return { pages, messageCount: messages.size, latestCustomerMessageId: latest[0] };
}

type EbayConversationBaseArguments = {
  kind: "conversation";
  conversationType: EbayConversationType;
  sellerpilotHistoryRunId?: string;
  startTime?: string;
  endTime?: string;
};

function ebayConversationBaseArguments(
  input: EbayInquiryInput,
  conversationType: EbayConversationType,
): EbayConversationBaseArguments {
  const historyRunId = typeof input.arguments.sellerpilotHistoryRunId === "string"
    ? input.arguments.sellerpilotHistoryRunId
    : undefined;
  if (conversationType === "FROM_EBAY") {
    if (input.arguments.startTime !== undefined || input.arguments.endTime !== undefined) {
      throw new Error("CHANNEL_ARGUMENT_INVALID:systemDateFilter");
    }
    return { kind: "conversation", conversationType, ...(historyRunId ? { sellerpilotHistoryRunId: historyRunId } : {}) };
  }
  const startTime = ebayTradingTimestampArgument(input.arguments, "startTime");
  const endTime = ebayTradingTimestampArgument(input.arguments, "endTime");
  if (Date.parse(startTime) >= Date.parse(endTime)
      || Date.parse(endTime) - Date.parse(startTime) > 31 * 86_400_000) {
    throw new Error("CHANNEL_ARGUMENT_INVALID:inquiryTimeRange");
  }
  return { kind: "conversation", conversationType, startTime, endTime,
    ...(historyRunId ? { sellerpilotHistoryRunId: historyRunId } : {}) };
}

export async function executeEbayInquiry(input: EbayInquiryInput): Promise<EbayInquiryExecution> {
  if (input.operation === "inquiries.list") {
    if (input.arguments.kind === "case_dispute_history") {
      return executeEbayCaseDisputeGatewayPage(input);
    }
    if (input.arguments.kind === "conversation") {
      const conversationType = ebayConversationTypeArgument(input.arguments.conversationType);
      const baseArguments = ebayConversationBaseArguments(input, conversationType);
      let conversationId = stringArgument(input.arguments, "conversationId", false);
      let conversationQueue = ebayConversationQueueArgument(input.arguments.conversationQueue);
      let nextConversationOffset = input.arguments.nextConversationOffset === undefined
        ? null
        : integerArgument(input.arguments, "nextConversationOffset", { min: 0, max: 10_000_000 });
      if (nextConversationOffset !== null && nextConversationOffset % 10 !== 0) {
        throw new Error("CHANNEL_ARGUMENT_INVALID:nextConversationOffset");
      }
      let discoveryStep: ChannelOperationStep | null = null;

      if (!conversationId) {
        if (conversationQueue.length || input.arguments.messageOffset !== undefined
            || input.arguments.nextConversationOffset !== undefined) {
          throw new Error("CHANNEL_ARGUMENT_INVALID:conversationContinuation");
        }
        const conversationOffset = integerArgument(input.arguments, "conversationOffset", { min: 0, max: 10_000_000 });
        const conversations = await readEbayConversationsPage({
          payload: input.payload,
          environment: input.environment,
          type: conversationType,
          offset: conversationOffset,
          ...(conversationType === "FROM_MEMBERS" ? {
            startTime: baseArguments.startTime,
            endTime: baseArguments.endTime,
          } : {}),
        });
        discoveryStep = {
          name: "inquiry-conversation-discovery",
          ok: true,
          status: 200,
          data: {
            conversationType,
            offset: conversations.offset,
            pageCount: conversations.entries.length,
            total: conversations.total,
          },
        };
        if (!conversations.entries.length) {
          const steps = [discoveryStep, {
            name: "inquiries",
            ok: true,
            status: 200,
            data: { conversationMessages: [] },
          }];
          return conversations.nextOffset === null
            ? { steps }
            : { steps, continuationArguments: { ...baseArguments, conversationOffset: conversations.nextOffset } };
        }
        [conversationId, ...conversationQueue] = conversations.entries.map(entry => entry.conversationId);
        nextConversationOffset = conversations.nextOffset;
      } else if (input.arguments.conversationOffset !== undefined) {
        throw new Error("CHANNEL_ARGUMENT_INVALID:conversationContinuation");
      }

      if (conversationQueue.includes(conversationId)) {
        throw new Error("CHANNEL_ARGUMENT_INVALID:conversationContinuation");
      }
      const messageOffset = integerArgument({ messageOffset: input.arguments.messageOffset ?? 0 }, "messageOffset", { min: 0, max: 10_000_000 });
      const messages = await readEbayConversationMessagesPage({
        payload: input.payload,
        environment: input.environment,
        conversationId,
        type: conversationType,
        offset: messageOffset,
      });
      const identifiers = ebayVerifiedMessageAccountIdentifiers(input.payload);
      const rows = messages.entries.map(message => ({
        ...message,
        conversationId,
        conversationType,
        conversationStatus: messages.status,
        conversationTitle: messages.title,
        role: ebayConversationMessageRole(message, conversationType, identifiers),
      }));
      if (rows.some(row => row.role === "unverified")) {
        return { steps: [...(discoveryStep ? [discoveryStep] : []), {
          name: "inquiry-conversation-account-binding",
          ok: false,
          status: 409,
          data: { code: "EBAY_MESSAGE_ACCOUNT_IDENTITY_UNVERIFIED" },
        }] };
      }
      const steps: ChannelOperationStep[] = [...(discoveryStep ? [discoveryStep] : []), {
        name: "inquiries",
        ok: true,
        status: 200,
        data: { conversationMessages: rows },
      }];
      if (messages.nextOffset !== null) return { steps, continuationArguments: {
        ...baseArguments,
        conversationId,
        conversationQueue,
        messageOffset: messages.nextOffset,
        ...(nextConversationOffset !== null ? { nextConversationOffset } : {}),
      } };
      if (conversationQueue.length) return { steps, continuationArguments: {
        ...baseArguments,
        conversationId: conversationQueue[0],
        conversationQueue: conversationQueue.slice(1),
        messageOffset: 0,
        ...(nextConversationOffset !== null ? { nextConversationOffset } : {}),
      } };
      if (nextConversationOffset !== null) return { steps, continuationArguments: {
        ...baseArguments,
        conversationOffset: nextConversationOffset,
      } };
      return { steps };
    }
    const marketplaceId = ebayAsqMarketplaceId(input.arguments.marketplaceId);
    if (input.arguments.kind === "mailbox") {
      const startTime = ebayTradingTimestampArgument(input.arguments, "startTime");
      const endTime = ebayTradingTimestampArgument(input.arguments, "endTime");
      const startTimestamp = Date.parse(startTime);
      const endTimestamp = Date.parse(endTime);
      if (startTimestamp >= endTimestamp || endTimestamp - startTimestamp > 31 * 86_400_000) {
        throw new Error("CHANNEL_ARGUMENT_INVALID:inquiryTimeRange");
      }
      const folderId = integerArgument(input.arguments, "folderId", { min: 0, max: 0 });
      const requestedEntriesPerPage = integerArgument(input.arguments, "entriesPerPage", { min: 25, max: 25 });
      const pageNumber = integerArgument(input.arguments, "pageNumber", { min: 1, max: 1_000_000 });
      if (folderId !== 0 || requestedEntriesPerPage !== EBAY_MAILBOX_ENTRIES_PER_PAGE) {
        throw new Error("CHANNEL_ARGUMENT_INVALID:mailboxPage");
      }

      // eBay recommends a header page followed by ReturnMessages calls of at
      // most ten IDs. This keeps pagination bounded while retaining message
      // bodies and merges header-only listing identity into the detail record.
      const headerXml = `<?xml version="1.0" encoding="utf-8"?><GetMyMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents"><DetailLevel>ReturnHeaders</DetailLevel><FolderID>${folderId}</FolderID><StartTime>${ebayTradingXmlEscape(startTime)}</StartTime><EndTime>${ebayTradingXmlEscape(endTime)}</EndTime><Pagination><EntriesPerPage>${EBAY_MAILBOX_ENTRIES_PER_PAGE}</EntriesPerPage><PageNumber>${pageNumber}</PageNumber></Pagination></GetMyMessagesRequest>`;
      const headerRemote = await ebayTradingRequest({
        payload: input.payload,
        environment: input.environment,
        callName: "GetMyMessages",
        marketplaceId,
        body: headerXml,
      });
      const headerStep = step("inquiries", headerRemote);
      if (!headerStep.ok) return { steps: [headerStep] };
      const headers = objectArray(headerRemote.data.myMessages);
      const headerIds = headers.map((message) => String(message.messageId ?? "").trim());
      if (headerIds.some((messageId) => !messageId || messageId.length > 240)
          || new Set(headerIds).size !== headerIds.length) {
        return { steps: [{
          name: "inquiry-mailbox-identity",
          ok: false,
          status: 422,
          data: { code: "EBAY_MAILBOX_MESSAGE_ID_INVALID" },
        }] };
      }

      const details = new Map<string, Record<string, unknown>>();
      const detailSteps: ChannelOperationStep[] = [];
      for (let offset = 0; offset < headerIds.length; offset += EBAY_MAILBOX_DETAIL_BATCH) {
        const messageIds = headerIds.slice(offset, offset + EBAY_MAILBOX_DETAIL_BATCH);
        const detailXml = `<?xml version="1.0" encoding="utf-8"?><GetMyMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents"><DetailLevel>ReturnMessages</DetailLevel><MessageIDs>${messageIds.map((messageId) => `<MessageID>${ebayTradingXmlEscape(messageId)}</MessageID>`).join("")}</MessageIDs></GetMyMessagesRequest>`;
        const detailRemote = await ebayTradingRequest({
          payload: input.payload,
          environment: input.environment,
          callName: "GetMyMessages",
          marketplaceId,
          body: detailXml,
        });
        const detailStep = step(`inquiry-mailbox-detail:${offset / EBAY_MAILBOX_DETAIL_BATCH + 1}`, detailRemote);
        detailSteps.push(detailStep);
        if (!detailStep.ok) return { steps: [headerStep, ...detailSteps] };
        const batchDetails = objectArray(detailRemote.data.myMessages);
        for (const detail of batchDetails) {
          const messageId = String(detail.messageId ?? "").trim();
          if (!messageIds.includes(messageId) || details.has(messageId)) {
            return { steps: [headerStep, ...detailSteps, {
              name: "inquiry-mailbox-detail-identity",
              ok: false,
              status: 409,
              data: { code: "EBAY_MAILBOX_DETAIL_ID_MISMATCH" },
            }] };
          }
          details.set(messageId, detail);
        }
        if (batchDetails.length !== messageIds.length) {
          return { steps: [headerStep, ...detailSteps, {
            name: "inquiry-mailbox-detail-completeness",
            ok: false,
            status: 409,
            data: { code: "EBAY_MAILBOX_DETAIL_MISSING" },
          }] };
        }
      }

      const pagination = objectValue(headerRemote.data, "paginationResult", false);
      const totalPages = finiteCount(pagination.totalNumberOfPages);
      const totalEntries = finiteCount(pagination.totalNumberOfEntries);
      const paginationInvalid = totalPages === 0 && headers.length > 0
        || totalEntries === 0 && headers.length > 0
        || totalEntries !== null && totalEntries < headers.length
        || totalPages !== null && totalPages > 0 && pageNumber > totalPages
        || headers.length > EBAY_MAILBOX_ENTRIES_PER_PAGE;
      if (paginationInvalid) {
        return { steps: [headerStep, ...detailSteps, {
          name: "inquiry-mailbox-pagination-consistency",
          ok: false,
          status: 409,
          data: { code: "EBAY_MAILBOX_PAGINATION_INCONSISTENT" },
        }] };
      }
      const combinedRemote: RemoteResponse = {
        ...headerRemote,
        data: {
          ...headerRemote.data,
          myMessages: headers.map((header, index) => ({
            ...header,
            ...(details.get(headerIds[index]) ?? {}),
            itemId: String(details.get(headerIds[index])?.itemId ?? "").trim()
              || String(header.itemId ?? "").trim(),
            itemTitle: String(details.get(headerIds[index])?.itemTitle ?? "").trim()
              || String(header.itemTitle ?? "").trim(),
            content: String(details.get(headerIds[index])?.content ?? "")
              || String(header.content ?? ""),
            mailboxFolderId: folderId,
            marketplaceId,
          })),
        },
      };
      const steps = [step("inquiries", combinedRemote), ...detailSteps];
      const shouldContinue = totalPages !== null
        ? pageNumber < totalPages
        : headers.length === EBAY_MAILBOX_ENTRIES_PER_PAGE;
      // Missing totals stay null/unknown. A full page is followed until a short
      // terminal page proves the end; an empty page before a known later page
      // is not treated as completion.
      if (!shouldContinue) return { steps };
      return { steps, continuationArguments: {
        ...input.arguments,
        pageNumber: pageNumber + 1,
        entriesPerPage: EBAY_MAILBOX_ENTRIES_PER_PAGE,
        folderId,
      } };
    }
    const startCreationTime = ebayTradingTimestampArgument(input.arguments, "startCreationTime");
    const endCreationTime = ebayTradingTimestampArgument(input.arguments, "endCreationTime");
    const startTimestamp = Date.parse(startCreationTime);
    const endTimestamp = Date.parse(endCreationTime);
    if (startTimestamp >= endTimestamp || endTimestamp - startTimestamp > 31 * 86_400_000) {
      throw new Error("CHANNEL_ARGUMENT_INVALID:inquiryTimeRange");
    }
    const requestedEntriesPerPage = integerArgument(input.arguments, "entriesPerPage", { min: 25, max: 200 });
    if (![25, 50, 100, 200].includes(requestedEntriesPerPage)) {
      throw new Error("CHANNEL_ARGUMENT_INVALID:entriesPerPage");
    }
    // A 25-message page is the smallest provider-supported size. One provider
    // page per gateway job keeps the read inside the serverless budget; the
    // next page is continued atomically by the gateway completion transaction.
    const entriesPerPage = EBAY_ASQ_ENTRIES_PER_PAGE;
    const pageNumber = integerArgument(input.arguments, "pageNumber", { min: 1, max: 1_000_000 });
    const requestXml = `<?xml version="1.0" encoding="utf-8"?><GetMemberMessagesRequest xmlns="urn:ebay:apis:eBLBaseComponents"><MailMessageType>AskSellerQuestion</MailMessageType><StartCreationTime>${ebayTradingXmlEscape(startCreationTime)}</StartCreationTime><EndCreationTime>${ebayTradingXmlEscape(endCreationTime)}</EndCreationTime><Pagination><EntriesPerPage>${entriesPerPage}</EntriesPerPage><PageNumber>${pageNumber}</PageNumber></Pagination></GetMemberMessagesRequest>`;
    const remote = await ebayTradingRequest({
      payload: input.payload,
      environment: input.environment,
      callName: "GetMemberMessages",
      marketplaceId,
      body: requestXml,
    });
    const providerInquiryStep = step("inquiries", remote);
    if (!providerInquiryStep.ok) return { steps: [providerInquiryStep] };

    const messages = objectArray(remote.data.memberMessages);
    const itemIds = messages.map((message) => String(message.itemId ?? "").trim());
    if (itemIds.some((itemId) => !/^[1-9]\d{0,18}$/.test(itemId))) {
      return { steps: [{
        name: "inquiry-listing-site-verification",
        ok: false,
        status: 422,
        data: { code: "EBAY_ASQ_ITEM_ID_UNVERIFIED" },
      }] };
    }

    const uniqueItemIds = [...new Set(itemIds)];
    const siteLookup = await resolveEbayListingSites(input, marketplaceId, uniqueItemIds);
    if ("failure" in siteLookup) return { steps: [siteLookup.failure] };
    const pageSites = new Map(siteLookup.resolutions.map((resolution) => [resolution.itemId, resolution.marketplaceId]));
    const exactMessages = messages.map((message, index) => {
      const exactMarketplaceId = pageSites.get(itemIds[index]);
      if (!exactMarketplaceId) throw new Error("EBAY_ASQ_LISTING_SITE_LOOKUP_INCOMPLETE");
      return { ...message, marketplaceId: exactMarketplaceId };
    });
    const exactPageRemote = {
      ...remote,
      data: { ...remote.data, memberMessages: exactMessages },
    } satisfies RemoteResponse;
    const steps: ChannelOperationStep[] = [
      step("inquiries", exactPageRemote),
      {
        name: "inquiry-listing-sites:1",
        ok: true,
        status: 200,
        data: {
          verifiedItemCount: uniqueItemIds.length,
          sellerpilotVerification: "EBAY_ASQ_LISTING_SITES_VERIFIED",
        },
      },
    ];
    const pagination = objectValue(remote.data, "paginationResult", false);
    const totalPages = finiteCount(pagination.totalNumberOfPages);
    const totalEntries = finiteCount(pagination.totalNumberOfEntries);
    const providerHasMore = remote.data.hasMoreItems;
    const paginationInvalid = providerHasMore !== null && typeof providerHasMore !== "boolean"
      || totalPages === 0 && messages.length > 0
      || totalPages !== null && totalPages > 0 && pageNumber > totalPages
      || totalEntries === 0 && messages.length > 0
      || totalEntries !== null && totalEntries < messages.length
      || providerHasMore === true && totalPages !== null && pageNumber >= totalPages
      || providerHasMore === false && totalPages !== null && pageNumber < totalPages;
    if (paginationInvalid) {
      return { steps: [...steps, {
        name: "inquiry-pagination-consistency",
        ok: false,
        status: 409,
        data: {
          code: "EBAY_ASQ_PAGINATION_INCONSISTENT",
          sellerpilotVerification: "HISTORY_STOPPED_WITH_REMAINDER",
        },
      }] };
    }
    const hasMore = providerHasMore === true
      || (totalPages !== null && pageNumber < totalPages)
      || (providerHasMore === null && totalPages === null && messages.length === entriesPerPage);
    if (!hasMore) return { steps };
    return { steps, continuationArguments: {
      ...input.arguments,
      pageNumber: pageNumber + 1,
      entriesPerPage,
    } };
  }

  if (input.operation === "inquiries.reply") {
    if (input.arguments.kind === "conversation") {
      const conversationType = ebayConversationTypeArgument(input.arguments.conversationType);
      if (conversationType !== "FROM_MEMBERS") throw new Error("CHANNEL_ARGUMENT_INVALID:conversationType");
      const conversationId = ebayTradingTextArgument(input.arguments, "conversationId", { maxLength: 240 });
      const messageId = ebayTradingTextArgument(input.arguments, "messageId", { maxLength: 240 });
      const reply = ebayTradingTextArgument(input.arguments, "reply", { maxLength: 4_000 });
      const readback = await verifyLatestEbayCustomerMessage(input, conversationId, messageId);
      const sent = await sendEbayConversationMessage({
        payload: input.payload,
        environment: input.environment,
        conversationId,
        messageText: reply,
      });
      const replyStep = step("inquiry-reply", sent.remote);
      replyStep.data = {
        providerMessageId: sent.messageId,
        createdAt: sent.createdAt,
        sellerpilotReplyReadback: readback,
        sellerpilotReplyAcceptance: replyAcceptanceMarker(
          "ebay", "conversation", { conversationId, conversationType, messageId },
        ),
      };
      return { steps: [replyStep], remoteId: sent.messageId };
    }
    const target = ebayAsqReplyTarget(input.arguments);
    const { marketplaceId, itemId, parentMessageId, recipientId, reply } = target;
    const baseline = currentEbayAsqReplyBaseline(target)
      ?? await prepareEbayAsqReplyReadback({
        payload: input.payload,
        arguments: input.arguments,
        environment: input.environment,
      });
    const requestXml = `<?xml version="1.0" encoding="utf-8"?><AddMemberMessageRTQRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${ebayTradingXmlEscape(itemId)}</ItemID><MemberMessage><Body>${ebayTradingXmlEscape(reply)}</Body><DisplayToPublic>false</DisplayToPublic><ParentMessageID>${ebayTradingXmlEscape(parentMessageId)}</ParentMessageID><RecipientID>${ebayTradingXmlEscape(recipientId)}</RecipientID></MemberMessage></AddMemberMessageRTQRequest>`;
    const remote = await ebayTradingRequest({
      payload: input.payload,
      environment: input.environment,
      callName: "AddMemberMessageRTQ",
      marketplaceId,
      body: requestXml,
    });
    const replyStep = step("inquiry-reply", remote);
    if (replyStep.ok) {
      const readback = await observeEbayAsqReply({
        payload: input.payload,
        environment: input.environment,
        target,
        baseline,
      });
      replyStep.data = {
        ...replyStep.data,
        sellerpilotReplyReadback: readback,
        sellerpilotReplyAcceptance: replyAcceptanceMarker(
          "ebay", "asq", { marketplaceId, itemId, parentMessageId, recipientId },
        ),
      };
    }
    return { steps: [replyStep], remoteId: parentMessageId };
  }

  throw new Error("EBAY_INQUIRY_OPERATION_REQUIRED");
}
