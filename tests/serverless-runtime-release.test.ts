import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const {
  activateServerlessRuntimeRelease,
  candidateAutomationBypassAuthorized,
  runCandidateServerlessRuntimeCanary,
  ServerlessRuntimeReleaseError,
} = await import("../lib/serverless-runtime-release");

const release = "8be84a57633f5d83647309c33814033337069e41";
const receipt = "a3dcf2d1-e79d-4e23-a1f2-a7f438220cde";
const candidateRuntimeIdentity = {
  vercelProjectId: "prj_9fRYsoTT4fD6XVEMe4NX9mpPlljA",
  vercelEnvironment: "production",
  vercelTargetEnvironment: "production",
};

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("an active previous release is paused, canaried and atomically replaced", async () => {
  const calls: string[] = [];
  let statusReads = 0;
  const rpc = async (name: string) => {
    calls.push(name);
    if (name === "sellerpilot_service_serverless_cs_wakeup_status") {
      statusReads += 1;
      return { data: {
        configured: true,
        active: true,
        activeRelease: statusReads === 1 ? "a".repeat(40) : release,
        scheduleCount: 6,
        unsafePendingMutations: 0,
      }, error: null };
    }
    if (name === "sellerpilot_service_set_serverless_cs_wakeup_active") {
      return { data: { configured: true, active: false, scheduleCount: 6 }, error: null };
    }
    if (name === "sellerpilot_service_begin_serverless_runtime_canary") return { data: receipt, error: null };
    if (name === "sellerpilot_service_complete_serverless_runtime_canary") return { data: true, error: null };
    if (name === "sellerpilot_service_activate_serverless_runtime") {
      return { data: { active: true, canaryReceiptConsumed: true }, error: null };
    }
    return { data: null, error: { code: "unexpected" } };
  };
  const fetchImpl = async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    return path === "/api/internal/channel-gateway-drain"
      ? response({ status: "canary", claimed: 0, processed: 0, release })
      : response({ status: "canary", executed: false, release });
  };

  const result = await activateServerlessRuntimeRelease({
    origin: "https://sellerpilot-global.vercel.app",
    release,
    cronSecret: "server-runtime-secret-for-tests",
    rpc,
    fetchImpl: fetchImpl as typeof fetch,
  });

  assert.equal(result.ok, true);
  assert.equal(result.deactivatedPreviousRelease, true);
  assert.equal(result.canaries.gateway, 200);
  assert.equal(result.canaries.schedules.length, 5);
  assert.equal(result.status.activeRelease, release);
  assert.deepEqual(calls, [
    "sellerpilot_service_serverless_cs_wakeup_status",
    "sellerpilot_service_set_serverless_cs_wakeup_active",
    "sellerpilot_service_begin_serverless_runtime_canary",
    "sellerpilot_service_complete_serverless_runtime_canary",
    "sellerpilot_service_activate_serverless_runtime",
    "sellerpilot_service_serverless_cs_wakeup_status",
  ]);
});

test("unsafe marketplace mutations block release activation before schedule changes", async () => {
  const calls: string[] = [];
  await assert.rejects(
    activateServerlessRuntimeRelease({
      origin: "https://sellerpilot-global.vercel.app",
      release,
      cronSecret: "server-runtime-secret-for-tests",
      rpc: async (name) => {
        calls.push(name);
        return { data: { configured: true, active: true, scheduleCount: 6, unsafePendingMutations: 1 }, error: null };
      },
      fetchImpl: (() => { throw new Error("must not fetch"); }) as typeof fetch,
    }),
    (error: unknown) => error instanceof ServerlessRuntimeReleaseError
      && error.safeCode === "runtime_unsafe_mutations_pending"
      && error.status === 409,
  );
  assert.deepEqual(calls, ["sellerpilot_service_serverless_cs_wakeup_status"]);
});

test("a mismatched no-work canary never completes a receipt or activates schedules", async () => {
  const calls: string[] = [];
  await assert.rejects(
    activateServerlessRuntimeRelease({
      origin: "https://sellerpilot-global.vercel.app",
      release,
      cronSecret: "server-runtime-secret-for-tests",
      rpc: async (name) => {
        calls.push(name);
        if (name === "sellerpilot_service_serverless_cs_wakeup_status") {
          return { data: { configured: true, active: false, scheduleCount: 6, unsafePendingMutations: 0 }, error: null };
        }
        if (name === "sellerpilot_service_set_serverless_cs_wakeup_active") {
          return { data: { configured: true, active: false, scheduleCount: 6 }, error: null };
        }
        if (name === "sellerpilot_service_begin_serverless_runtime_canary") return { data: receipt, error: null };
        return { data: null, error: null };
      },
      fetchImpl: (async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        return path === "/api/internal/channel-gateway-drain"
          ? response({ status: "canary", claimed: 0, processed: 0, release: "b".repeat(40) })
          : response({ status: "canary", executed: false, release });
      }) as typeof fetch,
    }),
    (error: unknown) => error instanceof ServerlessRuntimeReleaseError
      && error.safeCode === "runtime_gateway_canary_failed",
  );
  assert.deepEqual(calls, [
    "sellerpilot_service_serverless_cs_wakeup_status",
    "sellerpilot_service_set_serverless_cs_wakeup_active",
    "sellerpilot_service_begin_serverless_runtime_canary",
  ]);
});

test("release activation rejects a candidate deployment before any RPC or fetch", async () => {
  const rpcCalls: string[] = [];
  let fetchCalls = 0;
  await assert.rejects(
    activateServerlessRuntimeRelease({
      origin: "https://sellerpilot-global-candidate1-project-e59d.vercel.app",
      release,
      cronSecret: "server-runtime-secret-for-tests",
      rpc: async (name) => {
        rpcCalls.push(name);
        return { data: null, error: null };
      },
      fetchImpl: (async () => {
        fetchCalls += 1;
        return response({});
      }) as typeof fetch,
    }),
    (error: unknown) => error instanceof ServerlessRuntimeReleaseError
      && error.safeCode === "runtime_production_origin_required"
      && error.status === 409,
  );
  assert.deepEqual(rpcCalls, []);
  assert.equal(fetchCalls, 0);
});

test("a candidate canary checks only the exact deployment origin without any runtime RPC", async () => {
  const requests: Array<{
    url: string;
    method: string;
    authorization: string | null;
    trustedOidc: string | null;
    cache: RequestCache | undefined;
    redirect: RequestRedirect | undefined;
  }> = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = new URL(url).pathname;
    requests.push({
      url,
      method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("authorization"),
      trustedOidc: new Headers(init?.headers).get("x-vercel-trusted-oidc-idp-token"),
      cache: init?.cache,
      redirect: init?.redirect,
    });
    return path === "/api/internal/channel-gateway-drain"
      ? response({ status: "canary", claimed: 0, processed: 0, release })
      : response({ status: "canary", executed: false, release });
  };

  const result = await runCandidateServerlessRuntimeCanary({
    origin: "https://sellerpilot-global-candidate1-project-e59d.vercel.app",
    vercelUrl: "sellerpilot-global-candidate1-project-e59d.vercel.app",
    ...candidateRuntimeIdentity,
    release: release.toUpperCase(),
    cronSecret: "server-runtime-secret-for-tests",
    fetchImpl: fetchImpl as typeof fetch,
    oidcTokenProvider: async () => "short-lived-vercel-oidc-token",
  });

  assert.equal(result.release, release);
  assert.deepEqual(result, {
    release,
    claimed: 0,
    processed: 0,
    executed: false,
  });
  assert.equal(requests.length, 6);
  assert.equal(requests.filter((request) => request.method === "POST").length, 1);
  assert.equal(requests.every((request) => request.url.startsWith("https://sellerpilot-global-candidate1-project-e59d.vercel.app/api/internal/")), true);
  assert.equal(requests.every((request) => request.authorization?.startsWith("Bearer ")), true);
  assert.equal(requests.every((request) => !request.authorization?.includes("server-runtime-secret-for-tests")), true);
  assert.equal(requests.every((request) => request.trustedOidc === "short-lived-vercel-oidc-token"), true);
  assert.equal(requests.every((request) => request.cache === "no-store"), true);
  assert.equal(requests.every((request) => request.redirect === "error"), true);
});

test("a candidate canary rejects custom domains and malformed deployment origins before fetch", async () => {
  for (const origin of [
    "https://sellerpilot-global.vercel.app",
    "https://sellerpilot-global-project-e59d.vercel.app",
    "https://sellerpilot-global-candidate1-project-e59d.vercel.app.evil.test",
    "http://sellerpilot-global-candidate1-project-e59d.vercel.app",
    "https://user:password@sellerpilot-global-candidate1-project-e59d.vercel.app",
    "https://sellerpilot-global-candidate1-project-e59d.vercel.app:8443",
    "https://sellerpilot-global-candidate1-project-e59d.vercel.app/path",
    "https://sellerpilot-global-candidate1-project-e59d.vercel.app?mode=canary",
  ]) {
    await assert.rejects(
      runCandidateServerlessRuntimeCanary({
        origin,
        vercelUrl: "sellerpilot-global-candidate1-project-e59d.vercel.app",
        ...candidateRuntimeIdentity,
        release,
        cronSecret: "server-runtime-secret-for-tests",
        fetchImpl: (() => { throw new Error("must not fetch"); }) as typeof fetch,
        oidcTokenProvider: async () => "short-lived-vercel-oidc-token",
      }),
      (error: unknown) => error instanceof ServerlessRuntimeReleaseError
        && error.safeCode === "runtime_candidate_origin_required"
        && error.status === 409,
    );
  }
});

test("a candidate canary requires request origin to match the exact Vercel deployment identity", async () => {
  await assert.rejects(
    runCandidateServerlessRuntimeCanary({
      origin: "https://sellerpilot-global-candidate1-project-e59d.vercel.app",
      vercelUrl: "sellerpilot-global-candidate2-project-e59d.vercel.app",
      ...candidateRuntimeIdentity,
      release,
      cronSecret: "server-runtime-secret-for-tests",
      fetchImpl: (() => { throw new Error("must not fetch"); }) as typeof fetch,
      oidcTokenProvider: async () => "short-lived-vercel-oidc-token",
    }),
    (error: unknown) => error instanceof ServerlessRuntimeReleaseError
      && error.safeCode === "runtime_candidate_origin_required"
      && error.status === 409,
  );
});

test("a candidate canary rejects an unavailable runtime secret before fetch", async () => {
  await assert.rejects(
    runCandidateServerlessRuntimeCanary({
      origin: "https://sellerpilot-global-candidate1-project-e59d.vercel.app",
      vercelUrl: "sellerpilot-global-candidate1-project-e59d.vercel.app",
      ...candidateRuntimeIdentity,
      release,
      cronSecret: "",
      fetchImpl: (() => { throw new Error("must not fetch"); }) as typeof fetch,
      oidcTokenProvider: async () => "short-lived-vercel-oidc-token",
    }),
    (error: unknown) => error instanceof ServerlessRuntimeReleaseError
      && error.safeCode === "runtime_secret_unavailable"
      && error.status === 503,
  );
});

test("a candidate canary requires the exact Vercel project and production target", async () => {
  for (const identity of [
    { ...candidateRuntimeIdentity, vercelProjectId: "prj_other" },
    { ...candidateRuntimeIdentity, vercelEnvironment: "preview" },
    { ...candidateRuntimeIdentity, vercelTargetEnvironment: "staging" },
  ]) {
    await assert.rejects(
      runCandidateServerlessRuntimeCanary({
        origin: "https://sellerpilot-global-candidate1-project-e59d.vercel.app",
        vercelUrl: "sellerpilot-global-candidate1-project-e59d.vercel.app",
        ...identity,
        release,
        cronSecret: "server-runtime-secret-for-tests",
        fetchImpl: (() => { throw new Error("must not fetch"); }) as typeof fetch,
        oidcTokenProvider: async () => "short-lived-vercel-oidc-token",
      }),
      (error: unknown) => error instanceof ServerlessRuntimeReleaseError
        && error.safeCode === "runtime_candidate_project_required"
        && error.status === 409,
    );
  }
});

test("candidate automation bypass requires the exact runtime protection secret", () => {
  const expected = "candidate-protection-bypass-secret";
  assert.equal(candidateAutomationBypassAuthorized(expected, expected), true);
  assert.equal(candidateAutomationBypassAuthorized("wrong", expected), false);
  assert.equal(candidateAutomationBypassAuthorized(expected, "short"), false);
  assert.equal(candidateAutomationBypassAuthorized(null, expected), false);
});

test("the admin release route is authenticated and does not expose server secrets", async () => {
  const route = await readFile(new URL("../app/api/admin/serverless-runtime-release/route.ts", import.meta.url), "utf8");
  assert.match(route, /authenticateAdminRequest\(request/);
  assert.match(route, /verifyAsymmetricClaimsLocally: true/);
  assert.match(route, /candidateAutomationBypassAuthorized/);
  assert.match(route, /VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.match(route, /if \(!candidateAutomationAuthorized\)[\s\S]{0,320}status: 401/);
  assert.match(route, /runtime_candidate_automation_auth_required/);
  assert.match(route, /body\?\.action !== "candidate_canary" && body\?\.action !== "canary_activate"/);
  assert.match(route, /resolveRuntimeReleaseIdentity\(\)/);
  assert.match(route, /if \(body\.action === "candidate_canary"\)[\s\S]*runCandidateServerlessRuntimeCanary/);
  assert.match(route, /vercelUrl: process\.env\.VERCEL_URL/);
  assert.match(route, /vercelProjectId: process\.env\.VERCEL_PROJECT_ID/);
  assert.match(route, /vercelEnvironment: process\.env\.VERCEL_ENV/);
  assert.match(route, /vercelTargetEnvironment: process\.env\.VERCEL_TARGET_ENV/);
  const candidateBranchStart = route.indexOf('if (body.action === "candidate_canary") {');
  const candidateBranchEnd = route.indexOf("const admin = await authenticateAdminRequest", candidateBranchStart);
  assert.ok(candidateBranchStart >= 0 && candidateBranchEnd > candidateBranchStart);
  const candidateBranch = route.slice(candidateBranchStart, candidateBranchEnd);
  assert.ok(
    candidateBranch.indexOf("if (!candidateAutomationAuthorized)")
      < candidateBranch.indexOf("const identity = resolveRuntimeReleaseIdentity()"),
  );
  assert.doesNotMatch(candidateBranch, /authenticateAdminRequest/);
  assert.doesNotMatch(candidateBranch, /admin\.serviceClient/);
  assert.doesNotMatch(candidateBranch, /activateServerlessRuntimeRelease/);
  assert.doesNotMatch(candidateBranch, /readServerlessRuntimeReleaseStatus/);
  assert.match(route, /process\.env\.CRON_SECRET/);
  assert.doesNotMatch(route, /cronSecret:\s*process\.env\.CRON_SECRET[\s\S]{0,300}NextResponse\.json\([^)]*cronSecret/);
  assert.match(route, /운영 일정 재검증 결과를 확정하지 못했습니다/);
  assert.doesNotMatch(route, /일정은 비활성 상태로 유지됩니다/);
  assert.match(route, /readServerlessRuntimeReleaseStatus/);
  assert.match(route, /reconciled\?\.active === true/);
});
