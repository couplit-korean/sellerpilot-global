import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { NextRequest } from "next/server";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sellerpilot-oauth-local.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";
delete process.env.SELLERPILOT_SERVERLESS_STATIC_EGRESS_CHANNELS;

const serverOnlyHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === "server-only"
      ? { shortCircuit: true, url: "data:text/javascript,export {};" }
      : nextResolve(specifier, context);
  },
});
const { POST } = await import("../app/api/admin/channel-credentials/shopee/authorize/route");
serverOnlyHook.deregister();

const credentialId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const oauthState = "sellerpilot-shopee-test-state-value";

type Scripted = {
  staticEgress?: unknown;
  staticEgressError?: boolean;
  runtimeStatus?: unknown;
  runtimeError?: boolean;
  csWakeup?: { configured: boolean; active: boolean };
  rotateId?: string;
};

function supabaseFetch(script: Scripted) {
  const calls: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    calls.push(url.pathname);
    if (url.pathname === "/auth/v1/user") {
      return Response.json({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        aud: "authenticated",
        role: "authenticated",
        email: "admin@example.test",
        app_metadata: {},
        user_metadata: {},
        created_at: "2026-09-01T00:00:00.000Z",
      });
    }
    if (url.pathname === "/rest/v1/rpc/sellerpilot_is_admin") {
      return Response.json(true);
    }
    if (url.pathname === "/rest/v1/rpc/sellerpilot_list_credentials") {
      return Response.json([]);
    }
    if (url.pathname === "/rest/v1/rpc/sellerpilot_service_serverless_static_egress_status") {
      if (script.staticEgressError) {
        return Response.json({ message: "status unavailable" }, { status: 500 });
      }
      return Response.json(script.staticEgress ?? { shopee: false });
    }
    if (url.pathname === "/rest/v1/rpc/sellerpilot_service_serverless_cs_wakeup_status") {
      return Response.json(script.csWakeup ?? { configured: true, active: true });
    }
    if (url.pathname === "/rest/v1/rpc/sellerpilot_ai_runtime_status") {
      if (script.runtimeError) {
        return Response.json({ message: "administrator access required" }, { status: 403 });
      }
      return Response.json(script.runtimeStatus ?? { workers: {} });
    }
    if (url.pathname === "/rest/v1/rpc/sellerpilot_rotate_credential") {
      return Response.json(script.rotateId ?? "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    }
    throw new Error(`unexpected Supabase request: ${url.pathname}`);
  };
  return { calls, fetcher };
}

async function requestAuthorize(input: {
  body: Record<string, unknown>;
  script: Scripted;
  cookie?: string;
  envChannels?: string | null;
}) {
  const previousEnv = process.env.SELLERPILOT_SERVERLESS_STATIC_EGRESS_CHANNELS;
  if (input.envChannels == null) delete process.env.SELLERPILOT_SERVERLESS_STATIC_EGRESS_CHANNELS;
  else process.env.SELLERPILOT_SERVERLESS_STATIC_EGRESS_CHANNELS = input.envChannels;
  const scripted = supabaseFetch(input.script);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = scripted.fetcher as typeof fetch;
  try {
    const response = await POST(new NextRequest(
      "https://sellerpilot.example/api/admin/channel-credentials/shopee/authorize",
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-admin-session",
          "content-type": "application/json",
          ...(input.cookie ? { cookie: input.cookie } : {}),
        },
        body: JSON.stringify(input.body),
      },
    ));
    return { response, body: await response.json() as Record<string, unknown>, calls: scripted.calls };
  } finally {
    globalThis.fetch = originalFetch;
    if (previousEnv === undefined) delete process.env.SELLERPILOT_SERVERLESS_STATIC_EGRESS_CHANNELS;
    else process.env.SELLERPILOT_SERVERLESS_STATIC_EGRESS_CHANNELS = previousEnv;
  }
}

function startBody() {
  return {
    environment: "production",
    startOAuth: true,
    secretPayload: {
      partner_id: "1234567",
      partner_key: "test-partner-key",
    },
  };
}

function callbackBody() {
  return {
    environment: "production",
    oauthState,
    secretPayload: {
      authorization_code: "test-authorization-code",
      shop_id: "1719148844",
    },
  };
}

function freshGateway(lastSeenAt = new Date().toISOString()) {
  return {
    workers: {
      gateway: {
        last_seen_at: lastSeenAt,
        last_version: "sellerpilot-cli-worker/1.60",
        fingerprint: "SECRET-FINGERPRINT",
      },
    },
  };
}

function assertNoEnqueue(calls: readonly string[]) {
  assert.equal(calls.includes("/rest/v1/rpc/sellerpilot_enqueue_channel_gateway_job"), false);
}

test("local fresh gateway allows OAuth start without treating env as static attestation", async () => {
  const { response, body, calls } = await requestAuthorize({
    envChannels: null,
    script: {
      staticEgress: { shopee: false },
      runtimeStatus: freshGateway(),
      rotateId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    },
    body: startBody(),
  });
  assert.equal(response.status, 200);
  assert.equal(typeof body.authorizationUrl, "string");
  assert.match(String(body.authorizationUrl), /partner_id=1234567/);
  assert.doesNotMatch(String(body.authorizationUrl), /authorization_code|access_token|refresh/i);
  assert.equal(calls.includes("/rest/v1/rpc/sellerpilot_ai_runtime_status"), true);
  assert.equal(calls.includes("/rest/v1/rpc/sellerpilot_service_serverless_cs_wakeup_status"), false);
  assert.equal(calls.includes("/rest/v1/rpc/sellerpilot_rotate_credential"), true);
  assertNoEnqueue(calls);
  assert.doesNotMatch(JSON.stringify(body), /SECRET-FINGERPRINT|test-authorization-code/);
});

test("stale September 4 last_seen blocks start and callback before enqueue", async () => {
  const stale = {
    workers: {
      gateway: {
        last_seen_at: "2026-09-04T12:00:00.000Z",
        last_version: "sellerpilot-cli-worker/1.60",
      },
    },
  };
  const start = await requestAuthorize({
    script: { staticEgress: { shopee: false }, runtimeStatus: stale },
    body: startBody(),
  });
  assert.equal(start.response.status, 503);
  assert.equal(start.body.blockedReason, "LOCAL_GATEWAY_WORKER_REQUIRED");
  assert.equal(start.body.reason, "local_gateway_heartbeat_stale");
  assert.equal(start.calls.includes("/rest/v1/rpc/sellerpilot_rotate_credential"), false);
  assertNoEnqueue(start.calls);

  const callback = await requestAuthorize({
    script: { staticEgress: { shopee: false }, runtimeStatus: stale },
    cookie: `sellerpilot_shopee_oauth=${oauthState}.${credentialId}`,
    body: callbackBody(),
  });
  assert.equal(callback.response.status, 503);
  assert.equal(callback.body.blockedReason, "LOCAL_GATEWAY_WORKER_REQUIRED");
  assert.equal(callback.body.reason, "local_gateway_heartbeat_stale");
  assertNoEnqueue(callback.calls);
});

test("inactive or wrong-scope workers block both start and callback with no enqueue", async () => {
  const inactive = await requestAuthorize({
    script: { staticEgress: { shopee: false }, runtimeStatus: { workers: {} } },
    body: startBody(),
  });
  assert.equal(inactive.body.reason, "local_gateway_missing");
  assertNoEnqueue(inactive.calls);

  const wrongScope = await requestAuthorize({
    script: {
      staticEgress: { shopee: false },
      runtimeStatus: {
        workers: {
          serverless_cs: {
            last_seen_at: new Date().toISOString(),
            last_version: "sellerpilot-vercel-gateway/2.0",
          },
        },
      },
    },
    cookie: `sellerpilot_shopee_oauth=${oauthState}.${credentialId}`,
    body: callbackBody(),
  });
  assert.equal(wrongScope.response.status, 503);
  assert.equal(wrongScope.body.reason, "local_gateway_wrong_scope");
  assertNoEnqueue(wrongScope.calls);
  assert.equal(wrongScope.calls.includes("/rest/v1/rpc/sellerpilot_rotate_credential"), false);
});

test("fake env static egress still requires local gateway and does not enqueue", async () => {
  const { response, body, calls } = await requestAuthorize({
    envChannels: "shopee",
    script: {
      staticEgress: { shopee: false },
      csWakeup: { configured: true, active: true },
      runtimeStatus: { workers: {} },
    },
    cookie: `sellerpilot_shopee_oauth=${oauthState}.${credentialId}`,
    body: callbackBody(),
  });
  assert.equal(response.status, 503);
  assert.equal(body.blockedReason, "LOCAL_GATEWAY_WORKER_REQUIRED");
  assert.equal(calls.includes("/rest/v1/rpc/sellerpilot_service_serverless_cs_wakeup_status"), false);
  assertNoEnqueue(calls);
});

test("real serverless static attestation ignores stale local last_seen and still gates CS wakeup", async () => {
  const { response, body, calls } = await requestAuthorize({
    envChannels: "shopee",
    script: {
      staticEgress: { shopee: true },
      csWakeup: { configured: true, active: false },
      runtimeStatus: freshGateway(),
    },
    body: startBody(),
  });
  assert.equal(response.status, 503);
  assert.equal(body.blockedReason, "SERVERLESS_WORKER_REQUIRED");
  assert.equal(body.mode, "serverless_worker_required");
  assert.equal(calls.includes("/rest/v1/rpc/sellerpilot_ai_runtime_status"), false);
  assert.equal(calls.includes("/rest/v1/rpc/sellerpilot_rotate_credential"), false);
  assertNoEnqueue(calls);
});

test("database static egress without env attestation fails closed before enqueue", async () => {
  const { response, body, calls } = await requestAuthorize({
    envChannels: null,
    script: {
      staticEgress: { shopee: true },
      runtimeStatus: freshGateway(),
    },
    cookie: `sellerpilot_shopee_oauth=${oauthState}.${credentialId}`,
    body: callbackBody(),
  });
  assert.equal(response.status, 409);
  assert.equal(body.blockedReason, "SHOPEE_OAUTH_EXECUTOR_UNPROVEN");
  assert.equal(body.reason, "executor_exclusive_unproven");
  assert.equal(calls.includes("/rest/v1/rpc/sellerpilot_ai_runtime_status"), false);
  assertNoEnqueue(calls);
});
