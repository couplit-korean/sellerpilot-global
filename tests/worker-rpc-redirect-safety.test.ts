import assert from "node:assert/strict";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { createBoundedSupabaseFetch, WORKER_RPC_TIMEOUT_MS } from "../lib/worker-rpc";

// Real Fetch against ephemeral loopback listeners only. Never contact Supabase.
const syntheticBody = JSON.stringify({ fixture: "not-a-real-credential" });
const syntheticHeaders = { authorization: "Bearer synthetic-test-only", apikey: "synthetic-test-only", "content-type": "application/json" };
type Observation = { authorization: boolean; apikey: boolean; body: boolean };
async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
async function fixture() {
  const source: Observation[] = [];
  const destinations: Observation[] = [];
  let notifySource: (() => void) | undefined;
  const received = new Promise<void>(resolve => { notifySource = resolve; });
  const collect = (req: IncomingMessage, res: ServerResponse, target: Observation[], done: () => void) => {
    let body = "";
    req.on("data", chunk => { body += String(chunk); });
    req.on("end", () => {
      target.push({ authorization: Boolean(req.headers.authorization), apikey: Boolean(req.headers.apikey), body: body === syntheticBody });
      done();
    });
  };
  const remote = createServer((req, res) => collect(req, res, destinations, () => res.end("unexpected destination")));
  const remoteOrigin = await listen(remote);
  const initial = createServer((req, res) => {
    if (req.url === "/target") {
      collect(req, res, destinations, () => res.end("unexpected destination"));
      return;
    }
    collect(req, res, source, () => {
      notifySource?.();
      if (req.url === "/hang") return;
      if (req.url === "/ok") { res.end("ok"); return; }
      const destination = req.url === "/same" ? "/target" : `${remoteOrigin}/target`;
      res.writeHead(307, { location: destination });
      res.end();
    });
  });
  const origin = await listen(initial);
  return { origin, source, destinations, received, close: () => Promise.all([close(initial), close(remote)]) };
}

for (const target of ["same", "cross"] as const) {
  test(`307 ${target}-origin rejects caller follow: no second-hop calls, apikey or body leakage`, async () => {
    const f = await fixture();
    try {
      await assert.rejects(createBoundedSupabaseFetch()(`${f.origin}/${target}`, {
        method: "POST", headers: syntheticHeaders, body: syntheticBody, redirect: "follow",
      }), TypeError);
      assert.deepEqual(f.source, [{ authorization: true, apikey: true, body: true }]);
      assert.equal(f.destinations.length, 0, "redirect target must receive no request at all");
      assert.equal(f.destinations.filter(item => item.apikey || item.authorization || item.body).length, 0);
    } finally { await f.close(); }
  });
}

test("Request object's redirect follow cannot override the enforced redirect error", async () => {
  const f = await fixture();
  try {
    const request = new Request(`${f.origin}/cross`, { method: "POST", headers: syntheticHeaders, body: syntheticBody, redirect: "follow" });
    await assert.rejects(createBoundedSupabaseFetch()(request), TypeError);
    assert.equal(f.source.length, 1);
    assert.equal(f.destinations.length, 0);
  } finally { await f.close(); }
});

test("nonredirect POST preserves authorized request method, headers and body", async () => {
  const f = await fixture();
  try {
    const response = await createBoundedSupabaseFetch()(`${f.origin}/ok`, { method: "POST", headers: syntheticHeaders, body: syntheticBody });
    assert.equal(await response.text(), "ok");
    assert.deepEqual(f.source, [{ authorization: true, apikey: true, body: true }]);
    assert.equal(f.destinations.length, 0);
  } finally { await f.close(); }
});

test("caller abort interrupts an in-flight request with its original reason before the default timeout", async () => {
  const f = await fixture();
  try {
    const controller = new AbortController();
    const reason = new Error("synthetic caller cancellation");
    const request = createBoundedSupabaseFetch()(`${f.origin}/hang`, { method: "POST", headers: syntheticHeaders, body: syntheticBody, signal: controller.signal });
    const rejection = assert.rejects(request, error => error === reason);
    await f.received;
    controller.abort(reason);
    await rejection;
    assert.equal(f.destinations.length, 0);
  } finally { await f.close(); }
});

test("pre-aborted caller makes zero HTTP requests", async () => {
  const f = await fixture();
  try {
    const controller = new AbortController();
    const reason = new Error("synthetic pre-cancel");
    controller.abort(reason);
    await assert.rejects(createBoundedSupabaseFetch()(`${f.origin}/ok`, { signal: controller.signal }), error => error === reason);
    assert.equal(f.source.length, 0);
    assert.equal(f.destinations.length, 0);
  } finally { await f.close(); }
});

test("actual default eight-second timeout still fires with a non-aborted caller signal", { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    assert.equal(WORKER_RPC_TIMEOUT_MS, 8_000);
    const controller = new AbortController();
    const start = performance.now();
    await assert.rejects(createBoundedSupabaseFetch()(`${f.origin}/hang`, { signal: controller.signal }), error => error instanceof Error && error.name === "TimeoutError");
    const elapsed = performance.now() - start;
    assert.ok(elapsed >= 7_500 && elapsed < 13_000, `default timeout elapsed ${Math.round(elapsed)}ms`);
    assert.equal(controller.signal.aborted, false, "internal timeout must not abort caller's controller");
    assert.equal(f.source.length, 1);
    assert.equal(f.destinations.length, 0);
  } finally { await f.close(); }
});
