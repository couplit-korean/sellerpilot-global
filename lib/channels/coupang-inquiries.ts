import { inquiryHasNextPage, inquiryRows } from "./inquiry-page.ts";
import { coupangRequest, textValue, type SecretPayload } from "./protocols";
import { step, type ChannelOperationStep } from "./operation-step";
import { boundedPageSize, finiteCount, nestedObject, stringMap, queryParams, stringArgument, pathSegment } from "./operation-values";
import { replyAcceptanceMarker } from "./reply-verification";
import {
  coupangProductReplyReadbackPreflight,
  coupangProductReplyReadbackQuery,
  evaluateCoupangProductReplyReadback,
} from "./cs/coupang/product-reply-readback";

type CoupangInquiryInput = { operation: "inquiries.list" | "inquiries.reply"; payload: SecretPayload; arguments: Record<string, unknown> };
type CoupangInquiryExecution = { steps: ChannelOperationStep[]; remoteId?: string; continuationArguments?: Record<string, unknown>; retryContinuation?: import("../cs/operations/contracts").CsRetryContinuation };

const coupangAfterSalesKinds = new Set(["return_request", "cancel_request", "exchange_request"]);

function coupangLocalTime(value: string, precision: "minute" | "second") {
  const expression = precision === "minute"
    ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u;
  if (!expression.test(value)) throw new Error("COUPANG_AFTER_SALES_TIME_RANGE_INVALID");
  const parsed = Date.parse(`${value}+09:00`);
  if (!Number.isFinite(parsed)) throw new Error("COUPANG_AFTER_SALES_TIME_RANGE_INVALID");
  return parsed;
}

async function executeCoupangAfterSalesRead(
  input: CoupangInquiryInput,
  vendorId: string,
  kind: string,
): Promise<CoupangInquiryExecution> {
  const baseQuery = queryParams(input.arguments);
  const isExchange = kind === "exchange_request";
  const createdAtFrom = baseQuery.get("createdAtFrom")?.trim() ?? "";
  const createdAtTo = baseQuery.get("createdAtTo")?.trim() ?? "";
  const from = coupangLocalTime(createdAtFrom, isExchange ? "second" : "minute");
  const to = coupangLocalTime(createdAtTo, isExchange ? "second" : "minute");
  const maximumRange = isExchange ? 7 * 86_400_000 : 31 * 86_400_000;
  if (to < from || to - from >= maximumRange) {
    throw new Error("COUPANG_AFTER_SALES_TIME_RANGE_INVALID");
  }

  if (!isExchange) {
    const expectedType = kind === "cancel_request" ? "CANCEL" : "RETURN";
    if (baseQuery.get("searchType") !== "timeFrame"
        || baseQuery.get("cancelType") !== expectedType
        || ["status", "orderId", "nextToken", "maxPerPage"].some((key) => baseQuery.has(key))) {
      throw new Error("COUPANG_AFTER_SALES_QUERY_INVALID");
    }
  } else {
    const status = baseQuery.get("status")?.trim() ?? "";
    if (status && !["RECEIPT", "PROGRESS", "SUCCESS", "REJECT", "CANCEL"].includes(status)) {
      throw new Error("COUPANG_AFTER_SALES_QUERY_INVALID");
    }
    baseQuery.set("maxPerPage", String(boundedPageSize(baseQuery.get("maxPerPage"), 10, 10)));
  }

  const path = isExchange
    ? `/v2/providers/openapi/apis/api/v4/vendors/${pathSegment(vendorId)}/exchangeRequests`
    : `/v2/providers/openapi/apis/api/v6/vendors/${pathSegment(vendorId)}/returnRequests`;
  const remote = await coupangRequest({ payload: input.payload, method: "GET", path, query: baseQuery });
  const inquiryStep = step("inquiries", remote);
  inquiryStep.data = { ...inquiryStep.data, sellerpilotInquiryKind: kind };
  if (!inquiryStep.ok || !isExchange) return { steps: [inquiryStep] };

  const data = nestedObject(remote.data.data);
  const nextToken = String(remote.data.nextToken ?? data.nextToken ?? "").trim();
  if (!nextToken || nextToken === String(baseQuery.get("nextToken") ?? "").trim()) {
    return { steps: [inquiryStep] };
  }
  return {
    steps: [inquiryStep],
    continuationArguments: {
      ...input.arguments,
      query: { ...stringMap(input.arguments, "query"), maxPerPage: 10, nextToken },
    },
  };
}


export async function executeCoupangInquiry(input: CoupangInquiryInput): Promise<CoupangInquiryExecution> {
  const vendorId = textValue(input.payload, "vendor_id");
  if (!vendorId) throw new Error("COUPANG_CREDENTIALS_MISSING");
  const orderBase = `/v2/providers/openapi/apis/api/v5/vendors/${pathSegment(vendorId)}`;
  if (input.operation === "inquiries.list") {
    const kind = stringArgument(input.arguments, "kind", false);
    if (kind === "product-reply-readback") {
      const preflight = coupangProductReplyReadbackPreflight(input.arguments);
      if ("decision" in preflight) return preflight.decision;
      const remote = await coupangRequest({
        payload: input.payload,
        method: "GET",
        path: `${orderBase}/onlineInquiries`,
        query: coupangProductReplyReadbackQuery(preflight.parsed),
      });
      const inquiryStep = step("inquiries", remote);
      inquiryStep.data = { ...inquiryStep.data, sellerpilotInquiryKind: "product" };
      return evaluateCoupangProductReplyReadback({
        arguments_: input.arguments,
        parsed: preflight.parsed,
        providerStep: inquiryStep,
      });
    }
    if (coupangAfterSalesKinds.has(kind)) {
      return executeCoupangAfterSalesRead(input, vendorId, kind);
    }
    if (kind && kind !== "product" && kind !== "call-center" && kind !== "call-center-detail") {
      throw new Error("CHANNEL_ARGUMENT_INVALID:kind");
    }
    if (kind === "call-center-detail") {
      const inquiryId = pathSegment(stringArgument(input.arguments, "inquiryId"));
      if (!/^[1-9]\d*$/u.test(decodeURIComponent(inquiryId))) {
        throw new Error("CHANNEL_ARGUMENT_INVALID:inquiryId");
      }
      const remote = await coupangRequest({
        payload: input.payload,
        method: "GET",
        path: `/v2/providers/openapi/apis/api/v5/vendors/callCenterInquiries/${inquiryId}`,
      });
      const inquiryStep = step("inquiries", remote);
      inquiryStep.data = {
        ...inquiryStep.data,
        sellerpilotInquiryKind: "call-center",
        sellerpilotReadMode: "call-center-detail",
      };
      return { steps: [inquiryStep], remoteId: decodeURIComponent(inquiryId) };
    }
    const baseQuery = queryParams(input.arguments);
    baseQuery.set("vendorId", vendorId);
    const path = kind === "call-center" ? `${orderBase}/callCenterInquiries` : `${orderBase}/onlineInquiries`;
    const pageSize = boundedPageSize(baseQuery.get("pageSize"), kind === "call-center" ? 30 : 50, kind === "call-center" ? 30 : 50);
    const pageNum = Math.max(1, finiteCount(baseQuery.get("pageNum")) ?? 1);
    // One complete provider page is the durable serverless unit. A successful
    // full page advances through the existing atomic continuation contract.
    const query = new URLSearchParams(baseQuery);
    query.set("pageNum", String(pageNum));
    query.set("pageSize", String(pageSize));
    const remote = await coupangRequest({ payload: input.payload, method: "GET", path, query });
    const inquiryStep = step("inquiries", remote);
    inquiryStep.data = { ...inquiryStep.data, sellerpilotInquiryKind: kind || "product" };
    const steps = [inquiryStep];
    if (!inquiryStep.ok) return { steps };
    const count = inquiryRows("coupang", Array.isArray(remote.data.data) ? remote.data.data : nestedObject(remote.data.data).content).length;
    const data = nestedObject(remote.data.data);
    const pagination = nestedObject(data.pagination);
    const totalPages = finiteCount(pagination.totalPages ?? data.totalPages ?? remote.data.totalPages);
    if (!inquiryHasNextPage({ channel: "coupang", count, page: pageNum, pageSize, totalPages })) {
      return { steps };
    }
    return { steps, continuationArguments: {
      ...input.arguments,
      query: { ...stringMap(input.arguments, "query"), pageNum: pageNum + 1, pageSize },
    } };
  }

  if (input.operation === "inquiries.reply") {
    const inquiryId = pathSegment(stringArgument(input.arguments, "inquiryId"));
    const kind = stringArgument(input.arguments, "kind");
    const replyBy = textValue(input.payload, "requested_by");
    if (!replyBy) throw new Error("COUPANG_WING_USER_ID_MISSING");
    if (kind !== "product" && kind !== "call-center") throw new Error("CHANNEL_ARGUMENT_INVALID:kind");
    const reply = stringArgument(input.arguments, "reply");
    const body = kind === "call-center"
      ? {
          vendorId,
          inquiryId: decodeURIComponent(inquiryId),
          content: reply,
          replyBy,
          parentAnswerId: pathSegment(stringArgument(input.arguments, "parentAnswerId")),
        }
      : { content: reply, vendorId, replyBy };
    const remote = await coupangRequest({
      payload: input.payload,
      method: "POST",
      path: `/v2/providers/openapi/apis/api/v4/vendors/${pathSegment(vendorId)}/${kind === "call-center" ? "callCenterInquiries" : "onlineInquiries"}/${inquiryId}/replies`,
      body,
    });
    const replyStep = step("inquiry-reply", remote);
    if (replyStep.ok) replyStep.data = { ...replyStep.data, sellerpilotReplyAcceptance: replyAcceptanceMarker(
      "coupang", kind, {
        inquiryId: decodeURIComponent(inquiryId),
        ...(kind === "call-center" ? { parentAnswerId: body.parentAnswerId } : {}),
      },
    ) };
    return { steps: [replyStep], remoteId: decodeURIComponent(inquiryId) };
  }
  throw new Error("COUPANG_INQUIRY_OPERATION_REQUIRED");
}
