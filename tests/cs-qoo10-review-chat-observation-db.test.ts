import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  projectQoo10ReviewChatStatus,
  qoo10ReviewChatAccountsSchema,
  qoo10ReviewChatObservationReadSchema,
  qoo10ReviewChatStatusSchema,
} from "../lib/cs/channels/qoo10/review-chat-contract";
import {
  qoo10InquirySourceReadSchema,
  type Qoo10InquirySourceRead,
} from "../lib/cs/channels/qoo10/source-capability";

const require = createRequire(import.meta.url);
const readMigration = (name: string) => readFile(
  new URL(`../supabase/migrations/${name}`, import.meta.url),
  "utf8",
);
const [credentialBase, sellerLineage, migration, routeSource, uiSource] = await Promise.all([
  readMigration("20260816060000_channel_credentials_and_roles.sql"),
  readMigration("20260825111800_bind_listing_seller_accounts.sql"),
  readMigration("20260910043000_cs_qoo10_review_chat_observation_ledger.sql"),
  readFile(new URL(
    "../app/api/admin/cs/channels/qoo10/review-chat/route.ts",
    import.meta.url,
  ), "utf8"),
  readFile(new URL(
    "../app/cs/channels/qoo10/review-chat-status.tsx",
    import.meta.url,
  ), "utf8"),
]);

function exactFragment(source: string, pattern: RegExp, label: string) {
  const match = source.match(pattern)?.[0];
  assert.ok(match, `missing canonical migration fragment: ${label}`);
  return match;
}

function functionStatement(source: string, qualifiedName: string) {
  const start = source.indexOf(`create or replace function ${qualifiedName}`);
  assert.ok(start >= 0, `missing function ${qualifiedName}`);
  const end = source.indexOf("\n$$;", start);
  assert.ok(end >= 0, `unterminated function ${qualifiedName}`);
  return source.slice(start, end + 4);
}

const canonical = {
  users: "create table auth.users(id uuid primary key)",
  adminTable: exactFragment(
    credentialBase,
    /create table if not exists sellerpilot_private\.admin_users \([\s\S]*?\n\);/u,
    "admin_users",
  ),
  credentialTable: exactFragment(
    credentialBase,
    /create table if not exists sellerpilot_private\.channel_credentials \([\s\S]*?\n\);/u,
    "channel_credentials",
  ),
  isAdmin: functionStatement(credentialBase, "public.sellerpilot_is_admin"),
  sellerColumns: exactFragment(
    sellerLineage,
    /alter table sellerpilot_private\.channel_credentials\n {2}add column if not exists seller_account_key text,[\s\S]*?seller_account_verified_at timestamptz;/u,
    "credential seller columns",
  ),
  sellerConstraint: exactFragment(
    sellerLineage,
    /alter table sellerpilot_private\.channel_credentials\n {2}drop constraint if exists channel_credentials_seller_account_key_check;[\s\S]*?\n {2}\);/u,
    "credential seller constraint",
  ),
  sellerSourceNotNull: exactFragment(
    sellerLineage,
    /alter table sellerpilot_private\.channel_credentials\n {2}alter column seller_account_key_source set not null;/u,
    "credential seller source not null",
  ),
};

const adminId = "00000000-0000-4000-8000-00000000d101";
const ownerA = "00000000-0000-4000-8000-00000000d102";
const ownerB = "00000000-0000-4000-8000-00000000d103";
const credentialA = "00000000-0000-4000-8000-00000000d104";
const credentialB = "00000000-0000-4000-8000-00000000d105";
const rotatedCredentialA = "00000000-0000-4000-8000-00000000d106";
const sellerA = "a".repeat(64);
const sellerB = "b".repeat(64);

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema sellerpilot_private; create schema extensions;
    ${canonical.users};
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create function extensions.digest(text,text) returns bytea language sql immutable
      as $$select sha256(convert_to($1,'UTF8'))$$;
    ${canonical.adminTable}
    ${canonical.credentialTable}
    ${canonical.sellerColumns}
    ${canonical.sellerConstraint}
    ${canonical.sellerSourceNotNull}
    ${canonical.isAdmin}
  `);
  await db.exec(migration);
  await db.query("insert into auth.users values($1),($2),($3)", [
    adminId,
    ownerA,
    ownerB,
  ]);
  await db.query(
    "insert into sellerpilot_private.admin_users(user_id,display_name) values($1,'admin')",
    [adminId],
  );
  await db.query(`insert into sellerpilot_private.channel_credentials(
    id,channel,environment,version,vault_secret_id,fingerprint,status,expires_at,
    rotation_interval_days,warning_days,last_rotated_at,created_by,created_at,
    seller_account_key,seller_account_key_source,seller_account_verified_at
  ) values
    ($1,'qoo10','production',1,$3,'QOOACCOUNT01','active',
      clock_timestamp()+interval '1 day',90,30,clock_timestamp(),$5,
      clock_timestamp(),$7,'provider_certified_v1',clock_timestamp()),
    ($2,'qoo10','production',2,$4,'QOOACCOUNT02','active',
      clock_timestamp()+interval '1 day',90,30,clock_timestamp(),$6,
      clock_timestamp(),$8,'credential_incarnation_v1',clock_timestamp())`, [
    credentialA,
    credentialB,
    "00000000-0000-4000-8000-00000000d111",
    "00000000-0000-4000-8000-00000000d112",
    ownerA,
    ownerB,
    sellerA,
    sellerB,
  ]);
  return db;
}

function artifact(suffix = "1") {
  return {
    contract: "sellerpilot-qoo10-review-chat-source-artifact/1",
    sourceKind: "authenticated_qsm_seller_ui",
    artifactId: `qsm-review-snapshot:${suffix}`,
    sha256: suffix.padEnd(64, suffix).slice(0, 64),
  };
}

function observation(input: {
  expired?: boolean;
  reviewState?: "unknown" | "verified_zero" | "imported_reconciled";
  buyerChatState?: "unknown" | "verified_zero";
} = {}) {
  const reviewState = input.reviewState ?? "verified_zero";
  return {
    contract: "sellerpilot-qoo10-review-chat-recording/1",
    observedAt: input.expired
      ? new Date(Date.now() - 20 * 60_000).toISOString()
      : new Date(Date.now() - 60_000).toISOString(),
    validUntil: input.expired
      ? new Date(Date.now() - 5 * 60_000).toISOString()
      : new Date(Date.now() + 9 * 60_000).toISOString(),
    sellerDashboardVisible: true,
    buyerInquirySummaryVisible: true,
    reviewHistoryVisible: reviewState !== "unknown",
    reviewNavigationResult: reviewState === "unknown"
      ? "redirected_to_login"
      : "history_visible",
    review: reviewState === "verified_zero"
      ? { historyState: reviewState, observedCount: 0, importedCount: 0, reconciledCount: 0 }
      : reviewState === "imported_reconciled"
        ? { historyState: reviewState, observedCount: 4, importedCount: 4, reconciledCount: 4 }
        : { historyState: reviewState, observedCount: null, importedCount: 0, reconciledCount: 0 },
    buyerChatHistoryVisible: input.buyerChatState === "verified_zero",
    buyerChatNavigationResult: input.buyerChatState === "verified_zero"
      ? "history_visible"
      : "unavailable",
    buyerChat: input.buyerChatState === "verified_zero"
      ? { historyState: "verified_zero", observedCount: 0, importedCount: 0, reconciledCount: 0 }
      : { historyState: "unknown", observedCount: null, importedCount: 0, reconciledCount: 0 },
  };
}

async function asService<T>(
  db: PGlite,
  callback: () => Promise<T>,
) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  await db.exec("set role service_role");
  try {
    return await callback();
  } finally {
    await db.exec("reset role");
  }
}

async function record(
  db: PGlite,
  credentialId: string,
  revision: number,
  sourceArtifact = artifact(String(revision)),
  value = observation(),
) {
  return asService(db, async () => (
    await db.query(
      `select public.sellerpilot_service_record_qoo10_review_chat_observation_v1(
        $1,$2,$3::jsonb,$4::jsonb
      ) result`,
      [credentialId, revision, JSON.stringify(sourceArtifact), JSON.stringify(value)],
    )
  ).rows[0]!.result);
}

async function asAdmin(db: PGlite) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [adminId]);
  await db.exec("set role authenticated");
}

async function rpc(db: PGlite, name: string, args?: Record<string, unknown>) {
  if (name === "sellerpilot_read_qoo10_review_chat_accounts_v1") {
    return (await db.query(
      "select public.sellerpilot_read_qoo10_review_chat_accounts_v1() result",
    )).rows[0]!.result;
  }
  if (name === "sellerpilot_read_qoo10_review_chat_observation_v1") {
    return (await db.query(
      "select public.sellerpilot_read_qoo10_review_chat_observation_v1($1) result",
      [args?.p_credential_id],
    )).rows[0]!.result;
  }
  if (name === "sellerpilot_read_qoo10_inquiry_source_v1") {
    const credentialId = String(args?.p_credential_id ?? "");
    return inquirySourceRead(
      credentialId,
      credentialId === credentialA ? sellerA : sellerB,
    );
  }
  throw new Error(`unexpected RPC ${name}`);
}

function inquirySourceRead(
  credentialId: string,
  sellerAccountKeyHash: string,
): Qoo10InquirySourceRead {
  return {
    contract: "sellerpilot-qoo10-inquiry-source-read/1",
    checkedAt: new Date().toISOString(),
    credentialId,
    sellerAccountKeyHash,
    environment: "production",
    scopeState: "account_scoped",
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
      windowCount: 0,
      queuedWindowCount: 0,
      completeWindowCount: 0,
      refiningWindowCount: 0,
      gapWindowCount: 0,
      verifiedZeroWindowCount: 0,
      positiveCompleteWindowCount: 0,
      earliestCalendarDate: null,
      latestCalendarDate: null,
      lastUpdatedAt: null,
    },
  };
}

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

function loadRoute(db: PGlite, adminResponse?: Response) {
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
        authenticateAdminRequest: async () => adminResponse ?? ({
          user: { id: adminId },
          userClient: {
            rpc: async (rpcName: string, args?: Record<string, unknown>) => {
              calls.push({ name: rpcName, args });
              try {
                return { data: await rpc(db, rpcName, args), error: null };
              } catch (error) {
                return { data: null, error };
              }
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

function renderSummary(status: unknown) {
  const transpiledUi = ts.transpileModule(uiSource, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  });
  assert.equal(
    transpiledUi.diagnostics?.filter(
      item => item.category === ts.DiagnosticCategory.Error,
    ).length ?? 0,
    0,
  );
  const exportsObject: Record<string, unknown> = {};
  const sandbox = vm.createContext({
    exports: exportsObject,
    URLSearchParams,
    AbortController,
    require(name: string) {
      if (name === "react") return React;
      if (name === "react/jsx-runtime") return require("react/jsx-runtime");
      if (name.endsWith("/review-chat-contract")) {
        return {
          qoo10ReviewChatAccountsSchema,
          qoo10ReviewChatObservationReadSchema,
          qoo10ReviewChatStatusSchema,
        };
      }
      if (name.endsWith(".module.css")) {
        return { __esModule: true, default: { messages: "messages" } };
      }
      throw new Error(`unexpected UI import ${name}`);
    },
  });
  vm.runInContext(transpiledUi.outputText, sandbox);
  const Summary = exportsObject.Qoo10ReviewChatStatusSummary as React.ComponentType<{
    status: ReturnType<typeof qoo10ReviewChatStatusSchema.parse>;
  }>;
  return renderToStaticMarkup(React.createElement(
    Summary,
    { status: qoo10ReviewChatStatusSchema.parse(status) },
  ));
}

test("two accounts stay isolated and canonical DB GET renders only the selected account evidence", async () => {
  const db = await fixture();
  try {
    await record(db, credentialA, 1);
    await record(db, credentialB, 1, artifact("b"), observation({ expired: true }));
    await asAdmin(db);

    const accounts = qoo10ReviewChatAccountsSchema.parse(await rpc(
      db,
      "sellerpilot_read_qoo10_review_chat_accounts_v1",
    ));
    assert.deepEqual(
      new Set(accounts.accounts.map(item => item.credentialId)),
      new Set([credentialA, credentialB]),
    );
    const route = loadRoute(db);
    const response = await route.GET(new Request(
      `https://sellerpilot.invalid/review-chat?view=status&credentialId=${credentialA}`,
    ));
    assert.equal(response.status, 200);
    const status = qoo10ReviewChatStatusSchema.parse(await response.json());
    assert.equal(status.account.credentialId, credentialA);
    assert.equal(status.account.sellerAccountKeyHash, sellerA);
    assert.equal(status.observationState, "current");
    assert.equal(status.review.historyState, "verified_zero");
    assert.equal(status.buyerChat.supportState, "unsupported");
    assert.equal(status.ordinaryInquiry.evidenceState, "not_observed");
    assert.equal(status.customerActionsAvailable, false);
    assert.deepEqual(route.calls.map(call => call.name), [
      "sellerpilot_read_qoo10_review_chat_accounts_v1",
      "sellerpilot_read_qoo10_review_chat_observation_v1",
      "sellerpilot_read_qoo10_inquiry_source_v1",
    ]);

    const html = renderSummary(status);
    assert.match(html, /불변 revision/u);
    assert.match(html, /qsm-review-snapshot:1/u);
    assert.match(html, /원격 0건 확인/u);
    assert.match(html, /자동 수신 미지원/u);
    assert.match(html, /브라우저 기록 API 없음/u);

    const expiredRead = qoo10ReviewChatObservationReadSchema.parse(await rpc(
      db,
      "sellerpilot_read_qoo10_review_chat_observation_v1",
      { p_credential_id: credentialB },
    ));
    const expiredStatus = projectQoo10ReviewChatStatus({
      expectedAccount: accounts.accounts.find(
        item => item.credentialId === credentialB,
      ),
      runtimeRead: expiredRead,
      inquirySourceRead: inquirySourceRead(credentialB, sellerB),
    });
    assert.equal(expiredStatus.observationState, "expired");
    assert.equal(expiredStatus.review.supportState, "unsupported");
    assert.equal(expiredStatus.review.observedCount, null);
  } finally {
    await db.close();
  }
});

test("credential rotation and revocation never transfer an old observation", async () => {
  const db = await fixture();
  try {
    await record(db, credentialA, 1);
    await db.query(
      "update sellerpilot_private.channel_credentials set status='revoked' where id=$1",
      [credentialA],
    );
    await db.query(`insert into sellerpilot_private.channel_credentials(
      id,channel,environment,version,vault_secret_id,fingerprint,status,expires_at,
      rotation_interval_days,warning_days,last_rotated_at,created_by,created_at,
      seller_account_key,seller_account_key_source,seller_account_verified_at
    ) values($1,'qoo10','production',3,$2,'QOOROTATED001','active',
      clock_timestamp()+interval '1 day',90,30,clock_timestamp(),$3,
      clock_timestamp(),$4,'provider_certified_v1',clock_timestamp())`, [
      rotatedCredentialA,
      "00000000-0000-4000-8000-00000000d113",
      ownerA,
      sellerA,
    ]);
    await asAdmin(db);
    const oldRead = qoo10ReviewChatObservationReadSchema.parse(await rpc(
      db,
      "sellerpilot_read_qoo10_review_chat_observation_v1",
      { p_credential_id: credentialA },
    ));
    const newRead = qoo10ReviewChatObservationReadSchema.parse(await rpc(
      db,
      "sellerpilot_read_qoo10_review_chat_observation_v1",
      { p_credential_id: rotatedCredentialA },
    ));
    assert.equal(oldRead.account.credentialState, "revoked");
    assert.ok(oldRead.evidence);
    assert.equal(newRead.account.credentialState, "active");
    assert.equal(newRead.observationState, "no_evidence");
    assert.equal(newRead.evidence, null);

    await assert.rejects(
      record(db, credentialA, 2),
      /QOO10_REVIEW_CHAT_CREDENTIAL_BINDING_INVALID/u,
    );
  } finally {
    await db.close();
  }
});

test("recording is service-only, immutable, sequential, and cannot claim import or Buyer Chat", async () => {
  const db = await fixture();
  try {
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await db.query(
        `select has_function_privilege(
          $1,
          'public.sellerpilot_service_record_qoo10_review_chat_observation_v1(uuid,bigint,jsonb,jsonb)',
          'EXECUTE'
        ) ok`,
        [role],
      )).rows[0]!.ok, false);
    }
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal((await db.query(
        `select has_table_privilege(
          $1,
          'sellerpilot_private.qoo10_review_chat_observations',
          'INSERT,UPDATE,DELETE'
        ) ok`,
        [role],
      )).rows[0]!.ok, false);
    }
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [adminId]);
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query(
        `select public.sellerpilot_service_record_qoo10_review_chat_observation_v1(
          $1,1,$2::jsonb,$3::jsonb
        )`,
        [credentialA, JSON.stringify(artifact()), JSON.stringify(observation())],
      ),
      /permission denied/u,
    );
    await db.exec("reset role");

    const firstArtifact = artifact();
    const firstObservation = observation();
    const first = await record(
      db,
      credentialA,
      1,
      firstArtifact,
      firstObservation,
    );
    assert.equal(first.status, "recorded");
    assert.equal(first.permissionsGranted, false);
    assert.equal((await record(
      db,
      credentialA,
      1,
      firstArtifact,
      firstObservation,
    )).status, "already_recorded");
    await assert.rejects(
      record(db, credentialA, 1, artifact("2")),
      /QOO10_REVIEW_CHAT_SOURCE_REVISION_IMMUTABLE/u,
    );
    await assert.rejects(
      record(db, credentialA, 3),
      /QOO10_REVIEW_CHAT_SOURCE_REVISION_SEQUENCE_INVALID/u,
    );
    await assert.rejects(
      record(db, credentialA, 2, artifact("3"), observation({
        reviewState: "imported_reconciled",
      })),
      /QOO10_REVIEW_CHAT_REVIEW_OBSERVATION_INVALID/u,
    );
    await assert.rejects(
      record(db, credentialA, 2, artifact("4"), observation({
        buyerChatState: "verified_zero",
      })),
      /QOO10_REVIEW_CHAT_OBSERVATION_INVALID|QOO10_BUYER_CHAT_OBSERVATION_UNVERIFIED/u,
    );

    await assert.rejects(
      db.query(
        "update sellerpilot_private.qoo10_review_chat_observations set source_revision=2",
      ),
      /QOO10_REVIEW_CHAT_OBSERVATION_IMMUTABLE/u,
    );
  } finally {
    await db.close();
  }
});

test("unauthenticated GET and forged account selection fail before evidence disclosure", async () => {
  const db = await fixture();
  try {
    const unauthorized = loadRoute(
      db,
      Response.json({ code: "UNAUTHORIZED" }, { status: 401 }),
    );
    const unauthorizedResponse = await unauthorized.GET(new Request(
      `https://sellerpilot.invalid/review-chat?view=status&credentialId=${credentialA}`,
    ));
    assert.equal(unauthorizedResponse.status, 401);
    assert.equal(unauthorized.calls.length, 0);

    await asAdmin(db);
    const route = loadRoute(db);
    const forged = await route.GET(new Request(
      "https://sellerpilot.invalid/review-chat?view=status&credentialId=00000000-0000-4000-8000-00000000d199",
    ));
    assert.equal(forged.status, 409);
    assert.deepEqual(route.calls.map(call => call.name), [
      "sellerpilot_read_qoo10_review_chat_accounts_v1",
    ]);
  } finally {
    await db.close();
  }
});
