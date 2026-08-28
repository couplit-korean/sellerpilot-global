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
  assert.match(mobileStyles, /\.analysis-start-bar\s*\{\s*bottom:\s*calc\(72px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(mobileStyles, /\.mobile-push-gate\.browser,\s*\.mobile-push-chip\s*\{\s*z-index:\s*120;\s*bottom:\s*calc\(78px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(mobileStyles, /\.mobile-push-gate\.standalone\s*\{\s*z-index:\s*130;/);
  assert.match(mobileStyles, /min-height:\s*44px/);
});
