import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const originalMigrationUrl = new URL(
  "../supabase/migrations/20260831132018_smartstore_exact_qa_recovery_fence.sql",
  import.meta.url,
);
const forwardMigrationUrl = new URL(
  "../supabase/migrations/20260901171000_align_smartstore_exact_active_identity.sql",
  import.meta.url,
);

const productId = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const listingId = "7babb554-48dc-4869-81b1-cd4d435d7b96";
const credentialId = "2aa76829-3d63-4842-9c3e-622acd3d0d2f";
const ownerId = "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c";
const sellerAccountKey =
  "fb8872201b6ae9ce903732aaaa16776c2741bbeb815a234b6b9ca06d1255d0f8";

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const bodyStart = source.indexOf("as $$", start);
  assert.notEqual(bodyStart, -1);
  const end = source.indexOf("$$;", bodyStart + 5);
  assert.notEqual(end, -1);
  return source.slice(start, end + 3);
}

async function identity(db) {
  return (await db.query(
    `select public.sellerpilot_service_get_smartstore_exact_qa_recovery_identity(
       $1,$2,$3,'',''
     ) as value`,
    [listingId, credentialId, productId],
  )).rows[0].value;
}

test("Smartstore exact identity follows only the active central product", async () => {
  const [originalMigration, forwardMigration] = await Promise.all([
    readFile(originalMigrationUrl, "utf8"),
    readFile(forwardMigrationUrl, "utf8"),
  ]);
  assert.match(forwardMigration, /product\.status = 'active'/u);
  assert.doesNotMatch(forwardMigration, /update\s+sellerpilot_private\.products/iu);
  assert.doesNotMatch(
    forwardMigration,
    /update\s+sellerpilot_private\.listing_mutation_release_gate/iu,
  );

  const db = new PGlite();
  try {
    await db.exec(`
      create role anon noinherit;
      create role authenticated noinherit;
      create role service_role noinherit;
      create schema sellerpilot_private;
      create table sellerpilot_private.products (
        id uuid primary key,
        owner_id uuid not null,
        sku text not null,
        demo boolean not null,
        status text not null
      );
      create table sellerpilot_private.product_listings (
        id uuid primary key,
        owner_id uuid not null,
        product_id uuid not null,
        channel_key text not null,
        remote_id text,
        marketplace_sku text,
        remote_resources jsonb not null,
        status text not null,
        failure_class text,
        requested_publication_intent text,
        remote_visibility text,
        provider_status text,
        published_at timestamptz,
        currency text not null,
        price numeric not null,
        market text,
        target_id text,
        seller_account_key text
      );
      create table sellerpilot_private.channel_credentials (
        id uuid primary key,
        channel text not null,
        status text not null,
        environment text not null,
        expires_at timestamptz,
        seller_account_key text,
        seller_account_key_source text,
        seller_account_verified_at timestamptz
      );
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key default gen_random_uuid(),
        listing_id uuid,
        operation text not null,
        status text not null
      );
    `);
    await db.exec(extractFunction(
      originalMigration,
      "create function public.sellerpilot_service_get_smartstore_exact_qa_recovery_identity(",
    ));
    await db.query(
      `insert into sellerpilot_private.products
         (id,owner_id,sku,demo,status)
       values ($1,$2,'QA-20260823-CC-001',false,'draft')`,
      [productId, ownerId],
    );
    await db.query(
      `insert into sellerpilot_private.product_listings (
         id,owner_id,product_id,channel_key,remote_id,marketplace_sku,
         remote_resources,status,failure_class,requested_publication_intent,
         remote_visibility,provider_status,published_at,currency,price,market,
         target_id,seller_account_key
       ) values (
         $1,$2,$3,'smartstore','13671684696',null,'{}'::jsonb,'failed',
         'external_action','live','unknown',null,null,'KRW',5000,'','',$4
       )`,
      [listingId, ownerId, productId, sellerAccountKey],
    );
    await db.query(
      `insert into sellerpilot_private.channel_credentials (
         id,channel,status,environment,expires_at,seller_account_key,
         seller_account_key_source,seller_account_verified_at
       ) values (
         $1,'smartstore','active','production',null,$2,
         'credential_incarnation_v1',clock_timestamp()
       )`,
      [credentialId, sellerAccountKey],
    );

    assert.ok(await identity(db), "the historical draft preimage must be reproduced");
    await db.query(
      "update sellerpilot_private.products set status='active' where id=$1",
      [productId],
    );
    assert.equal(await identity(db), null, "the stale function must reject the active product");

    await db.exec(forwardMigration);
    assert.deepEqual(await identity(db), {
      contract: "smartstore_exact_qa_recovery_v1",
      phase: "listing.update",
      productId,
      listingId,
      originProductNo: "13671684696",
      channelProductNo: "13732202182",
      centralSku: "QA-20260823-CC-001",
      sellerManagementCodeSource: "provider_readback_required",
      sellerAccountLineage: "validated_by_service_rpc",
    });

    await db.query(
      "update sellerpilot_private.products set status='draft' where id=$1",
      [productId],
    );
    assert.equal(await identity(db), null, "the forward function must not widen back to draft");
  } finally {
    await db.close();
  }
});
