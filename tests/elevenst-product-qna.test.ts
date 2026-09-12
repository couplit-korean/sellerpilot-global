import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/operations";
import { inquiryCoverageEvidence } from "../lib/channels/inquiry-coverage";
import { normalizeChannelInquiries } from "../lib/channels/inquiry-sync";
import { buildInquiryReplyArguments } from "../lib/channels/inquiry-reply";
import { hasProviderReplyAcceptance } from "../lib/channels/reply-verification";
import { inquiryHistorySyncRequests, inquirySyncRequests } from "../lib/channels/sync-arguments";

const now = new Date("2026-09-08T03:00:00.000Z");
const payload = { api_key: "test-elevenst-key" };

function qnaResult(rows: Record<string, unknown>[]) {
  return {
    ok: true as const,
    channel: "elevenst" as const,
    operation: "inquiries.list" as const,
    steps: [{ name: "inquiries", ok: true, status: 200, data: {
      accepted: true, productQnas: rows, sellerpilotInquiryKind: "product_qna",
    } }],
    safeMessage: "local fixture",
  };
}

test("11st current and 30-day history requests obey the official seven-calendar-day ceiling", () => {
  assert.deepEqual(inquirySyncRequests("elevenst", now), [{
    periodicKey: "inquiries:product_qna:all",
    arguments: { kind: "product_qna", startDate: "20260902", endDate: "20260908", answerStatus: "00" },
  }, {
    periodicKey: "inquiries:urgent_alimi:all",
    arguments: { kind: "urgent_alimi", startDate: "20260810", endDate: "20260908" },
  }]);
  const requests = inquiryHistorySyncRequests("elevenst", now, 30);
  const history = requests.filter(item => item.arguments.kind === "product_qna");
  assert.deepEqual(requests.filter(item => item.arguments.kind === "urgent_alimi").map(item => item.arguments), [{ kind: "urgent_alimi", startDate: "20260810", endDate: "20260908" }]);
  assert.equal(history.length, 5);
  assert.deepEqual(history.map(({ arguments: { kind: _kind, ...value } }) => value), [
    { startDate: "20260810", endDate: "20260816", answerStatus: "00" },
    { startDate: "20260817", endDate: "20260823", answerStatus: "00" },
    { startDate: "20260824", endDate: "20260830", answerStatus: "00" },
    { startDate: "20260831", endDate: "20260906", answerStatus: "00" },
    { startDate: "20260907", endDate: "20260908", answerStatus: "00" },
  ]);
  assert.ok(history.every(({ periodicKey }) => periodicKey.includes(":product_qna:all")));
});

test("11st Product Q&A list uses the exact authenticated GET path and excludes provider member IDs", async () => {
  const originalFetch = globalThis.fetch;
  let call: { url: string; method: string; openApiKey: string; body: unknown } | null = null;
  globalThis.fetch = async (input, init) => {
    call = {
      url: String(input),
      method: String(init?.method ?? "GET"),
      openApiKey: String(new Headers(init?.headers).get("openapikey") ?? ""),
      body: init?.body,
    };
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>
      <ProductQnas><productQna>
        <answerYn>N</answerYn><brdInfoClfNo>13749310594</brdInfoClfNo>
        <brdInfoCont>배송은 언제 시작하나요?</brdInfoCont><brdInfoNo>81234567</brdInfoNo>
        <brdInfoSbjct>배송 문의</brdInfoSbjct><buyYn>Y</buyYn>
        <createDt>2026-09-08 10:15:30</createDt><dispYn>Y</dispYn>
        <memID>private-member-id</memID><memNM>고객A</memNM><prdNm>테스트 상품</prdNm>
        <qnaDtlsCd>02</qnaDtlsCd><qnaDtlsCdNm>배송</qnaDtlsCdNm>
        <ordNoDe>202609080001</ordNoDe><ordStlEndDt>2026-09-08</ordStlEndDt>
      </productQna></ProductQnas>`, {
      status: 200,
      headers: { "content-type": "application/xml; charset=UTF-8" },
    });
  };
  try {
    const operation = await executeChannelOperation({
      channel: "elevenst", operation: "inquiries.list", payload,
      arguments: { startDate: "20260902", endDate: "20260908", answerStatus: "00" },
      environment: "production",
    });
    assert.equal(operation.ok, true);
    assert.deepEqual(call, {
      url: "https://api.11st.co.kr/rest/prodqnaservices/prodqnalist/20260902/20260908/00",
      method: "GET", openApiKey: "test-elevenst-key", body: undefined,
    });
    assert.doesNotMatch(JSON.stringify(operation), /private-member-id|memID/u);
    const inquiries = normalizeChannelInquiries("elevenst", operation, now.toISOString());
    assert.equal(inquiries.length, 1);
    assert.equal(inquiries[0]?.externalTicketId, "elevenst:81234567");
    assert.equal(inquiries[0]?.externalOrderReference, "202609080001");
    assert.deepEqual(inquiries[0]?.replyContext, { brdInfoNo: "81234567", prdNo: "13749310594" });
    assert.deepEqual(inquiryCoverageEvidence("elevenst", operation, inquiries), {
      contractVersion: "sellerpilot-inquiry-coverage/1",
      providerRowCount: 1,
      projectedEventCount: 1,
      excludedCount: 0,
      eventRowComparable: false,
      observationDigests: [createHash("sha256").update(inquiries[0]!.inboundKey).digest("hex")],
      hasContinuation: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st Product Q&A accepts an exact namespaced empty root", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
      <!-- provider empty result -->
      <ns2:productQnas xmlns:ns2="http://sapi.11st.co.kr">
        <!-- no Product Q&A rows -->
      </ns2:productQnas>`,
    { status: 200, headers: { "content-type": "application/xml;charset=UTF-8" } },
  );
  try {
    const operation = await executeChannelOperation({
      channel: "elevenst", operation: "inquiries.list", payload,
      arguments: { startDate: "20260902", endDate: "20260908", answerStatus: "00" },
      environment: "production",
    });
    assert.equal(operation.ok, true);
    assert.equal(operation.steps[0]?.data.accepted, true);
    assert.equal(operation.steps[0]?.data.sellerpilotProductQnaParserReady, true);
    assert.equal(operation.steps[0]?.data.sellerpilotElevenstProductQnaObservedRows, 0);
    assert.equal(operation.steps[0]?.data.sellerpilotElevenstProductQnaParseIncomplete, false);
    assert.deepEqual(operation.steps[0]?.data.productQnas, []);
    assert.deepEqual(normalizeChannelInquiries("elevenst", operation, now.toISOString()), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st Product Q&A rejects HTTP 200 documents without the exact complete root", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const responseXml of [
      "<html><body>maintenance</body></html>",
      "<ClientMessage><message>success</message></ClientMessage>",
      "<ProductQnas><productQna></productQna>",
      "<productQnas><productQna></productQnas>",
      "<productQnas><!-- <productQna><brdInfoNo>1</brdInfoNo></productQna> --></productQnas>",
      "<productQnas><![CDATA[<productQna><brdInfoNo>1</brdInfoNo></productQna>]]></productQnas>",
      "<html><body><ProductQnas></ProductQnas></body></html>",
    ]) {
      globalThis.fetch = async () => new Response(responseXml, {
        status: 200,
        headers: { "content-type": "application/xml;charset=UTF-8" },
      });
      const operation = await executeChannelOperation({
        channel: "elevenst", operation: "inquiries.list", payload,
        arguments: { startDate: "20260902", endDate: "20260908", answerStatus: "00" },
        environment: "production",
      });
      assert.equal(operation.ok, false);
      assert.equal(operation.steps[0]?.ok, false);
      assert.equal(operation.steps[0]?.data.accepted, false);
      assert.equal(operation.steps[0]?.data.sellerpilotProductQnaParserReady, false);
      assert.equal(
        operation.steps[0]?.data.sellerpilotElevenstProductQnaParseError,
        "ELEVENST_PRODUCT_QNA_DOCUMENT_INVALID",
      );
      assert.deepEqual(operation.steps[0]?.data.productQnas, []);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st Product Q&A preserves ordinary CDATA field text without treating it as XML structure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    `<productQnas><productQna>
      <brdInfoNo>81234567</brdInfoNo>
      <brdInfoCont><![CDATA[배송 <확인> & 안내]]></brdInfoCont>
    </productQna></productQnas>`,
    { status: 200, headers: { "content-type": "application/xml;charset=UTF-8" } },
  );
  try {
    const operation = await executeChannelOperation({
      channel: "elevenst", operation: "inquiries.list", payload,
      arguments: { startDate: "20260902", endDate: "20260908", answerStatus: "00" },
      environment: "production",
    });
    assert.equal(operation.ok, true);
    assert.equal(operation.steps[0]?.data.sellerpilotProductQnaParserReady, true);
    assert.equal(
      (operation.steps[0]?.data.productQnas as Array<Record<string, unknown>>)[0]?.brdInfoCont,
      "배송 <확인> & 안내",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function qnaRowsXml(count: number) {
  return `<ProductQnas>${Array.from(
    { length: count },
    (_, index) => `<productQna><brdInfoNo>${index + 1}</brdInfoNo></productQna>`,
  ).join("")}</ProductQnas>`;
}

test("11st Product Q&A accepts complete batches at the 499 and 500 row DB boundary", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const count of [499, 500]) {
      globalThis.fetch = async () => new Response(qnaRowsXml(count), {
        status: 200,
        headers: { "content-type": "application/xml;charset=UTF-8" },
      });
      const operation = await executeChannelOperation({
        channel: "elevenst", operation: "inquiries.list", payload,
        arguments: { startDate: "20260902", endDate: "20260908", answerStatus: "00" },
        environment: "production",
      });
      assert.equal(operation.ok, true);
      assert.equal(operation.steps[0]?.data.accepted, true);
      assert.equal(operation.steps[0]?.data.sellerpilotProductQnaParserReady, true);
      assert.equal(operation.steps[0]?.data.sellerpilotElevenstProductQnaObservedRows, count);
      assert.equal(operation.steps[0]?.data.sellerpilotElevenstProductQnaParseIncomplete, false);
      assert.equal((operation.steps[0]?.data.productQnas as unknown[]).length, count);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st Product Q&A fails closed above the 500 row DB boundary", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const count of [501, 5_000]) {
      globalThis.fetch = async () => new Response(qnaRowsXml(count), {
        status: 200,
        headers: { "content-type": "application/xml;charset=UTF-8" },
      });
      const operation = await executeChannelOperation({
        channel: "elevenst", operation: "inquiries.list", payload,
        arguments: { startDate: "20260902", endDate: "20260908", answerStatus: "00" },
        environment: "production",
      });
      assert.equal(operation.ok, false);
      assert.equal(operation.steps[0]?.data.accepted, false);
      assert.equal(operation.steps[0]?.data.sellerpilotProductQnaParserReady, false);
      assert.equal(operation.steps[0]?.data.sellerpilotElevenstProductQnaObservedRows, count);
      assert.equal(operation.steps[0]?.data.sellerpilotElevenstProductQnaParseIncomplete, true);
      assert.equal(
        operation.steps[0]?.data.sellerpilotElevenstProductQnaParseError,
        "ELEVENST_PRODUCT_QNA_DB_BATCH_LIMIT_EXCEEDED",
      );
      assert.deepEqual(operation.steps[0]?.data.productQnas, []);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st Product Q&A marks 5001 rows as parser overflow without truncating to success", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(qnaRowsXml(5_001), {
    status: 200,
    headers: { "content-type": "application/xml;charset=UTF-8" },
  });
  try {
    const operation = await executeChannelOperation({
      channel: "elevenst", operation: "inquiries.list", payload,
      arguments: { startDate: "20260902", endDate: "20260908", answerStatus: "00" },
      environment: "production",
    });
    assert.equal(operation.ok, false);
    assert.equal(operation.steps[0]?.data.accepted, false);
    assert.equal(operation.steps[0]?.data.sellerpilotProductQnaParserReady, false);
    assert.equal(operation.steps[0]?.data.sellerpilotElevenstProductQnaObservedRows, 5_001);
    assert.equal(operation.steps[0]?.data.sellerpilotElevenstProductQnaParseIncomplete, true);
    assert.equal(
      operation.steps[0]?.data.sellerpilotElevenstProductQnaParseError,
      "ELEVENST_PRODUCT_QNA_PARSER_ROW_LIMIT_EXCEEDED",
    );
    assert.deepEqual(operation.steps[0]?.data.productQnas, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st Q&A list rejects invalid dates, status and ranges before provider access", async () => {
  for (const arguments_ of [
    { startDate: "20260901", endDate: "20260908", answerStatus: "00" },
    { startDate: "20260230", endDate: "20260301", answerStatus: "00" },
    { startDate: "20260902", endDate: "20260908", answerStatus: "03" },
    { startDate: "20260908", endDate: "20260902", answerStatus: "00" },
  ]) {
    await assert.rejects(executeChannelOperation({
      channel: "elevenst", operation: "inquiries.list", payload,
      arguments: arguments_, environment: "production",
    }), /ELEVENST_INQUIRY_RANGE_INVALID|CHANNEL_ARGUMENT_INVALID/u);
  }
});

test("11st answered rows retain date-only answers without inventing message order", () => {
  const inquiries = normalizeChannelInquiries("elevenst", qnaResult([{
    answerCont: "오늘 출고했습니다.", answerDt: "2026-09-08", answerYn: "Y",
    brdInfoClfNo: "13749310594", brdInfoCont: "언제 출고되나요?", brdInfoNo: "81234568",
    brdInfoSbjct: "출고 문의", buyYn: "Y", createDt: "2026-09-08 09:00:00",
    dispYn: "Y", customerName: "고객B", prdNm: "테스트 상품", qnaDtlsCd: "02",
    qnaDtlsCdNm: "배송", ordNoDe: "", ordStlEndDt: "",
  }]), now.toISOString());
  assert.equal(inquiries.length, 1);
  assert.equal(inquiries[0]?.providerStatus, "answered");
  assert.deepEqual(inquiries[0]?.providerContext.unsequencedAnswers, [{
    body: "오늘 출고했습니다.", reason: "provider_timestamp_unavailable",
  }]);
});

test("11st answered rows fail closed when the answer body or answer date is missing", () => {
  const base = {
    answerCont: "오늘 출고했습니다.", answerDt: "2026-09-08", answerYn: "Y",
    brdInfoClfNo: "13749310594", brdInfoCont: "언제 출고되나요?", brdInfoNo: "81234568",
    brdInfoSbjct: "출고 문의", buyYn: "Y", createDt: "2026-09-08 09:00:00",
    dispYn: "Y", customerName: "고객B", prdNm: "테스트 상품", qnaDtlsCd: "02",
    qnaDtlsCdNm: "배송", ordNoDe: "", ordStlEndDt: "",
  };
  for (const row of [
    { ...base, answerCont: "" },
    { ...base, answerDt: "" },
  ]) {
    assert.throws(
      () => normalizeChannelInquiries("elevenst", qnaResult([row]), now.toISOString()),
      /INQUIRY_RECORD_INVALID:elevenst/u,
    );
  }
});

test("11st Product Q&A reply escapes XML and accepts only an exact result identity", async () => {
  assert.deepEqual(buildInquiryReplyArguments(
    "elevenst", "elevenst:81234567", "확인 & <출고>",
    { brdInfoNo: "81234567", prdNo: "13749310594" },
  ), { brdInfoNo: "81234567", prdNo: "13749310594", reply: "확인 & <출고>" });
  const originalFetch = globalThis.fetch;
  let body = "";
  globalThis.fetch = async (_input, init) => {
    body = String(init?.body ?? "");
    return new Response("<ClientMessage><brdInfoNo>81234567</brdInfoNo><productNo>13749310594</productNo><message>success</message><resultCode>200</resultCode></ClientMessage>", {
      status: 200, headers: { "content-type": "application/xml;charset=UTF-8" },
    });
  };
  try {
    const operation = await executeChannelOperation({
      channel: "elevenst", operation: "inquiries.reply", payload,
      arguments: { brdInfoNo: "81234567", prdNo: "13749310594", reply: "확인 & <출고>" },
      environment: "production",
    });
    assert.equal(operation.ok, true);
    assert.equal(operation.remoteId, "81234567");
    assert.match(body, /<ProductQna><answerCont>확인 &amp; &lt;출고&gt;<\/answerCont><\/ProductQna>/u);
    assert.equal(hasProviderReplyAcceptance(operation), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st reply result code or returned identity mismatch fails closed", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const responseXml of [
      "<ClientMessage><brdInfoNo>81234567</brdInfoNo><productNo>999</productNo><resultCode>200</resultCode></ClientMessage>",
      "<ClientMessage><brdInfoNo>81234567</brdInfoNo><productNo>13749310594</productNo><resultCode>500</resultCode></ClientMessage>",
    ]) {
      globalThis.fetch = async () => new Response(responseXml, { status: 200, headers: { "content-type": "application/xml;charset=UTF-8" } });
      const operation = await executeChannelOperation({
        channel: "elevenst", operation: "inquiries.reply", payload,
        arguments: { brdInfoNo: "81234567", prdNo: "13749310594", reply: "확인했습니다." },
        environment: "production",
      });
      assert.equal(operation.ok, false);
      assert.equal(hasProviderReplyAcceptance(operation), false);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
