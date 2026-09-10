import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decideCoupangOrderLineage } from "../lib/cs/channels/coupang/order-lineage.ts";

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
  `${helpersModule}\nexport { fixture, currentDatabase, seed, coupangCredential, orderPayload, ingestOrder, ingestTicket, orderId, binding, OWNER };\n`,
).toString("base64")}`);

const integrationMigration = await readFile(new URL("../supabase/migrations/20260909123112_cs_coupang_order_revision_and_read_gate.sql", import.meta.url), "utf8");

async function workspaceTicket(db: Awaited<ReturnType<typeof helpers.currentDatabase>>, ticketId: string) {
  const snapshot = await helpers.fixture.scalar(db, "select public.sellerpilot_get_cs_workspace_snapshot()");
  return snapshot.tickets.find((ticket: { ticketId: string }) => ticket.ticketId === ticketId);
}

test("same-transaction order revisions transition exact to stale and every shared reader fails closed", async () => {
  const db = await helpers.currentDatabase();
  try {
    await helpers.seed(db);
    const credential = await helpers.coupangCredential(db, "a");
    await db.exec(await readFile(new URL("../supabase/migrations/20260908170140_isolate_cs_workspace_snapshot.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../supabase/migrations/20260908172414_isolate_cs_reply_draft_queue.sql", import.meta.url), "utf8"));
    // Unrelated Lazada dependency must never execute in this Coupang-only fixture.
    await db.exec("create function sellerpilot_private.lazada_im_ticket_projection_state_v1(uuid,timestamptz) returns text language plpgsql as $$begin raise exception 'unexpected Lazada call in Coupang-only fixture'; end$$");
    await db.exec(integrationMigration);

    const ticket = await helpers.ingestTicket(
      db, credential, "coupang", "coupang:revision:1", "REVISION-1",
    );
    assert.equal(await helpers.ingestOrder(
      db, credential, "coupang", helpers.orderPayload("REVISION-1"),
    ), 1);
    const orderId = await helpers.orderId(db, "REVISION-1");
    assert.deepEqual(await helpers.binding(db, ticket), {
      order_id: orderId,
      status: "exact",
      coupang_lineage_status: "exact",
    });

    await db.exec(`create table sellerpilot_private.test_coupang_binding_transitions(
      seq bigint generated always as identity,
      transaction_id bigint not null,
      status text not null,
      lineage_status text,
      evidence_fingerprint text not null
    );
    create function sellerpilot_private.capture_coupang_binding_transition()
    returns trigger language plpgsql set search_path='' as $$begin
      insert into sellerpilot_private.test_coupang_binding_transitions(
        transaction_id,status,lineage_status,evidence_fingerprint
      ) values(txid_current(),new.status,new.coupang_lineage_status,new.evidence_fingerprint);
      return new;
    end$$;
    create trigger capture_coupang_binding_transition after update
      on sellerpilot_private.cs_order_bindings for each row
      execute function sellerpilot_private.capture_coupang_binding_transition();`);

    await db.exec("begin");
    assert.equal(await helpers.ingestOrder(
      db, credential, "coupang", helpers.orderPayload("REVISION-1", {
        amount: 13000,
        amountKrw: 13000,
      }),
    ), 1);
    await db.exec(`create function sellerpilot_private.fail_second_lineage_revision()
      returns trigger language plpgsql as $$begin
        if new.external_order_id='REVISION-1' then
          raise exception 'synthetic second revision failure';
        end if;
        return new;
      end$$;
      create trigger fail_second_lineage_revision before update
        on sellerpilot_private.coupang_order_credential_lineage for each row
        execute function sellerpilot_private.fail_second_lineage_revision();`);
    assert.equal(await helpers.ingestOrder(
      db, credential, "coupang", helpers.orderPayload("REVISION-1", {
        amount: 14000,
        amountKrw: 14000,
      }),
    ), 1);
    await db.exec("commit");

    const transitions = (await db.query(`select transaction_id,status,lineage_status,evidence_fingerprint
      from sellerpilot_private.test_coupang_binding_transitions order by seq`)).rows;
    assert.equal(new Set(transitions.map((row) => row.transaction_id)).size, 1,
      "stale and rebound observations must come from one database transaction");
    assert.equal(transitions.some((row) => row.status === "exact"), true);
    assert.equal(transitions.at(-1)?.status, "unmatched");
    assert.equal(transitions.at(-1)?.lineage_status, "legacy_unknown");
    assert.ok(new Set(transitions.map((row) => row.evidence_fingerprint)).size >= 2);

    const revision = (await db.query(`select
        sellerpilot_private.coupang_order_revision_v1(orders.id) current_revision,
        lineage.order_revision lineage_revision,
        lineage.observed_at>=orders.updated_at timestamp_would_look_fresh,
        orders.owner_id,orders.external_order_id,
        lineage.source_credential_id,lineage.seller_account_key
      from sellerpilot_private.commerce_orders orders
      join sellerpilot_private.coupang_order_credential_lineage lineage
        on lineage.order_id=orders.id
      where orders.id=$1`, [orderId])).rows[0];
    assert.equal(revision.timestamp_would_look_fresh, true,
      "the old timestamp-only check would accept the failed second revision");
    assert.notEqual(revision.current_revision, revision.lineage_revision);
    assert.deepEqual(decideCoupangOrderLineage({
      ticketOwnerId: revision.owner_id,
      externalOrderReference: revision.external_order_id,
      expectedOrderRevision: revision.current_revision,
      ticketCredentialId: credential,
      ticketSellerAccountKey: revision.seller_account_key,
      candidates: [{
        id: orderId,
        ownerId: revision.owner_id,
        externalOrderId: revision.external_order_id,
        orderRevision: revision.lineage_revision,
        sourceCredentialId: revision.source_credential_id,
        sellerAccountKey: revision.seller_account_key,
      }],
    }), { state: "stale_order_lineage", orderId: null });
    assert.deepEqual(await helpers.binding(db, ticket), {
      order_id: null,
      status: "unmatched",
      coupang_lineage_status: "legacy_unknown",
    });

    assert.equal((await workspaceTicket(db, ticket)).orderId, null);
    assert.equal((await helpers.fixture.scalar(
      db, "select public.sellerpilot_get_ticket_reply_context_v2($1)", [ticket],
    )).order_id, null);
    const inboundKey = await helpers.fixture.scalar(
      db, "select latest_inbound_key from sellerpilot_private.support_tickets where id=$1", [ticket],
    );
    const jobId = "00000000-0000-4000-8000-000000008091";
    assert.equal(await helpers.fixture.scalar(db, `select public.sellerpilot_create_support_reply_job(
      $1,$2,$3,'ko-KR','polite')`, [jobId, ticket, inboundKey]), jobId);
    assert.equal((await db.query(
      "select request_payload->'order' order_context from sellerpilot_private.cs_reply_draft_jobs where id=$1",
      [jobId],
    )).rows[0].order_context, null);
    const directJobId = "00000000-0000-4000-8000-000000008092";
    assert.equal(await helpers.fixture.scalar(db, "select public.sellerpilot_create_cs_reply_draft($1,$2,$3,'ko-KR','polite')", [directJobId, ticket, inboundKey]), directJobId);
    assert.equal((await db.query("select request_payload->'order' order_context from sellerpilot_private.cs_reply_draft_jobs where id=$1", [directJobId])).rows[0].order_context, null);
    assert.equal((await db.query("select count(*)::integer n from sellerpilot_private.ai_cli_jobs where id in($1,$2)", [jobId,directJobId])).rows[0].n, 0);
    assert.deepEqual((await helpers.fixture.scalar(
      db, "select public.sellerpilot_read_cs_order_binding_health_v1()",
    )).groups, [{ channel: "coupang", status: "unmatched", count: 1 }]);

    const sharedAdmin = "88888888-8888-4888-8888-888888888888";
    await db.query("insert into auth.users(id,email) values($1,'shared-order@example.test')", [sharedAdmin]);
    await db.query("insert into sellerpilot_private.admin_users(user_id,display_name) values($1,'Shared admin')", [sharedAdmin]);
    await helpers.fixture.setClaims(db, "authenticated", sharedAdmin);
    assert.equal((await workspaceTicket(db, ticket)).orderId, null);
    const sharedJobId = "00000000-0000-4000-8000-000000008093";
    assert.equal(await helpers.fixture.scalar(db, "select public.sellerpilot_create_cs_reply_draft($1,$2,$3,'ko-KR','polite')", [sharedJobId, ticket, inboundKey]), sharedJobId);
    assert.equal((await db.query("select requested_by,request_payload->'order' order_context from sellerpilot_private.cs_reply_draft_jobs where id=$1", [sharedJobId])).rows[0].requested_by, sharedAdmin);
    for (const signature of [
      "public.sellerpilot_get_cs_workspace_snapshot()",
      "public.sellerpilot_get_ticket_reply_context_v2(uuid)",
      "public.sellerpilot_create_support_reply_job(uuid,uuid,text,text,text)",
      "public.sellerpilot_read_cs_order_binding_health_v1()",
    ]) {
      assert.equal(await helpers.fixture.scalar(
        db, "select has_function_privilege('authenticated',$1,'EXECUTE')", [signature],
      ), true);
      assert.equal(await helpers.fixture.scalar(
        db, "select has_function_privilege('anon',$1,'EXECUTE')", [signature],
      ), false);
      assert.equal(await helpers.fixture.scalar(
        db, "select has_function_privilege('service_role',$1,'EXECUTE')", [signature],
      ), false);
    }
  } finally {
    await db.close();
  }
});
