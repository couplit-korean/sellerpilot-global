-- Keep asset regeneration exact across reloads and expose every long-running
-- product image operation in the shared registration activity ledger.

begin;

create index product_ai_revisions_activity_time_idx
  on sellerpilot_private.product_ai_revisions(updated_at desc);
create index ai_cli_jobs_asset_regeneration_active_idx
  on sellerpilot_private.ai_cli_jobs(
    created_by,
    (request_payload->>'source_job_id'),
    (request_payload->>'asset_id'),
    created_at
  )
  where kind = 'product_asset_regeneration'
    and status in ('queued', 'claimed', 'running');
create index ai_cli_jobs_asset_activity_time_idx
  on sellerpilot_private.ai_cli_jobs(updated_at desc)
  where kind = 'product_asset_regeneration';

create or replace function public.sellerpilot_create_asset_regeneration_job(
  p_id uuid,
  p_source_job_id uuid,
  p_source_product_id uuid,
  p_asset_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_source sellerpilot_private.ai_cli_jobs%rowtype;
  v_existing_job_id uuid;
  v_comparison_asset_count integer := 0;
begin
  if v_actor_id is null
     or not public.sellerpilot_is_admin()
     or p_asset_id not in (
       'hero', 'square', 'portrait', 'wide',
       'detail-overview', 'detail-feature', 'detail-use', 'detail-package'
     ) then
    raise exception 'invalid asset regeneration request' using errcode = '42501';
  end if;

  select source.* into v_source
    from sellerpilot_private.ai_cli_jobs source
   where source.id = p_source_job_id
     and source.kind = 'product_studio'
     and source.status = 'succeeded'
     and source.result_payload->>'mode' = 'cli';
  if not found then raise exception 'source studio job not found'; end if;

  if p_source_product_id is not null and not exists (
    select 1
      from sellerpilot_private.products product
     where product.id = p_source_product_id
       and product.ai_job_id = p_source_job_id
       and not product.demo
  ) then
    raise exception 'source product does not match studio job';
  end if;

  -- All callers use this RPC and the underlying table is private. The lock
  -- serializes same-admin reloads/clicks without mutating or cancelling a job
  -- whose provider-side execution may already have started.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
    'sellerpilot:asset-regeneration:' || v_actor_id::text || ':'
    || p_source_job_id::text || ':' || p_asset_id
  ));

  select job.id into v_existing_job_id
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_id
     and job.created_by = v_actor_id
     and job.kind = 'product_asset_regeneration'
     and job.request_payload->>'source_job_id' = p_source_job_id::text
     and job.request_payload->>'asset_id' = p_asset_id
     and (job.request_payload->>'source_product_id')
           is not distinct from p_source_product_id::text;
  if found then return v_existing_job_id; end if;

  select job.id into v_existing_job_id
    from sellerpilot_private.ai_cli_jobs job
   where job.created_by = v_actor_id
     and job.kind = 'product_asset_regeneration'
     and job.status in ('queued', 'claimed', 'running')
     and job.request_payload->>'source_job_id' = p_source_job_id::text
     and job.request_payload->>'asset_id' = p_asset_id
     and (job.request_payload->>'source_product_id')
           is not distinct from p_source_product_id::text
   order by job.created_at, job.id
   limit 1;
  if found then return v_existing_job_id; end if;

  select count(*)::integer into v_comparison_asset_count
    from jsonb_object_keys(coalesce(v_source.result_payload->'asset_storage_paths', '{}'::jsonb));

  insert into sellerpilot_private.ai_cli_jobs (id, kind, request_payload, created_by)
  values (
    p_id,
    'product_asset_regeneration',
    jsonb_build_object(
      'source_job_id', p_source_job_id,
      'source_product_id', p_source_product_id,
      'asset_id', p_asset_id,
      'image_paths', v_source.request_payload->'image_paths',
      'image_specs', v_source.request_payload->'image_specs',
      'comparison_asset_paths', v_source.result_payload->'asset_storage_paths',
      'source_result', v_source.result_payload - 'asset_storage_paths' - 'hero_storage_path'
    ),
    v_actor_id
  );

  insert into sellerpilot_private.ai_cli_audit (action, actor_user_id, job_id, safe_detail)
  values ('job_queued', v_actor_id, p_id, jsonb_build_object(
    'kind', 'product_asset_regeneration',
    'asset_id', p_asset_id,
    'source_job_id', p_source_job_id,
    'source_product_id', p_source_product_id,
    'image_role_count', coalesce(jsonb_array_length(v_source.request_payload->'image_specs'), 0),
    'comparison_asset_count', v_comparison_asset_count,
    'deduplicated', false
  ));
  return p_id;
end;
$$;

alter function public.sellerpilot_list_registration_activity(integer)
  rename to sellerpilot_list_registration_activity_pre_image_activity;

create function public.sellerpilot_list_registration_activity(p_limit integer default 120)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 120), 300));
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  return coalesce((
    with base_cards as (
      select card.value as card
        from jsonb_array_elements(
          public.sellerpilot_list_registration_activity_pre_image_activity(300)
        ) card(value)
       where card.value->>'id' not like 'job:%'
          or not exists (
            select 1
              from sellerpilot_private.product_ai_revisions revision
             where revision.job_id::text = substring(card.value->>'id' from 5)
          )
    ), recent_revisions as (
      select revision.*
        from sellerpilot_private.product_ai_revisions revision
        join sellerpilot_private.ai_cli_jobs job on job.id = revision.job_id
       order by greatest(revision.updated_at, job.updated_at) desc
       limit 300
    ), revision_cards as (
      select jsonb_build_object(
        'id', 'revision:' || revision.job_id::text,
        'productId', product.id,
        'productName', left(product.name || ' · 사진·상세 전체수정', 180),
        'productCode', product.external_code,
        'sku', product.sku,
        'status', case
          when revision.status = 'applied' then 'completed'
          when revision.status in ('failed', 'cancelled') then 'failed'
          when job.status in ('failed', 'cancelled', 'succeeded') then 'failed'
          else 'analyzing'
        end,
        'startedAt', revision.created_at,
        'updatedAt', greatest(revision.updated_at, job.updated_at),
        'completedAt', case
          when revision.status = 'applied' then coalesce(revision.applied_at, revision.updated_at)
          when revision.status in ('failed', 'cancelled') or job.status in ('failed', 'cancelled', 'succeeded')
            then coalesce(job.completed_at, revision.updated_at, job.updated_at)
          else null
        end,
        'elapsedSeconds', greatest(0, extract(epoch from (
          coalesce(
            case
              when revision.status = 'applied' then coalesce(revision.applied_at, revision.updated_at)
              when revision.status in ('failed', 'cancelled') or job.status in ('failed', 'cancelled', 'succeeded')
                then coalesce(job.completed_at, revision.updated_at, job.updated_at)
              else now()
            end,
            now()
          ) - revision.created_at
        )))::bigint,
        'channelCount', 0,
        'publishedCount', 0,
        'failedCount', case
          when revision.status in ('failed', 'cancelled') or job.status in ('failed', 'cancelled', 'succeeded') and revision.status <> 'applied'
            then 1 else 0
        end,
        'blockedCount', 0,
        'channels', '[]'::jsonb,
        'message', left(coalesce(
          revision.failure_reason,
          case
            when revision.status = 'applied' then '같은 상품 ID에 새 사진과 AI 상세페이지를 적용했습니다. 판매채널 이미지·옵션·SKU는 자동 변경하지 않았습니다.'
            when revision.status in ('failed', 'cancelled') or job.status in ('failed', 'cancelled')
              then coalesce(job.error_message, '상품 사진·상세 수정 작업을 완료하지 못해 기존 상품을 유지했습니다.')
            when job.status = 'succeeded' then 'AI 결과는 완료됐지만 상품 원장 적용 상태를 확인해야 합니다.'
            else '같은 상품 ID를 유지하며 새 사진과 AI 상세페이지를 만들고 있습니다. 외부 판매채널에는 자동 게시하지 않습니다.'
          end,
          ''
        ), 1000)
      ) as card
        from recent_revisions revision
        join sellerpilot_private.ai_cli_jobs job on job.id = revision.job_id
        join sellerpilot_private.products product on product.id = revision.product_id
       where not product.demo
    ), recent_assets as (
      select job.*
        from sellerpilot_private.ai_cli_jobs job
       where job.kind = 'product_asset_regeneration'
       order by job.updated_at desc
       limit 300
    ), asset_cards as (
      select jsonb_build_object(
        'id', 'asset:' || job.id::text,
        'productId', product.id,
        'productName', left(coalesce(product.name, '상품') || ' · 이미지 1장 재제작', 180),
        'productCode', coalesce(product.external_code, 'AI-' || upper(left(job.id::text, 8))),
        'sku', coalesce(product.sku, ''),
        'status', case
          when job.status in ('queued', 'claimed', 'running') then 'analyzing'
          when job.status = 'succeeded' then 'completed'
          else 'failed'
        end,
        'startedAt', job.created_at,
        'updatedAt', job.updated_at,
        'completedAt', case
          when job.status in ('succeeded', 'failed', 'cancelled') then coalesce(job.completed_at, job.updated_at)
          else null
        end,
        'elapsedSeconds', greatest(0, extract(epoch from (
          coalesce(
            case when job.status in ('succeeded', 'failed', 'cancelled')
              then coalesce(job.completed_at, job.updated_at) else now() end,
            now()
          ) - job.created_at
        )))::bigint,
        'channelCount', 0,
        'publishedCount', 0,
        'failedCount', case when job.status in ('failed', 'cancelled') then 1 else 0 end,
        'blockedCount', 0,
        'channels', '[]'::jsonb,
        'message', left(coalesce(
          job.error_message,
          case
            when job.status = 'succeeded' then '선택한 이미지 1장을 중앙 상품에 교체했습니다. 판매채널에는 자동 게시하지 않았습니다.'
            when job.status in ('failed', 'cancelled') then '이미지 1장 재제작을 완료하지 못해 기존 이미지를 유지했습니다.'
            else '선택한 이미지 1장을 AI로 재제작하고 있습니다. 작업 ' || left(job.id::text, 8) || ' · 외부 자동 게시 없음'
          end
        ), 1000)
      ) as card
        from recent_assets job
        left join sellerpilot_private.products product
          on product.id::text = job.request_payload->>'source_product_id'
         and not product.demo
    ), all_cards as (
      select card from base_cards
      union all select card from revision_cards
      union all select card from asset_cards
    )
    select jsonb_agg(card order by (card->>'updatedAt')::timestamptz desc)
      from (
        select card
          from all_cards
         order by (card->>'updatedAt')::timestamptz desc
         limit v_limit
      ) limited
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.sellerpilot_create_asset_regeneration_job(uuid, uuid, uuid, text)
  from public, anon;
revoke all on function public.sellerpilot_list_registration_activity_pre_image_activity(integer)
  from public, anon, authenticated;
revoke all on function public.sellerpilot_list_registration_activity(integer)
  from public, anon;
grant execute on function public.sellerpilot_create_asset_regeneration_job(uuid, uuid, uuid, text)
  to authenticated;
grant execute on function public.sellerpilot_list_registration_activity(integer)
  to authenticated;

commit;
