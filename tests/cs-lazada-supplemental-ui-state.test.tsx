import assert from "node:assert/strict";
import test from "node:test";
import {
  createLazadaSupplementalReadLoader,
  lazadaSupplementalEventIdentity,
} from "../lib/cs/channels/lazada/supplemental-ui-state";
import { lazadaSupplementalEventRowKey } from "../app/cs/channels/lazada/supplemental-summary";
import type {
  LazadaSupplementalReadResponse,
  LazadaSupplementalStoredEvent,
} from "../lib/cs/channels/lazada/supplemental-contract";

const myCredential = "00000000-0000-4000-8000-000000001223";
const sgCredential = "00000000-0000-4000-8000-000000001224";
const sameEventKey = "a".repeat(64);
const sameOccurredAt = "2026-09-09T09:00:00.000Z";

function event(index: number, overrides: Partial<LazadaSupplementalStoredEvent> = {}): LazadaSupplementalStoredEvent {
  return {
    credentialId: myCredential,
    country: "MY",
    surface: "product_review",
    sourcePath: "/review/seller/list",
    resourceKey: `review-${index}`,
    eventKey: index.toString(16).padStart(64, "0"),
    status: "visible",
    title: `리뷰 ${index}`,
    body: null,
    externalOrderId: null,
    externalItemId: `item-${index}`,
    rating: 5,
    occurredAt: new Date(Date.parse(sameOccurredAt) - index * 1_000).toISOString(),
    observedAt: "2026-09-09T11:45:00.000Z",
    providerContext: { reviewId: `review-${index}` },
    ...overrides,
  };
}

function response(
  events: LazadaSupplementalStoredEvent[],
  nextCursor: LazadaSupplementalReadResponse["nextCursor"],
): LazadaSupplementalReadResponse {
  return {
    contractVersion: "sellerpilot-lazada-supplemental-read-ui/1",
    readOnly: true,
    liveProviderRead: false,
    capabilities: [{
      surface: "product_review",
      state: "permission_pending",
      adapterReady: true,
      livePermissionObserved: false,
      automaticReadEnabled: false,
      replyEnabled: false,
      mutationsEnabled: false,
      message: "저장된 리뷰만 표시합니다.",
    }, {
      surface: "reverse_order_after_sales",
      state: "conditional",
      adapterReady: true,
      livePermissionObserved: false,
      automaticReadEnabled: false,
      replyEnabled: false,
      mutationsEnabled: false,
      message: "저장된 사후지원 이력만 표시합니다.",
    }],
    events,
    nextCursor,
  };
}

function jsonResponse(value: unknown) {
  return Response.json(value, { status: 200 });
}

test("bounded Load more reaches row 51 and retains MY/SG rows sharing time and event key", async () => {
  const firstEvents = Array.from({ length: 50 }, (_, index) => event(index + 1));
  firstEvents[49] = event(50, {
    eventKey: sameEventKey,
    occurredAt: sameOccurredAt,
    resourceKey: "shared-review",
  });
  const cursor = {
    occurredAt: sameOccurredAt,
    eventKey: sameEventKey,
    credentialId: myCredential,
    country: "MY",
  };
  const sgSameKey = event(51, {
    credentialId: sgCredential,
    country: "SG",
    eventKey: sameEventKey,
    occurredAt: sameOccurredAt,
    resourceKey: "shared-review",
  });
  const calls: string[] = [];
  const loader = createLazadaSupplementalReadLoader(async (input) => {
    calls.push(input);
    return calls.length === 1
      ? jsonResponse(response(firstEvents, cursor))
      : jsonResponse(response([firstEvents[49], sgSameKey], null));
  });
  const first = await loader.load(null, false);
  assert.equal(first.status, "applied");
  if (first.status !== "applied") return;
  const second = await loader.load(first.state, true);
  assert.equal(second.status, "applied");
  if (second.status !== "applied") return;
  assert.equal(second.state.events.length, 51);
  assert.equal(new Set(second.state.events.map(lazadaSupplementalEventIdentity)).size, 51);
  assert.equal(second.state.nextCursor, null);
  assert.match(calls[0], /[?&]limit=50(?:&|$)/u);
  const pageTwo = new URL(calls[1], "https://sellerpilot.test");
  assert.deepEqual(Object.fromEntries(pageTwo.searchParams), {
    limit: "50",
    beforeAt: sameOccurredAt,
    beforeKey: sameEventKey,
    beforeCredentialId: myCredential,
    beforeCountry: "MY",
  });
  assert.notEqual(lazadaSupplementalEventRowKey(firstEvents[49]), lazadaSupplementalEventRowKey(sgSameKey));
  assert.deepEqual(second.state.events
    .filter((item) => item.eventKey === sameEventKey && item.resourceKey === "shared-review")
    .map((item) => `${item.credentialId}:${item.country}`).sort(),
  [`${myCredential}:MY`, `${sgCredential}:SG`]);
});

test("reload and close cancellation make superseded responses stale", async () => {
  const pending: Array<{
    signal: AbortSignal | null;
    resolve: (response: Response) => void;
  }> = [];
  const loader = createLazadaSupplementalReadLoader((_input, init) => new Promise<Response>((resolve) => {
    pending.push({ signal: init?.signal ?? null, resolve });
  }));
  const superseded = loader.load(null, false);
  const current = loader.load(null, false);
  assert.equal(pending[0].signal?.aborted, true);
  pending[1].resolve(jsonResponse(response([event(2)], null)));
  const currentResult = await current;
  assert.equal(currentResult.status, "applied");
  pending[0].resolve(jsonResponse(response([event(1)], null)));
  assert.deepEqual(await superseded, { status: "stale" });

  const closed = loader.load(null, false);
  loader.cancel();
  assert.equal(pending[2].signal?.aborted, true);
  pending[2].resolve(jsonResponse(response([event(3)], null)));
  assert.deepEqual(await closed, { status: "stale" });
});
