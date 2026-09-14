import assert from "node:assert/strict";
import test from "node:test";
import { categoryJobStorageKey, runCategoryJobOperation, waitForCategoryPoll } from "../app/category-job-polling";

const jobId = "a3d31ed7-54e4-4f32-9664-7bf74aff50dd";
const input = { productId: "product", credentialId: "credential", channel: "lazada", operation: "categories.suggest" as const, arguments: { query: "cider", image_url: "https://example.test/storage/v1/object/sign/photos/a.jpg?token=SECRET-A" } };
const pending = { ok: false, inProgress: true, jobId, channel: input.channel, operation: input.operation };
const done = { ok: true, jobId, channel: input.channel, operation: input.operation, steps: [{ name: "category-suggestion", ok: true, status: 200, data: { categoryId: "1" } }] };
function store() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const authorization = async () => "Bearer fixture";

test("202 is preserved then GET-only polling consumes success with bounded backoff", async () => {
  const storage = store(); const methods: string[] = []; const delays: number[] = []; let gets = 0;
  const result = await runCategoryJobOperation(input, { storage, signal: new AbortController().signal, authorization,
    wait: async ms => { delays.push(ms); },
    fetch: async (_url, init) => { methods.push(init?.method ?? "GET"); if (init?.method === "POST") return Response.json(pending, { status: 202 }); gets++; assert.deepEqual([...storage.values.values()], [jobId]); return Response.json(gets <= 7 ? pending : done, { status: gets <= 7 ? 202 : 200 }); },
  });
  assert.deepEqual(result, done); assert.equal(methods.filter(method => method === "POST").length, 1);
  assert.deepEqual(delays, [5000, 7500, 10000, 12500, 15000, 15000, 15000]); assert.equal(storage.values.size, 0);
});

test("reload or retry reuses jobId, including a rotated signed URL, without POST", async () => {
  const storage = store(); const key = await categoryJobStorageKey(input); storage.setItem(key, jobId);
  assert.match(key, /^sellerpilot:category-job:v1:[a-f0-9]{64}$/); assert.equal(key.includes("SECRET"), false);
  const rotated = { ...input, arguments: { image_url: input.arguments.image_url.replace("SECRET-A", "SECRET-B"), query: "cider" } };
  assert.equal(await categoryJobStorageKey(rotated), key);
  for (const other of [{ ...input, credentialId: "other" }, { ...input, productId: "other" }, { ...input, channel: "ebay" }, { ...input, arguments: { query: "other" } }]) assert.notEqual(await categoryJobStorageKey(other), key);
  await runCategoryJobOperation(rotated, { storage, signal: new AbortController().signal, authorization, fetch: async (url, init) => { assert.notEqual(init?.method, "POST"); assert.match(String(url), /jobId=a3d31ed7/); return Response.json(done); } });
  assert.equal(storage.values.size, 0);
});

test("abort and deadline retain job for same-job retry and never send a second POST", async () => {
  for (const mode of ["abort", "timeout"]) {
    const storage = store(); const controller = new AbortController(); let posts = 0;
    await assert.rejects(runCategoryJobOperation(input, { storage, signal: controller.signal, authorization, timeoutMs: mode === "timeout" ? 20 : 1000,
      fetch: async (_url, init) => { if (init?.method === "POST") { posts++; return Response.json(pending, { status: 202 }); } return Response.json(pending, { status: 202 }); },
      wait: async (ms, signal) => { if (mode === "abort") controller.abort(); await waitForCategoryPoll(ms, signal); },
    }), error => error instanceof Error && error.name === (mode === "abort" ? "AbortError" : "TimeoutError"));
    assert.equal(posts, 1); assert.deepEqual([...storage.values.values()], [jobId]);
  }
});

test("only confirmed failure clears pending state; mismatch, auth failure and transport ambiguity preserve it", async () => {
  for (const [status, payload, cleared] of [[409, { code: "CATEGORY_JOB_FAILED" }, true], [409, { code: "CATEGORY_JOB_MISMATCH" }, false], [401, { message: "login" }, false], [200, { ...done, channel: "ebay" }, false]] as const) {
    const storage = store(); storage.setItem(await categoryJobStorageKey(input), jobId);
    await assert.rejects(runCategoryJobOperation(input, { storage, signal: new AbortController().signal, authorization, fetch: async (_url, init) => { assert.notEqual(init?.method, "POST"); return Response.json(payload, { status }); } }));
    assert.equal(storage.values.size, cleared ? 0 : 1);
  }
  const storage = store(); storage.setItem(await categoryJobStorageKey(input), jobId); let calls = 0;
  await runCategoryJobOperation(input, { storage, signal: new AbortController().signal, authorization, wait: async () => {}, fetch: async (_url, init) => { assert.notEqual(init?.method, "POST"); if (++calls === 1) throw new Error("offline"); if (calls === 2) return Response.json({}, { status: 503 }); return Response.json(done); } });
  assert.equal(calls, 3);
});
