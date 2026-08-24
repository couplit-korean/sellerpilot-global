import assert from "node:assert/strict";
import test from "node:test";
import { parseLazadaImWebhookBody, persistLazadaImInquiry } from "../lib/channels/lazada-im-webhook";
import type { LazadaImInquiry } from "../lib/channels/lazada-im";

const inquiry: LazadaImInquiry = {
  externalTicketId: "lazada-im:session-1",
  customerName: "Lazada 고객",
  subject: "Lazada MY IM 문의",
  message: "배송일을 알려주세요",
  status: "waiting",
  priority: 3,
  receivedAt: "2026-08-25T00:00:00.000Z",
  remoteMessageId: "message-1",
};

test("Lazada IM webhook decodes its nested JSON data and rejects malformed bodies", () => {
  assert.deepEqual(parseLazadaImWebhookBody(JSON.stringify({ data: JSON.stringify({ session_id: "session-1" }) })), {
    data: { session_id: "session-1" },
  });
  assert.equal(parseLazadaImWebhookBody("[]"), null);
  assert.equal(parseLazadaImWebhookBody(JSON.stringify({ data: "{not-json" })), null);
  assert.equal(parseLazadaImWebhookBody(JSON.stringify({ data: "[]" })), null);
});

test("Lazada IM webhook never acknowledges a missing credential identity", async () => {
  let called = false;
  const result = await persistLazadaImInquiry("", inquiry, async () => {
    called = true;
    return { error: null };
  });

  assert.deepEqual(result, { ok: false, status: 503 });
  assert.equal(called, false);
});

test("Lazada IM webhook exposes database rejection as retryable server failure", async () => {
  const result = await persistLazadaImInquiry("credential-1", inquiry, async (arguments_) => {
    assert.equal(arguments_.p_credential_id, "credential-1");
    assert.equal(arguments_.p_channel, "lazada");
    assert.deepEqual(arguments_.p_inquiries, [inquiry]);
    return { error: { message: "database unavailable" } };
  });

  assert.deepEqual(result, { ok: false, status: 500 });
});

test("Lazada IM webhook exposes thrown transport errors and only succeeds after persistence", async () => {
  const thrown = await persistLazadaImInquiry("credential-1", inquiry, async () => {
    throw new Error("network failed");
  });
  const succeeded = await persistLazadaImInquiry("credential-1", inquiry, async () => ({ error: null }));

  assert.deepEqual(thrown, { ok: false, status: 500 });
  assert.deepEqual(succeeded, { ok: true });
});
