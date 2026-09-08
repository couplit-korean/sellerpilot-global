import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeClaimedLazadaRawReceipt,
  reprocessPendingLazadaRawReceipts,
  type LazadaRawReprocessRpc,
} from "../lib/channels/lazada-raw-reprocess";

const id = "00000000-0000-4000-8000-000000000201";
const credentialId = "00000000-0000-4000-8000-000000000202";
const claimToken = "00000000-0000-4000-8000-000000000203";
const expiresAt = "2026-10-01T00:00:00.000Z";

const webhookRaw = JSON.stringify({
  seller_id: "2001",
  data: JSON.stringify({
    site_id: "MY",
    session_id: "session-1",
    message_id: "message-1",
    content: JSON.stringify({ txt: "배송 문의" }),
    from_account_type: 1,
    status: 0,
    type: 1,
    template_id: 1,
    send_time: 1_788_200_000_000,
  }),
});

function claim(rawBody = webhookRaw, attemptCount = 1) {
  return {
    contract: "lazada_im_raw_claim_v1",
    claimToken,
    receipts: [{
      id,
      credentialId,
      sourceKind: "webhook",
      rawBody,
      parserVersion: "lazada-im-parser/1",
      attemptCount,
      expiresAt,
      claimToken,
    }],
  };
}

test("reprocessor decodes the exact webhook envelope including JSON-string data", () => {
  const [inquiry] = normalizeClaimedLazadaRawReceipt({ sourceKind: "webhook", rawBody: webhookRaw });
  assert.equal(inquiry.externalTicketId, "lazada-im:session-1");
  assert.equal(inquiry.remoteMessageId, "message-1");
  assert.equal(inquiry.message, "배송 문의");
});

test("reprocessor projects retained history pages with their native session identity", () => {
  const history = JSON.stringify({
    sellerpilotSession: { session_id: "history-session", site_id: "MY" },
    data: { message_list: [{
      message_id: "history-message",
      from_account_type: 1,
      status: 0,
      type: 1,
      template_id: 1,
      send_time: 1_788_200_000_000,
      content: { txt: "과거 문의" },
    }] },
  });
  const [inquiry] = normalizeClaimedLazadaRawReceipt({ sourceKind: "history_page", rawBody: history });
  assert.equal(inquiry.externalTicketId, "lazada-im:history-session");
  assert.equal(inquiry.remoteMessageId, "history-message");
  assert.equal(inquiry.message, "과거 문의");
});

test("claimed receipts complete only after quarantine and inquiry ingestion", async () => {
  const calls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
  const rpc: LazadaRawReprocessRpc = async (name, arguments_) => {
    calls.push({ name, arguments_ });
    if (name === "sellerpilot_service_claim_lazada_im_raw_v1") return { data: claim(), error: null };
    if (name === "sellerpilot_service_lazada_im_ingest_ready_v3") return { data: true, error: null };
    if (name === "sellerpilot_service_lazada_quarantine_ready_v3") return { data: true, error: null };
    if (name === "sellerpilot_service_ingest_lazada_inquiries_v3") {
      return { data: { contract: "lazada_ingest_v3", status: "complete" }, error: null };
    }
    if (name === "sellerpilot_service_complete_lazada_im_raw_v1") {
      return { data: { contract: "lazada_im_raw_complete_v1", id, status: "normalized" }, error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  };

  assert.deepEqual(await reprocessPendingLazadaRawReceipts(rpc), {
    claimed: 1, normalized: 1, unsupported: 0, retried: 0, failed: 0, claimFailed: false,
  });
  assert.deepEqual(calls.map(({ name }) => name), [
    "sellerpilot_service_claim_lazada_im_raw_v1",
    "sellerpilot_service_lazada_im_ingest_ready_v3",
    "sellerpilot_service_ingest_lazada_inquiries_v3",
    "sellerpilot_service_complete_lazada_im_raw_v1",
  ]);
  assert.equal(calls[2].arguments_.p_credential_id, credentialId);
  assert.equal((calls[2].arguments_.p_inquiries as Array<Record<string, unknown>>)[0].remoteMessageId, "message-1");
  assert.equal(calls[3].arguments_.p_outcome, "normalized");
  assert.equal(calls[3].arguments_.p_parser_version, "lazada-im-parser/2");
});

test("unprojectable input is terminal while transient ingestion is retried", async () => {
  let claimed = claim("{}");
  const completions: string[] = [];
  const rpc: LazadaRawReprocessRpc = async (name, arguments_) => {
    if (name === "sellerpilot_service_claim_lazada_im_raw_v1") return { data: claimed, error: null };
    if (name === "sellerpilot_service_ingest_lazada_inquiries_v3") {
      return { data: null, error: { message: "temporary" } };
    }
    if (name === "sellerpilot_service_complete_lazada_im_raw_v1") {
      const outcome = String(arguments_.p_outcome); completions.push(outcome);
      return { data: { contract: "lazada_im_raw_complete_v1", id, status: outcome === "retry" ? "pending" : outcome }, error: null };
    }
    return { data: true, error: null };
  };
  assert.equal((await reprocessPendingLazadaRawReceipts(rpc)).unsupported, 1);
  claimed = claim();
  assert.equal((await reprocessPendingLazadaRawReceipts(rpc)).retried, 1);
  assert.deepEqual(completions, ["unsupported", "retry"]);
});

test("a retry exhausted by the completion RPC is reported as failed, not retried", async () => {
  const rpc: LazadaRawReprocessRpc = async (name, arguments_) => {
    if (name === "sellerpilot_service_claim_lazada_im_raw_v1") {
      return { data: claim(webhookRaw, 5), error: null };
    }
    if (name === "sellerpilot_service_lazada_quarantine_ready_v3") {
      return { data: true, error: null };
    }
    if (name === "sellerpilot_service_ingest_lazada_inquiries_v3") {
      return { data: null, error: { message: "temporary" } };
    }
    if (name === "sellerpilot_service_complete_lazada_im_raw_v1") {
      assert.equal(arguments_.p_outcome, "retry");
      return {
        data: { contract: "lazada_im_raw_complete_v1", id, status: "failed" },
        error: null,
      };
    }
    throw new Error(`unexpected rpc ${name}`);
  };

  assert.deepEqual(await reprocessPendingLazadaRawReceipts(rpc), {
    claimed: 1, normalized: 0, unsupported: 0, retried: 0, failed: 1, claimFailed: false,
  });
});

test("malformed claims and completion transport loss fail closed without aborting the batch", async () => {
  const forged = { ...claim(), receipts: [{ ...claim().receipts[0], claimToken: "00000000-0000-4000-8000-000000000299" }] };
  assert.equal((await reprocessPendingLazadaRawReceipts(async () => ({ data: forged, error: null }))).claimFailed, true);
  const result = await reprocessPendingLazadaRawReceipts(async (name) => {
    if (name === "sellerpilot_service_claim_lazada_im_raw_v1") return { data: claim("{}"), error: null };
    throw new Error("database unavailable");
  });
  assert.deepEqual(result, {
    claimed: 1, normalized: 0, unsupported: 0, retried: 0, failed: 1, claimFailed: false,
  });
});
