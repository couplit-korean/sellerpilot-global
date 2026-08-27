import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AI_GATEWAY_SMOKE_MODEL,
  handleServerRuntimeSmoke,
  runSyntheticAiGatewaySmoke,
  runSyntheticSandboxSmoke,
} from "../lib/server-runtime-smoke";

const routeUrl = "https://sellerpilot.invalid/api/internal/server-runtime-smoke";
const authorization = { authorization: "Bearer test-cron-secret" };

function request(method: "GET" | "POST", body?: unknown, headers: Record<string, string> = {}) {
  return new Request(routeUrl, {
    method,
    headers: {
      ...authorization,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("readiness is authenticated, no-store, and never runs a costly smoke implicitly", async () => {
  let gatewayCalls = 0;
  let sandboxCalls = 0;
  const runners = {
    aiGateway: async () => { gatewayCalls += 1; return {}; },
    sandbox: async () => { sandboxCalls += 1; return {}; },
  };

  const unauthorized = await handleServerRuntimeSmoke(new Request(routeUrl), {
    cronSecret: "test-cron-secret",
    runners,
  });
  assert.equal(unauthorized.status, 401);

  const response = await handleServerRuntimeSmoke(
    new Request(`${routeUrl}?action=ai_gateway_smoke`, { headers: authorization }),
    { cronSecret: "test-cron-secret", runners },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  const payload = await response.json();
  assert.equal(payload.mode, "readiness");
  assert.equal(payload.executionRequested, false);
  assert.deepEqual(payload.boundaries, {
    syntheticInputOnly: true,
    productClaims: false,
    customerData: false,
    marketplaceWrites: false,
    databaseAccess: false,
  });
  assert.equal(gatewayCalls, 0);
  assert.equal(sandboxCalls, 0);

  const emptyPost = await handleServerRuntimeSmoke(request("POST", {}), {
    cronSecret: "test-cron-secret",
    runners,
  });
  assert.equal(emptyPost.status, 200);
  assert.equal((await emptyPost.json()).mode, "readiness");
  assert.equal(gatewayCalls, 0);
  assert.equal(sandboxCalls, 0);
});

test("each explicit action invokes only its exact synthetic runner", async () => {
  const calls: string[] = [];
  const runners = {
    aiGateway: async () => {
      calls.push("gateway");
      return { ok: true, action: "ai_gateway_smoke" };
    },
    sandbox: async () => {
      calls.push("sandbox");
      return { ok: true, action: "sandbox_smoke", stopped: true };
    },
  };

  const gatewayResponse = await handleServerRuntimeSmoke(
    request("POST", { action: "ai_gateway_smoke" }),
    { cronSecret: "test-cron-secret", runners },
  );
  assert.equal(gatewayResponse.status, 200);
  assert.equal((await gatewayResponse.json()).executionRequested, true);
  assert.deepEqual(calls, ["gateway"]);

  const sandboxResponse = await handleServerRuntimeSmoke(
    request("POST", { action: "sandbox_smoke" }),
    { cronSecret: "test-cron-secret", runners },
  );
  assert.equal(sandboxResponse.status, 200);
  assert.equal((await sandboxResponse.json()).stopped, true);
  assert.deepEqual(calls, ["gateway", "sandbox"]);

  const invalid = await handleServerRuntimeSmoke(
    request("POST", { action: "ai_gateway_smoke", prompt: "use customer data" }),
    { cronSecret: "test-cron-secret", runners },
  );
  assert.equal(invalid.status, 400);
  assert.deepEqual(calls, ["gateway", "sandbox"]);
});

test("OIDC smoke injects only the ephemeral token and never returns or rethrows it", async () => {
  const secretToken = "header.synthetic-secret.signature";
  let receivedToken = "";
  const successful = await runSyntheticAiGatewaySmoke({
    getOidcToken: async () => secretToken,
    request: async ({ oidcToken, model }) => {
      receivedToken = oidcToken;
      assert.equal(model, AI_GATEWAY_SMOKE_MODEL);
      return { status: "ok", runtime: "vercel-function-oidc" };
    },
    now: (() => {
      let tick = 100;
      return () => tick += 5;
    })(),
  });
  assert.equal(receivedToken, secretToken);
  assert.equal(JSON.stringify(successful).includes(secretToken), false);
  assert.equal(successful.auth, "vercel_oidc");

  await assert.rejects(
    runSyntheticAiGatewaySmoke({
      getOidcToken: async () => secretToken,
      request: async () => { throw new Error(`provider leaked ${secretToken}`); },
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "gateway_request_failed");
      assert.equal(error.message.includes(secretToken), false);
      return true;
    },
  );

  const response = await handleServerRuntimeSmoke(request("POST", { action: "ai_gateway_smoke" }), {
    cronSecret: "test-cron-secret",
    runners: {
      aiGateway: async () => { throw new Error(`unexpected ${secretToken}`); },
      sandbox: async () => ({}),
    },
  });
  assert.equal(response.status, 502);
  assert.equal((await response.text()).includes(secretToken), false);
});

test("sandbox smoke runs one fixed Linux Node command with denied egress and always stops", async () => {
  const calls: Array<Record<string, unknown>> = [];
  let stopped = 0;
  const result = await runSyntheticSandboxSmoke({
    create: async (options) => {
      calls.push(options as unknown as Record<string, unknown>);
      return {
        runCommand: async (command) => {
          calls.push(command as unknown as Record<string, unknown>);
          return {
            exitCode: 0,
            stdout: async () => JSON.stringify({ platform: "linux", arch: "x64", nodeVersion: "24.1.0" }),
            stderr: async () => "",
          };
        },
        stop: async () => { stopped += 1; },
      };
    },
  });
  assert.equal(result.stopped, true);
  assert.equal(result.network, "deny_all");
  assert.equal(stopped, 1);
  assert.equal(calls[0]?.networkPolicy, "deny-all");
  assert.equal(calls[0]?.persistent, false);
  assert.equal("env" in (calls[0] ?? {}), false);
  assert.equal("source" in (calls[0] ?? {}), false);
  assert.equal(calls[1]?.cmd, "node");

  let stoppedAfterFailure = 0;
  await assert.rejects(runSyntheticSandboxSmoke({
    create: async () => ({
      runCommand: async () => { throw new Error("synthetic command failed"); },
      stop: async () => { stoppedAfterFailure += 1; },
    }),
  }), /sandbox_command_failed/);
  assert.equal(stoppedAfterFailure, 1);
});

test("source contract excludes static AI keys, auth caches, databases, claims, and channel writes", async () => {
  const [helper, route, packageJson] = await Promise.all([
    readFile(new URL("../lib/server-runtime-smoke.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/internal/server-runtime-smoke/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(packageJson) as { dependencies?: Record<string, string> };

  assert.equal(typeof manifest.dependencies?.["@vercel/sandbox"], "string");
  assert.equal(typeof manifest.dependencies?.["@vercel/oidc"], "string");
  assert.equal(typeof manifest.dependencies?.ai, "string");
  assert.match(helper, /getVercelOidcToken/);
  assert.match(helper, /apiKey: input\.oidcToken/);
  assert.match(helper, /"ai-gateway-auth-method": "oidc"/);
  assert.match(helper, /networkPolicy: "deny-all"/);
  assert.match(helper, /persistent: false/);
  assert.match(route, /runtime = "nodejs"/);
  assert.match(route, /dynamic = "force-dynamic"/);
  assert.doesNotMatch(helper, /AI_GATEWAY_API_KEY|OPENAI_API_KEY|auth\.json/);
  assert.doesNotMatch(helper, /SUPABASE|sellerpilot_claim|support_reply|marketplace credential/i);
  assert.doesNotMatch(route, /supabase|worker|claim|support|channel/i);
});
