-- Reset the registration activity clock when an administrator retries an AI job.
-- The immutable created_at remains the original submission time; retry_started_at
-- records the latest explicit recovery generation for the live activity ledger.

begin;

alter table sellerpilot_private.ai_cli_jobs
  add column if not exists retry_started_at timestamptz;

update sellerpilot_private.ai_cli_jobs job
   set retry_started_at = retry.occurred_at
  from (
    select audit.job_id, max(audit.occurred_at) as occurred_at
      from sellerpilot_private.ai_cli_audit audit
     where audit.action = 'job_retried'
       and audit.safe_detail->>'source' = 'admin_ui'
       and audit.job_id is not null
     group by audit.job_id
  ) retry
 where job.id = retry.job_id
   and job.retry_started_at is distinct from retry.occurred_at;

create or replace function public.sellerpilot_retry_ai_job(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision_product_id uuid;
  v_revision sellerpilot_private.product_ai_revisions%rowtype;
  v_product sellerpilot_private.products%rowtype;
  v_job_created_by uuid;
  v_job_kind text;
  v_updated integer;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  select job.created_by, job.kind
    into v_job_created_by, v_job_kind
    from sellerpilot_private.ai_cli_jobs job
   where job.id = p_id;
  if not found
     or (v_job_created_by <> auth.uid() and v_job_kind <> 'product_studio') then
    return false;
  end if;
  select revision.product_id into v_revision_product_id
    from sellerpilot_private.product_ai_revisions revision
   where revision.job_id = p_id;
  if found then
    select product.* into v_product
      from sellerpilot_private.products product
     where product.id = v_revision_product_id
       and not product.demo
       and product.status <> 'archived'
     for update;
    if not found then return false; end if;
    select revision.* into v_revision
      from sellerpilot_private.product_ai_revisions revision
     where revision.job_id = p_id
       and revision.product_id = v_product.id
     for update;
    if v_revision.status not in ('failed', 'cancelled') then return false; end if;
    if v_product.owner_id <> v_revision.owner_id
       or v_product.ai_job_id is distinct from v_revision.base_ai_job_id
       or md5(jsonb_build_object(
         'name', v_product.name,
         'sku', v_product.sku,
         'description', v_product.description,
         'source_url', v_product.source_url,
         'product_facts_without_stock', coalesce(v_product.product_facts, '{}'::jsonb) - 'stock',
         'detail_page_data', v_product.detail_page_data,
         'detail_page_version', v_product.detail_page_version,
         'detail_page_updated_at', v_product.detail_page_updated_at
       )::text) <> v_revision.base_product_edit_fingerprint then
      raise exception 'PRODUCT_REVISION_BASE_CHANGED';
    end if;
    update sellerpilot_private.product_ai_revisions revision
       set status = 'pending', failure_reason = null, updated_at = clock_timestamp()
     where revision.job_id = p_id;
  end if;

  update sellerpilot_private.ai_cli_jobs job
     set status = 'queued',
         result_payload = null,
         error_message = null,
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         attempt_count = 0,
         preparation_failure_count = 0,
         available_at = clock_timestamp(),
         started_at = null,
         retry_started_at = clock_timestamp(),
         completed_at = null,
         updated_at = clock_timestamp()
   where job.id = p_id
     and job.status in ('failed', 'cancelled')
     and (job.created_by = auth.uid() or job.kind = 'product_studio');
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    if v_revision_product_id is not null then
      update sellerpilot_private.product_ai_revisions revision
         set status = v_revision.status,
             failure_reason = v_revision.failure_reason,
             updated_at = clock_timestamp()
       where revision.job_id = p_id;
    end if;
    return false;
  end if;
  delete from sellerpilot_private.ai_job_completion_receipts receipt
   where receipt.job_id = p_id;
  insert into sellerpilot_private.ai_cli_audit (
    action, actor_user_id, job_id, safe_detail
  ) values (
    'job_retried', auth.uid(), p_id,
    jsonb_build_object(
      'source', 'admin_ui',
      'shared_admin_retry', v_job_created_by <> auth.uid(),
      'product_revision', v_revision_product_id is not null
    )
  );
  return true;
end;
$$;

revoke all on function public.sellerpilot_retry_ai_job(uuid)
  from public, anon;
grant execute on function public.sellerpilot_retry_ai_job(uuid)
  to authenticated;

create or replace function public.sellerpilot_list_registration_activity(
  p_limit integer default 120
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 120), 300));
  -- A card can become recent through its product, AI job, or listing. Probe a
  -- small multiple of the requested page from each indexed source so one
  -- source cannot crowd out the others, while keeping work independent of the
  -- total ledger size.
  v_source_limit integer := greatest(120, least(v_limit * 3, 900));
  v_job_probe_limit integer := greatest(300, least(v_limit * 12, 3600));
  v_listing_probe_limit integer := greatest(600, least(v_limit * 24, 7200));
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  return coalesce((
    with recent_active_products as materialized (
      select product.id
       from sellerpilot_private.products product
       where product.status <> 'archived'
         and not product.demo
         and (
           product.ai_job_id is not null
           or exists (
             select 1
               from sellerpilot_private.product_listings listing
              where listing.product_id = product.id
           )
         )
       order by product.updated_at desc, product.id
       limit v_source_limit
    ), recent_studio_job_probe as materialized (
      select job.id,
             job.status,
             job.request_payload->'manual_fields' as manual_fields,
             job.error_message,
             job.created_at,
             job.started_at,
             job.retry_started_at,
             job.completed_at,
             job.updated_at
        from sellerpilot_private.ai_cli_jobs job
       where job.kind = 'product_studio'
       order by job.updated_at desc, job.id
       limit v_job_probe_limit
    ), recent_job_products as materialized (
      select product.id
        from recent_studio_job_probe job
        join sellerpilot_private.products product
          on product.ai_job_id = job.id
       where product.status <> 'archived'
         and not product.demo
       order by job.updated_at desc, job.id
       limit v_source_limit
    ), recent_listing_probe as materialized (
      select listing.product_id, listing.updated_at
        from sellerpilot_private.product_listings listing
       order by listing.updated_at desc, listing.id
       limit v_listing_probe_limit
    ), recent_listing_products as materialized (
      select listing.product_id as id
        from recent_listing_probe listing
       group by listing.product_id
       order by max(listing.updated_at) desc, listing.product_id
       limit v_source_limit
    ), candidate_product_ids as materialized (
      select product.id from recent_active_products product
      union
      select product.id from recent_job_products product
      union
      select product.id from recent_listing_products product
    ), listing_rollup as materialized (
      select
        listing.product_id,
        count(*)::integer as total_count,
        count(*) filter (
          where listing.status in ('published', 'failed', 'paused', 'scope_excluded')
        )::integer as terminal_count,
        count(*) filter (where listing.status = 'published')::integer as published_count,
        count(*) filter (
          where listing.status = 'failed'
            and coalesce(listing.failure_class, 'retryable') <> 'external_action'
        )::integer as failed_count,
        count(*) filter (
          where listing.status = 'failed'
            and listing.failure_class = 'external_action'
        )::integer as blocked_count,
        count(*) filter (
          where listing.status in ('queued', 'draft')
            and attempt.status = 'running'
        )::integer as running_count,
        min(coalesce(attempt.started_at, listing.updated_at)) as started_at,
        max(listing.updated_at) as updated_at,
        max(
          case
            when listing.status in ('published', 'failed', 'paused', 'scope_excluded')
              then coalesce(attempt.completed_at, listing.updated_at)
            else null
          end
        ) as completed_at,
        (
          array_agg(
            coalesce(listing.last_error, attempt.safe_message)
            order by listing.updated_at desc, listing.id
          ) filter (
            where coalesce(listing.last_error, attempt.safe_message) is not null
          )
        )[1] as last_message,
        jsonb_agg(
          jsonb_build_object(
            'channel', listing.channel_key,
            'channelCode', channel.code,
            'channelName', channel.name,
            'market', listing.market,
            'status', case
              when listing.status = 'failed'
                and listing.failure_class = 'external_action' then 'blocked'
              when listing.status = 'queued' and attempt.id is null then 'draft'
              else listing.status
            end,
            'message', coalesce(listing.last_error, attempt.safe_message, ''),
            'updatedAt', listing.updated_at
          )
          order by channel.sort_order, listing.market, listing.target_id
        ) as channels
      from candidate_product_ids candidate
      join sellerpilot_private.product_listings listing
        on listing.product_id = candidate.id
      join sellerpilot_private.channels channel
        on channel.key = listing.channel_key
      left join sellerpilot_private.channel_operation_attempts attempt
        on attempt.id = listing.operation_attempt_id
     group by listing.product_id
    ), product_cards as (
      select
        'product:' || product.id::text as activity_id,
        product.id as product_id,
        product.name as product_name,
        product.external_code as product_code,
        product.sku,
        case
          when coalesce(listing.running_count, 0) > 0 then 'publishing'
          when coalesce(listing.blocked_count, 0) > 0 then 'blocked'
          when coalesce(listing.failed_count, 0) > 0 then 'failed'
          when coalesce(listing.total_count, 0) > 0
            and coalesce(listing.terminal_count, 0) = listing.total_count then 'completed'
          when job.status in ('failed', 'cancelled') then 'failed'
          when job.status in ('queued', 'claimed', 'running') then 'analyzing'
          else 'ready'
        end as status,
        coalesce(
          case
            when job.retry_started_at is not null then
              coalesce(job.started_at, job.retry_started_at)
            else job.created_at
          end,
          listing.started_at,
          product.created_at,
          product.updated_at
        ) as started_at,
        greatest(
          product.updated_at,
          coalesce(job.updated_at, product.updated_at),
          coalesce(listing.updated_at, product.updated_at)
        ) as updated_at,
        case
          when coalesce(listing.total_count, 0) > 0
            and coalesce(listing.terminal_count, 0) = listing.total_count then
            greatest(
              coalesce(
                job.completed_at,
                job.updated_at,
                listing.completed_at,
                listing.updated_at,
                product.updated_at
              ),
              coalesce(
                listing.completed_at,
                listing.updated_at,
                job.completed_at,
                job.updated_at,
                product.updated_at
              )
            )
          when coalesce(listing.running_count, 0) = 0
            and coalesce(listing.blocked_count, 0) = 0
            and coalesce(listing.failed_count, 0) = 0
            and (job.status is null or job.status in ('succeeded', 'failed', 'cancelled')) then
            greatest(
              coalesce(job.completed_at, job.updated_at, product.updated_at),
              coalesce(listing.completed_at, listing.updated_at, product.updated_at)
            )
          else null
        end as completed_at,
        coalesce(listing.channels, '[]'::jsonb) as channels,
        coalesce(listing.total_count, 0) as channel_count,
        coalesce(listing.published_count, 0) as published_count,
        coalesce(listing.failed_count, 0) as failed_count,
        coalesce(listing.blocked_count, 0) as blocked_count,
        left(coalesce(listing.last_message, job.error_message, ''), 1000) as message
      from candidate_product_ids candidate
      join sellerpilot_private.products product on product.id = candidate.id
      left join sellerpilot_private.ai_cli_jobs job on job.id = product.ai_job_id
      left join listing_rollup listing on listing.product_id = product.id
     where product.status <> 'archived'
       and not product.demo
       and (product.ai_job_id is not null or coalesce(listing.total_count, 0) > 0)
    ), orphan_jobs as (
      select
        'job:' || job.id::text as activity_id,
        null::uuid as product_id,
        left(
          coalesce(
            nullif(job.manual_fields->>'productName', ''),
            '상품 분석'
          ),
          160
        ) as product_name,
        'AI-' || upper(left(job.id::text, 8)) as product_code,
        coalesce(job.manual_fields->>'sellerSku', '') as sku,
        case
          when job.status in ('queued', 'claimed', 'running') then 'analyzing'
          when job.status = 'succeeded' then 'ready'
          else 'failed'
        end as status,
        case
          when job.retry_started_at is not null then
            coalesce(job.started_at, job.retry_started_at)
          else job.created_at
        end as started_at,
        job.updated_at,
        case
          when job.status in ('succeeded', 'failed', 'cancelled')
            then coalesce(job.completed_at, job.updated_at)
          else null
        end as completed_at,
        '[]'::jsonb as channels,
        0 as channel_count,
        0 as published_count,
        case when job.status in ('failed', 'cancelled') then 1 else 0 end as failed_count,
        0 as blocked_count,
        left(coalesce(job.error_message, ''), 1000) as message
      from recent_studio_job_probe job
     where not exists (
             select 1
               from sellerpilot_private.products product
              where product.ai_job_id = job.id
           )
       and not exists (
             select 1
               from sellerpilot_private.product_ai_revisions revision
              where revision.job_id = job.id
           )
     order by job.updated_at desc, job.id
     limit v_source_limit
    ), recent_revision_rows as materialized (
      select revision.job_id
        from sellerpilot_private.product_ai_revisions revision
       order by revision.updated_at desc, revision.job_id
       limit v_source_limit
    ), recent_revision_job_rows as materialized (
      select revision.job_id
        from recent_studio_job_probe job
        join sellerpilot_private.product_ai_revisions revision
          on revision.job_id = job.id
       order by job.updated_at desc, job.id
       limit v_source_limit
    ), candidate_revision_ids as materialized (
      select revision.job_id from recent_revision_rows revision
      union
      select revision.job_id from recent_revision_job_rows revision
    ), revision_cards as (
      select
        'revision:' || revision.job_id::text as activity_id,
        product.id as product_id,
        left(product.name || ' · 사진·상세 전체수정', 180) as product_name,
        product.external_code as product_code,
        product.sku,
        case
          when revision.status = 'applied' then 'completed'
          when revision.status in ('failed', 'cancelled') then 'failed'
          when job.status in ('failed', 'cancelled', 'succeeded') then 'failed'
          else 'analyzing'
        end as status,
        case
          when job.retry_started_at is not null then
            coalesce(job.started_at, job.retry_started_at)
          else revision.created_at
        end as started_at,
        greatest(revision.updated_at, job.updated_at) as updated_at,
        case
          when revision.status = 'applied'
            then coalesce(revision.applied_at, revision.updated_at)
          when revision.status in ('failed', 'cancelled')
            or job.status in ('failed', 'cancelled', 'succeeded')
            then coalesce(job.completed_at, revision.updated_at, job.updated_at)
          else null
        end as completed_at,
        '[]'::jsonb as channels,
        0 as channel_count,
        0 as published_count,
        case
          when revision.status in ('failed', 'cancelled')
            or (
              job.status in ('failed', 'cancelled', 'succeeded')
              and revision.status <> 'applied'
            ) then 1
          else 0
        end as failed_count,
        0 as blocked_count,
        left(
          coalesce(
            revision.failure_reason,
            case
              when revision.status = 'applied' then
                '같은 상품 ID에 새 사진과 AI 상세페이지를 적용했습니다. 판매채널 이미지·옵션·SKU는 자동 변경하지 않았습니다.'
              when revision.status in ('failed', 'cancelled')
                or job.status in ('failed', 'cancelled') then
                coalesce(
                  job.error_message,
                  '상품 사진·상세 수정 작업을 완료하지 못해 기존 상품을 유지했습니다.'
                )
              when job.status = 'succeeded' then
                'AI 결과는 완료됐지만 상품 원장 적용 상태를 확인해야 합니다.'
              else
                '같은 상품 ID를 유지하며 새 사진과 AI 상세페이지를 만들고 있습니다. 외부 판매채널에는 자동 게시하지 않습니다.'
            end,
            ''
          ),
          1000
        ) as message
      from candidate_revision_ids candidate
      join sellerpilot_private.product_ai_revisions revision
        on revision.job_id = candidate.job_id
      join sellerpilot_private.ai_cli_jobs job on job.id = revision.job_id
      join sellerpilot_private.products product on product.id = revision.product_id
     where not product.demo
    ), recent_assets as materialized (
      select job.id,
             job.status,
             job.request_payload->>'source_product_id' as source_product_id,
             job.error_message,
             job.created_at,
             job.started_at,
             job.retry_started_at,
             job.completed_at,
             job.updated_at
        from sellerpilot_private.ai_cli_jobs job
       where job.kind = 'product_asset_regeneration'
       order by job.updated_at desc, job.id
       limit v_source_limit
    ), asset_cards as (
      select
        'asset:' || job.id::text as activity_id,
        product.id as product_id,
        left(coalesce(product.name, '상품') || ' · 이미지 1장 재제작', 180) as product_name,
        coalesce(product.external_code, 'AI-' || upper(left(job.id::text, 8))) as product_code,
        coalesce(product.sku, '') as sku,
        case
          when job.status in ('queued', 'claimed', 'running') then 'analyzing'
          when job.status = 'succeeded' then 'completed'
          else 'failed'
        end as status,
        case
          when job.retry_started_at is not null then
            coalesce(job.started_at, job.retry_started_at)
          else job.created_at
        end as started_at,
        job.updated_at,
        case
          when job.status in ('succeeded', 'failed', 'cancelled')
            then coalesce(job.completed_at, job.updated_at)
          else null
        end as completed_at,
        '[]'::jsonb as channels,
        0 as channel_count,
        0 as published_count,
        case when job.status in ('failed', 'cancelled') then 1 else 0 end as failed_count,
        0 as blocked_count,
        left(
          coalesce(
            job.error_message,
            case
              when job.status = 'succeeded' then
                '선택한 이미지 1장을 중앙 상품에 교체했습니다. 판매채널에는 자동 게시하지 않았습니다.'
              when job.status in ('failed', 'cancelled') then
                '이미지 1장 재제작을 완료하지 못해 기존 이미지를 유지했습니다.'
              else
                '선택한 이미지 1장을 AI로 재제작하고 있습니다. 작업 '
                  || left(job.id::text, 8) || ' · 외부 자동 게시 없음'
            end
          ),
          1000
        ) as message
      from recent_assets job
      left join sellerpilot_private.products product
        on product.id = case
             when job.source_product_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then job.source_product_id::uuid
             else null
           end
       and not product.demo
    ), cards as (
      select * from product_cards
      union all
      select * from orphan_jobs
      union all
      select * from revision_cards
      union all
      select * from asset_cards
    ), limited_cards as materialized (
      select card.*
        from cards card
       order by card.updated_at desc, card.activity_id
       limit v_limit
    )
    select jsonb_agg(
      jsonb_build_object(
        'id', card.activity_id,
        'productId', card.product_id,
        'productName', card.product_name,
        'productCode', card.product_code,
        'sku', card.sku,
        'status', card.status,
        'startedAt', card.started_at,
        'updatedAt', card.updated_at,
        'completedAt', card.completed_at,
        'elapsedSeconds', greatest(
          0,
          extract(epoch from (coalesce(card.completed_at, now()) - card.started_at))::bigint
        ),
        'channelCount', card.channel_count,
        'publishedCount', card.published_count,
        'failedCount', card.failed_count,
        'blockedCount', card.blocked_count,
        'channels', card.channels,
        'message', card.message
      )
      order by card.updated_at desc, card.activity_id
    )
      from limited_cards card
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.sellerpilot_list_registration_activity(integer)
  from public, anon;
grant execute on function public.sellerpilot_list_registration_activity(integer)
  to authenticated;

commit;
