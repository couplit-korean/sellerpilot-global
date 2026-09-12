import assert from "node:assert/strict";
import test from "node:test";
import type { Root } from "react-dom/client";
import { coreFirstDraftAssetIds } from "../../lib/ai-generated-assets";

const { Window } = await import("../../node_modules/.pnpm/happy-dom@20.11.2/node_modules/happy-dom/lib/index.js");
const browserWindow = new Window({ url: "https://sellerpilot.test/products" });
for (const [name, value] of Object.entries({
  window: browserWindow,
  document: browserWindow.document,
  navigator: browserWindow.navigator,
  HTMLElement: browserWindow.HTMLElement,
  Node: browserWindow.Node,
  Event: browserWindow.Event,
})) {
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
}
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const [{ StrictMode, act, createElement }, { createRoot }, { useFirstDraftImages }] = await Promise.all([
  import("react"),
  import("react-dom/client"),
  import("../../app/_publishing/use-first-draft-images"),
]);

type HookApi = ReturnType<typeof useFirstDraftImages>;
type HookDependencies = Parameters<typeof useFirstDraftImages>[0];

const firstJobId = "11111111-1111-4111-8111-111111111111";
const secondJobId = "22222222-2222-4222-8222-222222222222";
const authenticationRequiredMessage = "로그인 세션이 만료되었습니다. 다시 로그인한 뒤 같은 작업을 다시 확인해 주세요.";

function catalogResult(job = "first") {
  return {
    generatedImages: coreFirstDraftAssetIds.map((id) => ({ id, url: `https://example.test/${job}/${id}.png` })),
    preflightAssetLineage: Object.fromEntries(coreFirstDraftAssetIds.map((id, index) => [id, {
      auditMode: "source-photo-catalog",
      digest: (index + 1).toString(16).repeat(64),
    }])),
  };
}

function completeResult(job = "first") {
  return {
    generatedImages: coreFirstDraftAssetIds.map((id) => ({ id, url: `https://example.test/${job}/${id}.png` })),
    preflightAssetLineage: Object.fromEntries(coreFirstDraftAssetIds.map((id, index) => [id, {
      auditMode: "segmented-source-composite",
      digest: (index + 1).toString(16).repeat(64),
    }])),
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function mountedHook(dependencies: HookDependencies, strict = false) {
  const container = document.createElement("div");
  document.body.append(container);
  let current: HookApi | null = null;
  function Harness() {
    current = useFirstDraftImages(dependencies);
    return null;
  }
  const root = createRoot(container);
  await act(async () => {
    root.render(strict
      ? createElement(StrictMode, null, createElement(Harness))
      : createElement(Harness));
  });
  return {
    api: () => {
      assert.ok(current);
      return current;
    },
    root,
    container,
  };
}

async function unmount(root: Root, container: Element) {
  await act(async () => root.unmount());
  container.remove();
}

async function waitForTimers(ms = 20) {
  await act(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  });
}

test("normal and StrictMode mounts both activate and enqueue exactly once", async () => {
  for (const strict of [false, true]) {
    let enqueueCount = 0;
    const fixture = await mountedHook({
      getAccessToken: async () => "token",
      fetcher: async (input) => {
        assert.equal(String(input), "/api/admin/first-draft-images-enqueue");
        enqueueCount += 1;
        return jsonResponse({ jobId: firstJobId }, 202);
      },
      pollDelayMs: 60_000,
    }, strict);
    let accepted = false;
    await act(async () => {
      fixture.api().activateFirstDraftJob(firstJobId, catalogResult());
      accepted = await fixture.api().startFirstDraftConceptImages(firstJobId);
    });
    assert.equal(accepted, true, strict ? "StrictMode request should be accepted" : "normal request should be accepted");
    assert.equal(enqueueCount, 1);
    assert.equal(fixture.api().firstDraftImagePhase, "queued");
    await unmount(fixture.root, fixture.container);
  }
});

test("polling session loss releases the job and relogin resumes polling without a second enqueue", async () => {
  let accessToken: string | undefined = "token";
  let enqueueCount = 0;
  let recoverCount = 0;
  const fixture = await mountedHook({
    getAccessToken: async () => accessToken,
    fetcher: async (input) => {
      if (String(input).includes("first-draft-images-enqueue")) {
        enqueueCount += 1;
        return jsonResponse({ jobId: firstJobId }, 202);
      }
      recoverCount += 1;
      return jsonResponse({ jobId: firstJobId, result: completeResult() });
    },
    pollDelayMs: 2,
  });
  await act(async () => {
    fixture.api().activateFirstDraftJob(firstJobId, catalogResult());
    assert.equal(await fixture.api().startFirstDraftConceptImages(firstJobId), true);
  });
  accessToken = undefined;
  await waitForTimers();
  assert.equal(fixture.api().firstDraftImagePhase, "failed");
  assert.equal(fixture.api().firstDraftRetryAvailable, true);
  assert.equal(fixture.api().firstDraftConceptStatus, authenticationRequiredMessage);
  assert.equal(recoverCount, 0);

  accessToken = "restored-token";
  await act(async () => {
    assert.equal(await fixture.api().startFirstDraftConceptImages(firstJobId), true);
  });
  await waitForTimers();
  assert.equal(enqueueCount, 1);
  assert.equal(recoverCount, 1);
  assert.equal(fixture.api().firstDraftImagePhase, "complete");
  assert.equal(fixture.api().firstDraftRetryAvailable, false);
  await unmount(fixture.root, fixture.container);
});

test("a polling 401 follows the same relogin-only resume path", async () => {
  let enqueueCount = 0;
  let recoverCount = 0;
  const fixture = await mountedHook({
    getAccessToken: async () => "token",
    fetcher: async (input) => {
      if (String(input).includes("first-draft-images-enqueue")) {
        enqueueCount += 1;
        return jsonResponse({ jobId: firstJobId }, 202);
      }
      recoverCount += 1;
      return recoverCount === 1
        ? jsonResponse({ message: "expired" }, 401)
        : jsonResponse({ jobId: firstJobId, result: completeResult() });
    },
    pollDelayMs: 2,
  });
  await act(async () => {
    fixture.api().activateFirstDraftJob(firstJobId, catalogResult());
    assert.equal(await fixture.api().startFirstDraftConceptImages(firstJobId), true);
  });
  await waitForTimers();
  assert.equal(fixture.api().firstDraftImagePhase, "failed");
  assert.equal(fixture.api().firstDraftRetryAvailable, true);
  assert.equal(fixture.api().firstDraftConceptStatus, authenticationRequiredMessage);
  await act(async () => {
    assert.equal(await fixture.api().startFirstDraftConceptImages(firstJobId), true);
  });
  await waitForTimers();
  assert.equal(enqueueCount, 1);
  assert.equal(recoverCount, 2);
  assert.equal(fixture.api().firstDraftImagePhase, "complete");
  await unmount(fixture.root, fixture.container);
});

test("initial authentication failure retries enqueue, while unmount blocks its late response", async () => {
  const session: { accessToken?: string } = {};
  let enqueueCount = 0;
  let resolveEnqueue: ((response: Response) => void) | null = null;
  const fixture = await mountedHook({
    getAccessToken: async () => session.accessToken,
    fetcher: async () => {
      enqueueCount += 1;
      return new Promise<Response>((resolve) => { resolveEnqueue = resolve; });
    },
    pollDelayMs: 60_000,
  });
  await act(async () => fixture.api().activateFirstDraftJob(firstJobId, catalogResult()));
  await act(async () => {
    assert.equal(await fixture.api().startFirstDraftConceptImages(firstJobId), false);
  });
  assert.equal(enqueueCount, 0);
  assert.equal(fixture.api().firstDraftRetryAvailable, true);
  assert.equal(fixture.api().firstDraftConceptStatus, authenticationRequiredMessage);

  session.accessToken = "restored-token";
  let acceptedPromise: Promise<boolean> | null = null;
  await act(async () => {
    acceptedPromise = fixture.api().startFirstDraftConceptImages(firstJobId);
    await Promise.resolve();
  });
  assert.equal(enqueueCount, 1);
  await unmount(fixture.root, fixture.container);
  assert.ok(resolveEnqueue);
  resolveEnqueue(jsonResponse({ jobId: firstJobId }, 202));
  assert.equal(await acceptedPromise, false);
});

test("a late previous-job recovery cannot overwrite the next job and polling stops at its limit", async () => {
  let resolveOldRecovery: ((response: Response) => void) | null = null;
  let oldRecoveryStarted: (() => void) | null = null;
  const oldStarted = new Promise<void>((resolve) => { oldRecoveryStarted = resolve; });
  let enqueueCount = 0;
  let secondRecoverCount = 0;
  const fixture = await mountedHook({
    getAccessToken: async () => "token",
    fetcher: async (input, init) => {
      if (String(input).includes("first-draft-images-enqueue")) {
        enqueueCount += 1;
        const jobId = JSON.parse(String(init?.body)).jobId as string;
        return jsonResponse({ jobId }, 202);
      }
      const jobId = JSON.parse(String(init?.body)).jobId as string;
      if (jobId === firstJobId) {
        oldRecoveryStarted?.();
        return new Promise<Response>((resolve) => { resolveOldRecovery = resolve; });
      }
      secondRecoverCount += 1;
      return jsonResponse({ message: "still pending" }, 503);
    },
    pollDelayMs: 2,
    maximumPollAttempts: 1,
  });
  await act(async () => {
    fixture.api().activateFirstDraftJob(firstJobId, catalogResult("first"));
    assert.equal(await fixture.api().startFirstDraftConceptImages(firstJobId), true);
  });
  await oldStarted;
  await act(async () => {
    fixture.api().activateFirstDraftJob(secondJobId, catalogResult("second"));
    assert.equal(await fixture.api().startFirstDraftConceptImages(secondJobId), true);
  });
  assert.ok(resolveOldRecovery);
  resolveOldRecovery(jsonResponse({ jobId: firstJobId, result: completeResult("first-late") }));
  await waitForTimers();
  assert.equal(enqueueCount, 2);
  assert.equal(secondRecoverCount, 1);
  assert.equal(fixture.api().firstDraftImagePhase, "unknown");
  assert.equal(fixture.api().firstDraftRetryAvailable, true);
  assert.ok(fixture.api().firstDraftImages.every((image) => image.url.includes("/second/")));
  await waitForTimers();
  assert.equal(secondRecoverCount, 1, "maximum polling attempts should leave no timer running");
  await unmount(fixture.root, fixture.container);
});
