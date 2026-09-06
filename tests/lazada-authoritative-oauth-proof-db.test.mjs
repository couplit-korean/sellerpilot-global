import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const dualMigrationUrl = new URL(
  "../supabase/migrations/20260902091500_allow_exact_lazada_dual_blocker_reauthorization.sql",
  import.meta.url,
);
const recoveryMigrationUrl = new URL(
  "../supabase/migrations/20260902100000_recover_exact_lazada_provider_failure_three_blockers.sql",
  import.meta.url,
);

const OWNER_ID = "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c";
const SOURCE_CREDENTIAL_ID = "e54fa95d-ddfd-414f-82e9-636a0d9ab07c";
const OAUTH_BLOCKER_ID = "faee01e1-2d68-4f99-951c-15684822fc43";
const READ_BLOCKER_ID = "a976573f-a150-4061-a1c6-5e8e4880ba2b";
const PROVIDER_FAILURE_BLOCKER_ID = "d917f08b-1283-456e-930a-6042ec0b24a7";
const PROVIDER_FAILURE_FINGERPRINT =
  "663295c1520473aa753929d06e9e791e59b2059a73c706355086e52762b81681";
const ACTIVE_CREDENTIAL_ID = "c4ea58dc-6cbc-4d71-9caa-0303f211d54d";
const OAUTH_JOB_ID = "1fcc053e-4aaf-4a6a-ac30-322a04819995";
const DUPLICATE_OAUTH_JOB_ID = "88c3475c-386d-4fe0-8a8b-e0814651f371";
const SELLER_JOB_ID = "a7fc92cb-a92d-4c81-bcf8-d0b95bca3901";
const TARGET_ROW_ID = "7a9ad586-06ca-420f-996d-55ea06f8bb2b";
const OAUTH_WORKER_ID = "916de0cc-6f98-4f80-8c1e-0e2acc09c47e";
const SELLER_WORKER_ID = "d0b90f9d-e00c-491e-8cea-7794cb502f5a";
const OAUTH_CLAIM_ID = "26f31280-4355-44b0-9c9a-55b7e2cfa5b1";
const SELLER_CLAIM_ID = "fcff92e9-fd02-476f-8ea5-fecfd1c8a770";
const COMPLETION_FINGERPRINT =
  "00d682385677bf3f888e8b565f1c3530049b58d1cf0f55d3023bfcbfbbb65fc8";

test("500 prerequisite preserves blockers without 600 immutable exact-session receipts", async () => {
  const source = await readFile(dualMigrationUrl, "utf8");
  const recoverySource = await readFile(recoveryMigrationUrl, "utf8");
  const db = new PGlite();
  const providerSubject = `lazada:v1:${Buffer.from(JSON.stringify([
    "seller_center",
    [["my", "300872000183", "300100200"]],
  ]), "utf8").toString("base64url")}`;
  const unrelatedProviderSubject = `lazada:v1:${"A".repeat(40)}`;
  const wrongSellerProviderSubject = `lazada:v1:${Buffer.from(JSON.stringify([
    "seller_center",
    [["my", "200100301", "300100200"]],
  ]), "utf8").toString("base64url")}`;
  const sellerAccountKey = createHash("sha256")
    .update(`lazada\u001fproduction\u001f${providerSubject}`, "utf8")
    .digest("hex");
  const unrelatedSellerAccountKey = createHash("sha256")
    .update(`lazada\u001fproduction\u001f${unrelatedProviderSubject}`, "utf8")
    .digest("hex");
  const wrongSellerAccountKey = createHash("sha256")
    .update(`lazada\u001fproduction\u001f${wrongSellerProviderSubject}`, "utf8")
    .digest("hex");
  const freshFingerprint = "b".repeat(64);

  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema sellerpilot_private;
      create schema vault;
      create schema extensions;
      create function extensions.digest(value text, algorithm text)
      returns bytea language sql immutable as $$
        select case when lower(algorithm)='sha256'
          then sha256(convert_to(value,'UTF8'))
          else sha256(convert_to(value || algorithm,'UTF8')) end
      $$;
      create table vault.secrets(
        id uuid primary key, secret text not null
      );
      create view vault.decrypted_secrets as
        select id, secret decrypted_secret from vault.secrets;
      create table sellerpilot_private.channel_credentials(
        id uuid primary key,
        created_by uuid not null,
        channel text not null,
        environment text not null,
        version integer not null,
        status text not null,
        expires_at timestamptz,
        grace_ends_at timestamptz,
        vault_secret_id uuid,
        seller_account_key text,
        seller_account_key_source text,
        seller_account_verified_at timestamptz
      );
      create table sellerpilot_private.channel_gateway_jobs(
        id uuid primary key,
        credential_id uuid,
        attempt_id uuid,
        listing_id uuid,
        worker_token_id uuid,
        claim_token uuid,
        channel text,
        operation text,
        environment text,
        request_payload jsonb,
        response_payload jsonb,
        status text,
        error_message text,
        attempt_count integer default 0,
        lease_expires_at timestamptz,
        created_by uuid,
        created_at timestamptz default clock_timestamp(),
        started_at timestamptz,
        completed_at timestamptz,
        updated_at timestamptz default clock_timestamp(),
        credential_refresh_fingerprint text,
        prepared_credential_id uuid,
        credential_refresh_prepared_at timestamptz,
        credential_refresh_recovery_vault_id uuid,
        credential_refresh_recovery_fingerprint text,
        credential_refresh_recovery_staged_at timestamptz,
        credential_refresh_in_flight boolean default false,
        credential_refresh_started_at timestamptz,
        oauth_request_vault_id uuid,
        oauth_request_fingerprint text,
        oauth_source_credential_id uuid,
        oauth_exchange_completed boolean default false,
        seller_account_key text,
        provider_mutation_started_at timestamptz,
        oauth_provider_call_started_at timestamptz,
        write_resource_kind text,
        write_resource_key text,
        request_fingerprint text,
        inventory_item_id uuid,
        order_id uuid,
        shipment_carrier text,
        shipment_tracking text
      );
      create table sellerpilot_private.gateway_completion_receipts(
        job_id uuid primary key,
        claim_token uuid not null,
        worker_token_id uuid not null,
        completion_fingerprint text not null,
        created_at timestamptz not null
      );
      create function sellerpilot_private.gateway_completion_fingerprint(
        text,jsonb,text,jsonb,jsonb,jsonb,jsonb
      ) returns text language sql immutable as $$
        select case when $3 = 'LAZADA_OAUTH_PROVIDER_FAILURE:ISV:UNRECOGNIZED'
          then 'bfd9d9e768f23c0073eb656d24f1f2785a0904cdb62a98c0b465b63b0fc69198'
          else '${COMPLETION_FINGERPRINT}'::text end
      $$;
      create table sellerpilot_private.channel_market_targets(
        id uuid primary key,
        owner_id uuid not null,
        credential_id uuid not null,
        channel text not null,
        environment text not null,
        target_id text not null,
        display_name text,
        market_code text not null,
        locale text not null,
        language text,
        currency text not null,
        remote_status text,
        verified_at timestamptz,
        updated_at timestamptz default clock_timestamp()
      );
      create table sellerpilot_private.operation_audit(
        id bigint generated always as identity primary key,
        owner_id uuid,
        action text,
        entity_type text,
        entity_id text,
        safe_detail jsonb,
        occurred_at timestamptz
      );
      create function
        sellerpilot_private.safe_lazada_read_refresh_reauthorization_blocker(
          uuid,uuid,text,timestamptz
        ) returns uuid language sql stable security definer
        set search_path = '' as $$ select null::uuid $$;
      create function
        sellerpilot_private.safe_lazada_oauth_exchange_reauthorization_blocker(
          uuid,uuid,text,text,timestamptz
        ) returns uuid language sql stable security definer
        set search_path = '' as $$
          select null::uuid
           where false
             and 'faee01e1-2d68-4f99-951c-15684822fc43' =
                   'reconciliation_required'
             and (
               select count(*)
                 from sellerpilot_private.channel_gateway_jobs
             ) = 1
        $$;
      create function sellerpilot_private.safe_lazada_oauth_refresh_blocker(
        p_oauth_job_id uuid
      ) returns uuid language sql stable security definer
        set search_path = '' as $$
          select coalesce(
            sellerpilot_private.safe_lazada_read_refresh_reauthorization_blocker(
              null,null,'production',clock_timestamp()
            ),
            sellerpilot_private.safe_lazada_oauth_exchange_reauthorization_blocker(
              null,null,'production',repeat('a',64),clock_timestamp()
            )
          )
        $$;
    `);

    await db.exec(source);
    await db.exec(`
      insert into sellerpilot_private.channel_credentials(
        id,created_by,channel,environment,version,status,expires_at,
        seller_account_key,seller_account_key_source,seller_account_verified_at
      ) values(
        '${SOURCE_CREDENTIAL_ID}','${OWNER_ID}','lazada','production',5,
        'active',clock_timestamp()+interval '180 days',null,
        'legacy_unattested',null
      );

      insert into sellerpilot_private.channel_gateway_jobs(
        id,credential_id,oauth_source_credential_id,created_by,channel,
        environment,operation,status,error_message,attempt_count,
        request_payload,started_at,credential_refresh_started_at,
        completed_at,updated_at,credential_refresh_in_flight,
        oauth_request_fingerprint
      ) values(
        '${OAUTH_BLOCKER_ID}','${SOURCE_CREDENTIAL_ID}',
        '${SOURCE_CREDENTIAL_ID}','${OWNER_ID}','lazada','production',
        'oauth.exchange','reconciliation_required',
        'serverless_cs_execution_failed',1,'{"vaultBacked":true}',
        '2026-08-30 10:24:04.769695+00',
        '2026-08-30 10:24:05.519322+00',
        '2026-08-30 10:24:07.333213+00',
        '2026-08-30 10:24:07.333213+00',true,
        '8a0f1f27e3b168ace4dd70a416b898caa92ef5ac4725fc08e1ea798fb28a6bfa'
      ),(
        '${READ_BLOCKER_ID}','${SOURCE_CREDENTIAL_ID}',null,'${OWNER_ID}',
        'lazada','production','orders.list','reconciliation_required',
        'serverless_cs_execution_failed',1,
        jsonb_build_object(
          'arguments',jsonb_build_object(
            'queryParams',jsonb_build_object(
              'limit','50','created_after','2026-08-16T09:16:01.458Z',
              'sort_direction','DESC'
            )
          ),'periodicKey','orders'
        ),
        '2026-08-30 09:16:03.961623+00',
        '2026-08-30 09:16:05.208278+00',
        '2026-08-30 09:16:06.920132+00',
        '2026-08-30 09:16:06.920132+00',true,null
      );
      insert into sellerpilot_private.gateway_completion_receipts values
        ('${OAUTH_BLOCKER_ID}','11111111-1111-4111-8111-111111111111',
         '21111111-1111-4111-8111-111111111111','${COMPLETION_FINGERPRINT}',
         '2026-08-30 10:24:07.470146+00'),
        ('${READ_BLOCKER_ID}','31111111-1111-4111-8111-111111111111',
         '41111111-1111-4111-8111-111111111111','${COMPLETION_FINGERPRINT}',
         '2026-08-30 09:16:07.032446+00');

      insert into sellerpilot_private.channel_gateway_jobs(
        id,credential_id,oauth_source_credential_id,created_by,channel,
        environment,operation,status,error_message,attempt_count,
        request_payload,created_at,started_at,credential_refresh_started_at,
        oauth_provider_call_started_at,completed_at,updated_at,
        credential_refresh_in_flight,oauth_request_fingerprint
      ) values(
        '${PROVIDER_FAILURE_BLOCKER_ID}','${SOURCE_CREDENTIAL_ID}',
        '${SOURCE_CREDENTIAL_ID}','${OWNER_ID}','lazada','production',
        'oauth.exchange','reconciliation_required',
        'LAZADA_OAUTH_PROVIDER_FAILURE:ISV:UNRECOGNIZED',1,
        '{"vaultBacked":true}',
        '2026-09-02 01:10:22.458355+00',
        '2026-09-02 01:11:06.769536+00',
        '2026-09-02 01:11:14.013743+00',
        '2026-09-02 01:11:14.3005+00',
        '2026-09-02 01:11:15.504797+00',
        '2026-09-02 01:11:15.504797+00',true,
        '${PROVIDER_FAILURE_FINGERPRINT}'
      );
      insert into sellerpilot_private.gateway_completion_receipts values(
        '${PROVIDER_FAILURE_BLOCKER_ID}',
        '51111111-1111-4111-8111-111111111111',
        '61111111-1111-4111-8111-111111111111',
        'bfd9d9e768f23c0073eb656d24f1f2785a0904cdb62a98c0b465b63b0fc69198',
        '2026-09-02 01:11:15.728629+00'
      );
    `);

    await db.exec(recoverySource);
    const patch = await readFile(new URL('../supabase/migrations/20260906050000_bind_lazada_oauth_to_authoritative_seller.sql',import.meta.url),'utf8');
    const pristineProof=(await db.query("select pg_get_functiondef('sellerpilot_private.exact_lazada_three_readback_proof(uuid)'::regprocedure) def")).rows[0].def;
    await db.exec(pristineProof.replace('return null;','return null; /* divergent fixture preimage */'));
    await assert.rejects(db.exec(patch),/LAZADA_SAME_ACCOUNT_PROOF_PREIMAGE_MISMATCH/);
    await db.exec('rollback');
    await db.exec(pristineProof);
    await db.exec(patch);
    // Synthetic fixture clock: installation precedes the later fixture OAuth.
    await db.exec("update sellerpilot_private.lazada_same_account_oauth_boundary set installed_at=clock_timestamp()-interval '10 minutes'");
    await db.exec(`insert into vault.secrets values('11111111-1111-4111-8111-111111111112','{"app_key":"137451","app_secret":"fixture-secret","country":"my","im_app_key":"137571","im_app_secret":"fixture-im","im_access_token":"fixture-im-token"}'); update sellerpilot_private.channel_credentials set vault_secret_id='11111111-1111-4111-8111-111111111112' where id='${SOURCE_CREDENTIAL_ID}';`);

    const intact = await db.query(`
      select sellerpilot_private.lazada_exact_three_blockers_intact(
        $1,$2,'production'
      ) value
    `, [SOURCE_CREDENTIAL_ID, OWNER_ID]);
    assert.equal(intact.rows[0].value, true);
    const blocker = await db.query(`
      select sellerpilot_private.safe_lazada_exact_three_oauth_exchange_blocker(
        $1,$2,'production',$3,clock_timestamp()
      ) value
    `, [SOURCE_CREDENTIAL_ID, OWNER_ID, freshFingerprint]);
    assert.equal(blocker.rows[0].value, PROVIDER_FAILURE_BLOCKER_ID);
    const replayedFailedFingerprint = await db.query(`
      select sellerpilot_private.safe_lazada_exact_three_oauth_exchange_blocker(
        $1,$2,'production',$3,clock_timestamp()
      ) value
    `, [SOURCE_CREDENTIAL_ID, OWNER_ID, PROVIDER_FAILURE_FINGERPRINT]);
    assert.equal(replayedFailedFingerprint.rows[0].value, null);
    await db.query(`
      insert into sellerpilot_private.channel_gateway_jobs(
        id,credential_id,oauth_source_credential_id,created_by,channel,
        environment,operation,status,request_payload,
        oauth_request_fingerprint,created_at,updated_at
      ) values(
        $1,$2,$2,$3,'lazada','production','oauth.exchange','queued',
        '{"vaultBacked":true}',$4,clock_timestamp(),clock_timestamp()
      )
    `, [OAUTH_JOB_ID, SOURCE_CREDENTIAL_ID, OWNER_ID, freshFingerprint]);
    const queuedBlocker = await db.query(`
      select sellerpilot_private.safe_lazada_oauth_refresh_blocker($1) value
    `, [OAUTH_JOB_ID]);
    assert.equal(queuedBlocker.rows[0].value, PROVIDER_FAILURE_BLOCKER_ID);
    await db.query(
      "delete from sellerpilot_private.channel_gateway_jobs where id=$1",
      [OAUTH_JOB_ID],
    );

    await assert.rejects(
      db.query(
        "update sellerpilot_private.channel_gateway_jobs set status='cancelled' where id=$1",
        [PROVIDER_FAILURE_BLOCKER_ID],
      ),
      /exact failed Lazada OAuth blocker is immutable/u,
    );
    const beforeProof = await db.query(`
      select id,status,credential_refresh_in_flight
        from sellerpilot_private.channel_gateway_jobs
       where id in ($1,$2,$3) order by id
    `, [OAUTH_BLOCKER_ID, READ_BLOCKER_ID, PROVIDER_FAILURE_BLOCKER_ID]);
    assert.deepEqual(beforeProof.rows.map((row) => [
      row.id, row.status, row.credential_refresh_in_flight,
    ]), [
      [READ_BLOCKER_ID, "reconciliation_required", true],
      [PROVIDER_FAILURE_BLOCKER_ID, "reconciliation_required", true],
      [OAUTH_BLOCKER_ID, "reconciliation_required", true],
    ]);
    const assertThreeBlockersIntact = async (message) => {
      const current = await db.query(`
        select id,status,credential_refresh_in_flight
          from sellerpilot_private.channel_gateway_jobs
         where id in ($1,$2,$3) order by id
      `, [OAUTH_BLOCKER_ID, READ_BLOCKER_ID, PROVIDER_FAILURE_BLOCKER_ID]);
      assert.deepEqual(current.rows.map((row) => [
        row.id, row.status, row.credential_refresh_in_flight,
      ]), [
        [READ_BLOCKER_ID, "reconciliation_required", true],
        [PROVIDER_FAILURE_BLOCKER_ID, "reconciliation_required", true],
        [OAUTH_BLOCKER_ID, "reconciliation_required", true],
      ], message);
    };

    await db.exec(`
      update sellerpilot_private.channel_credentials
         set status='revoked',grace_ends_at=clock_timestamp()
       where id='${SOURCE_CREDENTIAL_ID}';
      insert into vault.secrets(id,secret) values(
        '65c64710-1017-4a10-bfc2-98ca773dc99a',
        jsonb_build_object(
          'app_key','137451','app_secret','fixture-secret','im_app_key','137571','im_app_secret','fixture-im','im_access_token','fixture-im-token',
          'country','my',
          'account_platform','seller_center',
          'country_user_info',jsonb_build_array(jsonb_build_object(
            'country','my','seller_id','300872000183','user_id','300100200'
          )),
          'provider_account_identity_version','v1',
          'provider_account_subject','${providerSubject}',
          'access_token','access-token',
          'refresh_token','refresh-token'
        )::text
      );
      insert into sellerpilot_private.channel_credentials(
        id,created_by,channel,environment,version,status,expires_at,
        vault_secret_id,seller_account_key,seller_account_key_source,
        seller_account_verified_at
      ) values(
        '${ACTIVE_CREDENTIAL_ID}','${OWNER_ID}','lazada','production',6,
        'active',clock_timestamp()+interval '180 days',
        '65c64710-1017-4a10-bfc2-98ca773dc99a','${sellerAccountKey}',
        'provider_certified_v1',clock_timestamp()-interval '90 seconds'
      );
      insert into sellerpilot_private.channel_gateway_jobs(
        id,credential_id,prepared_credential_id,oauth_source_credential_id,
        created_by,channel,environment,operation,status,attempt_count,
        request_payload,response_payload,created_at,started_at,
        oauth_provider_call_started_at,credential_refresh_prepared_at,
        completed_at,updated_at,oauth_request_fingerprint,
        credential_refresh_fingerprint,oauth_exchange_completed,
        credential_refresh_in_flight,seller_account_key,
        worker_token_id,claim_token
      ) values(
        '${OAUTH_JOB_ID}','${ACTIVE_CREDENTIAL_ID}','${ACTIVE_CREDENTIAL_ID}',
        '${SOURCE_CREDENTIAL_ID}','${OWNER_ID}','lazada','production',
        'oauth.exchange','succeeded',1,'{"vaultBacked":true}',
        '{"ok":true,"channel":"lazada","operation":"oauth.exchange"}',
        clock_timestamp()-interval '5 minutes',
        clock_timestamp()-interval '4 minutes',
        clock_timestamp()-interval '3 minutes',
        clock_timestamp()-interval '2 minutes',
        clock_timestamp()-interval '1 minute',
        clock_timestamp()-interval '1 minute',
        '${freshFingerprint}','${"c".repeat(64)}',true,false,null,
        '${OAUTH_WORKER_ID}','${OAUTH_CLAIM_ID}'
      );
      insert into sellerpilot_private.gateway_completion_receipts values(
        '${OAUTH_JOB_ID}','${OAUTH_CLAIM_ID}','${OAUTH_WORKER_ID}',
        '${COMPLETION_FINGERPRINT}',clock_timestamp()-interval '50 seconds'
      );
      insert into sellerpilot_private.channel_gateway_jobs(
        id,credential_id,created_by,channel,environment,operation,status,
        attempt_count,request_payload,response_payload,seller_account_key,
        created_at,started_at,completed_at,updated_at,worker_token_id,claim_token
      ) values(
        '${SELLER_JOB_ID}','${ACTIVE_CREDENTIAL_ID}','${OWNER_ID}',
        'lazada','production','shops.get','succeeded',1,
        '{"country":"my"}',
        jsonb_build_object(
          'ok',true,'channel','lazada','operation','shops.get',
          'steps',jsonb_build_array(jsonb_build_object(
            'name','seller-info','ok',true,'status',200,
            'data',jsonb_build_object('data',jsonb_build_object(
              'seller_id','300872000183','short_code','MY4NNISR2D','is_active',true
            ))
          ))
        ),'${sellerAccountKey}',
        clock_timestamp()-interval '50 seconds',
        clock_timestamp()-interval '45 seconds',
        clock_timestamp()-interval '40 seconds',
        clock_timestamp()-interval '40 seconds',
        '${SELLER_WORKER_ID}','${SELLER_CLAIM_ID}'
      );
    `);

    await db.exec(`
      insert into sellerpilot_private.channel_market_targets(
        id,owner_id,credential_id,channel,environment,target_id,
        display_name,market_code,locale,language,currency,remote_status,
        verified_at,updated_at
      ) values(
        '${TARGET_ROW_ID}','${OWNER_ID}','${ACTIVE_CREDENTIAL_ID}',
        'lazada','production','300872000183','Exact MY Seller','MY','ms-MY',
        'Malay','MYR','',clock_timestamp(),clock_timestamp()
      )
    `);

    await assertThreeBlockersIntact(
      "a seller row without an atomic completion receipt must not supersede blockers",
    );
    await db.query(`
      insert into sellerpilot_private.gateway_completion_receipts values(
        $1,$2,$3,$4,clock_timestamp()-interval '39 seconds'
      )
    `, [
      SELLER_JOB_ID,
      SELLER_CLAIM_ID,
      SELLER_WORKER_ID,
      COMPLETION_FINGERPRINT,
    ]);
    await db.query(`
      update vault.secrets
         set secret = jsonb_set(secret::jsonb,'{account_platform}','"buyer_portal"')::text
       where id='65c64710-1017-4a10-bfc2-98ca773dc99a'
    `);
    await db.query(
      "update sellerpilot_private.channel_market_targets set updated_at=clock_timestamp() where id=$1",
      [TARGET_ROW_ID],
    );
    await assertThreeBlockersIntact(
      "a non-seller-center account platform must not supersede blockers",
    );

    await db.query(`
      update vault.secrets
         set secret = jsonb_set(
           jsonb_set(
             jsonb_set(secret::jsonb,'{account_platform}','"seller_center"'),
             '{country_user_info}',jsonb_build_array(jsonb_build_object(
               'country','my','seller_id','200100301','user_id','300100200'
             ))
           ),
           '{provider_account_subject}',to_jsonb($1::text)
         )::text
       where id='65c64710-1017-4a10-bfc2-98ca773dc99a'
    `, [wrongSellerProviderSubject]);
    await db.query(`
      update sellerpilot_private.channel_credentials
         set seller_account_key=$1 where id=$2
    `, [wrongSellerAccountKey, ACTIVE_CREDENTIAL_ID]);
    await db.query(`
      update sellerpilot_private.channel_gateway_jobs
         set seller_account_key=$1 where id=$2
    `, [wrongSellerAccountKey, SELLER_JOB_ID]);
    await db.query(
      "update sellerpilot_private.channel_market_targets set updated_at=clock_timestamp() where id=$1",
      [TARGET_ROW_ID],
    );
    await assertThreeBlockersIntact(
      "a different numeric MY seller must not supersede the intended seller blockers",
    );

    await db.query(`
      update vault.secrets
         set secret = jsonb_set(
           jsonb_set(
             jsonb_set(secret::jsonb,'{account_platform}','"seller_center"'),
             '{country_user_info}',jsonb_build_array(jsonb_build_object(
               'country','my','seller_id','300872000183','user_id','300100200'
             ))
           ),
           '{provider_account_subject}',to_jsonb($1::text)
         )::text
       where id='65c64710-1017-4a10-bfc2-98ca773dc99a'
    `, [unrelatedProviderSubject]);
    await db.query(`
      update sellerpilot_private.channel_credentials
         set seller_account_key=$1 where id=$2
    `, [unrelatedSellerAccountKey, ACTIVE_CREDENTIAL_ID]);
    await db.query(`
      update sellerpilot_private.channel_gateway_jobs
         set seller_account_key=$1 where id=$2
    `, [unrelatedSellerAccountKey, SELLER_JOB_ID]);
    await db.query(
      "update sellerpilot_private.channel_market_targets set updated_at=clock_timestamp() where id=$1",
      [TARGET_ROW_ID],
    );
    await assertThreeBlockersIntact(
      "an unrelated provider subject must not prove the MY seller lineage",
    );

    await db.query(`
      update vault.secrets
         set secret = jsonb_set(secret::jsonb,'{provider_account_subject}',to_jsonb($1::text))::text
       where id='65c64710-1017-4a10-bfc2-98ca773dc99a'
    `, [providerSubject]);
    await db.query(`
      update sellerpilot_private.channel_credentials
         set seller_account_key=$1 where id=$2
    `, [sellerAccountKey, ACTIVE_CREDENTIAL_ID]);
    await db.query(`
      update sellerpilot_private.channel_gateway_jobs
         set seller_account_key=$1 where id=$2
    `, [sellerAccountKey, SELLER_JOB_ID]);

    await db.query(`
      insert into sellerpilot_private.channel_gateway_jobs(
        id,credential_id,prepared_credential_id,oauth_source_credential_id,
        created_by,channel,environment,operation,status,attempt_count,
        request_payload,response_payload,created_at,started_at,
        oauth_provider_call_started_at,credential_refresh_prepared_at,
        completed_at,updated_at,oauth_request_fingerprint,
        credential_refresh_fingerprint,oauth_exchange_completed,
        credential_refresh_in_flight,seller_account_key,
        worker_token_id,claim_token
      ) select
        $1,credential_id,prepared_credential_id,oauth_source_credential_id,
        created_by,channel,environment,operation,status,attempt_count,
        request_payload,response_payload,created_at+interval '1 second',
        started_at+interval '1 second',oauth_provider_call_started_at+interval '1 second',
        credential_refresh_prepared_at+interval '1 second',
        completed_at+interval '1 second',updated_at+interval '1 second',
        repeat('d',64),credential_refresh_fingerprint,oauth_exchange_completed,
        credential_refresh_in_flight,seller_account_key,
        'b6155323-f721-45ac-8f7b-53da30853ab1',
        '56f8f358-ac4e-42c5-b1f7-c249e5a81d67'
        from sellerpilot_private.channel_gateway_jobs where id=$2
    `, [DUPLICATE_OAUTH_JOB_ID, OAUTH_JOB_ID]);
    await db.query(`
      insert into sellerpilot_private.gateway_completion_receipts values(
        $1,'56f8f358-ac4e-42c5-b1f7-c249e5a81d67',
        'b6155323-f721-45ac-8f7b-53da30853ab1',$2,clock_timestamp()
      )
    `, [DUPLICATE_OAUTH_JOB_ID, COMPLETION_FINGERPRINT]);
    await db.query(
      "update sellerpilot_private.channel_market_targets set updated_at=clock_timestamp() where id=$1",
      [TARGET_ROW_ID],
    );
    await assertThreeBlockersIntact(
      "two matching successful OAuth jobs must fail the exact one-job proof",
    );
    await db.query(
      "delete from sellerpilot_private.gateway_completion_receipts where job_id=$1",
      [DUPLICATE_OAUTH_JOB_ID],
    );
    await db.query(
      "delete from sellerpilot_private.channel_gateway_jobs where id=$1",
      [DUPLICATE_OAUTH_JOB_ID],
    );

    await db.query(`
      update sellerpilot_private.gateway_completion_receipts
         set completion_fingerprint=repeat('f',64) where job_id=$1
    `, [SELLER_JOB_ID]);
    await db.query(
      "update sellerpilot_private.channel_market_targets set updated_at=clock_timestamp() where id=$1",
      [TARGET_ROW_ID],
    );
    await assertThreeBlockersIntact(
      "a mismatched seller readback completion fingerprint must not supersede blockers",
    );
    await db.query(`
      update sellerpilot_private.gateway_completion_receipts
         set completion_fingerprint=$2 where job_id=$1
    `, [SELLER_JOB_ID, COMPLETION_FINGERPRINT]);
    const imFixture={app_key:'137451',app_secret:'fixture-secret',country:'my',im_app_key:'137571',im_app_secret:'fixture-im',im_access_token:'fixture-im-token'};
    const evidence=async(a,b,h)=>(await db.query('select sellerpilot_private.lazada_same_account_oauth_evidence_v1($1::jsonb,$2::jsonb,$3::jsonb) ok',[JSON.stringify(a),JSON.stringify(b),JSON.stringify(h)])).rows[0].ok;
    assert.equal(await evidence(imFixture,imFixture,[{}, {}, {}]),true);
    assert.equal(await evidence(imFixture,imFixture,[{seller_id:'200100300'}, {}, {}]),false);
    assert.equal(await evidence(imFixture,imFixture,[{sellerId:'300872000183'}, {}, {}]),true);
    assert.equal(await evidence(imFixture,imFixture,[{target_id:null}, {}, {}]),false);
    assert.equal(await evidence(imFixture,imFixture,[{short_code:'OTHERSELLER'}, {}, {}]),false);
    for(const changed of [{app_key:'other'},{im_app_key:'other'},{im_access_token:'rotated'},{country:'sg'}]) assert.equal(await evidence(imFixture,{...imFixture,...changed},[{}, {}, {}]),false);
    await assertThreeBlockersIntact('conflicting evidence is rejected without modifying any old job');
    await db.exec("update sellerpilot_private.lazada_same_account_oauth_boundary set installed_at=clock_timestamp()");
    assert.equal((await db.query('select sellerpilot_private.exact_lazada_three_readback_proof($1) proof',[TARGET_ROW_ID])).rows[0].proof,null);
    await db.query('update sellerpilot_private.channel_market_targets set updated_at=clock_timestamp() where id=$1',[TARGET_ROW_ID]);
    await assertThreeBlockersIntact('OAuth before installation cannot supersede old recon');
    await db.exec("update sellerpilot_private.lazada_same_account_oauth_boundary set installed_at=clock_timestamp()-interval '10 minutes'");
    for(const role of ['anon','authenticated','service_role']){
      await db.exec('set role '+role);
      await assert.rejects(db.query('select * from sellerpilot_private.lazada_same_account_oauth_boundary'),{code:'42501'});
      await assert.rejects(db.query("select sellerpilot_private.lazada_same_account_oauth_evidence_v1('{}','{}','[]')"),{code:'42501'});
      await db.exec('reset role');
    }

    await db.query(
      "update sellerpilot_private.channel_market_targets set updated_at=clock_timestamp() where id=$1",
      [TARGET_ROW_ID],
    );

    // 500 alone must never attest synthetic terminal job fields. Completion
    // cleanup and immutable exact-session receipts are exercised by the full
    // current-preimage controller fixture in lazada-oauth-exact-preimage.
    await assertThreeBlockersIntact('without 600 exact allocation evidence, even plausible OAuth/readback rows fail closed');
    assert.equal((await db.query('select sellerpilot_private.exact_lazada_three_readback_proof($1) proof',[TARGET_ROW_ID])).rows[0].proof,null);
    assert.equal((await db.query('select count(*)::integer value from sellerpilot_private.operation_audit')).rows[0].value,0);
    await assert.rejects(db.exec(patch),/LAZADA_SAME_ACCOUNT_PROOF_ALREADY_DEFINED/);
    await db.exec('rollback');
  } finally {
    await db.close();
  }
});
