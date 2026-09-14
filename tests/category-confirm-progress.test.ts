import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createBoundedRequestSignal, waitForAbortablePromise } from "../app/operations-snapshot-request-coordinator";

async function harness(options: { holdSave?: boolean; holdSession?: boolean; sourceStatus?: number; sourceReady?: boolean; timeoutMs?: number } = {}) {
  const source = await readFile(new URL("../app/category-classification-workbench.tsx", import.meta.url), "utf8");
  const start = source.indexOf("  const confirm = async (channel:");
  const end = source.indexOf("\n  return <section", start);
  assert.ok(start > 0 && end > start);
  const state = { selected: { id: "50002253", path: ["음료", "사이다"], confidence: 1 }, attributes: [], values: { brand: "나랑드" }, verifiedLeaf: true, officialMetadata: {}, phase: "ready" };
  let states: Record<string, any> = { smartstore: state };
  let progress: Record<string, string> = {};
  let saveCalls = 0; let sourceCalls = 0; let confirmations = 0;
  const messages: string[] = [];
  const stages: string[] = [];
  let releaseSave!: () => void;
  const savePending = new Promise<void>(resolve => { releaseSave = resolve; });
  const controller = new AbortController();
  const locks = new Set<string>();
  const client = {
    rpc: async (name: string) => {
      if (name === "sellerpilot_save_product_category_assignment") {
        saveCalls++;
        if (options.holdSave) await savePending;
        return { error: null };
      }
      assert.equal(name, "sellerpilot_list_credentials");
      return { data: [] };
    },
    auth: { getSession: async () => options.holdSession ? await new Promise(() => {}) : { data: { session: { access_token: "fixture" } } } },
  };
  const dependencies = {
    stateKey: () => "smartstore", productId: "product", states,
    categoryConfirmationsRef: { current: locks }, categoryOperationAbortRef: { current: controller },
    activeCredential: new Map([["smartstore", { environment: "production" }]]), selectedTarget: () => null,
    notify: (message: string) => messages.push(message), sourceRef: "test", productName: "나랑드 사이다",
    missingCategoryInputIssues: () => [], assignmentCategoryAttributeDescriptors: () => [],
    serializeCategoryAttributeValues: () => ({ brand: "나랑드" }), categoryConfirmationTargets: () => [null],
    categoryMarketCode: () => "KR", createClient: () => client,
    selectActiveProductionCredential: () => ({ id: "credential" }),
    channelCatalog: { smartstore: { name: "스마트스토어" } }, onConfirmed: () => { confirmations++; },
    setStates: (update: (value: typeof states) => typeof states) => { states = update(states); },
    setConfirmationProgress: (update: (value: typeof progress) => typeof progress) => {
      progress = update(progress); stages.push(...Object.values(progress));
    },
    createBoundedRequestSignal: (signal: AbortSignal, _timeoutMs: number, message: string) => createBoundedRequestSignal(signal, options.timeoutMs ?? 1000, message),
    waitForAbortablePromise,
    fetch: async () => {
      sourceCalls++;
      return new Response(JSON.stringify({ sourceReady: options.sourceReady ?? true, message: "공식 원본 확인 실패" }), { status: options.sourceStatus ?? 200 });
    },
  };
  const compiled = ts.transpileModule(`${source.slice(start, end)}\nreturn confirm;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const confirm = new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies)) as (channel: string) => Promise<void>;
  return { confirm, releaseSave, controller, locks, messages, stages, snapshot: () => ({ states, progress, saveCalls, sourceCalls, confirmations }) };
}

test("category confirm locks synchronously before React render, shows stages and completes once", async () => {
  const h = await harness({ holdSave: true });
  const pending = h.confirm("smartstore");
  await h.confirm("smartstore");
  assert.equal(h.snapshot().saveCalls, 1);
  assert.equal(h.snapshot().sourceCalls, 0);
  assert.match(Object.values(h.snapshot().progress)[0], /입력 속성 저장 중/);
  h.releaseSave(); await pending;
  assert.equal(h.snapshot().sourceCalls, 1);
  assert.equal(h.snapshot().confirmations, 1);
  assert.equal(h.snapshot().states.smartstore.phase, "confirmed");
  assert.equal(h.locks.size, 0);
  assert.deepEqual(h.snapshot().progress, {});
  assert.ok(h.stages.some(stage => stage.includes("계정 연결 확인")));
  assert.ok(h.stages.some(stage => stage.includes("공식 속성 원본 확인")));
});

test("source failure preserves entered attributes and saved-assignment stage without falsely confirming", async () => {
  const h = await harness({ sourceStatus: 503, sourceReady: false });
  await h.confirm("smartstore");
  assert.equal(h.snapshot().states.smartstore.phase, "error");
  assert.deepEqual(h.snapshot().states.smartstore.values, { brand: "나랑드" });
  assert.match(h.snapshot().states.smartstore.error, /입력 속성 저장 완료.*공식 원본 확인 실패/);
  assert.equal(h.snapshot().confirmations, 0);
  assert.equal(h.locks.size, 0);
  assert.deepEqual(h.snapshot().progress, {});
});

test("hung credential/session read times out visibly and never posts a source job", async () => {
  const h = await harness({ holdSession: true, timeoutMs: 10 });
  await h.confirm("smartstore");
  assert.match(h.snapshot().states.smartstore.error, /계정 연결 확인 중.*대기 시간이 초과/);
  assert.equal(h.snapshot().sourceCalls, 0);
  assert.equal(h.snapshot().confirmations, 0);
  assert.equal(h.locks.size, 0);
  assert.deepEqual(h.snapshot().progress, {});
});

test("product navigation abort releases pending confirmation without corrupting the next product UI", async () => {
  const h = await harness({ holdSave: true });
  const pending = h.confirm("smartstore");
  h.controller.abort(); await pending;
  assert.equal(h.snapshot().sourceCalls, 0);
  assert.equal(h.snapshot().confirmations, 0);
  assert.equal(h.messages.length, 0);
  assert.equal(h.snapshot().states.smartstore.phase, "ready");
  assert.equal(h.locks.size, 0);
});
