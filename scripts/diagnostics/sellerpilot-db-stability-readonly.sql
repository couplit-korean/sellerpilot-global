-- SellerPilot incident diagnostic, 2026-09-13. NOT a migration.
-- Run only after the management connection identifies project sqaoqucxakebqkiygdxb.
-- current_database() is often "postgres" and cannot prove the Supabase project.
-- No application RPC is executed here: claim/complete/status RPCs may have effects.
-- No query text, credentials, customer messages, payloads or row IDs are returned.
begin read only;
set local statement_timeout = '5s';
set local lock_timeout = '1s';

select current_database() as database_name, current_user as database_role,
       clock_timestamp() as observed_at,
       current_setting('transaction_read_only') as read_only,
       current_setting('max_connections') as max_connections,
       current_setting('statement_timeout') as diagnostic_statement_timeout;

-- Shared DB names do not identify the project. These are health observations only.
select backend_type, state, wait_event_type, wait_event, count(*) as connections,
       max(clock_timestamp() - xact_start) as oldest_transaction_age
from pg_stat_activity where datname = current_database()
group by backend_type, state, wait_event_type, wait_event
order by connections desc;

select count(*) filter (where cardinality(pg_blocking_pids(pid)) > 0) as blocked_sessions,
       count(*) filter (where state = 'idle in transaction') as idle_in_transaction_sessions
from pg_stat_activity where datname = current_database();

select numbackends, xact_commit, xact_rollback, deadlocks, conflicts,
       temp_files, temp_bytes, stats_reset
from pg_stat_database where datname = current_database();

-- Missing functions remain visible as exists=false, instead of aborting a query.
with required(name) as (values
  ('sellerpilot_service_record_cs_history_page_v1'),
  ('sellerpilot_service_gateway_completion_context'),
  ('sellerpilot_service_serverless_cs_wakeup_status'),
  ('sellerpilot_claim_cs_reply_draft'),
  ('sellerpilot_touch_cs_reply_draft'),
  ('sellerpilot_complete_cs_reply_draft')
)
select r.name, p.oid is not null as exists,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.proargnames as argument_names, p.prosecdef as security_definer,
       p.proconfig as function_settings,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       encode(sha256(convert_to(pg_get_functiondef(p.oid), 'UTF8')), 'hex') as definition_sha256
from required r
left join pg_namespace n on n.nspname = 'public'
left join pg_proc p on p.pronamespace = n.oid and p.proname = r.name
order by r.name, p.oid;

select n.nspname as schema_name, c.relname as table_name, c.relrowsecurity as rls_enabled,
       s.n_live_tup as estimated_rows, s.n_dead_tup as estimated_dead_rows,
       s.last_autovacuum, s.last_autoanalyze,
       pg_total_relation_size(c.oid) as total_bytes
from pg_class c join pg_namespace n on n.oid = c.relnamespace
left join pg_stat_user_tables s on s.relid = c.oid
where n.nspname = 'sellerpilot_private'
  and c.relname in ('channel_gateway_jobs', 'cs_reply_draft_jobs',
                   'support_tickets', 'support_reply_deliveries')
order by c.relname;

select tablename, indexname, indexdef from pg_indexes
where schemaname = 'sellerpilot_private'
  and tablename in ('channel_gateway_jobs', 'cs_reply_draft_jobs')
order by tablename, indexname;
rollback;

-- After confirming the above tables/columns exist, run each block separately.
-- A timeout is a diagnostic result; do not raise production timeouts automatically.
-- begin read only;
-- set local statement_timeout = '5s';
-- set local lock_timeout = '1s';
-- select channel, operation, status, count(*) as jobs,
--   count(*) filter (where status='running' and lease_expires_at < now()) as expired_leases,
--   min(created_at) as oldest_created_at
-- from sellerpilot_private.channel_gateway_jobs
-- where status in ('queued','running','reconciliation_required')
-- group by channel, operation, status order by channel, operation, status;
-- select status, count(*) as jobs,
--   count(*) filter (where status='running' and lease_expires_at < now()) as expired_leases,
--   min(created_at) as oldest_created_at
-- from sellerpilot_private.cs_reply_draft_jobs
-- where status in ('queued','running') group by status;
-- rollback;

-- Migration evidence: first inspect schema_migrations columns. Then compare
-- version AND name AND exact stored statement content with the local migration.
-- A matching version alone must never trigger "already applied" or a bulk push.
-- This hash fingerprints the stored statement array, not the local raw SQL file.
-- begin read only;
-- set local statement_timeout = '5s';
-- select version, name,
--   encode(sha256(convert_to(statements::text, 'UTF8')), 'hex') as stored_statements_sha256
-- from supabase_migrations.schema_migrations
-- where version in ('20260907231000','20260908172414','20260909111201')
-- order by version;
-- rollback;
