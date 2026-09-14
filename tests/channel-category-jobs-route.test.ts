import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as contract from "../lib/channel-category-job";
const source = await readFile(new URL("../app/api/admin/channel-category-jobs/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const jobId = "a3d31ed7-54e4-4f32-9664-7bf74aff50dd";
const expected = { jobId, channel: "lazada", operation: "categories.suggest" };
const response = { channel: "lazada", operation: "categories.suggest", ok: true, steps: [{ name: "category-suggestion", ok: true, status: 200, data: { category_id: 1, access_token: "SECRET", nested: { clientSecret: "SECRET", categoryName: "Drinks" } } }, { name: "inquiries-list", ok: true, status: 200, data: { messages: ["BUYER"] } }, { name: "oauth", ok: true, status: 200, data: { token: "SECRET" } }] };
async function call(options: { denied?: boolean; job?: unknown; error?: unknown; query?: string } = {}) {
  const calls: { name: string; args: unknown }[] = [];
  const sandbox = vm.createContext({ exports: {}, Request, Response, URL, AbortSignal, require(name: string) {
    if (name === "next/server") return { NextResponse: Response };
    if (name.endsWith("/channel-category-job")) return contract;
    if (name.endsWith("/admin-api")) return { authenticateAdminRequest: async () => options.denied ? Response.json({}, { status: 403 }) : { serviceClient: { rpc(name: string, args: unknown) { calls.push({ name, args }); return { abortSignal: async () => ({ data: options.job ?? { id: jobId, channel: "lazada", operation: "categories.suggest", status: "queued" }, error: options.error }) }; } } }, isAdminApiError: (value: unknown) => value instanceof Response };
    throw new Error(name);
  } });
  vm.runInContext(compiled, sandbox);
  return { response: await sandbox.exports.GET(new Request(`https://example.test/api/admin/channel-category-jobs?${options.query ?? new URLSearchParams(expected)}`)) as Response, calls };
}
test("route authenticates first and accepts only valid category job reads", async () => {
  const denied = await call({ denied: true }); assert.equal(denied.response.status, 403); assert.equal(denied.calls.length, 0);
  for (const query of [`jobId=${jobId}&channel=lazada&operation=inquiries.list`, `jobId=invalid&channel=lazada&operation=categories.suggest`, `jobId=${jobId}&channel=unknown&operation=categories.suggest`]) { const result = await call({ query }); assert.equal(result.response.status, 400); assert.equal(result.calls.length, 0); }
  const pending = await call(); assert.equal(pending.response.status, 202); assert.equal(pending.calls[0].name, "sellerpilot_get_channel_gateway_job"); assert.deepEqual(JSON.parse(JSON.stringify(pending.calls[0].args)), { p_job_id: jobId }); assert.match(pending.response.headers.get("cache-control") ?? "", /no-store/);
});
test("only matching successful category steps are returned; CS, credentials and errors never escape", async () => {
  const result = await call({ job: { id: jobId, channel: "lazada", operation: "categories.suggest", status: "succeeded", response, credential: "SECRET", error: "SECRET" } });
  assert.equal(result.response.status, 200); const text = await result.response.text(); assert.doesNotMatch(text, /SECRET|BUYER|inquiries-list|oauth/); const payload = JSON.parse(text); assert.equal(payload.steps.length, 1); assert.equal(payload.steps[0].data.nested.categoryName, "Drinks");
  for (const changed of [{ channel: "ebay" }, { operation: "inquiries.list" }, { response: { ...response, channel: "ebay" } }, { response: { ...response, operation: "inquiries.list" } }, { response: { ...response, steps: [response.steps[1]] } }]) {
    const result = await call({ job: { id: jobId, channel: "lazada", operation: "categories.suggest", status: "succeeded", response, ...changed } }); assert.equal(result.response.status, 409); assert.doesNotMatch(await result.response.text(), /SECRET|BUYER/);
  }
  const failed = await call({ job: { id: jobId, channel: "lazada", operation: "categories.suggest", status: "failed", error: "SECRET_PROVIDER_ERROR" } }); assert.equal(failed.response.status, 409); assert.equal((await failed.response.json()).code, "CATEGORY_JOB_FAILED");
  const unavailable = await call({ error: { message: "SECRET_DATABASE_ERROR" } }); assert.equal(unavailable.response.status, 503); assert.doesNotMatch(await unavailable.response.text(), /SECRET/);
});
