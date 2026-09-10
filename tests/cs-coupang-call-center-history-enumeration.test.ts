import { serverlessCsRepairInquiryEnqueues } from "../lib/cs/operations/schedule.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { executeCoupangInquiry } from "../lib/channels/coupang-inquiries.ts";
import { normalizeChannelInquiries } from "../lib/channels/inquiry-sync.ts";
import { inquiryHistorySyncRequests, inquirySyncRequests } from "../lib/channels/sync-arguments.ts";

const now = new Date("2026-09-08T03:00:00.000Z");
const payload = { access_key: "access", secret_key: "secret", vendor_id: "A00012345" };

test("current and history schedulers emit exactly one NONE=All call-center scan per window", () => {
  const current = inquirySyncRequests("coupang", now)
    .filter((request) => request.arguments.kind === "call-center");
  assert.equal(current.length, 1);
  assert.equal((current[0]?.arguments.query as Record<string, unknown>).partnerCounselingStatus, "NONE");

  const history = inquiryHistorySyncRequests("coupang", now, 30);
  const callCenter = history.filter((request) => request.arguments.kind === "call-center");
  assert.equal(callCenter.length, 5);
  assert.equal(new Set(callCenter.map((request) => request.periodicKey)).size, 5);
  for (const request of callCenter) {
    assert.match(request.periodicKey, /:call-center:none$/u);
    assert.equal((request.arguments.query as Record<string, unknown>).partnerCounselingStatus, "NONE");
  }
  assert.equal(history.some((request) => /:call-center:(answer|no_answer|transfer)$/u.test(request.periodicKey)), false);
});

test("NONE pagination retains every provider status and retries dedupe by immutable inbound key", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ page: number; status: string }> = [];
  const rows = [
    { inquiryId: 7101, content: "answered", partnerCounselingStatus: "ANSWER", inquiryAt: "2026-09-07T01:00:00Z" },
    { inquiryId: 7102, content: "waiting", partnerCounselingStatus: "NO_ANSWER", inquiryAt: "2026-09-07T02:00:00Z" },
    { inquiryId: 7103, content: "transfer", partnerCounselingStatus: "TRANSFER", inquiryAt: "2026-09-07T03:00:00Z" },
  ];
  globalThis.fetch = async (input) => {
    const query = new URL(String(input)).searchParams;
    const page = Number(query.get("pageNum"));
    requests.push({ page, status: query.get("partnerCounselingStatus") ?? "" });
    return Response.json({ code: "SUCCESS", data: { content: [rows[page - 1]], totalPages: 3 } });
  };
  try {
    const argumentsValue = inquiryHistorySyncRequests("coupang", now, 7)
      .find((request) => request.arguments.kind === "call-center")!.arguments;
    const normalizedByInboundKey = new Map<string, ReturnType<typeof normalizeChannelInquiries>[number]>();
    const executePage = async (arguments_: Record<string, unknown>) => {
      const execution = await executeCoupangInquiry({ operation: "inquiries.list", payload, arguments: arguments_ });
      const normalized = normalizeChannelInquiries("coupang", {
        ok: true,
        channel: "coupang",
        operation: "inquiries.list",
        steps: execution.steps,
        safeMessage: "fixture",
      }, "2026-09-08T03:00:00.000Z");
      for (const inquiry of normalized) normalizedByInboundKey.set(inquiry.inboundKey, inquiry);
      return execution.continuationArguments;
    };

    const pageTwo = await executePage(argumentsValue);
    assert.ok(pageTwo);
    const pageThree = await executePage(pageTwo!);
    assert.ok(pageThree);
    assert.deepEqual(await executePage(pageTwo!), pageThree, "retrying page two must return the identical continuation");
    assert.equal(await executePage(pageThree!), undefined);

    assert.deepEqual(requests, [
      { page: 1, status: "NONE" },
      { page: 2, status: "NONE" },
      { page: 2, status: "NONE" },
      { page: 3, status: "NONE" },
    ]);
    assert.equal(normalizedByInboundKey.size, 3);
    assert.deepEqual(
      [...normalizedByInboundKey.values()].map((inquiry) => inquiry.externalTicketId).sort(),
      ["call-center:7101", "call-center:7102", "call-center:7103"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("daily repair preserves a complete five-scope window across every rotation slot", () => {
  for (let day = 1; day <= 10; day += 1) {
    const date = new Date(Date.UTC(2026, 8, day, 18, 2));
    const requests = serverlessCsRepairInquiryEnqueues(date, ["coupang"])
      .filter((request) => request.channel === "coupang");
    assert.equal(requests.length, 5);
    assert.equal(new Set(requests.map(({ payload }) => payload.periodicKey.split(":").slice(2, 4).join(":"))).size, 1);
    assert.deepEqual(new Set(requests.map(({ payload }) => payload.arguments.kind)),
      new Set(["product", "call-center", "return_request", "cancel_request", "exchange_request"]));
  }
});
