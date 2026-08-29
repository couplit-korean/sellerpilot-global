import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  runOneServerProductStudio,
  serverStudioRemoteWorkPlan,
} from "../lib/server-product-studio";

const JOB_IDS = [
  "30000000-0000-4000-8000-000000000001",
  "30000000-0000-4000-8000-000000000002",
  "30000000-0000-4000-8000-000000000003",
];

test("every active server AI SDK call hard-pins OpenAI without model fallback or SDK retry", async () => {
  const sourceContracts = [
    {
      name: "product research",
      source: await readFile(new URL("../lib/server-product-research.ts", import.meta.url), "utf8"),
      expectedAiCalls: 3,
      expectedModels: ["openai/gpt-5.5", "openai/gpt-image-2"],
    },
    {
      name: "product Studio",
      source: await readFile(new URL("../lib/server-product-studio.ts", import.meta.url), "utf8"),
      expectedAiCalls: 2,
      expectedModels: ["openai/gpt-5.5", "openai/gpt-image-2"],
    },
    {
      name: "runtime smoke",
      source: await readFile(new URL("../lib/server-runtime-smoke.ts", import.meta.url), "utf8"),
      expectedAiCalls: 1,
      expectedModels: ["openai/gpt-5.5"],
    },
  ];

  for (const contract of sourceContracts) {
    const aiCalls = contract.source.match(/\b(?:generateText|generateImage)\(\{/g) ?? [];
    const openAiOnlyAllowlists = contract.source.match(/\bonly:\s*\["openai"\]/g) ?? [];
    const disabledSdkRetries = contract.source.match(/\bmaxRetries:\s*0\b/g) ?? [];

    assert.equal(aiCalls.length, contract.expectedAiCalls, `${contract.name} AI call inventory changed`);
    assert.equal(
      openAiOnlyAllowlists.length,
      aiCalls.length,
      `${contract.name} must hard-pin every AI call to the OpenAI provider`,
    );
    assert.equal(
      disabledSdkRetries.length,
      aiCalls.length,
      `${contract.name} must not add opaque SDK retries`,
    );
    for (const model of contract.expectedModels) assert.match(contract.source, new RegExp(model.replaceAll(".", "\\.")));
    assert.doesNotMatch(contract.source, /\b(?:models|order):\s*\[/);
    assert.doesNotMatch(contract.source, /openai\/gpt-5\.4-mini/);
  }
});

test("one final Studio job reuses the first six behind one shared three-call ceiling", () => {
  const plan = serverStudioRemoteWorkPlan();
  assert.deepEqual(plan.settingWaves, [2]);
  assert.deepEqual(plan.sourceAuditWaves, [3, 3, 2]);
  assert.deepEqual(plan.localizedWaves, [3, 3, 3]);
  assert.equal(plan.maximumRemoteConcurrency, 3);
  assert.ok([
    ...plan.settingWaves,
    ...plan.sourceAuditWaves,
    ...plan.localizedWaves,
  ].every((wave) => wave <= plan.maximumRemoteConcurrency));
});

test("three exact failed claims settle independently and each hands off one immediate next wake", async () => {
  const claims = JOB_IDS.map((id, index) => ({
    id,
    claim_token: `40000000-0000-4000-8000-00000000000${index + 1}`,
    kind: "product_studio",
    claim_scope: "product",
    request: { preservedRetryIdentity: `product-${index + 1}` },
  }));
  const completed: Array<Record<string, unknown>> = [];
  const rpcNames: string[] = [];
  let wakeCount = 0;

  const dependencies = {
    tokenHash: "c".repeat(64),
    rpc: async (name: string, arguments_: Record<string, unknown> = {}) => {
      rpcNames.push(name);
      if (name === "sellerpilot_claim_product_ai_job") {
        return { data: claims.shift() ?? null, error: null };
      }
      if (name === "sellerpilot_service_begin_ai_job_completion") {
        return { data: true, error: null };
      }
      if (name === "sellerpilot_complete_ai_job_with_image_context") {
        completed.push(structuredClone(arguments_));
        return { data: true, error: null };
      }
      return { data: true, error: null };
    },
    wakeNext: async () => {
      wakeCount += 1;
      if (wakeCount === 1) throw new Error("simulated handoff response loss");
    },
    logError: (stage: string) => {
      if (stage === "next_wake") throw new Error("simulated diagnostic failure");
      if (stage !== "execution" && stage !== "next_wake") {
        assert.fail(`unexpected Studio stage: ${stage}`);
      }
    },
  };

  const responses = [];
  for (let index = 0; index < JOB_IDS.length; index += 1) {
    responses.push(await runOneServerProductStudio(dependencies));
  }
  assert.deepEqual(responses.map((response) => response.status), [200, 200, 200]);
  assert.deepEqual(
    await Promise.all(responses.map((response) => response.json())),
    JOB_IDS.map(() => ({ ok: false, status: "failed", processed: 1 })),
  );
  assert.equal(wakeCount, 3, "a lost handoff response must not roll back or block later jobs");
  assert.deepEqual(completed.map((call) => call.p_job_id), JOB_IDS);
  assert.equal(completed.every((call) => call.p_status === "failed"), true);
  assert.equal(completed.every((call) => call.p_error_message === "studio_request_invalid"), true);
  assert.equal(rpcNames.some((name) => /channel|listing|publish/i.test(name)), false);
});

test("idle and completion-uncertain claims never create a wake chain", async () => {
  let idleWakeCount = 0;
  const idle = await runOneServerProductStudio({
    tokenHash: "d".repeat(64),
    rpc: async () => ({ data: null, error: null }),
    wakeNext: async () => { idleWakeCount += 1; },
  });
  assert.deepEqual(await idle.json(), { ok: true, status: "idle", processed: 0 });
  assert.equal(idleWakeCount, 0);

  let uncertainWakeCount = 0;
  const uncertain = await runOneServerProductStudio({
    tokenHash: "e".repeat(64),
    rpc: async (name: string) => {
      if (name === "sellerpilot_claim_product_ai_job") {
        return {
          data: {
            id: "50000000-0000-4000-8000-000000000001",
            claim_token: "60000000-0000-4000-8000-000000000001",
            kind: "product_studio",
            claim_scope: "product",
            request: { preservedRetryIdentity: "uncertain" },
          },
          error: null,
        };
      }
      if (name === "sellerpilot_service_begin_ai_job_completion") {
        return { data: true, error: null };
      }
      if (name === "sellerpilot_complete_ai_job_with_image_context") {
        return { data: null, error: { code: "completion_response_uncertain" } };
      }
      return { data: true, error: null };
    },
    wakeNext: async () => { uncertainWakeCount += 1; },
    logError: () => {},
  });
  assert.equal(uncertain.status, 503);
  assert.equal(uncertainWakeCount, 0);
});

test("admin retry and the authenticated internal wake preserve queue identity without channel publication", async () => {
  const [adminRoute, internalRoute, researchRoute, runtime, retryMigration] = await Promise.all([
    readFile(new URL("../app/api/admin/ai-jobs/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/internal/product-studio-wake/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/internal/product-research/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server-product-studio-runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260827011228_reset_registration_activity_retry_clock.sql", import.meta.url), "utf8"),
  ]);

  const retryRpc = adminRoute.indexOf('"sellerpilot_retry_ai_job"');
  const wake = adminRoute.indexOf("after(wakeServerProductStudioAfterResponse)", retryRpc);
  assert.ok(retryRpc > 0 && wake > retryRpc);
  assert.match(adminRoute, /export const maxDuration = 300/);
  assert.doesNotMatch(adminRoute, /handOffServerProductStudioAfterResponse/);
  assert.doesNotMatch(adminRoute.slice(retryRpc, wake), /request_payload|manual_fields|image_paths/);
  assert.match(retryMigration, /set status = 'queued'[\s\S]*available_at = clock_timestamp\(\)[\s\S]*retry_started_at = clock_timestamp\(\)/);
  assert.doesNotMatch(retryMigration, /request_payload\s*=/);

  const post = internalRoute.indexOf("export async function POST");
  assert.ok(post > 0);
  assert.match(internalRoute.slice(post), /internalScheduleAuthorization/);
  assert.match(internalRoute.slice(post), /runtimeStatusMatchesCurrentRelease/);
  assert.match(internalRoute.slice(post), /after\(wakeServerProductStudioAfterResponse\)/);
  assert.match(internalRoute.slice(post), /status: "queued"[\s\S]*202/);
  assert.doesNotMatch(researchRoute, /\bafter\s*\(/);
  assert.match(runtime, /deriveSupabaseInternalScheduleBearer/);
  assert.match(runtime, /https:\/\/sellerpilot-global\.vercel\.app\/api\/internal\/product-studio-wake/);
  assert.match(runtime, /method: "POST"/);
  assert.match(runtime, /AbortSignal\.timeout\(10_000\)/);
  assert.match(runtime, /wakeNext: configuredNextProductWake\(\)/);
  assert.doesNotMatch(`${adminRoute}\n${internalRoute}\n${runtime}`, /listing\.create|channel-gateway|publish\/route/);
});
