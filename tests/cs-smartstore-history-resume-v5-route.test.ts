import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

const source = await readFile(new URL("../app/api/admin/cs/channels/smartstore/history-resume-v5/route.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal(transpiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length ?? 0, 0);
const compiled = transpiled.outputText;
const patchedHistoryWindow = await readFile(new URL("../app/cs/history-window.tsx", import.meta.url), "utf8");
const compiledHistoryWindow = ts.transpileModule(patchedHistoryWindow, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
});
assert.equal(compiledHistoryWindow.diagnostics?.filter(item =>
  item.category === ts.DiagnosticCategory.Error).length ?? 0, 0);
const patchedPage = await readFile(new URL("../app/cs/workspace.tsx", import.meta.url), "utf8");

type RpcCall = { name: string; args?: Record<string, unknown> };
type AuthenticationFixture = "allowed" | "anonymous" | "expired" | "nonadmin";

const activeCredential = {
  id: "00000000-0000-4000-8000-000000000101",
  channel: "smartstore",
  environment: "production",
  status: "active",
};
const checkpointBase = {
  contract: "sellerpilot-smartstore-history-checkpoint/4",
  checkedAt: "2026-09-08T00:00:00Z",
  environment: "production",
  totalWindowCount: 1,
  completedWindowCount: 0,
  remainingWindowCount: 1,
  complete: false,
  nextWindow: {
    key: "smartstore:history:v4:2026-09-08:2026-09-08",
    fromDate: "2026-09-08",
    throughDate: "2026-09-08",
    productItemKey: "product:2026-09-08:2026-09-08",
    customerItemKey: "customer:2026-09-08:2026-09-08",
  },
  advanceRule: "current_cutoff_deferred_behind_older_exact_full_kst_day_windows",
};

function authenticationResponse(fixture: AuthenticationFixture) {
  if (fixture === "anonymous") return Response.json({ message: "login required" }, { status: 401 });
  if (fixture === "expired") return Response.json({ message: "session expired" }, { status: 401 });
  if (fixture === "nonadmin") return Response.json({ message: "admin required" }, { status: 403 });
  return null;
}

async function loadRoute({
  authentication = "allowed",
  credentials = [activeCredential],
  checkpoint = checkpointBase,
  checkpointError = null,
  enqueueError = null,
}: {
  authentication?: AuthenticationFixture;
  credentials?: unknown[];
  checkpoint?: unknown;
  checkpointError?: { message: string } | null;
  enqueueError?: { message: string } | null;
} = {}) {
  const calls: RpcCall[] = [];
  let authenticateCalls = 0;
  const exportsObject: Record<string, unknown> = {};
  const sandbox = vm.createContext({
    exports: exportsObject,
    Request,
    Response,
    URL,
    Date,
    require(name: string) {
      if (name === "zod") return { z };
      if (name === "next/server") return { NextResponse: Response };
      if (name.endsWith("/admin-api")) return {
        authenticateAdminRequest: async () => {
          authenticateCalls += 1;
          const denied = authenticationResponse(authentication);
          if (denied) return denied;
          return {
            userClient: {
              rpc: async (rpcName: string, args?: Record<string, unknown>) => {
                calls.push({ name: rpcName, args });
                if (rpcName === "sellerpilot_list_credentials") {
                  return { data: credentials, error: null };
                }
                if (rpcName === "sellerpilot_next_smartstore_history_window_v4") {
                  return { data: checkpoint, error: checkpointError };
                }
                if (rpcName === "sellerpilot_start_smartstore_inquiry_history_window_v7") {
                  return {
                    data: {
                      runId: "00000000-0000-4000-8000-000000000202",
                      jobCount: 2,
                    },
                    error: enqueueError,
                  };
                }
                throw new Error(`unexpected rpc ${rpcName}`);
              },
            },
          };
        },
        isAdminApiError: (value: unknown) => value instanceof Response,
      };
      throw new Error(`unexpected import ${name}`);
    },
  });
  vm.runInContext(compiled, sandbox);
  return {
    route: exportsObject as {
      GET: (request: Request) => Promise<Response>;
      POST: (request: Request) => Promise<Response>;
    },
    calls,
    authenticateCallCount: () => authenticateCalls,
  };
}

function postRequest(body: unknown) {
  return new Request("https://sellerpilot.test/api/admin/cs/channels/smartstore/history-resume-v5", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("the integrated route compiles and exports GET and POST", async () => {
  assert.match(source, /export async function GET/);
  assert.match(source, /export async function POST/);
  const loaded = await loadRoute();
  assert.equal(typeof loaded.route.GET, "function");
  assert.equal(typeof loaded.route.POST, "function");
});

test("the integrated UI submits the selected SmartStore history dates to the authenticated resume route", () => {
  assert.match(patchedHistoryWindow, /\/api\/admin\/cs\/channels\/smartstore\/history-resume-v5/);
  assert.match(patchedHistoryWindow, /floorDate, throughDate: endDate, credentialId: smartstoreCredentialId/);
  assert.match(patchedHistoryWindow, /aria-label="스마트스토어 계정"/);
  assert.match(patchedHistoryWindow, /value=\{floorDate\}/);
  assert.doesNotMatch(patchedHistoryWindow, /onBackfill\("smartstore"/);
  assert.match(patchedPage, /<CsHistoryWindow authenticatedFetch=\{authenticatedFetch\}/);
  const transpiled = ts.transpileModule(patchedHistoryWindow, {
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  });
  assert.equal(transpiled.diagnostics?.length ?? 0, 0);
});

test("authenticated account discovery exposes safe choices without provider keys", async () => {
  const selected = { ...activeCredential, id: "00000000-0000-4000-8000-000000000102" };
  const loaded = await loadRoute({ credentials: [activeCredential, selected] });
  const response = await loaded.route.GET(new Request(
    "https://sellerpilot.test/api/admin/cs/channels/smartstore/history-resume-v5?accounts=1",
  ));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    contract: "sellerpilot-smartstore-history-account-list/1",
    accounts: [
      { credentialId: activeCredential.id, label: "스마트스토어 계정 1" },
      { credentialId: selected.id, label: "스마트스토어 계정 2" },
    ],
  });
  assert.deepEqual(loaded.calls.map(call => call.name), ["sellerpilot_list_credentials"]);
});

type RenderedNode = {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
  key?: string | null;
};

function createComponentHarness() {
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  const effectDependencies: Array<unknown[] | undefined> = [];
  const cleanups: Array<(() => void) | undefined> = [];
  let scheduledEffects: Array<{ index: number; effect: () => void | (() => void) }> = [];
  let hookIndex = 0;
  const sameDependencies = (left: unknown[] | undefined, right: unknown[] | undefined) =>
    left !== undefined && right !== undefined && left.length === right.length
      && left.every((value, index) => Object.is(value, right[index]));
  const react = {
    useState(initial: unknown) {
      const index = hookIndex;
      hookIndex += 1;
      if (!(index in states)) states[index] = typeof initial === "function"
        ? (initial as () => unknown)()
        : initial;
      return [states[index], (next: unknown) => {
        states[index] = typeof next === "function"
          ? (next as (current: unknown) => unknown)(states[index])
          : next;
      }];
    },
    useRef(initial: unknown) {
      const index = hookIndex;
      hookIndex += 1;
      refs[index] ??= { current: initial };
      return refs[index];
    },
    useEffect(effect: () => void | (() => void), dependencies?: unknown[]) {
      const index = hookIndex;
      hookIndex += 1;
      if (!sameDependencies(effectDependencies[index], dependencies)) {
        effectDependencies[index] = dependencies;
        scheduledEffects.push({ index, effect });
      }
    },
  };
  const jsxRuntime = {
    Fragment: Symbol("fragment"),
    jsx: (type: unknown, props: Record<string, unknown>, key?: string) => ({ type, props, key }),
    jsxs: (type: unknown, props: Record<string, unknown>, key?: string) => ({ type, props, key }),
  };
  const exportsObject: Record<string, unknown> = {};
  const sandbox = vm.createContext({
    exports: exportsObject,
    AbortController,
    Date,
    require(name: string) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return jsxRuntime;
      throw new Error(`unexpected component import ${name}`);
    },
  });
  vm.runInContext(compiledHistoryWindow.outputText, sandbox);
  const Component = exportsObject.CsHistoryWindow as (props: Record<string, unknown>) => RenderedNode;
  return {
    render(props: Record<string, unknown>) {
      hookIndex = 0;
      scheduledEffects = [];
      const tree = Component(props);
      for (const scheduled of scheduledEffects) {
        cleanups[scheduled.index]?.();
        cleanups[scheduled.index] = scheduled.effect() ?? undefined;
      }
      return tree;
    },
    unmount() {
      for (const cleanup of cleanups) cleanup?.();
    },
  };
}

function renderedNodes(node: unknown): RenderedNode[] {
  if (Array.isArray(node)) return node.flatMap(renderedNodes);
  if (!node || typeof node !== "object") return [];
  const rendered = node as RenderedNode;
  if (!rendered.props) return [];
  const children = Array.isArray(rendered.props?.children)
    ? rendered.props.children
    : [rendered.props?.children];
  return [rendered, ...children.flatMap(renderedNodes)];
}

test("rendered account selection posts the exact second account through the actual route RPCs", async () => {
  const selected = { ...activeCredential, id: "00000000-0000-4000-8000-000000000102" };
  const loaded = await loadRoute({ credentials: [activeCredential, selected] });
  const authenticatedFetch = async (input: string, init: RequestInit = {}) => {
    const request = new Request(`https://sellerpilot.test${input}`, init);
    return init.method === "POST"
      ? loaded.route.POST(request)
      : loaded.route.GET(request);
  };
  const props = { authenticatedFetch, onBackfill: async () => {}, disabled: false };
  const harness = createComponentHarness();
  let tree = harness.render(props);
  await new Promise(resolve => setImmediate(resolve));
  tree = harness.render(props);
  const accountSelect = renderedNodes(tree).find(node =>
    node.type === "select" && node.props["aria-label"] === "스마트스토어 계정");
  assert.ok(accountSelect);
  assert.equal(accountSelect.props.value, activeCredential.id);
  const dateInputs = renderedNodes(tree).filter(node =>
    node.type === "input" && node.props.type === "date");
  assert.equal(dateInputs.length, 2);
  (dateInputs[0].props.onChange as (event: { target: { value: string } }) => void)({
    target: { value: "2026-09-08" },
  });
  (dateInputs[1].props.onChange as (event: { target: { value: string } }) => void)({
    target: { value: "2026-09-08" },
  });
  (accountSelect.props.onChange as (event: { target: { value: string } }) => void)({
    target: { value: selected.id },
  });
  tree = harness.render(props);
  const resumeButton = renderedNodes(tree).find(node =>
    node.type === "button" && node.props.children === "스마트스토어 다음 구간");
  assert.ok(resumeButton);
  (resumeButton.props.onClick as () => void)();
  for (let turn = 0; turn < 5 && !loaded.calls.some(call =>
    call.name === "sellerpilot_start_smartstore_inquiry_history_window_v7"); turn += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
  const checkpoint = loaded.calls.find(call =>
    call.name === "sellerpilot_next_smartstore_history_window_v4");
  const enqueue = loaded.calls.find(call =>
    call.name === "sellerpilot_start_smartstore_inquiry_history_window_v7");
  assert.ok(checkpoint, JSON.stringify(loaded.calls));
  assert.ok(enqueue, JSON.stringify(loaded.calls));
  assert.equal(checkpoint?.args?.p_credential_id, selected.id);
  assert.equal(enqueue?.args?.p_credential_id, selected.id);
  harness.unmount();
});

test("selection changes and unmount abort in-flight resumes and ignore stale responses", async () => {
  const credentialB = "00000000-0000-4000-8000-000000000102";
  const pending: Array<{
    signal: AbortSignal;
    resolve: (response: Response) => void;
  }> = [];
  const authenticatedFetch = async (_input: string, init: RequestInit = {}) => {
    if (init.method !== "POST") return Response.json({
      contract: "sellerpilot-smartstore-history-account-list/1",
      accounts: [
        { credentialId: activeCredential.id, label: "스마트스토어 계정 1" },
        { credentialId: credentialB, label: "스마트스토어 계정 2" },
      ],
    });
    return new Promise<Response>(resolve => pending.push({
      signal: init.signal as AbortSignal,
      resolve,
    }));
  };
  const props = { authenticatedFetch, onBackfill: async () => {}, disabled: false };
  const harness = createComponentHarness();
  harness.render(props);
  await new Promise(resolve => setImmediate(resolve));
  let tree = harness.render(props);
  let nodes = renderedNodes(tree);
  const firstButton = nodes.find(node =>
    node.type === "button" && node.props.children === "스마트스토어 다음 구간")!;
  (firstButton.props.onClick as () => void)();
  assert.equal(pending.length, 1);
  const accountSelect = nodes.find(node =>
    node.type === "select" && node.props["aria-label"] === "스마트스토어 계정")!;
  (accountSelect.props.onChange as (event: { target: { value: string } }) => void)({
    target: { value: credentialB },
  });
  assert.equal(pending[0].signal.aborted, true);
  pending[0].resolve(Response.json({
    acceptedNotCompleted: true,
    checkpointBeforeEnqueue: { nextWindow: { fromDate: "2001-01-01", throughDate: "2001-01-30" } },
  }, { status: 202 }));
  await new Promise(resolve => setImmediate(resolve));
  tree = harness.render(props);
  nodes = renderedNodes(tree);
  assert.equal(nodes.some(node => node.props.role === "status"), false);

  const secondButton = nodes.find(node =>
    node.type === "button" && node.props.children === "스마트스토어 다음 구간")!;
  (secondButton.props.onClick as () => void)();
  assert.equal(pending.length, 2);
  harness.unmount();
  assert.equal(pending[1].signal.aborted, true);
});

test("GET invokes authenticateAdminRequest and reads the exact checkpoint without enqueue", async () => {
  const loaded = await loadRoute();
  const response = await loaded.route.GET(new Request(
    "https://sellerpilot.test/api/admin/cs/channels/smartstore/history-resume-v5?floorDate=2026-09-08&throughDate=2026-09-08",
  ));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(loaded.authenticateCallCount(), 1);
  assert.deepEqual(loaded.calls.map(call => call.name), [
    "sellerpilot_list_credentials",
    "sellerpilot_next_smartstore_history_window_v4",
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.calls[1]?.args)), {
    p_floor_date: "2026-09-08",
    p_through_date: "2026-09-08",
    p_credential_id: activeCredential.id,
    p_environment: "production",
  });
  assert.deepEqual(await response.json(), checkpointBase);
});

test("anonymous, expired, and non-admin fixtures fail before credential or checkpoint RPCs", async () => {
  for (const [fixture, status] of [
    ["anonymous", 401],
    ["expired", 401],
    ["nonadmin", 403],
  ] as const) {
    const loaded = await loadRoute({ authentication: fixture });
    const response = await loaded.route.POST(postRequest({
      floorDate: "2026-09-08",
      throughDate: "2026-09-08",
    }));
    assert.equal(response.status, status);
    assert.equal(loaded.authenticateCallCount(), 1);
    assert.equal(loaded.calls.length, 0);
  }
});

test("invalid dates fail closed after authentication and before any database RPC", async () => {
  for (const body of [
    { floorDate: "2026-02-30", throughDate: "2026-03-01" },
    { floorDate: "2026-09-09", throughDate: "2026-09-08" },
    { floorDate: "2026-9-08", throughDate: "2026-09-08" },
    { floorDate: "2026-09-08", throughDate: "2026-09-08", channel: "smartstore" },
  ]) {
    const loaded = await loadRoute();
    const response = await loaded.route.POST(postRequest(body));
    assert.equal(response.status, 400);
    assert.equal(loaded.authenticateCallCount(), 1);
    assert.equal(loaded.calls.length, 0);
  }
});

test("multiple active production SmartStore credentials fail closed", async () => {
  const loaded = await loadRoute({
    credentials: [activeCredential, { ...activeCredential, id: "00000000-0000-4000-8000-000000000102" }],
  });
  const response = await loaded.route.POST(postRequest({
    floorDate: "2026-09-08",
    throughDate: "2026-09-08",
  }));
  assert.equal(response.status, 409);
  assert.deepEqual(loaded.calls.map(call => call.name), ["sellerpilot_list_credentials"]);
});

test("an explicit credential keeps a multi-account history read in the selected scope", async () => {
  const selected = { ...activeCredential, id: "00000000-0000-4000-8000-000000000102" };
  const loaded = await loadRoute({ credentials: [activeCredential, selected] });
  const response = await loaded.route.POST(postRequest({
    floorDate: "2026-09-08",
    throughDate: "2026-09-08",
    credentialId: selected.id,
  }));
  assert.equal(response.status, 202);
  const checkpoint = loaded.calls.find(call =>
    call.name === "sellerpilot_next_smartstore_history_window_v4");
  const enqueue = loaded.calls.find(call =>
    call.name === "sellerpilot_start_smartstore_inquiry_history_window_v7");
  assert.equal(checkpoint?.args?.p_credential_id, selected.id);
  assert.equal(enqueue?.args?.p_credential_id, selected.id);
});

test("inconsistent completion, wrong total window count and cross-window receipts never enqueue", async () => {
  for (const checkpoint of [
    { ...checkpointBase, nextWindow: null },
    { ...checkpointBase, complete: true },
    { ...checkpointBase, totalWindowCount: 2, remainingWindowCount: 2 },
    { ...checkpointBase, nextWindow: { ...checkpointBase.nextWindow, fromDate: "2026-09-07" } },
    { ...checkpointBase, nextWindow: { ...checkpointBase.nextWindow, key: "another-window" } },
  ]) {
    const loaded = await loadRoute({ checkpoint });
    const response = await loaded.route.POST(postRequest({ floorDate: "2026-09-08", throughDate: "2026-09-08" }));
    assert.ok([502, 503].includes(response.status));
    assert.equal(loaded.calls.some(call => call.name === "sellerpilot_start_smartstore_inquiry_history_window_v7"), false);
  }
});

test("a completed checkpoint returns 200 and enqueues zero jobs", async () => {
  const checkpoint = {
    ...checkpointBase,
    completedWindowCount: 1,
    remainingWindowCount: 0,
    complete: true,
    nextWindow: null,
  };
  const loaded = await loadRoute({ checkpoint });
  const response = await loaded.route.POST(postRequest({
    floorDate: "2026-09-08",
    throughDate: "2026-09-08",
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(loaded.calls.map(call => call.name), [
    "sellerpilot_list_credentials",
    "sellerpilot_next_smartstore_history_window_v4",
  ]);
  const body = await response.json();
  assert.equal(body.historyBackfill, null);
  assert.equal(body.checkpoint.complete, true);
});

test("a one-day next window passes exact RPC dates and returns 202 accepted-not-completed", async () => {
  const loaded = await loadRoute();
  const response = await loaded.route.POST(postRequest({
    floorDate: "2026-09-08",
    throughDate: "2026-09-08",
  }));
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  const enqueue = loaded.calls.find(call => call.name === "sellerpilot_start_smartstore_inquiry_history_window_v7");
  assert.deepEqual(JSON.parse(JSON.stringify(enqueue?.args)), {
    p_from_date: "2026-09-08",
    p_through_date: "2026-09-08",
    p_credential_id: activeCredential.id,
    p_environment: "production",
  });
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.acceptedNotCompleted, true);
  assert.equal(body.checkpointBeforeEnqueue.nextWindow.fromDate, "2026-09-08");
  assert.equal(body.checkpointBeforeEnqueue.nextWindow.throughDate, "2026-09-08");
  assert.equal(body.historyBackfill.jobCount, 2);
});

test("enqueue rejection returns 409 and never converts acceptance into completion", async () => {
  const loaded = await loadRoute({ enqueueError: { message: "rejected" } });
  const response = await loaded.route.POST(postRequest({
    floorDate: "2026-09-08",
    throughDate: "2026-09-08",
  }));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.acceptedNotCompleted, undefined);
  assert.equal(body.checkpoint.nextWindow.fromDate, "2026-09-08");
});
