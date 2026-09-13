import assert from "node:assert/strict";
import test from "node:test";
import { completedStudioDraftJobId, recoverCompletedStudioDraft } from "../app/_registration/completed-studio-draft";

const jobId = "a51eb670-9ae8-46f0-ba92-1c860f284ec6";
const productId = "72727272-7272-4272-8272-727272727272";
const ready = { id: `job:${jobId}`, status: "ready" as const, productId: null, controlState: null };

test("only a completed unlinked studio job exposes draft connection", () => {
  assert.equal(completedStudioDraftJobId(ready), jobId);
  for (const status of ["analyzing", "publishing", "failed", "blocked", "completed"] as const) {
    assert.equal(completedStudioDraftJobId({ ...ready, status }), null);
  }
  for (const id of [`research:${jobId}`, `asset:${jobId}`, `revision:${jobId}`, "job:invalid"]) {
    assert.equal(completedStudioDraftJobId({ ...ready, id }), null);
  }
  assert.equal(completedStudioDraftJobId({ ...ready, productId }), null);
  assert.equal(completedStudioDraftJobId({ ...ready, controlState: "stopping" }), null);
});

test("existing product connection uses only the same job and refreshes before returning", async () => {
  const calls: string[] = [];
  const result = await recoverCompletedStudioDraft(ready, {
    lock: { current: false },
    authenticatedFetch: async (path, init) => {
      calls.push("product-create");
      assert.equal(path, "/api/admin/products/snapshot");
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), { action: "product_create", jobId });
      assert.ok(init?.signal);
      return Response.json({ id: productId });
    },
    refresh: async () => { calls.push("refresh"); },
  });
  assert.equal(result, productId);
  assert.deepEqual(calls, ["product-create", "refresh"]);
});

test("rapid duplicate clicks remain blocked until the authoritative refresh settles", async () => {
  const lock = { current: false };
  let fetchCount = 0;
  let releaseRefresh!: () => void;
  const refreshed = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  const dependencies = {
    lock,
    authenticatedFetch: async () => { fetchCount++; return Response.json({ id: productId }); },
    refresh: () => refreshed,
  };
  const first = recoverCompletedStudioDraft(ready, dependencies);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(await recoverCompletedStudioDraft(ready, dependencies), null);
  assert.equal(fetchCount, 1);
  assert.equal(lock.current, true);
  releaseRefresh();
  assert.equal(await first, productId);
  assert.equal(lock.current, false);
});

test("a lost response refreshes first then allows retrying the identical completed job", async () => {
  const lock = { current: false };
  const jobs: string[] = [];
  let refreshed = 0;
  const dependencies = {
    lock,
    authenticatedFetch: async (_path: string, init?: RequestInit) => {
      jobs.push(JSON.parse(String(init?.body)).jobId);
      return jobs.length === 1 ? Response.json({}, { status: 503 }) : Response.json({ id: productId });
    },
    refresh: async () => { refreshed++; },
  };
  await assert.rejects(recoverCompletedStudioDraft(ready, dependencies), /같은 완료 작업/);
  assert.equal(refreshed, 1);
  assert.equal(lock.current, false);
  assert.equal(await recoverCompletedStudioDraft(ready, dependencies), productId);
  assert.deepEqual(jobs, [jobId, jobId]);
  assert.equal(refreshed, 2);
});

test("invalid response and network failure remain visible and never skip refresh", async () => {
  for (const failure of ["invalid-id", "network"] as const) {
    let refreshed = false;
    const lock = { current: false };
    await assert.rejects(recoverCompletedStudioDraft(ready, {
      lock,
      authenticatedFetch: async () => {
        if (failure === "network") throw new TypeError("fetch failed");
        return Response.json({ id: "not-a-product-id" });
      },
      refresh: async () => { refreshed = true; },
    }), /같은 완료 작업/);
    assert.equal(refreshed, true);
    assert.equal(lock.current, false);
  }
});
