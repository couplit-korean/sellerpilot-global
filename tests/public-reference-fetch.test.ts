import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertPublicReferenceUrl,
  collectBoundedPublicReferenceBody,
  fetchPublicReferenceDocumentWithDependencies,
  isPublicReferenceAddress,
  PublicReferenceFetchError,
  validatePublicReferenceUrl,
  type PublicReferenceFetchDependencies,
} from "../lib/public-reference-fetch";

function assertReferenceError(code: PublicReferenceFetchError["code"]) {
  return (error: unknown) => error instanceof PublicReferenceFetchError && error.code === code;
}

test("public reference address policy blocks private and special-purpose IPv4 ranges", () => {
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.255.255.255",
    "169.254.169.254",
    "172.31.255.255",
    "192.0.0.9",
    "192.0.2.10",
    "192.88.99.1",
    "192.168.10.10",
    "198.18.0.1",
    "198.51.100.3",
    "203.0.113.5",
    "224.0.0.1",
    "255.255.255.255",
  ]) {
    assert.equal(isPublicReferenceAddress(address), false, address);
  }
  assert.equal(isPublicReferenceAddress("1.1.1.1"), true);
  assert.equal(isPublicReferenceAddress("8.8.8.8"), true);
  assert.equal(isPublicReferenceAddress("93.184.216.34"), true);
});

test("public reference address policy blocks local, transition and reserved IPv6 ranges", () => {
  for (const address of [
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
    "100::1",
    "2001::1",
    "2001:db8::1",
    "2002:0808:0808::1",
    "3fff::1",
    "fc00::1",
    "fd00::1",
    "fe80::1",
    "ff02::1",
  ]) {
    assert.equal(isPublicReferenceAddress(address), false, address);
  }
  assert.equal(isPublicReferenceAddress("2001:4860:4860::8888"), true);
  assert.equal(isPublicReferenceAddress("2606:4700:4700::1111"), true);
});

test("reference URL policy allows only credential-free http(s) default ports", () => {
  assert.equal(validatePublicReferenceUrl("https://example.com/item#details").toString(), "https://example.com/item");
  assert.equal(validatePublicReferenceUrl("http://example.com:80/item").toString(), "http://example.com/item");
  assert.equal(validatePublicReferenceUrl("https://example.com:443/item").toString(), "https://example.com/item");

  for (const value of [
    "ftp://example.com/item",
    "https://user@example.com/item",
    "https://user:secret@example.com/item",
    "https://example.com:8443/item",
    "http://example.com:443/item",
    "http://localhost/item",
    "http://service.local/item",
  ]) {
    assert.throws(() => validatePublicReferenceUrl(value), assertReferenceError("REFERENCE_URL_POLICY_BLOCKED"), value);
  }
  assert.throws(() => validatePublicReferenceUrl("not a URL"), assertReferenceError("REFERENCE_URL_INVALID"));
  assert.equal(validatePublicReferenceUrl("http://2130706433/").hostname, "127.0.0.1");
});

test("the policy-only preflight blocks literal private targets without downloading", async () => {
  await assert.rejects(
    assertPublicReferenceUrl("http://127.0.0.1/resource"),
    assertReferenceError("REFERENCE_ADDRESS_BLOCKED"),
  );
  assert.equal(
    (await assertPublicReferenceUrl("https://93.184.216.34/resource")).toString(),
    "https://93.184.216.34/resource",
  );
});

test("bounded reference collector never buffers beyond its limit", async () => {
  async function* withinLimit() {
    yield Buffer.from("first");
    yield Buffer.from("second");
  }
  assert.equal((await collectBoundedPublicReferenceBody(withinLimit(), 11)).toString("utf8"), "firstsecond");

  let sourceClosed = false;
  async function* overLimit() {
    try {
      yield Buffer.alloc(6);
      yield Buffer.alloc(6);
      yield Buffer.alloc(1_000_000);
    } finally {
      sourceClosed = true;
    }
  }
  await assert.rejects(
    collectBoundedPublicReferenceBody(overLimit(), 10),
    assertReferenceError("REFERENCE_BODY_TOO_LARGE"),
  );
  assert.equal(sourceClosed, true);
});

test("each redirect hop is re-resolved, public-checked and connected to its pinned address", async () => {
  const resolvedHosts: string[] = [];
  const connected: Array<{ address: string; hostname: string; url: string }> = [];
  const dependencies: PublicReferenceFetchDependencies = {
    async resolve(hostname) {
      resolvedHosts.push(hostname);
      if (hostname === "first.example") return [{ address: "93.184.216.34", family: 4 }];
      return [{ address: "2606:4700:4700::1111", family: 6 }];
    },
    async requestHop(target) {
      connected.push({ address: target.address, hostname: target.hostname, url: target.url.toString() });
      if (target.hostname === "first.example") {
        return { body: Buffer.alloc(0), contentType: "", location: "https://second.example/product", status: 302 };
      }
      return { body: Buffer.from("safe page"), contentType: "text/html; charset=utf-8", location: "", status: 200 };
    },
  };

  const result = await fetchPublicReferenceDocumentWithDependencies(
    "https://first.example/start",
    { timeoutMs: 1_000 },
    dependencies,
  );
  assert.deepEqual(resolvedHosts, ["first.example", "second.example"]);
  assert.deepEqual(connected, [
    { address: "93.184.216.34", hostname: "first.example", url: "https://first.example/start" },
    { address: "2606:4700:4700::1111", hostname: "second.example", url: "https://second.example/product" },
  ]);
  assert.equal(result.finalUrl, "https://second.example/product");
  assert.deepEqual(result.redirects, ["https://second.example/product"]);
  assert.equal(result.body.toString("utf8"), "safe page");
});

test("redirect rebinding and mixed public/private DNS answers fail closed before a socket request", async () => {
  let requests = 0;
  const dependencies: PublicReferenceFetchDependencies = {
    async resolve(hostname) {
      if (hostname === "first.example") return [{ address: "93.184.216.34", family: 4 }];
      return [
        { address: "1.1.1.1", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ];
    },
    async requestHop() {
      requests += 1;
      return { body: Buffer.alloc(0), contentType: "", location: "https://rebound.example/metadata", status: 302 };
    },
  };
  await assert.rejects(
    fetchPublicReferenceDocumentWithDependencies("https://first.example", {}, dependencies),
    assertReferenceError("REFERENCE_ADDRESS_BLOCKED"),
  );
  assert.equal(requests, 1);
});

test("redirect loops, redirect limits, invalid content and oversized defensive results are rejected", async (t) => {
  const resolve = async () => [{ address: "93.184.216.34", family: 4 }];

  await t.test("loop", async () => {
    await assert.rejects(fetchPublicReferenceDocumentWithDependencies("https://loop.example/start", {}, {
      resolve,
      async requestHop() {
        return { body: Buffer.alloc(0), contentType: "", location: "/start", status: 301 };
      },
    }), assertReferenceError("REFERENCE_REDIRECT_LOOP"));
  });

  await t.test("limit", async () => {
    let hop = 0;
    await assert.rejects(fetchPublicReferenceDocumentWithDependencies("https://limit.example/0", { maximumRedirects: 1 }, {
      resolve,
      async requestHop() {
        hop += 1;
        return { body: Buffer.alloc(0), contentType: "", location: `/${hop}`, status: 302 };
      },
    }), assertReferenceError("REFERENCE_REDIRECT_LIMIT"));
  });

  await t.test("content type", async () => {
    await assert.rejects(fetchPublicReferenceDocumentWithDependencies("https://type.example", {}, {
      resolve,
      async requestHop() {
        return { body: Buffer.from("binary"), contentType: "application/octet-stream", location: "", status: 200 };
      },
    }), assertReferenceError("REFERENCE_CONTENT_TYPE_INVALID"));
  });

  await t.test("defensive body bound", async () => {
    await assert.rejects(fetchPublicReferenceDocumentWithDependencies("https://size.example", { maximumBytes: 4 }, {
      resolve,
      async requestHop() {
        return { body: Buffer.alloc(5), contentType: "text/plain", location: "", status: 200 };
      },
    }), assertReferenceError("REFERENCE_BODY_TOO_LARGE"));
  });
});

test("the total deadline covers DNS and external aborts retain cancellation semantics", async () => {
  const slowResolve = () => new Promise<Array<{ address: string; family: number }>>((resolve) => {
    setTimeout(() => resolve([{ address: "93.184.216.34", family: 4 }]), 100);
  });
  const requestHop: PublicReferenceFetchDependencies["requestHop"] = async () => {
    throw new Error("must not request");
  };

  await assert.rejects(
    fetchPublicReferenceDocumentWithDependencies("https://slow.example", { timeoutMs: 20 }, {
      requestHop,
      resolve: slowResolve,
    }),
    assertReferenceError("REFERENCE_TIMEOUT"),
  );

  const controller = new AbortController();
  const pending = fetchPublicReferenceDocumentWithDependencies("https://cancel.example", {
    signal: controller.signal,
    timeoutMs: 1_000,
  }, {
    requestHop,
    resolve: slowResolve,
  });
  controller.abort(new Error("cancelled by lease"));
  await assert.rejects(pending, assertReferenceError("REFERENCE_ABORTED"));
});

test("the AI worker uses the shared fetcher and propagates both research leases", async () => {
  const worker = await readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8");
  assert.match(worker, /import \{[\s\S]*fetchPublicReferenceDocument,[\s\S]*\} from "\.\.\/lib\/public-reference-fetch\.ts";/);
  assert.doesNotMatch(worker, /function isPrivateAddress|function assertPublicUrl|function requestPublicReference/);
  assert.match(worker, /fetchPublicReferenceDocument\(value, \{ signal: leaseSignal \}\)/);
  assert.match(worker, /fetchReferencePages\(researchInput, "", leaseSignal\)/);
  assert.match(worker, /String\(job\.request\?\.productUrl \|\| ""\),\s+jobHeartbeat\.signal,/);
  assert.match(worker, /if \(leaseSignal\?\.aborted\) \{\s+throw leaseSignal\.reason/);
});
