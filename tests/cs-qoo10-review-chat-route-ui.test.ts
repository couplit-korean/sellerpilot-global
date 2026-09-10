import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { chromium } from "playwright-core";
import ts from "typescript";
import { build } from "vite";
import {
  projectQoo10ReviewChatStatus,
  qoo10ReviewChatAccountsSchema,
  qoo10ReviewChatObservationReadSchema,
  qoo10ReviewChatStatusSchema,
  type Qoo10ReviewChatAccount,
  type Qoo10ReviewChatDurableObservation,
  type Qoo10ReviewChatObservationRead,
} from "../lib/cs/channels/qoo10/review-chat-contract";
import {
  qoo10InquirySourceReadSchema,
  type Qoo10InquirySourceRead,
} from "../lib/cs/channels/qoo10/source-capability";

const [routeSource, uiSource, archiveSource, workspaceSource] = await Promise.all([
  readFile(new URL(
    "../app/api/admin/cs/channels/qoo10/review-chat/route.ts",
    import.meta.url,
  ), "utf8"),
  readFile(new URL(
    "../app/cs/channels/qoo10/review-chat-status.tsx",
    import.meta.url,
  ), "utf8"),
  readFile(new URL("../app/cs/archive.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/cs/workspace.tsx", import.meta.url), "utf8"),
]);

const credentialId = "00000000-0000-4000-8000-000000069006";
const otherCredentialId = "00000000-0000-4000-8000-000000069007";
const sellerAccountKeyHash = "a".repeat(64);
const checkedAt = "2026-09-09T18:00:00.000Z";
const repositoryRoot = new URL("..", import.meta.url);

function account(input: Partial<Qoo10ReviewChatAccount> = {}): Qoo10ReviewChatAccount {
  return {
    credentialId,
    label: "Qoo10 연결 계정 · QOOACCOUNT01",
    credentialState: "active",
    credentialExpiresAt: "2026-09-10T18:00:00.000Z",
    sellerAccountBinding: "provider_certified",
    sellerAccountKeyHash,
    environment: "production",
    ...input,
  };
}

function evidence(
  input: Partial<Qoo10ReviewChatDurableObservation> = {},
): Qoo10ReviewChatDurableObservation {
  return {
    contract: "sellerpilot-qoo10-review-chat-durable-observation/1",
    source: "sellerpilot_private.qoo10_review_chat_observations",
    sourceRevision: 1,
    sourceRevisionSha256: "b".repeat(64),
    sourceArtifactId: "qsm-review-snapshot:1",
    sourceArtifactSha256: "c".repeat(64),
    credentialId,
    sellerAccountKeyHash,
    environment: "production",
    observedAt: "2026-09-09T17:50:00.000Z",
    validUntil: "2026-09-09T18:05:00.000Z",
    sellerDashboardVisible: true,
    buyerInquirySummaryVisible: true,
    reviewHistoryVisible: true,
    reviewNavigationResult: "history_visible",
    review: {
      historyState: "verified_zero",
      observedCount: 0,
      importedCount: 0,
      reconciledCount: 0,
    },
    buyerChatHistoryVisible: false,
    buyerChatNavigationResult: "unavailable",
    buyerChat: {
      historyState: "unknown",
      observedCount: null,
      importedCount: 0,
      reconciledCount: 0,
    },
    ...input,
  };
}

function runtimeRead(input: {
  selectedAccount?: Qoo10ReviewChatAccount;
  observationState?: "no_evidence" | "current" | "expired";
  durableEvidence?: Qoo10ReviewChatDurableObservation | null;
} = {}): Qoo10ReviewChatObservationRead {
  const observationState = input.observationState ?? "current";
  return {
    contract: "sellerpilot-qoo10-review-chat-observation-read/1",
    checkedAt,
    account: input.selectedAccount ?? account(),
    observationState,
    evidence: input.durableEvidence === undefined
      ? observationState === "no_evidence" ? null : evidence({
        validUntil: observationState === "expired"
          ? "2026-09-09T17:59:59.000Z"
          : "2026-09-09T18:05:00.000Z",
      })
      : input.durableEvidence,
  };
}

function inquirySourceRead(input: Partial<Qoo10InquirySourceRead> = {}): Qoo10InquirySourceRead {
  return {
    contract: "sellerpilot-qoo10-inquiry-source-read/1",
    checkedAt,
    credentialId,
    sellerAccountKeyHash,
    environment: "production",
    scopeState: "account_scoped",
    canonical: {
      ticketCount: 1,
      inboundMessageCount: 2,
      waitingTicketCount: 1,
      answeredTicketCount: 0,
      closedTicketCount: 0,
      unknownTicketCount: 0,
      lastReceivedAt: "2026-09-09T17:55:00.000Z",
    },
    history: {
      windowCount: 3,
      queuedWindowCount: 0,
      completeWindowCount: 3,
      refiningWindowCount: 0,
      gapWindowCount: 0,
      verifiedZeroWindowCount: 2,
      positiveCompleteWindowCount: 1,
      earliestCalendarDate: "2026-09-09",
      latestCalendarDate: "2026-09-09",
      lastUpdatedAt: "2026-09-09T17:56:00.000Z",
    },
    ...input,
  };
}

const accounts = qoo10ReviewChatAccountsSchema.parse({
  contract: "sellerpilot-qoo10-review-chat-accounts/2",
  checkedAt,
  accounts: [
    account(),
    account({
      credentialId: otherCredentialId,
      label: "Qoo10 연결 계정 · QOOACCOUNT02",
      sellerAccountKeyHash: "d".repeat(64),
    }),
  ],
});

test("no-evidence and expired durable observations remain explicit and fail closed", () => {
  const none = projectQoo10ReviewChatStatus({
    expectedAccount: account(),
    inquirySourceRead: inquirySourceRead(),
    runtimeRead: runtimeRead({
      observationState: "no_evidence",
      durableEvidence: null,
    }),
  });
  assert.equal(none.observationState, "no_evidence");
  assert.equal(none.lastEvidence, null);
  assert.equal(none.review.supportState, "unsupported");
  assert.equal(none.review.historyState, "unknown");
  assert.equal(none.buyerChat.supportState, "unsupported");
  assert.equal(none.ordinaryInquiry.evidenceState, "canonical_rows");
  assert.equal(none.customerActionsAvailable, false);

  const expired = projectQoo10ReviewChatStatus({
    expectedAccount: account(),
    inquirySourceRead: inquirySourceRead(),
    runtimeRead: runtimeRead({ observationState: "expired" }),
  });
  assert.equal(expired.observationState, "expired");
  assert.equal(expired.review.supportState, "unsupported");
  assert.equal(expired.review.observedCount, null);
});

test("credential lifecycle and canonical account mismatches cannot expose evidence", () => {
  for (const credentialState of ["grace", "expired", "revoked", "invalid"] as const) {
    const selectedAccount = account({ credentialState });
    const status = projectQoo10ReviewChatStatus({
      expectedAccount: selectedAccount,
      inquirySourceRead: inquirySourceRead({
        credentialId: selectedAccount.credentialId,
        sellerAccountKeyHash: selectedAccount.sellerAccountKeyHash,
      }),
      runtimeRead: runtimeRead({ selectedAccount }),
    });
    assert.equal(status.accountEvidenceState, "credential_unavailable");
    assert.equal(status.review.supportState, "unsupported");
    assert.equal(status.ordinaryInquiry.evidenceState, "credential_unavailable");
    assert.equal(status.review.historyState, "unknown");
  }
  assert.throws(() => projectQoo10ReviewChatStatus({
    expectedAccount: account(),
    inquirySourceRead: inquirySourceRead(),
    runtimeRead: runtimeRead({
      selectedAccount: account({ sellerAccountKeyHash: "e".repeat(64) }),
    }),
  }), /QOO10_REVIEW_CHAT_OBSERVATION_SCOPE_MISMATCH|QOO10_REVIEW_CHAT_ACCOUNT/u);
});

test("positive provider windows without canonical rows fail closed and never promote unsupported sources", () => {
  const status = projectQoo10ReviewChatStatus({
    expectedAccount: account(),
    runtimeRead: runtimeRead(),
    inquirySourceRead: inquirySourceRead({
      canonical: {
        ticketCount: 0,
        inboundMessageCount: 0,
        waitingTicketCount: 0,
        answeredTicketCount: 0,
        closedTicketCount: 0,
        unknownTicketCount: 0,
        lastReceivedAt: null,
      },
      history: {
        windowCount: 1,
        queuedWindowCount: 0,
        completeWindowCount: 1,
        refiningWindowCount: 0,
        gapWindowCount: 0,
        verifiedZeroWindowCount: 0,
        positiveCompleteWindowCount: 1,
        earliestCalendarDate: "2026-09-09",
        latestCalendarDate: "2026-09-09",
        lastUpdatedAt: "2026-09-09T17:56:00.000Z",
      },
    }),
  });
  assert.equal(status.ordinaryInquiry.evidenceState, "persistence_mismatch");
  assert.equal(status.review.supportState, "unsupported");
  assert.equal(status.buyerChat.supportState, "unsupported");
  assert.equal(status.customerActionsAvailable, false);
});

const transpiledRoute = ts.transpileModule(routeSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
});
assert.equal(
  transpiledRoute.diagnostics?.filter(
    item => item.category === ts.DiagnosticCategory.Error,
  ).length ?? 0,
  0,
);

function loadRoute(input: {
  read?: unknown;
  accountData?: unknown;
  accountsError?: unknown;
  observationError?: unknown;
  inquirySourceRead?: unknown;
  inquirySourceError?: unknown;
  adminResponse?: Response;
} = {}) {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const exportsObject: Record<string, unknown> = {};
  const sandbox = vm.createContext({
    exports: exportsObject,
    Request,
    Response,
    URL,
    Set,
    require(name: string) {
      if (name === "next/server") return { NextResponse: Response };
      if (name.endsWith("/admin-api")) return {
        authenticateAdminRequest: async () => input.adminResponse ?? ({
          user: { id: "owner" },
          userClient: {
            rpc: async (rpcName: string, args?: Record<string, unknown>) => {
              calls.push({ name: rpcName, args });
              if (rpcName === "sellerpilot_read_qoo10_review_chat_accounts_v1") {
                return {
                  data: input.accountData ?? accounts,
                  error: input.accountsError ?? null,
                };
              }
              if (rpcName === "sellerpilot_read_qoo10_review_chat_observation_v1") {
                return {
                  data: input.read ?? runtimeRead(),
                  error: input.observationError ?? null,
                };
              }
              if (rpcName === "sellerpilot_read_qoo10_inquiry_source_v1") {
                return {
                  data: input.inquirySourceRead ?? inquirySourceRead(),
                  error: input.inquirySourceError ?? null,
                };
              }
              throw new Error(`unexpected RPC ${rpcName}`);
            },
          },
        }),
        isAdminApiError: (value: unknown) => value instanceof Response,
      };
      if (name.endsWith("/review-chat-contract")) return {
        projectQoo10ReviewChatStatus,
        qoo10ReviewChatAccountsSchema,
        qoo10ReviewChatObservationReadSchema,
      };
      if (name.endsWith("/source-capability")) return { qoo10InquirySourceReadSchema };
      throw new Error(`unexpected import ${name}`);
    },
  });
  vm.runInContext(transpiledRoute.outputText, sandbox);
  return {
    GET: exportsObject.GET as (request: Request) => Promise<Response>,
    calls,
  };
}

test("authenticated GET reads the canonical account list then exact durable observation RPC", async () => {
  const route = loadRoute();
  const response = await route.GET(new Request(
    `https://sellerpilot.invalid/review-chat?view=status&credentialId=${credentialId}`,
  ));
  assert.equal(response.status, 200);
  const status = qoo10ReviewChatStatusSchema.parse(await response.json());
  assert.equal(status.account.credentialId, credentialId);
  assert.equal(status.lastEvidence?.sourceArtifactId, "qsm-review-snapshot:1");
  assert.equal(status.ordinaryInquiry.evidenceState, "canonical_rows");
  assert.equal(JSON.stringify(route.calls), JSON.stringify([
    { name: "sellerpilot_read_qoo10_review_chat_accounts_v1", args: undefined },
    {
      name: "sellerpilot_read_qoo10_review_chat_observation_v1",
      args: { p_credential_id: credentialId },
    },
    {
      name: "sellerpilot_read_qoo10_inquiry_source_v1",
      args: { p_credential_id: credentialId },
    },
  ]));
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
});

test("route rejects unauthenticated, forged, or drifted reads without durable evidence disclosure", async () => {
  const unauthorized = loadRoute({
    adminResponse: Response.json({ code: "UNAUTHORIZED" }, { status: 401 }),
  });
  assert.equal((await unauthorized.GET(new Request(
    `https://sellerpilot.invalid/review-chat?view=status&credentialId=${credentialId}`,
  ))).status, 401);
  assert.equal(unauthorized.calls.length, 0);

  const forged = loadRoute();
  assert.equal((await forged.GET(new Request(
    "https://sellerpilot.invalid/review-chat?view=status&credentialId=00000000-0000-4000-8000-000000069099",
  ))).status, 409);
  assert.equal(forged.calls.length, 1);

  const drifted = loadRoute({ read: { contract: "forged" } });
  assert.equal((await drifted.GET(new Request(
    `https://sellerpilot.invalid/review-chat?view=status&credentialId=${credentialId}`,
  ))).status, 502);
});

test("reachable UI is GET-only and labels canonical absence, expiry, revision, and disabled actions", () => {
  assert.match(workspaceSource, /<CsArchive authenticatedFetch=\{authenticatedFetch\}/u);
  assert.match(archiveSource, /<Qoo10ReviewChatStatusPanel authenticatedFetch=\{authenticatedFetch\}/u);
  assert.match(routeSource, /sellerpilot_read_qoo10_review_chat_accounts_v1/u);
  assert.match(routeSource, /sellerpilot_read_qoo10_review_chat_observation_v1/u);
  assert.match(routeSource, /sellerpilot_read_qoo10_inquiry_source_v1/u);
  assert.doesNotMatch(routeSource, /qoo10VerifiedCentralReviewChatEvidence/u);
  assert.doesNotMatch(routeSource, /review-chat-evidence/u);
  assert.match(uiSource, /method: "GET"/u);
  assert.doesNotMatch(uiSource, /method: "POST"/u);
  assert.match(uiSource, /선택 계정에 결속된 관측 없음/u);
  assert.match(uiSource, /하드코딩된 과거 관측은 선택 계정의 현재 증거로 사용하지 않습니다/u);
  assert.match(uiSource, /불변 revision/u);
  assert.match(uiSource, /브라우저 기록 API 없음/u);
  assert.match(uiSource, /관측으로 권한 부여 안 함/u);
  assert.match(uiSource, /고객 전송·댓글·채팅 답변 기능은 열려 있지 않습니다/u);
  assert.doesNotMatch(uiSource, /답변 전송<\/button>/u);
});

async function firstExecutable(candidates: Array<string | undefined>) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through explicit local browser candidates.
    }
  }
  return null;
}

function sessionFixtureSource() {
  return `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Qoo10ReviewChatStatusPanel } from "../../app/cs/channels/qoo10/review-chat-status.tsx";

const ids = {
  a: "00000000-0000-4000-8000-00000000a001",
  b: "00000000-0000-4000-8000-00000000b002",
  c: "00000000-0000-4000-8000-00000000c003",
};
const checkedAt = "2026-09-09T18:00:00.000Z";
function account(suffix) {
  return {
    credentialId: ids[suffix],
    label: \`Qoo10 세션 \${suffix.toUpperCase()} · QOOSESSION\${suffix.toUpperCase()}\`,
    credentialState: "active",
    credentialExpiresAt: "2026-09-10T18:00:00.000Z",
    sellerAccountBinding: "provider_certified",
    sellerAccountKeyHash: suffix.repeat(64),
    environment: "production",
  };
}
function accounts(suffix) {
  return {
    contract: "sellerpilot-qoo10-review-chat-accounts/2",
    checkedAt,
    accounts: [account(suffix)],
  };
}
function status(suffix, marker = suffix) {
  return {
    contract: "sellerpilot-qoo10-review-chat-status/3",
    checkedAt,
    account: account(suffix),
    accountEvidenceState: "current",
    observationState: "current",
    lastEvidence: {
      sourceRevision: 1,
      sourceRevisionSha256: suffix.repeat(64),
      sourceArtifactId: \`qsm-session-\${marker}-snapshot\`,
      sourceArtifactSha256: suffix.repeat(64),
      observedAt: "2026-09-09T17:50:00.000Z",
      validUntil: "2026-09-09T18:05:00.000Z",
      sellerDashboardVisible: true,
      buyerInquirySummaryVisible: true,
      reviewHistoryVisible: true,
      reviewNavigationResult: "history_visible",
      buyerChatHistoryVisible: false,
      buyerChatNavigationResult: "unavailable",
    },
    inquiryHistory: { separateSurface: true, canPromoteReviewOrBuyerChat: false },
    ordinaryInquiry: {
      key: "ordinary_inquiry", label: "일반 문의 MSG·HELP·ITEM", source: "qapi_sales_inquiry",
      supportState: "supported", evidenceState: "canonical_rows",
      receiveMethod: "CSCenter.GetInquiryMessage", replyMethod: "CSCenter.SetInquiryMessage",
      adapter: "lib/cs/channels/qoo10/adapter.ts", normalizer: "lib/channels/inquiry-sync.ts",
      canonicalStore: "sellerpilot_private.support_tickets+support_inbound_messages",
      historyLedger: "sellerpilot_private.qoo10_history_windows",
      receiveImplemented: true, canonicalPersistenceImplemented: true,
      replyImplemented: true, panelReplyActionEnabled: false,
      canonical: { ticketCount: 1, inboundMessageCount: 1, waitingTicketCount: 1,
        answeredTicketCount: 0, closedTicketCount: 0, unknownTicketCount: 0,
        lastReceivedAt: "2026-09-09T17:55:00.000Z" },
      history: { windowCount: 1, queuedWindowCount: 0, completeWindowCount: 1,
        refiningWindowCount: 0, gapWindowCount: 0, verifiedZeroWindowCount: 0,
        positiveCompleteWindowCount: 1, earliestCalendarDate: "2026-09-09",
        latestCalendarDate: "2026-09-09", lastUpdatedAt: "2026-09-09T17:56:00.000Z" },
    },
    review: {
      key: "review", label: "상품 리뷰·댓글", source: "qsm_review_export",
      officialQapiMethod: null, supportState: "unsupported",
      unsupportedReason: "qsm_export_row_contract_unverified",
      evidenceState: "unsupported", historyState: "verified_zero",
      observedCount: 0, importedCount: 0, reconciledCount: 0,
      missingSource: null, missingPermission: null,
      receiveEnabled: false, historyImportEnabled: false, replyEnabled: false,
    },
    buyerChat: {
      key: "buyer_chat", label: "Buyer Chat·판매자 채팅",
      source: "verified_official_buyer_chat_contract", officialQapiMethod: null,
      supportState: "unsupported",
      unsupportedReason: "official_receive_history_contract_unavailable",
      evidenceState: "unsupported", historyState: "unknown",
      observedCount: null, importedCount: 0, reconciledCount: 0,
      missingSource: "official_buyer_chat_history_source_and_format",
      missingPermission: "account_scoped_buyer_chat_permission",
      receiveEnabled: false, historyImportEnabled: false, replyEnabled: false,
    },
    recordingBoundary: {
      browserWriteAvailable: false, serviceRoleOnly: true,
      permissionsGrantedByObservation: false,
    },
    customerActionsAvailable: false,
  };
}

const requests = [];
const fetchers = Object.fromEntries(["first", "second", "third"].map((session) => [
  session,
  (input, init = {}) => new Promise((resolve, reject) => requests.push({
    session, url: String(input), signal: init.signal, resolve, reject,
  })),
]));
let changeSession = () => {};
let changeMounted = () => {};
function Fixture() {
  const [session, setSession] = useState("first");
  const [mounted, setMounted] = useState(true);
  changeSession = setSession;
  changeMounted = setMounted;
  return mounted
    ? <Qoo10ReviewChatStatusPanel authenticatedFetch={fetchers[session]} />
    : null;
}

window.fixture = {
  requests: () => requests.map((request) => ({
    session: request.session,
    url: request.url,
    aborted: request.signal?.aborted === true,
  })),
  swap: (session) => changeSession(session),
  unmount: () => changeMounted(false),
  remount: () => changeMounted(true),
  resolveAccounts: (index, suffix) => requests[index].resolve(Response.json(accounts(suffix))),
  resolveStatus: (index, suffix, marker) => requests[index].resolve(
    Response.json(status(suffix, marker)),
  ),
  reject: (index) => requests[index].reject(new Error("late previous session failure")),
};

createRoot(document.getElementById("root")).render(<Fixture />);
`;
}

async function buildSessionFixture(workspace: string) {
  const fixtureRoot = join(workspace, "fixture");
  const output = join(workspace, "dist");
  await mkdir(fixtureRoot, { recursive: true });
  await writeFile(
    join(fixtureRoot, "index.html"),
    '<!doctype html><html lang="ko"><body><div id="root"></div><script type="module" src="./src.tsx"></script></body></html>',
  );
  await writeFile(join(fixtureRoot, "src.tsx"), sessionFixtureSource());
  await build({
    root: fixtureRoot,
    base: "./",
    logLevel: "silent",
    build: { outDir: output, emptyOutDir: true },
  });
  return output;
}

async function serveSessionFixture(output: string) {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(
      new URL(request.url ?? "/", "http://fixture.local").pathname,
    );
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    if (relativePath.includes("..")) return void response.writeHead(400).end();
    void readFile(join(output, relativePath)).then((content) => {
      const contentType = relativePath.endsWith(".js")
        ? "text/javascript"
        : relativePath.endsWith(".css")
          ? "text/css"
          : "text/html; charset=utf-8";
      response.writeHead(200, {
        "content-type": contentType,
        "cache-control": "no-store",
      }).end(content);
    }).catch(() => response.writeHead(404).end());
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

test("panel fences authenticated sessions and aborts current status before same-session remount", async () => {
  const executablePath = await firstExecutable([
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ]);
  assert.ok(executablePath, "Qoo10 session-bound panel test requires local Chrome");
  const workspace = await mkdtemp(join(
    new URL(".", repositoryRoot).pathname,
    ".tmp-qoo10-review-session-",
  ));
  let browser;
  let server;
  try {
    const output = await buildSessionFixture(workspace);
    const served = await serveSessionFixture(output);
    server = served.server;
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--disable-background-networking", "--disable-default-apps", "--no-first-run"],
    });
    const page = await browser.newPage();
    await page.goto(served.url);
    await page.getByText("Qoo10 review·Buyer Chat 증거 상태").click();
    await page.waitForFunction("window.fixture.requests().length === 1");

    await page.evaluate("window.fixture.swap('second')");
    await page.waitForFunction(`() => {
      const requests = window.fixture.requests();
      return requests.length === 2 && requests[0].aborted;
    }`);
    await page.evaluate("window.fixture.resolveAccounts(0, 'a')");
    await page.waitForFunction("window.fixture.requests().length === 2");
    assert.doesNotMatch(await page.locator("body").innerText(), /QOOSESSIONA/u);
    assert.equal(await page.getByRole("button", { name: "조회 중…" }).isDisabled(), true);

    await page.evaluate("window.fixture.resolveAccounts(1, 'b')");
    await page.waitForFunction("document.body.innerText.includes('QOOSESSIONB')");
    await page.getByRole("button", { name: "review·Buyer Chat 증거 조회" }).click();
    await page.waitForFunction("window.fixture.requests().length === 3");

    await page.evaluate("window.fixture.swap('third')");
    await page.waitForFunction(`() => {
      const requests = window.fixture.requests();
      return requests.length === 4 && requests[2].aborted;
    }`);
    await page.evaluate("window.fixture.reject(2)");
    await page.waitForFunction("window.fixture.requests().length === 4");
    const pendingThirdText = await page.locator("body").innerText();
    assert.doesNotMatch(pendingThirdText, /QOOSESSIONB|증거 상태를 조회하지 못했습니다/u);
    assert.equal(await page.getByRole("button", { name: "조회 중…" }).isDisabled(), true);

    await page.evaluate("window.fixture.resolveAccounts(3, 'c')");
    await page.waitForFunction("document.body.innerText.includes('QOOSESSIONC')");
    await page.getByRole("button", { name: "review·Buyer Chat 증거 조회" }).click();
    await page.waitForFunction("window.fixture.requests().length === 5");
    await page.evaluate("window.fixture.resolveStatus(4, 'c')");
    await page.waitForFunction("document.body.innerText.includes('qsm-session-c-snapshot')");
    const finalText = await page.locator("body").innerText();
    assert.match(finalText, /QOOSESSIONC/u);
    assert.match(finalText, /qsm-session-c-snapshot/u);
    assert.doesNotMatch(finalText, /QOOSESSIONA|QOOSESSIONB|조회하지 못했습니다/u);

    await page.getByRole("button", { name: "review·Buyer Chat 증거 조회" }).click();
    await page.waitForFunction("window.fixture.requests().length === 6");
    await page.evaluate("window.fixture.unmount()");
    await page.waitForFunction("window.fixture.requests()[5].aborted === true");
    await page.evaluate("window.fixture.remount()");
    await page.getByText("Qoo10 review·Buyer Chat 증거 상태").click();
    await page.waitForFunction("window.fixture.requests().length === 7");
    await page.evaluate("window.fixture.resolveStatus(5, 'c', 'old-unmounted-success')");
    assert.doesNotMatch(
      await page.locator("body").innerText(),
      /qsm-session-old-unmounted-success-snapshot/u,
    );
    assert.equal(await page.getByRole("button", { name: "조회 중…" }).isDisabled(), true);
    await page.evaluate("window.fixture.resolveAccounts(6, 'c')");
    await page.waitForFunction("document.body.innerText.includes('QOOSESSIONC')");

    await page.getByRole("button", { name: "review·Buyer Chat 증거 조회" }).click();
    await page.waitForFunction("window.fixture.requests().length === 8");
    await page.evaluate("window.fixture.unmount()");
    await page.waitForFunction("window.fixture.requests()[7].aborted === true");
    await page.evaluate("window.fixture.remount()");
    await page.getByText("Qoo10 review·Buyer Chat 증거 상태").click();
    await page.waitForFunction("window.fixture.requests().length === 9");
    await page.evaluate("window.fixture.reject(7)");
    assert.doesNotMatch(
      await page.locator("body").innerText(),
      /증거 상태를 조회하지 못했습니다/u,
    );
    assert.equal(await page.getByRole("button", { name: "조회 중…" }).isDisabled(), true);
    await page.evaluate("window.fixture.resolveAccounts(8, 'c')");
    await page.waitForFunction("document.body.innerText.includes('QOOSESSIONC')");
    await page.getByRole("button", { name: "review·Buyer Chat 증거 조회" }).click();
    await page.waitForFunction("window.fixture.requests().length === 10");
    await page.evaluate("window.fixture.resolveStatus(9, 'c', 'remounted-current')");
    await page.waitForFunction(
      "document.body.innerText.includes('qsm-session-remounted-current-snapshot')",
    );
    const remountedText = await page.locator("body").innerText();
    assert.match(remountedText, /qsm-session-remounted-current-snapshot/u);
    assert.doesNotMatch(
      remountedText,
      /old-unmounted-success|조회하지 못했습니다/u,
    );
  } finally {
    await browser?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    await rm(workspace, { recursive: true, force: true });
  }
});
