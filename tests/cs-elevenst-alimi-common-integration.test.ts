import assert from "node:assert/strict";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/operations";
import { normalizeChannelInquiries } from "../lib/channels/inquiry-sync";

test("11st common Alimi parser and inquiry projection preserve safe exact identifiers", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(`<?xml version="1.0" encoding="UTF-8"?>
    <alimi><result_code>0</result_code><alimListInfo>
      <emerNtceSeq>5590778</emerNtceSeq><emerCtntSeq>1</emerCtntSeq>
      <emerTypeCd>01</emerTypeCd><emerNtceCrntCd>04</emerNtceCrntCd>
      <emerNtceClfNo1>10</emerNtceClfNo1><emerNtceSubject>배송 확인 요청</emerNtceSubject>
      <emerCtnt>확인이 필요합니다.</emerCtnt><createDt>20260908</createDt><createTm>12:30:30</createTm>
      <emerReplyDt>20260909</emerReplyDt><ordNo>202609080001</ordNo><ordPrdSeq>1</ordPrdSeq>
      <memId>must-not-survive</memId><memNm>must-not-survive</memNm>
      <emerReplyList><emerReplyCtnt>과거 답변</emerReplyCtnt></emerReplyList>
    </alimListInfo></alimi>`, { status: 200, headers: { "content-type": "application/xml;charset=UTF-8" } });
  try {
    const operation = await executeChannelOperation({
      channel: "elevenst",
      operation: "inquiries.list",
      payload: { api_key: "fixture-key" },
      arguments: { kind: "urgent_alimi", startDate: "20260810", endDate: "20260908" },
      environment: "production",
    });
    assert.equal(operation.ok, true);
    assert.doesNotMatch(JSON.stringify(operation), /must-not-survive|memId|memNm/u);
    const rows = normalizeChannelInquiries("elevenst", operation, "2026-09-08T07:30:00.000Z");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.externalTicketId, "elevenst:alimi:5590778");
    assert.equal(rows[0]?.remoteMessageId, "alimi:5590778:1:inbound");
    assert.equal(rows[0]?.senderRole, "customer");
    assert.equal(rows[0]?.providerContext.kind, "urgent_inquiry");
    assert.equal(rows[0]?.providerStatus, "waiting");
    assert.equal(rows[0]?.providerContext.replySupported, false);
    assert.deepEqual(rows[0]?.providerContext.unsequencedReplies, [{
      body: "과거 답변", reason: "provider_timestamp_unavailable",
    }]);
    assert.deepEqual(rows[0]?.replyContext, {});
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("11st common Alimi parser rejects 5001 rows as incomplete instead of truncating to success", async () => {
  const originalFetch = globalThis.fetch;
  const row = `<alimListInfo><emerNtceSeq>1</emerNtceSeq></alimListInfo>`;
  globalThis.fetch = async () => new Response(
    `<alimi><result_code>0</result_code>${row.repeat(5_001)}</alimi>`,
    { status: 200, headers: { "content-type": "application/xml;charset=UTF-8" } },
  );
  try {
    const operation = await executeChannelOperation({
      channel: "elevenst",
      operation: "inquiries.list",
      payload: { api_key: "fixture-key" },
      arguments: { kind: "urgent_alimi", startDate: "20260810", endDate: "20260908" },
      environment: "production",
    });
    assert.equal(operation.ok, false);
    assert.equal(operation.steps[0]?.data.sellerpilotElevenstAlimiObservedRows, 5_001);
    assert.equal(operation.steps[0]?.data.sellerpilotElevenstAlimiParseIncomplete, true);
    assert.equal(operation.steps[0]?.data.sellerpilotElevenstAlimiParseError, "ELEVENST_ALIMI_ROW_LIMIT_EXCEEDED");
    assert.deepEqual(operation.steps[0]?.data.alimListInfos, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
