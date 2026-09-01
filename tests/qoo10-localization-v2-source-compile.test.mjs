import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const sourceMigrationUrl = new URL(
  "../supabase/migrations/20260831144000_generalize_qoo10_exact_localization_s1_activation.sql",
  import.meta.url,
);
const fixMigrationUrl = new URL(
  "../supabase/migrations/20260901173650_fix_qoo10_exact_localization_v2_source_compile.sql",
  import.meta.url,
);

const ids = {
  owner: "768ce4ac-0ef2-4e01-89dc-05aa4fa8543c",
  product: "ddccde35-9c58-4856-b673-d7aa27ce4220",
  listing: "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc",
  credential: "2b49d081-5188-4a75-9555-e0a6438e8a2b",
  createdBy: "21eb1892-0894-4f9f-b414-4c9464182dd6",
  job: "11111111-1111-4111-8111-111111111111",
  attempt: "22222222-2222-4222-8222-222222222222",
};
const releaseSha = "a".repeat(40);
const requestFingerprint = "b".repeat(64);
const sellerAccountKey =
  "2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46";
const preSha = "f754b74e2b961dfe794303a0eefcddc282c4fd5b6151ea55f494cab038b744c4";
const postSha = "e717d7faacf36e8ec0fc1ae36045b881ef5f874f6e83ad02d2000f65f6ea43b6";

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const bodyStart = source.indexOf("as $$", start);
  assert.notEqual(bodyStart, -1, `${signature} body must exist`);
  const end = source.indexOf("$$;", bodyStart + 5);
  assert.notEqual(end, -1, `${signature} end must exist`);
  return source.slice(start, end + 3);
}

test("Qoo10 localization v2 source compiles and remains fail-closed", async () => {
  const sourceMigration = await readFile(sourceMigrationUrl, "utf8");
  const fixMigration = await readFile(fixMigrationUrl, "utf8");
  const sourceFunction = extractFunction(
    sourceMigration,
    "create function sellerpilot_private.qoo10_exact_localization_v2_source_is_current(",
  );
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema extensions;
      create schema sellerpilot_private;

      create table sellerpilot_private.channel_gateway_jobs (
        id uuid primary key, attempt_id uuid, listing_id uuid,
        credential_id uuid, created_by uuid, channel text, operation text,
        environment text, status text, attempt_count integer,
        provider_mutation_started_at timestamptz, completed_at timestamptz,
        response_payload jsonb, seller_account_key text,
        request_fingerprint text, request_payload jsonb, created_at timestamptz
      );
      create table sellerpilot_private.gateway_completion_receipts (
        job_id uuid
      );
      create table sellerpilot_private.channel_operation_attempts (
        id uuid primary key, owner_id uuid, credential_id uuid,
        channel text, operation text, status text, remote_id text,
        request_fingerprint text, completed_at timestamptz,
        gateway_write_required boolean, pre_gateway_retryable boolean
      );
      create table sellerpilot_private.product_listings (
        id uuid primary key, owner_id uuid, product_id uuid,
        channel_key text, market text, target_id text, status text,
        failure_class text, remote_visibility text,
        requested_publication_intent text, remote_id text,
        seller_account_key text
      );
      create table sellerpilot_private.products (
        id uuid primary key, owner_id uuid, demo boolean, status text
      );
      create table sellerpilot_private.channel_credentials (
        id uuid primary key, channel text, environment text, status text,
        seller_account_key text
      );

      create function extensions.digest(p_value text, p_algorithm text)
      returns bytea language sql immutable as $$
        select decode(
          case when strpos(p_value, E'  v_params jsonb;') > 0
            then '${postSha}' else '${preSha}' end,
          'hex'
        )
      $$;
      create function
        sellerpilot_private.qoo10_exact_localization_v2_arguments_valid(
          p_arguments jsonb, p_release_sha text
        )
      returns boolean language sql immutable set search_path = '' as $$
        select jsonb_typeof(p_arguments->'params') = 'object'
          and jsonb_typeof(
            p_arguments->'sellerpilotQoo10ExactLocalization'
          ) = 'object'
          and p_arguments#>>
                '{sellerpilotQoo10ExactLocalization,releaseSha}' =
              p_release_sha
          and p_arguments#>>'{params,ItemCode}' = '1217336970'
      $$;
      create function sellerpilot_private.qoo10_exact_response_state_valid(
        p_response jsonb, p_operation text, p_step_name text,
        p_expected_status text, p_expected_visibility text,
        p_source_arguments jsonb
      )
      returns boolean language sql immutable strict set search_path = '' as $$
        select p_response->>'ok' = 'true'
          and p_operation = 'listing.update'
          and p_step_name = 'qoo10-rollback-pre-activation-readback'
          and p_expected_status = 'S1'
          and p_expected_visibility = 'non_public'
          and p_source_arguments#>>'{params,ItemCode}' = '1217336970'
      $$;
    `);
    await db.exec(sourceFunction);
    await db.exec(`
      revoke all on function
        sellerpilot_private.qoo10_exact_localization_v2_source_is_current(
          uuid, text
        ) from public, anon, authenticated, service_role;

      insert into sellerpilot_private.products values (
        '${ids.product}', '${ids.owner}', false, 'active'
      );
      insert into sellerpilot_private.channel_credentials values (
        '${ids.credential}', 'qoo10', 'production', 'active',
        '${sellerAccountKey}'
      );
      insert into sellerpilot_private.product_listings values (
        '${ids.listing}', '${ids.owner}', '${ids.product}', 'qoo10', 'JP', '',
        'failed', 'external_action', 'unknown', 'live', '1217336970',
        '${sellerAccountKey}'
      );
      insert into sellerpilot_private.channel_operation_attempts values (
        '${ids.attempt}', '${ids.owner}', '${ids.credential}', 'qoo10',
        'listing.update', 'manual_required', '1217336970',
        '${requestFingerprint}', '2026-09-01 09:00:05+00', true, false
      );
      insert into sellerpilot_private.channel_gateway_jobs values (
        '${ids.job}', '${ids.attempt}', '${ids.listing}', '${ids.credential}',
        '${ids.createdBy}', 'qoo10', 'listing.update', 'production',
        'reconciliation_required', 1, '2026-09-01 09:00:01+00',
        '2026-09-01 09:00:05+00',
        jsonb_build_object(
          'ok', false,
          'publicationFulfilled', false,
          'steps', jsonb_build_array(
            jsonb_build_object(
              'name', 'qoo10-exact-current-s1-prewrite-readback',
              'ok', true, 'status', 200,
              'data', jsonb_build_object('ResultCode', 0)
            ),
            jsonb_build_object(
              'name', 'UpdateGoods', 'ok', true, 'status', 200,
              'data', jsonb_build_object('ResultCode', 0)
            ),
            jsonb_build_object(
              'name', 'EditGoodsContents', 'ok', true, 'status', 200,
              'data', jsonb_build_object('ResultCode', 0)
            ),
            jsonb_build_object(
              'name', 'qoo10-rollback-pre-activation-readback',
              'ok', true, 'status', 200,
              'data', jsonb_build_object('ResultCode', 0)
            )
          )
        ),
        '${sellerAccountKey}', '${requestFingerprint}',
        jsonb_build_object(
          'arguments', jsonb_build_object(
            'params', jsonb_build_object('ItemCode', '1217336970'),
            'sellerpilotQoo10ExactLocalization', jsonb_build_object(
              'releaseSha', '${releaseSha}'
            ),
            'publicationExpectedImageCount', 8
          )
        ),
        '2026-09-01 09:00:00+00'
      );
      insert into sellerpilot_private.gateway_completion_receipts
        values ('${ids.job}');
    `);

    assert.equal(
      (await db.query(
        `select sellerpilot_private.qoo10_exact_localization_v2_source_is_current(
          $1, $2
        ) value`,
        [ids.job, releaseSha],
      )).rows[0].value,
      false,
      "the undeclared projections must fail closed before the forward fix",
    );

    await db.exec(fixMigration);

    assert.equal(
      (await db.query(
        `select sellerpilot_private.qoo10_exact_localization_v2_source_is_current(
          $1, $2
        ) value`,
        [ids.job, releaseSha],
      )).rows[0].value,
      true,
    );

    await db.query(
      `update sellerpilot_private.channel_gateway_jobs
          set request_payload = request_payload #- '{arguments,params}'
        where id = $1`,
      [ids.job],
    );
    assert.equal(
      (await db.query(
        `select sellerpilot_private.qoo10_exact_localization_v2_source_is_current(
          $1, $2
        ) value`,
        [ids.job, releaseSha],
      )).rows[0].value,
      false,
      "a missing params object must remain rejected",
    );

    const metadata = (await db.query(`
      select pg_get_userbyid(proc.proowner) as owner,
             lang.lanname as language,
             proc.provolatile as volatility,
             proc.prosecdef as "securityDefiner",
             proc.proconfig as config,
             proc.proacl::text as acl,
             proc.prosrc
        from pg_proc proc
        join pg_language lang on lang.oid = proc.prolang
       where proc.oid =
         'sellerpilot_private.qoo10_exact_localization_v2_source_is_current(uuid,text)'::regprocedure
    `)).rows[0];
    assert.equal(metadata.owner, "postgres");
    assert.equal(metadata.language, "plpgsql");
    assert.equal(metadata.volatility, "s");
    assert.equal(metadata.securityDefiner, true);
    assert.deepEqual(metadata.config, ['search_path=""']);
    assert.equal(metadata.acl, "{postgres=X/postgres}");
    assert.match(metadata.prosrc, / {2}v_params jsonb;/u);
    assert.match(
      metadata.prosrc,
      /v_marker := v_arguments->'sellerpilotQoo10ExactLocalization';/u,
    );
  } finally {
    await db.close();
  }
});
