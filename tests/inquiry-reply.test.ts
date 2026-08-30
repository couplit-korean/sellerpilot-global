import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildInquiryReplyArguments,
  coupangContactCenterParentAnswerId,
  supportsInquiryReply,
} from "../lib/channels/inquiry-reply";
import { executeChannelOperation } from "../lib/channels/operations";

test("marketplace ticket identifiers become provider reply arguments", () => {
  assert.deepEqual(buildInquiryReplyArguments("qoo10", "qoo10:MSG:12345678:87654321", "확인했습니다."), {
    params: { inq_type: "MSG", question_no: "12345678", seq_no: "87654321", contents: "확인했습니다." },
  });
  assert.deepEqual(buildInquiryReplyArguments("lazada", "lazada-im:session-1", "We have checked."), {
    sessionId: "session-1",
    reply: "We have checked.",
  });
  assert.deepEqual(buildInquiryReplyArguments("coupang", "call-center:98765", "확인했습니다.", { parentAnswerId: "4321" }), {
    kind: "call-center",
    inquiryId: "98765",
    parentAnswerId: "4321",
    reply: "확인했습니다.",
  });
  assert.deepEqual(buildInquiryReplyArguments("smartstore", "456789", "확인했습니다."), {
    kind: "product",
    questionId: "456789",
    reply: "확인했습니다.",
  });
  assert.deepEqual(buildInquiryReplyArguments("smartstore", "customer:987654321", "확인했습니다."), {
    kind: "customer",
    inquiryNo: "987654321",
    reply: "확인했습니다.",
  });
  assert.equal(supportsInquiryReply("temu"), false);
  assert.throws(() => buildInquiryReplyArguments("qoo10", "123", "답변"), /qoo10InquiryId/);
  assert.throws(
    () => buildInquiryReplyArguments("coupang", "call-center:98765", "확인했습니다."),
    /coupangParentAnswerId/,
  );
  assert.throws(
    () => buildInquiryReplyArguments("coupang", "call-center:98765", "가", { parentAnswerId: "4321" }),
    /coupangReplyLength/,
  );
  assert.throws(
    () => buildInquiryReplyArguments("smartstore", "customer:0", "확인했습니다."),
    /smartstoreInquiryNo/,
  );
});

test("Coupang contact-center normalization preserves only an actionable parent answer", () => {
  assert.equal(coupangContactCenterParentAnswerId([
    { answerId: 10, needAnswer: false, partnerTransferStatus: "answered" },
    { answerId: 11, needAnswer: true, partnerTransferStatus: "requestAnswer" },
  ]), "11");
  assert.equal(coupangContactCenterParentAnswerId([
    { answerId: 10, needAnswer: false, partnerTransferStatus: "answered" },
  ]), "");
});

test("Qoo10 reply calls CSCenter.SetInquiryMessage with the official fields", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let calledBody = "";
  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledBody = String(init?.body ?? "");
    return Response.json({ ResultCode: 0, ResultObject: { SEQ_NO: 87654321 } });
  };
  try {
    const result = await executeChannelOperation({
      channel: "qoo10",
      operation: "inquiries.reply",
      payload: { api_key: "test-secret" },
      arguments: buildInquiryReplyArguments("qoo10", "qoo10:MSG:12345678:87654321", "확인했습니다."),
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.match(calledUrl, /CSCenter\.SetInquiryMessage/);
    assert.deepEqual(JSON.parse(calledBody), {
      returnType: "json",
      inq_type: "MSG",
      question_no: "12345678",
      seq_no: "87654321",
      contents: "확인했습니다.",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lazada reply sends a text message to the synced IM session", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let calledBody = new URLSearchParams();
  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledBody = new URLSearchParams(String(init?.body ?? ""));
    return Response.json({ code: "0", message: "success" });
  };
  try {
    const result = await executeChannelOperation({
      channel: "lazada",
      operation: "inquiries.reply",
      payload: { app_key: "app", app_secret: "test-secret", access_token: "test-token", country: "my" },
      arguments: buildInquiryReplyArguments("lazada", "lazada-im:session-1", "We have checked."),
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.match(calledUrl, /\/rest\/im\/message\/send$/);
    assert.equal(calledBody.get("session_id"), "session-1");
    assert.equal(calledBody.get("template_id"), "1");
    assert.equal(calledBody.get("txt"), "We have checked.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coupang reply uses the inquiry kind and WING responder ID", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let calledBody = "";
  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledBody = String(init?.body ?? "");
    return Response.json({ code: "200", message: "OK" });
  };
  try {
    const result = await executeChannelOperation({
      channel: "coupang",
      operation: "inquiries.reply",
      payload: {
        vendor_id: "A00012345",
        access_key: "test-access",
        secret_key: "test-secret",
        requested_by: "test-wing-user",
      },
      arguments: buildInquiryReplyArguments("coupang", "product:846", "입고 일정을 확인했습니다."),
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.match(calledUrl, /\/vendors\/A00012345\/onlineInquiries\/846\/replies$/);
    assert.deepEqual(JSON.parse(calledBody), {
      content: "입고 일정을 확인했습니다.",
      vendorId: "A00012345",
      replyBy: "test-wing-user",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coupang contact-center reply includes the exact inquiry and parent answer IDs", async () => {
  const originalFetch = globalThis.fetch;
  let calledBody = "";
  globalThis.fetch = async (_input, init) => {
    calledBody = String(init?.body ?? "");
    return Response.json({ code: "200", message: "OK" });
  };
  try {
    const result = await executeChannelOperation({
      channel: "coupang",
      operation: "inquiries.reply",
      payload: {
        vendor_id: "A00012345",
        access_key: "test-access",
        secret_key: "test-secret",
        requested_by: "test-wing-user",
      },
      arguments: buildInquiryReplyArguments(
        "coupang",
        "call-center:98765",
        "확인했습니다.",
        { parentAnswerId: "4321" },
      ),
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(calledBody), {
      vendorId: "A00012345",
      inquiryId: "98765",
      content: "확인했습니다.",
      replyBy: "test-wing-user",
      parentAnswerId: "4321",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Smartstore reply exchanges a token then updates the product Q&A", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    const call = { url: String(input), method: String(init?.method ?? "GET"), body: String(init?.body ?? "") };
    calls.push(call);
    if (call.url.includes("/oauth2/token")) return Response.json({ access_token: "test-token", expires_in: 10_800 });
    return new Response(null, { status: 204 });
  };
  try {
    const result = await executeChannelOperation({
      channel: "smartstore",
      operation: "inquiries.reply",
      payload: {
        client_id: "test-client",
        client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze",
        token_type: "SELF",
      },
      arguments: buildInquiryReplyArguments("smartstore", "456789", "확인했습니다."),
      environment: "production",
    });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /\/external\/v1\/contents\/qnas\/456789$/);
    assert.equal(calls[1].method, "PUT");
    assert.deepEqual(JSON.parse(calls[1].body), { answerContent: "확인했습니다." });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Smartstore customer reply accepts the official empty 200 response", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    const call = { url: String(input), method: String(init?.method ?? "GET"), body: String(init?.body ?? "") };
    calls.push(call);
    if (call.url.includes("/oauth2/token")) return Response.json({ access_token: "test-token", expires_in: 10_800 });
    return new Response(null, { status: 200 });
  };
  try {
    const execute = () => executeChannelOperation({
      channel: "smartstore",
      operation: "inquiries.reply",
      payload: {
        client_id: "test-client",
        client_secret: "$2b$12$WnE2VbmwC6wC9Q6oVt5Pze",
        token_type: "SELF",
      },
      arguments: {
        ...buildInquiryReplyArguments("smartstore", "customer:987654321", "확인했습니다."),
        answerTemplateId: "template-123",
      },
      environment: "production",
    });
    const result = await execute();
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /\/external\/v1\/pay-merchant\/inquiries\/987654321\/answer$/);
    assert.equal(calls[1].method, "POST");
    assert.deepEqual(JSON.parse(calls[1].body), {
      answerComment: "확인했습니다.",
      answerTemplateId: "template-123",
    });
    assert.equal(result.steps[0]?.data.sellerpilotInquiryKind, "customer");
    assert.equal(result.steps[0]?.data.sellerpilotVerification, "SMARTSTORE_CUSTOMER_INQUIRY_REPLY_HTTP_ACK");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CS route accepts one durable reply job and exposes delivery polling", () => {
  const route = readFileSync(new URL("../app/api/admin/cs/reply/route.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/20260825111757_harden_inquiry_reply_delivery_fence.sql", import.meta.url), "utf8");
  const lineageMigration = readFileSync(new URL("../supabase/migrations/20260825111810_harden_inquiry_reply_account_lineage.sql", import.meta.url), "utf8");
  const inquirySync = readFileSync(new URL("../lib/channels/inquiry-sync.ts", import.meta.url), "utf8");

  assert.match(route, /enqueueInquiryReplyViaChannelGateway/);
  assert.match(route, /sellerpilot_get_inquiry_reply_delivery/);
  assert.match(route, /status: 202/);
  assert.match(route, /accepted: true/);
  assert.doesNotMatch(route, /executeInquiryReplyViaChannelGateway/);
  assert.doesNotMatch(route, /executeChannelOperation/);
  assert.doesNotMatch(route, /sellerpilot_update_ticket/);
  assert.match(route, /CHANNEL_GATEWAY_STATIC_EGRESS_REQUIRED/);
  assert.match(route, /SERVERLESS_STATIC_EGRESS_REQUIRED/);
  assert.match(route, /staticEgressReady: false/);
  assert.match(route, /status: 409/);
  assert.match(migration, /sellerpilot_enqueue_inquiry_reply_gateway_job/);
  assert.match(migration, /for update/);
  assert.match(migration, /INQUIRY_REPLY_CONFLICT/);
  assert.match(migration, /guard_and_finalize_inquiry_reply_job/);
  assert.match(migration, /'ticket_reply_delivered'/);
  assert.match(migration, /'inquiries\.reply'/);
  assert.match(lineageMigration, /INQUIRY_REPLY_LINEAGE_UNBOUND/);
  assert.match(lineageMigration, /reply_gateway_job_id/);
  assert.match(lineageMigration, /DEDICATED_INQUIRY_REPLY_ENQUEUE_REQUIRED/);
  assert.match(lineageMigration, /reply_delivery_status = 'reconciliation_required'/);
  assert.match(lineageMigration, /parentAnswerId/);
  assert.match(inquirySync, /qoo10:\$\{inquiryType\}:\$\{questionNo\}:\$\{sequenceNo\}/);
});
