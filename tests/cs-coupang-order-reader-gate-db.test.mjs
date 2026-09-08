import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const lineageTestUrl = new URL("./cs-coupang-order-lineage-db.test.mjs", import.meta.url);
const lineageSource = await readFile(lineageTestUrl, "utf8");
const helpersEnd = lineageSource.indexOf('test("production wrapper');
assert.ok(helpersEnd > 0);
const helpersModule = lineageSource.slice(0, helpersEnd)
  .replaceAll('"import.meta.url"', '"__IMPORT_META_URL_LITERAL__"')
  .replace(
    'import.meta.resolve("@electric-sql/pglite")',
    JSON.stringify(import.meta.resolve("@electric-sql/pglite")),
  )
  .replaceAll("import.meta.url", JSON.stringify(lineageTestUrl.href))
  .replaceAll('"__IMPORT_META_URL_LITERAL__"', '"import.meta.url"');
const helpers = await import(`data:text/javascript;base64,${Buffer.from(
  `${helpersModule}\nexport { fixture, currentDatabase, seed, coupangCredential, orderPayload, ingestOrder, ingestTicket, orderId, binding, OWNER, proposal };\n`,
).toString("base64")}`);

const readerGate = await readFile(new URL(
  "../docs/cs-parallel/proposals/coupang/patches/009-coupang-exact-order-reader-gate.sql",
  import.meta.url,
), "utf8");

async function workspaceTicket(db, ticketId) {
  const result = await helpers.fixture.scalar(
    db, "select public.sellerpilot_get_cs_workspace_snapshot()",
  );
  return result.tickets.find((ticket) => ticket.ticketId === ticketId);
}

async function replyContext(db, ticketId) {
  return helpers.fixture.scalar(
    db, "select public.sellerpilot_get_ticket_reply_context_v2($1)", [ticketId],
  );
}

async function health(db) {
  return helpers.fixture.scalar(
    db, "select public.sellerpilot_read_cs_order_binding_health_v1()",
  );
}

async function createDraftJob(db, ticketId, inboundKey, jobId) {
  assert.equal(await helpers.fixture.scalar(db, `select public.sellerpilot_create_support_reply_job(
    $1,$2,$3,'ko-KR','polite')`, [jobId, ticketId, inboundKey]), jobId);
  return (await db.query(`select request_payload
    from sellerpilot_private.ai_cli_jobs where id=$1`, [jobId])).rows[0].request_payload;
}

async function auditHasOrder(db, jobId) {
  return helpers.fixture.scalar(db, `select (safe_detail->>'has_order_context')::boolean
    from sellerpilot_private.ai_cli_audit
    where job_id=$1 and action='job_queued'`, [jobId]);
}

test("legacy physical link is hidden from workspace, detail, AI draft, and health until exact rebind", async () => {
  const db = await helpers.currentDatabase();
  try {
    await helpers.seed(db);
    const credential = await helpers.coupangCredential(db, "a");
    assert.equal(await helpers.ingestOrder(
      db, credential, "coupang", helpers.orderPayload("READER-LEGACY-1"),
    ), 1);
    const ticket = await helpers.ingestTicket(
      db, credential, "coupang", "coupang:reader:legacy:1", "READER-LEGACY-1",
    );
    const orderId = await helpers.orderId(db, "READER-LEGACY-1");
    const inboundKey = await helpers.fixture.scalar(db, `select latest_inbound_key
      from sellerpilot_private.support_tickets where id=$1`, [ticket]);
    await db.exec(helpers.proposal);

    assert.equal(await helpers.fixture.scalar(db, `select sellerpilot_private.cs_order_binding_is_exact(
      $1,'coupang','READER-LEGACY-1',$2,$3)`, [helpers.OWNER, credential, orderId]), false);
    assert.equal((await workspaceTicket(db, ticket)).orderId, orderId);
    assert.equal((await replyContext(db, ticket)).order_id, orderId);
    assert.deepEqual((await health(db)).groups, [
      { channel: "coupang", status: "exact", count: 1 },
    ]);
    const leaked = await createDraftJob(
      db, ticket, inboundKey, "00000000-0000-4000-8000-000000008001",
    );
    assert.equal(leaked.order.external_order_id, "READER-LEGACY-1");
    assert.equal(await auditHasOrder(
      db, "00000000-0000-4000-8000-000000008001",
    ), true);

    await db.exec(readerGate);
    assert.equal((await workspaceTicket(db, ticket)).orderId, null);
    assert.equal((await replyContext(db, ticket)).order_id, null);
    assert.deepEqual((await health(db)).groups, [
      { channel: "coupang", status: "unmatched", count: 1 },
    ]);
    const gated = await createDraftJob(
      db, ticket, inboundKey, "00000000-0000-4000-8000-000000008002",
    );
    assert.equal(gated.order, null);
    assert.equal(await auditHasOrder(
      db, "00000000-0000-4000-8000-000000008002",
    ), false);
    assert.deepEqual(await helpers.binding(db, ticket), {
      order_id: orderId,
      status: "exact",
      coupang_lineage_status: null,
    }, "reader gate must not bulk-clear the physical legacy link");

    assert.equal(await helpers.ingestOrder(
      db, credential, "coupang", helpers.orderPayload("READER-LEGACY-1"),
    ), 1);
    assert.equal((await workspaceTicket(db, ticket)).orderId, orderId);
    assert.equal((await replyContext(db, ticket)).order_id, orderId);
    assert.deepEqual((await health(db)).groups, [
      { channel: "coupang", status: "exact", count: 1 },
    ]);
    const exact = await createDraftJob(
      db, ticket, inboundKey, "00000000-0000-4000-8000-000000008003",
    );
    assert.equal(exact.order.external_order_id, "READER-LEGACY-1");
    assert.equal(await auditHasOrder(
      db, "00000000-0000-4000-8000-000000008003",
    ), true);
  } finally {
    await db.close();
  }
});

test("non-Coupang workspace, detail, AI order context, and health remain unchanged", async () => {
  const db = await helpers.currentDatabase({ applyProposal: true });
  try {
    const credential = await helpers.seed(db);
    assert.equal(await helpers.ingestOrder(
      db, credential, "qoo10", helpers.orderPayload("READER-QOO10-1"),
    ), 1);
    const ticket = await helpers.ingestTicket(
      db, credential, "qoo10", "qoo10:reader:1", "READER-QOO10-1",
    );
    const inboundKey = await helpers.fixture.scalar(db, `select latest_inbound_key
      from sellerpilot_private.support_tickets where id=$1`, [ticket]);
    const before = {
      workspace: await workspaceTicket(db, ticket),
      context: await replyContext(db, ticket),
      health: (await health(db)).groups,
      draft: await createDraftJob(
        db, ticket, inboundKey, "00000000-0000-4000-8000-000000008011",
      ),
    };
    await db.exec(readerGate);
    const after = {
      workspace: await workspaceTicket(db, ticket),
      context: await replyContext(db, ticket),
      health: (await health(db)).groups,
      draft: await createDraftJob(
        db, ticket, inboundKey, "00000000-0000-4000-8000-000000008012",
      ),
    };
    assert.deepEqual(after, before);
    assert.equal(after.draft.order.external_order_id, "READER-QOO10-1");
    assert.deepEqual(after.health, [
      { channel: "qoo10", status: "exact", count: 1 },
    ]);

    for (const signature of [
      "public.sellerpilot_get_cs_workspace_snapshot()",
      "public.sellerpilot_get_ticket_reply_context_v2(uuid)",
      "public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)",
      "public.sellerpilot_read_cs_order_binding_health_v1()",
    ]) {
      assert.equal(await helpers.fixture.scalar(db,
        "select has_function_privilege('authenticated',$1,'EXECUTE')", [signature]), true);
      assert.equal(await helpers.fixture.scalar(db,
        "select has_function_privilege('anon',$1,'EXECUTE')", [signature]), false);
      assert.equal(await helpers.fixture.scalar(db,
        "select has_function_privilege('service_role',$1,'EXECUTE')", [signature]), false);
    }
    assert.equal(await helpers.fixture.scalar(db, `select has_function_privilege(
      'authenticated','sellerpilot_private.coupang_cs_order_read_is_exact_v1(uuid)','EXECUTE')`), false);
  } finally {
    await db.close();
  }
});

test("reader preimage drift aborts before any wrapper rename", async () => {
  const db = await helpers.currentDatabase({ applyProposal: true });
  try {
    await db.exec(`create or replace function public.sellerpilot_get_ticket_reply_context_v2(p_id uuid)
      returns jsonb language sql stable security definer set search_path=''
      as $$select null::jsonb$$`);
    await assert.rejects(
      db.exec(readerGate), /COUPANG_CS_ORDER_READER_GATE_PREIMAGE_OR_ACL_MISMATCH/u,
    );
    await db.exec("rollback");
    assert.equal(await helpers.fixture.scalar(db, `select to_regprocedure(
      'public.sellerpilot_get_cs_workspace_snapshot_pre_coupang_order_gate_v1()') is null`), true);
  } finally {
    await db.close();
  }
});
