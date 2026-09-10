import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { withLazadaProviderAccountIdentity } from "../lib/channels/provider-account-identity";
import {
  ingestLazadaSupplementalProviderPage,
  lazadaSupplementalProviderSyncRequestSchema,
} from "../lib/cs/channels/lazada/supplemental-provider-ingest";

const credentialId = "00000000-0000-4000-8000-000000008001";
const continuationId = "00000000-0000-4000-8000-000000008002";
const grantId = "00000000-0000-4000-8000-000000008003";
const sourcePath = "/review/seller/list" as const;
const observedAt = new Date("2026-09-09T18:20:00.000Z");

const attested = withLazadaProviderAccountIdentity({
  app_key: "app-key",
  app_secret: "app-secret",
  access_token: "access-token",
  country: "my",
}, {
  account_platform: "seller_center",
  country_user_info: [{ country: "my", seller_id: "300872000183", user_id: "200872000183" }],
});
const payload = attested.payload;
const sellerAccountKey = createHash("sha256")
  .update(["lazada", "production", attested.identity.subject].join("\u001f"), "utf8")
  .digest("hex");

function responsePayload(options: { total?: number; current?: number; success?: unknown } = {}) {
  return {
    code: "0",
    success: true,
    data: {
      current: String(options.current ?? 1),
      page_size: "1",
      total: String(options.total ?? 2),
      data: [{
        item_id: "1001",
        order_id: "ORDER-1",
        ratings: { product_rating: "5" },
        reviews: [{
          id: `REVIEW-${options.current ?? 1}`,
          create_time: "1640970071000",
          review_type: "PRODUCT_REVIEW",
          review_content: "signed transport",
        }],
      }],
    },
    ...(options.success === undefined ? {} : { success: options.success }),
  };
}

function prepared(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "sellerpilot-lazada-supplemental-read-prepare/1",
    continuationId,
    revision: 0,
    grantId,
    credentialId,
    sellerAccountKey,
    country: "MY",
    surface: "product_review",
    sourcePath,
    resourceId: "1001",
    pageSize: 1,
    pageNumber: 1,
    readOnly: true,
    mutationAllowed: false,
    ...overrides,
  };
}

function dependencies(options: {
  prepared?: Record<string, unknown>;
  credential?: Record<string, unknown>;
  prepareError?: boolean;
  ackError?: boolean;
} = {}) {
  const calls = { prepare: 0, credential: 0, acknowledge: [] as Array<Record<string, unknown>> };
  return {
    calls,
    value: {
      prepare: async () => {
        calls.prepare += 1;
        return options.prepareError
          ? { data: null, error: { code: "42501" } }
          : { data: options.prepared ?? prepared(), error: null };
      },
      readCredential: async () => {
        calls.credential += 1;
        return { data: options.credential ?? payload, error: null };
      },
      ingestAndAcknowledge: async (input: Record<string, unknown>) => {
        calls.acknowledge.push(input);
        if (options.ackError) return { data: null, error: { code: "writer_failed" } };
        const pagination = input.pagination as { hasMore: boolean; nextPage: number | null };
        return { data: {
          contractVersion: "sellerpilot-lazada-supplemental-page-ingest/1",
          continuationId,
          revision: 1,
          credentialId,
          country: "MY",
          surface: "product_review",
          sourcePath,
          pageNumber: 1,
          complete: !pagination.hasMore,
          nextPage: pagination.nextPage,
          replayed: false,
          readOnly: true,
          mutationAllowed: false,
          writerReceipt: { inserted: 1 },
        }, error: null };
      },
      now: () => observedAt,
    },
  };
}

async function withFakeFetch(body: unknown, action: (urls: string[]) => Promise<void>, status = 200) {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input));
    assert.equal(init?.method, "GET");
    return Response.json(body, { status });
  }) as typeof fetch;
  try { await action(urls); } finally { globalThis.fetch = original; }
}

test("uses the real signed Lazada GET transport, exact read-plan parameters and reports a remaining page", async () => {
  const deps = dependencies();
  await withFakeFetch(responsePayload(), async (urls) => {
    const receipt = await ingestLazadaSupplementalProviderPage({
      credentialId, country: "MY", sourcePath, resourceId: "1001", pageSize: 1,
    }, deps.value);
    assert.equal(receipt.complete, false);
    assert.equal(receipt.nextPage, 2);
    assert.equal(urls.length, 1);
    const url = new URL(urls[0]);
    assert.equal(url.pathname, `/rest${sourcePath}`);
    assert.equal(url.searchParams.get("item_id"), "1001");
    assert.equal(url.searchParams.get("current"), "1");
    assert.equal(url.searchParams.get("page_size"), "1");
    assert.equal(url.searchParams.get("sign_method"), "sha256");
    assert.match(url.searchParams.get("sign") ?? "", /^[A-F0-9]{64}$/u);
    assert.equal(deps.calls.acknowledge.length, 1);
    assert.deepEqual((deps.calls.acknowledge[0].pagination as Record<string, unknown>), {
      contractVersion: "sellerpilot-lazada-supplemental-provider-page/1",
      kind: "provider_page",
      pageNumber: 1,
      pageSize: 1,
      total: 2,
      entryCount: 1,
      hasMore: true,
      nextPage: 2,
    });
  });
});

test("HTTP 200 provider failures and nested success=false never reach the writer", async () => {
  for (const body of [
    { code: "AccessDenied", message: "permission denied" },
    { code: "0", result: { success: false, page_no: 1, page_size: 1, total: 1, items: [] } },
  ]) {
    const path = "result" in body ? "/reverse/getreverseordersforseller" as const : sourcePath;
    const deps = dependencies({ prepared: prepared({
      sourcePath: path,
      surface: path === sourcePath ? "product_review" : "reverse_order_after_sales",
      resourceId: path === sourcePath ? "1001" : "",
    }) });
    await withFakeFetch(body, async () => {
      await assert.rejects(ingestLazadaSupplementalProviderPage({
        credentialId, country: "MY", sourcePath: path,
        ...(path === sourcePath ? { resourceId: "1001" } : {}), pageSize: 1,
      }, deps.value), /PROVIDER_FAILURE|PAGINATION_INVALID/u);
    });
    assert.equal(deps.calls.acknowledge.length, 0);
  }
});

test("permission denial and prepared account/country mismatch produce zero provider fetches", async () => {
  for (const deps of [
    dependencies({ prepareError: true }),
    dependencies({ prepared: prepared({ country: "SG" }) }),
    dependencies({ prepared: prepared({ sellerAccountKey: "f".repeat(64) }) }),
  ]) {
    let fetches = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => { fetches += 1; return Response.json(responsePayload()); }) as typeof fetch;
    try {
      await assert.rejects(ingestLazadaSupplementalProviderPage({
        credentialId, country: "MY", sourcePath, resourceId: "1001", pageSize: 1,
      }, deps.value), /PERMISSION_REQUIRED|BINDING_MISMATCH|ACCOUNT_MISMATCH/u);
    } finally { globalThis.fetch = original; }
    assert.equal(fetches, 0);
    assert.equal(deps.calls.acknowledge.length, 0);
  }
});

test("credential country mismatch and atomic writer failure do not acknowledge continuation", async () => {
  const wrongCountry = dependencies({ credential: { ...payload, country: "sg" } });
  await withFakeFetch(responsePayload(), async (urls) => {
    await assert.rejects(ingestLazadaSupplementalProviderPage({
      credentialId, country: "MY", sourcePath, resourceId: "1001", pageSize: 1,
    }, wrongCountry.value), /CREDENTIAL_COUNTRY_MISMATCH/u);
    assert.equal(urls.length, 0);
  });
  const failedWriter = dependencies({ ackError: true });
  await withFakeFetch(responsePayload(), async (urls) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(ingestLazadaSupplementalProviderPage({
        credentialId, country: "MY", sourcePath, resourceId: "1001", pageSize: 1,
      }, failedWriter.value), /INGEST_ACK_FAILED/u);
    }
    assert.equal(urls.length, 2);
    assert.equal(failedWriter.calls.acknowledge.length, 2);
    assert.deepEqual(failedWriter.calls.acknowledge.map((call) => call.pageNumber), [1, 1]);
    assert.deepEqual(failedWriter.calls.acknowledge.map((call) => call.expectedRevision), [0, 0]);
  });
});

test("a short non-final provider page is unverified and leaves continuation untouched", async () => {
  const deps = dependencies({ prepared: prepared({ pageSize: 20 }) });
  const body = responsePayload({ total: 44 });
  body.data.page_size = "20";
  await withFakeFetch(body, async () => {
    await assert.rejects(ingestLazadaSupplementalProviderPage({
      credentialId, country: "MY", sourcePath, resourceId: "1001", pageSize: 20,
    }, deps.value), /PAGINATION_INVALID/u);
  });
  assert.equal(deps.calls.acknowledge.length, 0);
});

test("caller cannot inject a boolean grant or choose a continuation page", async () => {
  assert.equal(lazadaSupplementalProviderSyncRequestSchema.safeParse({
    credentialId, country: "MY", sourcePath, resourceId: "1001", granted: true,
  }).success, false);
  assert.equal(lazadaSupplementalProviderSyncRequestSchema.safeParse({
    credentialId, country: "MY", sourcePath, resourceId: "1001", pageNumber: 9,
  }).success, false);
  assert.equal(lazadaSupplementalProviderSyncRequestSchema.safeParse({
    credentialId, country: "MY", sourcePath, resourceId: "ITEM-100",
  }).success, false);
  const route = await readFile(new URL(
    "../app/api/admin/cs/channels/lazada/supplemental/sync/route.ts", import.meta.url,
  ), "utf8");
  assert.doesNotMatch(route, /record_lazada_supplemental_read_grant|granted\s*:/u);
  assert.doesNotMatch(route, /reply\/add|return\/update|cancel\/create/u);
});
