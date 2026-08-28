import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260828145500_persist_elevenst_listing_update_snapshots.sql",
  import.meta.url,
);

const credentialId = "10000000-0000-4000-8000-000000000001";
const listingId = "20000000-0000-4000-8000-000000000001";
const jobId = "30000000-0000-4000-8000-000000000001";
const sellerKey = "a".repeat(64);

test("11st successful create and update preserve a seller-bound full Product snapshot", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      do $$ begin create role anon noinherit; exception when duplicate_object then null; end $$;
      do $$ begin create role authenticated noinherit; exception when duplicate_object then null; end $$;
      do $$ begin create role service_role noinherit; exception when duplicate_object then null; end $$;
      create schema sellerpilot_private;
      create table sellerpilot_private.channel_credentials (
        id uuid primary key,
        channel text not null,
        status text not null,
        expires_at timestamptz,
        seller_account_key text,
        seller_account_key_source text,
        seller_account_verified_at timestamptz
      );
      create table sellerpilot_private.product_listings (
        id uuid primary key,
        channel_key text not null,
        remote_id text,
        seller_account_key text
      );
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key,
        listing_id uuid,
        credential_id uuid not null,
        channel text not null,
        operation text not null,
        status text not null,
        request_payload jsonb not null,
        response_payload jsonb,
        seller_account_key text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        completed_at timestamptz
      );
    `);
    await db.query(
      `insert into sellerpilot_private.channel_credentials (
         id, channel, status, seller_account_key, seller_account_key_source,
         seller_account_verified_at
       ) values ($1, 'elevenst', 'active', $2, 'credential_incarnation_v1', now())`,
      [credentialId, sellerKey],
    );
    await db.query(
      `insert into sellerpilot_private.product_listings (
         id, channel_key, remote_id, seller_account_key
       ) values ($1, 'elevenst', '123456789', $2)`,
      [listingId, sellerKey],
    );
    await db.query(
      `insert into sellerpilot_private.channel_gateway_jobs (
         id, listing_id, credential_id, channel, operation, status,
         request_payload, seller_account_key
       ) values (
         $1, $2, $3, 'elevenst', 'listing.create', 'queued',
         '{"arguments":{"product":{"dispCtgrNo":"1341821","sellerPrdCd":"QA-001","prdNm":"before","selPrc":"10000"}}}'::jsonb,
         $4
       )`,
      [jobId, listingId, credentialId, sellerKey],
    );

    await db.exec(await readFile(migrationUrl, "utf8"));
    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set status = 'succeeded',
              response_payload = '{"ok":true,"channel":"elevenst","operation":"listing.create","remoteId":"123456789"}'::jsonb,
              completed_at = now(), updated_at = now()
        where id = $1`,
      [jobId],
    );
    assert.deepEqual(
      (await db.query(
        `select remote_id, source_operation, revision,
                product_payload->>'prdNm' as product_name,
                product_payload->>'selPrc' as price
           from sellerpilot_private.elevenst_listing_snapshots
          where listing_id = $1`,
        [listingId],
      )).rows,
      [{
        remote_id: "123456789",
        source_operation: "listing.create",
        revision: 1,
        product_name: "before",
        price: "10000",
      }],
    );

    await db.exec("select set_config('request.jwt.claim.role', 'service_role', false)");
    const snapshot = (await db.query(
      "select public.sellerpilot_service_get_elevenst_listing_snapshot($1, $2, '123456789') as snapshot",
      [listingId, credentialId],
    )).rows[0].snapshot;
    assert.equal(snapshot.remoteId, "123456789");
    assert.equal(snapshot.revision, 1);
    assert.equal(snapshot.product.prdNm, "before");
    assert.equal(snapshot.product.selPrc, "10000");
    assert.equal(
      (await db.query(
        "select public.sellerpilot_service_get_elevenst_listing_snapshot($1, $2, '999999999') as snapshot",
        [listingId, credentialId],
      )).rows[0].snapshot,
      null,
    );
  } finally {
    await db.close();
  }
});
