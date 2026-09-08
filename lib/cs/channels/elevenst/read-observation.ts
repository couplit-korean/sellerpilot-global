import { createHash } from "node:crypto";
import type { CsOperationResult as ChannelOperationResult } from "../../operations/contracts";

type NormalizedInquiry = {
  providerContext?: Record<string, unknown>;
  [key: string]: unknown;
};

type BuildInput = {
  result: ChannelOperationResult;
  arguments: Record<string, unknown>;
  checkedAt: string;
  normalizedInquiries: readonly NormalizedInquiry[];
};

type ElevenstReadObservation = {
  surface: "product_qna" | "urgent_alimi";
  sellerId: "couplit";
  sellerName: "커플릿";
  scopeStart: string;
  scopeEnd: string;
  statusFilter: string | null;
  checkedAt: string;
  httpStatus: number;
  accepted: boolean;
  resultCode: string | null;
  providerRows: number;
  parserMarker: "sellerpilot-elevenst-alimi-parser/1" | null;
  parseIncomplete: boolean;
  evidenceSha256: string;
};

const DAY_MS = 86_400_000;

function object(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`ELEVENST_READ_OBSERVATION_INVALID:${key}`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function date(value: unknown, key: string) {
  const result = text(value);
  if (!/^\d{8}$/u.test(result)) throw new Error(`ELEVENST_READ_OBSERVATION_INVALID:${key}`);
  const timestamp = Date.UTC(
    Number(result.slice(0, 4)),
    Number(result.slice(4, 6)) - 1,
    Number(result.slice(6, 8)),
  );
  if (new Date(timestamp).toISOString().slice(0, 10).replaceAll("-", "") !== result) {
    throw new Error(`ELEVENST_READ_OBSERVATION_INVALID:${key}`);
  }
  return { result, timestamp };
}

function checkedAt(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
      || Number.isNaN(Date.parse(value))) {
    throw new Error("ELEVENST_READ_OBSERVATION_INVALID:checkedAt");
  }
  return value;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  throw new Error("ELEVENST_READ_OBSERVATION_INVALID:evidence");
}

function evidenceSha256(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function buildElevenstCsReadObservation(input: BuildInput): {
  contractVersion: "sellerpilot-elevenst-cs-read-observation/1";
  observation: ElevenstReadObservation;
  inquiries: readonly NormalizedInquiry[];
} {
  if (input.result.channel !== "elevenst" || input.result.operation !== "inquiries.list"
      || input.result.steps.length !== 1) {
    throw new Error("ELEVENST_READ_OBSERVATION_INVALID:operation");
  }
  const step = input.result.steps[0]!;
  const data = object(step.data, "step.data");
  const sourceKind = text(data.sellerpilotInquiryKind);
  const requestedKindValue = text(input.arguments.kind) || "product_qna";
  if (!Number.isSafeInteger(step.status) || step.status < 100 || step.status > 599
      || !["product_qna", "urgent_alimi"].includes(requestedKindValue)
      || sourceKind !== requestedKindValue) {
    throw new Error("ELEVENST_READ_OBSERVATION_INVALID:binding");
  }
  const requestedKind = requestedKindValue as "product_qna" | "urgent_alimi";
  const start = date(input.arguments.startDate, "startDate");
  const end = date(input.arguments.endDate, "endDate");
  const maxWindow = requestedKind === "product_qna" ? 6 : 29;
  if (end.timestamp < start.timestamp || end.timestamp - start.timestamp > maxWindow * DAY_MS) {
    throw new Error("ELEVENST_READ_OBSERVATION_INVALID:scope");
  }

  const resultCode = text(data.resultCode) || null;
  const acceptedByProvider = data.accepted === true;
  let providerRows: number;
  let parseIncomplete = false;
  let parserMarker: ElevenstReadObservation["parserMarker"] = null;
  let statusFilter: string | null;
  let receiptInquiries: readonly NormalizedInquiry[] = [];
  if (requestedKind === "urgent_alimi") {
    const observedRows = data.sellerpilotElevenstAlimiObservedRows;
    parseIncomplete = data.sellerpilotElevenstAlimiParseIncomplete === true;
    parserMarker = data.sellerpilotElevenstAlimiParseContract === "sellerpilot-elevenst-alimi-parser/1"
      ? "sellerpilot-elevenst-alimi-parser/1"
      : null;
    if (typeof observedRows !== "number" || !Number.isSafeInteger(observedRows) || observedRows < 0) {
      throw new Error("ELEVENST_READ_OBSERVATION_INVALID:alimiRows");
    }
    providerRows = parseIncomplete ? 5_001 : observedRows;
    statusFilter = text(input.arguments.status) || null;
    if (statusFilter !== null && !["01", "02", "03", "04", "05", "06"].includes(statusFilter)) {
      throw new Error("ELEVENST_READ_OBSERVATION_INVALID:statusFilter");
    }
    const accepted = input.result.ok && step.ok && acceptedByProvider
      && parserMarker !== null && !parseIncomplete;
    if (accepted && providerRows !== input.normalizedInquiries.length) {
      throw new Error("ELEVENST_READ_OBSERVATION_INVALID:normalizedCount");
    }
    if (accepted) receiptInquiries = input.normalizedInquiries;
  } else {
    const rows = data.productQnas;
    if (!Array.isArray(rows) || rows.length > 5_000) {
      throw new Error("ELEVENST_READ_OBSERVATION_INVALID:qnaRows");
    }
    providerRows = rows.length;
    statusFilter = text(input.arguments.answerStatus);
    if (!["00", "01", "02"].includes(statusFilter)) {
      throw new Error("ELEVENST_READ_OBSERVATION_INVALID:statusFilter");
    }
  }

  const accepted = input.result.ok && step.ok && acceptedByProvider
    && (requestedKind === "product_qna" || (parserMarker !== null && !parseIncomplete));
  const observation: ElevenstReadObservation = {
    surface: requestedKind,
    sellerId: "couplit",
    sellerName: "커플릿",
    scopeStart: start.result,
    scopeEnd: end.result,
    statusFilter,
    checkedAt: checkedAt(input.checkedAt),
    httpStatus: step.status,
    accepted,
    resultCode,
    providerRows,
    parserMarker,
    parseIncomplete,
    evidenceSha256: evidenceSha256({
      contract: "sellerpilot-elevenst-cs-read-evidence/1",
      surface: requestedKind,
      scopeStart: start.result,
      scopeEnd: end.result,
      statusFilter,
      httpStatus: step.status,
      accepted,
      resultCode,
      providerRows,
      parserMarker,
      parseIncomplete,
      safeParsedData: data,
    }),
  };
  return {
    contractVersion: "sellerpilot-elevenst-cs-read-observation/1",
    observation,
    inquiries: receiptInquiries,
  };
}
