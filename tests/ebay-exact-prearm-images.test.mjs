import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260902107000_recover_ebay_exact_prearm_images.sql",
  import.meta.url,
);
const priorProofUrl = new URL(
  "../supabase/migrations/20260902106000_bind_ebay_exact_current_attempt_proof.sql",
  import.meta.url,
);
const lineageUrl = new URL(
  "../supabase/migrations/20260901194336_rebind_ebay_exact_current_credential_lineage.sql",
  import.meta.url,
);
const routeUrl = new URL("../app/api/admin/channel-operations/route.ts", import.meta.url);

const id = {
  owner: "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c",
  product: "ddccde35-9c58-4856-b673-d7aa27ce4220",
  listing: "8b2cbfaf-3854-437d-b381-abfd70291354",
  latestAttempt: "079cd680-47fb-4910-b3d8-27d19356e66e",
  assetAttempt: "c9d5b739-4ae7-4596-acbc-06f900a21ba3",
  sourceAttempt: "22457f2e-51d8-43c5-bb03-d2c1bb7fe697",
  freshAttempt: "20e1c68d-b395-44b4-a71d-4d1c2e4969ca",
  historicalCredential: "66285742-5909-40db-b1f3-fa4c300b8911",
  currentCredential: "bbf7c49e-c9db-4279-adeb-b2e1b1489eb9",
  permit: "7ae83178-d335-4b7e-8e35-2f55e905bbde",
  providerPermit: "c8737bad-2271-48fd-b017-4e0414225c37",
  providerJob: "e6f61b31-eb4b-438b-84ae-bb9b080f1b46",
};

const seller = "cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f";
const currentFingerprint = "4d3fb2652d0b7de0e4fb9c933aee4bec975ee6a0a081fb94530aae7418f7014e";
const latestFingerprint = "acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef";
const assetFingerprint = "ca16ccbee45665f513bc1a4f1a1420be57dbd9b52f065b1f53e413d7e5d81cd2";
const representative = "normalized/29/292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a.jpg";

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function digestPath(value) {
  const digest = value.toString(16).padStart(64, "0");
  return `normalized/${digest.slice(0, 2)}/${digest}.jpg`;
}

function sourceBinding(index) {
  return {
    path: `results/11111111-1111-4111-8111-111111111111/claims/22222222-2222-4222-8222-222222222222/detail-${index}.png`,
    sha: index === 0
      ? "1be297f0103147951dbb3e7167cd87362f9cf12efe5be2dfa26cd0ed9b918753"
      : (index + 10).toString(16).padStart(64, "0"),
  };
}

function exactPayloadFor(paths) {
  const transport = paths.map((path, index) => {
    const digest = path.match(/^normalized\/[0-9a-f]{2}\/([0-9a-f]{64})[.]jpg$/u)[1];
    const source = sourceBinding(index);
    return {
      role: index === 0 ? "gallery-representative" : `detail-${index}`,
      publicUrl: `https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/${path}`,
      objectPath: path,
      contentSha256: digest,
      ...(index === 0 ? {
        approvedObjectPath: source.path,
        approvedSourceSha256: source.sha,
      } : {}),
    };
  });
  return JSON.stringify({
    arguments: {
      publicationExpectedFingerprint: currentFingerprint,
      sellerpilotEbayExactV101ContentContract: {
        contract: "ebay_exact_v101_content_contract_v1",
      },
      sellerpilotPublicationAssetBinding: {
        contract: "sellerpilot_publication_asset_binding_v1",
        providerImageSurface: "gallery",
        providerTransportImages: transport,
        approvedDetailImages: transport.slice(1).map((image, index) => ({
          ...image,
          approvedObjectPath: sourceBinding(index + 1).path,
          approvedSourceSha256: sourceBinding(index + 1).sha,
        })),
      },
    },
  });
}

async function seedRef(db, {
  attemptId,
  path,
  sourceBound = true,
  sourcePath,
  sourceSha,
}) {
  const digest = path.match(/^normalized\/[0-9a-f]{2}\/([0-9a-f]{64})[.]jpg$/u)?.[1] ?? "0".repeat(64);
  await db.exec(`
    insert into sellerpilot_private.marketplace_normalized_assets (
      object_path, content_sha256, status, uploaded_at
    ) values (${sqlString(path)}, '${digest}', 'available', now())
    on conflict (object_path) do update set
      content_sha256 = excluded.content_sha256,
      status = excluded.status,
      uploaded_at = excluded.uploaded_at;
    insert into sellerpilot_private.marketplace_normalized_asset_refs (
      attempt_id, owner_id, product_id, channel, market, target_id,
      object_path, upload_confirmed_at, canonical_public_url,
      source_object_path, source_content_sha256
    ) values (
      '${attemptId}', '${id.owner}', '${id.product}', 'ebay', 'US', 'EBAY_US',
      ${sqlString(path)}, now(),
      ${sqlString(`https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/${path}`)},
      ${sourceBound ? sqlString(sourcePath ?? `results/source/${path.slice(path.lastIndexOf("/") + 1)}`) : "null"},
      ${sourceBound ? sqlString(sourceSha ?? digest) : "null"}
    );
  `);
}

async function setupDatabase(migration) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema sellerpilot_private;

    create table sellerpilot_private.channel_credentials (
      id uuid primary key,
      channel text not null,
      environment text not null,
      status text not null,
      version integer not null,
      fingerprint text not null,
      seller_account_key text not null,
      seller_account_key_source text,
      seller_account_verified_at timestamptz
    );
    create table sellerpilot_private.channel_operation_attempts (
      id uuid primary key,
      owner_id uuid not null,
      credential_id uuid,
      channel text not null,
      operation text not null,
      status text not null,
      http_status integer,
      remote_id text,
      gateway_write_required boolean not null,
      pre_gateway_retryable boolean not null,
      request_fingerprint text,
      seller_account_key text
    );
    create table sellerpilot_private.product_listings (
      id uuid primary key,
      owner_id uuid not null,
      product_id uuid not null,
      channel_key text not null,
      market text,
      target_id text,
      remote_id text,
      seller_account_key text,
      operation_attempt_id uuid
    );
    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key default gen_random_uuid(),
      attempt_id uuid,
      listing_id uuid,
      credential_id uuid,
      channel text,
      operation text,
      request_fingerprint text,
      request_payload jsonb
    );
    create table sellerpilot_private.exact_existing_update_permits (
      permit_id uuid primary key,
      listing_id uuid not null,
      channel text,
      remote_id text,
      credential_id uuid,
      request_fingerprint text,
      update_job_id uuid,
      update_attempt_id uuid
    );
    create table sellerpilot_private.marketplace_normalized_assets (
      object_path text primary key,
      content_sha256 text,
      status text,
      uploaded_at timestamptz
    );
    create table sellerpilot_private.marketplace_normalized_asset_refs (
      attempt_id uuid not null,
      owner_id uuid not null,
      product_id uuid not null,
      channel text not null,
      market text not null,
      target_id text not null,
      object_path text not null,
      upload_confirmed_at timestamptz,
      canonical_public_url text,
      source_object_path text,
      source_content_sha256 text,
      primary key (attempt_id, object_path)
    );

    create function sellerpilot_private.ebay_exact_current_credential_is_valid(
      p_credential_id uuid, p_seller_account_key text
    ) returns boolean language sql stable set search_path = '' as $$
      select exists (
        select 1 from sellerpilot_private.channel_credentials credential
         where credential.id = p_credential_id
           and credential.channel = 'ebay'
           and credential.environment = 'production'
           and credential.status = 'active'
           and credential.seller_account_key = p_seller_account_key
      )
    $$;

    create function sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(
      p_credential_id uuid,
      p_release_sha text,
      p_request_fingerprint text
    ) returns boolean
    language plpgsql stable security definer set search_path = ''
    as $$
    begin
      return exists (
        select 1
          from sellerpilot_private.product_listings listing
          join sellerpilot_private.channel_operation_attempts attempt
            on attempt.id = '${id.latestAttempt}'::uuid
           and attempt.owner_id = listing.owner_id
         and attempt.channel = listing.channel_key
        join sellerpilot_private.channel_credentials attempt_credential
            on attempt_credential.id = attempt.credential_id
          join sellerpilot_private.channel_operation_attempts source_attempt
            on source_attempt.id = '${id.sourceAttempt}'::uuid
           and source_attempt.owner_id = listing.owner_id
           and source_attempt.channel = listing.channel_key
          join sellerpilot_private.channel_credentials current_credential
            on current_credential.id = p_credential_id
          join sellerpilot_private.exact_existing_update_permits permit
            on permit.listing_id = listing.id
         where listing.id = '${id.listing}'::uuid
           and listing.product_id = '${id.product}'::uuid
           and listing.remote_id = '800551945442'
           and attempt.status = 'failed'
           and attempt.http_status = 422
           and attempt.remote_id is null
           and attempt.gateway_write_required
           and attempt.request_fingerprint = '${latestFingerprint}'
         and attempt.pre_gateway_retryable
         and attempt.seller_account_key = listing.seller_account_key
         and current_credential.version > 0
         and not exists (
           select 1
             from sellerpilot_private.channel_gateway_jobs retry_job
            where retry_job.attempt_id = attempt.id
         )
           and (
             select count(*)
               from sellerpilot_private.marketplace_normalized_asset_refs ref
              where ref.attempt_id = attempt.id
           ) = 13
           and exists (
             select 1
               from sellerpilot_private.marketplace_normalized_asset_refs ref
              where ref.attempt_id = attempt.id
                and ref.object_path = '${representative}'
           )
         and (
                 permit.credential_id is distinct from p_credential_id
                 or permit.request_fingerprint is distinct from
                      p_request_fingerprint
               )
      );
    end;
    $$;

    create function sellerpilot_private.exact_existing_update_enqueue_gate_bypass_allowed(
      p_listing_id uuid,
      p_credential_id uuid,
      p_attempt_id uuid,
      p_channel text,
      p_operation text,
      p_request_payload jsonb
    ) returns boolean
    language sql stable security definer set search_path = '' as $$
      select case
        when p_channel = 'ebay' then true
        else coalesce((p_request_payload->>'predecessorAllowed')::boolean, false)
      end
    $$;

    create function public.sellerpilot_09010400_enqueue_before_ebay_exact_content_fence(
      p_listing_id uuid,
      p_credential_id uuid,
      p_attempt_id uuid,
      p_channel text,
      p_operation text,
      p_request_payload jsonb
    ) returns boolean
    language sql stable security definer set search_path = '' as $$
      select exists (
        select 1
          from sellerpilot_private.product_listings listing
         where listing.id = p_listing_id
           and listing.operation_attempt_id = any (array['${id.sourceAttempt}'::uuid,'${id.assetAttempt}'::uuid])
      )
    $$;

    create function sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(
      p_permit_id uuid
    ) returns boolean
    language sql stable security definer set search_path = '' as $$
      select true
    $$;

    insert into sellerpilot_private.channel_credentials values
      ('${id.historicalCredential}', 'ebay', 'production', 'revoked', 106,
       'A106A106A106', '${seller}', 'provider_certified_v1', now() - interval '1 day'),
      ('${id.currentCredential}', 'ebay', 'production', 'active', 107,
       'A107A107A107', '${seller}', 'provider_certified_v1', now());
    insert into sellerpilot_private.channel_operation_attempts values
      ('${id.latestAttempt}', '${id.owner}', '${id.historicalCredential}', 'ebay',
       'listing.update', 'failed', 422, null, true, true, '${latestFingerprint}', '${seller}'),
      ('${id.assetAttempt}', '${id.owner}', '${id.historicalCredential}', 'ebay',
       'listing.update', 'failed', 422, null, true, true, '${assetFingerprint}', '${seller}'),
      ('${id.sourceAttempt}', '${id.owner}', '${id.historicalCredential}', 'ebay',
       'listing.update', 'failed', 400, '800551945442', true, false,
       '${"79507d23bb865f17b7d91a148f564fef1519e36ce3b5d4219200c5b7d786a3dc"}', '${seller}'),
      ('${id.freshAttempt}', '${id.owner}', '${id.currentCredential}', 'ebay',
       'listing.update', 'running', null, null, true, false, '${currentFingerprint}', '${seller}');
    insert into sellerpilot_private.product_listings values
      ('${id.listing}', '${id.owner}', '${id.product}', 'ebay', 'US', 'EBAY_US',
       '800551945442', '${seller}', '${id.latestAttempt}');
    insert into sellerpilot_private.exact_existing_update_permits (
      permit_id, listing_id, channel, remote_id, credential_id, request_fingerprint
    ) values (
      '${id.permit}', '${id.listing}', 'ebay', '800551945442',
      '${id.historicalCredential}', '${latestFingerprint}'
    );
  `);

  await db.exec(migration);
  return db;
}

test("eBay pre-arm migration keeps historical attempts separate and never copies attempt refs", async () => {
  const [migration, priorProof, lineage, route] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(priorProofUrl, "utf8"),
    readFile(lineageUrl, "utf8"),
    readFile(routeUrl, "utf8"),
  ]);

  assert.match(priorProof, new RegExp(id.latestAttempt, "u"));
  assert.match(lineage, new RegExp(id.sourceAttempt, "u"));
  assert.match(migration, new RegExp(`asset_attempt[.]id = '${id.assetAttempt}'`, "u"));
  assert.match(migration, /ref[.]attempt_id = asset_attempt[.]id/u);
  assert.match(migration, /ref[.]attempt_id = source_attempt[.]id/u);
  assert.match(migration, /\) = 8[\s\S]*?except[\s\S]*?except/u);
  assert.match(priorProof, /count\(\*\) = 13/u);
  assert.doesNotMatch(
    migration,
    /(?:insert\s+into|update|delete\s+from)\s+sellerpilot_private[.]marketplace_normalized_asset_refs/iu,
  );
  assert.doesNotMatch(
    migration,
    /insert\s+into\s+sellerpilot_private[.](?:channel_gateway_jobs|channel_operation_attempts|exact_existing_update_permits)/iu,
  );

  const keyExpression = route.match(
    /boundEbayExactExistingQaRecovery\s*\?\s*`ebay-exact-v101:\$\{ebayExactExistingQaRecoveryIdentity[.]listingId\}:\$\{requestFingerprint\}`/u,
  );
  assert.ok(keyExpression, "the server-owned key must be selected only by the exact eBay recovery binding");
  const key = `ebay-exact-v101:${id.listing}:${currentFingerprint}`;
  assert.equal(key.length, 117);
  assert.ok(key.length <= 160);
  assert.match(
    route,
    /if \(channel === "ebay" && operation === "listing[.]update"\)[\s\S]*?boundEbayExactExistingQaRecovery = binding;/u,
  );
});

test("patched proof uses c9 assets equal to the 224 source while 079 remains a no-ref failed attempt", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = await setupDatabase(migration);
  const paths = [representative, ...Array.from({ length: 12 }, (_, index) => digestPath(index + 2))];
  try {
    for (const [index, path] of paths.entries()) {
      await seedRef(db, { attemptId: id.sourceAttempt, path, sourceBound: index < 8 });
      await seedRef(db, { attemptId: id.assetAttempt, path, sourceBound: index < 8 });
    }
    const proof = async () => (await db.query(
      `select sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(
        '${id.currentCredential}', '${"d".repeat(40)}', '${currentFingerprint}'
      ) value`,
    )).rows[0].value;

    assert.deepEqual(
      (await db.query(`
        select attempt_id::text, count(*)::integer ref_count
          from sellerpilot_private.marketplace_normalized_asset_refs
         group by attempt_id order by attempt_id
      `)).rows,
      [
        { attempt_id: id.sourceAttempt, ref_count: 13 },
        { attempt_id: id.assetAttempt, ref_count: 13 },
      ].sort((left, right) => left.attempt_id.localeCompare(right.attempt_id)),
    );
    assert.equal(
      (await db.query(`select count(*)::integer value from sellerpilot_private.marketplace_normalized_asset_refs where attempt_id='${id.latestAttempt}'`)).rows[0].value,
      0,
    );
    assert.equal(await proof(), true);

    const changedPath = paths.at(-1);
    await db.exec(`delete from sellerpilot_private.marketplace_normalized_asset_refs where attempt_id='${id.assetAttempt}' and object_path=${sqlString(changedPath)}`);
    assert.equal(await proof(), false, "12 c9 refs must fail the 13-ref equality proof");
    await seedRef(db, { attemptId: id.assetAttempt, path: changedPath, sourceBound: false });
    assert.equal(await proof(), true);
    await db.exec(`update sellerpilot_private.marketplace_normalized_asset_refs set canonical_public_url=canonical_public_url||'?changed=1' where attempt_id='${id.assetAttempt}' and object_path=${sqlString(changedPath)}`);
    assert.equal(await proof(), false, "same count with non-equal c9 evidence must fail");
  } finally {
    await db.close();
  }
});

test("fresh exact enqueue requires exactly nine complete current-attempt Storage refs and preserves predecessor behavior", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = await setupDatabase(migration);
  const paths = [representative, ...Array.from({ length: 8 }, (_, index) => digestPath(index + 100))];
  const extraPath = digestPath(999);
  const unavailableExtraPath = digestPath(1000);
  const exactPayload = exactPayloadFor(paths);
  const call = async (channel = "ebay", payload = exactPayload) => (await db.query(`
    select sellerpilot_private.exact_existing_update_enqueue_gate_bypass_allowed(
      '${id.listing}', '${id.currentCredential}', '${id.freshAttempt}',
      ${sqlString(channel)}, 'listing.update', ${sqlString(payload)}::jsonb
    ) value
  `)).rows[0].value;
  const providerFence = async () => (await db.query(`
    select sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(
      '${id.providerPermit}'
    ) value
  `)).rows[0].value;
  try {
    for (const [index, path] of paths.entries()) {
      const source = sourceBinding(index);
      await seedRef(db, {
        attemptId: id.freshAttempt,
        path,
        sourcePath: source.path,
        sourceSha: source.sha,
      });
    }
    assert.equal(await call(), true);
    await db.exec(`
      insert into sellerpilot_private.channel_gateway_jobs (
        id, attempt_id, listing_id, credential_id, channel, operation,
        request_fingerprint, request_payload
      ) values (
        '${id.providerJob}', '${id.freshAttempt}', '${id.listing}',
        '${id.currentCredential}', 'ebay', 'listing.update',
        '${currentFingerprint}', ${sqlString(exactPayload)}::jsonb
      );
      insert into sellerpilot_private.exact_existing_update_permits (
        permit_id, listing_id, channel, remote_id, credential_id,
        request_fingerprint, update_job_id, update_attempt_id
      ) values (
        '${id.providerPermit}', '${id.listing}', 'ebay', '800551945442',
        '${id.currentCredential}', '${currentFingerprint}',
        '${id.providerJob}', '${id.freshAttempt}'
      );
    `);
    assert.equal(await providerFence(), true);

    const extraTransportSource = JSON.parse(exactPayload);
    extraTransportSource.arguments.sellerpilotPublicationAssetBinding
      .providerTransportImages[1].approvedObjectPath = sourceBinding(1).path;
    extraTransportSource.arguments.sellerpilotPublicationAssetBinding
      .providerTransportImages[1].approvedSourceSha256 = sourceBinding(1).sha;
    assert.equal(
      await call("ebay", JSON.stringify(extraTransportSource)),
      false,
      "detail transport rows must keep source metadata only in approvedDetailImages",
    );

    const invalidDetailRole = JSON.parse(exactPayload);
    invalidDetailRole.arguments.sellerpilotPublicationAssetBinding
      .providerTransportImages[1].role = "invalid role";
    invalidDetailRole.arguments.sellerpilotPublicationAssetBinding
      .approvedDetailImages[0].role = "invalid role";
    assert.equal(
      await call("ebay", JSON.stringify(invalidDetailRole)),
      false,
      "detail roles must remain canonical and unique",
    );

    const ordinaryPath = paths[1];
    await db.exec(`delete from sellerpilot_private.marketplace_normalized_asset_refs where attempt_id='${id.freshAttempt}' and object_path=${sqlString(ordinaryPath)}`);
    assert.equal(await call(), false, "eight refs must fail");
    assert.equal(await providerFence(), false, "provider-time fence must fail after an enqueued ref disappears");
    await seedRef(db, {
      attemptId: id.freshAttempt,
      path: ordinaryPath,
      sourcePath: sourceBinding(1).path,
      sourceSha: sourceBinding(1).sha,
    });
    assert.equal(await providerFence(), true, "provider-time fence must recover only after the exact ref is restored");

    await seedRef(db, { attemptId: id.freshAttempt, path: extraPath });
    assert.equal(await call(), false, "ten refs must fail");
    await db.exec(`delete from sellerpilot_private.marketplace_normalized_asset_refs where attempt_id='${id.freshAttempt}' and object_path=${sqlString(extraPath)}`);

    await seedRef(db, {
      attemptId: id.freshAttempt,
      path: unavailableExtraPath,
    });
    await db.exec(`update sellerpilot_private.marketplace_normalized_assets set status='reserved', uploaded_at=null where object_path=${sqlString(unavailableExtraPath)}`);
    assert.equal(
      await call(),
      false,
      "an extra unavailable ref must not disappear from the exact raw ref count",
    );
    assert.equal(
      await providerFence(),
      false,
      "provider-time fence must reject an extra unavailable ref",
    );
    await db.exec(`delete from sellerpilot_private.marketplace_normalized_asset_refs where attempt_id='${id.freshAttempt}' and object_path=${sqlString(unavailableExtraPath)}`);
    assert.equal(await providerFence(), true);

    await db.exec(`update sellerpilot_private.marketplace_normalized_asset_refs set source_object_path=null, source_content_sha256=null where attempt_id='${id.freshAttempt}' and object_path=${sqlString(ordinaryPath)}`);
    assert.equal(await call(), false, "all nine refs must be source-bound");
    await db.exec(`update sellerpilot_private.marketplace_normalized_asset_refs set source_object_path=${sqlString(sourceBinding(1).path)}, source_content_sha256=${sqlString(sourceBinding(1).sha)} where attempt_id='${id.freshAttempt}' and object_path=${sqlString(ordinaryPath)}`);

    await db.exec(`update sellerpilot_private.marketplace_normalized_asset_refs set upload_confirmed_at=null where attempt_id='${id.freshAttempt}' and object_path=${sqlString(ordinaryPath)}`);
    assert.equal(await call(), false, "all nine refs must have upload confirmation");
    await db.exec(`update sellerpilot_private.marketplace_normalized_asset_refs set upload_confirmed_at=now() where attempt_id='${id.freshAttempt}' and object_path=${sqlString(ordinaryPath)}`);

    await db.exec(`update sellerpilot_private.marketplace_normalized_asset_refs set canonical_public_url='https://example.invalid/bad.jpg' where attempt_id='${id.freshAttempt}' and object_path=${sqlString(ordinaryPath)}`);
    assert.equal(await call(), false, "a non-canonical public URL must fail");
    assert.equal(await providerFence(), false, "provider-time fence must detect an enqueued canonical URL change");
    await db.exec(`update sellerpilot_private.marketplace_normalized_asset_refs set canonical_public_url=${sqlString(`https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/${ordinaryPath}`)} where attempt_id='${id.freshAttempt}' and object_path=${sqlString(ordinaryPath)}`);
    assert.equal(await providerFence(), true);

    await db.exec(`update sellerpilot_private.marketplace_normalized_assets set status='failed' where object_path=${sqlString(ordinaryPath)}`);
    assert.equal(await call(), false, "an unavailable normalized asset must fail");
    await db.exec(`update sellerpilot_private.marketplace_normalized_assets set status='available' where object_path=${sqlString(ordinaryPath)}`);

    await db.exec(`update sellerpilot_private.marketplace_normalized_asset_refs set object_path='normalized/aa/not-a-digest.jpg' where attempt_id='${id.freshAttempt}' and object_path=${sqlString(ordinaryPath)}`);
    assert.equal(await call(), false, "a malformed normalized path must fail");
    await db.exec(`update sellerpilot_private.marketplace_normalized_asset_refs set object_path=${sqlString(ordinaryPath)} where attempt_id='${id.freshAttempt}' and object_path='normalized/aa/not-a-digest.jpg'`);

    await db.exec(`delete from sellerpilot_private.marketplace_normalized_asset_refs where attempt_id='${id.freshAttempt}' and object_path=${sqlString(representative)}`);
    await seedRef(db, { attemptId: id.freshAttempt, path: extraPath });
    assert.equal(await call(), false, "nine valid refs without the exact representative must fail");

    assert.equal(await call("qoo10", JSON.stringify({ predecessorAllowed: true })), true);
    assert.equal(await call("qoo10", JSON.stringify({ predecessorAllowed: false })), false);

    const metadata = (await db.query(`
      select procedure.prosecdef,
             procedure.provolatile,
             procedure.proconfig,
             count(*) filter (
               where privilege.privilege_type = 'EXECUTE'
                 and coalesce(grantee.rolname, 'PUBLIC') in
                   ('PUBLIC', 'anon', 'authenticated', 'service_role')
             )::integer exposed_count
        from pg_catalog.pg_proc procedure
        join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
        left join lateral pg_catalog.aclexplode(coalesce(
          procedure.proacl, pg_catalog.acldefault('f', procedure.proowner)
        )) privilege on true
        left join pg_catalog.pg_roles grantee on grantee.oid=privilege.grantee
       where namespace.nspname='sellerpilot_private'
         and procedure.proname='exact_existing_update_enqueue_gate_bypass_allowed'
       group by procedure.prosecdef, procedure.provolatile, procedure.proconfig
    `)).rows[0];
    assert.equal(metadata.prosecdef, true);
    assert.equal(metadata.provolatile, "s");
    assert.deepEqual(metadata.proconfig, ["search_path=\"\""]);
    assert.equal(metadata.exposed_count, 0);
  } finally {
    await db.close();
  }
});
