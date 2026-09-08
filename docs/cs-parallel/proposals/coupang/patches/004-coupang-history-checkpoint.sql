-- Proposal-only integration patch. Do not apply from the channel worktree.
-- The RPC is authenticated/admin-only and advances no cursor itself. It only
-- exposes a next end date when every initial and continuation job succeeded.

begin;

create function public.sellerpilot_get_coupang_history_checkpoint_v1(
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_run sellerpilot_private.inquiry_history_backfill_runs%rowtype;
  v_state jsonb;
  v_expected integer;
  v_total integer;
  v_queued integer;
  v_running integer;
  v_succeeded integer;
  v_failed integer;
  v_complete boolean;
begin
  if v_actor is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  select run.* into v_run
    from sellerpilot_private.inquiry_history_backfill_runs run
   where run.id = p_run_id
   for update;
  if not found then return null; end if;

  v_expected := ceil(v_run.history_days / 7.0)::integer * 8;
  if v_run.channels is distinct from array['coupang']::text[]
     or v_run.history_days not between 7 and 30
     or v_run.range_end - v_run.range_start <> v_run.history_days - 1
     or v_run.expected_initial_jobs <> v_expected then
    raise exception 'COUPANG_HISTORY_CHECKPOINT_SCOPE_INVALID'
      using errcode = '23514';
  end if;

  v_state := sellerpilot_private.refresh_inquiry_history_backfill_run(v_run.id);
  if v_state is null then return null; end if;
  v_total := coalesce((v_state->>'totalJobs')::integer, -1);
  v_queued := coalesce((v_state->>'queuedJobs')::integer, -1);
  v_running := coalesce((v_state->>'runningJobs')::integer, -1);
  v_succeeded := coalesce((v_state->>'succeededJobs')::integer, -1);
  v_failed := coalesce((v_state->>'failedJobs')::integer, -1);
  if least(v_total, v_queued, v_running, v_succeeded, v_failed) < 0
     or v_total < v_expected
     or v_total <> v_queued + v_running + v_succeeded + v_failed
     or v_state->>'fromDate' is distinct from v_run.range_start::text
     or v_state->>'toDate' is distinct from v_run.range_end::text
     or (v_state->>'expectedInitialJobs')::integer <> v_expected then
    raise exception 'COUPANG_HISTORY_CHECKPOINT_LEDGER_INVALID'
      using errcode = '23514';
  end if;

  v_complete := v_state->>'status' = 'succeeded'
    and v_queued = 0
    and v_running = 0
    and v_failed = 0
    and v_succeeded = v_total
    and nullif(v_state->>'completedAt', '') is not null;

  return v_state || jsonb_build_object(
    'contract', 'sellerpilot-coupang-history-checkpoint/1',
    'canAdvance', v_complete,
    'replayEndDate', v_run.range_end::text,
    'nextEndDate', case when v_complete
      then (v_run.range_start - 1)::text else null end
  );
end;
$$;

revoke all on function
  public.sellerpilot_get_coupang_history_checkpoint_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_get_coupang_history_checkpoint_v1(uuid)
  to authenticated;

comment on function public.sellerpilot_get_coupang_history_checkpoint_v1(uuid) is
  'Authenticated Coupang-only history checkpoint. Failed or incomplete runs replay the same end date; complete runs expose the preceding date without scheduling it.';

notify pgrst, 'reload schema';
commit;

