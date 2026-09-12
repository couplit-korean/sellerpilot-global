import assert from "node:assert/strict";
import test from "node:test";
import { executeLazadaInquiry } from "../lib/channels/lazada-inquiries";
import { executeChannelOperation } from "../lib/channels/operations";

const payload = {
  app_key: "fixture-key", app_secret: "fixture-secret", access_token: "fixture-token", country: "my",
  im_app_key: "fixture-im-key", im_app_secret: "fixture-im-secret", im_access_token: "fixture-im-token",
};
const message = { message_id: "m1", from_account_type: 1, send_time: 1000, content: { txt: "original" } };
const args = { bootstrap: true, startTime: 3000, sessionLimit: 1, messageLimit: 20 };
async function withProvider(
  response: (url: URL) => Record<string, unknown>,
  run: (calls: URL[]) => Promise<void>,
) {
  const original = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input)); calls.push(url);
    return Response.json({ code: "0", data: response(url) });
  };
  try { await run(calls); } finally { globalThis.fetch = original; }
}
const sessions = { session_list: [{ session_id: "s1" }], has_more: false };
const execute = (argumentsValue = args) => executeLazadaInquiry({ operation: "inquiries.list", payload, arguments: argumentsValue });

test("Lazada session remainder becomes a durable continuation after the current session is stored", async () => {
  await withProvider(url => url.pathname.endsWith("/session/list")
    ? ({ ...sessions, has_more: true, next_start_time: 2000, last_session_id: "s1" })
    : ({ message_list: [message], has_more: false }), async calls => {
    const result = await executeChannelOperation({ channel: "lazada", operation: "inquiries.list", payload, arguments: args, environment: "production" });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(result.continuation?.arguments.sellerpilotLazadaSessionStartTime, "2000");
    assert.equal(result.continuation?.arguments.sellerpilotLazadaLastSessionId, "s1");
    assert.equal(result.continuation?.arguments.sellerpilotLazadaSessionCount, 1);
  });
});

test("Lazada sessionLimit stops before another provider session while retaining the stored page", async () => {
  await withProvider(url => url.pathname.endsWith("/session/list")
    ? ({ ...sessions, has_more: true, next_start_time: 2000, last_session_id: "s1" })
    : ({ message_list: [message], has_more: false }), async calls => {
    const first = await executeChannelOperation({
      channel: "lazada", operation: "inquiries.list", payload, arguments: args, environment: "production",
    });
    assert.equal(first.ok, true);
    assert.equal(first.continuation?.arguments.sellerpilotLazadaSessionCount, 1);
    assert.equal(calls.length, 2);

    const stopped = await executeChannelOperation({
      channel: "lazada", operation: "inquiries.list", payload,
      arguments: first.continuation?.arguments ?? {}, environment: "production",
    });
    assert.equal(stopped.ok, false);
    assert.equal(stopped.steps[0]?.data.code, "LAZADA_HISTORY_SESSION_LIMIT_REACHED");
    assert.equal(stopped.steps[0]?.data.sellerpilotVerification, "PAGINATION_STOPPED_WITH_REMAINDER");
    assert.equal(calls.length, 2);
  });
});

test("Lazada pageSize controls each durable message request and rejects an overfull page", async () => {
  await withProvider(url => url.pathname.endsWith("/session/list") ? sessions : {
    message_list: Array.from({ length: 3 }, (_, i) => ({ ...message, message_id: `m${i}` })),
    has_more: false,
  }, async calls => {
    const result = await execute({ ...args, pageSize: 3 });
    assert.equal(result.steps.every(step => step.ok), true);
    assert.equal(calls[1]?.searchParams.get("page_size"), "3");
  });
  await withProvider(url => url.pathname.endsWith("/session/list") ? sessions : {
    message_list: Array.from({ length: 4 }, (_, i) => ({ ...message, message_id: `m${i}` })),
    has_more: false,
  }, async calls => {
    await assert.rejects(execute({ ...args, pageSize: 3 }), /LAZADA_HISTORY_MESSAGE_PAGE_INVALID/);
    assert.equal(calls[1]?.searchParams.get("page_size"), "3");
  });
});

test("Lazada completes every message page in the current session before enforcing sessionLimit", async () => {
  await withProvider(url => {
    if (url.pathname.endsWith("/session/list")) return {
      ...sessions, has_more: true, next_start_time: 2000, last_session_id: "s1",
    };
    if (!url.searchParams.has("last_message_id")) return {
      message_list: [message], has_more: true, next_start_time: 1000, last_message_id: "m1",
    };
    return { message_list: [{ ...message, message_id: "m0" }], has_more: false };
  }, async calls => {
    const first = await executeChannelOperation({
      channel: "lazada", operation: "inquiries.list", payload, arguments: args, environment: "production",
    });
    assert.equal(first.ok, true);
    assert.equal(first.continuation?.arguments.sellerpilotLazadaSessionCount, 1);
    assert.equal(first.continuation?.arguments.sellerpilotLazadaSession?.session_id, "s1");

    const second = await executeChannelOperation({
      channel: "lazada", operation: "inquiries.list", payload,
      arguments: first.continuation?.arguments ?? {}, environment: "production",
    });
    assert.equal(second.ok, true);
    assert.equal(second.continuation?.arguments.sellerpilotLazadaSession, undefined);
    assert.equal(second.continuation?.arguments.sellerpilotLazadaSessionCount, 1);
    assert.equal(calls.filter(url => url.pathname.endsWith("/message/list")).length, 2);

    const stopped = await executeChannelOperation({
      channel: "lazada", operation: "inquiries.list", payload,
      arguments: second.continuation?.arguments ?? {}, environment: "production",
    });
    assert.equal(stopped.ok, false);
    assert.equal(stopped.steps[0]?.data.code, "LAZADA_HISTORY_SESSION_LIMIT_REACHED");
    assert.equal(calls.filter(url => url.pathname.endsWith("/session/list")).length, 1);
  });
});

test("Lazada message cap only completes when provider explicitly says no remainder", async () => {
  for (const hasMore of [true, false]) {
    await withProvider(url => url.pathname.endsWith("/session/list") ? sessions : {
      message_list: Array.from({ length: 20 }, (_, i) => ({ ...message, message_id: `m${i}` })),
      has_more: hasMore, next_start_time: 1000, last_message_id: "m19",
    }, async calls => {
      const result = await executeChannelOperation({ channel: "lazada", operation: "inquiries.list", payload, arguments: args, environment: "production" });
      assert.equal(result.ok, true);
      assert.equal(calls.length, 2);
      assert.equal(Boolean(result.continuation), hasMore);
      if (hasMore) {
        assert.equal(result.continuation?.arguments.sellerpilotLazadaMessageStartTime, "1000");
        assert.equal(result.continuation?.arguments.sellerpilotLazadaLastMessageId, "m19");
      }
    });
  }
});

test("Lazada never converts missing has_more or malformed lists into an empty success", async () => {
  for (const invalid of [
    { session_list: [] }, { session_list: [], has_more: "unknown" },
    { session_list: [], has_more: true }, { session_list: {}, has_more: false },
    { session_list: [null], has_more: false }, { session_list: [{}], has_more: false },
    { session_list: [{ session_id: " " }], has_more: false },
  ]) await withProvider(() => invalid, async () => {
    await assert.rejects(execute(), /LAZADA_HISTORY_(HAS_MORE_INVALID|EMPTY_PAGE_WITH_REMAINDER|SESSION_PAGE_INVALID)/);
  });
  for (const invalid of [
    { message_list: [] }, { message_list: [], has_more: true },
    { message_list: [message, null], has_more: false },
  ]) await withProvider(url => url.pathname.endsWith("/session/list") ? sessions : invalid, async () => {
    await assert.rejects(execute(), /LAZADA_HISTORY_(HAS_MORE_INVALID|EMPTY_PAGE_WITH_REMAINDER|MESSAGE_PAGE_INVALID)/);
  });
});

test("Lazada rejects missing, forward and repeated cursors instead of ending successfully", async () => {
  for (const cursor of [
    {}, { next_start_time: 4000, last_session_id: "s1" },
    { next_start_time: "NaN", last_session_id: "s1" },
    { next_start_time: -1, last_session_id: "s1" },
    { next_start_time: 2000, last_session_id: " " },
  ]) await withProvider(() => ({ ...sessions, has_more: true, ...cursor }), async () => {
    await assert.rejects(execute({ ...args, sessionLimit: 20 }), /LAZADA_HISTORY_CURSOR_INVALID/);
  });
  await withProvider(url => url.pathname.endsWith("/session/list")
    ? ({ ...sessions, has_more: true, next_start_time: 2000, last_session_id: "s1" })
    : ({ message_list: [message], has_more: false }), async calls => {
    await assert.rejects(execute({
      ...args,
      sessionLimit: 20,
      sellerpilotLazadaSessionStartTime: "2000",
      sellerpilotLazadaLastSessionId: "s1",
    }), /LAZADA_HISTORY_CURSOR_REPEATED/);
    assert.equal(calls.length, 1);
  });
  await withProvider(() => ({
    message_list: [message], has_more: true, next_start_time: 1000, last_message_id: "m1",
  }), async calls => {
    await assert.rejects(execute({
      ...args,
      sellerpilotLazadaSession: { session_id: "s1" },
      sellerpilotLazadaMessageStartTime: "1000",
      sellerpilotLazadaLastMessageId: "m1",
    }), /LAZADA_HISTORY_CURSOR_REPEATED/);
    assert.equal(calls.length, 1);
  });
});

test("Lazada overfull provider pages cannot bypass the requested bound", async () => {
  await withProvider(() => ({ ...sessions, session_list: [{ session_id: "s1" }, { session_id: "s2" }] }), async () => {
    await assert.rejects(execute(), /LAZADA_HISTORY_SESSION_PAGE_INVALID/);
  });
});

test("Lazada valid empty history and independent CS adapter remain readable", async () => {
  await withProvider(() => ({ session_list: [], has_more: false }), async calls => {
    const result = await execute();
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].ok, true);
    assert.equal(calls.length, 1);
  });
});
