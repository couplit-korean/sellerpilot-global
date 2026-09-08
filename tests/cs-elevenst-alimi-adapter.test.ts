import assert from "node:assert/strict";
import test from "node:test";
import { executeElevenstInquiry } from "../lib/channels/elevenst-inquiries";

const payload = { api_key: "test-elevenst-key" };

test("11st Alimi adapter uses the official GET-only path and follows the explicit parser readiness marker", async () => {
  const originalFetch = globalThis.fetch;
  let observed: { url: string; method: string } | null = null;
  globalThis.fetch = async (input, init) => {
    observed = { url: String(input), method: String(init?.method ?? "GET") };
    return new Response("<alimi><result_code>0</result_code></alimi>", {
      status: 200,
      headers: { "content-type": "application/xml;charset=UTF-8" },
    });
  };
  try {
    const result = await executeElevenstInquiry({
      operation: "inquiries.list",
      payload,
      arguments: {
        kind: "urgent_alimi",
        startDate: "20260810",
        endDate: "20260908",
        status: "02",
        orderNo: "202609080001",
      },
    });
    assert.deepEqual(observed, {
      url: "https://api.11st.co.kr/rest/alimi/getalimilist/20260810/20260908/02/202609080001",
      method: "GET",
    });
    const parserReady = result.steps[0]?.data.sellerpilotAlimiParserReady === true;
    assert.equal(result.steps[0]?.ok, parserReady);
    assert.equal(result.steps[0]?.data.sellerpilotInquiryKind, "urgent_alimi");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st Alimi adapter rejects over-30-day, invalid status and order-without-status inputs", async () => {
  for (const arguments_ of [
    { kind: "urgent_alimi", startDate: "20260809", endDate: "20260908" },
    { kind: "urgent_alimi", startDate: "20260810", endDate: "20260908", status: "00" },
    { kind: "urgent_alimi", startDate: "20260810", endDate: "20260908", orderNo: "202609080001" },
  ]) {
    await assert.rejects(() => executeElevenstInquiry({
      operation: "inquiries.list",
      payload,
      arguments: arguments_,
    }), /ELEVENST_ALIMI_RANGE_INVALID/u);
  }
});
