import assert from "node:assert/strict";
import test from "node:test";
import { executeChannelOperation } from "../lib/channels/operations";
import {
  lazadaRequest,
  resolveLazadaRequestPayload,
  signLazadaRequest,
} from "../lib/channels/protocols";

const commerce = {
  app_key: "commerce-app-key",
  app_secret: "commerce-app-secret",
  access_token: "commerce-access-token",
  country: "my",
} as const;

const im = {
  im_app_key: "im-app-key",
  im_app_secret: "im-app-secret",
  im_access_token: "im-access-token",
} as const;

const dualAppPayload = {
  ...commerce,
  ...im,
  im_refresh_token: "im-refresh-token",
};

function unsignedParams(params: URLSearchParams) {
  const record: Record<string, string> = {};
  for (const [key, value] of params) {
    if (key !== "sign") record[key] = value;
  }
  return record;
}

function requestParams(input: unknown, init?: RequestInit) {
  const url = new URL(String(input));
  if (String(init?.method ?? "GET").toUpperCase() === "POST") {
    return { url, params: new URLSearchParams(String(init?.body ?? "")) };
  }
  return { url, params: url.searchParams };
}

function assertSignedWith(path: string, params: URLSearchParams, secret: string) {
  assert.equal(params.get("sign"), signLazadaRequest(path, unsignedParams(params), secret));
}

test("resolveLazadaRequestPayload overlays IM triples only on IM paths", () => {
  const payload = { ...dualAppPayload };
  const imResolved = resolveLazadaRequestPayload(payload, "/im/message/send");
  assert.equal(imResolved.app_key, im.im_app_key);
  assert.equal(imResolved.app_secret, im.im_app_secret);
  assert.equal(imResolved.access_token, im.im_access_token);
  assert.equal(imResolved.refresh_token, "im-refresh-token");
  assert.equal(payload.app_key, commerce.app_key);
  assert.equal(payload.access_token, commerce.access_token);

  const commerceResolved = resolveLazadaRequestPayload(payload, "/product/item/get");
  assert.equal(commerceResolved.app_key, commerce.app_key);
  assert.equal(commerceResolved.app_secret, commerce.app_secret);
  assert.equal(commerceResolved.access_token, commerce.access_token);
  assert.equal(commerceResolved, payload);
});

test("IM lazadaRequest signs with IM credentials and leaves Commerce unused", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: URL; params: URLSearchParams }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push(requestParams(input, init));
    return Response.json({ code: "0", message: "success" });
  };
  try {
    await lazadaRequest({
      payload: dualAppPayload,
      path: "/im/session/list",
      params: { start_time: "1", page_size: "20" },
    });
    await lazadaRequest({
      payload: dualAppPayload,
      path: "/im/message/send",
      method: "POST",
      params: { template_id: "1", session_id: "session-1", txt: "We have checked." },
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url.pathname, "/rest/im/session/list");
    assert.equal(calls[0]?.params.get("app_key"), im.im_app_key);
    assert.equal(calls[0]?.params.get("access_token"), im.im_access_token);
    assert.notEqual(calls[0]?.params.get("app_key"), commerce.app_key);
    assertSignedWith("/im/session/list", calls[0]!.params, im.im_app_secret);
    assert.notEqual(
      calls[0]?.params.get("sign"),
      signLazadaRequest("/im/session/list", unsignedParams(calls[0]!.params), commerce.app_secret),
    );

    assert.equal(calls[1]?.url.pathname, "/rest/im/message/send");
    assert.equal(calls[1]?.params.get("app_key"), im.im_app_key);
    assert.equal(calls[1]?.params.get("access_token"), im.im_access_token);
    assert.equal(calls[1]?.params.get("session_id"), "session-1");
    assertSignedWith("/im/message/send", calls[1]!.params, im.im_app_secret);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("non-IM lazadaRequest keeps Commerce credentials when IM overlay is present", async () => {
  const originalFetch = globalThis.fetch;
  let params = new URLSearchParams();
  let pathname = "";
  globalThis.fetch = async (input, init) => {
    const parsed = requestParams(input, init);
    pathname = parsed.url.pathname;
    params = parsed.params;
    return Response.json({ code: "0", data: {} });
  };
  try {
    await lazadaRequest({
      payload: dualAppPayload,
      path: "/product/item/get",
      params: { item_id: "987654321" },
    });
    assert.equal(pathname, "/rest/product/item/get");
    assert.equal(params.get("app_key"), commerce.app_key);
    assert.equal(params.get("access_token"), commerce.access_token);
    assert.notEqual(params.get("app_key"), im.im_app_key);
    assert.notEqual(params.get("access_token"), im.im_access_token);
    assertSignedWith("/product/item/get", params, commerce.app_secret);
    assert.notEqual(
      params.get("sign"),
      signLazadaRequest("/product/item/get", unsignedParams(params), im.im_app_secret),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("missing IM overlay fail-closes before fetch and does not swap a second credential", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("UNEXPECTED_FETCH");
  };
  const commerceOnly = { ...commerce };
  try {
    await assert.rejects(
      lazadaRequest({
        payload: commerceOnly,
        path: "/im/message/send",
        method: "POST",
        params: { template_id: "1", session_id: "session-1", txt: "hello" },
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "LAZADA_IM_CREDENTIALS_MISSING");
        return true;
      },
    );
    await assert.rejects(
      lazadaRequest({
        payload: { ...commerceOnly, im_app_key: im.im_app_key, im_app_secret: im.im_app_secret },
        path: "/im/session/list",
      }),
      /LAZADA_IM_CREDENTIALS_MISSING/,
    );
    await assert.rejects(
      executeChannelOperation({
        channel: "lazada",
        operation: "inquiries.reply",
        payload: commerceOnly,
        arguments: { sessionId: "session-1", reply: "We have checked." },
        environment: "production",
      }),
      /LAZADA_IM_CREDENTIALS_MISSING/,
    );
    assert.equal(fetchCalls, 0);
    assert.equal(commerceOnly.app_key, commerce.app_key);
    assert.equal(commerceOnly.access_token, commerce.access_token);
    assert.equal(Object.hasOwn(commerceOnly, "im_app_key"), false);
    assert.equal(Object.hasOwn(commerceOnly, "im_access_token"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
