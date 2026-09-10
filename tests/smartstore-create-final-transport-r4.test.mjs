import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const { smartstoreCreateBodyBindingSha256 } = await import(
  "../lib/channels/smartstore-create-transport.ts"
);

const migration = await readFile(new URL(
  "../supabase/migrations/20260910050500_smartstore_final_transport_and_current_state_hardening_r4.sql",
  import.meta.url,
), "utf8");

const ids = {
  owner: "10000000-0000-4000-8000-000000000001",
  product: "10000000-0000-4000-8000-000000000002",
  aiJob: "10000000-0000-4000-8000-000000000003",
  credential: "10000000-0000-4000-8000-000000000004",
  attempt: "10000000-0000-4000-8000-000000000005",
  listing: "10000000-0000-4000-8000-000000000006",
  job: "10000000-0000-4000-8000-000000000007",
  claim: "10000000-0000-4000-8000-000000000008",
  vault: "10000000-0000-4000-8000-000000000009",
};
const digest = "a".repeat(64);
const sellerAccountKey = "b".repeat(64);
const productName = "스마트스토어 전송 바이트 고정";

function createBody({
  name = productName,
  salePrice = 10_000,
  stockQuantity = 1,
} = {}) {
  const optionalImages = Array.from({ length: 8 }, (_, index) => ({
    url: `https://shop-phinf.pstatic.net/20260910_sellerpilot/r4-${index}.jpg`,
  }));
  return {
    originProduct: {
      statusType: "SALE",
      saleType: "NEW",
      leafCategoryId: "50022679",
      name,
      salePrice,
      stockQuantity,
      images: {
        representativeImage: {
          url: "https://shop-phinf.pstatic.net/20260910_sellerpilot/r4-rep.jpg",
        },
        optionalImages,
      },
      deliveryInfo: {
        deliveryType: "DELIVERY",
        deliveryAttributeType: "NORMAL",
      },
      detailAttribute: {
        sellerCodeInfo: { sellerManagementCode: "SMART-CURRENT-001" },
        optionInfo: {},
        unitCapacity: { unitPriceYn: false },
        productAttributes: [
          { attributeSeq: 10020580, attributeValueSeq: 10832333 },
        ],
      },
    },
    smartstoreChannelProduct: {
      naverShoppingRegistration: true,
      channelProductName: name,
      channelProductDisplayStatusType: "ON",
    },
  };
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function createDatabase() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create extension if not exists pgcrypto;
    create schema extensions;
    create function extensions.digest(value text, algorithm text)
    returns bytea language sql immutable as $$
      select public.digest(value, algorithm)
    $$;
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create schema sellerpilot_private;
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    create table sellerpilot_private.ai_cli_jobs(
      id uuid primary key,
      request_payload jsonb not null
    );
    create table sellerpilot_private.products(
      id uuid primary key,
      owner_id uuid not null,
      ai_job_id uuid,
      sku text not null,
      name text not null,
      status text not null,
      demo boolean not null default false,
      on_hand integer not null,
      updated_at timestamptz not null,
      detail_page_version bigint not null,
      detail_page_approved_version bigint not null,
      detail_page_image_manifest jsonb
    );
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,
      channel text not null,
      environment text not null,
      status text not null,
      expires_at timestamptz,
      last_check_status text,
      version integer not null,
      fingerprint text not null,
      vault_secret_id uuid,
      last_rotated_at timestamptz,
      seller_account_key text,
      seller_account_key_source text
    );
    create table sellerpilot_private.channel_operation_attempts(
      id uuid primary key,
      owner_id uuid not null,
      credential_id uuid not null,
      channel text not null,
      operation text not null,
      status text not null,
      remote_id text
    );
    create table sellerpilot_private.product_listings(
      id uuid primary key,
      owner_id uuid not null,
      product_id uuid not null,
      channel_key text not null,
      operation_attempt_id uuid,
      status text not null,
      remote_id text
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,
      credential_id uuid not null,
      attempt_id uuid,
      listing_id uuid,
      channel text not null,
      operation text not null,
      environment text not null,
      request_payload jsonb,
      status text not null,
      claim_token uuid,
      created_by uuid not null,
      provider_mutation_started_at timestamptz,
      completed_at timestamptz,
      response_payload jsonb
    );
    create function sellerpilot_private.request_has_unambiguous_service_role_claim()
    returns boolean language sql stable as $$ select true $$;
    create function sellerpilot_private.worker_token_may_complete_gateway_job(
      text, uuid, uuid
    ) returns boolean language sql stable as $$ select true $$;
    create function public.sellerpilot_service_smartstore_create_source_snapshot(
      uuid, uuid, uuid
    ) returns jsonb language sql as $$ select '{}'::jsonb $$;
    insert into auth.users values ('${ids.owner}');
    insert into sellerpilot_private.admin_users values ('${ids.owner}');
    insert into sellerpilot_private.ai_cli_jobs values (
      '${ids.aiJob}',
      '{"manual_fields":{"sellerSku":"SMART-CURRENT-001","productName":"${productName}","sellingPrice":"10000","stock":"1","currency":"KRW"}}'
    );
    insert into sellerpilot_private.products values (
      '${ids.product}','${ids.owner}','${ids.aiJob}','PRODUCT-FALLBACK-001',
      '${productName}','ready',false,1,'2026-09-10T00:00:00.123456+00:00',3,3,
      '{"digest":"${digest}"}'
    );
    insert into sellerpilot_private.channel_credentials values (
      '${ids.credential}','smartstore','production','active',
      null,'passed',7,'ABCDEF123456','${ids.vault}',
      '2026-09-10T00:00:00.123456+00:00','${sellerAccountKey}',
      'provider_certified_v1'
    );
    insert into sellerpilot_private.channel_operation_attempts values (
      '${ids.attempt}','${ids.owner}','${ids.credential}','smartstore',
      'listing.create','running',null
    );
    insert into sellerpilot_private.product_listings values (
      '${ids.listing}','${ids.owner}','${ids.product}','smartstore',
      '${ids.attempt}','queued',null
    );
  `);
  const body = createBody();
  const manualSha = (await db.query(`
    select encode(
      extensions.digest(
        coalesce(request_payload->'manual_fields', '{}'::jsonb)::text,
        'sha256'
      ),
      'hex'
    ) as digest
    from sellerpilot_private.ai_cli_jobs
    where id = $1
  `, [ids.aiJob])).rows[0].digest;
  const source = {
    contract: "smartstore_listing_create_source_v1",
    productId: ids.product,
    ownerId: ids.owner,
    productUpdatedAt: "2026-09-10T00:00:00.123456+00:00",
    detailPageVersion: 3,
    approvedDetailPageVersion: 3,
    approvedManifestDigest: digest,
    sellerManagementCode: "SMART-CURRENT-001",
    credentialId: ids.credential,
    credentialVersion: 7,
    credentialFingerprint: "ABCDEF123456",
    credentialVaultSecretId: ids.vault,
    credentialLastRotatedAt: "2026-09-10T00:00:00.123456+00:00",
    productName,
    salePrice: 10_000,
    stockQuantity: 1,
    manualFieldsSha256: manualSha,
    bodyBindingSha256: smartstoreCreateBodyBindingSha256(body),
  };
  await db.query(`
    insert into sellerpilot_private.channel_gateway_jobs values (
      $1,$2,$3,$4,'smartstore','listing.create','production',$5::jsonb,
      'running',$6,$7, clock_timestamp(), null, null
    )
  `, [
    ids.job,
    ids.credential,
    ids.attempt,
    ids.listing,
    JSON.stringify({ arguments: { sellerpilotSmartstoreCreateSource: source, body } }),
    ids.claim,
    ids.owner,
  ]);
  await db.exec(migration);
  await db.exec(`select set_config('request.jwt.claim.role', 'service_role', false)`);
  return { db, body, source };
}

async function stage(db, body) {
  const bodyText = JSON.stringify(body);
  return db.query(`
    select public.sellerpilot_service_stage_smartstore_create_transport(
      $1,$2,$3,$4,$5,$6,$7
    ) as staged
  `, [
    "token-hash",
    ids.job,
    ids.claim,
    bodyText,
    sha256(bodyText),
    Buffer.byteLength(bodyText, "utf8"),
    smartstoreCreateBodyBindingSha256(body),
  ]);
}

test("reserved SmartStore r4 identifiers stay within 63 bytes", () => {
  const names = [
    "sellerpilot_service_smartstore_create_source_snapshot",
    "sellerpilot_service_stage_smartstore_create_transport",
    "sellerpilot_complete_smartstore_listing_create",
    "smartstore_create_final_transports",
    "smartstore_create_final_completions",
    "smartstore_create_transport_attempt_unique",
    "smartstore_create_transport_listing_unique",
  ];
  for (const name of names) {
    assert.ok(Buffer.byteLength(name, "utf8") <= 63, name);
  }
});

test("one unchanged source snapshot stages one title/price/stock body and rejects the other", async () => {
  const { db, body } = await createDatabase();
  try {
    const snapshot = await db.query(
      `select public.sellerpilot_service_smartstore_create_source_snapshot($1,$2,$3) as snapshot`,
      [ids.owner, ids.product, ids.credential],
    );
    assert.equal(snapshot.rows[0].snapshot.productName, productName);
    assert.equal(snapshot.rows[0].snapshot.salePrice, 10_000);
    assert.equal(snapshot.rows[0].snapshot.stockQuantity, 1);

    const first = await stage(db, body);
    assert.equal(first.rows[0].staged.staged, true);
    assert.equal(first.rows[0].staged.contract, "smartstore_create_transport_stage_v1");

    const second = createBody({
      name: "다른 제목",
      salePrice: 990_000,
      stockQuantity: 99,
    });
    await assert.rejects(
      () => stage(db, second),
      /SMARTSTORE_CREATE_TRANSPORT_SOURCE_DRIFT/u,
    );
    const stored = await db.query(`
      select body_json#>>'{originProduct,name}' as name,
             (body_json#>>'{originProduct,salePrice}')::integer as sale_price,
             (body_json#>>'{originProduct,stockQuantity}')::integer as stock
        from sellerpilot_private.smartstore_create_final_transports
       where job_id = $1
    `, [ids.job]);
    assert.deepEqual(stored.rows[0], {
      name: productName,
      sale_price: 10_000,
      stock: 1,
    });
  } finally {
    await db.close();
  }
});

async function complete(db, body, {
  originProductNo = "10000001",
  channelProductNo = "20000001",
  payload,
} = {}) {
  const responsePayload = payload ?? {
    originProduct: {
      name: body.originProduct.name,
      salePrice: body.originProduct.salePrice,
      stockQuantity: body.originProduct.stockQuantity,
    },
  };
  return db.query(`
    select public.sellerpilot_complete_smartstore_listing_create(
      $1,$2,$3,$4,$5,$6::jsonb
    ) as completed
  `, [
    "token-hash",
    ids.job,
    ids.claim,
    originProductNo,
    channelProductNo,
    JSON.stringify(responsePayload),
  ]);
}

test("atomic SmartStore CREATE completion binds the staged body and rejects a second commercial receipt", async () => {
  const { db, body } = await createDatabase();
  try {
    await stage(db, body);
    const first = await complete(db, body);
    assert.equal(first.rows[0].completed.status, "completed");
    assert.equal(first.rows[0].completed.reused, false);
    assert.equal(first.rows[0].completed.originProductNo, "10000001");

    const replay = await complete(db, body);
    assert.equal(replay.rows[0].completed.reused, true);

    await assert.rejects(
      () => complete(db, body, {
        payload: {
          originProduct: {
            name: "다른 제목",
            salePrice: 990_000,
            stockQuantity: 99,
          },
        },
      }),
      /SMARTSTORE_CREATE_COMPLETION_SOURCE_MISMATCH/u,
    );
    await assert.rejects(
      () => complete(db, body, { originProductNo: "99999999" }),
      /SMARTSTORE_CREATE_COMPLETION_REPLAY_MISMATCH/u,
    );

    const listing = await db.query(`
      select status, remote_id from sellerpilot_private.product_listings where id = $1
    `, [ids.listing]);
    assert.equal(listing.rows[0].status, "published");
    assert.equal(listing.rows[0].remote_id, "10000001");
    const generic = await db.query(`
      select to_regprocedure(
        'public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb)'
      ) is null as missing
    `);
    assert.equal(generic.rows[0].missing, true);
  } finally {
    await db.close();
  }
});

test("owned SmartStore CREATE completion route does not call generic gateway completion", async () => {
  const route = await readFile(new URL(
    "../app/api/channel-gateway/worker/smartstore-create-complete/route.ts",
    import.meta.url,
  ), "utf8");
  assert.match(route, /completeSmartstoreListingCreate/u);
  assert.doesNotMatch(route, /sellerpilot_service_complete_gateway_transaction/u);
});

test("shared commerce worker completion sends SmartStore listing.create to the dedicated RPC", async () => {
  const source = await readFile(new URL(
    "../lib/channels/commerce-worker-completion.ts",
    import.meta.url,
  ), "utf8");
  const branch = source.indexOf(
    'job.channel === "smartstore" && job.operation === "listing.create"',
  );
  const dedicated = source.indexOf("completeSmartstoreListingCreate", branch);
  const generic = source.indexOf(
    'serviceClient.rpc("sellerpilot_service_complete_gateway_transaction"',
    dedicated,
  );
  assert.ok(branch > 0 && dedicated > branch && generic > dedicated);
  assert.match(
    source.slice(branch, generic),
    /smartstoreListingCreateCompletionReceiptFromWorkerResult/u,
  );
  assert.match(source.slice(branch, generic), /return NextResponse\.json/u);
  assert.doesNotMatch(
    source.slice(branch, generic),
    /sellerpilot_service_complete_gateway_transaction/u,
  );
});
