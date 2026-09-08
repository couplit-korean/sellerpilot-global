import { shopeeRequest, textValue, type SecretPayload } from "./protocols";
import { step, type ChannelOperationStep } from "./operation-step";
import { integerArgument, stringArgument } from "./operation-values";
import { MAX_PROVIDER_SYNC_PAGES } from "./operation-pagination";
import { replyAcceptanceMarker } from "./reply-verification";

type ShopeeInquiryInput = {
  operation: "inquiries.list" | "inquiries.reply";
  payload: SecretPayload;
  arguments: Record<string, unknown>;
  environment: "sandbox" | "production";
};

type ShopeeInquiryExecution = {
  steps: ChannelOperationStep[];
  remoteId?: string;
  continuationArguments?: Record<string, unknown>;
};

const SHOPEE_COMMENT_PAGE_SIZE = 100;
const SHOPEE_RETURN_PAGE_SIZE = 100;
const SHOPEE_RETURN_DETAILS_PER_JOB = 10;
// Keep every completion transaction below the 500-row/1 MB inquiry-ingest
// fence. The next cursor is committed by the same gateway completion that
// stores these pages, so a timeout does not force the shop back to page one.
const SHOPEE_COMMENT_PAGES_PER_JOB = 4;

function responseRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SHOPEE_COMMENT_RESPONSE_INVALID");
  }
  return value as Record<string, unknown>;
}

function booleanValue(value: unknown) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error("SHOPEE_COMMENT_MORE_INVALID");
}

function shopeeCommentPage(remoteData: Record<string, unknown>, pageSize: number) {
  const response = responseRecord(remoteData.response);
  const rows = response.item_comment_list;
  if (!Array.isArray(rows) || rows.length > pageSize || rows.some((row) =>
    !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("SHOPEE_COMMENT_PAGE_INVALID");
  }
  const more = booleanValue(response.more);
  const nextCursor = typeof response.next_cursor === "string" ? response.next_cursor.trim() : "";
  if (more && (!rows.length || !nextCursor)) throw new Error("SHOPEE_COMMENT_CURSOR_INVALID");
  if (!more && nextCursor) throw new Error("SHOPEE_COMMENT_CURSOR_INVALID");
  return { rows, more, nextCursor };
}

function exactShopId(payload: SecretPayload) {
  const shopId = textValue(payload, "shop_id");
  if (!/^[1-9]\d{0,31}$/.test(shopId)) throw new Error("SHOPEE_COMMENT_SHOP_ID_INVALID");
  return shopId;
}

function shopeeReturnSerial(value: unknown) {
  const serial = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(serial)) {
    throw new Error("SHOPEE_RETURN_SERIAL_INVALID");
  }
  return serial;
}

function shopeeReturnQueue(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > SHOPEE_RETURN_PAGE_SIZE) {
    throw new Error("SHOPEE_RETURN_QUEUE_INVALID");
  }
  const queue = value.map(shopeeReturnSerial);
  if (new Set(queue).size !== queue.length) throw new Error("SHOPEE_RETURN_QUEUE_INVALID");
  return queue;
}

function shopeeReturnListPage(remoteData: Record<string, unknown>, pageSize: number) {
  const response = responseRecord(remoteData.response);
  const rows = response.return;
  if (!Array.isArray(rows) || rows.length > pageSize || rows.some((row) =>
    !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("SHOPEE_RETURN_PAGE_INVALID");
  }
  const returnSerials = rows.map((row) => shopeeReturnSerial((row as Record<string, unknown>).return_sn));
  if (new Set(returnSerials).size !== returnSerials.length) throw new Error("SHOPEE_RETURN_PAGE_INVALID");
  const more = booleanValue(response.more);
  if (more && rows.length === 0) throw new Error("SHOPEE_RETURN_PAGINATION_INVALID");
  return { returnSerials, more };
}

function shopeeReturnWindow(argumentsValue: Record<string, unknown>) {
  const createTimeFrom = integerArgument(argumentsValue, "createTimeFrom", { min: 1, max: 9_999_999_999 });
  const createTimeTo = integerArgument(argumentsValue, "createTimeTo", { min: 1, max: 9_999_999_999 });
  if (createTimeFrom >= createTimeTo || createTimeTo - createTimeFrom > 15 * 86_400) {
    throw new Error("SHOPEE_RETURN_WINDOW_INVALID");
  }
  return { createTimeFrom, createTimeTo };
}

export async function executeShopeeInquiry(input: ShopeeInquiryInput): Promise<ShopeeInquiryExecution> {
  const shopId = exactShopId(input.payload);
  if (input.operation === "inquiries.list") {
    const kind = input.arguments.kind === undefined
      ? "product_review"
      : stringArgument(input.arguments, "kind");
    if (kind === "return_refund") {
      const { createTimeFrom, createTimeTo } = shopeeReturnWindow(input.arguments);
      const pageNo = input.arguments.pageNo === undefined
        ? 1
        : integerArgument(input.arguments, "pageNo", { min: 1, max: 1_000_000 });
      const pageSize = input.arguments.pageSize === undefined
        ? SHOPEE_RETURN_PAGE_SIZE
        : integerArgument(input.arguments, "pageSize", { min: 1, max: SHOPEE_RETURN_PAGE_SIZE });
      let returnQueue = shopeeReturnQueue(input.arguments.returnQueue);
      let nextPageNo = input.arguments.nextPageNo === undefined
        ? null
        : integerArgument(input.arguments, "nextPageNo", { min: 2, max: 1_000_001 });
      const steps: ChannelOperationStep[] = [];

      if (returnQueue.length === 0) {
        if (nextPageNo !== null) throw new Error("SHOPEE_RETURN_CONTINUATION_INVALID");
        const listRemote = await shopeeRequest({
          payload: input.payload,
          environment: input.environment,
          method: "GET",
          path: "/api/v2/returns/get_return_list",
          query: new URLSearchParams({
            page_no: String(pageNo),
            page_size: String(pageSize),
            create_time_from: String(createTimeFrom),
            create_time_to: String(createTimeTo),
          }),
        });
        listRemote.data = {
          ...listRemote.data,
          sellerpilotProviderContext: { shopId, kind: "return_refund" },
        };
        const discovery = step("return-list-discovery", listRemote);
        steps.push(discovery);
        if (!discovery.ok) return { steps };
        const page = shopeeReturnListPage(listRemote.data, pageSize);
        returnQueue = page.returnSerials;
        nextPageNo = page.more ? pageNo + 1 : null;
        if (returnQueue.length === 0) {
          discovery.name = "inquiries";
          return { steps };
        }
      }

      const selected = returnQueue.slice(0, SHOPEE_RETURN_DETAILS_PER_JOB);
      for (const returnSn of selected) {
        const detailRemote = await shopeeRequest({
          payload: input.payload,
          environment: input.environment,
          method: "GET",
          path: "/api/v2/returns/get_return_detail",
          query: new URLSearchParams({ return_sn: returnSn }),
        });
        detailRemote.data = {
          ...detailRemote.data,
          sellerpilotProviderContext: { shopId, kind: "return_refund", returnSn },
        };
        const detailStep = step(steps.some((item) => /^inquiries(?::\d+)?$/.test(item.name))
          ? `inquiries:${steps.filter((item) => /^inquiries(?::\d+)?$/.test(item.name)).length + 1}`
          : "inquiries", detailRemote);
        steps.push(detailStep);
        if (!detailStep.ok) return { steps };
        const detail = responseRecord(detailRemote.data.response);
        if (shopeeReturnSerial(detail.return_sn) !== returnSn) {
          throw new Error("SHOPEE_RETURN_DETAIL_MISMATCH");
        }
      }

      const remaining = returnQueue.slice(selected.length);
      if (remaining.length || nextPageNo !== null) {
        return {
          steps,
          continuationArguments: {
            kind: "return_refund",
            createTimeFrom,
            createTimeTo,
            pageNo: nextPageNo ?? pageNo,
            pageSize,
            ...(remaining.length ? {
              returnQueue: remaining,
              ...(nextPageNo !== null ? { nextPageNo } : {}),
            } : {}),
          },
        };
      }
      return { steps };
    }
    if (kind !== "product_review") throw new Error("CHANNEL_ARGUMENT_INVALID:kind");
    const pageSize = input.arguments.pageSize === undefined
      ? SHOPEE_COMMENT_PAGE_SIZE
      : integerArgument(input.arguments, "pageSize", { min: 1, max: SHOPEE_COMMENT_PAGE_SIZE });
    let cursor = typeof input.arguments.cursor === "string" ? input.arguments.cursor.trim() : "";
    if (cursor.length > 500) throw new Error("CHANNEL_ARGUMENT_INVALID:cursor");
    const seen = new Set<string>();
    const steps: ChannelOperationStep[] = [];
    const pagesPerJob = Math.min(SHOPEE_COMMENT_PAGES_PER_JOB, MAX_PROVIDER_SYNC_PAGES);
    for (let pageIndex = 0; pageIndex < pagesPerJob; pageIndex += 1) {
      const query = new URLSearchParams({ cursor, page_size: String(pageSize) });
      const itemId = input.arguments.itemId === undefined
        ? ""
        : stringArgument(input.arguments, "itemId");
      const commentId = input.arguments.commentId === undefined
        ? ""
        : stringArgument(input.arguments, "commentId");
      if (itemId) query.set("item_id", itemId);
      if (commentId) query.set("comment_id", commentId);
      const remote = await shopeeRequest({
        payload: input.payload,
        environment: input.environment,
        method: "GET",
        path: "/api/v2/product/get_comment",
        query,
      });
      remote.data = {
        ...remote.data,
        sellerpilotProviderContext: { shopId },
      };
      const pageStep = step(pageIndex === 0 ? "inquiries" : `inquiries:${pageIndex + 1}`, remote);
      steps.push(pageStep);
      if (!pageStep.ok) return { steps };
      const page = shopeeCommentPage(remote.data, pageSize);
      if (!page.more) return { steps };
      if (page.nextCursor === cursor || seen.has(page.nextCursor)) {
        throw new Error("SHOPEE_COMMENT_CURSOR_REPEATED");
      }
      seen.add(page.nextCursor);
      cursor = page.nextCursor;
      if (pageIndex === pagesPerJob - 1) {
        return {
          steps,
          continuationArguments: {
            ...input.arguments,
            kind: "product_review",
            cursor,
            pageSize,
          },
        };
      }
    }
    throw new Error("SHOPEE_COMMENT_PAGE_LOOP_UNREACHABLE");
  }

  const targetShopId = stringArgument(input.arguments, "shopId");
  const commentId = stringArgument(input.arguments, "commentId");
  const itemId = stringArgument(input.arguments, "itemId");
  const reply = stringArgument(input.arguments, "reply");
  const numericCommentId = Number(commentId);
  if (!/^[1-9]\d{0,31}$/.test(targetShopId)
      || targetShopId !== shopId
      || !/^[1-9]\d{0,18}$/.test(commentId)
      || !Number.isSafeInteger(numericCommentId)
      || !/^[1-9]\d{0,18}$/.test(itemId)
      || reply.length > 500) {
    throw new Error("SHOPEE_COMMENT_REPLY_INVALID");
  }
  const remote = await shopeeRequest({
    payload: input.payload,
    environment: input.environment,
    method: "POST",
    path: "/api/v2/product/reply_comment",
    body: { comment_list: [{ comment_id: numericCommentId, comment: reply }] },
  });
  const replyStep = step("inquiry-reply", remote);
  if (replyStep.ok) {
    const response = responseRecord(remote.data.response);
    const rows = response.result_list;
    replyStep.ok = Array.isArray(rows)
      && rows.length === 1
      && rows.every((row) => row && typeof row === "object" && !Array.isArray(row)
        && String((row as Record<string, unknown>).comment_id ?? "") === commentId
        && !(row as Record<string, unknown>).fail_error
        && !(row as Record<string, unknown>).fail_message);
    if (replyStep.ok) replyStep.data = { ...replyStep.data, sellerpilotReplyAcceptance: replyAcceptanceMarker(
      "shopee", "product_review", { shopId, commentId, itemId },
    ) };
  }
  return { steps: [replyStep], remoteId: `${shopId}:${commentId}` };
}
