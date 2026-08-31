import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260831131000_competitor_match_review_ledger.sql",
  import.meta.url,
);
const ADMIN_ID = "10000000-0000-4000-8000-000000000001";
const NON_ADMIN_ID = "10000000-0000-4000-8000-000000000002";
const PRODUCT_ID = "20000000-0000-4000-8000-000000000001";
const OBSERVATION_ID = "30000000-0000-4000-8000-000000000001";
const FIRST_REQUEST_ID = "40000000-0000-4000-8000-000000000001";
const REVOKE_REQUEST_ID = "40000000-0000-4000-8000-000000000002";
const SECOND_CONFIRM_REQUEST_ID = "40000000-0000-4000-8000-000000000003";
const INVALID_REQUEST_ID = "40000000-0000-4000-8000-000000000004";
const FINGERPRINT_A = "a".repeat(64);
const FINGERPRINT_B = "b".repeat(64);
const CHECKED_AT_A = "2026-08-31T01:00:00.000Z";
const CHECKED_AT_B = "2026-08-31T02:00:00.000Z";
const CONFIRM_REASONS = JSON.stringify([
  "source_opened",
  "brand_model_match",
  "quantity_pack_match",
  "variant_condition_match",
  "not_accessory_refill",
]);

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function expectDatabaseError(work, pattern) {
  await assert.rejects(work, (error) => pattern.test(String(error?.message ?? error)));
}

async function setActor(db, actorId) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actorId]);
}

async function review(db, {
  requestId,
  fingerprint = FINGERPRINT_A,
  checkedAt = CHECKED_AT_A,
  latestReviewId = null,
  decision = "confirmed_exact",
  reasons = CONFIRM_REASONS,
  note = "원본에서 브랜드, 모델, 수량과 옵션 일치를 확인했습니다.",
} = {}) {
  return scalar(
    db,
    `select public.sellerpilot_review_competitor_match(
       $1::uuid,$2,$3::timestamptz,$4::uuid,$5,$6::jsonb,$7,$8::uuid
     )`,
    [OBSERVATION_ID, fingerprint, checkedAt, latestReviewId, decision, reasons, note, requestId],
  );
}

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create or replace function auth.uid()
    returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    create schema extensions;
    create or replace function extensions.digest(value text, algorithm text)
    returns bytea language sql immutable
    as $$
      select case when lower(algorithm) = 'sha256'
        then sha256(convert_to(value, 'UTF8'))
        else convert_to(md5(value || algorithm), 'UTF8')
      end
    $$;

    create schema sellerpilot_private;
    create table sellerpilot_private.admin_users (
      user_id uuid primary key references auth.users(id)
    );
    create table sellerpilot_private.products (
      id uuid primary key,
      status text not null default 'draft',
      competitor_monitor_enabled boolean not null default true
    );
    create table sellerpilot_private.competitor_price_observations (
      id uuid primary key,
      product_id uuid not null references sellerpilot_private.products(id),
      provider text not null,
      marketplace text not null,
      external_id text not null,
      matcher_version text,
      match_tier text,
      observation_fingerprint text,
      checked_at timestamptz not null,
      mismatch_evidence jsonb not null default '[]'::jsonb
    );
    alter table sellerpilot_private.competitor_price_observations enable row level security;
    revoke all on sellerpilot_private.competitor_price_observations from public, anon, authenticated, service_role;

    create or replace function public.sellerpilot_is_admin()
    returns boolean language sql stable security definer set search_path = ''
    as $$
      select exists (
        select 1 from sellerpilot_private.admin_users admin_user
         where admin_user.user_id = auth.uid()
      )
    $$;
    grant execute on function public.sellerpilot_is_admin() to authenticated;

    create or replace function public.sellerpilot_get_product_operations_v2(p_product_id uuid)
    returns jsonb language sql stable security definer set search_path = ''
    as $$
      select jsonb_build_object(
        'productId', p_product_id,
        'competitorPrices', coalesce(jsonb_agg(jsonb_build_object(
          'id', observation.id,
          'matchTier', observation.match_tier
        )), '[]'::jsonb)
      )
      from sellerpilot_private.competitor_price_observations observation
      where observation.product_id = p_product_id
    $$;
    grant execute on function public.sellerpilot_get_product_operations_v2(uuid) to authenticated;

    insert into auth.users(id,email) values
      ('${ADMIN_ID}','review-admin@example.test'),
      ('${NON_ADMIN_ID}','review-user@example.test');
    insert into sellerpilot_private.admin_users(user_id) values ('${ADMIN_ID}');
    insert into sellerpilot_private.products(id) values ('${PRODUCT_ID}');
    insert into sellerpilot_private.competitor_price_observations(
      id,product_id,provider,marketplace,external_id,matcher_version,
      match_tier,observation_fingerprint,checked_at,mismatch_evidence
    ) values (
      '${OBSERVATION_ID}','${PRODUCT_ID}','naver_shopping','smartstore','source-1',
      'strict-2026-08-31-v3','probable','${FINGERPRINT_A}','${CHECKED_AT_A}','[]'::jsonb
    );
  `);
  await db.exec(await readFile(migrationUrl, "utf8"));
  await setActor(db, ADMIN_ID);
  return db;
}

test("probable review is append-only, fenced, and overlays rather than mutating source", async () => {
  const db = await createDatabase();
  try {
    const rawBefore = await scalar(
      db,
      "select to_jsonb(observation) from sellerpilot_private.competitor_price_observations observation where id=$1",
      [OBSERVATION_ID],
    );
    const confirmed = await review(db, { requestId: FIRST_REQUEST_ID });
    assert.equal(confirmed.decision, "confirmed_exact");
    assert.equal(confirmed.sourceObservationFingerprint, FINGERPRINT_A);
    assert.equal(confirmed.sourceObservationId, OBSERVATION_ID);

    const rawAfter = await scalar(
      db,
      "select to_jsonb(observation) from sellerpilot_private.competitor_price_observations observation where id=$1",
      [OBSERVATION_ID],
    );
    assert.deepEqual(rawAfter, rawBefore, "human review must not rewrite the provider observation");
    assert.equal(await scalar(
      db,
      `select encode(extensions.digest(source_snapshot::text,'sha256'),'hex') = source_snapshot_sha256
         from sellerpilot_private.competitor_match_review_events where id=$1`,
      [confirmed.id],
    ), true);

    const projection = await scalar(db, "select public.sellerpilot_get_product_operations_v2($1)", [PRODUCT_ID]);
    assert.equal(projection.competitorPrices[0].automatedMatchTier, "probable");
    assert.equal(projection.competitorPrices[0].effectiveMatchTier, "exact");
    assert.equal(projection.competitorPrices[0].latestHumanReview.decision, "confirmed_exact");
    assert.equal(projection.competitorPrices[0].latestHumanReview.sourceCurrent, true);

    const idempotent = await review(db, { requestId: FIRST_REQUEST_ID });
    assert.equal(idempotent.id, confirmed.id);
    assert.equal(await scalar(db, "select count(*)::integer from sellerpilot_private.competitor_match_review_events"), 1);
    await expectDatabaseError(
      () => review(db, { requestId: FIRST_REQUEST_ID, note: "같은 request ID를 다른 내용으로 재사용합니다." }),
      /request conflict/iu,
    );

    const revoked = await review(db, {
      requestId: REVOKE_REQUEST_ID,
      latestReviewId: confirmed.id,
      decision: "revoked",
      reasons: JSON.stringify(["review_withdrawn"]),
      note: "원본 재검토가 필요해 기존 결정을 철회합니다.",
    });
    assert.equal(revoked.decision, "revoked");
    assert.equal(revoked.latestForSource, true);
    assert.equal(revoked.supersedesEventId, confirmed.id);
    const timedOutConfirmReadback = await review(db, { requestId: FIRST_REQUEST_ID });
    assert.equal(timedOutConfirmReadback.id, confirmed.id);
    assert.equal(timedOutConfirmReadback.latestForSource, false);
    const revokedProjection = await scalar(db, "select public.sellerpilot_get_product_operations_v2($1)", [PRODUCT_ID]);
    assert.equal(revokedProjection.competitorPrices[0].effectiveMatchTier, "probable");
    assert.equal(await scalar(db, "select count(*)::integer from sellerpilot_private.competitor_match_review_events"), 2);

    const reconfirmed = await review(db, {
      requestId: SECOND_CONFIRM_REQUEST_ID,
      latestReviewId: revoked.id,
      note: "철회 후 원본을 다시 열어 동일상품 근거를 재확인했습니다.",
    });
    assert.equal(reconfirmed.supersedesEventId, revoked.id);
    const reconfirmedProjection = await scalar(db, "select public.sellerpilot_get_product_operations_v2($1)", [PRODUCT_ID]);
    assert.equal(reconfirmedProjection.competitorPrices[0].latestHumanReview.id, reconfirmed.id);
    assert.equal(reconfirmedProjection.competitorPrices[0].effectiveMatchTier, "exact");
    assert.equal(await scalar(db, "select count(*)::integer from sellerpilot_private.competitor_match_review_events"), 3);

    await expectDatabaseError(
      () => db.query("update sellerpilot_private.competitor_match_review_events set note='변경할 수 없는 감사 원장' where id=$1", [confirmed.id]),
      /append-only/iu,
    );
    await expectDatabaseError(
      () => db.query("delete from sellerpilot_private.competitor_match_review_events where id=$1", [confirmed.id]),
      /append-only/iu,
    );
  } finally {
    await db.close();
  }
});

test("refresh fingerprint change invalidates approval and stale writes", async () => {
  const db = await createDatabase();
  try {
    const confirmed = await review(db, { requestId: FIRST_REQUEST_ID });
    await db.query(
      `update sellerpilot_private.competitor_price_observations
          set observation_fingerprint=$1, checked_at=$2::timestamptz
        where id=$3`,
      [FINGERPRINT_B, CHECKED_AT_B, OBSERVATION_ID],
    );

    const projection = await scalar(db, "select public.sellerpilot_get_product_operations_v2($1)", [PRODUCT_ID]);
    assert.equal(projection.competitorPrices[0].effectiveMatchTier, "probable");
    assert.equal(projection.competitorPrices[0].latestHumanReview.id, confirmed.id);
    assert.equal(projection.competitorPrices[0].latestHumanReview.sourceCurrent, false);
    const history = await scalar(db, "select public.sellerpilot_get_competitor_match_review_history($1)", [OBSERVATION_ID]);
    assert.equal(history[0].sourceCurrent, false);

    await expectDatabaseError(
      () => review(db, {
        requestId: SECOND_CONFIRM_REQUEST_ID,
        latestReviewId: confirmed.id,
        fingerprint: FINGERPRINT_A,
        checkedAt: CHECKED_AT_A,
      }),
      /observation changed/iu,
    );
    const refreshed = await review(db, {
      requestId: SECOND_CONFIRM_REQUEST_ID,
      latestReviewId: confirmed.id,
      fingerprint: FINGERPRINT_B,
      checkedAt: CHECKED_AT_B,
    });
    assert.equal(refreshed.sourceObservationFingerprint, FINGERPRINT_B);
    assert.equal(refreshed.supersedesEventId, confirmed.id);
  } finally {
    await db.close();
  }
});

test("only authenticated admins can use review RPCs and direct ledger access stays closed", async () => {
  const db = await createDatabase();
  try {
    await setActor(db, NON_ADMIN_ID);
    await expectDatabaseError(
      () => review(db, { requestId: FIRST_REQUEST_ID }),
      /administrator access required/iu,
    );

    await db.exec("set role authenticated;");
    await expectDatabaseError(
      () => db.query("select * from sellerpilot_private.competitor_match_review_events"),
      /permission denied/iu,
    );
    await db.exec("reset role;");
    await setActor(db, ADMIN_ID);
    const confirmed = await review(db, { requestId: FIRST_REQUEST_ID });
    assert.equal(confirmed.reviewerId, ADMIN_ID);
  } finally {
    await db.close();
  }
});

test("direct RPC callers cannot mix contradictory or unverified decision reasons", async () => {
  const db = await createDatabase();
  try {
    await expectDatabaseError(
      () => review(db, {
        requestId: INVALID_REQUEST_ID,
        reasons: JSON.stringify([
          "source_opened", "brand_model_match", "quantity_pack_match",
          "variant_condition_match", "not_accessory_refill", "identity_mismatch",
        ]),
      }),
      /evidence incomplete/iu,
    );
    await expectDatabaseError(
      () => review(db, {
        requestId: INVALID_REQUEST_ID,
        decision: "rejected",
        reasons: JSON.stringify(["identity_mismatch"]),
        note: "원본 페이지를 열었다는 근거 없이 제외를 시도합니다.",
      }),
      /evidence incomplete/iu,
    );

    const confirmed = await review(db, { requestId: FIRST_REQUEST_ID });
    await expectDatabaseError(
      () => review(db, {
        requestId: SECOND_CONFIRM_REQUEST_ID,
        latestReviewId: confirmed.id,
        note: "현재 결정을 철회하지 않고 같은 승인을 덮어쓰지 않습니다.",
      }),
      /review state changed/iu,
    );
    await expectDatabaseError(
      () => review(db, {
        requestId: REVOKE_REQUEST_ID,
        latestReviewId: confirmed.id,
        decision: "revoked",
        reasons: JSON.stringify(["review_withdrawn", "source_opened"]),
        note: "철회에 다른 근거를 섞어 원장을 모호하게 만들지 않습니다.",
      }),
      /review state changed/iu,
    );
    assert.equal(await scalar(db, "select count(*)::integer from sellerpilot_private.competitor_match_review_events"), 1);
  } finally {
    await db.close();
  }
});
