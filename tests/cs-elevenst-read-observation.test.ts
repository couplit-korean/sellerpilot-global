import assert from "node:assert/strict";
import test from "node:test";
import { buildElevenstCsReadObservation } from "../lib/cs/channels/elevenst/read-observation";
import type { ChannelOperationResult } from "../lib/channels/operations";

function result(input: {
  ok: boolean;
  status?: number;
  stepOk?: boolean;
  data: Record<string, unknown>;
}): ChannelOperationResult {
  return {
    ok: input.ok,
    channel: "elevenst",
    operation: "inquiries.list",
    steps: [{
      name: "inquiries",
      ok: input.stepOk ?? input.ok,
      status: input.status ?? 200,
      data: input.data,
    }],
    safeMessage: input.ok ? "ok" : "failed",
  };
}

test("11st read observation preserves Q&A business errors without claiming an empty result", () => {
  const receipt = buildElevenstCsReadObservation({
    result: result({
      ok: false,
      data: {
        accepted: false,
        resultCode: "500",
        productQnas: [],
        sellerpilotInquiryKind: "product_qna",
      },
    }),
    arguments: {
      kind: "product_qna",
      startDate: "20260902",
      endDate: "20260908",
      answerStatus: "00",
    },
    checkedAt: "2026-09-08T07:00:00.000Z",
    normalizedInquiries: [],
  });
  assert.equal(receipt.observation.accepted, false);
  assert.equal(receipt.observation.resultCode, "500");
  assert.equal(receipt.observation.providerRows, 0);
  assert.equal(receipt.observation.statusFilter, "00");
  assert.deepEqual(receipt.inquiries, []);
});

test("11st read observation binds accepted Alimi evidence to the exact normalized row count", () => {
  const rows = [{ providerContext: { kind: "urgent_inquiry" } }];
  const receipt = buildElevenstCsReadObservation({
    result: result({
      ok: true,
      data: {
        accepted: true,
        resultCode: "0",
        alimListInfos: [{ emerNtceSeq: "5590778" }],
        sellerpilotInquiryKind: "urgent_alimi",
        sellerpilotElevenstAlimiParseContract: "sellerpilot-elevenst-alimi-parser/1",
        sellerpilotElevenstAlimiObservedRows: 1,
        sellerpilotElevenstAlimiParseIncomplete: false,
      },
    }),
    arguments: {
      kind: "urgent_alimi",
      startDate: "20260810",
      endDate: "20260908",
    },
    checkedAt: "2026-09-08T07:01:00.000Z",
    normalizedInquiries: rows,
  });
  assert.equal(receipt.observation.accepted, true);
  assert.equal(receipt.observation.providerRows, 1);
  assert.equal(receipt.observation.parseIncomplete, false);
  assert.equal(receipt.observation.parserMarker, "sellerpilot-elevenst-alimi-parser/1");
  assert.equal(receipt.inquiries, rows);

  assert.throws(() => buildElevenstCsReadObservation({
    result: result({
      ok: true,
      data: {
        accepted: true,
        resultCode: "0",
        alimListInfos: [{ emerNtceSeq: "1" }],
        sellerpilotInquiryKind: "urgent_alimi",
        sellerpilotElevenstAlimiParseContract: "sellerpilot-elevenst-alimi-parser/1",
        sellerpilotElevenstAlimiObservedRows: 1,
        sellerpilotElevenstAlimiParseIncomplete: false,
      },
    }),
    arguments: {
      kind: "urgent_alimi", startDate: "20260810", endDate: "20260908",
    },
    checkedAt: "2026-09-08T07:01:00.000Z",
    normalizedInquiries: [],
  }), /normalizedCount/);
});

test("11st read observation maps every over-limit Alimi response to explicit 5001 incomplete evidence", () => {
  const receipt = buildElevenstCsReadObservation({
    result: result({
      ok: false,
      data: {
        accepted: false,
        resultCode: "0",
        alimListInfos: [],
        memId: "must-not-leak",
        sellerpilotInquiryKind: "urgent_alimi",
        sellerpilotElevenstAlimiParseContract: "sellerpilot-elevenst-alimi-parser/1",
        sellerpilotElevenstAlimiObservedRows: 6_000,
        sellerpilotElevenstAlimiParseIncomplete: true,
        sellerpilotElevenstAlimiParseError: "ELEVENST_ALIMI_ROW_LIMIT_EXCEEDED",
      },
    }),
    arguments: {
      kind: "urgent_alimi", startDate: "20260810", endDate: "20260908",
    },
    checkedAt: "2026-09-08T07:02:00.000Z",
    normalizedInquiries: [],
  });
  assert.equal(receipt.observation.accepted, false);
  assert.equal(receipt.observation.providerRows, 5_001);
  assert.equal(receipt.observation.parseIncomplete, true);
  assert.match(receipt.observation.evidenceSha256, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(receipt), /must-not-leak|memId/u);
  assert.deepEqual(receipt.inquiries, []);
});

test("11st read observation rejects a mismatched surface, invalid window and non-UTC timestamp", () => {
  const base = result({
    ok: false,
    data: {
      accepted: false,
      resultCode: "500",
      productQnas: [],
      sellerpilotInquiryKind: "product_qna",
    },
  });
  assert.throws(() => buildElevenstCsReadObservation({
    result: base,
    arguments: {
      kind: "urgent_alimi", startDate: "20260810", endDate: "20260908",
    },
    checkedAt: "2026-09-08T07:00:00.000Z",
    normalizedInquiries: [],
  }), /binding/);
  assert.throws(() => buildElevenstCsReadObservation({
    result: base,
    arguments: {
      kind: "product_qna", startDate: "20260901", endDate: "20260908", answerStatus: "00",
    },
    checkedAt: "2026-09-08T07:00:00.000Z",
    normalizedInquiries: [],
  }), /scope/);
  assert.throws(() => buildElevenstCsReadObservation({
    result: base,
    arguments: {
      kind: "product_qna", startDate: "20260902", endDate: "20260908", answerStatus: "00",
    },
    checkedAt: "2026-09-08T16:00:00+09:00",
    normalizedInquiries: [],
  }), /checkedAt/);
});
