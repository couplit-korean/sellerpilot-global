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
const authorization = { authorization: "Bearer test-runtime-smoke-secret" };

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
    runtimeSmokeSecret: "test-runtime-smoke-secret",
    runners,
  });
  assert.equal(unauthorized.status, 401);

  const response = await handleServerRuntimeSmoke(
    new Request(`${routeUrl}?action=ai_gateway_smoke`, { headers: authorization }),
    { runtimeSmokeSecret: "test-runtime-smoke-secret", runners },
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
    runtimeSmokeSecret: "test-runtime-smoke-secret",
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
    { runtimeSmokeSecret: "test-runtime-smoke-secret", runners },
  );
  assert.equal(gatewayResponse.status, 200);
  assert.equal((await gatewayResponse.json()).executionRequested, true);
  assert.deepEqual(calls, ["gateway"]);

  const sandboxResponse = await handleServerRuntimeSmoke(
    request("POST", { action: "sandbox_smoke" }),
    { runtimeSmokeSecret: "test-runtime-smoke-secret", runners },
  );
  assert.equal(sandboxResponse.status, 200);
  assert.equal((await sandboxResponse.json()).stopped, true);
  assert.deepEqual(calls, ["gateway", "sandbox"]);

  const invalid = await handleServerRuntimeSmoke(
    request("POST", { action: "ai_gateway_smoke", prompt: "use customer data" }),
    { runtimeSmokeSecret: "test-runtime-smoke-secret", runners },
  );
  assert.equal(invalid.status, 400);
  assert.deepEqual(calls, ["gateway", "sandbox"]);
});

test("OIDC smoke delegates token resolution to AI SDK and never accepts or returns credentials", async () => {
  let requestInput: Record<string, unknown> = {};
  const successful = await runSyntheticAiGatewaySmoke({
    request: async (input) => {
      requestInput = input;
      const { model } = input;
      assert.equal(model, AI_GATEWAY_SMOKE_MODEL);
      return { status: "ok", runtime: "vercel-function-oidc" };
    },
    now: (() => {
      let tick = 100;
      return () => tick += 5;
    })(),
  });
  assert.deepEqual(requestInput, { model: AI_GATEWAY_SMOKE_MODEL });
  assert.equal(successful.auth, "vercel_oidc");

  const providerSecret = "private-provider-response";
  await assert.rejects(
    runSyntheticAiGatewaySmoke({
      request: async () => { throw new Error(providerSecret); },
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "gateway_request_failed");
      assert.equal(error.message.includes(providerSecret), false);
      return true;
    },
  );

  const response = await handleServerRuntimeSmoke(request("POST", { action: "ai_gateway_smoke" }), {
    runtimeSmokeSecret: "test-runtime-smoke-secret",
    runners: {
      aiGateway: async () => { throw new Error(`unexpected ${providerSecret}`); },
      sandbox: async () => ({}),
    },
  });
  assert.equal(response.status, 502);
  assert.equal((await response.text()).includes(providerSecret), false);
});

test("AI Gateway failures expose only allowlisted status, name, and code diagnostics", async () => {
  const providerSecret = "private-provider-response";
  let captured: unknown;
  try {
    await runSyntheticAiGatewaySmoke({
      request: async () => {
        throw Object.assign(new Error(providerSecret), {
          name: "GatewayFailedDependencyError",
          type: "failed_dependency",
          statusCode: 424,
          response: { body: providerSecret },
        });
      },
    });
  } catch (error) {
    captured = error;
  }

  assert.ok(captured instanceof Error);
  const failure = captured as Error & { diagnostic?: Record<string, unknown> };
  assert.equal(failure.message, "gateway_request_failed");
  assert.deepEqual(failure.diagnostic, {
    name: "GatewayFailedDependencyError",
    code: "failed_dependency",
    status: 424,
  });
  assert.equal(JSON.stringify(failure.diagnostic).includes(providerSecret), false);

  const response = await handleServerRuntimeSmoke(request("POST", { action: "ai_gateway_smoke" }), {
    runtimeSmokeSecret: "test-runtime-smoke-secret",
    runners: {
      aiGateway: () => runSyntheticAiGatewaySmoke({
        request: async () => {
          throw Object.assign(new Error(providerSecret), {
            name: "GatewayFailedDependencyError",
            type: "failed_dependency",
            statusCode: 424,
          });
        },
      }),
      sandbox: async () => ({}),
    },
  });
  const responseText = await response.text();
  assert.equal(response.status, 502);
  assert.equal(responseText.includes(providerSecret), false);
  assert.deepEqual(JSON.parse(responseText).diagnostic, failure.diagnostic);

  const authenticationResponse = await handleServerRuntimeSmoke(
    request("POST", { action: "ai_gateway_smoke" }),
    {
      runtimeSmokeSecret: "test-runtime-smoke-secret",
      runners: {
        aiGateway: () => runSyntheticAiGatewaySmoke({
          request: async () => {
            throw Object.assign(new Error(providerSecret), {
              name: "GatewayAuthenticationError",
              type: "authentication_error",
              statusCode: 401,
            });
          },
        }),
        sandbox: async () => ({}),
      },
    },
  );
  assert.equal(authenticationResponse.status, 503);
  assert.deepEqual((await authenticationResponse.json()).diagnostic, {
    name: "GatewayAuthenticationError",
    code: "authentication_error",
    status: 401,
  });

  await assert.rejects(
    runSyntheticAiGatewaySmoke({
      request: async () => {
        throw Object.assign(new Error(providerSecret), {
          name: "GatewayInternalServerError",
          type: "internal_server_error",
          statusCode: 402,
        });
      },
    }),
    (error: unknown) => {
      const billingFailure = error as Error & { diagnostic?: Record<string, unknown> };
      assert.deepEqual(billingFailure.diagnostic, {
        name: "GatewayInternalServerError",
        code: "billing_required",
        status: 402,
      });
      return true;
    },
  );

  for (const name of [
    "AI_NoObjectGeneratedError",
    "NoObjectGeneratedError",
    "AI_NoOutputGeneratedError",
  ]) {
    await assert.rejects(
      runSyntheticAiGatewaySmoke({
        request: async () => {
          throw Object.assign(new Error(providerSecret), { name });
        },
      }),
      (error: unknown) => {
        const structuredOutputFailure = error as Error & { diagnostic?: Record<string, unknown> };
        assert.deepEqual(structuredOutputFailure.diagnostic, {
          name,
          code: "no_output",
        });
        return true;
      },
    );
  }
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
  assert.equal(result.command, "passed");
  assert.equal(result.cleanup, "stopped");
  assert.equal(result.network, "deny_all");
  assert.equal(stopped, 1);
  assert.equal(calls[0]?.networkPolicy, "deny-all");
  assert.equal(calls[0]?.persistent, false);
  assert.equal(calls[0]?.timeout, 50_000);
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

test("sandbox cleanup is idempotent when the session is already terminal or returns 410", async () => {
  let terminalStopCalls = 0;
  const alreadyTerminal = await runSyntheticSandboxSmoke({
    create: async () => ({
      status: "stopped",
      runCommand: async () => ({
        exitCode: 0,
        stdout: async () => JSON.stringify({ platform: "linux", arch: "arm64", nodeVersion: "24.1.0" }),
        stderr: async () => "",
      }),
      stop: async () => { terminalStopCalls += 1; },
    }),
  });
  assert.equal(alreadyTerminal.cleanup, "already_terminal");
  assert.equal(alreadyTerminal.stopped, true);
  assert.equal(terminalStopCalls, 0);

  const secret = "sandbox-private-response";
  const stoppedResponse = Object.assign(new Error(secret), {
    name: "APIError",
    response: { status: 410 },
    json: { error: { message: secret } },
    text: secret,
  });
  let timedOutStopCalls = 0;
  const timedOutBeforeStop = await runSyntheticSandboxSmoke({
    create: async () => ({
      status: "running",
      runCommand: async () => ({
        exitCode: 0,
        stdout: async () => JSON.stringify({ platform: "linux", arch: "x64", nodeVersion: "24.1.0" }),
        stderr: async () => "",
      }),
      stop: async () => {
        timedOutStopCalls += 1;
        throw stoppedResponse;
      },
    }),
  });
  assert.equal(timedOutBeforeStop.cleanup, "already_terminal");
  assert.equal(timedOutBeforeStop.stopped, true);
  assert.equal(timedOutStopCalls, 1);
  assert.equal(JSON.stringify(timedOutBeforeStop).includes(secret), false);

  const noActiveSession = await runSyntheticSandboxSmoke({
    create: async () => ({
      get status(): "running" {
        throw new Error("SDK session cache is empty");
      },
      runCommand: async () => ({
        exitCode: 0,
        stdout: async () => JSON.stringify({ platform: "linux", arch: "x64", nodeVersion: "24.1.0" }),
        stderr: async () => "",
      }),
      stop: async () => { throw new Error("No active session to stop."); },
    }),
  });
  assert.equal(noActiveSession.cleanup, "already_terminal");
  assert.equal(noActiveSession.stopped, true);
});

test("sandbox failed or aborted terminal states are cleaned but never reported as success", async () => {
  for (const status of ["failed", "aborted"] as const) {
    let stopCalls = 0;
    await assert.rejects(
      runSyntheticSandboxSmoke({
        create: async () => ({
          status,
          runCommand: async () => ({
            exitCode: 0,
            stdout: async () => JSON.stringify({ platform: "linux", arch: "x64", nodeVersion: "24.1.0" }),
            stderr: async () => "",
          }),
          stop: async () => { stopCalls += 1; },
        }),
      }),
      (error: unknown) => {
        const failure = error as Error & { diagnostic?: Record<string, unknown> };
        assert.equal(failure.message, "sandbox_terminal_failed");
        assert.deepEqual(failure.diagnostic, {
          name: "SandboxTerminalError",
          code: status === "failed" ? "SANDBOX_FAILED" : "SANDBOX_ABORTED",
        });
        return true;
      },
    );
    assert.equal(stopCalls, 0);
  }
});

test("sandbox cleanup does not mistake a still-stopping 422 response for completion", async () => {
  const secret = "sandbox-stopping-private-response";
  let captured: unknown;
  try {
    await runSyntheticSandboxSmoke({
      create: async () => ({
        status: "stopping",
        runCommand: async () => ({
          exitCode: 0,
          stdout: async () => JSON.stringify({ platform: "linux", arch: "x64", nodeVersion: "24.1.0" }),
          stderr: async () => "",
        }),
        stop: async () => {
          throw Object.assign(new Error(secret), {
            name: "APIError",
            response: { status: 422 },
            json: { error: { message: secret } },
            text: secret,
          });
        },
      }),
    });
  } catch (error) {
    captured = error;
  }

  assert.ok(captured instanceof Error);
  const failure = captured as Error & { diagnostic?: Record<string, unknown> };
  assert.equal(failure.message, "sandbox_cleanup_failed");
  assert.deepEqual(failure.diagnostic, {
    name: "APIError",
    code: "SANDBOX_STOPPING",
    status: 422,
  });
  assert.equal(JSON.stringify(failure.diagnostic).includes(secret), false);
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
  assert.match(helper, /model: input\.model/);
  assert.doesNotMatch(helper, /getVercelOidcToken|createGateway|apiKey:|ai-gateway-auth-method/);
  assert.match(helper, /maxOutputTokens: 256/);
  assert.doesNotMatch(helper, /zeroDataRetention|disallowPromptTraining/);
  assert.match(helper, /networkPolicy: "deny-all"/);
  assert.match(helper, /persistent: false/);
  assert.match(route, /runtime = "nodejs"/);
  assert.match(route, /dynamic = "force-dynamic"/);
  assert.doesNotMatch(helper, /AI_GATEWAY_API_KEY|OPENAI_API_KEY|auth\.json/);
  assert.doesNotMatch(helper, /CRON_SECRET/);
  assert.match(helper, /SERVER_RUNTIME_SMOKE_SECRET/);
  assert.doesNotMatch(helper, /SUPABASE|sellerpilot_claim|support_reply|marketplace credential/i);
  assert.doesNotMatch(route, /supabase|worker|claim|support|channel/i);
});
