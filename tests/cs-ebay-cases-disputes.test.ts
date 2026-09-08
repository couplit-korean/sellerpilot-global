import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ebayCaseDisputeSupportPolicy,
  readEbayPaymentDispute,
  readEbayPaymentDisputeActivity,
  readEbayPaymentDisputesPage,
  readEbayResolutionCaseByKnownId,
  readEbayResolutionCasesPage,
} from "../lib/channels/cs/ebay/cases-disputes";

const payload = { access_token: "fixture-token", marketplace_id: "EBAY_US" };
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/cs/ebay/${name}.json`, import.meta.url), "utf8"));

test("case and payment-dispute support stays GET-only and separate from CS replies", () => {
  assert.deepEqual(ebayCaseDisputeSupportPolicy, {
    resolutionCase: {
      listSupported: true, knownIdReadSupported: true, sandboxSupported: false,
      maximumSearchAgeMonths: 18, supportReplySupported: false, businessMutationOnly: true,
    },
    paymentDispute: {
      listSupported: true, knownIdReadSupported: true, activityReadSupported: true,
      supportReplySupported: false, businessMutationOnly: true,
    },
  });
});

test("payment dispute pages preserve missing total and follow only the exact next offset", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const target = new URL(String(url));
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-token");
    assert.equal(target.pathname, "/sell/fulfillment/v1/payment_dispute_summary");
    assert.equal(target.searchParams.get("limit"), "2");
    assert.equal(target.searchParams.get("offset"), "0");
    return Response.json({
      paymentDisputeSummaries: [], limit: 2, offset: 0,
      next: "https://api.ebay.com/sell/fulfillment/v1/payment_dispute_summary?limit=2&offset=2",
    });
  };
  try {
    const page = await readEbayPaymentDisputesPage({ payload, environment: "production", limit: 2 });
    assert.equal(page.availability, "readable");
    assert.equal(page.total, null);
    assert.equal(page.entries.length, 0);
    assert.equal(page.nextOffset, 2);
  } finally { globalThis.fetch = original; }
});

test("payment dispute 404 is availability-unknown evidence, never an empty collection", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ errors: [{ message: "private" }] }, { status: 404 });
  try {
    const page = await readEbayPaymentDisputesPage({ payload, environment: "production" });
    assert.deepEqual(page, {
      availability: "not_available_or_not_found", httpStatus: 404,
      entries: [], total: null, offset: 0, nextOffset: null,
    });
    assert.doesNotMatch(JSON.stringify(page), /private|fixture-token/);
  } finally { globalThis.fetch = original; }
});

test("known dispute detail/activity and known resolution case use isolated GET paths", async () => {
  const original = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(init?.method, "GET");
    const target = new URL(String(url));
    paths.push(target.pathname);
    return Response.json(target.pathname.endsWith("/activity")
      ? fixture("payment-dispute-activity")
      : target.pathname.includes("/post-order/")
        ? fixture("resolution-case-detail")
        : fixture("payment-dispute-detail"));
  };
  try {
    const detail = await readEbayPaymentDispute({ payload, environment: "production", paymentDisputeId: "fixture-dispute-1001" });
    const activity = await readEbayPaymentDisputeActivity({ payload, environment: "production", paymentDisputeId: "fixture-dispute-1001" });
    const resolution = await readEbayResolutionCaseByKnownId({ payload, environment: "production", caseId: "fixture-case-3001" });
    assert.equal(detail.availability, "readable");
    assert.equal(detail.data?.paymentDisputeId, "fixture-dispute-1001");
    assert.equal(activity.availability, "readable");
    assert.equal(activity.data?.paymentDisputeId, "fixture-dispute-1001");
    assert.equal(resolution.availability, "readable");
    assert.equal(resolution.data?.caseId, "fixture-case-3001");
    assert.doesNotMatch(JSON.stringify({ detail, activity, resolution }), /private|buyerUsername|returnAddress|caseHistoryDetails/);
    assert.deepEqual(paths, [
      "/sell/fulfillment/v1/payment_dispute/fixture-dispute-1001",
      "/sell/fulfillment/v1/payment_dispute/fixture-dispute-1001/activity",
      "/post-order/v2/casemanagement/fixture-case-3001",
    ]);
  } finally { globalThis.fetch = original; }
});

test("resolution case search and known-case reads are sandbox unsupported without requests", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return Response.json({}); };
  try {
    const result = await readEbayResolutionCaseByKnownId({ payload, environment: "sandbox", caseId: "case-1" });
    assert.deepEqual(result, { availability: "sandbox_unsupported", httpStatus: null, data: null });
    const page = await readEbayResolutionCasesPage({
      payload, environment: "sandbox",
      startTime: "2026-09-01T00:00:00.000Z", endTime: "2026-09-08T00:00:00.000Z",
    });
    assert.equal(page.availability, "sandbox_unsupported");
    assert.equal(page.total, null);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test("resolution case search normalizes exact page fields and strips buyer identity", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const target = new URL(String(url));
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("authorization"), "IAF fixture-token");
    assert.equal(target.pathname, "/post-order/v2/casemanagement/search");
    assert.equal(target.searchParams.get("case_creation_date_range_from"), "2026-09-01T00:00:00.000Z");
    assert.equal(target.searchParams.get("case_creation_date_range_to"), "2026-09-08T00:00:00.000Z");
    assert.equal(target.searchParams.get("limit"), "25");
    assert.equal(target.searchParams.get("offset"), "0");
    assert.equal(target.searchParams.get("sort"), "Descending");
    return Response.json(fixture("resolution-case-search-page"));
  };
  try {
    const page = await readEbayResolutionCasesPage({
      payload, environment: "production",
      startTime: "2026-09-01T00:00:00.000Z", endTime: "2026-09-08T00:00:00.000Z",
      verifiedSellerIdentifiers: ["fixture-seller"],
    });
    assert.equal(page.availability, "readable");
    assert.equal(page.total, 1);
    assert.equal(page.entries[0].sellerBinding, "matched");
    assert.equal(page.nextOffset, null);
    assert.doesNotMatch(JSON.stringify(page), /fixture-buyer|fixture-seller/);
  } finally { globalThis.fetch = original; }
});

test("resolution case pages preserve empty-with-more and missing totals", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({
      members: [], paginationOutput: { limit: 25, offset: 0, totalEntries: 51, totalPages: 3 }, totalNumberOfCases: 51,
    });
    const empty = await readEbayResolutionCasesPage({
      payload, environment: "production",
      startTime: "2026-09-01T00:00:00.000Z", endTime: "2026-09-08T00:00:00.000Z",
    });
    assert.equal(empty.nextOffset, 25);

    const row = fixture("resolution-case-search-page").members[0];
    globalThis.fetch = async () => Response.json({
      members: Array.from({ length: 25 }, (_, index) => ({ ...row, caseId: `fixture-case-${index}` })),
      paginationOutput: { limit: 25, offset: 0 },
    });
    const missing = await readEbayResolutionCasesPage({
      payload, environment: "production",
      startTime: "2026-09-01T00:00:00.000Z", endTime: "2026-09-08T00:00:00.000Z",
    });
    assert.equal(missing.total, null);
    assert.equal(missing.nextOffset, 25);

    globalThis.fetch = async () => Response.json({
      members: [], paginationOutput: { totalEntries: 0, totalPages: 0 }, totalNumberOfCases: 0,
    });
    const emptyWithoutEcho = await readEbayResolutionCasesPage({
      payload, environment: "production",
      startTime: "2026-09-01T00:00:00.000Z", endTime: "2026-09-08T00:00:00.000Z",
    });
    assert.equal(emptyWithoutEcho.total, 0);
    assert.equal(emptyWithoutEcho.nextOffset, null);

    globalThis.fetch = async () => Response.json({
      members: [], paginationOutput: { limit: 0, offset: 0, totalEntries: 0, totalPages: 0 }, totalNumberOfCases: 0,
    });
    const providerEmptySentinel = await readEbayResolutionCasesPage({
      payload, environment: "production",
      startTime: "2026-09-01T00:00:00.000Z", endTime: "2026-09-08T00:00:00.000Z",
    });
    assert.equal(providerEmptySentinel.total, 0);
    assert.equal(providerEmptySentinel.nextOffset, null);
  } finally { globalThis.fetch = original; }
});

test("resolution case search rejects another unredacted seller and ranges over 31 days", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json(fixture("resolution-case-search-page"));
  try {
    await assert.rejects(readEbayResolutionCasesPage({
      payload, environment: "production",
      startTime: "2026-09-01T00:00:00.000Z", endTime: "2026-09-08T00:00:00.000Z",
      verifiedSellerIdentifiers: ["another-seller"],
    }), /sellerAccountMismatch/);
    await assert.rejects(readEbayResolutionCasesPage({
      payload, environment: "production",
      startTime: "2026-07-01T00:00:00.000Z", endTime: "2026-09-08T00:00:00.000Z",
    }), /timeRange/);
  } finally { globalThis.fetch = original; }
});

test("malformed summaries and hostile or repeated cursors fail closed", async () => {
  const original = globalThis.fetch;
  try {
    for (const body of [
      { paymentDisputeSummaries: [{}], total: 1, limit: 200, offset: 0 },
      { paymentDisputeSummaries: [], limit: 200, offset: 0, next: "https://attacker.invalid/sell/fulfillment/v1/payment_dispute_summary?limit=200&offset=200" },
      { paymentDisputeSummaries: [], limit: 200, offset: 0, next: "https://api.ebay.com/sell/fulfillment/v1/payment_dispute_summary?limit=200&offset=0" },
    ]) {
      globalThis.fetch = async () => Response.json(body);
      await assert.rejects(readEbayPaymentDisputesPage({ payload, environment: "production" }), /EBAY_CASE_DISPUTE_CONTRACT_INVALID/);
    }
  } finally { globalThis.fetch = original; }
});
