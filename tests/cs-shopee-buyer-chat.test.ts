import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  normalizeAuthorizedShopeeBuyerChatPage,
  shopeeBuyerChatReadiness,
  type ShopeeBuyerChatPermissionEvidence,
} from "../lib/channels/cs/shopee/buyer-chat";
import {
  createShopeeBuyerChatView,
  mergeShopeeBuyerChatStatusPage,
  projectShopeeBuyerChatApi,
  SHOPEE_BUYER_CHAT_TRANSPORT,
  SHOPEE_BUYER_CHAT_UI_MESSAGE_LIMIT,
  shopeeBuyerChatApiSchema,
  shopeeBuyerChatReadSchema,
} from "../lib/cs/channels/shopee/buyer-chat-contract";
import { executeShopeeInquiry } from "../lib/channels/shopee-inquiries";

const shopId = "1719148844";
const credentialId = "00000000-0000-4000-8000-000000069003";
const evidence: ShopeeBuyerChatPermissionEvidence = {
  configuredKeys: true,
  contractDocument: {
    module: "sellerchat", revision: "approved-revision-1",
    sourceUrl: "https://open.shopee.com/documents/v2/authorized-contract",
    verifiedAt: "2026-09-09T10:00:00.000Z",
    conversationListApproved: true, messageHistoryApproved: true,
  },
  appApproval: { state: "approved", appType: "seller_in_house_system",
    approvedAt: "2026-09-09T10:01:00.000Z" },
  webhookApproval: { state: "approved", event: "sellerchat_message",
    verifiedAt: "2026-09-09T10:02:00.000Z" },
};

function page() {
  return {
    contract: "sellerpilot-shopee-buyer-chat-authorized-page/1" as const,
    shopId, conversationId: "conversation_1", inputCursor: null,
    nextCursor: "opaque+/cursor==", pageSize: 2,
    messages: [{ conversationId: "conversation_1", messageId: "message_1",
      senderRole: "buyer" as const, body: "  Where is my order?  ",
      sentAt: "2026-09-09T09:00:00+09:00", orderSn: "ORDER_1", itemId: "9001",
      attachmentCount: 1 }],
  };
}

test("configured keys never promote Buyer Chat without three explicit approvals", () => {
  assert.deepEqual(shopeeBuyerChatReadiness({ configuredKeys: true }), {
    state: "permission_pending", reason: "contract_permission_unverified",
    receive: false, history: false, reply: false,
  });
  assert.equal(shopeeBuyerChatReadiness({ configuredKeys: true,
    contractDocument: evidence.contractDocument }).reason, "app_approval_unverified");
  assert.equal(shopeeBuyerChatReadiness({ configuredKeys: true,
    contractDocument: evidence.contractDocument, appApproval: evidence.appApproval }).reason,
  "webhook_permission_unverified");
  assert.deepEqual(shopeeBuyerChatReadiness(evidence), {
    state: "read_only_ready", reason: "approved_read_only",
    receive: true, history: true, reply: false,
  });
});

test("permission gate runs before an authorized page can be normalized", () => {
  assert.throws(() => normalizeAuthorizedShopeeBuyerChatPage({
    evidence: { configuredKeys: true }, expectedShopId: shopId,
    page: { ...page(), shopId: "wrong" },
  }), /SHOPEE_BUYER_CHAT_PERMISSION_PENDING:contract_permission_unverified/u);
});

test("authorized handoff normalizes only bounded exact identity and safe storage fields", () => {
  const result = normalizeAuthorizedShopeeBuyerChatPage({ evidence, expectedShopId: shopId, page: page() });
  const message = result.messages[0];
  assert.equal(message.body, "Where is my order?");
  assert.equal(message.sentAt, "2026-09-09T00:00:00.000Z");
  assert.equal(message.identityDigest, createHash("sha256")
    .update(`${shopId}\nconversation_1\nmessage_1`).digest("hex"));
  assert.equal(message.bodyFingerprint, createHash("sha256").update("Where is my order?").digest("hex"));
  assert.deepEqual(result.continuation, { shopId, conversationId: "conversation_1",
    cursor: "opaque+/cursor==", pageSize: 2 });
  assert.deepEqual(Object.keys(result.storageRows[0]).sort(), ["attachmentCount", "body",
    "bodyFingerprint", "conversationId", "evidenceDigest", "identityDigest", "itemId",
    "messageId", "orderSn", "senderRole", "sentAt", "shopId"].sort());
  assert.equal("buyerName" in result.storageRows[0], false);
  assert.equal("contact" in result.storageRows[0], false);
});

test("shop, conversation, message and cursor drift fail closed", () => {
  const invalidPages = [
    { ...page(), shopId: "1719148845" },
    { ...page(), messages: [{ ...page().messages[0], conversationId: "conversation_2" }] },
    { ...page(), messages: [page().messages[0], page().messages[0]] },
    { ...page(), inputCursor: "same", nextCursor: "same" },
    { ...page(), messages: [], nextCursor: "cursor" },
    { ...page(), pageSize: 101 },
  ];
  for (const invalid of invalidPages) {
    assert.throws(() => normalizeAuthorizedShopeeBuyerChatPage({
      evidence, expectedShopId: shopId, page: invalid,
    }), /SHOPEE_BUYER_CHAT_(?:PAGE_INVALID|MESSAGE_INVALID|MESSAGE_DUPLICATE)/u);
  }
});

function readMessage(messageId: string, conversationId = "conversation_1") {
  return {
    shopId, conversationId, messageId,
    identityDigest: createHash("sha256").update(`${shopId}\\n${conversationId}\\n${messageId}`).digest("hex"),
    senderRole: "buyer" as const, body: `body ${messageId}`,
    bodyFingerprint: createHash("sha256").update(`body ${messageId}`).digest("hex"),
    sentAt: "2026-09-09T10:00:00.000Z", orderSn: null, itemId: null, attachmentCount: 0,
  };
}

test("read contract separates stored history from current runtime readiness and never permits reply", () => {
  assert.equal(shopeeBuyerChatReadSchema.safeParse({
    contract: "sellerpilot-shopee-buyer-chat-read/2", checkedAt: "2026-09-09T10:00:00.000Z",
    state: "permission_pending", reason: "credential_unavailable",
    receive: false, history: false, storedHistory: true, reply: false,
    shops: [{ credentialId, shopId, state: "permission_pending", runtimeReady: false,
      storedHistory: true, conversationCount: 1, messages: [readMessage("stored_1")],
      nextCursor: null }],
  }).success, true);
  assert.equal(shopeeBuyerChatReadSchema.safeParse({
    contract: "sellerpilot-shopee-buyer-chat-read/2", checkedAt: "2026-09-09T10:00:00.000Z",
    state: "permission_pending", reason: "contract_permission_unverified",
    receive: true, history: false, storedHistory: false, reply: false, shops: [],
  }).success, false);
  assert.equal(shopeeBuyerChatReadSchema.safeParse({
    contract: "sellerpilot-shopee-buyer-chat-read/2", checkedAt: "2026-09-09T10:00:00.000Z",
    state: "read_only_ready", reason: "approved_read_only",
    receive: true, history: true, storedHistory: false, reply: true, shops: [],
  }).success, false);
});

test("API projection never converts approved page evidence into operational receive", () => {
  const ledger = shopeeBuyerChatReadSchema.parse({
    contract: "sellerpilot-shopee-buyer-chat-read/2", checkedAt: "2026-09-09T10:00:00.000Z",
    state: "read_only_ready", reason: "approved_read_only",
    receive: true, history: true, storedHistory: true, reply: false,
    shops: [{ credentialId, shopId, state: "read_only_ready", runtimeReady: true,
      storedHistory: true, conversationCount: 1, messages: [readMessage("stored_1")],
      nextCursor: null }],
  });
  const status = projectShopeeBuyerChatApi(ledger, SHOPEE_BUYER_CHAT_TRANSPORT);
  assert.equal(status.ledgerPermissionState, "page_evidence_approved");
  assert.equal(status.ledgerPermissionReason, "approved_page_evidence");
  assert.equal(status.operationalReceive, false);
  assert.equal(status.automaticHistoryCollection, false);
  assert.equal(status.storedHistory, true);
  assert.equal("receive" in status, false);
  assert.equal("history" in status, false);
  assert.equal("runtimeReady" in status.shops[0], false);
  assert.equal(shopeeBuyerChatApiSchema.safeParse(status).success, true);
});

test("bounded continuation merge requires exact credential and shop and deduplicates identities", () => {
  const base = shopeeBuyerChatReadSchema.parse({
    contract: "sellerpilot-shopee-buyer-chat-read/2", checkedAt: "2026-09-09T10:00:00.000Z",
    state: "read_only_ready", reason: "approved_read_only",
    receive: true, history: true, storedHistory: true, reply: false,
    shops: [{ credentialId, shopId, state: "read_only_ready", runtimeReady: true,
      storedHistory: true, conversationCount: 1, messages: [readMessage("message_2")],
      nextCursor: "cursor-page-2" }],
  });
  const continuation = shopeeBuyerChatReadSchema.parse({
    ...base, checkedAt: "2026-09-09T10:01:00.000Z",
    shops: [{ ...base.shops[0], messages: [readMessage("message_2"), readMessage("message_1")],
      nextCursor: null }],
  });
  const view = createShopeeBuyerChatView(
    projectShopeeBuyerChatApi(base, SHOPEE_BUYER_CHAT_TRANSPORT),
  );
  const continuationStatus = projectShopeeBuyerChatApi(
    continuation, SHOPEE_BUYER_CHAT_TRANSPORT,
  );
  const merged = mergeShopeeBuyerChatStatusPage(view, continuationStatus, {
    credentialId, shopId,
  });
  assert.deepEqual(merged.shops[0].messages.map(message => message.messageId), ["message_2", "message_1"]);
  assert.equal(merged.shops[0].nextCursor, null);
  assert.throws(() => mergeShopeeBuyerChatStatusPage(view, continuationStatus, {
    credentialId: "00000000-0000-4000-8000-000000069099", shopId,
  }), /SHOPEE_BUYER_CHAT_PAGE_SCOPE_MISMATCH/u);
  const drift = {
    ...continuation,
    shops: [{ ...continuation.shops[0], messages: [
      { ...readMessage("message_2"), body: "changed body" },
    ] }],
  };
  assert.throws(() => mergeShopeeBuyerChatStatusPage(view,
    projectShopeeBuyerChatApi(drift, SHOPEE_BUYER_CHAT_TRANSPORT), { credentialId, shopId }),
    /SHOPEE_BUYER_CHAT_PAGE_IDENTITY_CONFLICT/u);
});

test("pagination replaces stale ledger evidence and rejects missing transport", () => {
  const approved = shopeeBuyerChatReadSchema.parse({
    contract: "sellerpilot-shopee-buyer-chat-read/2", checkedAt: "2026-09-09T10:00:00.000Z",
    state: "read_only_ready", reason: "approved_read_only",
    receive: true, history: true, storedHistory: true, reply: false,
    shops: [{ credentialId, shopId, state: "read_only_ready", runtimeReady: true,
      storedHistory: true, conversationCount: 1, messages: [readMessage("message_2")],
      nextCursor: "cursor-page-2" }],
  });
  const revoked = shopeeBuyerChatReadSchema.parse({
    ...approved,
    checkedAt: "2026-09-09T10:01:00.000Z",
    state: "permission_pending", reason: "credential_unavailable",
    receive: false, history: false,
    shops: [{ ...approved.shops[0], state: "permission_pending", runtimeReady: false,
      messages: [readMessage("message_1")], nextCursor: null }],
  });
  const approvedStatus = projectShopeeBuyerChatApi(approved, SHOPEE_BUYER_CHAT_TRANSPORT);
  const merged = mergeShopeeBuyerChatStatusPage(createShopeeBuyerChatView(approvedStatus),
    projectShopeeBuyerChatApi(revoked, SHOPEE_BUYER_CHAT_TRANSPORT), { credentialId, shopId });
  assert.equal(merged.ledgerPermissionState, "permission_pending");
  assert.equal(merged.ledgerPermissionReason, "credential_unavailable");
  assert.equal(merged.shops[0].ledgerPermissionState, "permission_pending");
  assert.equal(merged.operationalReceive, false);
  assert.equal(merged.automaticHistoryCollection, false);
  assert.deepEqual(merged.shops[0].messages.map(message => message.messageId),
    ["message_2", "message_1"]);
  assert.equal(shopeeBuyerChatApiSchema.safeParse({
    ...approvedStatus, transport: undefined,
  }).success, false);
  assert.equal(shopeeBuyerChatApiSchema.safeParse({
    ...approvedStatus,
    transport: { ...approvedStatus.transport, automaticReads: true },
  }).success, false);
});

test("API pages stay bounded at 100 while the exact UI scope can accumulate 101 and 201", () => {
  const makePage = (start: number, count: number, nextCursor: string | null) =>
    projectShopeeBuyerChatApi(shopeeBuyerChatReadSchema.parse({
      contract: "sellerpilot-shopee-buyer-chat-read/2",
      checkedAt: "2026-09-09T10:00:00.000Z",
      state: "read_only_ready", reason: "approved_read_only",
      receive: true, history: true, storedHistory: true, reply: false,
      shops: [{ credentialId, shopId, state: "read_only_ready", runtimeReady: true,
        storedHistory: true, conversationCount: 1,
        messages: Array.from({ length: count }, (_, index) => readMessage(`m_${start + index}`)),
        nextCursor }],
    }), SHOPEE_BUYER_CHAT_TRANSPORT);
  assert.equal(shopeeBuyerChatReadSchema.safeParse({
    contract: "sellerpilot-shopee-buyer-chat-read/2",
    checkedAt: "2026-09-09T10:00:00.000Z",
    state: "read_only_ready", reason: "approved_read_only",
    receive: true, history: true, storedHistory: true, reply: false,
    shops: [{ credentialId, shopId, state: "read_only_ready", runtimeReady: true,
      storedHistory: true, conversationCount: 1,
      messages: Array.from({ length: 101 }, (_, index) => readMessage(`too_many_${index}`)) }],
  }).success, false);
  let view = createShopeeBuyerChatView(makePage(0, 100, "page-2"));
  view = mergeShopeeBuyerChatStatusPage(view, makePage(100, 1, "page-3"), {
    credentialId, shopId,
  });
  assert.equal(view.shops[0].messages.length, 101);
  view = mergeShopeeBuyerChatStatusPage(view, makePage(101, 100, null), {
    credentialId, shopId,
  });
  assert.equal(view.shops[0].messages.length, 201);
  assert.equal(view.shops[0].memoryLimitReached, false);
});

test("UI bounds memory while retaining access to message501 and older pages", () => {
  const makePage = (start: number, count: number, nextCursor: string | null) =>
    projectShopeeBuyerChatApi(shopeeBuyerChatReadSchema.parse({
      contract: "sellerpilot-shopee-buyer-chat-read/2",
      checkedAt: "2026-09-09T10:00:00.000Z",
      state: "read_only_ready", reason: "approved_read_only",
      receive: true, history: true, storedHistory: true, reply: false,
      shops: [{ credentialId, shopId, state: "read_only_ready", runtimeReady: true,
        storedHistory: true, conversationCount: 1,
        messages: Array.from({ length: count }, (_, index) => readMessage(`cap_${start + index}`)),
        nextCursor }],
    }), SHOPEE_BUYER_CHAT_TRANSPORT);
  let view = createShopeeBuyerChatView(makePage(0, 100, "page-2"));
  for (let start = 100; start < SHOPEE_BUYER_CHAT_UI_MESSAGE_LIMIT; start += 100) {
    view = mergeShopeeBuyerChatStatusPage(view, makePage(start, 100, "more"), {
      credentialId, shopId,
    });
  }
  assert.equal(view.shops[0].messages.length, SHOPEE_BUYER_CHAT_UI_MESSAGE_LIMIT);
  assert.equal(new Set(view.shops[0].messages.map(message => message.identityDigest)).size,
    SHOPEE_BUYER_CHAT_UI_MESSAGE_LIMIT);
  assert.equal(view.shops[0].memoryLimitReached, true);
  assert.equal(view.shops[0].nextCursor, "more");
  view = mergeShopeeBuyerChatStatusPage(view, makePage(500, 100, "older"), {
    credentialId, shopId,
  });
  assert.equal(view.shops[0].messages.length, 500);
  assert.equal(view.shops[0].messages[0].messageId, "cap_100");
  assert.equal(view.shops[0].messages.at(-1)?.messageId, "cap_599");
  assert.equal(view.shops[0].nextCursor, "older");
});

test("existing inquiry adapter preserves review and Returns and rejects Buyer Chat before fetch", async () => {
  let fetchCalled = false;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalled = true; throw new Error("must not call"); };
  try {
    await assert.rejects(executeShopeeInquiry({
      operation: "inquiries.list", environment: "production",
      payload: { partner_id: "1", partner_key: "key", shop_id: shopId,
        access_token: "token" }, arguments: { kind: "buyer_chat" },
    }), /CHANNEL_ARGUMENT_INVALID:kind/u);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("central negative: runtime rejected app approval cannot become ready", () => {
  const rejected = {
    ...evidence, appApproval: { ...evidence.appApproval, state: "rejected" },
  } as unknown as ShopeeBuyerChatPermissionEvidence;
  assert.equal(shopeeBuyerChatReadiness(rejected).state, "permission_pending");
  assert.throws(() => normalizeAuthorizedShopeeBuyerChatPage({
    evidence: rejected, expectedShopId: shopId, page: page(),
  }), /SHOPEE_BUYER_CHAT_PERMISSION_PENDING/u);
});

test("central negative: explicit false message-history approval cannot become ready", () => {
  const rejected = {
    ...evidence,
    contractDocument: { ...evidence.contractDocument, messageHistoryApproved: false },
  } as unknown as ShopeeBuyerChatPermissionEvidence;
  assert.equal(shopeeBuyerChatReadiness(rejected).state, "permission_pending");
});

test("runtime permission evidence requires exact module, approvals, states and value types", () => {
  const invalidEvidence: unknown[] = [
    null,
    { ...evidence, configuredKeys: "true" },
    { ...evidence, contractDocument: null },
    { ...evidence, contractDocument: { ...evidence.contractDocument, module: "shop" } },
    { ...evidence, contractDocument: { ...evidence.contractDocument, conversationListApproved: false } },
    { ...evidence, contractDocument: { ...evidence.contractDocument, messageHistoryApproved: null } },
    { ...evidence, contractDocument: { ...evidence.contractDocument, revision: 7 } },
    { ...evidence, contractDocument: { ...evidence.contractDocument, sourceUrl: null } },
    { ...evidence, contractDocument: { ...evidence.contractDocument, verifiedAt: false } },
    { ...evidence, appApproval: null },
    { ...evidence, appApproval: { ...evidence.appApproval, state: "rejected" } },
    { ...evidence, appApproval: { ...evidence.appApproval, appType: 1 } },
    { ...evidence, appApproval: { ...evidence.appApproval, approvedAt: null } },
    { ...evidence, webhookApproval: null },
    { ...evidence, webhookApproval: { ...evidence.webhookApproval, state: "rejected" } },
    { ...evidence, webhookApproval: { ...evidence.webhookApproval, event: false } },
    { ...evidence, webhookApproval: { ...evidence.webhookApproval, verifiedAt: {} } },
  ];
  for (const invalid of invalidEvidence) {
    let storageCalled = false;
    assert.equal(shopeeBuyerChatReadiness(
      invalid as ShopeeBuyerChatPermissionEvidence,
    ).state, "permission_pending");
    assert.throws(() => {
      normalizeAuthorizedShopeeBuyerChatPage({
        evidence: invalid as ShopeeBuyerChatPermissionEvidence,
        expectedShopId: shopId,
        page: page(),
      });
      storageCalled = true;
    }, /SHOPEE_BUYER_CHAT_PERMISSION_PENDING/u);
    assert.equal(storageCalled, false);
  }
});

test("runtime page validation rejects wrong cursor and sender types before normalization", () => {
  const invalidPages: unknown[] = [
    { ...page(), contract: null },
    { ...page(), pageSize: "2" },
    { ...page(), inputCursor: 1 },
    { ...page(), nextCursor: {} },
    { ...page(), messages: null },
    { ...page(), messages: [{ ...page().messages[0], senderRole: "administrator" }] },
    { ...page(), messages: [{ ...page().messages[0], senderRole: false }] },
    { ...page(), messages: [{ ...page().messages[0], body: 7 }] },
    { ...page(), messages: [{ ...page().messages[0], sentAt: null }] },
  ];
  for (const invalid of invalidPages) {
    assert.throws(() => normalizeAuthorizedShopeeBuyerChatPage({
      evidence, expectedShopId: shopId,
      page: invalid as ReturnType<typeof page>,
    }), /SHOPEE_BUYER_CHAT_(?:PAGE|MESSAGE)_INVALID/u);
  }
});

test("normalization drops extra provider and buyer fields at the storage boundary", () => {
  const unsafePage = page();
  const normalized = normalizeAuthorizedShopeeBuyerChatPage({
    evidence, expectedShopId: shopId,
    page: {
      ...unsafePage,
      messages: [{ ...unsafePage.messages[0], buyerName: "Private Buyer",
        contact: "010-0000-0000", address: "private", rawProvider: { secret: true } }],
    },
  });
  assert.deepEqual(Object.keys(normalized.storageRows[0]).sort(), [
    "attachmentCount", "body", "bodyFingerprint", "conversationId", "evidenceDigest",
    "identityDigest", "itemId", "messageId", "orderSn", "senderRole", "sentAt", "shopId",
  ].sort());
  assert.equal(JSON.stringify(normalized.storageRows).includes("Private Buyer"), false);
  assert.equal(JSON.stringify(normalized.storageRows).includes("010-0000-0000"), false);
  assert.equal(JSON.stringify(normalized.storageRows).includes("secret"), false);
});
