import { inquiryHasNextPage, inquiryRows } from "./inquiry-page.ts";
import type { naverRequest, RemoteResponse, SecretPayload } from "./protocols";
import { step, type ChannelOperationStep } from "./operation-step";
import { replyAcceptanceMarker } from "./reply-verification";
import { finiteCount, nestedObject, queryParams, stringArgument, pathSegment } from "./operation-values";

type SmartstoreInquiryInput = { operation: "inquiries.list" | "inquiries.reply"; payload: SecretPayload; arguments: Record<string, unknown> };
type SmartstoreInquiryExecution = { steps: ChannelOperationStep[]; remoteId?: string; continuationArguments?: Record<string, unknown> };

function integerQueryArgument(
  query: URLSearchParams,
  key: string,
  options: { fallback: number; min: number; max: number },
) {
  const raw = query.get(key);
  const parsed = raw === null ? options.fallback : Number(raw);
  if (!Number.isInteger(parsed) || parsed < options.min || parsed > options.max) {
    throw new Error(`CHANNEL_ARGUMENT_INVALID:query.${key}`);
  }
  return parsed;
}

function calendarDateQueryArgument(query: URLSearchParams, key: string) {
  const value = query.get(key)?.trim() ?? "";
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`CHANNEL_ARGUMENT_INVALID:query.${key}`);
  }
  return value;
}

function dateTimeQueryArgument(query: URLSearchParams, key: string) {
  const value = query.get(key)?.trim() ?? "";
  const parsed = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw new Error(`CHANNEL_ARGUMENT_INVALID:query.${key}`);
  }
  return { value, milliseconds: parsed.getTime() };
}

function assertThirtyDayRange(fromMilliseconds: number, toMilliseconds: number) {
  const duration = toMilliseconds - fromMilliseconds;
  if (duration < 0 || duration >= 30 * 86_400_000) {
    throw new Error("CHANNEL_ARGUMENT_INVALID:query.inquiryTimeRange");
  }
}

type SmartstoreInquiryRequest = (input: Omit<Parameters<typeof naverRequest>[0], "accessToken">) => Promise<RemoteResponse>;

export async function executeSmartstoreInquiry(input: SmartstoreInquiryInput, request: SmartstoreInquiryRequest): Promise<SmartstoreInquiryExecution> {
  if (input.operation === "inquiries.list") {
    const kind = stringArgument(input.arguments, "kind", false) || "product";
    if (kind !== "product" && kind !== "customer") {
      throw new Error("CHANNEL_ARGUMENT_INVALID:kind");
    }
    const baseQuery = queryParams(input.arguments);
    if (kind === "customer") {
      const page = integerQueryArgument(baseQuery, "page", { fallback: 1, min: 1, max: 1_000_000 });
      const pageSize = integerQueryArgument(baseQuery, "size", { fallback: 10, min: 10, max: 200 });
      const startSearchDate = calendarDateQueryArgument(baseQuery, "startSearchDate");
      const endSearchDate = calendarDateQueryArgument(baseQuery, "endSearchDate");
      if (startSearchDate > endSearchDate) {
        throw new Error("CHANNEL_ARGUMENT_INVALID:query.inquiryTimeRange");
      }
      assertThirtyDayRange(
        Date.parse(`${startSearchDate}T00:00:00.000Z`),
        Date.parse(`${endSearchDate}T23:59:59.999Z`),
      );
      const answeredValue = baseQuery.get("answered");
      const answered = answeredValue?.trim().toLowerCase();
      if (answeredValue !== null && answered !== "true" && answered !== "false") {
        throw new Error("CHANNEL_ARGUMENT_INVALID:query.answered");
      }
      const query = new URLSearchParams({
        page: String(page),
        size: String(pageSize),
        startSearchDate,
        endSearchDate,
      });
      if (answered) query.set("answered", answered);
      const remote = await request({ method: "GET", path: "/v1/pay-user/inquiries", query });
      const inquiryStep = step("inquiries", remote);
      inquiryStep.data = { ...inquiryStep.data, sellerpilotInquiryKind: "customer" };
      const steps = [inquiryStep];
      if (!inquiryStep.ok) return { steps };
      const count = inquiryRows("smartstore", remote.data.content).length;
      const totalPages = finiteCount(remote.data.totalPages);
      if (!inquiryHasNextPage({ channel: "smartstore", count, page, pageSize, totalPages })) {
        return { steps };
      }
      return { steps, continuationArguments: {
        ...input.arguments,
        kind: "customer",
        query: {
          page: page + 1,
          size: pageSize,
          startSearchDate,
          endSearchDate,
          ...(answered ? { answered } : {}),
        },
      } };
    }

    const pageSize = integerQueryArgument(baseQuery, "size", { fallback: 100, min: 1, max: 100 });
    const page = integerQueryArgument(baseQuery, "page", { fallback: 1, min: 1, max: 1_000_000 });
    const fromDate = dateTimeQueryArgument(baseQuery, "fromDate");
    const toDate = dateTimeQueryArgument(baseQuery, "toDate");
    assertThirtyDayRange(fromDate.milliseconds, toDate.milliseconds);
    const answeredValue = baseQuery.get("answered");
    const answered = answeredValue?.trim().toLowerCase();
    if (answeredValue !== null && answered !== "true" && answered !== "false") {
      throw new Error("CHANNEL_ARGUMENT_INVALID:query.answered");
    }
    // Keep token exchange plus Q&A retrieval bounded to one provider page;
    // callers that need a full sync follow the returned durable continuation.
    const query = new URLSearchParams({
      fromDate: fromDate.value,
      toDate: toDate.value,
      page: String(page),
      size: String(pageSize),
    });
    if (answered) query.set("answered", answered);
    const remote = await request({ method: "GET", path: "/v1/contents/qnas", query });
    const inquiryStep = step("inquiries", remote);
    inquiryStep.data = { ...inquiryStep.data, sellerpilotInquiryKind: "product" };
    const steps = [inquiryStep];
    if (!inquiryStep.ok) return { steps };
    const root = Object.keys(nestedObject(remote.data.data)).length ? nestedObject(remote.data.data) : remote.data;
    const count = inquiryRows("smartstore", root.contents, root.content, Array.isArray(remote.data.data) ? remote.data.data : undefined).length;
    const totalPages = finiteCount(root.totalPages);
    if (!inquiryHasNextPage({ channel: "smartstore", count, page, pageSize, totalPages })) {
      return { steps };
    }
    return { steps, continuationArguments: {
      ...input.arguments,
      kind: "product",
      query: {
        fromDate: fromDate.value,
        toDate: toDate.value,
        page: page + 1,
        size: pageSize,
        ...(answered ? { answered } : {}),
      },
    } };
  }

  if (input.operation === "inquiries.reply") {
    const kind = stringArgument(input.arguments, "kind", false) || "product";
    if (kind === "customer") {
      const inquiryNo = stringArgument(input.arguments, "inquiryNo");
      if (!/^[1-9]\d{0,18}$/.test(inquiryNo)) throw new Error("CHANNEL_ARGUMENT_INVALID:inquiryNo");
      const reply = stringArgument(input.arguments, "reply");
      const answerTemplateId = stringArgument(input.arguments, "answerTemplateId", false);
      const remote = await request({
        method: "POST",
        path: `/v1/pay-merchant/inquiries/${pathSegment(inquiryNo)}/answer`,
        body: {
          answerComment: reply,
          ...(answerTemplateId ? { answerTemplateId } : {}),
        },
      });
      const replyStep = step("inquiry-reply", remote);
      replyStep.data = {
        ...replyStep.data,
        sellerpilotInquiryKind: "customer",
        sellerpilotVerification: replyStep.ok
          ? "SMARTSTORE_CUSTOMER_INQUIRY_REPLY_HTTP_ACK"
          : "SMARTSTORE_CUSTOMER_INQUIRY_REPLY_REJECTED",
        ...(replyStep.ok ? { sellerpilotReplyAcceptance: replyAcceptanceMarker(
          "smartstore", "customer", { inquiryNo },
        ) } : {}),
      };
      return { steps: [replyStep], remoteId: inquiryNo };
    }
    if (kind !== "product") throw new Error("CHANNEL_ARGUMENT_INVALID:kind");
    const nativeQuestionId = stringArgument(input.arguments, "questionId");
    if (!/^[1-9]\d{0,18}$/.test(nativeQuestionId)) throw new Error("CHANNEL_ARGUMENT_INVALID:questionId");
    const questionId = pathSegment(nativeQuestionId);
    const remote = await request({
      method: "PUT",
      path: `/v1/contents/qnas/${questionId}`,
      body: { answerContent: stringArgument(input.arguments, "reply") },
    });
    const replyStep = step("inquiry-reply", remote);
    replyStep.data = {
      ...replyStep.data,
      sellerpilotInquiryKind: "product",
      ...(replyStep.ok ? { sellerpilotReplyAcceptance: replyAcceptanceMarker(
        "smartstore", "product", { questionId: decodeURIComponent(questionId) },
      ) } : {}),
    };
    return { steps: [replyStep], remoteId: decodeURIComponent(questionId) };
  }
  throw new Error("SMARTSTORE_INQUIRY_OPERATION_REQUIRED");
}
