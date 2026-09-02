import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260902093000_stabilize_ebay_exact_content_fingerprint.sql",
  import.meta.url,
);
const recoveryUrl = new URL(
  "../lib/channels/ebay-exact-existing-qa-recovery.ts",
  import.meta.url,
);
const routeUrl = new URL(
  "../app/api/admin/channel-operations/route.ts",
  import.meta.url,
);
const currentCredentialMigrationUrl = new URL(
  "../supabase/migrations/20260901082000_bind_ebay_exact_update_to_current_active_credential.sql",
  import.meta.url,
);
const currentLineageMigrationUrl = new URL(
  "../supabase/migrations/20260901194336_rebind_ebay_exact_current_credential_lineage.sql",
  import.meta.url,
);

const oldFingerprint =
  "bda8692c79751806c5a1103a955a13462522ad0adf889259d3a804ba2a4ac231";
const stableBaseFingerprint =
  "21ed51a94009c586f0619780ad9ea0d0e8162b26d9759bdde19240f47b72ed97";
const stableFingerprint =
  "acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef";
const sellerAccountKey =
  "cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f";

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const bodyStart = source.indexOf("as $$", start);
  assert.notEqual(bodyStart, -1, `${signature} body must exist`);
  const end = source.indexOf("$$;", bodyStart + 5);
  assert.notEqual(end, -1, `${signature} end must exist`);
  return source.slice(start, end + 3);
}

test("eBay stable fingerprint migration changes only the exact content permit contract", async () => {
  const [migration, recovery, route] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(recoveryUrl, "utf8"),
    readFile(routeUrl, "utf8"),
  ]);

  for (const exactValue of [
    "8b2cbfaf-3854-437d-b381-abfd70291354",
    "800551945442",
    "244042196011",
    "7ae83178-d335-4b7e-8e35-2f55e905bbde",
    "cc771e4ba635f617f33d7da425c2ee7dd9c6ec161ac84f3d593060052eaf609f",
    oldFingerprint,
    stableFingerprint,
  ]) {
    assert.match(migration, new RegExp(exactValue, "u"));
  }
  assert.match(recovery, new RegExp(stableBaseFingerprint, "u"));
  assert.match(recovery, new RegExp(stableFingerprint, "u"));
  assert.match(
    route,
    /fingerprintArguments = ebayExactV101ArgumentsForFingerprint\(\s*channelFingerprintArguments/u,
  );
  assert.match(
    migration,
    /permit\.request_fingerprint in \([\s\S]*bda8692c[\s\S]*acb0e555/u,
  );
  assert.match(
    migration,
    /set request_fingerprint = p_request_fingerprint,[\s\S]*credential_id = p_credential_id/u,
  );
  assert.match(
    migration,
    /new\.request_fingerprint =\s*'acb0e555ffeef218ce12fb30ee4b5e4824e8524d7dbc2ceab19d1076597940ef'/u,
  );
  assert.match(
    migration,
    /ref\.canonical_public_url ~[\s\S]*supabase[\s\S]*sellerpilot-marketplace\/normalized\/29\/292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a/u,
  );
  assert.match(
    migration,
    /exact_existing_update_arguments_before_temu_173960/u,
  );
  assert.match(
    migration,
    /v_lazada_arguments[\s\S]*exact_existing_update_arguments_before_temu_173960[\s\S]*v_coupang_arguments[\s\S]*sp_173990_exact_args_pre/u,
  );
});

test("the migration stays dynamic and performs no permit, job, or provider action by itself", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /ebay_exact_current_credential_is_valid/u);
  assert.doesNotMatch(
    migration,
    /f78397ec-c387-48ec-b562-64e754d90ac5|742773ae-e2ce-4b06-99d2-7c6eb541af03/u,
  );
  assert.doesNotMatch(migration, /credential\.version\s*=\s*(101|105)/u);
  assert.doesNotMatch(
    migration,
    /insert\s+into\s+sellerpilot_private\.(?:exact_existing_update_permits|channel_gateway_jobs|operation_attempts)/iu,
  );
  assert.doesNotMatch(
    migration,
    /fetch\s*\(|api\.ebay\.com|providerMutationCount'\s*,\s*1/iu,
  );
  assert.match(
    migration,
    /migration changes no permit row, creates no job and never calls eBay/u,
  );
  assert.match(
    migration,
    /The migration itself never arms or calls the provider/u,
  );
});

test("the forward migration leaves the permit untouched until the dynamic arm RPC moves old to stable fingerprint", async () => {
  const [migration, currentCredentialMigration, currentLineageMigration] =
    await Promise.all([
      readFile(migrationUrl, "utf8"),
      readFile(currentCredentialMigrationUrl, "utf8"),
      readFile(currentLineageMigrationUrl, "utf8"),
    ]);
  const credentialValidator = extractFunction(
    currentCredentialMigration,
    "create function sellerpilot_private.ebay_exact_current_credential_is_valid(",
  );
  const arm = extractFunction(
    currentLineageMigration,
    "create or replace function public.sellerpilot_service_arm_ebay_no_effect_retry(",
  );
  const transitionBlock = currentLineageMigration.indexOf(
    "do $patch_ebay_current_content_permit_transition$",
  );
  const transitionStart = currentLineageMigration.indexOf(
    "v_transition constant text := $new$",
    transitionBlock,
  );
  const transitionBodyStart = transitionStart
    + "v_transition constant text := $new$".length;
  const transitionEnd = currentLineageMigration.indexOf(
    "$new$;",
    transitionBodyStart,
  );
  assert.notEqual(transitionBlock, -1);
  assert.notEqual(transitionStart, -1);
  assert.notEqual(transitionEnd, -1);
  const transition = currentLineageMigration.slice(
    transitionBodyStart,
    transitionEnd,
  );

  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema sellerpilot_private;
      create table sellerpilot_private.channel_credentials (
        id uuid primary key, channel text not null, environment text not null,
        status text not null, version integer not null, fingerprint text not null,
        seller_account_key text not null, seller_account_key_source text,
        seller_account_verified_at timestamptz, expires_at timestamptz,
        last_checked_at timestamptz, last_check_status text
      );
      create table sellerpilot_private.product_listings (
        id uuid primary key, owner_id uuid not null, channel_key text not null,
        remote_id text, market text, target_id text, marketplace_sku text,
        provider_resource_id text, currency text, price numeric,
        seller_account_key text
      );
      create table sellerpilot_private.exact_existing_update_permits (
        permit_id uuid primary key, channel text, listing_id uuid,
        remote_id text, provider_resource_id text, seller_account_key text,
        credential_id uuid, credential_version integer,
        credential_fingerprint text, credential_account_source text,
        credential_verified_at timestamptz, credential_expires_at timestamptz,
        credential_last_checked_at timestamptz,
        credential_last_check_status text, release_sha text,
        request_fingerprint text, armed_at timestamptz, expires_at timestamptz,
        update_job_id uuid, update_attempt_id uuid, arguments_sha256 text,
        arguments_bytes integer, request_payload_sha256 text,
        request_payload_bytes integer, bound_at timestamptz,
        bound_worker_token_id uuid, bound_claim_token uuid,
        consumed_at timestamptz, invalidated_at timestamptz,
        invalidation_reason text
      );
      create table sellerpilot_private.operation_audit (
        owner_id uuid, action text, entity_type text, entity_id text,
        safe_detail jsonb, occurred_at timestamptz
      );
      ${credentialValidator}
      create function sellerpilot_private.exact_existing_update_release_is_current(
        p_channel text, p_release_sha text
      ) returns boolean language sql stable as $$ select true $$;
      create function sellerpilot_private.ebay_exact_v101_content_arguments_valid(
        p_arguments jsonb
      ) returns boolean language sql immutable as $$
        select p_arguments->>'publicationExpectedFingerprint' = '${oldFingerprint}'
      $$;
      create function sellerpilot_private.exact_existing_update_arguments_before_temu_173960(
        p_channel text, p_arguments jsonb, p_release_sha text,
        p_request_fingerprint text, p_expected_stock integer
      ) returns boolean language sql immutable as $$
        select p_channel <> 'ebay' or (
          p_request_fingerprint = '${oldFingerprint}'
          and sellerpilot_private.ebay_exact_v101_content_arguments_valid(p_arguments)
        )
      $$;
      create function sellerpilot_private.exact_existing_update_arguments_before_lazada_173980(
        p_channel text, p_arguments jsonb, p_release_sha text,
        p_request_fingerprint text, p_expected_stock integer
      ) returns boolean language sql immutable as $$
        select sellerpilot_private.exact_existing_update_arguments_before_temu_173960(
          p_channel, p_arguments, p_release_sha, p_request_fingerprint,
          p_expected_stock
        )
      $$;
      create function sellerpilot_private.sp_173990_exact_args_pre(
        p_channel text, p_arguments jsonb, p_release_sha text,
        p_request_fingerprint text, p_expected_stock integer
      ) returns boolean language sql immutable as $$
        select sellerpilot_private.exact_existing_update_arguments_before_lazada_173980(
          p_channel, p_arguments, p_release_sha, p_request_fingerprint,
          p_expected_stock
        )
      $$;
      create function sellerpilot_private.exact_existing_update_arguments_valid(
        p_channel text, p_arguments jsonb, p_release_sha text,
        p_request_fingerprint text, p_expected_stock integer
      ) returns boolean language sql immutable as $$
        select sellerpilot_private.sp_173990_exact_args_pre(
          p_channel, p_arguments, p_release_sha, p_request_fingerprint,
          p_expected_stock
        )
      $$;
      create function sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(
        p_credential_id uuid, p_release_sha text, p_request_fingerprint text
      ) returns boolean language plpgsql stable as $$
      begin
        return p_request_fingerprint = '${oldFingerprint}'
          and sellerpilot_private.ebay_exact_current_credential_is_valid(
            p_credential_id, '${sellerAccountKey}'
          )
          and exists (
            select 1
              from sellerpilot_private.exact_existing_update_permits permit
             where true
               and permit.request_fingerprint = p_request_fingerprint
               and permit.credential_id is distinct from p_credential_id
          )
          and exists (
            select 1
              from (values (
                'https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/29/292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a.jpg'
              )) ref(canonical_public_url)
             where ref.canonical_public_url ~
               '^https://[a-z0-9-]+[.]supabase[.](co|in)/storage/v1/object/public/sellerpilot-marketplace/normalized/29/292b94242598d2cf1c9ca4b2f46aee31fdf467a8a852a6a1f56bf9ec37ada82a[.]jpg$'
          );
      end;
      $$;
      create function sellerpilot_private.guard_exact_existing_update_permit_transition()
      returns trigger language plpgsql as $$
      begin
      ${transition}
        raise exception 'exact permit immutable';
      end;
      $$;
      ${arm}
      insert into sellerpilot_private.channel_credentials values (
        '742773ae-e2ce-4b06-99d2-7c6eb541af03', 'ebay', 'production',
        'active', 105, 'A105A105A105', '${sellerAccountKey}',
        'provider_certified_v1', now() - interval '1 hour',
        now() + interval '1 day', now(), 'passed'
      );
      insert into sellerpilot_private.product_listings values (
        '8b2cbfaf-3854-437d-b381-abfd70291354',
        '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c', 'ebay',
        '800551945442', 'US', 'EBAY_US', 'QA-20260823-CC-001-US',
        '244042196011', 'USD', 12.90, '${sellerAccountKey}'
      );
      insert into sellerpilot_private.exact_existing_update_permits (
        permit_id, channel, listing_id, remote_id, provider_resource_id,
        seller_account_key, credential_id, credential_version,
        credential_fingerprint, credential_account_source,
        credential_verified_at, credential_expires_at,
        credential_last_checked_at, credential_last_check_status,
        release_sha, request_fingerprint, armed_at, expires_at
      ) values (
        '7ae83178-d335-4b7e-8e35-2f55e905bbde', 'ebay',
        '8b2cbfaf-3854-437d-b381-abfd70291354',
        '800551945442', '244042196011', '${sellerAccountKey}',
        'f78397ec-c387-48ec-b562-64e754d90ac5', 101, 'BEEF134012FD',
        'provider_certified_v1', now() - interval '2 days',
        now() - interval '1 day', now() - interval '2 days', 'passed',
        '${"d".repeat(40)}', '${oldFingerprint}',
        now() - interval '10 minutes', now() - interval '5 minutes'
      );
    `);

    await db.exec(migration);
    const definitions = Object.fromEntries(await Promise.all([
      ["content", "sellerpilot_private.ebay_exact_v101_content_arguments_valid(jsonb)"],
      ["arguments", "sellerpilot_private.exact_existing_update_arguments_before_temu_173960(text,jsonb,text,text,integer)"],
      ["proof", "sellerpilot_private.ebay_exact_v101_content_rebind_is_proved(uuid,text,text)"],
      ["guard", "sellerpilot_private.guard_exact_existing_update_permit_transition()"],
      ["arm", "public.sellerpilot_service_arm_ebay_no_effect_retry(text,uuid,uuid,text,text)"],
    ].map(async ([name, signature]) => [
      name,
      (await db.query("select pg_get_functiondef($1::regprocedure) definition", [
        signature,
      ])).rows[0].definition,
    ])));
    for (const name of ["content", "arguments"]) {
      assert.match(definitions[name], new RegExp(stableFingerprint, "u"));
      assert.doesNotMatch(definitions[name], new RegExp(oldFingerprint, "u"));
    }
    for (const name of ["proof", "guard", "arm"]) {
      assert.match(definitions[name], new RegExp(stableFingerprint, "u"));
      assert.match(definitions[name], /ebay_exact_current_credential_is_valid/u);
      assert.doesNotMatch(
        definitions[name],
        /f78397ec-c387-48ec-b562-64e754d90ac5|BEEF134012FD|credential\.version = 101/u,
      );
    }
    assert.match(definitions.proof, /ref\.canonical_public_url ~[\s\S]*sellerpilot-marketplace/u);
    assert.match(definitions.guard, /old\.request_fingerprint in \([\s\S]*acb0e555/u);
    assert.match(definitions.arm, /set request_fingerprint = p_request_fingerprint/u);

    const untouched = (await db.query(`
      select request_fingerprint, credential_id, credential_version,
             update_job_id, consumed_at
        from sellerpilot_private.exact_existing_update_permits
    `)).rows[0];
    assert.deepEqual(untouched, {
      request_fingerprint: oldFingerprint,
      credential_id: "f78397ec-c387-48ec-b562-64e754d90ac5",
      credential_version: 101,
      update_job_id: null,
      consumed_at: null,
    });

    await db.exec("set request.jwt.claim.role = 'service_role'");
    const armed = (await db.query(
      `select public.sellerpilot_service_arm_ebay_no_effect_retry(
         'ebay', '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid,
         '742773ae-e2ce-4b06-99d2-7c6eb541af03'::uuid,
         $1::text, $2::text
       ) result`,
      ["d".repeat(40), stableFingerprint],
    )).rows[0].result;
    assert.equal(armed.rearmed, true);
    assert.equal(armed.requestFingerprint, stableFingerprint);
    assert.deepEqual((await db.query(`
      select request_fingerprint, credential_id, credential_version,
             expires_at = armed_at + interval '5 minutes' exact_ttl
        from sellerpilot_private.exact_existing_update_permits
    `)).rows[0], {
      request_fingerprint: stableFingerprint,
      credential_id: "742773ae-e2ce-4b06-99d2-7c6eb541af03",
      credential_version: 105,
      exact_ttl: true,
    });
  } finally {
    await db.close();
  }
});
