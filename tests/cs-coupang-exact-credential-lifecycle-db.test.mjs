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
  `${helpersModule}\nexport { fixture, currentDatabase, seed, orderPayload, ingestOrder, OWNER };\n`,
).toString("base64")}`);

const ticketProposal = await readFile(new URL(
  "../supabase/migrations/20260909160547_cs_coupang_vendor_ticket_identity.sql",
  import.meta.url,
), "utf8");
const credentialProposal = await readFile(new URL(
  "../supabase/migrations/20260909160548_cs_coupang_exact_credential_lifecycle.sql",
  import.meta.url,
), "utf8");

async function database() {
  const db = await helpers.currentDatabase({ applyProposal: true });
  await db.exec(`
    drop index if exists sellerpilot_private.channel_credentials_one_active_idx;
    drop index if exists sellerpilot_private.channel_credentials_one_active_non_lazada_idx;
    drop index if exists sellerpilot_private.channel_credentials_one_active_non_lazada_shopee_idx;
    create unique index channel_credentials_one_active_other_cs_idx
      on sellerpilot_private.channel_credentials(channel,environment)
      where status='active' and channel not in ('lazada','elevenst','smartstore','qoo10');
    create unique index channel_credentials_elevenst_active_account_idx
      on sellerpilot_private.channel_credentials(channel,environment,seller_account_key)
      where status='active' and channel='elevenst';
    create index if not exists channel_credentials_one_active_lazada_account_idx
      on sellerpilot_private.channel_credentials(id);
    create index if not exists channel_credentials_one_active_lazada_pending_owner_idx
      on sellerpilot_private.channel_credentials(id);
    create function public.sellerpilot_rotate_elevenst_credential_v1(
      uuid,jsonb,timestamptz,integer,integer,integer
    ) returns uuid language sql as $$ select $1 $$;
    create function public.sellerpilot_service_observe_inquiry_replies_v1(
      p_credential_id uuid,p_channel text,p_observations jsonb
    ) returns jsonb language plpgsql security definer set search_path='' as $$
    declare v_observation jsonb;
    begin
      v_observation:=coalesce(p_observations->0,'{}'::jsonb);
      perform 1 from sellerpilot_private.support_tickets ticket
       where ticket.channel_key=p_channel
         and (ticket.external_ticket_id=v_observation->>'externalTicketId'
           or (p_channel='ebay' and ticket.reply_context->>'parentMessageId'=
             v_observation#>>'{binding,parentMessageId}'));
      return jsonb_build_object('contract','sellerpilot-reply-observation-result/1');
    end $$;
    create function sellerpilot_private.enqueue_coupang_product_reply_readback_after_acceptance()
    returns trigger language plpgsql security definer set search_path='' as $$
    declare v_inquiry_id text;
    begin
      v_inquiry_id:='1';
      perform 1 from sellerpilot_private.support_tickets
       where id=new.ticket_id and channel_key='coupang'
         and external_ticket_id='product:'||v_inquiry_id and not demo for update;
      return new;
    end $$;
  `);
  await db.exec(ticketProposal);
  await db.exec(credentialProposal);
  return db;
}

function secret(vendorId, suffix) {
  return {
    access_key: `access-${suffix}`,
    secret_key: `secret-${suffix}`,
    vendor_id: vendorId,
  };
}

async function createCredential(db, vendorId, suffix) {
  await helpers.fixture.setClaims(db, "authenticated", helpers.OWNER);
  return helpers.fixture.scalar(db, `select public.sellerpilot_create_coupang_credential_v1(
    'production',$1::jsonb,now()+interval '180 days',180,14
  )`, [JSON.stringify(secret(vendorId, suffix))]);
}

async function certifyCredentialForFixture(db, credentialId) {
  await db.exec(`alter table sellerpilot_private.channel_credentials
    disable trigger guard_credential_seller_lineage`);
  await db.query(`update sellerpilot_private.channel_credentials set
    seller_account_key_source='provider_certified_v1',
    seller_account_verified_at=clock_timestamp() where id=$1`, [credentialId]);
  await db.exec(`alter table sellerpilot_private.channel_credentials
    enable trigger guard_credential_seller_lineage`);
}

async function ingestTicket(db, credentialId, inquiryId, label) {
  const payload = [{
    externalTicketId: `product:${inquiryId}`,
    customerName: `Synthetic ${label}`,
    subject: `Synthetic ${label}`,
    message: `Question ${label}`,
    status: "waiting",
    providerStatus: "waiting",
    priority: 3,
    receivedAt: "2026-09-09T01:00:00.000Z",
    remoteMessageId: inquiryId,
    inboundKey: `coupang:provider:${inquiryId}:question`,
    providerContext: {
      kind: "product",
      inquiryId,
      nativeExternalTicketId: `product:${inquiryId}`,
    },
    replyContext: {},
  }];
  assert.equal(await helpers.fixture.scalar(
    db,
    "select public.sellerpilot_service_ingest_inquiries($1,'coupang',$2::jsonb)",
    [credentialId, JSON.stringify(payload)],
  ), 1);
}

test("exact Coupang credential selection rejects ambiguity and binds each vendor", async () => {
  const db = await database();
  try {
    await helpers.seed(db);
    const a = await createCredential(db, "VENDOR_A", "a");
    const b = await createCredential(db, "VENDOR_B", "b");
    assert.deepEqual((await db.query(`select distinct seller_account_key_source
      from sellerpilot_private.channel_credentials where id in ($1,$2)`, [a, b])).rows,
    [{ seller_account_key_source: "credential_incarnation_v1" }]);
    await helpers.fixture.setClaims(db, "service_role", null);
    await assert.rejects(
      db.query("select public.sellerpilot_get_active_credential_secret('coupang','production')"),
      /COUPANG_EXACT_CREDENTIAL_ID_REQUIRED/,
    );
    const selectedA = await helpers.fixture.scalar(
      db,
      "select public.sellerpilot_service_get_coupang_credential_secret_v1($1)",
      [a],
    );
    const selectedB = await helpers.fixture.scalar(
      db,
      "select public.sellerpilot_service_get_coupang_credential_secret_v1($1)",
      [b],
    );
    assert.equal(selectedA.credential_id, a);
    assert.equal(selectedA.secret_payload.vendor_id, "VENDOR_A");
    assert.equal(selectedB.credential_id, b);
    assert.equal(selectedB.secret_payload.vendor_id, "VENDOR_B");
    assert.notEqual(selectedA.seller_account_key, selectedB.seller_account_key);
    await helpers.fixture.setClaims(db, "authenticated", helpers.OWNER);
    await assert.rejects(
      db.query("select public.sellerpilot_rotate_credential('coupang','production',$1::jsonb,null,180,14,0)", [JSON.stringify(secret("VENDOR_C", "c"))]),
      /COUPANG_EXACT_CREDENTIAL_FLOW_REQUIRED/,
    );
  } finally {
    await db.close();
  }
});

test("rotating chosen vendor B preserves A and moves only B ticket/order lineage", async () => {
  const db = await database();
  try {
    await helpers.seed(db);
    const a = await createCredential(db, "VENDOR_A", "a");
    const b = await createCredential(db, "VENDOR_B", "b");
    await certifyCredentialForFixture(db, a);
    await certifyCredentialForFixture(db, b);
    await ingestTicket(db, a, "7001", "A");
    await ingestTicket(db, b, "7001", "B");
    await helpers.ingestOrder(db, a, "coupang", helpers.orderPayload("ORDER-A"));
    await helpers.ingestOrder(db, b, "coupang", helpers.orderPayload("ORDER-B"));
    const before = (await db.query(`select id,seller_account_key from sellerpilot_private.channel_credentials
      where id in ($1,$2) order by id`, [a, b])).rows;
    const aKey = before.find((row) => row.id === a).seller_account_key;
    const bKey = before.find((row) => row.id === b).seller_account_key;

    await helpers.fixture.setClaims(db, "authenticated", helpers.OWNER);
    const nextB = await helpers.fixture.scalar(db, `select public.sellerpilot_rotate_coupang_credential_v1(
      $1,$2::jsonb,now()+interval '180 days',180,14,0
    )`, [b, JSON.stringify({ access_key: "access-b2", secret_key: "secret-b2" })]);
    const credentials = (await db.query(`select id,status,seller_account_key,
      seller_account_key_source from
      sellerpilot_private.channel_credentials where channel='coupang' order by version`)).rows;
    assert.deepEqual(credentials.map(({ id, status }) => ({ id, status })), [
      { id: a, status: "active" },
      { id: b, status: "revoked" },
      { id: nextB, status: "active" },
    ]);
    assert.equal(credentials.find((row) => row.id === a).seller_account_key, aKey);
    assert.equal(credentials.find((row) => row.id === nextB).seller_account_key, bKey);
    assert.equal(credentials.find((row) => row.id === a).seller_account_key_source,
    "provider_certified_v1");
    assert.equal(credentials.find((row) => row.id === nextB).seller_account_key_source,
    "provider_certified_v1");
    const bTicket = (await db.query(`select source_credential_id,seller_account_key,
        provider_external_ticket_id from sellerpilot_private.support_tickets
      where channel_key='coupang' and seller_account_key=$1`, [bKey])).rows[0];
    const bOrder = (await db.query(`select lineage.source_credential_id,lineage.seller_account_key
      from sellerpilot_private.coupang_order_credential_lineage lineage
      join sellerpilot_private.commerce_orders order_row on order_row.id=lineage.order_id
      where order_row.channel_key='coupang' and order_row.external_order_id='ORDER-B'`)).rows[0];
    assert.deepEqual(bTicket, {
      source_credential_id: nextB,
      seller_account_key: bKey,
      provider_external_ticket_id: "product:7001",
    });
    assert.deepEqual(bOrder, { source_credential_id: nextB, seller_account_key: bKey });
    assert.equal((await db.query(`select source_credential_id from sellerpilot_private.support_tickets
      where channel_key='coupang' and seller_account_key=$1`, [aKey])).rows[0].source_credential_id, a);

    const c = await createCredential(db, "VENDOR_C", "c");
    assert.equal((await db.query(`select count(*)::int n from sellerpilot_private.channel_credentials
      where channel='coupang' and status='active'`)).rows[0].n, 3);
    assert.equal((await db.query("select status from sellerpilot_private.channel_credentials where id=$1", [a])).rows[0].status, "active");
    assert.equal((await db.query("select status from sellerpilot_private.channel_credentials where id=$1", [nextB])).rows[0].status, "active");
    assert.equal((await db.query("select status from sellerpilot_private.channel_credentials where id=$1", [c])).rows[0].status, "active");
    await assert.rejects(db.query(`select public.sellerpilot_rotate_coupang_credential_v1(
      $1,$2::jsonb,null,180,14,0)`, [nextB, JSON.stringify({ vendor_id: "VENDOR_X" })]),
    /COUPANG_ROTATION_VENDOR_ID_IMMUTABLE/);
  } finally {
    await db.close();
  }
});

test("current-central Lazada and Elevenst indexes and exact helpers survive", async () => {
  const db = await database();
  try {
    const names = (await db.query(`select indexname from pg_indexes
      where schemaname='sellerpilot_private' and indexname in (
        'channel_credentials_one_active_lazada_account_idx',
        'channel_credentials_one_active_lazada_pending_owner_idx',
        'channel_credentials_elevenst_active_account_idx',
        'channel_credentials_one_active_other_cs_idx',
        'channel_credentials_one_active_coupang_vendor_idx'
      ) order by indexname`)).rows.map((row) => row.indexname);
    assert.equal(names.length, 5);
    assert.ok(await helpers.fixture.scalar(db, `select to_regprocedure(
      'public.sellerpilot_rotate_elevenst_credential_v1(uuid,jsonb,timestamptz,integer,integer,integer)'
    ) is not null`));
    assert.ok(await helpers.fixture.scalar(db, `select to_regprocedure(
      'sellerpilot_private.enqueue_coupang_product_reply_readback_after_acceptance()'
    ) is not null`));
    const definition = await helpers.fixture.scalar(db, `select pg_get_functiondef(
      'sellerpilot_private.enqueue_coupang_product_reply_readback_after_acceptance()'::regprocedure
    )`);
    assert.match(definition, /coalesce\(provider_external_ticket_id,external_ticket_id\)/);
    const observationDefinition = await helpers.fixture.scalar(db, `select pg_get_functiondef(
      'public.sellerpilot_service_observe_inquiry_replies_v1(uuid,text,jsonb)'::regprocedure
    )`);
    assert.match(observationDefinition,
      /coalesce\(ticket\.provider_external_ticket_id,ticket\.external_ticket_id\)/);
  } finally {
    await db.close();
  }
});

async function mutationSnapshot(db, credentialId) {
  return helpers.fixture.scalar(db, `select jsonb_build_object(
    'credential',(select jsonb_build_object(
      'id',credential.id,'status',credential.status,
      'sellerAccountKey',credential.seller_account_key,
      'sellerAccountKeySource',credential.seller_account_key_source,
      'sellerAccountVerifiedAt',credential.seller_account_verified_at
    ) from sellerpilot_private.channel_credentials credential where credential.id=$1),
    'credentialCount',(select count(*)::int from sellerpilot_private.channel_credentials),
    'vaultCount',(select count(*)::int from vault.secrets),
    'auditCount',(select count(*)::int from sellerpilot_private.credential_audit),
    'ticketLineage',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',ticket.id,'sourceCredentialId',ticket.source_credential_id,
      'sellerAccountKey',ticket.seller_account_key
    ) order by ticket.id),'[]'::jsonb) from sellerpilot_private.support_tickets ticket
      where ticket.channel_key='coupang'),
    'orderLineage',(select coalesce(jsonb_agg(jsonb_build_object(
      'orderId',lineage.order_id,'sourceCredentialId',lineage.source_credential_id,
      'sellerAccountKey',lineage.seller_account_key
    ) order by lineage.order_id),'[]'::jsonb)
      from sellerpilot_private.coupang_order_credential_lineage lineage)
  )`, [credentialId]);
}

test("create rejects key, vendor, and numeric null holes before Vault or audit writes", async () => {
  const db = await database();
  try {
    await helpers.seed(db);
    await helpers.fixture.setClaims(db, "authenticated", helpers.OWNER);
    const valid = secret("UNVERIFIED_VENDOR_404", "create-negative");
    const payloadCases = [
      ["blank access_key", { ...valid, access_key: "" }],
      ["null access_key", { ...valid, access_key: null }],
      ["wrong-type access_key", { ...valid, access_key: 42 }],
      ["blank secret_key", { ...valid, secret_key: "  " }],
      ["null secret_key", { ...valid, secret_key: null }],
      ["wrong-type secret_key", { ...valid, secret_key: { unsafe: true } }],
      ["missing vendor_id", { access_key: valid.access_key, secret_key: valid.secret_key }],
      ["null vendor_id", { ...valid, vendor_id: null }],
      ["wrong-type vendor_id", { ...valid, vendor_id: 404 }],
      ["invalid vendor_id", { ...valid, vendor_id: "UNKNOWN VENDOR!" }],
    ];
    const before = await mutationSnapshot(db, null);
    for (const [label, payload] of payloadCases) {
      await assert.rejects(db.query(`select public.sellerpilot_create_coupang_credential_v1(
        'production',$1::jsonb,null,180,14
      )`, [JSON.stringify(payload)]), /COUPANG_(EXACT_CREDENTIAL|VENDOR_ID)_INVALID/u, label);
      assert.deepEqual(await mutationSnapshot(db, null), before, label);
    }
    const numericCases = [
      ["null rotation interval", null, 14],
      ["null warning days", 180, null],
    ];
    for (const [label, rotationDays, warningDays] of numericCases) {
      await assert.rejects(db.query(`select public.sellerpilot_create_coupang_credential_v1(
        'production',$1::jsonb,null,$2::integer,$3::integer
      )`, [JSON.stringify(valid), rotationDays, warningDays]), /COUPANG_EXACT_CREDENTIAL_INVALID/u, label);
      assert.deepEqual(await mutationSnapshot(db, null), before, label);
    }

    const unverified = await createCredential(db, "UNVERIFIED_VENDOR_404", "unverified");
    assert.deepEqual((await db.query(`select seller_account_key_source,
      seller_account_verified_at is not null verified
      from sellerpilot_private.channel_credentials where id=$1`, [unverified])).rows[0], {
      seller_account_key_source: "credential_incarnation_v1",
      verified: true,
    });
    assert.equal(await helpers.fixture.scalar(db, `select safe_detail->>'identityEvidence'
      from sellerpilot_private.credential_audit where credential_id=$1`, [unverified]),
    "credential_incarnation_v1");
  } finally {
    await db.close();
  }
});

test("rotation rejects merged-secret and numeric null holes without any lineage transition", async () => {
  const db = await database();
  try {
    await helpers.seed(db);
    const original = await createCredential(db, "VENDOR_NEGATIVE", "negative");
    await certifyCredentialForFixture(db, original);
    await ingestTicket(db, original, "9101", "negative");
    await helpers.ingestOrder(db, original, "coupang", helpers.orderPayload("ORDER-NEGATIVE"));
    await helpers.fixture.setClaims(db, "authenticated", helpers.OWNER);
    const before = await mutationSnapshot(db, original);
    assert.equal(before.credential.status, "active");
    assert.equal(before.ticketLineage.length, 1);
    assert.equal(before.orderLineage.length, 1);

    const secretCases = [
      ["blank access_key", { access_key: "" }],
      ["null access_key", { access_key: null }],
      ["wrong-type access_key", { access_key: 42 }],
      ["blank secret_key", { secret_key: "  " }],
      ["null secret_key", { secret_key: null }],
      ["wrong-type secret_key", { secret_key: ["unsafe"] }],
      ["null vendor_id", { vendor_id: null }],
      ["wrong-type vendor_id", { vendor_id: 404 }],
      ["invalid vendor_id", { vendor_id: "UNKNOWN VENDOR!" }],
      ["different vendor_id", { vendor_id: "UNKNOWN_VENDOR" }],
    ];
    for (const [label, secretPatch] of secretCases) {
      await assert.rejects(db.query(`select public.sellerpilot_rotate_coupang_credential_v1(
        $1,$2::jsonb,null,180,14,0
      )`, [original, JSON.stringify(secretPatch)]), /COUPANG_/u, label);
      assert.deepEqual(await mutationSnapshot(db, original), before, label);
    }
    const numericCases = [
      ["null rotation interval", null, 14, 0],
      ["null warning days", 180, null, 0],
      ["null grace days", 180, 14, null],
    ];
    for (const [label, rotationDays, warningDays, graceDays] of numericCases) {
      await assert.rejects(db.query(`select public.sellerpilot_rotate_coupang_credential_v1(
        $1,$2::jsonb,null,$3::integer,$4::integer,$5::integer
      )`, [original, JSON.stringify({ access_key: "next-access" }),
        rotationDays, warningDays, graceDays]), /COUPANG_EXACT_ROTATION_INVALID/u, label);
      assert.deepEqual(await mutationSnapshot(db, original), before, label);
    }
  } finally {
    await db.close();
  }
});
