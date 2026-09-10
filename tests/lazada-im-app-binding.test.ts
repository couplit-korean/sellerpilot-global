import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { selectLazadaImWebhookRoute, authenticateLazadaImWebhook, boundLazadaImCredentialId, parseLazadaImWebhookBody, persistLazadaImInquiry } from "../lib/channels/lazada-im-webhook";
import { parseLazadaImPush } from "../lib/channels/lazada-im";
import { withLazadaProviderAccountIdentity } from "../lib/channels/provider-account-identity";

// Synthetic credentials and identities, not operational secrets.
const secret = withLazadaProviderAccountIdentity({ app_key: "commerce-app", app_secret: "commerce-test-secret", im_app_key: "im-app", im_app_secret: "im-test-secret", country: "my" }, { account_platform: "seller_center", country_user_info: [{ country: "my", seller_id: "2001", user_id: "3001" }] }).payload;
const credential = { credential_id: "fixture-credential", secret_payload: secret };
const payload = { seller_id: "2001", message_type: 2, data: { site_id: "MY", session_id: "session", message_id: "message", content: JSON.stringify({ txt: "문의 원문" }), from_account_type: 2, status: 0, type: 1, template_id: 1 } };
const raw = JSON.stringify(payload);
const sign = (body: string, app = "im-app", key = "im-test-secret") => createHmac("sha256", key).update(app + body).digest("hex");

test("IM signing uses only the explicit IM app pair and exact original bytes", () => {
  assert.deepEqual(authenticateLazadaImWebhook(raw, sign(raw), credential), { ok: true });
  assert.equal(authenticateLazadaImWebhook(raw, sign(raw, "commerce-app", "commerce-test-secret"), credential).ok, false);
  assert.equal(authenticateLazadaImWebhook(raw + " ", sign(raw), credential).ok, false);
  assert.equal(authenticateLazadaImWebhook(raw, sign(raw), { ...credential, secret_payload: { app_key: "im-app", app_secret: "im-test-secret" } }).ok, false);
  assert.equal(authenticateLazadaImWebhook(raw, sign(raw), { ...credential, secret_payload: { ...secret, im_app_secret: "" } }).ok, false);
  for (const signature of [null, "", "zz".repeat(32), "a".repeat(63), "a".repeat(65)]) assert.equal(authenticateLazadaImWebhook(raw, signature, credential).ok, false);
});

test("app key selectors and any signed app key must match the IM slot", () => {
  assert.equal(authenticateLazadaImWebhook(raw, sign(raw).toUpperCase(), credential, "im-app").ok, true);
  assert.equal(authenticateLazadaImWebhook(raw, sign(raw), credential, "commerce-app").ok, false);
  const mismatch = JSON.stringify({ ...payload, app_key: "commerce-app" });
  assert.equal(authenticateLazadaImWebhook(mismatch, sign(mismatch), credential).ok, false);
});

test("official signed POST self-test authenticates without fabricating an owner or GET challenge", () => {
  const probe = JSON.stringify({ message_type: 0, timestamp: 1603766859530, data: { order_status: "unpaid" } });
  assert.equal(authenticateLazadaImWebhook(probe, sign(probe), credential).ok, true);
  assert.equal(parseLazadaImPush(parseLazadaImWebhookBody(probe)!), null);
  assert.equal(boundLazadaImCredentialId(credential, JSON.parse(probe)), "");
  const modifiedTimestamp = probe.replace("1603766859530", "1603766859531");
  assert.equal(authenticateLazadaImWebhook(modifiedTimestamp, sign(probe), credential).ok, false);
});

test("seller binding requires provider-certified subject plus exact signed country and seller", () => {
  assert.equal(boundLazadaImCredentialId(credential, payload), "fixture-credential");
  assert.equal(boundLazadaImCredentialId(credential, { ...payload, seller_id: "9001" }), "");
  assert.equal(boundLazadaImCredentialId(credential, { ...payload, seller_id: undefined }), "");
  assert.equal(boundLazadaImCredentialId(credential, { ...payload, site: "lazada_sg" }), "");
  assert.equal(boundLazadaImCredentialId(credential, { ...payload, data: { ...payload.data, site_id: undefined } }), "");
  assert.equal(boundLazadaImCredentialId({ ...credential, secret_payload: { ...secret, provider_account_subject: undefined } }, payload), "");
  assert.equal(boundLazadaImCredentialId({ ...credential, secret_payload: { ...secret, country_user_info: [{ country: "my", seller_id: "9001", user_id: "3001" }] } }, payload), "");
});

test("authenticated unordered IM retains quarantine and V3 partial semantics", async () => {
  const inquiry = parseLazadaImPush(payload)!;
  assert.equal(inquiry.orderingStatus, "unverified");
  assert.equal(inquiry.receivedAt, "");
  let calls = 0;
  const result = await persistLazadaImInquiry(boundLazadaImCredentialId(credential, payload), inquiry, async () => { calls++; return { data: { contract: "lazada_ingest_v3", status: "partial" }, error: null }; }, async () => ({ data: true, error: null }), async () => ({ data: true, error: null }));
  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: false, status: 503, partial: true });
});

test("route orders signature and binding before persistence and keeps V3 retry response", async () => {
  const source = await readFile(new URL("../app/api/webhooks/lazada-im/route.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("const selection =") < source.indexOf("const ingestResult ="));
  assert.ok(source.indexOf("if (!selection.ok)") < source.indexOf("const ingestResult ="));
  assert.match(source, /sellerpilot_service_lazada_im_webhook_candidates_v1/);
  assert.doesNotMatch(source, /sellerpilot_get_active_credential_secret/);
  assert.match(source, /sellerpilot_service_ingest_lazada_inquiries_v3/);
  assert.match(source, /"retry-after": "300"/);
  assert.doesNotMatch(source, /LAZADA_APP_SECRET|LAZADA_APP_KEY|export async function GET/);
});

const candidateContract = (candidates: unknown[], overflow = false) => ({ contract: "lazada_im_webhook_candidates_v1", limit: 32, overflow, candidates });
const otherOwner = { credential_id: "other-owner-credential", secret_payload: withLazadaProviderAccountIdentity({ ...secret }, { account_platform: "seller_center", country_user_info: [{ country: "my", seller_id: "2002", user_id: "3002" }] }).payload };

test("shared IM app across owners routes only the exact authenticated seller", () => {
  const selected = selectLazadaImWebhookRoute(raw, sign(raw), candidateContract([otherOwner, credential]));
  assert.equal(selected.ok && selected.kind === "inquiry" && selected.credentialId, "fixture-credential");
  assert.deepEqual(selectLazadaImWebhookRoute(raw, sign(raw), candidateContract([otherOwner])), { ok: false, status: 503 });
  assert.deepEqual(selectLazadaImWebhookRoute(raw, sign(raw), candidateContract([credential, { ...credential, credential_id: "duplicate-seller" }])), { ok: false, status: 503 });
  assert.deepEqual(selectLazadaImWebhookRoute(raw, sign(raw), candidateContract([credential, credential])), { ok: false, status: 503 });
});

test("shared-app Verify needs one verified app, not one seller or invented subject", () => {
  const probe = JSON.stringify({ message_type: 0, data: { order_status: "unpaid" } });
  const uncertified = { credential_id: "unattested", secret_payload: { im_app_key: "im-app", im_app_secret: "im-test-secret" } };
  assert.deepEqual(selectLazadaImWebhookRoute(probe, sign(probe), candidateContract([credential, otherOwner, uncertified])), { ok: true, kind: "ignored" });
  const differentApp = { ...otherOwner, secret_payload: { ...otherOwner.secret_payload, im_app_key: "other-app" } };
  assert.deepEqual(selectLazadaImWebhookRoute(probe, sign(probe), candidateContract([credential, differentApp])), { ok: true, kind: "ignored" });
  assert.deepEqual(selectLazadaImWebhookRoute(raw, sign(raw), candidateContract([uncertified])), { ok: false, status: 503 });
});

test("wrong app, unknown selector and signatures reject before ownership decisions", () => {
  for (const selector of ["unknown-app", "commerce-app", ""]) assert.deepEqual(selectLazadaImWebhookRoute(raw, sign(raw), candidateContract([credential]), selector), { ok: false, status: 401 });
  assert.deepEqual(selectLazadaImWebhookRoute(raw, sign(raw), candidateContract([]), "unknown-app"), { ok: false, status: 401 });
  assert.deepEqual(selectLazadaImWebhookRoute(raw, sign(raw, "commerce-app", "commerce-test-secret"), candidateContract([credential])), { ok: false, status: 401 });
  assert.deepEqual(selectLazadaImWebhookRoute("not-json", sign("not-json"), candidateContract([credential])), { ok: false, status: 400 });
});

test("signed rich and recall messages normalize after raw storage while identity-less session updates remain pending", () => {
  for (const data of [
    { ...payload.data, from_account_type: 1, template_id: 3, content: { imgUrl: "https://sg-live.slatic.net/fixture.png" } },
    { ...payload.data, template_id: 10007, content: { title: "order card", orderId: "1234" } },
    { ...payload.data, status: 1 }, { ...payload.data, type: 2 },
    { ...payload.data, message_id: undefined },
    { site_id: "MY", session_id: "session", sync_type: "SESSION_UPDATE", unread_count: 0 },
  ]) {
    const body = JSON.stringify({ ...payload, data });
    const selected = selectLazadaImWebhookRoute(body, sign(body), candidateContract([credential]));
    if (data.message_id === undefined || data.sync_type === "SESSION_UPDATE") {
      assert.deepEqual(selected, { ok: true, kind: "raw", credentialId: "fixture-credential" });
    } else {
      assert.equal(selected.ok && selected.kind === "inquiry" && selected.credentialId, "fixture-credential");
    }
    assert.deepEqual(selectLazadaImWebhookRoute(body, sign(body), candidateContract([otherOwner])), { ok: false, status: 503 });
  }
});

test("a Verify-looking envelope cannot hide a message from the raw inbox", () => {
  const body = JSON.stringify({ ...payload, message_type: 0, data: { ...payload.data, status: 1 } });
  const selected = selectLazadaImWebhookRoute(body, sign(body), candidateContract([credential]));
  assert.equal(selected.ok && selected.kind === "inquiry" && selected.credentialId, "fixture-credential");
  if (selected.ok && selected.kind === "inquiry") {
    assert.equal(selected.inquiry.providerContext?.eventKind, "recalled");
  }
});

test("overflow or an old/malformed contract never authenticates a partial candidate list", () => {
  for (const result of [candidateContract([credential], true), candidateContract(Array(33).fill(credential)), { ...candidateContract([credential]), limit: 33 }, { ...candidateContract([credential]), contract: "old" }, { ...candidateContract([credential]), overflow: undefined }, candidateContract([credential, {}])]) assert.deepEqual(selectLazadaImWebhookRoute(raw, sign(raw), result), { ok: false, status: 503 });
});

test("routing failures and signed probes cause zero inquiry writes; V3 remains partial", async () => {
  let writes = 0;
  const dispatch = async (body: string, rows: unknown[]) => {
    const selection = selectLazadaImWebhookRoute(body, sign(body), candidateContract(rows));
    if (!selection.ok || selection.kind !== "inquiry") return selection;
    return persistLazadaImInquiry(selection.credentialId, selection.inquiry, async () => { writes++; return { data: { contract: "lazada_ingest_v3", status: "partial" }, error: null }; }, async () => ({ data: true, error: null }), async () => ({ data: true, error: null }));
  };
  await dispatch(raw, [otherOwner]);
  await dispatch(raw, [credential, { ...credential, credential_id: "duplicate" }]);
  await dispatch(JSON.stringify({ message_type: 0 }), [credential, otherOwner]);
  assert.equal(writes, 0);
  assert.deepEqual(await dispatch(raw, [otherOwner, credential]), { ok: false, status: 503, partial: true });
  assert.equal(writes, 1);
});

test("actual POST uses bounded RPC contract and never returns candidates or writes an ambiguous owner", async () => {
  const originalFetch = globalThis.fetch;
  const priorKey = process.env.SUPABASE_SECRET_KEY;
  const priorUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.SUPABASE_SECRET_KEY = "fixture-service-only";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.invalid";
  let candidates: unknown = candidateContract([otherOwner, credential]);
  let writes: Record<string, unknown>[] = [];
  const rawReceipts = new Map<string, string>();
  let rawWrites = 0;
  let rawMarks = 0;
  let quarantineReady = true;
  let ingestStatus = "partial";
  const calls: string[] = [];
  // Every possible fetch is intercepted. No network fallback or real database.
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const rpc = new URL(url).pathname.split("/").at(-1)!;
    calls.push(rpc);
    const body = JSON.parse(String(init?.body ?? "{}"));
    let response: unknown;
    if (rpc === "sellerpilot_service_lazada_im_webhook_candidates_v1") response = candidates;
    else if (rpc === "sellerpilot_service_store_lazada_im_raw_event_v1") {
      rawWrites++;
      const rawBody = String(body.p_raw_body);
      const existing = rawReceipts.get(rawBody);
      const id = existing ?? `receipt-${rawReceipts.size + 1}`;
      rawReceipts.set(rawBody, id);
      response = { contract: "lazada_im_raw_inbox_v1", status: existing ? "duplicate" : "stored", id, processingStatus: "pending" };
    }
    else if (rpc === "sellerpilot_service_mark_lazada_im_raw_event_v1") {
      rawMarks++;
      response = { contract: "lazada_im_raw_mark_v1", status: body.p_processing_status, id: body.p_id };
    }
    else if (rpc === "sellerpilot_service_lazada_im_ingest_ready_v3") response = true;
    else if (rpc === "sellerpilot_service_lazada_quarantine_ready_v3") response = quarantineReady;
    else if (rpc === "sellerpilot_service_ingest_lazada_inquiries_v3") { writes.push(body); response = { contract: "lazada_ingest_v3", status: ingestStatus }; }
    else throw new Error("Unexpected mock RPC; network is disabled");
    return new Response(JSON.stringify(response), { headers: { "content-type": "application/json" } });
  };
  try {
    const { POST } = await import("../app/api/webhooks/lazada-im/route");
    const send = (body: string, signature = sign(body), query = "") => POST(new Request(`https://fixture.invalid/api/webhooks/lazada-im${query}`, { method: "POST", headers: { authorization: signature }, body }));
    const partial = await send(raw);
    assert.equal(partial.status, 503); assert.equal(partial.headers.get("retry-after"), "300");
    assert.equal(writes.length, 1); assert.equal(writes[0].p_credential_id, "fixture-credential");
    assert.equal(rawWrites, 1); assert.equal(rawMarks, 0);
    assert.equal((await partial.json()).partial, true);
    writes = [];
    candidates = candidateContract([credential, { ...credential, credential_id: "duplicate-owner" }]);
    assert.equal((await send(raw)).status, 503);
    candidates = candidateContract([otherOwner]);
    assert.equal((await send(raw)).status, 503);
    candidates = candidateContract([credential, otherOwner]);
    const mediaBody = JSON.stringify({ ...payload, data: { ...payload.data, template_id: 3, content: { imgUrl: "https://sg-live.slatic.net/fixture.png" } } });
    ingestStatus = "complete";
    const mediaResult = await send(mediaBody);
    assert.equal(mediaResult.status, 200);
    assert.deepEqual(await mediaResult.json(), { ok: true });
    assert.equal(writes.length, 1);
    assert.equal(rawMarks, 1);
    const storedMedia = (writes[0].p_inquiries as Array<Record<string, unknown>>)[0];
    assert.equal((storedMedia.providerContext as Record<string, unknown>).eventKind, "image");
    writes = [];
    const undatedBuyerBody = JSON.stringify({ ...payload, timestamp: 1788600000000,
      data: { ...payload.data, from_account_type: 1 } });
    quarantineReady = false;
    const undatedBuyerResult = await send(undatedBuyerBody);
    assert.equal(undatedBuyerResult.status, 503);
    assert.equal(undatedBuyerResult.headers.get("retry-after"), "300");
    assert.equal(writes.length, 0, "no fabricated collection-time inquiry is written");
    quarantineReady = true;
    ingestStatus = "complete";
    assert.equal((await send(undatedBuyerBody)).status, 200);
    assert.equal(writes.length, 1, "acknowledgement follows the new readiness and durable receipt");
    assert.equal(rawMarks, 2, "normalization acknowledgement follows durable inquiry ingestion");
    const storedBuyer = (writes[0].p_inquiries as Array<Record<string, unknown>>)[0];
    assert.equal(storedBuyer.receivedAt, "");
    assert.equal(storedBuyer.orderingStatus, "unverified");
    assert.notEqual(storedBuyer.senderRole, "seller");
    writes = [];
    const verified = await send(JSON.stringify({ message_type: 0, timestamp: 1603766859530 }));
    assert.equal(verified.status, 200); assert.deepEqual(await verified.json(), { ok: true, ignored: true });
    assert.equal((await send(raw, sign(raw), "?app_key=unknown")).status, 401);
    assert.equal((await send(raw, sign(raw, "commerce-app", "commerce-test-secret"))).status, 401);
    candidates = candidateContract([credential], true);
    const overflow = await send(raw);
    assert.equal(overflow.status, 503);
    assert.doesNotMatch(await overflow.text(), /fixture-credential|im-test-secret|secret_payload|candidates/);
    assert.equal(writes.length, 0);
    assert.ok(calls.includes("sellerpilot_service_lazada_im_webhook_candidates_v1"));
    assert.ok(calls.includes("sellerpilot_service_store_lazada_im_raw_event_v1"));
    assert.ok(!calls.includes("sellerpilot_get_active_credential_secret"));
  } finally {
    globalThis.fetch = originalFetch;
    if (priorKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = priorKey;
    if (priorUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = priorUrl;
  }
});
