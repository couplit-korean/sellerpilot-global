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
const freshFailedRearmUrl = new URL(
  "../supabase/migrations/20260902108000_rearm_ebay_exact_from_fresh_failed_attempt.sql",
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
  productionFreshAttempt: "3ffaf977-3950-4a74-af02-16b4cd930ac9",
  productionCredential: "16fcd1f9-6c9f-45f7-bb5e-05e3a558f2ea",
  rotatedCredential: "9d5d4f30-099d-4e55-9bea-b71cc2334850",
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
           and credential.version = (
             select max(candidate.version)
               from sellerpilot_private.channel_credentials candidate
              where candidate.channel = 'ebay'
                and candidate.environment = 'production'
                and candidate.seller_account_key = p_seller_account_key
           )
           and 1 = (
             select count(*)
               from sellerpilot_private.channel_credentials active_credential
              where active_credential.channel = 'ebay'
                and active_credential.environment = 'production'
                and active_credential.status = 'active'
                and active_credential.seller_account_key = p_seller_account_key
           )
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

test("release 62bd fresh failure permits only one exact same-seller JIT rearm proof", async () => {
  const [prearmMigration, freshFailedRearmMigration, route] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(freshFailedRearmUrl, "utf8"),
    readFile(routeUrl, "utf8"),
  ]);
  const db = await setupDatabase(prearmMigration);
  const runtimeRelease = "d".repeat(40);
  const historicalPaths = [
    representative,
    ...Array.from({ length: 12 }, (_, index) => digestPath(index + 400)),
  ];
  const freshPaths = [
    representative,
    ...Array.from({ length: 8 }, (_, index) => digestPath(index + 500)),
  ];
  const proof = async () => (await db.query(`
    select sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(
      '${id.rotatedCredential}', '${runtimeRelease}', '${currentFingerprint}'
    ) value
  `)).rows[0].value;
  const helperProof = async (
    release = runtimeRelease,
    credential = id.rotatedCredential,
  ) => (await db.query(`
    select sellerpilot_private.ebay_exact_atomic_recovery_state_is_current(
      '${credential}', '${release}', '${id.productionFreshAttempt}'
    ) value
  `)).rows[0].value;
  const atomicCall = async (
    credential = id.rotatedCredential,
  ) => (await db.query(`
    select public.sellerpilot_service_atomic_enqueue_ebay_exact_v101_retry(
      '${id.listing}', '${credential}',
      '${id.productionFreshAttempt}', '${runtimeRelease}',
      '${currentFingerprint}', ${sqlString(exactPayloadFor(freshPaths))}::jsonb
    ) value
  `)).rows[0].value;
  try {
    await db.exec(`
      alter table sellerpilot_private.channel_operation_attempts
        add column started_at timestamptz,
        add column completed_at timestamptz;
      alter table sellerpilot_private.channel_credentials
        add column expires_at timestamptz,
        add column last_checked_at timestamptz,
        add column last_check_status text;
      alter table sellerpilot_private.product_listings
        add column status text,
        add column failure_class text,
        add column marketplace_sku text,
        add column provider_resource_id text,
        add column remote_resources jsonb,
        add column currency text,
        add column price numeric,
        add column requested_publication_intent text,
        add column remote_visibility text,
        add column provider_status text,
        add column published_at timestamptz;
      alter table sellerpilot_private.exact_existing_update_permits
        add column product_id uuid,
        add column owner_id uuid,
        add column market text,
        add column target_id text,
        add column seller_sku text,
        add column provider_resource_id text,
        add column currency text,
        add column price numeric,
        add column stock integer,
        add column seller_account_key text,
        add column release_sha text,
        add column armed_at timestamptz,
        add column expires_at timestamptz,
        add column retry_source_attempt_id uuid,
        add column bound_at timestamptz,
        add column bound_worker_token_id uuid,
        add column bound_claim_token uuid,
        add column consumed_at timestamptz,
        add column invalidated_at timestamptz,
        add column invalidation_reason text,
        add column arguments_sha256 text,
        add column arguments_bytes integer,
        add column request_payload_sha256 text,
        add column request_payload_bytes integer,
        add column credential_version integer,
        add column credential_fingerprint text,
        add column credential_account_source text,
        add column credential_verified_at timestamptz,
        add column credential_expires_at timestamptz,
        add column credential_last_checked_at timestamptz,
        add column credential_last_check_status text;
      alter table sellerpilot_private.channel_gateway_jobs
        add column environment text,
        add column status text,
        add column attempt_count integer,
        add column seller_account_key text,
        add column worker_token_id uuid,
        add column claim_token uuid,
        add column provider_mutation_started_at timestamptz,
        add column response_payload jsonb,
        add column error_message text,
        add column completed_at timestamptz;
      create table sellerpilot_private.products (
        id uuid primary key,
        owner_id uuid not null,
        sku text not null,
        on_hand integer not null,
        demo boolean not null,
        status text not null
      );
      create function sellerpilot_private.exact_existing_update_release_is_current(
        p_channel text, p_release_sha text
      ) returns boolean language sql stable set search_path = '' as $$
        select p_channel = 'ebay' and p_release_sha = '${runtimeRelease}'
      $$;

      create function sellerpilot_private.guard_exact_existing_update_permit_transition()
      returns trigger language plpgsql set search_path = '' as $$
declare
  v_mutable_fields constant text[] := array[
    'update_job_id', 'update_attempt_id', 'arguments_sha256',
    'arguments_bytes', 'request_payload_sha256', 'request_payload_bytes',
    'bound_at', 'bound_worker_token_id', 'bound_claim_token', 'consumed_at',
    'invalidated_at', 'invalidation_reason'
  ];
begin
  if tg_op = 'DELETE' then
    raise exception 'exact existing update permits cannot be deleted'
      using errcode = '55000';
  end if;
  if to_jsonb(new) - v_mutable_fields is distinct from
       to_jsonb(old) - v_mutable_fields
  then
    raise exception 'exact existing update permit identity is immutable'
      using errcode = '55000';
  end if;

  if old.update_job_id is null
     and old.update_attempt_id is null
     and new.update_job_id is not null
     and new.update_attempt_id is not null
     and to_jsonb(new) - array[
       'update_job_id', 'update_attempt_id', 'arguments_sha256',
       'arguments_bytes', 'request_payload_sha256',
       'request_payload_bytes'
     ] is not distinct from to_jsonb(old) - array[
       'update_job_id', 'update_attempt_id', 'arguments_sha256',
       'arguments_bytes', 'request_payload_sha256',
       'request_payload_bytes'
     ]
  then return new; end if;
  if old.update_job_id is not null
     and new.update_job_id = old.update_job_id
     and new.update_attempt_id = old.update_attempt_id
     and old.bound_at is null
     and old.bound_worker_token_id is null
     and old.bound_claim_token is null
     and new.bound_at is not null
     and new.bound_worker_token_id is not null
     and new.bound_claim_token is not null
     and to_jsonb(new) - array[
       'bound_at', 'bound_worker_token_id', 'bound_claim_token'
     ] is not distinct from to_jsonb(old) - array[
       'bound_at', 'bound_worker_token_id', 'bound_claim_token'
     ]
  then return new; end if;
  if old.bound_at is not null
     and new.bound_at = old.bound_at
     and new.bound_worker_token_id = old.bound_worker_token_id
     and new.bound_claim_token = old.bound_claim_token
     and old.consumed_at is null
     and new.consumed_at is not null
     and to_jsonb(new) - 'consumed_at' is not distinct from
         to_jsonb(old) - 'consumed_at'
  then return new; end if;
  raise exception 'exact existing update permit transition invalid'
    using errcode = '55000';
end;
      $$;
      create function public.sellerpilot_service_enqueue_listing_gateway_job(
        p_listing_id uuid,
        p_credential_id uuid,
        p_attempt_id uuid,
        p_channel text,
        p_operation text,
        p_request_payload jsonb
      ) returns jsonb language plpgsql security definer set search_path = '' as $$
      declare
        v_job_id constant uuid := '${id.providerJob}'::uuid;
      begin
        insert into sellerpilot_private.channel_gateway_jobs (
          id, attempt_id, listing_id, credential_id, channel, operation,
          request_fingerprint, request_payload, environment, status,
          attempt_count, seller_account_key
        ) values (
          v_job_id, p_attempt_id, p_listing_id, p_credential_id,
          p_channel, p_operation, '${currentFingerprint}', p_request_payload,
          'production', 'queued', 0, '${seller}'
        );
        update sellerpilot_private.exact_existing_update_permits
           set update_job_id = v_job_id,
               update_attempt_id = p_attempt_id,
               arguments_sha256 = repeat('a', 64), arguments_bytes = 100,
               request_payload_sha256 = repeat('b', 64),
               request_payload_bytes = 100
         where permit_id = '${id.permit}';
        update sellerpilot_private.product_listings
           set status = 'queued', failure_class = null,
               operation_attempt_id = p_attempt_id
         where id = p_listing_id;
        return jsonb_build_object(
          'status', 'queued', 'job_id', v_job_id,
          'attempt_id', p_attempt_id, 'listing_id', p_listing_id,
          'reused', false
        );
      end;
      $$;

      insert into sellerpilot_private.products (
        id, owner_id, sku, on_hand, demo, status
      ) values (
        '${id.product}', '${id.owner}', 'QA-20260823-CC-001', 1, false, 'active'
      );
      update sellerpilot_private.channel_credentials
         set status = 'revoked'
       where id = '${id.currentCredential}';
      insert into sellerpilot_private.channel_credentials (
        id, channel, environment, status, version, fingerprint,
        seller_account_key, seller_account_key_source,
        seller_account_verified_at
      ) values (
        '${id.productionCredential}', 'ebay', 'production', 'revoked', 108,
        'A108A108A108', '${seller}', 'provider_certified_v1',
        '2026-09-02 06:20:00+00'
      ), (
        '${id.rotatedCredential}', 'ebay', 'production', 'active', 109,
        'A109A109A109', '${seller}', 'provider_certified_v1',
        '2026-09-02 07:26:00+00'
      );
      update sellerpilot_private.channel_credentials
         set expires_at = '2030-01-01 00:00:00+00',
             last_checked_at = case
               when id = '${id.rotatedCredential}'::uuid
                 then '2026-09-02 07:26:00+00'::timestamptz
               else '2026-09-02 06:25:00+00'::timestamptz
             end,
             last_check_status = 'passed'
       where id in ('${id.productionCredential}', '${id.rotatedCredential}');
      insert into sellerpilot_private.channel_operation_attempts (
        id, owner_id, credential_id, channel, operation, status, http_status,
        remote_id, gateway_write_required, pre_gateway_retryable,
        request_fingerprint, seller_account_key, started_at, completed_at
      ) values (
        '${id.productionFreshAttempt}', '${id.owner}',
        '${id.productionCredential}', 'ebay', 'listing.update', 'failed', 422,
        null, true, true, '${currentFingerprint}', '${seller}',
        '2026-09-02 06:26:46.362671+00',
        '2026-09-02 06:26:54.769797+00'
      );
      update sellerpilot_private.product_listings
         set status = 'failed', failure_class = 'retryable',
             marketplace_sku = 'QA-20260823-CC-001-US',
             provider_resource_id = '244042196011',
             remote_resources = '{}'::jsonb, currency = 'USD', price = 12.90,
             requested_publication_intent = 'live',
             remote_visibility = 'unknown', provider_status = null,
             published_at = null
       where id = '${id.listing}';
      update sellerpilot_private.exact_existing_update_permits
         set product_id = '${id.product}', owner_id = '${id.owner}',
             market = 'US', target_id = 'EBAY_US',
             seller_sku = 'QA-20260823-CC-001-US',
             provider_resource_id = '244042196011', currency = 'USD',
             price = 12.90, stock = 1, seller_account_key = '${seller}',
             credential_id = '${id.productionCredential}',
             release_sha = '62bd8810d5e54d0f98880d1cb4be5c17b6ad2e76',
             request_fingerprint = '${currentFingerprint}',
             armed_at = '2026-09-02 06:26:46.052592+00',
             expires_at = '2026-09-02 06:31:46.052592+00',
             retry_source_attempt_id = '${id.sourceAttempt}',
             update_job_id = null, update_attempt_id = null,
             arguments_sha256 = null, arguments_bytes = null,
             request_payload_sha256 = null, request_payload_bytes = null,
             bound_at = null, bound_worker_token_id = null,
             bound_claim_token = null, consumed_at = null,
             invalidated_at = null, invalidation_reason = null
       where permit_id = '${id.permit}';
      create trigger guard_exact_existing_update_permit_transition
      before update or delete on sellerpilot_private.exact_existing_update_permits
      for each row execute function
        sellerpilot_private.guard_exact_existing_update_permit_transition();
    `);

    for (const [index, path] of historicalPaths.entries()) {
      const source = sourceBinding(index);
      await seedRef(db, {
        attemptId: id.sourceAttempt,
        path,
        sourceBound: index < 8,
        sourcePath: source.path,
        sourceSha: source.sha,
      });
      await seedRef(db, {
        attemptId: id.assetAttempt,
        path,
        sourceBound: index < 8,
        sourcePath: source.path,
        sourceSha: source.sha,
      });
    }
    for (const [index, path] of freshPaths.entries()) {
      const source = sourceBinding(index);
      await seedRef(db, {
        attemptId: id.productionFreshAttempt,
        path,
        sourcePath: source.path,
        sourceSha: source.sha,
      });
    }

    const predecessorProofBefore = await proof();
    assert.equal(
      predecessorProofBefore,
      true,
      "the unchanged predecessor still observes the real source-to-current rotation",
    );
    await db.exec(freshFailedRearmMigration);
    assert.equal(
      await helperProof(),
      false,
      "the durable marker alone must not authorize the still-failed attempt",
    );
    assert.equal(
      await proof(),
      predecessorProofBefore,
      "the generic predecessor proof stays unchanged",
    );
    assert.deepEqual(
      (await db.query(`
        select count(*)::integer marker_count,
               coalesce((select jsonb_array_length(reference_set)
                           from sellerpilot_private.ebay_exact_atomic_recovery_markers
                          limit 1), 0)::integer ref_count
          from sellerpilot_private.ebay_exact_atomic_recovery_markers
      `)).rows[0],
      { marker_count: 1, ref_count: 9 },
    );

    // Model the real claim RPC transition: it revives 3ffa to running and
    // clears the failed HTTP/pre-gateway/completed fields before preparation.
    await db.exec(`
      update sellerpilot_private.channel_operation_attempts
         set credential_id='${id.rotatedCredential}',
             status='running', http_status=null, pre_gateway_retryable=false,
             started_at='2026-09-02 07:00:00+00', completed_at=null
       where id='${id.productionFreshAttempt}'
    `);
    assert.equal(await helperProof(), true);

    const changedPath = freshPaths.at(-1);
    await db.exec(`delete from sellerpilot_private.marketplace_normalized_asset_refs where attempt_id='${id.productionFreshAttempt}' and object_path=${sqlString(changedPath)}`);
    assert.equal(await helperProof(), false, "eight fresh refs must fail the recovery fence");
    await seedRef(db, {
      attemptId: id.productionFreshAttempt,
      path: changedPath,
      sourcePath: sourceBinding(8).path,
      sourceSha: sourceBinding(8).sha,
    });
    assert.equal(await helperProof(), true);

    const tenthPath = digestPath(599);
    await seedRef(db, {
      attemptId: id.productionFreshAttempt,
      path: tenthPath,
      sourcePath: "results/source/tenth.png",
      sourceSha: "f".repeat(64),
    });
    assert.equal(await helperProof(), false, "ten fresh refs must fail the exact raw count");
    await db.exec(`delete from sellerpilot_private.marketplace_normalized_asset_refs where attempt_id='${id.productionFreshAttempt}' and object_path=${sqlString(tenthPath)}`);

    await db.exec(`update sellerpilot_private.marketplace_normalized_assets set status='failed' where object_path=${sqlString(changedPath)}`);
    assert.equal(await helperProof(), false, "an unavailable fresh asset must fail");
    await db.exec(`update sellerpilot_private.marketplace_normalized_assets set status='available' where object_path=${sqlString(changedPath)}`);

    await db.exec(`update sellerpilot_private.marketplace_normalized_asset_refs set canonical_public_url='https://example.invalid/not-canonical.jpg' where attempt_id='${id.productionFreshAttempt}' and object_path=${sqlString(changedPath)}`);
    assert.equal(await helperProof(), false, "a non-canonical fresh URL must fail");
    await db.exec(`update sellerpilot_private.marketplace_normalized_asset_refs set canonical_public_url=${sqlString(`https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/${changedPath}`)} where attempt_id='${id.productionFreshAttempt}' and object_path=${sqlString(changedPath)}`);

    await db.exec(`update sellerpilot_private.marketplace_normalized_asset_refs set source_object_path=null, source_content_sha256=null where attempt_id='${id.productionFreshAttempt}' and object_path=${sqlString(changedPath)}`);
    assert.equal(await helperProof(), false, "all nine fresh refs must be source-bound");
    await db.exec(`update sellerpilot_private.marketplace_normalized_asset_refs set source_object_path=${sqlString(sourceBinding(8).path)}, source_content_sha256=${sqlString(sourceBinding(8).sha)} where attempt_id='${id.productionFreshAttempt}' and object_path=${sqlString(changedPath)}`);

    await db.exec(`
      insert into sellerpilot_private.channel_gateway_jobs (
        attempt_id, listing_id, credential_id, channel, operation,
        request_fingerprint, request_payload
      ) values (
        '${id.productionFreshAttempt}', '${id.listing}',
        '${id.productionCredential}', 'ebay', 'listing.update',
        '${currentFingerprint}', '{}'::jsonb
      )
    `);
    assert.equal(await helperProof(), false, "any fresh-attempt gateway job must fail");
    await db.exec(`delete from sellerpilot_private.channel_gateway_jobs where attempt_id='${id.productionFreshAttempt}'`);

    assert.equal(
      await helperProof("e".repeat(40)),
      false,
      "a non-current runtime release cannot borrow the frozen source permit",
    );

    await db.exec(`update sellerpilot_private.channel_operation_attempts set started_at='2026-09-02 06:26:54.769797+00' where id='${id.productionFreshAttempt}'`);
    assert.equal(await helperProof(), false, "the revived claim must start after the frozen failure");
    await db.exec(`update sellerpilot_private.channel_operation_attempts set started_at='2026-09-02 07:00:00+00' where id='${id.productionFreshAttempt}'`);

    await db.exec(`update sellerpilot_private.product_listings set provider_resource_id='changed-offer' where id='${id.listing}'`);
    assert.equal(await helperProof(), false, "the eBay offer tuple must remain exact");
    await db.exec(`update sellerpilot_private.product_listings set provider_resource_id='244042196011' where id='${id.listing}'`);
    assert.equal(await helperProof(), true);
    assert.equal(
      await helperProof(runtimeRelease, id.currentCredential),
      false,
      "another credential cannot borrow the exact production proof",
    );

    await db.exec(`set "request.jwt.claim.role" = 'service_role'`);
    await assert.rejects(
      atomicCall(id.productionCredential),
      /query returned no rows|atomic recovery request invalid/u,
      "the revoked source credential cannot be reused for the new enqueue",
    );
    const duplicateCredential = "d0d0d0d0-d0d0-40d0-80d0-d0d0d0d0d0d0";
    await db.exec(`
      insert into sellerpilot_private.channel_credentials (
        id, channel, environment, status, version, fingerprint,
        seller_account_key, seller_account_key_source,
        seller_account_verified_at, expires_at, last_checked_at,
        last_check_status
      ) values (
        '${duplicateCredential}', 'ebay', 'production', 'active', 110,
        'A110A110A110', '${seller}', 'provider_certified_v1',
        statement_timestamp(), '2030-01-01 00:00:00+00',
        statement_timestamp(), 'passed'
      )
    `);
    await assert.rejects(
      atomicCall(),
      /query returned no rows|atomic recovery request invalid/u,
      "two active same-seller credentials must fail closed",
    );
    await db.exec(`delete from sellerpilot_private.channel_credentials where id='${duplicateCredential}'`);
    assert.equal(await helperProof(), true);

    await db.exec(`update sellerpilot_private.marketplace_normalized_asset_refs set canonical_public_url='https://example.invalid/not-canonical.jpg' where attempt_id='${id.productionFreshAttempt}' and object_path=${sqlString(changedPath)}`);
    await assert.rejects(
      atomicCall(),
      /atomic (?:fresh recovery state|recovery request) invalid/u,
      "a bad current-attempt ref must roll back before permit rearm or enqueue",
    );
    assert.deepEqual(
      (await db.query(`
        select release_sha, update_job_id, update_attempt_id
          from sellerpilot_private.exact_existing_update_permits
         where permit_id='${id.permit}'
      `)).rows[0],
      {
        release_sha: "62bd8810d5e54d0f98880d1cb4be5c17b6ad2e76",
        update_job_id: null,
        update_attempt_id: null,
      },
    );
    assert.equal(
      (await db.query(`select count(*)::integer value from sellerpilot_private.channel_gateway_jobs where attempt_id='${id.productionFreshAttempt}'`)).rows[0].value,
      0,
    );
    await db.exec(`update sellerpilot_private.marketplace_normalized_asset_refs set canonical_public_url=${sqlString(`https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/${changedPath}`)} where attempt_id='${id.productionFreshAttempt}' and object_path=${sqlString(changedPath)}`);

    const queued = await atomicCall();
    assert.deepEqual(queued, {
      contract: "ebay_exact_v101_atomic_enqueue_v1",
      status: "queued",
      jobId: id.providerJob,
      attemptId: id.productionFreshAttempt,
      listingId: id.listing,
      reused: false,
      releaseSha: runtimeRelease,
      requestFingerprint: currentFingerprint,
    });
    assert.deepEqual(
      (await db.query(`
        select release_sha, update_job_id::text, update_attempt_id::text
          from sellerpilot_private.exact_existing_update_permits
         where permit_id='${id.permit}'
      `)).rows[0],
      {
        release_sha: runtimeRelease,
        update_job_id: id.providerJob,
        update_attempt_id: id.productionFreshAttempt,
      },
    );

    const replay = await atomicCall();
    assert.deepEqual(replay, {
      contract: "ebay_exact_v101_atomic_enqueue_v1",
      status: "in_progress",
      jobId: id.providerJob,
      attemptId: id.productionFreshAttempt,
      listingId: id.listing,
      reused: true,
      releaseSha: runtimeRelease,
      requestFingerprint: currentFingerprint,
    });
    assert.equal(
      (await db.query(`select count(*)::integer value from sellerpilot_private.channel_gateway_jobs where attempt_id='${id.productionFreshAttempt}'`)).rows[0].value,
      1,
      "two serialized/concurrent-equivalent calls must converge on one job",
    );

    const successorCredential = "e0e0e0e0-e0e0-40e0-80e0-e0e0e0e0e0e0";
    await db.exec(`
      update sellerpilot_private.channel_credentials
         set status='grace'
       where id='${id.rotatedCredential}';
      insert into sellerpilot_private.channel_credentials (
        id, channel, environment, status, version, fingerprint,
        seller_account_key, seller_account_key_source,
        seller_account_verified_at, expires_at, last_checked_at,
        last_check_status
      ) values (
        '${successorCredential}', 'ebay', 'production', 'active', 110,
        'A110A110A110', '${seller}', 'provider_certified_v1',
        statement_timestamp(), '2030-01-01 00:00:00+00',
        statement_timestamp(), 'passed'
      )
    `);
    assert.deepEqual(
      await atomicCall(successorCredential),
      replay,
      "a later current credential must read-only converge on the already-bound execution job",
    );
    await db.exec(`update sellerpilot_private.channel_credentials set status='revoked' where id='${id.rotatedCredential}'`);
    assert.equal((await atomicCall(successorCredential)).jobId, id.providerJob);
    assert.deepEqual(
      (await db.query(`
        select permit.credential_id::text permit_credential,
               attempt.credential_id::text attempt_credential,
               job.credential_id::text job_credential,
               count(*) over ()::integer job_count
          from sellerpilot_private.exact_existing_update_permits permit
          join sellerpilot_private.channel_operation_attempts attempt
            on attempt.id=permit.update_attempt_id
          join sellerpilot_private.channel_gateway_jobs job
            on job.id=permit.update_job_id
         where permit.permit_id='${id.permit}'
      `)).rows[0],
      {
        permit_credential: id.rotatedCredential,
        attempt_credential: id.rotatedCredential,
        job_credential: id.rotatedCredential,
        job_count: 1,
      },
      "replay after rotation must neither rebind nor enqueue",
    );
    await db.exec(`update sellerpilot_private.channel_credentials set version=109 where id='${id.productionCredential}'`);
    await assert.rejects(
      atomicCall(successorCredential),
      /atomic fresh recovery state invalid/u,
      "the source credential version must remain lower than the execution credential version",
    );
    await db.exec(`update sellerpilot_private.channel_credentials set version=108 where id='${id.productionCredential}'`);
    assert.equal((await atomicCall(successorCredential)).jobId, id.providerJob);

    const workerToken = "a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0";
    const claimToken = "b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0";
    await db.exec(`
      update sellerpilot_private.exact_existing_update_permits
         set bound_at=statement_timestamp(),
             bound_worker_token_id='${workerToken}',
             bound_claim_token='${claimToken}'
       where permit_id='${id.permit}';
      update sellerpilot_private.channel_gateway_jobs
         set status='running', worker_token_id='${workerToken}',
             claim_token='${claimToken}'
       where id='${id.providerJob}'
    `);
    assert.deepEqual(
      await atomicCall(successorCredential),
      replay,
      "a claimed running job with exact permit tokens must remain replay-safe",
    );

    await db.exec(`
      update sellerpilot_private.channel_gateway_jobs
         set provider_mutation_started_at=statement_timestamp()
       where id='${id.providerJob}'
    `);
    await assert.rejects(
      atomicCall(successorCredential),
      /atomic (?:fresh recovery state|recovery request) invalid/u,
      "provider start without permit consumption must fail closed",
    );
    await db.exec(`
      update sellerpilot_private.exact_existing_update_permits
         set consumed_at=(select provider_mutation_started_at
                            from sellerpilot_private.channel_gateway_jobs
                           where id='${id.providerJob}')
       where permit_id='${id.permit}'
    `);
    assert.equal(
      (await atomicCall(successorCredential)).jobId,
      id.providerJob,
      "a consumed provider-started job must converge on the same job",
    );

    await db.exec(`
      update sellerpilot_private.channel_gateway_jobs
         set claim_token='c0c0c0c0-c0c0-40c0-80c0-c0c0c0c0c0c0'
       where id='${id.providerJob}'
    `);
    await assert.rejects(
      atomicCall(successorCredential),
      /atomic (?:fresh recovery state|recovery request) invalid/u,
      "a worker claim-token mismatch must not reuse the bound job",
    );
    await db.exec(`
      update sellerpilot_private.channel_gateway_jobs
         set claim_token='${claimToken}'
       where id='${id.providerJob}'
    `);
    assert.equal((await atomicCall(successorCredential)).jobId, id.providerJob);

    await db.exec(`delete from sellerpilot_private.marketplace_normalized_asset_refs where attempt_id='${id.productionFreshAttempt}' and object_path=${sqlString(changedPath)}`);
    await assert.rejects(
      atomicCall(successorCredential),
      /atomic (?:fresh recovery state|recovery request) invalid/u,
      "provider-time replay must fail closed after ref drift",
    );
    assert.equal(
      (await db.query(`select count(*)::integer value from sellerpilot_private.channel_gateway_jobs where attempt_id='${id.productionFreshAttempt}'`)).rows[0].value,
      1,
    );
    await seedRef(db, {
      attemptId: id.productionFreshAttempt,
      path: changedPath,
      sourcePath: sourceBinding(8).path,
      sourceSha: sourceBinding(8).sha,
    });
    assert.equal((await atomicCall(successorCredential)).jobId, id.providerJob);

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
         and procedure.proname='ebay_exact_atomic_recovery_state_is_current'
       group by procedure.prosecdef, procedure.provolatile, procedure.proconfig
    `)).rows[0];
    assert.equal(metadata.prosecdef, true);
    assert.equal(metadata.provolatile, "s");
    assert.deepEqual(metadata.proconfig, ["search_path=\"\""]);
    assert.equal(metadata.exposed_count, 0);

    const atomicMetadata = (await db.query(`
      select procedure.prosecdef,
             procedure.provolatile,
             procedure.proconfig,
             pg_catalog.has_function_privilege(
               'service_role', procedure.oid, 'EXECUTE'
             ) service_execute,
             pg_catalog.has_function_privilege(
               'authenticated', procedure.oid, 'EXECUTE'
             ) authenticated_execute,
             pg_catalog.has_function_privilege(
               'anon', procedure.oid, 'EXECUTE'
             ) anon_execute,
             exists (
               select 1 from pg_catalog.aclexplode(coalesce(
                 procedure.proacl,
                 pg_catalog.acldefault('f', procedure.proowner)
               )) privilege
                where privilege.grantee = 0
                  and privilege.privilege_type = 'EXECUTE'
             ) public_execute
        from pg_catalog.pg_proc procedure
        join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
       where namespace.nspname='public'
         and procedure.proname='sellerpilot_service_atomic_enqueue_ebay_exact_v101_retry'
    `)).rows[0];
    assert.equal(atomicMetadata.prosecdef, true);
    assert.equal(atomicMetadata.provolatile, "v");
    assert.deepEqual(atomicMetadata.proconfig, ["search_path=\"\""]);
    assert.equal(atomicMetadata.service_execute, true);
    assert.equal(atomicMetadata.authenticated_execute, false);
    assert.equal(atomicMetadata.anon_execute, false);
    assert.equal(atomicMetadata.public_execute, false);

    assert.deepEqual(
      (await db.query(`
        select class.relrowsecurity,
               count(*) filter (
                 where privilege.privilege_type is not null
                   and coalesce(grantee.rolname, 'PUBLIC') in
                     ('PUBLIC', 'anon', 'authenticated', 'service_role')
               )::integer exposed_count,
               exists (
                 select 1 from pg_catalog.pg_trigger trigger
                  where trigger.tgrelid=class.oid
                    and trigger.tgname='guard_ebay_exact_atomic_recovery_marker'
                    and not trigger.tgisinternal
               ) append_only_trigger
          from pg_catalog.pg_class class
          join pg_catalog.pg_namespace namespace on namespace.oid=class.relnamespace
          left join lateral pg_catalog.aclexplode(coalesce(
            class.relacl, pg_catalog.acldefault('r', class.relowner)
          )) privilege on true
          left join pg_catalog.pg_roles grantee on grantee.oid=privilege.grantee
         where namespace.nspname='sellerpilot_private'
           and class.relname='ebay_exact_atomic_recovery_markers'
         group by class.oid, class.relrowsecurity
      `)).rows[0],
      { relrowsecurity: true, exposed_count: 0, append_only_trigger: true },
    );
    await assert.rejects(
      db.exec(`update sellerpilot_private.ebay_exact_atomic_recovery_markers set recorded_at=recorded_at`),
      /append-only/u,
    );
    await assert.rejects(
      db.exec(`delete from sellerpilot_private.ebay_exact_atomic_recovery_markers`),
      /append-only/u,
    );

    assert.match(freshFailedRearmMigration, new RegExp(id.productionFreshAttempt, "u"));
    assert.match(freshFailedRearmMigration, new RegExp(id.productionCredential, "u"));
    assert.doesNotMatch(
      freshFailedRearmMigration,
      new RegExp(id.rotatedCredential, "u"),
      "the current credential UUID must be resolved dynamically",
    );
    assert.match(freshFailedRearmMigration, /62bd8810d5e54d0f98880d1cb4be5c17b6ad2e76/u);
    assert.match(freshFailedRearmMigration, /2026-09-02 06:26:46[.]052592[+]00/u);
    assert.match(freshFailedRearmMigration, /2026-09-02 06:31:46[.]052592[+]00/u);
    assert.match(freshFailedRearmMigration, /jsonb_array_length\(reference_set\) = 9/u);
    const replayReturnIndex = freshFailedRearmMigration.indexOf(
      "'status', 'in_progress'",
    );
    const rotationLockIndex = freshFailedRearmMigration.indexOf(
      "pg_catalog.hashtext('sellerpilot:ebay:production')",
    );
    const freshCredentialSelectIndex = freshFailedRearmMigration.indexOf(
      "select credential.* into strict v_credential",
    );
    assert.ok(replayReturnIndex >= 0);
    assert.ok(
      rotationLockIndex > replayReturnIndex,
      "read-only replay must return before taking the fresh rotation lock",
    );
    assert.ok(
      freshCredentialSelectIndex > rotationLockIndex,
      "fresh current selection must occur under the shared rotation lock",
    );
    assert.match(
      freshFailedRearmMigration,
      /source_credential[.]version < current_credential[.]version/u,
    );
    assert.match(
      freshFailedRearmMigration,
      /new[.]credential_version = current_credential[.]version[\s\S]*?new[.]credential_fingerprint = current_credential[.]fingerprint/u,
    );
    assert.doesNotMatch(
      freshFailedRearmMigration,
      /(?:insert\s+into|update|delete\s+from)\s+sellerpilot_private[.](?:channel_gateway_jobs|channel_operation_attempts|marketplace_normalized_asset_refs)/iu,
    );
    assert.doesNotMatch(
      freshFailedRearmMigration,
      /insert\s+into\s+sellerpilot_private[.]channel_gateway_jobs/iu,
    );
    assert.match(
      freshFailedRearmMigration,
      /sellerpilot_service_enqueue_listing_gateway_job/u,
    );

    const claimIndex = route.indexOf('"sellerpilot_claim_channel_operation"');
    const prepareIndex = route.indexOf("await prepareMarketplaceImages(serviceClient, channel, effectiveArguments");
    const assertIndex = route.indexOf("assertEbayExactExistingQaProviderCopyRequest(gatewayArguments)");
    const atomicIndex = route.indexOf('"sellerpilot_service_atomic_enqueue_ebay_exact_v101_retry"');
    const waitIndex = route.indexOf("await waitForEbayExactAtomicGatewayJob({");
    const genericIndex = route.indexOf("} else {\n        gatewayExecution = await executeViaChannelGateway({");
    assert.ok(claimIndex >= 0 && prepareIndex > claimIndex);
    assert.ok(assertIndex > prepareIndex, "the nine prepared images must be asserted before atomic enqueue");
    assert.ok(atomicIndex > assertIndex, "the exact eBay atomic RPC must run after image assertion");
    assert.ok(waitIndex > atomicIndex, "the route must poll only the atomically returned job");
    assert.ok(genericIndex > waitIndex, "generic gateway enqueue must remain in the non-atomic branch");
    assert.equal(
      (route.match(/sellerpilot_service_arm_ebay_no_effect_retry/gu) ?? []).length,
      0,
      "the exact recovery route must not separately pre-arm an eBay permit",
    );
    assert.match(
      route,
      /boundEbayExactExistingQaRecovery\s*\?\s*`ebay-exact-v101:\$\{ebayExactExistingQaRecoveryIdentity[.]listingId\}:\$\{requestFingerprint\}`/u,
    );
    assert.match(
      route,
      /ebayExactAtomicEnqueueRequired\s*&&\s*ebayExactAtomicRpcStarted[\s\S]*?manualRequired:\s*!ebayExactAtomicJobCommitted/u,
    );
  } finally {
    await db.close();
  }
});
