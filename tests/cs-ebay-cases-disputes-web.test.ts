import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  readEbayPaymentDisputesPage,
  readEbayResolutionCasesPage,
} from "../lib/channels/cs/ebay/cases-disputes";
import {
  ebayCaseDisputeQuerySchema,
  ebayPaymentDisputePageResponseSchema,
  ebayResolutionCasePageResponseSchema,
} from "../lib/cs/channels/ebay/cases-disputes";

const payload = { access_token: "fixture-token", marketplace_id: "EBAY_US" };
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/cs/ebay/${name}.json`, import.meta.url), "utf8"));

test("web query contract requires exact account, range, and page alignment", () => {
  const credentialId = "00000000-0000-4000-8000-000000000001";
  assert.equal(ebayCaseDisputeQuerySchema.safeParse({ view: "payment_disputes", credentialId, offset: "25" }).success, true);
  assert.equal(ebayCaseDisputeQuerySchema.safeParse({ view: "payment_disputes", credentialId, offset: "1" }).success, false);
  assert.equal(ebayCaseDisputeQuerySchema.safeParse({
    view: "resolution_cases", credentialId, offset: "0",
    startTime: "2026-09-01T00:00:00.000Z", endTime: "2026-09-08T00:00:00.000Z",
  }).success, true);
  assert.equal(ebayCaseDisputeQuerySchema.safeParse({ view: "resolution_cases", credentialId, offset: "0" }).success, false);
  assert.equal(ebayCaseDisputeQuerySchema.safeParse({
    view: "resolution_cases", credentialId, offset: "0",
    startTime: "2026-07-01T00:00:00.000Z", endTime: "2026-09-08T00:00:00.000Z",
  }).success, false);
});

test("web schemas accept normalized provider fixtures without buyer text", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json(fixture("payment-dispute-summary-page"));
    const disputes = await readEbayPaymentDisputesPage({ payload, environment: "production", limit: 25 });
    const disputeResponse = ebayPaymentDisputePageResponseSchema.parse({
      ...disputes,
      kind: "payment_disputes",
      credentialId: "00000000-0000-4000-8000-000000000001",
      environment: "production",
    });
    assert.equal(disputeResponse.entries[0].status, "ACTION_NEEDED");
    assert.doesNotMatch(JSON.stringify(disputeResponse), /buyerUsername|fixture-buyer/);

    globalThis.fetch = async () => Response.json(fixture("resolution-case-search-page"));
    const cases = await readEbayResolutionCasesPage({
      payload, environment: "production", limit: 25,
      startTime: "2026-09-01T00:00:00.000Z", endTime: "2026-09-08T00:00:00.000Z",
      verifiedSellerIdentifiers: ["fixture-seller"],
    });
    const caseResponse = ebayResolutionCasePageResponseSchema.parse({
      ...cases,
      kind: "resolution_cases",
      credentialId: "00000000-0000-4000-8000-000000000001",
      environment: "production",
    });
    assert.equal(caseResponse.entries[0].sellerBinding, "matched");
    assert.doesNotMatch(JSON.stringify(caseResponse), /fixture-buyer|fixture-seller/);
  } finally {
    globalThis.fetch = original;
  }
});

test("web schema never turns provider-unavailable into an empty successful result", () => {
  const base = {
    kind: "payment_disputes" as const,
    credentialId: "00000000-0000-4000-8000-000000000001",
    environment: "production" as const,
    availability: "not_available_or_not_found" as const,
    httpStatus: 404,
    offset: 0,
    nextOffset: null,
    entries: [],
  };
  assert.equal(ebayPaymentDisputePageResponseSchema.safeParse({ ...base, total: null }).success, true);
  assert.equal(ebayPaymentDisputePageResponseSchema.safeParse({ ...base, total: 0 }).success, false);
});

test("eBay cases web route and component expose reads only", () => {
  const route = readFileSync(new URL("../app/api/admin/cs/channels/ebay/cases-disputes/route.ts", import.meta.url), "utf8");
  const component = readFileSync(new URL("../app/cs/channels/ebay/cases-disputes.tsx", import.meta.url), "utf8");
  assert.match(route, /export async function GET\(request: Request\)/);
  assert.doesNotMatch(route, /export async function (?:POST|PUT|PATCH|DELETE)\b/);
  assert.doesNotMatch(route, /acceptPaymentDispute|contestPaymentDispute|issueRefund|appealCaseDecision/);
  assert.match(component, /수락·이의제기·환불·종결 기능은 제공하지 않습니다/);
  assert.match(component, /readEbayCaseDisputeUiResponse/);
  assert.doesNotMatch(component, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
});
