import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixtureUrl = new URL("./inquiry-reply-migration-dynamic.test.mjs", import.meta.url);
const fixtureSource = await readFile(fixtureUrl, "utf8");
const fixtureEnd = fixtureSource.indexOf('test("Smartstore product');
assert.ok(fixtureEnd > 0);
const fixtureModule = fixtureSource.slice(0, fixtureEnd)
  .replace(
    'from "@electric-sql/pglite"',
    `from ${JSON.stringify(import.meta.resolve("@electric-sql/pglite"))}`,
  )
  .replaceAll("import.meta.url", JSON.stringify(fixtureUrl.href));
const fixture = await import(`data:text/javascript;base64,${Buffer.from(
  `${fixtureModule}\nexport { createDatabase, seedAdminAndCredential, setClaims, scalar, ADMIN_ID };\n`,
).toString("base64")}`);

const lazadaMigration = await readFile(new URL(
  "../supabase/migrations/20260905142000_lazada_durable_order_item_ownership.sql",
  import.meta.url,
), "utf8");
const commonMigration = await readFile(new URL(
  "../supabase/migrations/20260908001000_harden_cs_commerce_boundaries.sql",
  import.meta.url,
), "utf8");
const proposal = await readFile(new URL(
  "../supabase/migrations/20260909123112_cs_coupang_order_revision_and_read_gate.sql",
  import.meta.url,
), "utf8");

// The reduced CS fixture stops before the production pre-Temu wrapper body was
// restored. Recreate that exact repository-defined body so every hash in the
// tested Lazada -> Shopee -> Temu -> base chain matches the observed baseline.
const productionPreTemu = String.raw`
create or replace function public.sellerpilot_service_ingest_orders_pre_temu_fulfillment(
  p_credential_id uuid,p_channel text,p_orders jsonb
) returns integer
language plpgsql
security definer
set search_path=pg_catalog,public,sellerpilot_private
as $$
declare v_count integer; v_order jsonb; v_owner uuid;
begin
  v_count:=public.sellerpilot_service_ingest_orders_pre_v2(p_credential_id,p_channel,p_orders);
  select created_by into v_owner from sellerpilot_private.channel_credentials where id=p_credential_id and channel=p_channel;
  for v_order in select value from jsonb_array_elements(p_orders) loop
    update sellerpilot_private.commerce_orders set last_seen_at=now(),
      delivered_at=case when v_order->>'status'='delivered' then coalesce(delivered_at,now()) else delivered_at end,
      updated_at=now()
    where owner_id=v_owner and channel_key=p_channel and external_order_id=v_order->>'externalOrderId';
  end loop;
  return v_count;
end;
$$;
revoke all on function public.sellerpilot_service_ingest_orders_pre_temu_fulfillment(uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_service_ingest_orders_pre_temu_fulfillment(uuid,text,jsonb)
  to service_role;
`;

const OWNER = fixture.ADMIN_ID;

async function currentDatabase({ applyProposal = false } = {}) {
  const db = await fixture.createDatabase();
  await db.exec(productionPreTemu);
  await db.exec(
    "grant execute on function public.sellerpilot_get_order_fulfillment_context_v2(uuid[]) to service_role",
  );
  await db.exec(lazadaMigration);
  await db.exec(commonMigration);
  await db.exec(await readFile(new URL("../supabase/migrations/20260908170140_isolate_cs_workspace_snapshot.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/20260908172414_isolate_cs_reply_draft_queue.sql", import.meta.url), "utf8"));
  // Unrelated channel guard must not run in this fixture.
  await db.exec("create function sellerpilot_private.lazada_im_ticket_projection_state_v1(uuid,timestamptz) returns text language plpgsql as $$begin raise exception 'unexpected Lazada call'; end$$");
  if (applyProposal) await db.exec(proposal);
  return db;
}

async function seed(db) {
  const qoo10 = await fixture.seedAdminAndCredential(db);
  await fixture.setClaims(db, "authenticated", OWNER);
  return qoo10;
}

async function coupangCredential(db, suffix, {
  sellerKey = suffix.toLowerCase().repeat(64).slice(0, 64),
  source = "provider_certified_v1",
  expires = "30 days",
} = {}) {
  await fixture.setClaims(db, "authenticated", OWNER);
  const id = await fixture.scalar(db, `select public.sellerpilot_rotate_credential(
    'coupang','production',$1::jsonb,now()+$2::interval,90,30,0
  )`, [JSON.stringify({
    access_key: `local-${suffix}`,
    secret_key: `local-${suffix}`,
    vendor_id: `LOCAL-${suffix}`,
  }), expires]);
  // The production catalog already contains provider-certified Coupang rows,
  // while the reduced historical fixture can only derive incarnation lineage
  // for static credentials. Seed that observed row shape without weakening the
  // guard for any operation under test.
  await db.exec(`alter table sellerpilot_private.channel_credentials
    disable trigger guard_credential_seller_lineage`);
  await db.query(`update sellerpilot_private.channel_credentials set
    seller_account_key=$2,
    seller_account_key_source=$3,
    seller_account_verified_at=now(),
    expires_at=now()+$4::interval
    where id=$1`, [id, sellerKey, source, expires]);
  await db.exec(`alter table sellerpilot_private.channel_credentials
    enable trigger guard_credential_seller_lineage`);
  return id;
}

function orderPayload(externalOrderId, overrides = {}) {
  return [{
    externalOrderId,
    customerName: "Synthetic customer",
    productName: "Synthetic product",
    quantity: 2,
    amount: 12000,
    amountKrw: 12000,
    currency: "KRW",
    status: "paid",
    orderedAt: "2026-09-08T01:02:03.000Z",
    providerContext: { orderId: externalOrderId, source: "local-fixture" },
    ...overrides,
  }];
}

async function ingestOrder(db, credentialId, channel, payload) {
  return fixture.scalar(
    db,
    "select public.sellerpilot_service_ingest_orders($1,$2,$3::jsonb)",
    [credentialId, channel, JSON.stringify(payload)],
  );
}

async function ingestTicket(db, credentialId, channel, externalTicketId, externalOrderReference) {
  const payload = [{
    externalTicketId,
    externalOrderReference,
    customerName: "Synthetic customer",
    subject: "Synthetic inquiry",
    message: "Synthetic message",
    status: "waiting",
    providerStatus: "waiting",
    priority: 3,
    receivedAt: "2026-09-08T02:03:04.000Z",
    remoteMessageId: `${externalTicketId}:message`,
    inboundKey: `${channel}:synthetic:${externalTicketId}`,
    providerContext: { inquiryType: "synthetic" },
    replyContext: { inquiryType: "synthetic" },
  }];
  assert.equal(await fixture.scalar(
    db,
    "select public.sellerpilot_service_ingest_inquiries($1,$2,$3::jsonb)",
    [credentialId, channel, JSON.stringify(payload)],
  ), 1);
  return fixture.scalar(db, `select id from sellerpilot_private.support_tickets
    where owner_id=$1 and channel_key=$2 and external_ticket_id=$3`,
  [OWNER, channel, externalTicketId]);
}

async function order(db, externalOrderId, channel = "coupang") {
  return (await db.query(`select to_jsonb(o)-array['id','created_at','updated_at','last_seen_at'] original
    from sellerpilot_private.commerce_orders o
    where o.owner_id=$1 and o.channel_key=$2 and o.external_order_id=$3`,
  [OWNER, channel, externalOrderId])).rows[0]?.original;
}

async function orderId(db, externalOrderId, channel = "coupang") {
  return fixture.scalar(db, `select id from sellerpilot_private.commerce_orders
    where owner_id=$1 and channel_key=$2 and external_order_id=$3`,
  [OWNER, channel, externalOrderId]);
}

async function binding(db, ticketId) {
  return (await db.query(`select order_id,status,coupang_lineage_status
    from sellerpilot_private.cs_order_bindings where ticket_id=$1`, [ticketId])).rows[0];
}

async function candidates(db, ticketId) {
  return (await db.query(`select order_id,lineage_status
    from sellerpilot_private.coupang_cs_order_binding_candidate_v1($1)`, [ticketId])).rows;
}

async function messageOf(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error.message;
  }
}

test("production wrapper preimages apply and install preserves every legacy row for counted quarantine", async () => {
  const db = await currentDatabase();
  try {
    await seed(db);
    const credential = await coupangCredential(db, "a");
    assert.equal(await ingestOrder(db, credential, "coupang", orderPayload("LEGACY-1")), 1);
    const ticket = await ingestTicket(db, credential, "coupang", "coupang:legacy:1", "LEGACY-1");
    const id = await orderId(db, "LEGACY-1");
    const before = {
      counts: (await db.query(`select
        (select count(*)::int from sellerpilot_private.commerce_orders) orders,
        (select count(*)::int from sellerpilot_private.support_tickets) tickets,
        (select count(*)::int from sellerpilot_private.cs_order_bindings) bindings`)).rows[0],
      ticket: (await db.query("select order_id from sellerpilot_private.support_tickets where id=$1", [ticket])).rows[0],
      binding: (await db.query(`select credential_id,channel,external_order_reference,order_id,status,evidence_fingerprint
        from sellerpilot_private.cs_order_bindings where ticket_id=$1`, [ticket])).rows[0],
      order: await order(db, "LEGACY-1"),
    };
    assert.equal(before.binding.status, "exact");

    const hashes = (await db.query(`select oid::regprocedure::text signature,md5(prosrc) hash
      from pg_proc where oid in(
        'public.sellerpilot_service_ingest_orders(uuid,text,jsonb)'::regprocedure,
        'public.sellerpilot_ingest_orders_pre_lazada_ownership(uuid,text,jsonb)'::regprocedure,
        'public.sellerpilot_270827_ingest_orders_without_shopee_lineage(uuid,text,jsonb)'::regprocedure,
        'public.sellerpilot_service_ingest_orders_pre_temu_fulfillment(uuid,text,jsonb)'::regprocedure,
        'sellerpilot_private.cs_order_binding_is_exact(uuid,text,text,uuid,uuid)'::regprocedure
      ) order by signature`)).rows;
    assert.deepEqual(hashes.map(({ hash }) => hash).sort(), [
      "1a426cc962f53f230a4fa4e0f147d22e",
      "1fdde0da2bcaf7c1e1d903e471f37c52",
      "72163b030ad8554f56df9b673f098510",
      "7657c4469226c8a0873628e9f029380d",
      "fb7b4b6eea9d1d4b8c7e3a60c9949b31",
    ].sort());

    await db.exec(proposal);
    const after = {
      counts: (await db.query(`select
        (select count(*)::int from sellerpilot_private.commerce_orders) orders,
        (select count(*)::int from sellerpilot_private.support_tickets) tickets,
        (select count(*)::int from sellerpilot_private.cs_order_bindings) bindings`)).rows[0],
      ticket: (await db.query("select order_id from sellerpilot_private.support_tickets where id=$1", [ticket])).rows[0],
      binding: (await db.query(`select credential_id,channel,external_order_reference,order_id,status,evidence_fingerprint
        from sellerpilot_private.cs_order_bindings where ticket_id=$1`, [ticket])).rows[0],
      order: await order(db, "LEGACY-1"),
    };
    assert.deepEqual(after, before, "proposal install must perform no bulk clearing or order rewrite");
    assert.equal(await fixture.scalar(db, `select sellerpilot_private.cs_order_binding_is_exact(
      $1,'coupang','LEGACY-1',$2,$3)`, [OWNER, credential, id]), false);
    assert.deepEqual(await candidates(db, ticket), [
      { order_id: null, lineage_status: "legacy_unknown" },
    ]);
    assert.equal(await fixture.scalar(db, `select count(*)::int
      from sellerpilot_private.coupang_order_credential_lineage`), 0);

    assert.equal(await ingestOrder(db, credential, "coupang", orderPayload("LEGACY-1")), 1);
    assert.equal(await fixture.scalar(db, `select count(*)::int
      from sellerpilot_private.coupang_order_credential_lineage`), 1);
    assert.deepEqual(await binding(db, ticket), {
      order_id: id,
      status: "exact",
      coupang_lineage_status: "exact",
    });
    assert.deepEqual(await order(db, "LEGACY-1"), before.order);
  } finally {
    await db.close();
  }
});

test("unverified, expired, and failed provenance never roll back order ingest or become exact", async () => {
  const db = await currentDatabase({ applyProposal: true });
  try {
    await seed(db);
    const incarnation = await coupangCredential(db, "b", {
      source: "credential_incarnation_v1",
    });
    const expired = await coupangCredential(db, "c", { expires: "-1 day" });
    const verified = await coupangCredential(db, "d");
    await db.query(`update sellerpilot_private.channel_credentials
      set status='grace' where id=any($1::uuid[])`, [[incarnation, expired]]);
    const cases = [
      [incarnation, "UNVERIFIED-1", "coupang:unverified:1", "unverified_credential"],
      [expired, "EXPIRED-1", "coupang:expired:1", "unverified_credential"],
    ];
    for (const [credential, externalOrderId, externalTicketId, expectedStatus] of cases) {
      const ticket = await ingestTicket(
        db, credential, "coupang", externalTicketId, externalOrderId,
      );
      assert.equal(await ingestOrder(
        db, credential, "coupang", orderPayload(externalOrderId),
      ), 1);
      const id = await orderId(db, externalOrderId);
      assert.ok(id);
      assert.deepEqual(await binding(db, ticket), {
        order_id: null,
        status: expectedStatus,
        coupang_lineage_status: expectedStatus,
      });
      assert.equal(await fixture.scalar(db, `select sellerpilot_private.cs_order_binding_is_exact(
        $1,'coupang',$2,$3,$4)`, [OWNER, externalOrderId, credential, id]), false);
    }

    const storageTicket = await ingestTicket(
      db, verified, "coupang", "coupang:storage:1", "STORAGE-1",
    );
    await db.exec(`create function sellerpilot_private.fail_coupang_projection_for_test()
      returns trigger language plpgsql as $$begin raise exception 'synthetic storage failure';end$$;
      create trigger fail_coupang_projection_for_test before insert or update
      on sellerpilot_private.cs_order_bindings for each row
      execute function sellerpilot_private.fail_coupang_projection_for_test()`);
    assert.equal(await ingestOrder(
      db, verified, "coupang", orderPayload("STORAGE-1"),
    ), 1);
    const storageOrder = await orderId(db, "STORAGE-1");
    assert.ok(storageOrder);
    assert.equal(await fixture.scalar(db, `select count(*)::int
      from sellerpilot_private.coupang_order_credential_lineage`), 1);
    assert.deepEqual(await binding(db, storageTicket), {
      order_id: null,
      status: "unmatched",
      coupang_lineage_status: "unmatched",
    });
    assert.equal(await fixture.scalar(db, `select sellerpilot_private.record_coupang_order_lineage_v1(
      $1,$2,'STORAGE-1')`, [verified, storageOrder]), "recorded");
    assert.equal(await fixture.scalar(db, `select sellerpilot_private.cs_order_binding_is_exact(
      $1,'coupang','STORAGE-1',$2,$3)`, [OWNER, verified, storageOrder]), true);

    await db.exec("drop trigger fail_coupang_projection_for_test on sellerpilot_private.cs_order_bindings");
    const failedLedgerTicket = await ingestTicket(
      db, verified, "coupang", "coupang:ledger-fail:1", "LEDGER-FAIL-1",
    );
    await db.exec(`create function sellerpilot_private.fail_coupang_lineage_for_test()
      returns trigger language plpgsql as $$begin raise exception 'synthetic lineage failure';end$$;
      create trigger fail_coupang_lineage_for_test before insert or update
      on sellerpilot_private.coupang_order_credential_lineage for each row
      execute function sellerpilot_private.fail_coupang_lineage_for_test()`);
    assert.equal(await ingestOrder(
      db, verified, "coupang", orderPayload("LEDGER-FAIL-1"),
    ), 1);
    const failedLedgerOrder = await orderId(db, "LEDGER-FAIL-1");
    assert.ok(failedLedgerOrder);
    assert.equal(await fixture.scalar(db, `select count(*)::int
      from sellerpilot_private.coupang_order_credential_lineage`), 1);
    assert.deepEqual(await binding(db, failedLedgerTicket), {
      order_id: null,
      status: "unmatched",
      coupang_lineage_status: "legacy_unknown",
    });
    assert.equal(await fixture.scalar(db, `select sellerpilot_private.record_coupang_order_lineage_v1(
      $1,$2,'LEDGER-FAIL-1')`, [verified, failedLedgerOrder]), "storage_unavailable");
    assert.equal(await fixture.scalar(db, `select sellerpilot_private.cs_order_binding_is_exact(
      $1,'coupang','LEDGER-FAIL-1',$2,$3)`, [OWNER, verified, failedLedgerOrder]), false);
    assert.equal(await fixture.scalar(db, `select count(*)::int
      from sellerpilot_private.commerce_orders where channel_key='coupang' and not demo`), 4);
  } finally {
    await db.close();
  }
});

test("Coupang and non-Coupang returns, fields, errors, and exact binding behavior stay canonical", async () => {
  const baseline = await currentDatabase();
  const revised = await currentDatabase({ applyProposal: true });
  try {
    const baselineCredential = await seed(baseline);
    const revisedCredential = await seed(revised);
    const payload = orderPayload("QOO10-EQUIVALENT", {
      currency: "USD",
      amount: 23.5,
      amountKrw: 32000,
      providerContext: { orderId: "QOO10-EQUIVALENT", marker: "same" },
    });
    const baselineReturn = await ingestOrder(
      baseline, baselineCredential, "qoo10", payload,
    );
    const revisedReturn = await ingestOrder(
      revised, revisedCredential, "qoo10", payload,
    );
    assert.equal(revisedReturn, baselineReturn);
    assert.deepEqual(
      await order(revised, "QOO10-EQUIVALENT", "qoo10"),
      await order(baseline, "QOO10-EQUIVALENT", "qoo10"),
    );

    const baselineCoupang = await coupangCredential(baseline, "a");
    const revisedCoupang = await coupangCredential(revised, "a");
    const coupangPayload = orderPayload("COUPANG-EQUIVALENT", {
      status: "ready_to_ship",
      quantity: 4,
      amount: 44000,
    });
    assert.equal(
      await ingestOrder(revised, revisedCoupang, "coupang", coupangPayload),
      await ingestOrder(baseline, baselineCoupang, "coupang", coupangPayload),
    );
    assert.deepEqual(
      await order(revised, "COUPANG-EQUIVALENT"),
      await order(baseline, "COUPANG-EQUIVALENT"),
    );

    const baselineInvalid = await messageOf(fixture.scalar(
      baseline,
      "select public.sellerpilot_service_ingest_orders($1,'qoo10','{}'::jsonb)",
      [baselineCredential],
    ));
    const revisedInvalid = await messageOf(fixture.scalar(
      revised,
      "select public.sellerpilot_service_ingest_orders($1,'qoo10','{}'::jsonb)",
      [revisedCredential],
    ));
    assert.equal(revisedInvalid, baselineInvalid);
    assert.match(revisedInvalid, /invalid normalized orders/u);

    const baselineCoupangInvalid = await messageOf(fixture.scalar(
      baseline,
      "select public.sellerpilot_service_ingest_orders($1,'coupang','{}'::jsonb)",
      [baselineCoupang],
    ));
    const revisedCoupangInvalid = await messageOf(fixture.scalar(
      revised,
      "select public.sellerpilot_service_ingest_orders($1,'coupang','{}'::jsonb)",
      [revisedCoupang],
    ));
    assert.equal(revisedCoupangInvalid, baselineCoupangInvalid);
    assert.match(revisedCoupangInvalid, /invalid normalized orders/u);

    const missingCredential = "00000000-0000-4000-8000-000000009999";
    const baselineMissing = await messageOf(ingestOrder(
      baseline, missingCredential, "coupang", orderPayload("MISSING-CREDENTIAL"),
    ));
    const revisedMissing = await messageOf(ingestOrder(
      revised, missingCredential, "coupang", orderPayload("MISSING-CREDENTIAL"),
    ));
    assert.equal(revisedMissing, baselineMissing);
    assert.match(revisedMissing, /active channel credential required/u);

    const ticket = await ingestTicket(
      revised, revisedCredential, "qoo10", "qoo10:equivalent:1", "QOO10-EQUIVALENT",
    );
    const id = await orderId(revised, "QOO10-EQUIVALENT", "qoo10");
    assert.equal((await binding(revised, ticket)).status, "exact");
    for (const candidateOrder of [id, null]) {
      const canonical = await fixture.scalar(revised, `select
        sellerpilot_private.cs_order_binding_is_exact_pre_coupang_lineage_v1(
          $1,'qoo10','QOO10-EQUIVALENT',$2,$3)`,
      [OWNER, revisedCredential, candidateOrder]);
      const wrapped = await fixture.scalar(revised, `select
        sellerpilot_private.cs_order_binding_is_exact(
          $1,'qoo10','QOO10-EQUIVALENT',$2,$3)`,
      [OWNER, revisedCredential, candidateOrder]);
      assert.equal(wrapped, canonical);
    }
  } finally {
    await baseline.close();
    await revised.close();
  }
});

test("rotation is exact, vendor mismatch and cross-vendor collision return one denied row", async () => {
  const db = await currentDatabase({ applyProposal: true });
  try {
    await seed(db);
    const keyA = "a".repeat(64);
    const credentialA1 = await coupangCredential(db, "e", { sellerKey: keyA });
    const credentialA2 = await coupangCredential(db, "f", { sellerKey: keyA });
    const credentialB = await coupangCredential(db, "b", { sellerKey: "b".repeat(64) });
    await db.query(`update sellerpilot_private.channel_credentials
      set status='grace' where id=any($1::uuid[])`, [[credentialA1, credentialA2]]);
    assert.equal(await ingestOrder(
      db, credentialA1, "coupang", orderPayload("ROTATION-1"),
    ), 1);
    const id = await orderId(db, "ROTATION-1");
    const ticketA = await ingestTicket(
      db, credentialA2, "coupang", "coupang:rotation:a", "ROTATION-1",
    );
    assert.deepEqual(await binding(db, ticketA), {
      order_id: id, status: "exact", coupang_lineage_status: "exact",
    });

    const ticketB = await ingestTicket(
      db, credentialB, "coupang", "coupang:rotation:b", "ROTATION-1",
    );
    assert.deepEqual(await candidates(db, ticketB), [
      { order_id: null, lineage_status: "vendor_mismatch" },
    ]);
    assert.deepEqual(await binding(db, ticketB), {
      order_id: null, status: "unmatched", coupang_lineage_status: "vendor_mismatch",
    });

    await db.exec(`create function sellerpilot_private.fail_vendor_b_lineage_for_test()
      returns trigger language plpgsql as $$begin
        if new.source_credential_id::text=current_setting('sellerpilot.test.fail_credential',true)
          then raise exception 'synthetic vendor B lineage failure';end if;
        return new;
      end$$`);
    await db.query("select set_config('sellerpilot.test.fail_credential',$1,false)", [credentialB]);
    await db.exec(`create trigger fail_vendor_b_lineage_for_test before insert or update
      on sellerpilot_private.coupang_order_credential_lineage for each row
      execute function sellerpilot_private.fail_vendor_b_lineage_for_test()`);
    assert.equal(await ingestOrder(
      db, credentialB, "coupang", orderPayload("ROTATION-1"),
    ), 1);
    assert.deepEqual(await candidates(db, ticketA), [
      { order_id: null, lineage_status: "legacy_unknown" },
    ]);
    assert.deepEqual(await candidates(db, ticketB), [
      { order_id: null, lineage_status: "legacy_unknown" },
    ]);
    assert.equal(await fixture.scalar(db, `select sellerpilot_private.cs_order_binding_is_exact(
      $1,'coupang','ROTATION-1',$2,$3)`, [OWNER, credentialA2, id]), false);

    await db.exec("drop trigger fail_vendor_b_lineage_for_test on sellerpilot_private.coupang_order_credential_lineage");
    assert.equal(await ingestOrder(
      db, credentialB, "coupang", orderPayload("ROTATION-1"),
    ), 1);
    assert.deepEqual(await candidates(db, ticketA), [
      { order_id: null, lineage_status: "cross_vendor_collision" },
    ]);
    assert.deepEqual(await candidates(db, ticketB), [
      { order_id: null, lineage_status: "cross_vendor_collision" },
    ]);
    assert.deepEqual(await binding(db, ticketA), {
      order_id: null, status: "unmatched", coupang_lineage_status: "cross_vendor_collision",
    });
    assert.deepEqual(await binding(db, ticketB), {
      order_id: null, status: "unmatched", coupang_lineage_status: "cross_vendor_collision",
    });
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal(await fixture.scalar(db, `select has_table_privilege(
        $1,'sellerpilot_private.coupang_order_credential_lineage','SELECT')`, [role]), false);
      assert.equal(await fixture.scalar(db, `select has_function_privilege(
        $1,'sellerpilot_private.record_coupang_order_lineage_v1(uuid,uuid,text)','EXECUTE')`,
      [role]), false);
    }
  } finally {
    await db.close();
  }
});

test("preimage drift aborts before schema or data changes", async () => {
  const db = await currentDatabase();
  try {
    await seed(db);
    await db.exec(`create or replace function public.sellerpilot_service_ingest_orders(
      p_credential_id uuid,p_channel text,p_orders jsonb
    ) returns integer language sql security definer
      set search_path=pg_catalog,public,sellerpilot_private as $$select 0$$`);
    await assert.rejects(db.exec(proposal), /COUPANG_CS_ORDER_LINEAGE_PREIMAGE_OR_ACL_MISMATCH/u);
    await db.exec("rollback");
    assert.equal(await fixture.scalar(db, `select to_regclass(
      'sellerpilot_private.coupang_order_credential_lineage') is null`), true);
  } finally {
    await db.close();
  }
});
