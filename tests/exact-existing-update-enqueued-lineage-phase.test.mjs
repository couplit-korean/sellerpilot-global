import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const closedGateMigrationUrl = new URL(
  "../supabase/migrations/20260901080000_allow_exact_existing_updates_through_closed_gate.sql",
  import.meta.url,
);
const phaseMigrationUrl = new URL(
  "../supabase/migrations/20260901140000_fix_exact_update_enqueued_lineage_phase.sql",
  import.meta.url,
);

const listingId = "7ffc6e46-3173-4695-9889-5fa1529765f1";
const productId = "ddccde35-9c58-4856-b673-d7aa27ce4220";
const ownerId = "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c";
const credentialId = "20000000-0000-4000-8000-000000000001";
const attemptId = "20000000-0000-4000-8000-000000000002";
const permitId = "20000000-0000-4000-8000-000000000003";
const sellerAccountKey = "c".repeat(64);
const releaseSha = "a".repeat(40);
const fingerprint = "b".repeat(64);

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const bodyStart = source.indexOf("as $$", start);
  assert.notEqual(bodyStart, -1);
  const end = source.indexOf("$$;", bodyStart + 5);
  assert.notEqual(end, -1);
  return source.slice(start, end + 3);
}

function extractTaggedDo(source, tag) {
  const marker = `$${tag}$`;
  const start = source.indexOf(`do ${marker}`);
  assert.notEqual(start, -1, `${tag} must exist`);
  const end = source.indexOf(`${marker};`, start + marker.length);
  assert.notEqual(end, -1, `${tag} end must exist`);
  return source.slice(start, end + marker.length + 1);
}

test("exact permit uses failed lineage before enqueue and queued lineage after the real predecessor transition", async () => {
  const [closedGateMigration, phaseMigration] = await Promise.all([
    readFile(closedGateMigrationUrl, "utf8"),
    readFile(phaseMigrationUrl, "utf8"),
  ]);
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema extensions;
      create function extensions.digest(value text, algorithm text)
      returns bytea language sql immutable as $$
        select case when lower(algorithm) = 'sha256'
          then sha256(convert_to(value, 'UTF8'))
          else convert_to(md5(value || algorithm), 'UTF8')
        end
      $$;
      create schema sellerpilot_private;

      create table sellerpilot_private.products (
        id uuid primary key, owner_id uuid not null, sku text not null,
        on_hand integer not null, demo boolean not null, status text not null
      );
      create table sellerpilot_private.product_listings (
        id uuid primary key, product_id uuid not null, owner_id uuid not null,
        channel_key text not null, market text not null, target_id text not null,
        remote_id text, marketplace_sku text, provider_resource_id text,
        currency text not null, price numeric not null,
        seller_account_key text not null, status text not null,
        failure_class text, requested_publication_intent text,
        remote_visibility text, provider_status text, published_at timestamptz,
        operation_attempt_id uuid, last_error text, updated_at timestamptz
      );
      create table sellerpilot_private.channel_credentials (
        id uuid primary key, channel text not null, environment text not null,
        status text not null, version integer not null, fingerprint text not null,
        seller_account_key text not null, seller_account_key_source text not null,
        seller_account_verified_at timestamptz not null, expires_at timestamptz,
        last_checked_at timestamptz, last_check_status text
      );
      create table sellerpilot_private.channel_operation_attempts (
        id uuid primary key, owner_id uuid not null, credential_id uuid not null,
        channel text not null, operation text not null, status text not null,
        seller_account_key text not null, request_fingerprint text not null
      );
      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key default gen_random_uuid(), attempt_id uuid not null,
        listing_id uuid not null, credential_id uuid not null,
        channel text not null, operation text not null, environment text not null,
        status text not null, attempt_count integer not null,
        seller_account_key text not null, request_fingerprint text not null,
        request_payload jsonb not null, worker_token_id uuid, claim_token uuid,
        lease_expires_at timestamptz, started_at timestamptz,
        completed_at timestamptz, response_payload jsonb,
        provider_mutation_started_at timestamptz, error_message text,
        updated_at timestamptz not null default clock_timestamp()
      );
      create table sellerpilot_private.elevenst_listing_snapshots (
        listing_id uuid, credential_id uuid, seller_account_key text,
        remote_id text, revision bigint, source_job_id uuid,
        product_payload jsonb
      );
      create table sellerpilot_private.exact_existing_update_permits (
        permit_id uuid primary key, channel text not null, listing_id uuid not null,
        product_id uuid not null, credential_id uuid not null, owner_id uuid not null,
        market text not null, target_id text not null, remote_id text not null,
        seller_sku text not null, provider_resource_id text, currency text not null,
        price numeric not null, stock integer not null,
        seller_account_key text not null, credential_version integer not null,
        credential_fingerprint text not null, credential_account_source text not null,
        credential_verified_at timestamptz not null, credential_expires_at timestamptz,
        credential_last_checked_at timestamptz, credential_last_check_status text,
        snapshot_revision bigint, snapshot_payload_sha256 text,
        snapshot_source_job_id uuid, release_sha text not null,
        request_fingerprint text not null, armed_at timestamptz not null,
        expires_at timestamptz not null, update_job_id uuid,
        update_attempt_id uuid, arguments_sha256 text, arguments_bytes integer,
        request_payload_sha256 text, request_payload_bytes integer,
        bound_at timestamptz, bound_worker_token_id uuid, bound_claim_token uuid,
        consumed_at timestamptz, invalidated_at timestamptz,
        invalidation_reason text
      );

      create function sellerpilot_private.exact_existing_update_release_is_current(
        requested_channel text, requested_release text
      ) returns boolean language sql stable as $$
        select requested_channel = 'coupang' and requested_release = '${releaseSha}'
      $$;
      create function sellerpilot_private.ebay_exact_current_credential_is_valid(
        requested_credential uuid, requested_account text
      ) returns boolean language sql stable as $$ select false $$;
      create function sellerpilot_private.exact_existing_update_arguments_valid(
        requested_channel text, value jsonb, current_release text,
        expected_fingerprint text, expected_stock integer
      ) returns boolean language sql immutable as $$
        select requested_channel = 'coupang'
          and value#>>'{sellerpilotCoupangExactQaRecovery,contract}' =
                'coupang_exact_qa_recovery_v1'
          and value->>'publicationExpectedFingerprint' = expected_fingerprint
          and current_release = '${releaseSha}' and expected_stock = 1
      $$;

      -- This is intentionally the original pre-enqueue contract: the exact
      -- listing has to remain failed until the predecessor owns its transition.
      create function sellerpilot_private.exact_existing_update_lineage_is_current(
        requested_permit uuid
      ) returns boolean language sql stable as $$
        select exists (
          select 1
            from sellerpilot_private.exact_existing_update_permits permit
            join sellerpilot_private.product_listings listing
              on listing.id = permit.listing_id
           where permit.permit_id = requested_permit
             and permit.invalidated_at is null
             and permit.expires_at > statement_timestamp()
             and listing.status = 'failed'
             and listing.failure_class = 'external_action'
        )
      $$;

      -- Unlike the old unit fake, this predecessor performs the same durable
      -- listing transition as the real historical enqueue before inserting the
      -- new job. The outer permit wrapper must validate this post-state.
      create function public.sp_09010800_enqueue_before_exact_existing_permit(
        p_listing_id uuid, p_credential_id uuid, p_attempt_id uuid,
        p_channel text, p_operation text, p_request_payload jsonb
      ) returns jsonb language plpgsql set search_path='' as $$
      declare v_job_id uuid;
      begin
        update sellerpilot_private.product_listings listing
           set operation_attempt_id = p_attempt_id,
               status = 'queued', failure_class = null, last_error = null,
               updated_at = clock_timestamp()
         where listing.id = p_listing_id;
        insert into sellerpilot_private.channel_gateway_jobs(
          attempt_id,listing_id,credential_id,channel,operation,environment,
          status,attempt_count,seller_account_key,request_fingerprint,
          request_payload
        )
        select p_attempt_id,p_listing_id,p_credential_id,p_channel,p_operation,
               'production','queued',0,attempt.seller_account_key,
               attempt.request_fingerprint,p_request_payload
          from sellerpilot_private.channel_operation_attempts attempt
         where attempt.id = p_attempt_id
        returning id into v_job_id;
        return jsonb_build_object('job_id',v_job_id,'status','queued');
      end;
      $$;
    `);

    await db.exec(extractFunction(
      closedGateMigration,
      "create function public.sellerpilot_service_enqueue_listing_gateway_job(",
    ));
    await db.exec(`
      create function sellerpilot_private.bind_exact_existing_update_claim(
        p_old jsonb, p_new jsonb
      ) returns boolean language sql stable as $$
        select sellerpilot_private.exact_existing_update_lineage_is_current(
          (select permit_id from sellerpilot_private.exact_existing_update_permits limit 1)
        )
      $$;
      create function sellerpilot_private.exact_existing_update_provider_allowed(
        p_job_id uuid, p_claim_token uuid
      ) returns boolean language sql stable as $$
        select sellerpilot_private.exact_existing_update_lineage_is_current(
          (select permit_id from sellerpilot_private.exact_existing_update_permits limit 1)
        )
      $$;
      create function sellerpilot_private.consume_exact_existing_update_provider(
        p_job_id uuid, p_claim_token uuid
      ) returns boolean language sql stable as $$
        select sellerpilot_private.exact_existing_update_lineage_is_current(
          (select permit_id from sellerpilot_private.exact_existing_update_permits limit 1)
        )
      $$;

      insert into sellerpilot_private.products
      values('${productId}','${ownerId}','QA-20260823-CC-001',1,false,'draft');
      insert into sellerpilot_private.channel_credentials values(
        '${credentialId}','coupang','production','active',1,'ABCDEF123456',
        '${sellerAccountKey}','credential_incarnation_v1',clock_timestamp(),
        null,clock_timestamp(),'passed'
      );
      insert into sellerpilot_private.product_listings(
        id,product_id,owner_id,channel_key,market,target_id,remote_id,
        marketplace_sku,provider_resource_id,currency,price,seller_account_key,
        status,failure_class,requested_publication_intent,remote_visibility,
        provider_status,published_at,operation_attempt_id,last_error,updated_at
      ) values(
        '${listingId}','${productId}','${ownerId}','coupang','KR','KR',
        '16356981734',null,null,'KRW',5000,'${sellerAccountKey}',
        'failed','external_action','live','unknown',null,null,null,
        'operator retry required',clock_timestamp()
      );
      insert into sellerpilot_private.channel_operation_attempts values(
        '${attemptId}','${ownerId}','${credentialId}','coupang','listing.update',
        'running','${sellerAccountKey}','${fingerprint}'
      );
      insert into sellerpilot_private.exact_existing_update_permits(
        permit_id,channel,listing_id,product_id,credential_id,owner_id,market,
        target_id,remote_id,seller_sku,provider_resource_id,currency,price,stock,
        seller_account_key,credential_version,credential_fingerprint,
        credential_account_source,credential_verified_at,
        credential_last_checked_at,credential_last_check_status,release_sha,
        request_fingerprint,armed_at,expires_at
      ) values(
        '${permitId}','coupang','${listingId}','${productId}','${credentialId}',
        '${ownerId}','KR','KR','16356981734','QA-20260823-CC-001',
        '95962393877','KRW',5000,1,'${sellerAccountKey}',1,'ABCDEF123456',
        'credential_incarnation_v1',
        (select seller_account_verified_at
           from sellerpilot_private.channel_credentials
          where id='${credentialId}'),
        (select last_checked_at
           from sellerpilot_private.channel_credentials
          where id='${credentialId}'),
        'passed',
        '${releaseSha}','${fingerprint}',clock_timestamp(),
        clock_timestamp()+interval '5 minutes'
      );
    `);

    const payload = {
      arguments: {
        publicationExpectedFingerprint: fingerprint,
        sellerpilotCoupangExactQaRecovery: {
          contract: "coupang_exact_qa_recovery_v1",
        },
      },
    };
    await assert.rejects(
      db.query(`
        select public.sellerpilot_service_enqueue_listing_gateway_job(
          $1,$2,$3,'coupang','listing.update',$4::jsonb
        ) value
      `, [listingId, credentialId, attemptId, JSON.stringify(payload)]),
      /exact existing update job binding failed/u,
      "the old wrapper must reproduce the production rollback after the predecessor queues the listing",
    );
    const rolledBack = await db.query(`
      select listing.status,listing.failure_class,listing.operation_attempt_id,
             (select count(*)::integer from sellerpilot_private.channel_gateway_jobs) job_count
        from sellerpilot_private.product_listings listing
       where listing.id=$1
    `, [listingId]);
    assert.deepEqual(rolledBack.rows[0], {
      status: "failed",
      failure_class: "external_action",
      operation_attempt_id: null,
      job_count: 0,
    });

    await db.exec(extractTaggedDo(
      phaseMigration,
      "install_exact_existing_enqueued_lineage_phase",
    ));
    await db.exec(extractTaggedDo(
      phaseMigration,
      "patch_exact_existing_enqueued_phase_calls",
    ));

    const enqueued = await db.query(`
      select public.sellerpilot_service_enqueue_listing_gateway_job(
        $1,$2,$3,'coupang','listing.update',$4::jsonb
      ) value
    `, [listingId, credentialId, attemptId, JSON.stringify(payload)]);
    assert.equal(enqueued.rows[0].value.status, "queued");
    const postState = await db.query(`
      select listing.status,listing.failure_class,listing.operation_attempt_id,
             permit.update_job_id,permit.update_attempt_id,
             sellerpilot_private.exact_existing_update_lineage_is_current(
               permit.permit_id
             ) preflight_current,
             sellerpilot_private.exact_existing_update_enqueued_lineage_is_current(
               permit.permit_id
             ) enqueued_current,
             (select count(*)::integer from sellerpilot_private.channel_gateway_jobs) job_count
        from sellerpilot_private.product_listings listing
        join sellerpilot_private.exact_existing_update_permits permit
          on permit.listing_id=listing.id
       where listing.id=$1
    `, [listingId]);
    assert.equal(postState.rows[0].status, "queued");
    assert.equal(postState.rows[0].failure_class, null);
    assert.equal(postState.rows[0].operation_attempt_id, attemptId);
    assert.equal(postState.rows[0].update_attempt_id, attemptId);
    assert.ok(postState.rows[0].update_job_id);
    assert.equal(postState.rows[0].preflight_current, false);
    assert.equal(postState.rows[0].enqueued_current, true);
    assert.equal(postState.rows[0].job_count, 1);

    const enqueueDefinition = (await db.query(
      "select pg_get_functiondef($1::regprocedure) definition",
      ["public.sellerpilot_service_enqueue_listing_gateway_job(uuid,uuid,uuid,text,text,jsonb)"],
    )).rows[0].definition;
    assert.match(enqueueDefinition, /exact_existing_update_enqueued_lineage_is_current/u);
    assert.match(enqueueDefinition, /exact_existing_update_lineage_is_current\(/u);

    for (const signature of [
      "sellerpilot_private.bind_exact_existing_update_claim(jsonb,jsonb)",
      "sellerpilot_private.exact_existing_update_provider_allowed(uuid,uuid)",
      "sellerpilot_private.consume_exact_existing_update_provider(uuid,uuid)",
    ]) {
      const definition = (await db.query(
        "select pg_get_functiondef($1::regprocedure) definition",
        [signature],
      )).rows[0].definition;
      assert.match(definition, /exact_existing_update_enqueued_lineage_is_current/u);
      assert.doesNotMatch(definition, /exact_existing_update_lineage_is_current\(/u);
    }
  } finally {
    await db.close();
  }
});
