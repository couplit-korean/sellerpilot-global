import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { NextRequest } from "next/server";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sellerpilot-oauth-test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
process.env.SUPABASE_SECRET_KEY = "test-secret-key";
process.env.SELLERPILOT_SERVERLESS_STATIC_EGRESS_CHANNELS = "shopee";

const serverOnlyHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === "server-only"
      ? { shortCircuit: true, url: "data:text/javascript,export {};" }
      : nextResolve(specifier, context);
  },
});
const { POST } = await import("../app/api/admin/channel-credentials/shopee/authorize/route");
serverOnlyHook.deregister();

type RuntimeState = { configured: boolean; active: boolean };

function supabaseFetch(runtimeState: RuntimeState) {
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
      return Response.json({ shopee: true });
    }
    if (url.pathname === "/rest/v1/rpc/sellerpilot_service_serverless_cs_wakeup_status") {
      return Response.json(runtimeState);
    }
    throw new Error(`unexpected Supabase request: ${url.pathname}`);
  };
  return { calls, fetcher };
}

async function requestWithRuntime(input: {
  body: Record<string, unknown>;
  runtimeState: RuntimeState;
  cookie?: string;
}) {
  const scripted = supabaseFetch(input.runtimeState);
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
    return { response, calls: scripted.calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function assertWorkerBlocked(
  response: Response,
  body: Record<string, unknown>,
  calls: readonly string[],
) {
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(body.ok, false);
  assert.equal(body.operatorActionRequired, true);
  assert.equal(body.workerReady, false);
  assert.equal(body.blockedReason, "SERVERLESS_WORKER_REQUIRED");
  assert.equal(body.mode, "serverless_worker_required");
  assert.equal(typeof body.message, "string");
  assert.equal(calls.includes("/rest/v1/rpc/sellerpilot_service_serverless_cs_wakeup_status"), true);
  assert.equal(calls.includes("/rest/v1/rpc/sellerpilot_enqueue_channel_gateway_job"), false);
}

test("Shopee OAuth start fails before credential rotation when the gateway worker is not configured", async () => {
  const { response, calls } = await requestWithRuntime({
    runtimeState: { configured: false, active: true },
    body: {
      environment: "production",
      startOAuth: true,
      secretPayload: {
        partner_id: "test-partner-id",
        partner_key: "test-partner-key",
      },
    },
  });
  assertWorkerBlocked(response, await response.json(), calls);
  assert.equal(calls.includes("/rest/v1/rpc/sellerpilot_rotate_credential"), false);
});

test("Shopee OAuth callback does not enqueue an authorization code when the gateway worker is inactive", async () => {
  const state = "sellerpilot-shopee-test-state-value";
  const credentialId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const { response, calls } = await requestWithRuntime({
    runtimeState: { configured: true, active: false },
    cookie: `sellerpilot_shopee_oauth=${state}.${credentialId}`,
    body: {
      environment: "production",
      oauthState: state,
      secretPayload: {
        authorization_code: "test-authorization-code",
        shop_id: "1719148844",
      },
    },
  });
  assertWorkerBlocked(response, await response.json(), calls);
});
