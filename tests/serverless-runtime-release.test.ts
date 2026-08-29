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
  ServerlessRuntimeReleaseError,
} = await import("../lib/serverless-runtime-release");

const release = "8be84a57633f5d83647309c33814033337069e41";
const receipt = "a3dcf2d1-e79d-4e23-a1f2-a7f438220cde";

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

test("the admin release route is authenticated and does not expose server secrets", async () => {
  const route = await readFile(new URL("../app/api/admin/serverless-runtime-release/route.ts", import.meta.url), "utf8");
  assert.match(route, /authenticateAdminRequest\(request/);
  assert.match(route, /body\?\.action !== "canary_activate"/);
  assert.match(route, /resolveRuntimeReleaseIdentity\(\)/);
  assert.match(route, /process\.env\.CRON_SECRET/);
  assert.doesNotMatch(route, /cronSecret:\s*process\.env\.CRON_SECRET[\s\S]{0,300}NextResponse\.json\([^)]*cronSecret/);
  assert.match(route, /운영 일정 재검증 결과를 확정하지 못했습니다/);
  assert.doesNotMatch(route, /일정은 비활성 상태로 유지됩니다/);
  assert.match(route, /readServerlessRuntimeReleaseStatus/);
  assert.match(route, /reconciled\?\.active === true/);
});
