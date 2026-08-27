import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCompetitorResearchRetryPath,
  competitorResearchEmptySlot,
  competitorResearchAttemptTimeoutMs,
  isCompetitorResearchBlockingAnalysis,
  pollCompetitorResearch,
  shouldInvalidateCompetitorResearch,
} from "../app/_publishing/competitor-research-polling";

type Provider = { status: "pending" | "searched"; count: number };
type Item = { id: string };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("only an active or pending competitor lookup blocks product analysis", () => {
  assert.equal(competitorResearchAttemptTimeoutMs, 45_000);
  assert.ok(competitorResearchAttemptTimeoutMs > 32_000);
  assert.equal(isCompetitorResearchBlockingAnalysis("loading"), true);
  assert.equal(isCompetitorResearchBlockingAnalysis("pending"), true);
  assert.equal(isCompetitorResearchBlockingAnalysis("pending", true), false);
  assert.equal(isCompetitorResearchBlockingAnalysis("stale"), true);
  assert.equal(isCompetitorResearchBlockingAnalysis("stale", true), false);
  assert.equal(isCompetitorResearchBlockingAnalysis("loading", true), true);
  assert.equal(isCompetitorResearchBlockingAnalysis("idle"), false);
  assert.equal(isCompetitorResearchBlockingAnalysis("ready"), false);
  assert.equal(isCompetitorResearchBlockingAnalysis("unavailable"), false);
});

test("empty price slots distinguish in-flight, unavailable, and settled searches", () => {
  assert.deepEqual(competitorResearchEmptySlot("loading"), { label: "동일 상품 확인 중", value: "확인 중", loading: true });
  assert.deepEqual(competitorResearchEmptySlot("pending"), { label: "동일 상품 확인 중", value: "확인 중", loading: true });
  assert.deepEqual(competitorResearchEmptySlot("stale"), { label: "식별정보 변경 · 재확인 필요", value: "재확인", loading: false });
  assert.deepEqual(competitorResearchEmptySlot("unavailable"), { label: "가격 정보 확인 불가", value: "—", loading: false });
  assert.deepEqual(competitorResearchEmptySlot("ready"), { label: "동일 상품을 찾지 못함", value: "—", loading: false });
});

test("product identity edits invalidate stale research while price and stock edits do not", () => {
  assert.equal(shouldInvalidateCompetitorResearch("researchInput", "product-a", "product-b"), true);
  assert.equal(shouldInvalidateCompetitorResearch("productName", "A", "B"), true);
  assert.equal(shouldInvalidateCompetitorResearch("gtin", "8800000000001", "8800000000002"), true);
  assert.equal(shouldInvalidateCompetitorResearch("productName", "A", "A"), false);
  assert.equal(shouldInvalidateCompetitorResearch("sellingPrice", 10_000, 11_000), false);
  assert.equal(shouldInvalidateCompetitorResearch("stock", 3, 5), false);
});

test("stale price retry conditions include corrected brand, GTIN, and sale configuration", () => {
  const base = {
    researchInput: "https://supplier.example/item/1",
    productName: "Sample cereal 500g",
    categoryHint: "cereal",
    brandName: "Brand A",
    manufacturer: "Maker A",
    packageContents: "상품 1개",
    condition: "NEW",
    gtinStatus: "HAS_GTIN",
    gtin: "8800000000001",
  };
  const basePath = buildCompetitorResearchRetryPath(base);
  const brandPath = buildCompetitorResearchRetryPath({ ...base, brandName: "Brand B" });
  const gtinPath = buildCompetitorResearchRetryPath({ ...base, gtin: "8800000000002" });
  const bundlePath = buildCompetitorResearchRetryPath({ ...base, packageContents: "상품 1+1" });
  const queryFor = (path: string) => new URL(path, "https://sellerpilot.test").searchParams.get("query") ?? "";

  assert.notEqual(basePath, brandPath);
  assert.notEqual(basePath, gtinPath);
  assert.notEqual(basePath, bundlePath);
  assert.match(queryFor(brandPath), /Brand B/);
  assert.match(queryFor(gtinPath), /8800000000002/);
  assert.match(queryFor(bundlePath), /상품 1\+1/);
  assert.doesNotMatch(queryFor(buildCompetitorResearchRetryPath({ ...base, gtinStatus: "NO_GTIN" })), /8800000000001/);
  assert.equal(buildCompetitorResearchRetryPath({}), "");
});

test("competitor research polls a pending gateway result and publishes the settled snapshot", async () => {
  let calls = 0;
  const snapshots: string[] = [];
  const result = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=test",
    signal: new AbortController().signal,
    delayMs: 0,
    fetcher: async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse(202, { items: [], providers: [{ status: "pending", count: 0 }] })
        : jsonResponse(200, { items: [{ id: "settled" }], providers: [{ status: "searched", count: 1 }] });
    },
    onSnapshot: (snapshot) => snapshots.push(snapshot.state),
  });

  assert.equal(calls, 2);
  assert.deepEqual(snapshots, ["pending", "ready"]);
  assert.deepEqual(result, { items: [{ id: "settled" }], providers: [{ status: "searched", count: 1 }], state: "ready", retryAvailable: false });
});

test("competitor research stops after a bounded number of pending responses", async () => {
  let calls = 0;
  const result = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=test",
    signal: new AbortController().signal,
    maxAttempts: 3,
    delayMs: 0,
    fetcher: async () => {
      calls += 1;
      return jsonResponse(202, { items: [], providers: [{ status: "pending", count: 0 }] });
    },
  });

  assert.equal(calls, 3);
  assert.equal(result.state, "pending");
  assert.equal(result.retryAvailable, true);
});

test("competitor research aborts its backoff when the publishing screen closes", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    pollCompetitorResearch<Item, Provider>({
      input: "/api/admin/competitor-prices?query=test",
      signal: controller.signal,
      delayMs: 5_000,
      fetcher: async () => {
        calls += 1;
        return jsonResponse(202, { items: [], providers: [{ status: "pending", count: 0 }] });
      },
      onSnapshot: () => controller.abort(),
    }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  assert.equal(calls, 1);
});

test("competitor research fails closed on a malformed successful response", async () => {
  const result = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=test",
    signal: new AbortController().signal,
    fetcher: async () => jsonResponse(200, { message: "missing contract" }),
  });
  assert.deepEqual(result, { items: [], providers: [], state: "unavailable", retryAvailable: true });
});

test("a later 5xx keeps the last valid partial competitor snapshot", async () => {
  let calls = 0;
  const partial = { items: [{ id: "confirmed" }], providers: [{ status: "pending" as const, count: 0 }] };
  const result = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=test",
    signal: new AbortController().signal,
    delayMs: 0,
    fetcher: async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse(202, partial)
        : jsonResponse(502, { items: [], providers: [{ status: "searched", count: 0 }] });
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(result, { ...partial, state: "unavailable", retryAvailable: true });
});

test("a manual retry preserves the displayed snapshot when its first request fails", async () => {
  const initialSnapshot = { items: [{ id: "confirmed" }], providers: [{ status: "searched" as const, count: 1 }] };
  const result = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=test",
    signal: new AbortController().signal,
    initialSnapshot,
    fetcher: async () => { throw new TypeError("network unavailable"); },
  });

  assert.deepEqual(result, { ...initialSnapshot, state: "unavailable", retryAvailable: true });
});

test("competitor research bounds a fetcher that never settles", async () => {
  const snapshots: string[] = [];
  const startedAt = Date.now();
  const result = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=stalled-fetch",
    signal: new AbortController().signal,
    maxAttempts: 1,
    perAttemptTimeoutMs: 1_000,
    fetcher: async () => await new Promise<Response>(() => undefined),
    onSnapshot: (snapshot) => snapshots.push(snapshot.state),
  });

  assert.deepEqual(result, { items: [], providers: [], state: "unavailable", retryAvailable: true });
  assert.deepEqual(snapshots, ["unavailable"]);
  assert.ok(Date.now() - startedAt < 2_000);
});

test("competitor research bounds a response body that never settles", async () => {
  const result = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=stalled-body",
    signal: new AbortController().signal,
    maxAttempts: 1,
    perAttemptTimeoutMs: 1_000,
    fetcher: async () => ({
      ok: true,
      status: 200,
      json: async () => await new Promise<never>(() => undefined),
    }) as Response,
  });

  assert.equal(result.state, "unavailable");
  assert.equal(result.retryAvailable, true);
});

test("a timed-out late response cannot publish a stale competitor snapshot", async () => {
  let resolveResponse: ((response: Response) => void) | null = null;
  const response = new Promise<Response>((resolve) => { resolveResponse = resolve; });
  const snapshots: string[] = [];
  const result = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=late",
    signal: new AbortController().signal,
    maxAttempts: 1,
    perAttemptTimeoutMs: 1_000,
    fetcher: async () => await response,
    onSnapshot: (snapshot) => snapshots.push(snapshot.state),
  });
  resolveResponse?.(jsonResponse(200, { items: [{ id: "too-late" }], providers: [{ status: "searched", count: 1 }] }));
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(result.state, "unavailable");
  assert.deepEqual(snapshots, ["unavailable"]);
});

test("parent abort stops a stalled competitor attempt without retrying", async () => {
  const controller = new AbortController();
  let calls = 0;
  const promise = pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=closed",
    signal: controller.signal,
    maxAttempts: 3,
    perAttemptTimeoutMs: 60_000,
    fetcher: async () => {
      calls += 1;
      return await new Promise<Response>(() => undefined);
    },
  });
  controller.abort(new DOMException("상품 등록 화면을 닫았습니다.", "AbortError"));

  await assert.rejects(promise, (error: unknown) => error instanceof Error && error.name === "AbortError");
  assert.equal(calls, 1);
});

test("a timeout preserves the last valid partial competitor snapshot", async () => {
  let calls = 0;
  const partial = { items: [{ id: "confirmed" }], providers: [{ status: "pending" as const, count: 1 }] };
  const result = await pollCompetitorResearch<Item, Provider>({
    input: "/api/admin/competitor-prices?query=partial-timeout",
    signal: new AbortController().signal,
    maxAttempts: 2,
    delayMs: 0,
    perAttemptTimeoutMs: 1_000,
    fetcher: async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(202, partial);
      return await new Promise<Response>(() => undefined);
    },
  });

  assert.deepEqual(result, { ...partial, state: "unavailable", retryAvailable: true });
});
