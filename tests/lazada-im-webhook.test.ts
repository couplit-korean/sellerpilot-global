import assert from "node:assert/strict";
import test from "node:test";
import {
  markLazadaImRawEvent,
  parseLazadaImWebhookBody,
  persistLazadaImInquiry,
  persistLazadaImRawEvent,
} from "../lib/channels/lazada-im-webhook";
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
  }, undefined, async () => ({ data: true, error: null }));

  assert.deepEqual(result, { ok: false, status: 500 });
});

test("Lazada V3 readiness blocks ingestion before any write and rejects a V2 receipt", async () => {
  let writes = 0;
  const ingest = async () => {
    writes++;
    return { data: { contract: "lazada_ingest_v2", status: "complete" }, error: null };
  };
  assert.deepEqual(await persistLazadaImInquiry("credential-1", inquiry, ingest), { ok: false, status: 503 });
  for (const result of [{ data: false, error: null }, { data: null, error: { message: "missing RPC" } }]) {
    assert.deepEqual(await persistLazadaImInquiry("credential-1", inquiry, ingest, undefined, async () => result), { ok: false, status: 503 });
  }
  assert.equal(writes, 0);
  assert.deepEqual(await persistLazadaImInquiry("credential-1", inquiry, ingest, undefined, async () => ({ data: true, error: null })), { ok: false, status: 500 });
  assert.equal(writes, 1);
});

test("Lazada IM webhook exposes thrown transport errors and only succeeds after persistence", async () => {
  const thrown = await persistLazadaImInquiry("credential-1", inquiry, async () => {
    throw new Error("network failed");
  }, undefined, async () => ({ data: true, error: null }));
  const succeeded = await persistLazadaImInquiry("credential-1", inquiry, async () => ({ data: { contract: "lazada_ingest_v3", status: "complete" }, error: null }), undefined, async () => ({ data: true, error: null }));

  assert.deepEqual(thrown, { ok: false, status: 500 });
  assert.deepEqual(succeeded, { ok: true });
});

test("Lazada IM raw receipt validates the durable contract and exact identity", async () => {
  const stored = await persistLazadaImRawEvent("credential-1", '{"message_type":2}', async (arguments_) => {
    assert.deepEqual(arguments_, { p_credential_id: "credential-1", p_raw_body: '{"message_type":2}', p_source_kind: "webhook" });
    return { data: { contract: "lazada_im_raw_inbox_v1", status: "stored", id: "receipt-1", processingStatus: "pending" }, error: null };
  });
  assert.deepEqual(stored, { ok: true, receipt: { id: "receipt-1", processingStatus: "pending" } });
  assert.deepEqual(await persistLazadaImRawEvent("credential-1", "{}", async () => ({ data: { contract: "wrong" }, error: null })), { ok: false });
  assert.deepEqual(await persistLazadaImRawEvent("", "{}", async () => ({ data: null, error: null })), { ok: false });
  assert.equal(await markLazadaImRawEvent("credential-1", "receipt-1", "normalized", async (arguments_) => ({
    data: { contract: "lazada_im_raw_mark_v1", status: arguments_.p_processing_status, id: arguments_.p_id }, error: null,
  })), true);
  assert.equal(await markLazadaImRawEvent("credential-1", "receipt-1", "normalized", async () => ({ data: null, error: { message: "down" } })), false);
});
