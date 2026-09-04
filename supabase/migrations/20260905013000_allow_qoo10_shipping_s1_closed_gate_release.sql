-- Follow-up to 20260905003000+03100. Do not rewrite that applied history.
-- Shipping S1 verifier/activation currently require an effective Qoo10 mutation
-- gate, but that gate cannot reopen while update 089467c1 remains
-- reconciliation_required until activation S2/live. Keep the recon blocker.
-- Admit this recovery only while the mutation gate stays closed.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 900500130);

create or replace function sellerpilot_private.qoo10_shipping_s1_release_is_current(
  p_release_sha text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_release_sha ~ '^[a-f0-9]{40}$'
    and sellerpilot_private.attested_listing_publication_release_sha('qoo10')
          = p_release_sha
    and sellerpilot_private.active_serverless_runtime_release_sha()
          = p_release_sha
    and exists (
      select 1
        from sellerpilot_private.listing_mutation_release_gate gate
       where gate.singleton
         and not gate.is_open
         and gate.opened_at is null
         and gate.opened_release_sha is null
         and gate.opened_channel is null
    )
    and not sellerpilot_private.listing_mutation_release_gate_is_effective('qoo10'),
    false
  )
$$;

revoke all on function
  sellerpilot_private.qoo10_shipping_s1_release_is_current(text)
  from public, anon, authenticated, service_role;

comment on function sellerpilot_private.qoo10_shipping_s1_release_is_current(text) is
  'Exact Lotte shipping S1 recovery is current only on a closed Qoo10 gate with matching attested and runtime SHA.';

commit;
