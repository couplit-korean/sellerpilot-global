begin;

create or replace function public.sellerpilot_prune_ai_jobs(
  p_completed_before timestamptz,
  p_limit integer default 200
)
returns table (
  job_id uuid,
  input_paths text[],
  result_paths text[]
)
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
begin
  if p_completed_before > now() - interval '7 days' then
    raise exception 'retention window must be at least seven days';
  end if;

  return query
  with selected as (
    select j.id,
           array(
             select jsonb_array_elements_text(j.request_payload->'image_paths')
           ) as inputs,
           array(
             select value
             from jsonb_each_text(coalesce(j.result_payload->'asset_storage_paths', '{}'::jsonb))
             union all
             select nullif(j.result_payload->>'hero_storage_path', '')
             where nullif(j.result_payload->>'hero_storage_path', '') is not null
           ) as generated_paths
      from sellerpilot_private.ai_cli_jobs j
     where j.status in ('succeeded', 'failed', 'cancelled')
       and coalesce(j.completed_at, j.updated_at) < p_completed_before
     order by coalesce(j.completed_at, j.updated_at)
     for update skip locked
     limit least(greatest(coalesce(p_limit, 200), 1), 500)
  ),
  audited as (
    insert into sellerpilot_private.ai_cli_audit (action, job_id, safe_detail)
    select 'job_pruned', s.id, jsonb_build_object(
      'input_count', coalesce(cardinality(s.inputs), 0),
      'result_count', coalesce(cardinality(s.generated_paths), 0)
    )
    from selected s
    returning id as audit_id
  ),
  deleted as (
    delete from sellerpilot_private.ai_cli_jobs j
    using selected s
    where j.id = s.id
    returning j.id
  )
  select s.id, s.inputs, s.generated_paths
  from selected s
  join deleted d on d.id = s.id;
end;
$$;

revoke all on function public.sellerpilot_prune_ai_jobs(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.sellerpilot_prune_ai_jobs(timestamptz, integer) to service_role;

commit;
