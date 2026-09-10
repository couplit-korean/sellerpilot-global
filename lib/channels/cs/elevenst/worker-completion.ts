import type { CsOperationResult as ChannelOperationResult } from "../../../cs/operations/contracts";

type GatewayJobTuple = {
  id: string;
  channel: string;
  operation: string;
};

type FailedCompletionInput<TCredentialRefresh = unknown> = {
  job: GatewayJobTuple;
  claimToken: string;
  error: string;
  result?: ChannelOperationResult | null;
  credentialRefresh?: TCredentialRefresh | null;
  retryContinuation?: unknown;
};

const sanitizedInquiryListMarker = "normalized_inquiries_v1";

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function safeElevenstProductQnaBusinessFailureResult(
  job: Pick<GatewayJobTuple, "channel" | "operation">,
  result: ChannelOperationResult | null | undefined,
): ChannelOperationResult | null {
  if (job.channel !== "elevenst" || job.operation !== "inquiries.list"
      || !result || result.ok !== false
      || result.channel !== "elevenst" || result.operation !== "inquiries.list"
      || result.steps.length !== 1) {
    return null;
  }
  const step = result.steps[0];
  const data = record(step?.data);
  if (!step || step.name !== "inquiries" || step.ok !== false || step.status !== 200
      || data?.accepted !== false || data.sellerpilotInquiryKind !== "product_qna"
      || !Array.isArray(data.productQnas) || data.productQnas.length !== 0) {
    return null;
  }
  const resultCode = String(data.resultCode ?? "");
  const businessFailure = resultCode === "500";
  const observedRows = data.sellerpilotElevenstProductQnaObservedRows;
  const expectedOverflowError = typeof observedRows === "number" && observedRows > 5_000
    ? "ELEVENST_PRODUCT_QNA_PARSER_ROW_LIMIT_EXCEEDED"
    : "ELEVENST_PRODUCT_QNA_DB_BATCH_LIMIT_EXCEEDED";
  const overflowFailure = data.sellerpilotElevenstProductQnaParseContract
      === "sellerpilot-elevenst-product-qna-parser/1"
    && data.sellerpilotElevenstProductQnaDocumentReady === true
    && data.sellerpilotElevenstProductQnaParseIncomplete === true
    && data.sellerpilotProductQnaParserReady === false
    && typeof observedRows === "number"
    && Number.isSafeInteger(observedRows)
    && observedRows > 500
    && data.sellerpilotElevenstProductQnaParseError === expectedOverflowError
    && (!resultCode || ["0", "200", "210"].includes(resultCode));
  if (!businessFailure && !overflowFailure) return null;
  const safeData = businessFailure ? {
    accepted: false,
    resultCode: "500",
    productQnas: [],
    sellerpilotInquiryKind: "product_qna",
  } : {
    accepted: false,
    ...(resultCode ? { resultCode } : {}),
    productQnas: [],
    sellerpilotInquiryKind: "product_qna",
    sellerpilotElevenstProductQnaParseContract: "sellerpilot-elevenst-product-qna-parser/1",
    sellerpilotElevenstProductQnaDocumentReady: true,
    sellerpilotElevenstProductQnaObservedRows: observedRows,
    sellerpilotElevenstProductQnaParseIncomplete: true,
    sellerpilotElevenstProductQnaParseError: expectedOverflowError,
    sellerpilotProductQnaParserReady: false,
  };
  return {
    ok: false,
    channel: "elevenst",
    operation: "inquiries.list",
    steps: [{
      name: "inquiries",
      ok: false,
      status: 200,
      data: safeData,
    }],
    safeMessage: businessFailure
      ? "11st Product Q&A business response was not accepted."
      : "11st Product Q&A row limit was exceeded.",
  };
}

export function buildGatewayWorkerFailedCompletionPayload<TCredentialRefresh = unknown>(
  input: FailedCompletionInput<TCredentialRefresh>,
) {
  const safeResult = safeElevenstProductQnaBusinessFailureResult(input.job, input.result);
  return {
    jobId: input.job.id,
    claimToken: input.claimToken,
    status: "failed" as const,
    error: input.error,
    ...(safeResult ? { result: safeResult } : {}),
    ...(input.credentialRefresh ? { credentialRefresh: input.credentialRefresh } : {}),
    ...(input.retryContinuation ? { retryContinuation: input.retryContinuation } : {}),
  };
}

export function sanitizedElevenstFailedInquiryStoredResult(
  result: ChannelOperationResult,
): ChannelOperationResult {
  if (result.ok !== false || result.channel !== "elevenst"
      || result.operation !== "inquiries.list" || result.steps.length < 1) {
    throw new Error("ELEVENST_FAILED_INQUIRY_RESULT_INVALID");
  }
  return {
    ok: false,
    channel: "elevenst",
    operation: "inquiries.list",
    steps: [{
      name: "inquiries-normalized",
      ok: false,
      status: result.steps.at(-1)?.status ?? 200,
      data: {
        sellerpilotMarker: sanitizedInquiryListMarker,
        normalizedInquiryCount: 0,
        providerStepCount: result.steps.length,
      },
    }],
    safeMessage: "문의 동기화 결과를 정규화해 저장했습니다.",
  };
}
