import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) {
      return { format: "module", source: "export default {}", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const {
  ElevenstReadStateSummary,
  fetchElevenstReadState,
} = await import("../app/cs/channels/elevenst/read-state");
const { elevenstReadStateSchema } = await import("../lib/cs/channels/elevenst/read-state-contract");

const payload = {
  contractVersion: "sellerpilot-elevenst-authenticated-read-state/3",
  sellerId: "couplit",
  sellerName: "커플릿",
  productQna: {
    contractVersion: "sellerpilot-elevenst-readonly-web-projection/1",
    surface: "product_qna",
    providerState: "business_error",
    remoteCount: null,
    storedCount: 4,
    storedHistoryState: "preserved_unverified",
    emptyConfirmed: false,
    replyEnabled: false,
    checkedAt: "2026-09-08T07:30:00.000Z",
    latestStoredReceivedAt: "2026-08-31T01:00:00.000Z",
    message: "11번가가 업무 오류를 반환했습니다. 원격 0건으로 표시하지 않습니다.",
  },
  urgentAlimi: {
    contractVersion: "sellerpilot-elevenst-readonly-web-projection/1",
    surface: "urgent_alimi",
    providerState: "empty",
    remoteCount: 0,
    storedCount: 2,
    storedHistoryState: "current",
    emptyConfirmed: true,
    replyEnabled: false,
    checkedAt: "2026-09-08T07:31:00.000Z",
    latestStoredReceivedAt: "2026-09-08T03:30:30.000Z",
    message: "11번가 원격 조회가 정상 완료되었으며 이 조회 범위의 결과는 0건입니다.",
  },
  sellerTalk: {
    contractVersion: "sellerpilot-elevenst-limited-access-projection/2",
    surface: "seller_talk",
    accessMode: "seller_office_session_only",
    automaticReadAvailable: false,
    automaticReplyAvailable: false,
    remoteCount: null,
    storedCount: null,
    retention: { maximum: 3, unit: "month", exactDays: null },
    reviewedImportCandidate: "reviewed_browser_capture",
    message: "공식 자동 수신·답변 API 계약을 확인하지 못했습니다. Seller Office 세션의 최근 최대 3개월 화면만 수동 검토할 수 있으며, 표시된 0건을 과거 전체 0건으로 해석하지 않습니다.",
  },
  review: {
    contractVersion: "sellerpilot-elevenst-limited-access-projection/2",
    surface: "review",
    accessMode: "seller_office_export_only",
    automaticReadAvailable: false,
    automaticReplyAvailable: false,
    remoteCount: null,
    storedCount: null,
    retention: null,
    reviewedImportCandidate: "seller_office_xls_preview",
    message: "공식 리뷰 조회·댓글 API 계약을 확인하지 못했습니다. Seller Office 엑셀은 열과 출처를 검토하는 미리보기 수입 후보일 뿐 자동연동이나 댓글 완료 증거가 아닙니다.",
  },
  readOnly: true,
} as const;

test("11st CS panel renders the authenticated API values without turning business 500 into remote zero", () => {
  const state = elevenstReadStateSchema.parse(payload);
  const html = renderToStaticMarkup(createElement(ElevenstReadStateSummary, { state }));
  assert.match(html, /판매자 couplit · 커플릿/u);
  assert.match(html, /상품 Q&amp;A/u);
  assert.match(html, /공급자 업무 오류/u);
  assert.match(html, /원격 건수<\/dt><dd>미확정/u);
  assert.match(html, /통합 CS 원장<\/dt><dd>4건/u);
  assert.match(html, /긴급알리미/u);
  assert.match(html, /원격 건수<\/dt><dd>0건/u);
  assert.match(html, /통합 CS 원장<\/dt><dd>2건/u);
  assert.match(html, /읽기 전용 · 자동 답변 비활성/u);
  assert.match(html, /셀러톡/u);
  assert.match(html, /Seller Office 세션 전용/u);
  assert.match(html, /보존기간<\/dt><dd>최대 3개월 · 정확한 일수 미확정/u);
  assert.match(html, /리뷰·댓글/u);
  assert.match(html, /Seller Office 내보내기 전용/u);
  assert.match(html, /통합 CS 원장<\/dt><dd>미연결/u);
  assert.match(html, /공식 API 계약 미확인/u);
});

test("11st CS panel loader reuses the authenticated no-store endpoint", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const state = await fetchElevenstReadState(async (input, init) => {
    calls.push({ input, init });
    return Response.json(payload);
  });
  assert.equal(state.urgentAlimi.storedCount, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.input, "/api/admin/cs/channels/elevenst/read-state");
  assert.equal(calls[0]?.init?.cache, "no-store");
});

test("11st CS panel rejects auth failures, seller mismatch and contradictory empty evidence", async () => {
  await assert.rejects(
    fetchElevenstReadState(async () => Response.json({ message: "unauthorized" }, { status: 401 })),
    /ELEVENST_READ_STATE_HTTP_401/u,
  );
  assert.equal(elevenstReadStateSchema.safeParse({ ...payload, sellerId: "other" }).success, false);
  assert.equal(elevenstReadStateSchema.safeParse({
    ...payload,
    urgentAlimi: { ...payload.urgentAlimi, emptyConfirmed: false },
  }).success, false);
  assert.equal(elevenstReadStateSchema.safeParse({
    ...payload,
    sellerTalk: { ...payload.sellerTalk, remoteCount: 0 },
  }).success, false);
  assert.equal(elevenstReadStateSchema.safeParse({
    ...payload,
    review: { ...payload.review, automaticReplyAvailable: true },
  }).success, false);
  assert.equal(elevenstReadStateSchema.safeParse({
    ...payload,
    sellerTalk: { ...payload.sellerTalk, retention: { maximum: 90, unit: "day", exactDays: 90 } },
  }).success, false);
});
