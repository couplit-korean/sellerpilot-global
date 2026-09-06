import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as pages from "../lib/channels/ebay-message-pages";
import * as identity from "../lib/channels/provider-account-identity";
import * as contract from "../lib/cs/ebay-messages";

const source = await readFile(new URL("../app/api/admin/cs/ebay-messages/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const id = "11111111-1111-4111-8111-111111111111";
const subject = "ebay:eias:synthetic-eias-123456789";
const sellerKey = crypto.createHash("sha256").update(["ebay", "production", subject].join("\u001f")).digest("hex");
const account = { id, environment: "production", version: 1, seller_account_key: sellerKey, seller_account_key_source: "provider_certified_v1" };
const credential = { access_token: "fixture-token", client_secret: "fixture-secret", ebay_user_id: "seller", provider_account_identity_version: "v1", provider_account_subject: subject };
const message = { messageId: "message-native", body: "original text", subject: "", senderUsername: "buyer", recipientUsername: "seller", createdAt: "2026-09-01T00:00:00.123456Z", read: false, media: [] };
const conversation = { conversationId: "conversation-native", type: "FROM_MEMBERS", title: "title", status: "ACTIVE", createdAt: message.createdAt, referenceId: null, referenceType: null, latestMessage: message };

async function call(query: string, options: { denied?: boolean; accounts?: unknown[]; payload?: Record<string, unknown>; failure?: string; rpcError?: boolean; sender?: string; recipient?: string } = {}) {
  const calls: string[] = [];
  const pageInput: Array<Record<string, unknown>> = [];
  const rpc = async (name: string, args?: Record<string, unknown>) => {
    calls.push(name);
    if (name === "sellerpilot_list_owned_ebay_message_accounts") return { data: options.accounts ?? [account], error: options.rpcError ? {} : null };
    if (name === "sellerpilot_decrypt_credential") {
      assert.equal(args?.p_credential_id, id);
      return { data: options.payload ?? credential, error: null };
    }
    throw new Error(`unexpected RPC ${name}`);
  };
  const readPage = async (input: Record<string, unknown>) => {
    calls.push("provider-read"); pageInput.push(input);
    if (options.failure) throw new Error(options.failure);
    return { entries: [{ ...message, senderUsername: options.sender ?? message.senderUsername, recipientUsername: options.recipient ?? message.recipientUsername }], offset: Number(input.offset), total: 1, nextOffset: null, status: "ACTIVE", title: "title" };
  };
  const sandbox = vm.createContext({ exports: {}, Request, Response, URL, Object, Error, require(name: string) {
    if (name === "node:crypto") return crypto;
    if (name === "zod") return { z };
    if (name === "next/server") return { NextResponse: Response };
    if (name.endsWith("/admin-api")) return {
      authenticateAdminRequest: async () => options.denied ? Response.json({ message: "denied" }, { status: 403 }) : { user: { id: "owner" }, userClient: { rpc }, serviceClient: { rpc } },
      isAdminApiError: (value: unknown) => value instanceof Response,
    };
    if (name.endsWith("/provider-account-identity")) return identity;
    if (name.endsWith("/ebay-message-pages")) return {
      ebayConversationMessageRole: pages.ebayConversationMessageRole,
      readEbayConversationMessagesPage: readPage,
      readEbayConversationsPage: async (input: Record<string, unknown>) => ({ ...await readPage(input), entries: [conversation] }),
    };
    if (name.endsWith("/cs/ebay-messages")) return contract;
    throw new Error(`unexpected import ${name}`);
  } });
  vm.runInContext(compiled, sandbox);
  const response = await sandbox.exports.GET(new Request(`https://fixture.test/api/admin/cs/ebay-messages?${query}`)) as Response;
  return { response, body: await response.json(), calls, pageInput };
}
const listQuery = `view=conversations&credentialId=${id}`;
const messagesQuery = `view=messages&credentialId=${id}&conversationId=conversation-native`;

test("account discovery exposes owned metadata only and never decrypts or calls eBay", async () => {
  const result = await call("view=accounts");
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.calls, ["sellerpilot_list_owned_ebay_message_accounts"]);
  assert.equal(contract.ebayMessageAccountsSchema.parse(result.body).accounts[0].id, id);
  assert.doesNotMatch(JSON.stringify(result.body), /seller_account|fixture|eias/);
  assert.equal(result.response.headers.get("cache-control"), "private, no-store, max-age=0");
});

test("authorization, owner exclusion and invalid queries fail before decrypt/provider access", async () => {
  for (const [query, options, status] of [
    [listQuery, { denied: true }, 403], [listQuery, { accounts: [] }, 404], [listQuery, { rpcError: true }, 503],
    [`${listQuery}&offset=1`, {}, 400], [`${listQuery}&offset=0&offset=25`, {}, 400],
    [`${listQuery}&environment=sandbox`, {}, 400], [`${listQuery}&conversationId=wrong-view`, {}, 400],
    ["view=messages", {}, 400],
  ] as const) {
    const result = await call(query, options);
    assert.equal(result.response.status, status);
    assert.equal(result.calls.includes("sellerpilot_decrypt_credential"), false);
    assert.equal(result.calls.includes("provider-read"), false);
  }
});

test("uncertified, missing or mismatched seller lineage never sends the credential to eBay", async () => {
  for (const options of [
    { accounts: [{ ...account, seller_account_key_source: "legacy_unattested" }] },
    { accounts: [{ ...account, seller_account_key: "different" }] },
    { payload: { access_token: "fixture-token" } },
    { payload: { ...credential, provider_account_subject: "lazada:wrong" } },
  ]) {
    const result = await call(listQuery, options);
    assert.equal(result.response.status, 409);
    assert.equal(result.calls.includes("provider-read"), false);
  }
});

test("native message pages retain original content and exact seller roles without credential disclosure", async () => {
  const result = await call(messagesQuery);
  assert.equal(result.response.status, 200);
  const page = contract.ebayConversationMessagesSchema.parse(result.body);
  assert.equal(page.entries[0].body, message.body);
  assert.equal(page.entries[0].createdAt, message.createdAt);
  assert.equal(page.entries[0].role, "customer");
  assert.equal(page.conversationId, "conversation-native");
  assert.doesNotMatch(JSON.stringify(result.body), /fixture-token|fixture-secret|eias/);
  assert.equal(result.pageInput[0].environment, "production");
  const list = await call(listQuery);
  assert.equal(contract.ebayConversationPageSchema.parse(list.body).entries[0].latestMessage.role, "customer");
  const unknown = await call(messagesQuery, { sender: "unknown-one", recipient: "immutable-not-certified" });
  assert.equal(unknown.body.entries[0].role, "unverified");
  const system = await call(`${messagesQuery}&type=FROM_EBAY`);
  assert.equal(system.body.entries[0].role, "system");
});

test("provider denial, throttling and contract errors are distinct from empty successful results", async () => {
  for (const [failure, status, code] of [
    ["EBAY_MESSAGE_CONSENT_REQUIRED", 409, "MESSAGE_AUTHORIZATION_REQUIRED"],
    ["EBAY_MESSAGE_READ_HTTP_401", 409, "MESSAGE_AUTHORIZATION_REQUIRED"],
    ["EBAY_MESSAGE_READ_HTTP_403", 409, "MESSAGE_AUTHORIZATION_REQUIRED"],
    ["EBAY_MESSAGE_READ_HTTP_429", 429, "PROVIDER_RATE_LIMITED"],
    ["EBAY_MESSAGE_CONTRACT_INVALID:private-customer-text", 502, "MESSAGE_READ_UNVERIFIED"],
  ] as const) {
    const result = await call(listQuery, { failure });
    assert.equal(result.response.status, status); assert.equal(result.body.code, code);
    assert.equal("entries" in result.body, false); assert.equal("total" in result.body, false);
    assert.doesNotMatch(JSON.stringify(result.body), /private-customer-text/);
  }
});
