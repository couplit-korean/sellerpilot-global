import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildShipmentArguments } from "../lib/channels/shipment-draft";
import { executeChannelOperation } from "../lib/channels/operations";

const migration = new URL("../supabase/migrations/20260905142000_lazada_durable_order_item_ownership.sql", import.meta.url);
// Reuse the historical native-compatible migration chain, not a stub ingest.
// Its final ingest/fulfillment bodies MUST match the observed production md5s.
const fixtureUrl = new URL("./inquiry-reply-migration-dynamic.test.mjs", import.meta.url);
const fixtureSource = await readFile(fixtureUrl, "utf8");
const end = fixtureSource.indexOf('test("Smartstore product');
assert.ok(end > 0);
const fixtureModule = fixtureSource.slice(0, end)
  .replace('from "@electric-sql/pglite"', `from ${JSON.stringify(import.meta.resolve("@electric-sql/pglite"))}`)
  .replaceAll("import.meta.url", JSON.stringify(fixtureUrl.href));
const fixture = await import(`data:text/javascript;base64,${Buffer.from(fixtureModule + "\nexport { createDatabase, seedAdminAndCredential, setClaims, scalar, ADMIN_ID };\n").toString("base64")}`);

test("production-chain Lazada ownership preimages, physical seller conflicts, stale queued writes and lock-order fences", async () => {
  const db = await fixture.createDatabase();
  try {
    const qoo10 = await fixture.seedAdminAndCredential(db);
    const owner = fixture.ADMIN_ID;
    const secondOwner = "00000000-0000-4000-8000-000000000099";
    const source = await readFile(migration, "utf8");
    // The captured production ACL adds service_role to fulfillment readback
    // after this fixture's schema horizon. Apply that observed grant only;
    // function bodies remain the actual chain and are checked below.
    await db.exec("grant execute on function public.sellerpilot_get_order_fulfillment_context_v2(uuid[]) to service_role");
    const hashes = (await db.query(`select proname,md5(prosrc) hash from pg_proc where oid in (
      'public.sellerpilot_service_ingest_orders(uuid,text,jsonb)'::regprocedure,
      'public.sellerpilot_get_order_fulfillment_context_v2(uuid[])'::regprocedure) order by proname`)).rows;
    assert.deepEqual(hashes, [
      { proname: "sellerpilot_get_order_fulfillment_context_v2", hash: "7526114472f6b62aba3e225bb0d9e275" },
      { proname: "sellerpilot_service_ingest_orders", hash: "1a426cc962f53f230a4fa4e0f147d22e" },
    ]);
    const credential = async (subject: string, actor = owner) => {
      await fixture.setClaims(db, "service_role", actor);
      return fixture.scalar(db, `select public.sellerpilot_rotate_credential('lazada','production',$1::jsonb,now()+interval '180 days',90,30,0)`, [JSON.stringify({
        app_key: "local-only", app_secret: "local-only", country: "my", access_token: "local-only",
        provider_account_subject: `lazada:v1:${subject.repeat(60)}`, provider_account_identity_version: "v1",
      })]);
    };
    const cred = await credential("A");
    const payload = (id: string, items: string[]) => [{ externalOrderId: id, customerName: "Local fixture", productName: "Unlinked local fixture", quantity: 1, amount: 1, amountKrw: 0, currency: "MYR", status: "paid", orderedAt: "2026-09-05T01:00:00Z", providerContext: { orderId: id, orderItemIds: items, deliveryType: "dropship" } }];
    const ingest = (id: string, items: string[], cid = cred) => fixture.scalar(db, "select public.sellerpilot_service_ingest_orders($1,'lazada',$2::jsonb)", [cid, JSON.stringify(payload(id, items))]);
    const legacyOrders = [
      ["LEGACY", ["LEGACY-ITEM"]],
      ["LEGACY-PRESERVED", ["PRESERVED-ITEM"]],
      ["LEGACY-MULTI", ["MULTI-ONE", "MULTI-TWO"]],
      ["LEGACY-OTHER", ["OTHER-ITEM"]],
    ] as const;
    for (const [id, items] of legacyOrders) await ingest(id, [...items]);
    // Check every pre-existing column, not just quantity or the projected read.
    // Only the three newly introduced ownership columns may differ on install.
    const legacyEvidence = async () => (await db.query(`
      select to_jsonb(o) - array['lazada_source_credential_id',
        'lazada_seller_account_key', 'lazada_ownership_blocked'] as original
      from sellerpilot_private.commerce_orders o order by o.id
    `)).rows;
    const legacyBefore = await legacyEvidence();
    assert.equal(legacyBefore.length, 4);
    const pre = (await db.query("select count(*)::int n from sellerpilot_private.commerce_orders")).rows;
    await db.exec("grant execute on function public.sellerpilot_service_ingest_orders(uuid,text,jsonb) to authenticated");
    await assert.rejects(db.exec(source), /PREIMAGE_OR_ACL_MISMATCH/);
    await db.exec("rollback; revoke execute on function public.sellerpilot_service_ingest_orders(uuid,text,jsonb) from authenticated");
    assert.deepEqual((await db.query("select count(*)::int n from sellerpilot_private.commerce_orders")).rows, pre);
    await db.exec(source);
    assert.deepEqual(await legacyEvidence(), legacyBefore,
      "install must preserve all original order columns, including raw provider context");
    const row = async (id: string, own = owner) => (await db.query(`select * from sellerpilot_private.commerce_orders where external_order_id=$1 and owner_id=$2`, [id, own])).rows[0];
    const context = async (id: string, own = owner) => (await db.query("select * from public.sellerpilot_get_order_fulfillment_context_v2(array[$1::uuid])", [(await row(id, own)).id])).rows[0].provider_context;
    const blocked = async (id: string, own = owner) => {
      const ctx = await context(id, own);
      assert.deepEqual(ctx.orderItemIds, []);
      assert.throws(() => buildShipmentArguments({ channel: "lazada", externalOrderId: id, carrierCode: "FM49", trackingNumber: "", providerContext: ctx }), /SHIPMENT_PACKAGE_DETAILS_REQUIRED/);
    };
    for (const [id, items] of legacyOrders) {
      const legacy = await row(id);
      assert.equal(legacy.lazada_ownership_blocked, true);
      assert.equal(legacy.lazada_source_credential_id, null);
      assert.equal(legacy.lazada_seller_account_key, null);
      assert.deepEqual(legacy.provider_context, payload(id, [...items])[0].providerContext,
        "quarantine must not erase the stored source evidence");
      await blocked(id); // Fulfillment masks the source instead of deleting it.
    }
    assert.deepEqual(await legacyEvidence(), legacyBefore,
      "fulfillment reads must not rewrite stored evidence");
    await ingest("LEGACY", ["REPLACEMENT"]); await blocked("LEGACY");
    await ingest("FIRST", ["SHARED"]); await ingest("FIRST", ["SHARED"]);
    const stale = await context("FIRST");
    assert.deepEqual(stale.orderItemIds, ["SHARED"]);
    const first = await row("FIRST");
    // Exercise the exact new trigger function against a native-shaped isolated
    // job table so unrelated rollout/worker scheduling requirements do not mask
    // claim and mutation-marker checks. Real commerce/credentials remain intact.
    await db.exec("create table public.lazada_review_jobs (like sellerpilot_private.channel_gateway_jobs including defaults)");
    // Reuse both exact trigger declarations, including UPDATE OF semantics and
    // the marker argument. A hand-written catch-all test trigger masks this bug.
    const jobTriggers = source.match(/create trigger zzzz_guard_lazada_shipment_[\s\S]*?;/g) ?? [];
    assert.equal(jobTriggers.length, 2);
    for (const trigger of jobTriggers) {
      await db.exec(trigger.replace("on sellerpilot_private.channel_gateway_jobs", "on public.lazada_review_jobs"));
    }
    const installed = (await db.query("select tgname, tgattr::text columns from pg_trigger where tgrelid='sellerpilot_private.channel_gateway_jobs'::regclass and tgname like 'zzzz_guard_lazada_shipment_%' order by tgname")).rows;
    assert.equal(installed.length, 2);
    assert.ok(installed.every((trigger: { columns: string }) => trigger.columns.length > 0));
    // A caller holding the intact legacy source must still fail the real
    // shipment trigger. Current credential lineage cannot retroactively attest it.
    const preserved = await row("LEGACY-PRESERVED");
    const preservedContext = preserved.provider_context;
    for (const operation of ["shipment.confirm", "shipment.acknowledge"]) {
      await assert.rejects(db.query(`
        insert into public.lazada_review_jobs(credential_id,channel,operation,
          environment,request_payload,status,created_by,order_id,seller_account_key)
        values($1,'lazada',$2,'production',$3,'queued',$4,$5,$6)
      `, [cred, operation, JSON.stringify({ arguments: {
        orderId: preserved.external_order_id, providerContext: preservedContext,
      } }), owner, preserved.id, first.lazada_seller_account_key]),
      /LAZADA_SHIPMENT_CURRENT_OWNERSHIP_CONFLICT/);
    }
    assert.deepEqual((await row("LEGACY-PRESERVED")).provider_context, preservedContext);
    assert.equal(await fixture.scalar(db,
      "select count(*)::int from public.lazada_review_jobs where order_id=$1",
      [preserved.id]), 0);
    const jobId = "00000000-0000-4000-8000-000000000088";
    await db.query(`insert into public.lazada_review_jobs(id,credential_id,channel,operation,environment,request_payload,status,created_by,order_id,seller_account_key)
      values($1,$2,'lazada','shipment.confirm','production',$3,'queued',$4,$5,$6)`, [jobId, cred, JSON.stringify({ arguments: { orderId: "FIRST", providerContext: stale } }), owner, first.id, first.lazada_seller_account_key]);
    await db.query("update public.lazada_review_jobs set status='running' where id=$1", [jobId]);
    const repeatMarker = () => db.query("update public.lazada_review_jobs set provider_mutation_started_at=COALESCE(provider_mutation_started_at,clock_timestamp()) where id=$1", [jobId]);
    await repeatMarker();
    const markerBefore = (await db.query("select provider_mutation_started_at from public.lazada_review_jobs where id=$1", [jobId])).rows;
    await repeatMarker(); // Healthy repeated writes must remain valid.
    assert.deepEqual((await db.query("select provider_mutation_started_at from public.lazada_review_jobs where id=$1", [jobId])).rows, markerBefore);
    await db.query("update sellerpilot_private.commerce_orders set lazada_ownership_blocked=true where id=$1", [first.id]);
    await assert.rejects(repeatMarker(), /LAZADA_SHIPMENT_CURRENT_OWNERSHIP_CONFLICT/);
    assert.deepEqual((await db.query("select provider_mutation_started_at from public.lazada_review_jobs where id=$1", [jobId])).rows, markerBefore);
    await ingest("FIRST", []); // claims must outlive current context
    await ingest("SECOND", ["SHARED"]);
    await blocked("FIRST"); await blocked("SECOND");
    await assert.rejects(db.query("update public.lazada_review_jobs set provider_mutation_started_at=now() where id=$1", [jobId]), /LAZADA_SHIPMENT_CURRENT_OWNERSHIP_CONFLICT/);
    await db.query("update public.lazada_review_jobs set status='queued' where id=$1", [jobId]);
    await assert.rejects(db.query("update public.lazada_review_jobs set status='running' where id=$1", [jobId]), /LAZADA_SHIPMENT_CURRENT_OWNERSHIP_CONFLICT/);
    await ingest("FIRST", ["NEW"]); await blocked("FIRST");
    await db.query("insert into auth.users(id,email) values($1,'local-review@example.test')", [secondOwner]);
    await db.query("insert into sellerpilot_private.admin_users(user_id,display_name) values($1,'local review')", [secondOwner]);
    const sameSeller = await credential("A", secondOwner);
    await ingest("OTHER-OWNER", ["SHARED"], sameSeller);
    await blocked("OTHER-OWNER", secondOwner); await blocked("FIRST");
    const differentSeller = await credential("B", secondOwner);
    await ingest("OTHER-SELLER", ["SHARED"], differentSeller);
    assert.deepEqual((await context("OTHER-SELLER", secondOwner)).orderItemIds, ["SHARED"]);
    await fixture.setClaims(db, "service_role", owner);
    const rotated = await credential("A");
    await ingest("ROTATION", ["SHARED"], rotated); await blocked("ROTATION");
    await ingest("CLEAN", ["UNIQUE"], rotated);
    await db.query("update sellerpilot_private.commerce_orders set customer_name='ordinary metadata update' where id=$1", [(await row("CLEAN")).id]);
    assert.deepEqual((await context("CLEAN")).orderItemIds, ["UNIQUE"]);
    await assert.rejects(db.query(`update sellerpilot_private.commerce_orders set provider_context=$1 where id=$2`, [JSON.stringify(payload("CLEAN", ["FORGED"])[0].providerContext), (await row("CLEAN")).id]), /LAZADA_ITEM_CONTEXT_REQUIRES_INGEST/);
    // Combine the real marker trigger with the actual Lazada adapter. The only
    // simulated component is the remote response; no external HTTP is allowed.
    for (const scenario of ["ownership", "cancelled"] as const) {
      const orderId = `AFTER-PACK-${scenario}`;
      await ingest(orderId, [`ITEM-${scenario}`], rotated);
      const order = await row(orderId);
      const args = { orderId, carrierCode: "FM49", providerContext: await context(orderId) };
      const reviewJob = (await db.query(`insert into public.lazada_review_jobs(credential_id,channel,operation,environment,request_payload,status,created_by,order_id,seller_account_key)
        values($1,'lazada','shipment.confirm','production',$2,'running',$3,$4,$5) returning id`, [rotated, JSON.stringify({ arguments: args }), owner, order.id, order.lazada_seller_account_key])).rows[0].id;
      const originalFetch = globalThis.fetch;
      const paths: string[] = [];
      let begins = 0;
      globalThis.fetch = async (input) => {
        const path = new URL(String(input)).pathname;
        paths.push(path);
        if (path.endsWith("/providers/get")) return Response.json({ code: "0", result: { success: "true", data: { shipment_providers: [{ provider_code: "FM49" }], shipping_allocate_type: "TFS" } } });
        if (path.endsWith("/fulfill/pack")) {
          await db.query(scenario === "ownership"
            ? "update sellerpilot_private.commerce_orders set lazada_ownership_blocked=true where id=$1"
            : "update sellerpilot_private.commerce_orders set status='cancelled' where id=$1", [order.id]);
          return Response.json({ code: "0", result: { success: "true", data: { packages: [{ package_id: "LOCAL-PACK" }] } } });
        }
        throw new Error(`Unexpected remote request: ${path}`);
      };
      try {
        await assert.rejects(executeChannelOperation({ channel: "lazada", operation: "shipment.confirm", environment: "production",
          payload: { app_key: "local", app_secret: "local", access_token: "local", country: "my" }, arguments: args,
          providerMutationHooks: { assertLeaseHealthy: async () => {}, begin: async () => {
            begins += 1;
            await db.query("update public.lazada_review_jobs set provider_mutation_started_at=COALESCE(provider_mutation_started_at,clock_timestamp()) where id=$1", [reviewJob]);
          } },
        }), /LAZADA_SHIPMENT_CURRENT_OWNERSHIP_CONFLICT/);
        assert.equal(begins, 2);
        assert.deepEqual(paths, ["/rest/order/shipment/providers/get", "/rest/order/fulfill/pack"]);
      } finally { globalThis.fetch = originalFetch; }
    }
    const afterFunction = source.slice(source.indexOf("create function sellerpilot_private.lazada_record_order_item_claims"), source.indexOf("create trigger lazada_order_ownership_guard"));
    assert.doesNotMatch(afterFunction, /pg_advisory|update sellerpilot_private.commerce_orders/i);
    assert.match(source, /hashtextextended\('lazada:'\|\|c.seller_account_key,0\)/);
    assert.doesNotMatch(source, /hashtextextended\(c.created_by/);
    const ordinary = payload("QOO10-UNCHANGED", ["Q"]);
    await fixture.scalar(db, "select public.sellerpilot_service_ingest_orders($1,'qoo10',$2::jsonb)", [qoo10, JSON.stringify(ordinary)]);
    assert.deepEqual((await row("QOO10-UNCHANGED")).provider_context.orderItemIds, ["Q"]);
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal(await fixture.scalar(db,"select has_function_privilege($1,'public.sellerpilot_ingest_orders_pre_lazada_ownership(uuid,text,jsonb)','execute')",[role]),false);
      assert.equal(await fixture.scalar(db,"select has_table_privilege($1,'sellerpilot_private.lazada_order_item_claims','insert,update,delete')",[role]),false);
    }
  } finally { await db.close(); }
});
