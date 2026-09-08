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
    arguments: { startDate: "20260902", endDate: "20260908", answerStatus: "00" },
  }]);
  const history = inquiryHistorySyncRequests("elevenst", now, 30);
  assert.equal(history.length, 5);
  assert.deepEqual(history.map(({ arguments: value }) => value), [
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
