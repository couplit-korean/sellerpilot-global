import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { assessQoo10WindowCompleteness } from "../lib/channels/cs/qoo10/contracts.ts";
import {
  planQoo10History,
  qoo10HistoryWindowKey,
  splitSaturatedQoo10Window,
} from "../lib/channels/cs/qoo10/history.ts";
import { qoo10HistoryExecutionRequests } from "../lib/channels/cs/qoo10/history-runtime.ts";

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create table qoo10_history_windows(
      window_key text primary key,
      parent_window_key text,
      source text not null,
      remote_status text,
      from_value text not null,
      to_value text not null,
      state text not null default 'queued',
      reason text,
      attempt_count integer not null default 0,
      check(state in ('queued','running','failed','succeeded','split','incomplete'))
    );
    create table qoo10_history_messages(
      seller_key text not null,
      inquiry_type text not null,
      question_no text not null,
      sequence_no text not null,
      latest_status text not null,
      identity_digest text not null,
      primary key(seller_key,inquiry_type,question_no,sequence_no)
    );
  `);
  return db;
}

function requestRow(request) {
  const meta = request.arguments.sellerpilotHistoryWindow;
  const params = request.arguments.params;
  return {
    windowKey: meta.windowKey,
    parentWindowKey: meta.parentWindowKey,
    source: meta.source,
    status: meta.status ?? null,
    from: params.search_start_dt ?? params.search_Sdate,
    to: params.search_end_dt ?? params.search_Edate,
  };
}

async function insertWindow(db, row) {
  await db.query(`insert into qoo10_history_windows
    (window_key,parent_window_key,source,remote_status,from_value,to_value)
    values($1,$2,$3,$4,$5,$6) on conflict(window_key) do nothing`, [
    row.windowKey, row.parentWindowKey, row.source, row.status, row.from, row.to,
  ]);
}

test("Qoo10 isolated history ledger preserves idempotent windows, split children, and resumable leaves", async () => {
  const db = await fixture();
  try {
    const requests = qoo10HistoryExecutionRequests("2026-09-01", "2026-09-01");
    for (const request of [...requests, ...requests]) await insertWindow(db, requestRow(request));
    assert.equal((await db.query("select count(*)::int n from qoo10_history_windows")).rows[0].n, 4);

    const root = planQoo10History("2026-09-01", "2026-09-01").inquiries[0];
    const completion = assessQoo10WindowCompleteness({
      providerSucceeded: true, rowCount: 100, observedRowLimit: 100,
    });
    assert.deepEqual(completion, { state: "incomplete", reason: "observed_row_limit_reached" });
    await db.query("update qoo10_history_windows set state='split',reason=$2 where window_key=$1", [
      qoo10HistoryWindowKey(root), completion.reason,
    ]);
    const children = splitSaturatedQoo10Window(root);
    for (const child of [...children, ...children]) {
      const params = child.params;
      await insertWindow(db, {
        windowKey: qoo10HistoryWindowKey(child),
        parentWindowKey: child.parentWindowKey,
        source: child.source,
        status: child.source === "qapi_inquiry" ? child.status : null,
        from: params.search_start_dt ?? params.search_Sdate,
        to: params.search_end_dt ?? params.search_Edate,
      });
    }
    assert.equal((await db.query("select count(*)::int n from qoo10_history_windows")).rows[0].n, 28);
    assert.equal((await db.query("select count(*)::int n from qoo10_history_windows where parent_window_key=$1", [
      qoo10HistoryWindowKey(root),
    ])).rows[0].n, 24);
    await db.query("update qoo10_history_windows set state='succeeded' where window_key=$1", [qoo10HistoryWindowKey(children[0])]);
    await db.query("update qoo10_history_windows set state='failed',attempt_count=1 where window_key=$1", [qoo10HistoryWindowKey(children[1])]);
    const resumable = (await db.query(`select window_key from qoo10_history_windows
      where state in ('queued','failed') and attempt_count<4 order by window_key`)).rows;
    assert.equal(resumable.length, 26);
    assert.ok(resumable.some((row) => row.window_key === qoo10HistoryWindowKey(children[1])));
    assert.ok(!resumable.some((row) => row.window_key === qoo10HistoryWindowKey(children[0])));
  } finally {
    await db.close();
  }
});

test("Qoo10 isolated message key upgrades duplicate status but never merges the same sequence across roots", async () => {
  const db = await fixture();
  try {
    const insert = (questionNo, status, digest) => db.query(`insert into qoo10_history_messages
      (seller_key,inquiry_type,question_no,sequence_no,latest_status,identity_digest)
      values('seller-fixture','MSG',$1,'501',$2,$3)
      on conflict(seller_key,inquiry_type,question_no,sequence_no) do update set
        latest_status=case
          when excluded.latest_status='S3' then excluded.latest_status
          when qoo10_history_messages.latest_status='S3' then qoo10_history_messages.latest_status
          when excluded.latest_status='S2' then excluded.latest_status
          else qoo10_history_messages.latest_status end,
        identity_digest=excluded.identity_digest`, [questionNo, status, digest]);
    await insert("500", "S1", "digest-a");
    await insert("500", "S3", "digest-a");
    await insert("502", "S2", "digest-b");
    const rows = (await db.query("select question_no,sequence_no,latest_status from qoo10_history_messages order by question_no")).rows;
    assert.deepEqual(rows, [
      { question_no: "500", sequence_no: "501", latest_status: "S3" },
      { question_no: "502", sequence_no: "501", latest_status: "S2" },
    ]);
  } finally {
    await db.close();
  }
});
