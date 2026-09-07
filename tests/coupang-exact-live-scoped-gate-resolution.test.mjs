import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL(
  "../supabase/migrations/20260908024900_resolve_exact_coupang_scoped_gate.sql",
  import.meta.url,
), "utf8");

const ids = {
  resolvedCoupang: "00000000-0000-4000-8000-000000000001",
  unresolvedCoupang: "00000000-0000-4000-8000-000000000002",
  qoo10: "00000000-0000-4000-8000-000000000003",
  smartstore: "00000000-0000-4000-8000-000000000004",
};

test("forward patch changes only Coupang scoped reconciliation interpretation", () => {
  assert.match(migration, /sellerpilot_service_set_listing_channel_mutation_release_gate/);
  assert.match(migration, /sellerpilot_071510_listing_gate_status_pre_smartstore_scope/);
  assert.equal((migration.match(/when ''coupang'' then/g) ?? []).length, 2);
  assert.match(
    migration,
    /when ''coupang'' then\\n {17}not sellerpilot_private\.listing_mutation_reconciliation_resolved\(job\.id\)/,
  );
  assert.match(
    migration,
    /job\.status = ''reconciliation_required''\\n {11}and not sellerpilot_private\.listing_mutation_reconciliation_resolved\(job\.id\)/,
  );
  assert.doesNotMatch(
    migration,
    /(?:insert\s+into|update|delete\s+from)\s+sellerpilot_private\.(?:channel_gateway_jobs|channel_operation_attempts|coupang_exact_live_verify_receipts)/iu,
  );
  assert.doesNotMatch(
    migration,
    /create\s+or\s+replace\s+function\s+sellerpilot_private\.listing_mutation_release_gate_is_effective\s*\(\s*\)/iu,
  );
  assert.doesNotMatch(migration, /sellerpilot_service_set_listing_mutation_release_gate\s*\(/iu);
});

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] ?? {})[0];
}

async function createFixture() {
  const db = new PGlite();
  await db.exec(String.raw`
    create schema sellerpilot_private;

    create table sellerpilot_private.channel_gateway_jobs (
      id uuid primary key,
      channel text not null,
      operation text not null,
      status text not null,
      immutable_payload jsonb not null
    );
    create table sellerpilot_private.resolved_jobs (
      job_id uuid primary key
    );
    create table sellerpilot_private.qoo10_resolved_jobs (
      job_id uuid primary key
    );
    create table sellerpilot_private.listing_mutation_release_gate (
      singleton boolean primary key default true check (singleton),
      is_open boolean not null default false,
      opened_at timestamptz,
      opened_release_sha text,
      opened_channel text,
      updated_at timestamptz not null default clock_timestamp()
    );
    insert into sellerpilot_private.listing_mutation_release_gate(singleton)
    values (true);

    create function sellerpilot_private.listing_mutation_reconciliation_resolved(
      p_job_id uuid
    ) returns boolean language sql stable set search_path = '' as $$
      select exists(
        select 1 from sellerpilot_private.resolved_jobs resolved
         where resolved.job_id = p_job_id
      )
    $$;
    create function sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(
      p_job_id uuid
    ) returns boolean language sql stable set search_path = '' as $$
      select exists(
        select 1 from sellerpilot_private.qoo10_resolved_jobs resolved
         where resolved.job_id = p_job_id
      )
    $$;
    create function sellerpilot_private.temu_safe_test_source_reconciliation_resolved(
      p_job_id uuid
    ) returns boolean language sql immutable set search_path = '' as $$
      select false
    $$;

    create function sellerpilot_private.listing_mutation_release_gate_is_effective()
    returns boolean language sql stable set search_path = '' as $$
      select gate.is_open and gate.opened_channel is null
        from sellerpilot_private.listing_mutation_release_gate gate
       where gate.singleton
    $$;
    create function sellerpilot_private.listing_mutation_release_gate_is_effective(
      p_channel text
    ) returns boolean language sql stable set search_path = '' as $$
      select case
        when gate.opened_channel is null then
          sellerpilot_private.listing_mutation_release_gate_is_effective()
        else gate.is_open and gate.opened_channel = p_channel
      end
        from sellerpilot_private.listing_mutation_release_gate gate
       where gate.singleton
    $$;

    create function public.sellerpilot_071510_listing_gate_status_pre_smartstore_scope()
    returns jsonb language sql stable set search_path = '' as $$
      select jsonb_build_object(
        'open', gate.is_open,
        'state', case when gate.is_open then 'open' else 'closed' end,
        'openedChannel', gate.opened_channel,
        'effectiveOpen', sellerpilot_private.listing_mutation_release_gate_is_effective(),
        'coupangReconciliationRequired', (
          select count(*)::integer
            from sellerpilot_private.channel_gateway_jobs job
         where job.channel = 'coupang'
           and job.operation in (
             'listing.create', 'listing.update', 'listing.stop'
           )
           and job.status = 'reconciliation_required'
        )
      )
        from sellerpilot_private.listing_mutation_release_gate gate
       where gate.singleton
    $$;

    create function public.sellerpilot_service_listing_mutation_release_gate_status()
    returns jsonb language sql stable set search_path = '' as $$
      select public.sellerpilot_071510_listing_gate_status_pre_smartstore_scope()
        || jsonb_build_object(
          'qoo10EffectiveOpen', sellerpilot_private.listing_mutation_release_gate_is_effective('qoo10'),
          'coupangEffectiveOpen', sellerpilot_private.listing_mutation_release_gate_is_effective('coupang'),
          'smartstoreEffectiveOpen', sellerpilot_private.listing_mutation_release_gate_is_effective('smartstore'),
          'fixtureGlobalMarker', 'preserved'
        )
    $$;

    create function public.sellerpilot_service_set_listing_channel_mutation_release_gate(
      p_channel text,
      p_open boolean,
      p_release_sha text
    ) returns jsonb language plpgsql set search_path = '' as $$
    declare
      v_queued_or_running integer;
      v_reconciliation_required integer;
      v_global_running integer;
    begin
      select count(*) filter (
               where job.status in ('queued', 'running')
             )::integer,
             count(*) filter (
               where job.status = 'reconciliation_required'
                 and case p_channel
               when 'qoo10' then
                 not sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(job.id)
                 and not sellerpilot_private.temu_safe_test_source_reconciliation_resolved(job.id)
               when 'smartstore' then
                 not sellerpilot_private.listing_mutation_reconciliation_resolved(job.id)
               else true
                 end
             )::integer
        into v_queued_or_running, v_reconciliation_required
        from sellerpilot_private.channel_gateway_jobs job
       where job.channel = p_channel
         and job.operation in ('listing.create', 'listing.update', 'listing.stop');

      select count(*)::integer
        into v_global_running
        from sellerpilot_private.channel_gateway_jobs job
       where job.operation in ('listing.create', 'listing.update', 'listing.stop')
         and job.status = 'running';

      if p_open and v_global_running <> 0 then
        raise exception 'running listing mutations must drain before scoped release-gate activation';
      end if;
      if p_open and v_queued_or_running <> 0 then
        raise exception 'scoped listing mutation jobs must drain before release-gate activation';
      end if;
      if p_open and v_reconciliation_required <> 0 then
        raise exception 'scoped listing mutation reconciliations must be resolved before release-gate activation';
      end if;

      update sellerpilot_private.listing_mutation_release_gate gate
         set is_open = p_open,
             opened_at = case when p_open then clock_timestamp() else null end,
             opened_release_sha = case when p_open then p_release_sha else null end,
             opened_channel = case when p_open then p_channel else null end,
             updated_at = clock_timestamp()
       where gate.singleton;
      return public.sellerpilot_service_listing_mutation_release_gate_status();
    end;
    $$;

    insert into sellerpilot_private.channel_gateway_jobs(
      id, channel, operation, status, immutable_payload
    ) values
      ('${ids.resolvedCoupang}', 'coupang', 'listing.create',
       'reconciliation_required', '{"source":"exact-coupang"}'),
      ('${ids.unresolvedCoupang}', 'coupang', 'listing.update',
       'reconciliation_required', '{"source":"unresolved-coupang"}'),
      ('${ids.qoo10}', 'qoo10', 'listing.create',
       'reconciliation_required', '{"source":"qoo10"}'),
      ('${ids.smartstore}', 'smartstore', 'listing.create',
       'reconciliation_required', '{"source":"smartstore"}');
    insert into sellerpilot_private.resolved_jobs(job_id)
    values ('${ids.resolvedCoupang}'), ('${ids.smartstore}');
    insert into sellerpilot_private.qoo10_resolved_jobs(job_id)
    values ('${ids.qoo10}');
  `);
  return db;
}

test("resolved exact Coupang source is skipped while unresolved rows remain fail-closed", async () => {
  const db = await createFixture();
  try {
    const sourceRowsBefore = await db.query(
      "select to_jsonb(job) row from sellerpilot_private.channel_gateway_jobs job order by id",
    );
    const globalDefinitionBefore = await scalar(
      db,
      "select pg_catalog.pg_get_functiondef('sellerpilot_private.listing_mutation_release_gate_is_effective()'::regprocedure)",
    );
    const channelPredicateBefore = await scalar(
      db,
      "select pg_catalog.pg_get_functiondef('sellerpilot_private.listing_mutation_release_gate_is_effective(text)'::regprocedure)",
    );
    const currentStatusWrapperBefore = await scalar(
      db,
      "select pg_catalog.pg_get_functiondef('public.sellerpilot_service_listing_mutation_release_gate_status()'::regprocedure)",
    );

    const before = await scalar(
      db,
      "select public.sellerpilot_service_listing_mutation_release_gate_status()",
    );
    assert.equal(before.coupangReconciliationRequired, 2);

    await db.exec(migration);

    const partial = await scalar(
      db,
      "select public.sellerpilot_service_listing_mutation_release_gate_status()",
    );
    assert.equal(partial.coupangReconciliationRequired, 1);
    await assert.rejects(
      db.query(
        "select public.sellerpilot_service_set_listing_channel_mutation_release_gate('coupang',true,$1)",
        ["a".repeat(40)],
      ),
      /scoped listing mutation reconciliations must be resolved/,
    );

    await db.query(
      "insert into sellerpilot_private.resolved_jobs(job_id) values ($1)",
      [ids.unresolvedCoupang],
    );
    const ready = await scalar(
      db,
      "select public.sellerpilot_service_listing_mutation_release_gate_status()",
    );
    assert.equal(ready.coupangReconciliationRequired, 0);

    const opened = await scalar(
      db,
      "select public.sellerpilot_service_set_listing_channel_mutation_release_gate('coupang',true,$1)",
      ["a".repeat(40)],
    );
    assert.equal(opened.open, true);
    assert.equal(opened.openedChannel, "coupang");
    assert.equal(opened.effectiveOpen, false);
    assert.equal(opened.coupangEffectiveOpen, true);
    assert.equal(opened.qoo10EffectiveOpen, false);
    assert.equal(opened.smartstoreEffectiveOpen, false);
    assert.equal(opened.fixtureGlobalMarker, "preserved");

    const sourceRowsAfter = await db.query(
      "select to_jsonb(job) row from sellerpilot_private.channel_gateway_jobs job order by id",
    );
    assert.deepEqual(sourceRowsAfter.rows, sourceRowsBefore.rows);
    assert.equal(await scalar(
      db,
      "select pg_catalog.pg_get_functiondef('sellerpilot_private.listing_mutation_release_gate_is_effective()'::regprocedure)",
    ), globalDefinitionBefore);
    assert.equal(await scalar(
      db,
      "select pg_catalog.pg_get_functiondef('sellerpilot_private.listing_mutation_release_gate_is_effective(text)'::regprocedure)",
    ), channelPredicateBefore);
    assert.equal(await scalar(
      db,
      "select pg_catalog.pg_get_functiondef('public.sellerpilot_service_listing_mutation_release_gate_status()'::regprocedure)",
    ), currentStatusWrapperBefore);

    await db.exec(migration);
    const replay = await scalar(
      db,
      "select public.sellerpilot_service_listing_mutation_release_gate_status()",
    );
    assert.equal(replay.coupangReconciliationRequired, 0);
    assert.equal(replay.coupangEffectiveOpen, true);
  } finally {
    await db.close();
  }
});
