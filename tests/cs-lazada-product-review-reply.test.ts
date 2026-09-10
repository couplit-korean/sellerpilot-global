import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { withLazadaProviderAccountIdentity } from "../lib/channels/provider-account-identity";
import { executeLazadaProductReviewReply } from "../lib/channels/cs/lazada/product-review-reply";
import { prepareAndEnqueueLazadaProductReviewReply } from "../lib/cs/channels/lazada/product-review-reply";
import { executeCsProviderJob } from "../lib/cs/operations/provider";

const attested = withLazadaProviderAccountIdentity({
  app_key: "app", app_secret: "secret", access_token: "token", country: "my",
  access_token_expires_at: "2099-01-01T00:00:00.000Z",
}, {
  account_platform: "seller_center",
  country_user_info: [{ country: "my", seller_id: "300872000183", user_id: "200872000183" }],
});
const sellerAccountKey = createHash("sha256")
  .update(["lazada", "production", attested.identity.subject].join("\u001f"), "utf8").digest("hex");
const deliveryId = "00000000-0000-4000-8000-000000009101";
const credentialId = "00000000-0000-4000-8000-000000009102";
const identityFingerprint = "a".repeat(64);

const arguments_ = {
  kind: "product_review" as const,
  deliveryId,
  country: "MY" as const,
  sellerAccountKey,
  reviewId: "11111111111",
  generation: 1788984000000,
  identityFingerprint,
  reply: "Thank you for your review.",
};

function remote(data: Record<string, unknown>, status = 200) {
  return { response: new Response("", { status }), data, text: JSON.stringify(data) };
}

function exactReadback(reply = arguments_.reply) {
  return remote({ code: "0", success: "true", data: { outdated_reviews: [], review_list: [{
    id: arguments_.reviewId, review_type: "PRODUCT_REVIEW", can_reply: "false", seller_reply: reply,
  }] } });
}

test("official review reply uses the dedicated GET endpoint and exact v2 readback", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await executeLazadaProductReviewReply(attested.payload, arguments_, async (input) => {
    calls.push(input);
    return input.path.endsWith("reply/add")
      ? remote({ code: "0", success: "true", data: "true" })
      : exactReadback();
  });
  assert.equal(result.steps[0]?.ok, true);
  assert.deepEqual(calls.map((call) => [call.path, call.method, call.params]), [
    ["/review/seller/reply/add", "GET", { id: arguments_.reviewId, content: arguments_.reply }],
    ["/review/seller/list/v2", "GET", { id_list: JSON.stringify([arguments_.reviewId]) }],
  ]);
  assert.equal(result.steps[0]?.data.sellerpilotLazadaProductReviewReadback.exactReplyObserved, true);
  assert.equal(result.steps[0]?.data.sellerpilotReplyAcceptance.kind, "product_review");
});

test("lost send response performs one readback and never retransmits the reply", async () => {
  const paths: string[] = [];
  const result = await executeLazadaProductReviewReply(attested.payload, arguments_, async (input) => {
    paths.push(input.path);
    if (input.path.endsWith("reply/add")) throw new Error("synthetic response loss");
    return exactReadback();
  });
  assert.equal(result.steps[0]?.ok, true);
  assert.equal(result.steps[0]?.data.responseLost, true);
  assert.equal(paths.filter((path) => path.endsWith("reply/add")).length, 1);
  assert.equal(paths.filter((path) => path.endsWith("list/v2")).length, 1);
});

test("readback-only recovery performs zero provider mutations", async () => {
  const paths: string[] = [];
  const result = await executeLazadaProductReviewReply(attested.payload, {
    ...arguments_, kind: "product_review_readback",
  }, async (input) => {
    paths.push(input.path);
    return exactReadback();
  });
  assert.equal(result.steps[0]?.ok, true);
  assert.deepEqual(paths, ["/review/seller/list/v2"]);
  assert.equal(result.steps[0]?.data.sendAttempted, false);
});

test("account or country mismatch blocks before any transport", async () => {
  let calls = 0;
  await assert.rejects(executeLazadaProductReviewReply(attested.payload, {
    ...arguments_, sellerAccountKey: "f".repeat(64),
  }, async () => {
    calls += 1;
    return exactReadback();
  }), /CREDENTIAL_ACCOUNT_MISMATCH/u);
  assert.equal(calls, 0);
});

test("a different observed reply is a conflict and automatic resend stays forbidden", async () => {
  const paths: string[] = [];
  const result = await executeLazadaProductReviewReply(attested.payload, arguments_, async (input) => {
    paths.push(input.path);
    return input.path.endsWith("reply/add")
      ? remote({ code: "0", success: "true", data: "true" })
      : exactReadback("A different seller reply");
  });
  assert.equal(result.steps[0]?.ok, false);
  assert.equal(result.steps[0]?.status, 409);
  assert.equal(result.steps[0]?.data.sellerpilotLazadaProductReviewReadback.state, "conflict");
  assert.equal(result.steps[0]?.data.sellerpilotLazadaProductReviewReadback.automaticResendAllowed, false);
  assert.equal(paths.filter((path) => path.endsWith("reply/add")).length, 1);
});

test("permission failure stops before enqueue and exact prepared replay reuses lineage", async () => {
  let enqueueCalls = 0;
  await assert.rejects(prepareAndEnqueueLazadaProductReviewReply({
    credentialId, country: "MY", reviewId: arguments_.reviewId,
    generation: arguments_.generation, reply: arguments_.reply,
  }, {
    prepare: async () => ({ data: null, error: { code: "42501", message: "PERMISSION_REQUIRED" } }),
    enqueue: async () => { enqueueCalls += 1; return { data: null, error: null }; },
  }), /PERMISSION_REQUIRED/u);
  assert.equal(enqueueCalls, 0);

  const prepared = {
    contract: "sellerpilot-lazada-product-review-reply-prepare/1" as const,
    deliveryId, credentialId, country: "MY" as const, sellerAccountKey,
    reviewId: arguments_.reviewId, generation: arguments_.generation,
    identityFingerprint, status: "readback_required" as const, replayed: true,
    providerMutationPerformed: false as const,
  };
  const replay = await prepareAndEnqueueLazadaProductReviewReply({
    credentialId, country: "MY", reviewId: arguments_.reviewId,
    generation: arguments_.generation, reply: arguments_.reply,
  }, {
    prepare: async () => ({ data: prepared, error: null }),
    enqueue: async () => { enqueueCalls += 1; return { data: null, error: null }; },
  });
  assert.equal(replay.enqueue, null);
  assert.equal(replay.automaticResendAllowed, false);
  assert.equal(enqueueCalls, 0);
});

for (const status of ["running", "failed"] as const) test(`prepared ${status} replay is returned without enqueue`, async () => {
  let enqueueCalls = 0;
  const result = await prepareAndEnqueueLazadaProductReviewReply({
    credentialId, country: "MY", reviewId: arguments_.reviewId,
    generation: arguments_.generation, reply: arguments_.reply,
  }, {
    prepare: async () => ({ data: {
      contract: "sellerpilot-lazada-product-review-reply-prepare/1",
      deliveryId, credentialId, country: "MY", sellerAccountKey,
      reviewId: arguments_.reviewId, generation: arguments_.generation,
      identityFingerprint, status, replayed: true, providerMutationPerformed: false,
    }, error: null }),
    enqueue: async () => { enqueueCalls += 1; return { data: null, error: null }; },
  });
  assert.equal(result.prepared.status, status);
  assert.equal(result.enqueue, null);
  assert.equal(enqueueCalls, 0);
});

test("only a fully parsed Lazada readback lineage skips the provider mutation fence", async () => {
  let mutations = 0;
  let executions = 0;
  const input = {
    job: {
      id: deliveryId,
      claim_token: "00000000-0000-4000-8000-000000009103",
      credential_id: credentialId,
      channel: "lazada" as const,
      operation: "inquiries.reply",
      environment: "production" as const,
      request: { arguments: { ...arguments_, kind: "product_review_readback" } },
      credential: attested.payload,
      attempt_count: 1,
    },
    signal: new AbortController().signal,
    hooks: {
      assertLeaseHealthy: async () => {},
      beginCredentialMutation: async () => { throw new Error("unexpected credential mutation"); },
      stageCredentialRefresh: async () => { throw new Error("unexpected credential stage"); },
      beginProviderMutation: async () => { mutations += 1; },
    },
  };
  const result = await executeCsProviderJob(input, async () => {
    executions += 1;
    return { ok: true, channel: "lazada", operation: "inquiries.reply",
      steps: [{ name: "fake-readback", ok: true, status: 200, data: {} }], safeMessage: "ok" };
  });
  assert.equal(result.ok, true);
  assert.equal(mutations, 0);
  assert.equal(executions, 1);

  await assert.rejects(executeCsProviderJob({
    ...input,
    job: { ...input.job, channel: "coupang" as const, credential: {},
      request: { arguments: { ...arguments_, kind: "product_review_readback" } } },
  }, async () => {
    executions += 1;
    throw new Error("must not execute");
  }), /SERVERLESS_LAZADA_PRODUCT_REVIEW_JOB_BINDING_INVALID/u);
  assert.equal(executions, 1);
});

test("Lazada product-review mutation keeps the durable provider fence", async () => {
  let mutations = 0;
  const result = await executeCsProviderJob({
    job: {
      id: deliveryId,
      claim_token: "00000000-0000-4000-8000-000000009104",
      credential_id: credentialId,
      channel: "lazada",
      operation: "inquiries.reply",
      environment: "production",
      request: { arguments: arguments_ },
      credential: attested.payload,
      attempt_count: 1,
    },
    signal: new AbortController().signal,
    hooks: {
      assertLeaseHealthy: async () => {},
      beginCredentialMutation: async () => { throw new Error("unexpected credential mutation"); },
      stageCredentialRefresh: async () => { throw new Error("unexpected credential stage"); },
      beginProviderMutation: async () => { mutations += 1; },
    },
  }, async () => ({ ok: true, channel: "lazada", operation: "inquiries.reply",
    steps: [{ name: "fake-reply", ok: true, status: 200, data: {} }], safeMessage: "ok" }));
  assert.equal(result.ok, true);
  assert.equal(mutations, 1);
});
