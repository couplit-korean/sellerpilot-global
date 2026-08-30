import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CS navigation remains reachable from dashboard, channels and mobile", async () => {
  const [page, readiness, mobileStyles, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/channel-readiness.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/mobile-optimization.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /csNavigationParams\(\{ channel: nextChannel, status: nextStatus, ticketId: nextTicketId \}\)/);
  assert.match(page, /params\.get\("ticketId"\)/);
  assert.match(page, /displayTickets\.find\(\(ticket\) => ticket\.sourceId === initialTicketId\)/);
  assert.match(page, /kind: "inquiry",\s*id: ticket\.sourceId,/);
  assert.match(page, /onFilterChange\(initialChannel, resolvedInitialStatus, ticket\.sourceId\)/);
  assert.match(page, /isRemoteCsReplyChannel\(selected\.channelKey\)/);
  assert.match(page, /initialTicketId \? statusTickets : filteredTickets/);
  assert.match(page, /displayTickets\.length === 0 \?/);
  assert.match(page, /requestedView !== "cs"/);
  assert.doesNotMatch(page, /<CsPage key=/);
  assert.match(page, /<nav className="mobile-bottom-nav" aria-label="모바일 주요 메뉴">/);
  assert.match(page, /onClick=\{\(\) => openCs\("all", "open"\)\}/);
  assert.match(page, /onOpenCs=\{openCs\}/);
  assert.match(readiness, /문의함 열기/);
  assert.match(readiness, /safeSyncErrorMessage/);
  assert.match(layout, /import "\.\/mobile-optimization\.css"/);
  assert.match(mobileStyles, /\.mobile-bottom-nav\s*\{\s*position:\s*fixed;/);
  assert.match(mobileStyles, /grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(mobileStyles, /padding-bottom:\s*calc\(86px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(mobileStyles, /Fold-safe mobile overlay lanes[\s\S]*?\.analysis-start-bar\s*\{[^}]*position:\s*static;[^}]*bottom:\s*auto !important/);
  assert.match(mobileStyles, /--mobile-nav-clearance:\s*calc\(78px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(mobileStyles, /\.app-main > \.mobile-push-gate\.browser,\s*\.app-main > \.mobile-push-chip\s*\{[^}]*position:\s*relative;[^}]*inset:\s*auto/);
  assert.match(mobileStyles, /\.mobile-push-gate\.standalone\s*\{\s*z-index:\s*130;/);
  assert.match(mobileStyles, /min-height:\s*44px/);
});

test("CS remote reply UI is queue-first and polls with stable dependencies", async () => {
  const [page, snapshotRoute] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/operations/snapshot/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /response\.status !== 202 \|\| !payload\.jobId \|\| !payload\.delivery/);
  assert.match(page, /useModalInteraction\(Boolean\(reviewReply\), reviewDialogRef,[\s\S]{0,140}initialFocusRef: reviewCloseButtonRef/);
  assert.match(page, /const activeDeliveryKey = \[\.\.\.effectiveDeliveryByTicket\.entries\(\), \.\.\.displayTickets/);
  assert.match(page, /previous\.updatedAt === update\.delivery\.updatedAt\) continue;/);
  assert.match(page, /return changed \? next : current;/);
  assert.match(page, /\}, \[authenticatedOperationsFetch, reloadOperations\]\);/);
  assert.doesNotMatch(page, /getTicketDeliveryStatus[\s\S]{0,1200}\}, \[operations\]\);/);
  assert.match(page, /deliveryReconciliation \? "전송 여부 확인 필요"/);
  assert.match(page, /판매채널 성공 응답이 원장에 기록된 뒤에만 처리 완료로 표시됩니다/);
  assert.match(snapshotRoute, /INQUIRY_CONTEXT_STALE[\s\S]{0,240}status:\s*409/);
  assert.match(snapshotRoute, /CS_DELIVERY_LOCKED[\s\S]{0,280}전송 원장을 확인[\s\S]{0,120}status:\s*409/);
  assert.match(snapshotRoute, /REMOTE_REPLY_SUCCESS_REQUIRED[\s\S]{0,320}채널에서 결과를 확인[\s\S]{0,120}status:\s*409/);
});
