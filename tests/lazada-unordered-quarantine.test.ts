import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseLazadaImPush, normalizeLazadaImHistory } from "../lib/channels/lazada-im";
import { persistLazadaImInquiry, lazadaQuarantineReady } from "../lib/channels/lazada-im-webhook";
registerHooks({ resolve(s,c,n) { return s === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export default {}" } : n(s,c); } });
const { normalizeChannelInquiries } = await import("../lib/channels/inquiry-sync");
const unordered = () => parseLazadaImPush({ timestamp: 1788600000000, data: {
  session_id: "s", message_id: "m", from_account_type: 2,
  buyer_name: "unnecessary personal name", content: { txt: "  Original seller body\n", translateTxt: "not original" },
} })!;

test("unordered seller push preserves original body and refuses an old database before ingest", async () => {
  const inquiry = unordered();
  assert.equal(inquiry.message, "  Original seller body\n");
  assert.equal(inquiry.receivedAt, "");
  assert.equal(inquiry.status, "waiting");
  let writes = 0;
  const ingest = async () => { writes++; return { data: { contract: "lazada_ingest_v2", status: "complete" }, error: null }; };
  assert.deepEqual(await persistLazadaImInquiry("credential", inquiry, ingest), { ok: false, status: 503 });
  for (const result of [{ data: false, error: null }, { data: null, error: { message: "missing RPC" } }]) {
    assert.deepEqual(await persistLazadaImInquiry("credential", inquiry, ingest, async () => result), { ok: false, status: 503 });
  }
  assert.equal(writes, 0);
  assert.deepEqual(await persistLazadaImInquiry("credential", inquiry, ingest, async () => ({ data: true, error: null })), { ok: true });
  assert.equal(writes, 1);
  assert.equal(await lazadaQuarantineReady([{}]), true);
});

test("normalization retains quarantine marker and prefers confirmed duplicate evidence", () => {
  const seller = { message_id: "m", from_account_type: 2, content: { txt: "original" } };
  const step = (messages: unknown[]) => ({ name: "inquiries-message:s:1", ok: true, status: 200, data: { sellerpilotSession: { session_id: "s" }, data: { message_list: messages } } });
  const result = { ok: true, channel: "lazada" as const, operation: "inquiries.list" as const, safeMessage: "fixture", steps: [step([seller])] };
  const [normalized] = normalizeChannelInquiries("lazada", result, "2026-09-05T10:00:00Z");
  assert.equal(normalized.orderingStatus, "unverified");
  assert.equal(normalized.providerStatus, "waiting");
  assert.equal(normalized.receivedAt, "");
  for (const messages of [[seller, { ...seller, send_time: "2026-09-05T09:00:00Z" }], [{ ...seller, send_time: "2026-09-05T09:00:00Z" }, seller]]) {
    const rows = normalizeLazadaImHistory([step(messages)]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].orderingStatus, undefined);
    assert.equal(rows[0].receivedAt, "2026-09-05T09:00:00.000Z");
  }
});

test("both worker completion boundaries check quarantine readiness before committing", async () => {
  for (const file of ["../lib/channels/serverless-cs-gateway.ts", "../app/api/channel-gateway/worker/complete/route.ts"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    const guard = source.indexOf('!await lazadaQuarantineReady(normalizedInquiries');
    const completion = source.indexOf('p_normalized_inquiries: normalizedInquiries', guard);
    assert.ok(guard > 0 && completion > guard);
    assert.match(source.slice(guard, completion), /sellerpilot_service_lazada_quarantine_ready/);
  }
});


test("webhook never acknowledges V2 partial quarantine as complete", async () => {
  const result = await persistLazadaImInquiry("credential", unordered(), async () => ({ data: { contract: "lazada_ingest_v2", status: "partial", normalCount: 1, pendingCount: 1 }, error: null }), async () => ({ data: true, error: null }));
  assert.deepEqual(result, { ok: false, status: 503, partial: true });
});

test("final normalization preserves both conflict originals and excludes either from answered state", () => {
  const seller = { message_id: "same", from_account_type: 2, content: { txt: "ORIGINAL" } };
  const result = { ok: true, channel: "lazada" as const, operation: "inquiries.list" as const, safeMessage: "fixture", steps: [{ name: "inquiries-message:s:1", ok: true, status: 200, data: { sellerpilotSession: { session_id: "s" }, data: { message_list: [seller, { ...seller, send_time: "2026-09-05T09:02:00Z", content: { txt: "CONFLICTING" } }] } } }] };
  const rows = normalizeChannelInquiries("lazada", result, "2026-09-05T10:00:00Z");
  assert.deepEqual(rows.map(row => row.message).sort(), ["CONFLICTING", "ORIGINAL"]);
  assert.equal(rows.every(row => row.orderingStatus === "conflict" && row.providerStatus === "waiting" && row.receivedAt === ""), true);
  assert.equal(new Set(rows.map(row => row.inboundKey)).size, 1, "same identity, separate bounded conflict evidence");
});
