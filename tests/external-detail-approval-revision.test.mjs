import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  externalDetailApprovalContentSha256,
} from "../lib/external-detail-approval-revision.ts";
import { externalDetailDigest } from "../lib/external-detail-copy.ts";
import { externalDetailPublishContextFromRead } from "../lib/server-external-detail-publish-context.ts";
import { defaultProductDetailImageRoles } from "../lib/product-detail-image-manifest.ts";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260907052000_external_detail_content_approval_revision.sql",
    import.meta.url,
  ),
  "utf8",
);

const OWNER = "10000000-0000-4000-8000-000000000001";
const OTHER_OWNER = "10000000-0000-4000-8000-000000000002";
const PRODUCT = "1ed4acfc-7603-48ec-a638-241131e59358";
const IMPORT = "20000000-0000-4000-8000-000000000001";
const JOB = "30000000-0000-4000-8000-000000000001";
const APPROVED_AT = "2026-09-06T03:19:01.757195+00:00";
const CURRENT_AT = "2026-09-06T13:08:23.846181+00:00";
const ORIGINAL_SHA = "f".repeat(64);
const ORIGINAL_PATH = `${OWNER}/${JOB}/input/001.png`;

const documents = Object.fromEntries(
  ["ko", "ja", "en"].map((locale) => {
    const document = {
      root: {},
      content: defaultProductDetailImageRoles.map((role, index) => ({
        type: "ImageStoryBlock",
        props: {
          id: `${locale}-${index}`,
          title: `${locale} approved ${index}`,
          imageRole: role,
          imageUrl: `sellerpilot-asset://${role}`,
          imageAlt: `approved ${role}`,
          caption: "Staged fixture. Packaging can vary.",
          body: `${locale} Staged fixture. Packaging can vary.`,
        },
      })),
    };
    return [
      locale,
      {
        document,
        documentSha256: externalDetailDigest(document),
        reviewNote: `reviewed ${locale}`,
      },
    ];
  }),
);

const assets = defaultProductDetailImageRoles.map((role, index) => {
  const assetId = `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
  const sourceSha256 = `${index}`.repeat(64);
  return {
    assetId,
    role,
    originalFileName: `${index}.png`,
    mediaType: "image/png",
    byteLength: 100 + index,
    sourceSha256,
    alt: `approved ${role}`,
    caption: "Staged fixture. Packaging can vary.",
    storagePath: `external-detail/${OWNER}/${PRODUCT}/${IMPORT}/${assetId}/${sourceSha256}.png`,
  };
});

const receipts = assets.map((asset, index) => ({
  assetId: asset.assetId,
  role: asset.role,
  sourceSha256: asset.sourceSha256,
  decodedRgbaSha256: `${index + 1}`.repeat(64),
  width: 1000,
  height: 1000,
  byteLength: asset.byteLength,
  mediaType: "image/png",
  verification: "bytes_only_not_approved",
}));

const payloadWithoutHash = {
  contract: "sellerpilot_external_detail_import_v1",
  actorId: OWNER,
  ownerId: OWNER,
  importId: IMPORT,
  productId: PRODUCT,
  expectedProductUpdatedAt: APPROVED_AT,
  expectedDetailVersion: 1,
  expectedAiJobId: JOB,
  source: {
    kind: "external_generated",
    tool: "fixture",
    referenceSha256s: [ORIGINAL_SHA],
  },
  assets,
  imageRightsConfirmed: true,
  regeneratedPreviewAcknowledged: true,
  reviewedCopy: documents,
  originalEvidence: [{ path: ORIGINAL_PATH, sha256: ORIGINAL_SHA }],
  audit: {
    rightsBasis: "fixture",
    limitations: "fixture",
    sourceReferences: [{ label: "fixture", sha256: ORIGINAL_SHA }],
  },
};
const REQUEST_SHA = externalDetailDigest(payloadWithoutHash);
const payload = { ...payloadWithoutHash, requestSha256: REQUEST_SHA };
const sqlJson = (value) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

test("revision migration has no product-specific UUID fence", () => {
  assert.doesNotMatch(migration, /1ed4acfc-7603-48ec-a638-241131e59358/u);
  assert.doesNotMatch(migration, /EXTERNAL_DETAIL_TARGET_FORBIDDEN/u);
});

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function fixture({ status = "approved" } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema auth;
    create schema sellerpilot_private;
    create table auth.users(id uuid primary key);
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    create table sellerpilot_private.ai_cli_jobs(
      id uuid primary key, kind text not null, status text not null,
      request_payload jsonb not null, result_payload jsonb,
      created_by uuid not null references auth.users(id)
    );
    create table sellerpilot_private.products(
      id uuid primary key, owner_id uuid not null references auth.users(id),
      external_code text not null, sku text not null, name text not null,
      description text not null, source_url text, image_url text,
      ai_job_id uuid, status text not null, on_hand integer not null,
      reserved integer not null, reorder_point integer not null,
      cost_krw numeric not null, demo boolean not null,
      product_facts jsonb not null, detail_page_data jsonb,
      detail_page_version bigint not null,
      detail_page_approved_version bigint not null,
      detail_page_image_manifest jsonb, detail_page_updated_at timestamptz,
      external_detail_import_id uuid, created_at timestamptz not null,
      updated_at timestamptz not null
    );
    create table sellerpilot_private.external_detail_imports(
      id uuid primary key, product_id uuid not null references sellerpilot_private.products(id),
      owner_id uuid not null references auth.users(id), request_sha256 text not null,
      payload jsonb not null, status text not null, receipts jsonb,
      approved_product_updated_at timestamptz, approved_detail_version bigint,
      created_at timestamptz not null, expires_at timestamptz not null,
      approved_at timestamptz
    );
    create table sellerpilot_private.external_detail_import_audit(
      id bigint generated always as identity primary key,
      import_id uuid not null, actor_id uuid not null, event text not null,
      evidence jsonb not null, created_at timestamptz not null default now()
    );
    create table sellerpilot_private.product_category_assignments(
      id uuid primary key, owner_id uuid not null, product_id uuid not null,
      channel text not null, environment text not null, market text not null,
      category_id text not null, category_path text[], provided_attributes jsonb,
      status text not null, confirmed_at timestamptz
    );
    create table sellerpilot_private.product_listings(
      id uuid primary key, owner_id uuid not null, product_id uuid not null,
      channel_key text not null, market text not null, target_id text not null
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key default gen_random_uuid(), created_by uuid,
      channel text, operation text, status text,
      provider_mutation_started_at timestamptz, request_payload jsonb,
      request_fingerprint text
    );
    create function sellerpilot_private.request_has_unambiguous_service_role_claim()
    returns boolean language plpgsql stable set search_path='' as $$
    declare claims text := nullif(current_setting('request.jwt.claims', true),'');
    begin
      if claims is null then return false; end if;
      begin return claims::jsonb->>'role' = 'service_role';
      exception when others then return false; end;
    end $$;
    create function sellerpilot_private.external_detail_canonical(v jsonb)
    returns text language plpgsql immutable set search_path='' as $$
    declare result text;
    begin
      case jsonb_typeof(v)
      when 'object' then select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||sellerpilot_private.external_detail_canonical(value),',' order by key collate "C"),'')||'}' into result from jsonb_each(v);
      when 'array' then select '['||coalesce(string_agg(sellerpilot_private.external_detail_canonical(value),',' order by ordinal),'')||']' into result from jsonb_array_elements(v) with ordinality a(value,ordinal);
      else result:=v::text; end case; return result;
    end $$;
    create function sellerpilot_private.external_detail_hash(v jsonb)
    returns text language sql immutable set search_path='' as $$
      select encode(sha256(convert_to(sellerpilot_private.external_detail_canonical(v),'UTF8')),'hex')
    $$;
    create function sellerpilot_private.external_detail_import_is_current(uuid)
    returns boolean language sql stable as $$select false$$;
    create function sellerpilot_private.external_detail_source_manifest(uuid)
    returns jsonb language sql stable as $$select null::jsonb$$;
    create function sellerpilot_private.guard_external_detail_gateway_source()
    returns trigger language plpgsql as $$begin return new;end$$;
    create trigger external_detail_gateway_source_guard
    before insert or update of request_payload,status,provider_mutation_started_at
    on sellerpilot_private.channel_gateway_jobs for each row execute function
      sellerpilot_private.guard_external_detail_gateway_source();
    create function public.sellerpilot_service_external_detail_import(text,uuid,uuid,uuid,jsonb)
    returns jsonb language sql as $$select '{}'::jsonb$$;

    insert into auth.users values ('${OWNER}'),('${OTHER_OWNER}');
    insert into sellerpilot_private.admin_users values ('${OWNER}');
    insert into sellerpilot_private.ai_cli_jobs values (
      '${JOB}','product_studio','failed',
      ${sqlJson({
        manual_fields: { brandName: "LOTTE", stock: 7 },
        image_paths: [ORIGINAL_PATH],
        image_specs: [{ kind: "original" }],
      })},
      '{"degraded":true,"bookkeeping":"ignored"}'::jsonb,
      '${OWNER}'
    );
    insert into sellerpilot_private.products values (
      '${PRODUCT}','${OWNER}','EXT-001','SKU-001','Approved product',
      'Approved description','https://source.invalid/item',null,'${JOB}',
      'active',7,0,2,5000,false,
      '{"brandName":"LOTTE","stock":7}'::jsonb,
      ${sqlJson(documents.ko.document)},
      2,0,null,now(),'${IMPORT}',now(),'${CURRENT_AT}'
    );
    insert into sellerpilot_private.external_detail_imports values (
      '${IMPORT}','${PRODUCT}','${OWNER}','${REQUEST_SHA}',
      ${sqlJson(payload)},
      '${status}',${sqlJson(receipts)},
      '${APPROVED_AT}',2,now(),now()+interval '1 day','${APPROVED_AT}'
    );
  `);
  await db.exec(migration);
  return db;
}

async function withServiceClaims(db, callback) {
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ role: "service_role", sub: OWNER }),
  ]);
  try {
    return await callback();
  } finally {
    await db.exec("reset role");
    await db.exec("select set_config('request.jwt.claims','',false)");
  }
}

async function candidate(db) {
  const result = await db.query(
    `select
       sellerpilot_private.external_detail_approval_content_snapshot($1,$2) as snapshot,
       sellerpilot_private.external_detail_hash(
         sellerpilot_private.external_detail_approval_content_snapshot($1,$2)
       ) as hash`,
    [PRODUCT, IMPORT],
  );
  return result.rows[0];
}

async function rebind(db, expectedRevision, expectedHash, actor = OWNER) {
  return withServiceClaims(db, () => scalar(
    db,
    `select public.sellerpilot_service_rebind_external_detail_approval(
       $1,$2,$3,$4,$5,$6,true
     )`,
    [actor, PRODUCT, IMPORT, expectedRevision, expectedHash, REQUEST_SHA],
  ));
}

test("legacy timestamp mismatch requires an explicit exact-content rebind", async () => {
  const db = await fixture();
  try {
    await assert.rejects(
      withServiceClaims(db, () => db.query(
        "select public.sellerpilot_service_get_external_detail_publish_context($1,$2)",
        [OWNER, PRODUCT],
      )),
      /EXTERNAL_DETAIL_APPROVAL_MISMATCH/,
    );

    const beforeProduct = (await db.query(
      "select * from sellerpilot_private.products where id=$1",
      [PRODUCT],
    )).rows[0];
    const beforeImport = (await db.query(
      "select * from sellerpilot_private.external_detail_imports where id=$1",
      [IMPORT],
    )).rows[0];
    const expected = await candidate(db);
    assert.equal(
      externalDetailDigest(expected.snapshot),
      expected.hash,
      "Postgres and server canonical content hashes must agree",
    );

    const revision = await rebind(db, 0, expected.hash);
    assert.equal(revision.revision, 1);
    assert.equal(revision.contentSha256, expected.hash);
    assert.equal(revision.reason, "content_rebind");
    assert.deepEqual(
      (await db.query("select * from sellerpilot_private.products where id=$1", [PRODUCT])).rows[0],
      beforeProduct,
    );
    assert.deepEqual(
      (await db.query("select * from sellerpilot_private.external_detail_imports where id=$1", [IMPORT])).rows[0],
      beforeImport,
    );

    const read = await withServiceClaims(db, () => scalar(
      db,
      "select public.sellerpilot_service_get_external_detail_publish_context($1,$2)",
      [OWNER, PRODUCT],
    ));
    assert.equal(read.externalDetailImport.approvalRevision, 1);
    assert.equal(read.externalDetailImport.contentSha256, expected.hash);
    const dto = externalDetailPublishContextFromRead(read, OWNER, PRODUCT);
    assert.equal(dto.externalDetailSnapshot.approvalRevision, 1);
    assert.equal(dto.externalDetailSnapshot.contentSha256, expected.hash);
    assert.equal(
      externalDetailApprovalContentSha256(
        read.productRow,
        read.externalDetailImport,
        read.sourceJob,
      ),
      expected.hash,
    );
  } finally {
    await db.close();
  }
});

test("bookkeeping changes survive while product/source/approval content changes fail", async () => {
  const db = await fixture();
  try {
    const expected = await candidate(db);
    await rebind(db, 0, expected.hash);
    const current = () => scalar(
      db,
      "select sellerpilot_private.external_detail_approval_revision_is_current($1,1,$2)",
      [IMPORT, expected.hash],
    );

    await db.exec(`
      update sellerpilot_private.products
      set status='draft', on_hand=19, reserved=2, cost_krw=7000,
          product_facts=jsonb_set(product_facts,'{stock}','19'::jsonb),
          updated_at=updated_at+interval '1 hour';
      update sellerpilot_private.ai_cli_jobs
      set status='succeeded', result_payload='{"bookkeeping":"changed"}'::jsonb;
    `);
    assert.equal(await current(), true);

    for (const [change, restore] of [
      ["update sellerpilot_private.products set name='tampered'", "update sellerpilot_private.products set name='Approved product'"],
      ["update sellerpilot_private.products set product_facts=jsonb_set(product_facts,'{brandName}','\"OTHER\"'::jsonb)", "update sellerpilot_private.products set product_facts=jsonb_set(product_facts,'{brandName}','\"LOTTE\"'::jsonb)"],
      ["update sellerpilot_private.ai_cli_jobs set request_payload=jsonb_set(request_payload,'{manual_fields,brandName}','\"OTHER\"'::jsonb)", "update sellerpilot_private.ai_cli_jobs set request_payload=jsonb_set(request_payload,'{manual_fields,brandName}','\"LOTTE\"'::jsonb)"],
    ]) {
      await db.exec(change);
      assert.equal(await current(), false, change);
      await db.exec(restore);
      assert.equal(await current(), true, restore);
    }

    await db.exec("update sellerpilot_private.external_detail_imports set receipts=jsonb_set(receipts,'{0,decodedRgbaSha256}','\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"'::jsonb)");
    assert.equal(await current(), false);
  } finally {
    await db.close();
  }
});

test("rebind is owner/service/CAS guarded and the ledger is immutable", async () => {
  const db = await fixture();
  try {
    const expected = await candidate(db);
    await assert.rejects(
      scalar(
        db,
        `select public.sellerpilot_service_rebind_external_detail_approval(
           $1,$2,$3,0,$4,$5,true
         )`,
        [OWNER, PRODUCT, IMPORT, expected.hash, REQUEST_SHA],
      ),
      /permission denied|ACCESS_DENIED/,
    );
    await assert.rejects(rebind(db, 0, expected.hash, OTHER_OWNER), /OWNER_REQUIRED/);
    await assert.rejects(rebind(db, 0, "a".repeat(64)), /CONTENT_CONFLICT/);

    const first = await rebind(db, 0, expected.hash);
    const replay = await rebind(db, 0, expected.hash);
    assert.equal(replay.revision, first.revision);
    await assert.rejects(
      db.exec("update sellerpilot_private.external_detail_approval_revisions set reason='initial_approval'"),
      /IMMUTABLE/,
    );
    await assert.rejects(
      db.exec("delete from sellerpilot_private.external_detail_approval_revisions"),
      /IMMUTABLE/,
    );
  } finally {
    await db.close();
  }
});

test("gateway and readback source require both exact revision binding fields", async () => {
  const db = await fixture();
  try {
    const expected = await candidate(db);
    await rebind(db, 0, expected.hash);
    const rendered = {
      title: "Reviewed title",
      html: "<p>Reviewed content</p>",
      plain: "Reviewed content",
      sections: [],
    };
    const binding = {
      contract: "sellerpilot_external_detail_channel_v1",
      productId: PRODUCT,
      ownerId: OWNER,
      importId: IMPORT,
      version: 2,
      productUpdatedAt: APPROVED_AT,
      approvalRevision: 1,
      contentSha256: expected.hash,
      requestSha256: REQUEST_SHA,
      channel: "qoo10",
      market: "JP",
      language: "ja",
      locale: "ja-JP",
      documentSha256: documents.ja.documentSha256,
      allLocaleDocumentSha256: Object.fromEntries(
        Object.entries(documents).map(([locale, entry]) => [
          locale,
          entry.documentSha256,
        ]),
      ),
      imageSha256s: assets.map((asset) => asset.sourceSha256),
      pixelSha256s: receipts.map((receipt) => receipt.decodedRgbaSha256),
      ...rendered,
      exportSha256: externalDetailDigest(rendered),
    };
    const request = (value) => ({
      arguments: {
        sellerpilotExternalDetail: value,
        publicationExpectedLocale: "ja-JP",
        publicationExpectedFingerprint: "fixture-fingerprint",
      },
    });

    const inserted = await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs(
         created_by,channel,operation,status,request_payload,request_fingerprint
       ) values($1,'qoo10','listing.update','queued',$2::jsonb,$3)
       returning id`,
      [OWNER, JSON.stringify(request(binding)), "fixture-fingerprint"],
    );
    const manifest = await scalar(
      db,
      "select sellerpilot_private.external_detail_source_manifest($1)",
      [inserted.rows[0].id],
    );
    assert.equal(manifest.contract, "sellerpilot_detail_image_manifest_v2");
    assert.equal(manifest.images.length, 8);

    for (const incomplete of [
      { ...binding, approvalRevision: undefined },
      { ...binding, contentSha256: undefined },
      { ...binding, imageSha256s: undefined },
      { ...binding, language: undefined, locale: undefined },
    ]) {
      await assert.rejects(
        db.query(
          `insert into sellerpilot_private.channel_gateway_jobs(
             created_by,channel,operation,status,request_payload,request_fingerprint
           ) values($1,'qoo10','listing.update','queued',$2::jsonb,$3)`,
          [OWNER, JSON.stringify(request(incomplete)), "fixture-fingerprint"],
        ),
        /EXTERNAL_DETAIL_JOB_(?:SOURCE_STALE|IMAGE_MISMATCH|LOCALE_INVALID)/,
      );
    }
  } finally {
    await db.close();
  }
});

test("missing JSON arrays and paths fail closed", async () => {
  for (const mutation of [
    "update sellerpilot_private.external_detail_imports set receipts=null",
    "update sellerpilot_private.external_detail_imports set payload=payload-'assets'",
    "update sellerpilot_private.external_detail_imports set payload=payload-'originalEvidence'",
    "update sellerpilot_private.ai_cli_jobs set request_payload=request_payload-'image_paths'",
  ]) {
    const db = await fixture();
    try {
      await db.exec(mutation);
      assert.equal(
        await scalar(
          db,
          "select sellerpilot_private.external_detail_approval_source_is_valid($1)",
          [IMPORT],
        ),
        false,
        mutation,
      );
    } finally {
      await db.close();
    }
  }
});

test("new approvals receive revision one without rewriting approved content", async () => {
  const db = await fixture({ status: "verified" });
  try {
    const beforeProduct = (await db.query("select * from sellerpilot_private.products")).rows[0];
    await db.exec("update sellerpilot_private.external_detail_imports set status='approved'");
    const revision = (await db.query(
      "select * from sellerpilot_private.external_detail_approval_revisions",
    )).rows[0];
    assert.equal(revision.revision, 1);
    assert.equal(revision.reason, "initial_approval");
    assert.deepEqual(
      (await db.query("select * from sellerpilot_private.products")).rows[0],
      beforeProduct,
    );
    assert.equal(
      await scalar(
        db,
        "select sellerpilot_private.external_detail_approval_revision_is_current($1,1,$2)",
        [IMPORT, revision.content_sha256],
      ),
      true,
    );
  } finally {
    await db.close();
  }
});
