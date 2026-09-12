-- Target: SellerPilot sqaoqucxakebqkiygdxb. Run only after checking the project.
-- Diagnostic SELECTs only: never EXPLAIN ANALYZE an application claim RPC.
begin read only;
set local statement_timeout = '5s';

select relname, n_live_tup, n_dead_tup, seq_scan, seq_tup_read, idx_scan,
       last_autovacuum, last_autoanalyze, pg_total_relation_size(relid) as total_bytes
from pg_stat_user_tables
where schemaname = 'sellerpilot_private'
  and relname in ('channel_gateway_jobs', 'ai_cli_jobs', 'cs_reply_draft_jobs');

select c.relname, i.indisvalid, i.indisready, pg_relation_size(c.oid) as index_bytes,
       pg_get_expr(i.indpred, i.indrelid) as predicate
from pg_index i join pg_class c on c.oid = i.indexrelid
where i.indexrelid = to_regclass('sellerpilot_private.channel_gateway_jobs_reconciliation_lookup_idx');

explain (analyze, buffers)
select unresolved.id
from sellerpilot_private.channel_gateway_jobs unresolved
join sellerpilot_private.channel_credentials credential on credential.id = unresolved.credential_id
where credential.channel = 'shopee' and credential.environment = 'production'
  and unresolved.status = 'reconciliation_required'
  and (unresolved.credential_refresh_in_flight
       or unresolved.credential_refresh_recovery_vault_id is not null
       or (unresolved.operation = 'oauth.exchange'
           and unresolved.prepared_credential_id is not null
           and not unresolved.oauth_exchange_completed));

select count(*) filter (where cardinality(pg_blocking_pids(pid)) > 0) as blocked_sessions,
       count(*) filter (where state = 'idle in transaction') as idle_transactions
from pg_stat_activity;
rollback;
