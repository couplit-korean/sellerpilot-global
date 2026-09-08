import type { SecretPayload } from "./protocols";
import { elevenstCsXmlRequest as elevenstSellerXmlRequest } from "../cs/channels/elevenst/xml-request";
import { step, type ChannelOperationStep } from "./operation-step";
import { pathSegment, stringArgument } from "./operation-values";
import { replyAcceptanceMarker } from "./reply-verification";

type ElevenstInquiryInput = {
  operation: "inquiries.list" | "inquiries.reply";
  payload: SecretPayload;
  arguments: Record<string, unknown>;
};

type ElevenstInquiryExecution = {
  steps: ChannelOperationStep[];
  remoteId?: string;
};

type ElevenstInquiryKind = "product_qna" | "urgent_alimi";

const DAY_MS = 86_400_000;

function calendarDate(value: string, key: string) {
  if (!/^\d{8}$/u.test(value)) throw new Error(`CHANNEL_ARGUMENT_INVALID:${key}`);
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new Error(`CHANNEL_ARGUMENT_INVALID:${key}`);
  }
  return timestamp;
}

function exactIdentifier(value: string, key: string) {
  if (!/^[1-9]\d{0,19}$/u.test(value)) throw new Error(`CHANNEL_ARGUMENT_INVALID:${key}`);
  return pathSegment(value);
}

function optionalArgument(arguments_: Record<string, unknown>, key: string) {
  const value = arguments_[key];
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.trim() !== value || !value) {
    throw new Error(`CHANNEL_ARGUMENT_INVALID:${key}`);
  }
  return value;
}

function inquiryKind(arguments_: Record<string, unknown>): ElevenstInquiryKind {
  const value = optionalArgument(arguments_, "kind") || "product_qna";
  if (value !== "product_qna" && value !== "urgent_alimi") {
    throw new Error("CHANNEL_ARGUMENT_INVALID:kind");
  }
  return value;
}

function inquiryStep(name: string, remote: Awaited<ReturnType<typeof elevenstSellerXmlRequest>>) {
  const resultStep = step(name, remote);
  resultStep.ok = remote.response.ok && remote.data.accepted === true;
  return resultStep;
}

function replyXml(answer: string) {
  const escaped = answer.replace(/[<>&'"]/gu, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  })[character] ?? character);
  return `<?xml version="1.0" encoding="UTF-8"?><ProductQna><answerCont>${escaped}</answerCont></ProductQna>`;
}

export async function executeElevenstInquiry(
  input: ElevenstInquiryInput,
): Promise<ElevenstInquiryExecution> {
  if (input.operation === "inquiries.list") {
    const kind = inquiryKind(input.arguments);
    const startDate = stringArgument(input.arguments, "startDate");
    const endDate = stringArgument(input.arguments, "endDate");
    const start = calendarDate(startDate, "startDate");
    const end = calendarDate(endDate, "endDate");
    if (kind === "urgent_alimi") {
      const status = optionalArgument(input.arguments, "status");
      const orderNo = optionalArgument(input.arguments, "orderNo");
      if (end < start || end - start > 29 * DAY_MS
          || (status && !["01", "02", "03", "04", "05", "06"].includes(status))
          || (orderNo && (!status || !/^[1-9]\d{0,19}$/u.test(orderNo)))) {
        throw new Error("ELEVENST_ALIMI_RANGE_INVALID");
      }
      const suffix = status
        ? `/${pathSegment(status)}${orderNo ? `/${pathSegment(orderNo)}` : ""}`
        : "";
      const remote = await elevenstSellerXmlRequest({
        payload: input.payload,
        method: "GET",
        path: `/rest/alimi/getalimilist/${startDate}/${endDate}${suffix}`,
      });
      const listStep = inquiryStep("inquiries", remote);
      const remoteData = remote.data as Record<string, unknown>;
      const parserContract = remoteData.sellerpilotElevenstAlimiParseContract;
      const rows = remoteData.alimListInfos;
      const observedRows = remoteData.sellerpilotElevenstAlimiObservedRows;
      const parseIncomplete = remoteData.sellerpilotElevenstAlimiParseIncomplete === true;
      const parserReady = parserContract === "sellerpilot-elevenst-alimi-parser/1"
        && Array.isArray(rows)
        && typeof observedRows === "number"
        && Number.isSafeInteger(observedRows)
        && observedRows === rows.length
        && !parseIncomplete;
      listStep.ok = listStep.ok && parserReady;
      listStep.data = {
        ...listStep.data,
        sellerpilotInquiryKind: "urgent_alimi",
        sellerpilotAlimiParserReady: parserReady,
      };
      return { steps: [listStep] };
    }

    const answerStatus = stringArgument(input.arguments, "answerStatus");
    if (end < start || end - start > 6 * DAY_MS || !["00", "01", "02"].includes(answerStatus)) {
      throw new Error("ELEVENST_INQUIRY_RANGE_INVALID");
    }
    const remote = await elevenstSellerXmlRequest({
      payload: input.payload,
      method: "GET",
      path: `/rest/prodqnaservices/prodqnalist/${startDate}/${endDate}/${answerStatus}`,
    });
    const listStep = inquiryStep("inquiries", remote);
    listStep.data = { ...listStep.data, sellerpilotInquiryKind: "product_qna" };
    return { steps: [listStep] };
  }

  if (input.operation === "inquiries.reply") {
    const brdInfoNo = decodeURIComponent(exactIdentifier(
      stringArgument(input.arguments, "brdInfoNo"),
      "brdInfoNo",
    ));
    const prdNo = decodeURIComponent(exactIdentifier(
      stringArgument(input.arguments, "prdNo"),
      "prdNo",
    ));
    const answer = stringArgument(input.arguments, "reply");
    const hasControlCharacter = [...answer].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
    });
    if (answer.length > 4_000 || hasControlCharacter) {
      throw new Error("CHANNEL_ARGUMENT_INVALID:reply");
    }
    const remote = await elevenstSellerXmlRequest({
      payload: input.payload,
      method: "PUT",
      path: `/rest/prodqnaservices/prodqnaanswer/${pathSegment(brdInfoNo)}/${pathSegment(prdNo)}`,
      body: replyXml(answer),
    });
    const replyStep = inquiryStep("inquiry-reply", remote);
    const returnedBoardInfoNo = String(remote.data.brdInfoNo ?? "").trim();
    const returnedProductNo = String(remote.data.productNo ?? "").trim();
    const exactAcceptance = replyStep.ok
      && remote.data.resultCode === "200"
      && returnedBoardInfoNo === brdInfoNo
      && returnedProductNo === prdNo;
    replyStep.ok = exactAcceptance;
    replyStep.data = {
      ...replyStep.data,
      sellerpilotVerification: exactAcceptance
        ? "ELEVENST_PRODUCT_QNA_REPLY_IDENTITY_VERIFIED"
        : "ELEVENST_PRODUCT_QNA_REPLY_IDENTITY_MISMATCH",
      ...(exactAcceptance ? {
        sellerpilotReplyAcceptance: replyAcceptanceMarker("elevenst", "product_qna", {
          brdInfoNo,
          prdNo,
        }),
      } : {}),
    };
    return { steps: [replyStep], remoteId: brdInfoNo };
  }

  throw new Error("ELEVENST_INQUIRY_OPERATION_REQUIRED");
}
