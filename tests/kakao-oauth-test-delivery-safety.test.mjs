import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const urls = {
  callback: new URL("../app/api/integrations/kakao/callback/route.ts", import.meta.url),
  connect: new URL("../app/api/integrations/kakao/connect/route.ts", import.meta.url),
  internal: new URL("../app/api/internal/kakao-notifications/route.ts", import.meta.url),
  settings: new URL("../app/api/integrations/kakao/settings/route.ts", import.meta.url),
  library: new URL("../lib/kakao.ts", import.meta.url),
  page: new URL("../app/page.tsx", import.meta.url),
  migration: new URL("../supabase/migrations/20260825105100_harden_kakao_oauth_and_test_delivery.sql", import.meta.url),
};

const ADMIN_ID = "d0f39ad6-e4af-4b7e-965d-9e0a324f2fab";
const SECOND_ADMIN_ID = "1173e28d-9b03-46cc-a207-b68a780e95c7";

const supabaseCompatibilityLayer = String.raw`
do $$ begin create role anon noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role noinherit; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now()
);
create or replace function auth.uid()
returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema if not exists vault;
create table if not exists vault.secrets (
  id uuid primary key default gen_random_uuid(),
  secret text not null,
  name text,
  description text,
  created_at timestamptz not null default now()
);
create or replace function vault.create_secret(
  new_secret text,
  new_name text default null,
  new_description text default ''
)
returns uuid language plpgsql
as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into vault.secrets (id, secret, name, description)
  values (v_id, new_secret, new_name, new_description);
  return v_id;
end;
$$;
create or replace view vault.decrypted_secrets as
select id, secret as decrypted_secret from vault.secrets;
create or replace function vault.delete_secret(secret_id uuid)
returns void language sql
as $$ delete from vault.secrets where id = secret_id $$;
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name text not null
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(path text)
returns text[] language sql immutable
as $$ select string_to_array(path, '/') $$;
create schema if not exists extensions;
create or replace function extensions.digest(value text, algorithm text)
returns bytea language sql immutable
as $$ select convert_to(md5(value || algorithm), 'UTF8') $$;
`;

function withoutUnavailableExtensions(sql) {
  return sql
    .replace(/^create extension if not exists pgcrypto;\s*$/gim, "")
    .replace(/^create extension if not exists supabase_vault with schema vault;\s*$/gim, "");
}

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

function rpcSection(source, functionName, nextNeedle) {
  const start = source.indexOf(functionName);
  assert.ok(start >= 0, `${functionName} call is missing`);
  const end = source.indexOf(nextNeedle, start + functionName.length);
  assert.ok(end > start, `${functionName} call boundary is missing`);
  return source.slice(start, end);
}

test("Kakao OAuth callback stores one-time state and fences the code exchange before the provider call", async () => {
  const [connect, callback] = await Promise.all([
    readFile(urls.connect, "utf8"),
    readFile(urls.callback, "utf8"),
  ]);

  const stateRegistration = connect.indexOf("sellerpilot_service_register_kakao_oauth_state");
  const authorizationUrl = connect.indexOf("https://kauth.kakao.com/oauth/authorize");
  assert.ok(stateRegistration >= 0 && authorizationUrl > stateRegistration);
  assert.match(connect, /p_state_nonce: nonce/);
  assert.match(connect, /p_owner_id: admin\.user\.id/);

  const claim = callback.indexOf("sellerpilot_service_claim_kakao_oauth_callback");
  const begin = callback.indexOf("sellerpilot_service_begin_kakao_oauth_exchange");
  const exchange = callback.indexOf("await exchangeKakaoAuthorizationCode", begin);
  const stage = callback.indexOf("sellerpilot_service_stage_kakao_oauth_token");
  const profile = callback.indexOf("await fetchKakaoProfile", stage);
  const complete = callback.indexOf("sellerpilot_service_complete_kakao_oauth_connection");
  assert.ok(claim >= 0 && begin > claim && exchange > begin && stage > exchange && profile > stage && complete > profile);
  assert.equal([...callback.matchAll(/p_authorization_code:/g)].length, 1);
  assert.equal([...callback.matchAll(/p_secret_payload:/g)].length, 1);
  assert.doesNotMatch(callback, /console\.(?:log|info|warn|error)/);

  const beginRequest = rpcSection(callback, "sellerpilot_service_begin_kakao_oauth_exchange", "if (!begun.ok");
  assert.doesNotMatch(beginRequest, /authorizationCode|tokenPayload|access_token|refresh_token|p_secret_payload/);
  const completionRequest = rpcSection(callback, "sellerpilot_service_complete_kakao_oauth_connection", "return finish(");
  assert.doesNotMatch(completionRequest, /authorizationCode|tokenPayload|access_token|refresh_token|p_secret_payload/);
  assert.match(callback, /claim\.status === "connected"/);
  assert.match(callback, /claim\.status === "failed"/);
  assert.match(callback, /claim\.status === "reconciliation_required"/);
});

test("Kakao OAuth stages the token in Vault before profile lookup and only explicit rejection becomes failed", async () => {
  const [callback, library, migration] = await Promise.all([
    readFile(urls.callback, "utf8"),
    readFile(urls.library, "utf8"),
    readFile(urls.migration, "utf8"),
  ]);

  assert.match(library, /export class KakaoProviderError/);
  assert.match(library, /status >= 400 && status < 500[\s\S]{0,100}"rejected"[\s\S]{0,100}"uncertain"/);
  assert.match(library, /KAKAO_CODE_EXCHANGE_TOKEN_MISSING", "uncertain"/);
  assert.match(library, /KAKAO_REFRESH_TOKEN_MISSING", "uncertain"/);
  assert.match(library, /payload\.result_code !== 0[\s\S]{0,120}KAKAO_MEMO_RESPONSE_INVALID", "uncertain"/);
  assert.match(callback, /rejected \? "failed" : "reconciliation_required"/);
  assert.match(callback, /profileFailure instanceof KakaoProviderError && profileFailure\.kind === "rejected"/);
  assert.match(callback, /sellerpilot_service_release_kakao_oauth_claim/);

  assert.match(migration, /create table if not exists sellerpilot_private\.kakao_oauth_callback_attempts/);
  assert.match(migration, /authorization_code_vault_id uuid/);
  assert.match(migration, /staged_token_vault_id uuid/);
  assert.match(migration, /code_fingerprint text/);
  assert.match(migration, /staged_token_fingerprint text/);
  const ledgerDefinition = migration.slice(
    migration.indexOf("create table if not exists sellerpilot_private.kakao_oauth_callback_attempts"),
    migration.indexOf("create index if not exists kakao_oauth_callback_owner_time_idx"),
  );
  assert.doesNotMatch(ledgerDefinition, /authorization_code\s+text/);
  assert.doesNotMatch(ledgerDefinition, /token_payload\s+jsonb/);
  assert.match(migration, /Temporary claim-bound Kakao OAuth authorization code/);
  assert.match(migration, /Temporary claim-bound Kakao OAuth token response/);
  assert.match(migration, /delete from vault\.secrets where id = v_attempt\.authorization_code_vault_id/);
  assert.doesNotMatch(migration, /vault\.delete_secret/);
  assert.match(migration, /status = 'connected'[\s\S]{0,500}staged_token_vault_id = null/);
  assert.match(migration, /status = 'exchanging'[\s\S]{0,500}provider_started_at = clock_timestamp\(\)/);
  assert.match(migration, /KAKAO_CODE_EXCHANGE_OUTCOME_UNKNOWN/);
  assert.match(migration, /revoke all on sellerpilot_private\.kakao_oauth_callback_attempts/);
});

test("manual Kakao test uses one request id, one refresh mutation, and one non-repeating memo send", async () => {
  const [settings, page, migration] = await Promise.all([
    readFile(urls.settings, "utf8"),
    readFile(urls.page, "utf8"),
    readFile(urls.migration, "utf8"),
  ]);

  assert.match(page, /const kakaoTestRequestIdRef = useRef<string \| null>\(null\)/);
  assert.match(page, /kakaoTestRequestIdRef\.current \?\? crypto\.randomUUID\(\)/);
  assert.match(page, /JSON\.stringify\(\{ action: "test", requestId \}\)/);

  const claim = settings.indexOf("sellerpilot_service_claim_kakao_test_delivery");
  const beginRefresh = settings.indexOf("sellerpilot_service_begin_kakao_notification_refresh");
  const refresh = settings.indexOf("refreshKakaoToken(secret)");
  const stageRefresh = settings.indexOf("sellerpilot_service_stage_kakao_notification_refresh");
  const beginSend = settings.indexOf("sellerpilot_service_begin_kakao_notification_send");
  const send = settings.indexOf("await sendKakaoMemo");
  const complete = settings.indexOf("sellerpilot_service_complete_kakao_notification", send);
  assert.ok(
    claim >= 0
    && beginRefresh > claim
    && refresh > beginRefresh
    && stageRefresh > refresh
    && beginSend > stageRefresh
    && send > beginSend
    && complete > send,
  );
  assert.equal([...settings.matchAll(/refreshKakaoToken\(secret\)/g)].length, 1);
  assert.equal([...settings.matchAll(/await sendKakaoMemo/g)].length, 1);
  assert.doesNotMatch(settings, /catch[\s\S]{0,500}refreshKakaoToken\(secret\)[\s\S]{0,500}sendKakaoMemo/);
  assert.match(settings, /sendFailure \? \(rejected \? "failed" : "reconciliation_required"\) : "sent"/);
  assert.doesNotMatch(settings, /console\.(?:log|info|warn|error)/);

  assert.match(migration, /kakao_manual_test_request_idx/);
  assert.match(migration, /kakao_manual_test_unresolved_owner_idx/);
  assert.match(migration, /status in \('preparing', 'sending', 'reconciliation_required'\)/);
  assert.match(migration, /credential_refresh_started_at/);
  assert.match(migration, /credential_refresh_completed_at/);
  assert.match(migration, /KAKAO_REFRESH_OUTCOME_UNKNOWN/);
  assert.match(migration, /where not d\.is_manual_test/);
});

test("production Kakao scheduler stages refresh tokens and blocks the owner after an uncertain refresh", async () => {
  const [source, migration] = await Promise.all([
    readFile(urls.internal, "utf8"),
    readFile(urls.migration, "utf8"),
  ]);
  const beginRefresh = source.indexOf("sellerpilot_service_begin_kakao_notification_refresh");
  const providerRefresh = source.indexOf("refreshKakaoToken(secret)");
  const stageRefresh = source.indexOf("sellerpilot_service_stage_kakao_notification_refresh");
  const beginSend = source.indexOf("sellerpilot_service_begin_kakao_notification_send");
  assert.ok(beginRefresh >= 0 && providerRefresh > beginRefresh && stageRefresh > providerRefresh && beginSend > stageRefresh);
  assert.doesNotMatch(source, /sellerpilot_service_store_kakao_integration/);
  assert.equal([...source.matchAll(/refreshKakaoToken\(secret\)/g)].length, 1);
  assert.match(source, /refreshError instanceof KakaoProviderError && refreshError\.kind === "rejected"/);
  assert.match(source, /rejected \? "failed" : "reconciliation_required"/);
  assert.match(source, /KAKAO_REFRESH_STAGE_UNCERTAIN/);
  assert.match(source, /claimHandled: true/);

  assert.match(migration, /kakao_notification_one_unresolved_refresh_owner_idx/);
  assert.match(migration, /kakao_notification_one_active_delivery_owner_idx/);
  assert.match(migration, /where status in \('preparing', 'sending'\)/);
  assert.match(migration, /with owner_candidates as materialized/);
  assert.match(migration, /for update of k skip locked/);
  assert.match(migration, /order by case when d\.status = 'preparing' then 0 else 1 end/);
  assert.match(migration, /active_delivery\.status = 'sending'/);
  assert.match(migration, /active_delivery\.status = 'preparing'/);
  assert.match(migration, /'status', 'in_progress'[\s\S]{0,160}'requestConflict', true/);
  assert.match(migration, /blocked\.status in \('preparing', 'reconciliation_required'\)/);
  assert.match(migration, /blocked\.credential_refresh_started_at is not null/);
  assert.match(migration, /blocked\.credential_refresh_completed_at is null/);
  assert.match(migration, /where d\.status = 'preparing'[\s\S]{0,180}d\.credential_refresh_started_at is not null/);
});

test("Kakao temporary Vault data has bounded sweep and service-role-only functions", async () => {
  const migration = await readFile(urls.migration, "utf8");
  assert.match(migration, /sellerpilot_service_sweep_kakao_oauth_callbacks/);
  assert.match(migration, /token_staged_at <= clock_timestamp\(\) - interval '24 hours'/);
  assert.match(migration, /state_expires_at \+ interval '1 hour'/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.sellerpilot_service_complete_kakao_oauth_connection[\s\S]{0,120}to service_role/);
  assert.match(migration, /grant execute on function public\.sellerpilot_service_stage_kakao_notification_refresh[\s\S]{0,120}to service_role/);
});

test("Kakao OAuth and manual-test ledgers replay terminal outcomes without repeating provider mutations", async () => {
  const db = new PGlite();
  const stateNonce = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const staleStateNonce = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const testRequestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const uncertainRequestId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const blockedRequestId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const ownerBlockedManualRequestId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const concurrentManualRequestId = "99999999-9999-4999-8999-999999999999";
  const authorizationCode = "kakao-authorization-code-never-in-ledger";
  const staleAuthorizationCode = "kakao-stale-authorization-code";
  try {
    await db.exec(supabaseCompatibilityLayer);
    const migrationUrl = new URL("../supabase/migrations/", import.meta.url);
    const names = (await readdir(migrationUrl))
      .filter((name) => name.endsWith(".sql") && name <= "20260825105100_harden_kakao_oauth_and_test_delivery.sql")
      .sort();
    for (const name of names) {
      const sql = await readFile(new URL(name, migrationUrl), "utf8");
      await db.exec(withoutUnavailableExtensions(sql));
    }
    await db.query(
      "insert into auth.users (id, email) values ($1, 'kakao-owner@example.test'), ($2, 'kakao-second@example.test')",
      [ADMIN_ID, SECOND_ADMIN_ID],
    );
    await db.query(
      "insert into sellerpilot_private.admin_users (user_id, display_name) values ($1, 'Kakao Owner'), ($2, 'Kakao Second')",
      [ADMIN_ID, SECOND_ADMIN_ID],
    );
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [ADMIN_ID]);
    await db.query("select set_config('request.jwt.claim.role', 'service_role', false)");

    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_register_kakao_oauth_state($1, $2, 'https://example.test/api/integrations/kakao/callback', now() + interval '10 minutes')",
        [ADMIN_ID, stateNonce],
      ),
      true,
    );
    const claim = await scalar(
      db,
      "select public.sellerpilot_service_claim_kakao_oauth_callback($1, $2, 'https://example.test/api/integrations/kakao/callback', $3, 180)",
      [ADMIN_ID, stateNonce, authorizationCode],
    );
    assert.equal(claim.status, "claimed");
    assert.equal(claim.phase, "prepared");
    assert.match(claim.attemptId, /^[0-9a-f-]{36}$/i);
    assert.match(claim.claimToken, /^[0-9a-f-]{36}$/i);
    assert.equal(
      await scalar(db, "select count(*) from vault.secrets where secret = $1", [authorizationCode]),
      1,
    );
    assert.equal(
      (await scalar(
        db,
        "select public.sellerpilot_service_claim_kakao_oauth_callback($1, $2, 'https://example.test/api/integrations/kakao/callback', $3, 180)",
        [ADMIN_ID, stateNonce, authorizationCode],
      )).status,
      "in_progress",
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_kakao_oauth_exchange($1, $2)",
        [claim.attemptId, claim.claimToken],
      ),
      true,
    );
    await db.query(
      `insert into sellerpilot_private.kakao_notification_deliveries (
        owner_id, event_key, event_type, title, body, link_path
      ) values ($1, 'refresh-uncertain:blocked', 'low_stock', 'Blocked', 'Blocked body', '/')`,
      [SECOND_ADMIN_ID],
    );
    assert.equal(
      (await db.query("select * from public.sellerpilot_service_claim_kakao_notifications(10, 180)")).rows.length,
      0,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_kakao_oauth_exchange($1, $2)",
        [claim.attemptId, claim.claimToken],
      ),
      false,
    );
    const oauthToken = {
      access_token: "oauth-access-token-secret",
      refresh_token: "oauth-refresh-token-secret",
      expires_in: 21_600,
    };
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_stage_kakao_oauth_token($1, $2, $3::jsonb, now() + interval '6 hours')",
        [claim.attemptId, claim.claimToken, JSON.stringify(oauthToken)],
      ),
      true,
    );
    assert.equal(
      await scalar(db, "select count(*) from vault.secrets where secret = $1", [authorizationCode]),
      0,
    );
    const claimedToken = await scalar(
      db,
      "select public.sellerpilot_service_get_claimed_kakao_oauth_token($1, $2)",
      [claim.attemptId, claim.claimToken],
    );
    assert.deepEqual(claimedToken.secret, oauthToken);
    const integrationId = await scalar(
      db,
      "select public.sellerpilot_service_complete_kakao_oauth_connection($1, $2, '123456789', 'Kakao Test')",
      [claim.attemptId, claim.claimToken],
    );
    assert.match(integrationId, /^[0-9a-f-]{36}$/i);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_kakao_oauth_connection($1, $2, '123456789', 'Kakao Test')",
        [claim.attemptId, claim.claimToken],
      ),
      integrationId,
    );
    assert.equal(
      (await scalar(
        db,
        "select public.sellerpilot_service_claim_kakao_oauth_callback($1, $2, 'https://example.test/api/integrations/kakao/callback', $3, 180)",
        [ADMIN_ID, stateNonce, authorizationCode],
      )).status,
      "connected",
    );
    const relationalLedger = await scalar(
      db,
      "select row_to_json(a)::text from sellerpilot_private.kakao_oauth_callback_attempts a where id = $1",
      [claim.attemptId],
    );
    assert.doesNotMatch(relationalLedger, /kakao-authorization-code|oauth-access-token|oauth-refresh-token/);

    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_register_kakao_oauth_state($1, $2, 'https://example.test/api/integrations/kakao/callback', now() + interval '10 minutes')",
        [ADMIN_ID, staleStateNonce],
      ),
      true,
    );
    const staleClaim = await scalar(
      db,
      "select public.sellerpilot_service_claim_kakao_oauth_callback($1, $2, 'https://example.test/api/integrations/kakao/callback', $3, 180)",
      [ADMIN_ID, staleStateNonce, staleAuthorizationCode],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_kakao_oauth_exchange($1, $2)",
        [staleClaim.attemptId, staleClaim.claimToken],
      ),
      true,
    );
    await db.query(
      "update sellerpilot_private.kakao_oauth_callback_attempts set lease_expires_at = now() - interval '1 second' where id = $1",
      [staleClaim.attemptId],
    );
    await db.query("select public.sellerpilot_service_sweep_kakao_oauth_callbacks()");
    assert.equal(
      await scalar(db, "select status from sellerpilot_private.kakao_oauth_callback_attempts where id = $1", [staleClaim.attemptId]),
      "reconciliation_required",
    );
    assert.equal(
      await scalar(db, "select count(*) from vault.secrets where secret = $1", [staleAuthorizationCode]),
      0,
    );

    await scalar(
      db,
      "select public.sellerpilot_service_store_kakao_integration($1, $2::jsonb, 'second-kakao-user', 'Second Kakao', now() - interval '1 minute')",
      [SECOND_ADMIN_ID, JSON.stringify({ access_token: "old-access-token", refresh_token: "old-refresh-token" })],
    );
    const testClaim = await scalar(
      db,
      "select public.sellerpilot_service_claim_kakao_test_delivery($1, $2, 180)",
      [SECOND_ADMIN_ID, testRequestId],
    );
    assert.equal(testClaim.status, "claimed");
    assert.equal(
      (await db.query("select * from public.sellerpilot_service_claim_kakao_notifications(10, 180)")).rows.length,
      0,
      "a live manual claim must block the periodic claimant for the same owner",
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_kakao_notification_refresh($1, $2)",
        [testClaim.deliveryId, testClaim.claimToken],
      ),
      true,
    );
    const refreshedToken = {
      access_token: "new-access-token",
      refresh_token: "new-refresh-token",
      expires_in: 21_600,
    };
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_stage_kakao_notification_refresh($1, $2, $3::jsonb, now() + interval '6 hours')",
        [testClaim.deliveryId, testClaim.claimToken, JSON.stringify(refreshedToken)],
      ),
      true,
    );
    assert.equal(await scalar(db, "select count(*) from vault.secrets where secret like '%old-refresh-token%'"), 0);
    assert.equal(await scalar(db, "select count(*) from vault.secrets where secret like '%new-refresh-token%'"), 1);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_kakao_notification_send($1, $2)",
        [testClaim.deliveryId, testClaim.claimToken],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_kakao_notification($1, $2, 'sent', null)",
        [testClaim.deliveryId, testClaim.claimToken],
      ),
      true,
    );
    assert.equal(
      (await scalar(
        db,
        "select public.sellerpilot_service_claim_kakao_test_delivery($1, $2, 180)",
        [SECOND_ADMIN_ID, testRequestId],
      )).status,
      "sent",
    );
    assert.equal(
      await scalar(
        db,
        "select count(*) from sellerpilot_private.kakao_notification_deliveries where owner_id = $1 and is_manual_test",
        [SECOND_ADMIN_ID],
      ),
      1,
    );

    await db.query(
      "update sellerpilot_private.kakao_notification_deliveries set status = 'failed' where owner_id = $1 and event_key = 'refresh-uncertain:blocked'",
      [SECOND_ADMIN_ID],
    );
    await db.query(
      `insert into sellerpilot_private.kakao_notification_deliveries (
        owner_id, event_key, event_type, title, body, link_path
      ) values
        ($1, 'owner-serialized:first', 'order_paid', 'Serialized first', 'Serialized first body', '/'),
        ($1, 'owner-serialized:second', 'order_paid', 'Serialized second', 'Serialized second body', '/')`,
      [SECOND_ADMIN_ID],
    );
    const [serializedFirstClaim] = (
      await db.query("select * from public.sellerpilot_service_claim_kakao_notifications(10, 180)")
    ).rows;
    assert.equal(serializedFirstClaim.owner_id, SECOND_ADMIN_ID);
    assert.equal(
      await scalar(
        db,
        "select count(*) from sellerpilot_private.kakao_notification_deliveries where owner_id = $1 and status in ('preparing', 'sending')",
        [SECOND_ADMIN_ID],
      ),
      1,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_kakao_notification_refresh($1, $2)",
        [serializedFirstClaim.id, serializedFirstClaim.claim_token],
      ),
      true,
    );
    const serializedToken = {
      access_token: "serialized-access-token",
      refresh_token: "serialized-refresh-token",
      expires_in: 21_600,
    };
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_stage_kakao_notification_refresh($1, $2, $3::jsonb, now() + interval '6 hours')",
        [serializedFirstClaim.id, serializedFirstClaim.claim_token, JSON.stringify(serializedToken)],
      ),
      true,
    );
    assert.equal(
      (await db.query("select * from public.sellerpilot_service_claim_kakao_notifications(10, 180)")).rows.length,
      0,
      "a staged refresh must not release the owner while its delivery is still preparing",
    );
    const concurrentManual = await scalar(
      db,
      "select public.sellerpilot_service_claim_kakao_test_delivery($1, $2, 180)",
      [SECOND_ADMIN_ID, concurrentManualRequestId],
    );
    assert.equal(concurrentManual.status, "in_progress");
    assert.equal(concurrentManual.requestConflict, true);
    await assert.rejects(
      db.query(
        `insert into sellerpilot_private.kakao_notification_deliveries (
          owner_id, event_key, event_type, title, body, link_path, status,
          claim_token, claimed_at, lease_expires_at
        ) values (
          $1, 'owner-serialized:forbidden', 'order_paid', 'Forbidden', 'Forbidden body', '/', 'preparing',
          gen_random_uuid(), now(), now() + interval '3 minutes'
        )`,
        [SECOND_ADMIN_ID],
      ),
      /kakao_notification_one_active_delivery_owner_idx|unique/i,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_kakao_notification_send($1, $2)",
        [serializedFirstClaim.id, serializedFirstClaim.claim_token],
      ),
      true,
    );
    assert.equal(
      (await db.query("select * from public.sellerpilot_service_claim_kakao_notifications(10, 180)")).rows.length,
      0,
      "a sending delivery must retain the same owner fence",
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_kakao_notification($1, $2, 'sent', null)",
        [serializedFirstClaim.id, serializedFirstClaim.claim_token],
      ),
      true,
    );
    const [serializedSecondClaim] = (
      await db.query("select * from public.sellerpilot_service_claim_kakao_notifications(10, 180)")
    ).rows;
    assert.equal(serializedSecondClaim.owner_id, SECOND_ADMIN_ID);
    assert.equal(serializedSecondClaim.secret_payload.access_token, serializedToken.access_token);
    assert.equal(serializedSecondClaim.secret_payload.refresh_token, serializedToken.refresh_token);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_kakao_notification_send($1, $2)",
        [serializedSecondClaim.id, serializedSecondClaim.claim_token],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_kakao_notification($1, $2, 'sent', null)",
        [serializedSecondClaim.id, serializedSecondClaim.claim_token],
      ),
      true,
    );

    await db.query(
      `insert into sellerpilot_private.kakao_notification_deliveries (
        owner_id, event_key, event_type, title, body, link_path
      ) values ($1, 'refresh-uncertain:first', 'order_paid', 'Refresh first', 'Refresh first body', '/')`,
      [SECOND_ADMIN_ID],
    );
    const [refreshUncertainClaim] = (
      await db.query("select * from public.sellerpilot_service_claim_kakao_notifications(1, 180)")
    ).rows;
    assert.equal(refreshUncertainClaim.owner_id, SECOND_ADMIN_ID);
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_kakao_notification_refresh($1, $2)",
        [refreshUncertainClaim.id, refreshUncertainClaim.claim_token],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_finish_kakao_notification_preparation($1, $2, 'reconciliation_required', 'KAKAO_REFRESH_OUTCOME_UNKNOWN')",
        [refreshUncertainClaim.id, refreshUncertainClaim.claim_token],
      ),
      true,
    );
    assert.equal(
      (await db.query("select * from public.sellerpilot_service_claim_kakao_notifications(10, 180)")).rows.length,
      0,
    );
    const ownerBlockedManual = await scalar(
      db,
      "select public.sellerpilot_service_claim_kakao_test_delivery($1, $2, 180)",
      [SECOND_ADMIN_ID, ownerBlockedManualRequestId],
    );
    assert.equal(ownerBlockedManual.status, "reconciliation_required");
    assert.equal(ownerBlockedManual.requestConflict, true);

    const uncertainClaim = await scalar(
      db,
      "select public.sellerpilot_service_claim_kakao_test_delivery($1, $2, 180)",
      [ADMIN_ID, uncertainRequestId],
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_begin_kakao_notification_send($1, $2)",
        [uncertainClaim.deliveryId, uncertainClaim.claimToken],
      ),
      true,
    );
    assert.equal(
      await scalar(
        db,
        "select public.sellerpilot_service_complete_kakao_notification($1, $2, 'reconciliation_required', 'KAKAO_TEST_SEND_OUTCOME_UNKNOWN')",
        [uncertainClaim.deliveryId, uncertainClaim.claimToken],
      ),
      true,
    );
    assert.equal(
      (await scalar(
        db,
        "select public.sellerpilot_service_claim_kakao_test_delivery($1, $2, 180)",
        [ADMIN_ID, uncertainRequestId],
      )).status,
      "reconciliation_required",
    );
    const blocked = await scalar(
      db,
      "select public.sellerpilot_service_claim_kakao_test_delivery($1, $2, 180)",
      [ADMIN_ID, blockedRequestId],
    );
    assert.equal(blocked.status, "reconciliation_required");
    assert.equal(blocked.requestConflict, true);
    assert.equal(
      await scalar(
        db,
        "select count(*) from sellerpilot_private.kakao_notification_deliveries where owner_id = $1 and is_manual_test",
        [ADMIN_ID],
      ),
      1,
    );
  } finally {
    await db.close();
  }
});
