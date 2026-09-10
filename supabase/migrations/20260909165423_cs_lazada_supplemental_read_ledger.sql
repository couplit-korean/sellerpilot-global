-- Lazada product-review and reverse-order supplemental CS read ledger.
-- Read-only: no review reply, cancel, return, refund or reject mutation exists.
begin;

do $$
begin
  if to_regclass('sellerpilot_private.channel_credentials') is null
     or to_regclass('sellerpilot_private.cs_credential_capability_bindings') is null
     or to_regprocedure('public.sellerpilot_is_admin()') is null then
    raise exception 'LAZADA_SUPPLEMENTAL_PREIMAGE_MISSING';
  end if;
  if to_regclass('sellerpilot_private.lazada_supplemental_cs_events') is not null
     or to_regprocedure('public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(uuid,text,text,text,jsonb)') is not null
     or to_regprocedure('public.sellerpilot_read_lazada_supplemental_cs_v1(text,timestamptz,text,integer)') is not null
     or to_regprocedure('public.sellerpilot_read_lazada_supplemental_cs_v1(text,timestamptz,text,uuid,text,integer)') is not null then
    raise exception 'LAZADA_SUPPLEMENTAL_ALREADY_INSTALLED';
  end if;
end
$$;

create table sellerpilot_private.lazada_supplemental_cs_events(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id),
  seller_account_key text not null check(seller_account_key ~ '^[a-f0-9]{64}$'),
  country text not null check(country in ('SG','MY','TH','VN','ID','PH')),
  surface text not null check(surface in ('product_review','reverse_order_after_sales')),
  source_path text not null check(source_path in(
    '/review/seller/list',
    '/reverse/getreverseordersforseller',
    '/order/reverse/return/detail/list',
    '/order/reverse/return/history/list'
  )),
  resource_key text not null check(length(resource_key) between 1 and 240),
  event_key text not null check(event_key ~ '^[a-f0-9]{64}$'),
  status text not null check(length(status) between 1 and 120),
  title text not null check(length(title) between 1 and 500),
  body text check(body is null or length(body) <= 5000),
  external_order_id text check(external_order_id is null or length(external_order_id) between 1 and 240),
  external_item_id text check(external_item_id is null or length(external_item_id) between 1 and 240),
  rating integer check(rating is null or rating between 1 and 5),
  occurred_at timestamptz not null,
  observed_at timestamptz not null,
  provider_context jsonb not null default '{}'::jsonb check(jsonb_typeof(provider_context)='object'),
  created_at timestamptz not null default clock_timestamp(),
  unique(credential_id,country,surface,resource_key,event_key),
  check((surface='product_review' and rating is not null and source_path='/review/seller/list')
     or (surface='reverse_order_after_sales' and rating is null and source_path<>'/review/seller/list'))
);

create index if not exists lazada_supplemental_cs_events_history_idx
on sellerpilot_private.lazada_supplemental_cs_events(
  occurred_at desc,event_key desc
);

create index if not exists lazada_supplemental_cs_events_account_idx
on sellerpilot_private.lazada_supplemental_cs_events(
  owner_id,credential_id,country,surface,occurred_at desc,event_key desc
);

alter table sellerpilot_private.lazada_supplemental_cs_events enable row level security;
revoke all on table sellerpilot_private.lazada_supplemental_cs_events
  from public,anon,authenticated,service_role;

create function public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
  p_credential_id uuid,
  p_country text,
  p_surface text,
  p_source_path text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_credential record;
  v_country text:=upper(trim(coalesce(p_country,'')));
  v_expected_surface text;
  v_row jsonb;
  v_inserted integer:=0;
  v_duplicate integer:=0;
  v_seen integer:=0;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  v_expected_surface:=case p_source_path
    when '/review/seller/list' then 'product_review'
    when '/reverse/getreverseordersforseller' then 'reverse_order_after_sales'
    when '/order/reverse/return/detail/list' then 'reverse_order_after_sales'
    when '/order/reverse/return/history/list' then 'reverse_order_after_sales'
    else null end;
  if p_credential_id is null or p_country is null or p_surface is null
     or p_source_path is null or p_rows is null
     or v_country not in('SG','MY','TH','VN','ID','PH')
     or v_expected_surface is null or p_surface<>v_expected_surface
     or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'LAZADA_SUPPLEMENTAL_INGEST_INVALID' using errcode='22023';
  end if;
  if jsonb_array_length(p_rows)>100 or octet_length(p_rows::text)>512000 then
    raise exception 'LAZADA_SUPPLEMENTAL_INGEST_INVALID' using errcode='22023';
  end if;
  select credential.id,credential.created_by,credential.seller_account_key
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id
     and credential.channel='lazada'
     and credential.environment='production'
     and credential.status='active'
     and (credential.expires_at is null or credential.expires_at>clock_timestamp())
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source='provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found then
    raise exception 'LAZADA_SUPPLEMENTAL_CREDENTIAL_UNBOUND' using errcode='42501';
  end if;
  if not exists(
    select 1 from sellerpilot_private.cs_credential_capability_bindings binding
     where binding.credential_id=v_credential.id
       and binding.channel='lazada'
       and binding.operation='inquiries.list'
       and upper(binding.country)=v_country
       and binding.status='active'
       and (binding.expires_at is null or binding.expires_at>clock_timestamp())
  ) then
    raise exception 'LAZADA_SUPPLEMENTAL_COUNTRY_BINDING_REQUIRED' using errcode='42501';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) item(value) loop
    v_seen:=v_seen+1;
    if jsonb_typeof(v_row)<>'object'
       or v_row->>'credentialId' is distinct from v_credential.id::text
       or v_row->>'country' is distinct from v_country
       or v_row->>'surface' is distinct from p_surface
       or v_row->>'sourcePath' is distinct from p_source_path
       or coalesce(v_row->>'resourceKey','') !~ '^[^[:cntrl:]]{1,240}$'
       or coalesce(v_row->>'eventKey','') !~ '^[a-f0-9]{64}$'
       or length(coalesce(v_row->>'status','')) not between 1 and 120
       or length(coalesce(v_row->>'title','')) not between 1 and 500
       or length(coalesce(v_row->>'body',''))>5000
       or jsonb_typeof(coalesce(v_row->'providerContext','{}'::jsonb))<>'object'
       or exists(
         select 1 from jsonb_object_keys(coalesce(v_row->'providerContext','{}'::jsonb)) context_key
          where (p_surface='product_review' and context_key not in('reviewId','itemId','sellerReplyId','sellerReply','reviewType'))
             or (p_surface='reverse_order_after_sales' and context_key not in('reverseOrderId','reverseOrderLineId','historyId','observationKind'))
       )
       or exists(
         select 1 from jsonb_each(coalesce(v_row->'providerContext','{}'::jsonb)) context_entry
          where jsonb_typeof(context_entry.value)<>'string'
             or length(context_entry.value#>>'{}') not between 1 and
               case when p_surface='product_review' and context_entry.key='sellerReply' then 5000 else 240 end
       )
       or nullif(v_row->>'occurredAt','') is null
       or nullif(v_row->>'observedAt','') is null
       or (p_surface='product_review' and coalesce((v_row->>'rating')::integer,0) not between 1 and 5)
       or (p_surface='reverse_order_after_sales' and v_row->'rating'<>'null'::jsonb) then
      raise exception 'LAZADA_SUPPLEMENTAL_ROW_INVALID' using errcode='22023';
    end if;
    if exists(
      select 1 from sellerpilot_private.lazada_supplemental_cs_events event
       where event.credential_id=v_credential.id
         and event.country=v_country
         and event.surface=p_surface
         and event.source_path=p_source_path
         and event.resource_key=v_row->>'resourceKey'
         and event.status=v_row->>'status'
         and event.title=v_row->>'title'
         and event.body is not distinct from nullif(v_row->>'body','')
         and event.external_order_id is not distinct from nullif(v_row->>'externalOrderId','')
         and event.external_item_id is not distinct from nullif(v_row->>'externalItemId','')
         and event.rating is not distinct from case when p_surface='product_review'
           then (v_row->>'rating')::integer else null end
         and event.occurred_at=(v_row->>'occurredAt')::timestamptz
         and event.provider_context=coalesce(v_row->'providerContext','{}'::jsonb)
    ) then
      v_duplicate:=v_duplicate+1;
      continue;
    end if;
    if exists(
      select 1 from sellerpilot_private.lazada_supplemental_cs_events event
       where event.credential_id=v_credential.id
         and event.country=v_country
         and event.surface=p_surface
         and event.resource_key=v_row->>'resourceKey'
         and event.event_key=v_row->>'eventKey'
    ) then
      raise exception 'LAZADA_SUPPLEMENTAL_EVENT_KEY_CONFLICT' using errcode='23505';
    end if;
    insert into sellerpilot_private.lazada_supplemental_cs_events(
      owner_id,credential_id,seller_account_key,country,surface,source_path,
      resource_key,event_key,status,title,body,external_order_id,external_item_id,
      rating,occurred_at,observed_at,provider_context
    ) values(
      v_credential.created_by,v_credential.id,v_credential.seller_account_key,
      v_country,p_surface,p_source_path,v_row->>'resourceKey',v_row->>'eventKey',
      v_row->>'status',v_row->>'title',nullif(v_row->>'body',''),
      nullif(v_row->>'externalOrderId',''),nullif(v_row->>'externalItemId',''),
      case when p_surface='product_review' then (v_row->>'rating')::integer else null end,
      (v_row->>'occurredAt')::timestamptz,(v_row->>'observedAt')::timestamptz,
      coalesce(v_row->'providerContext','{}'::jsonb)
    ) on conflict(credential_id,country,surface,resource_key,event_key) do nothing;
    if found then
      v_inserted:=v_inserted+1;
    else
      perform 1 from sellerpilot_private.lazada_supplemental_cs_events event
       where event.credential_id=v_credential.id
         and event.country=v_country
         and event.surface=p_surface
         and event.source_path=p_source_path
         and event.resource_key=v_row->>'resourceKey'
         and event.event_key=v_row->>'eventKey'
         and event.status=v_row->>'status'
         and event.title=v_row->>'title'
         and event.body is not distinct from nullif(v_row->>'body','')
         and event.external_order_id is not distinct from nullif(v_row->>'externalOrderId','')
         and event.external_item_id is not distinct from nullif(v_row->>'externalItemId','')
         and event.rating is not distinct from case when p_surface='product_review'
           then (v_row->>'rating')::integer else null end
         and event.occurred_at=(v_row->>'occurredAt')::timestamptz
         and event.provider_context=coalesce(v_row->'providerContext','{}'::jsonb);
      if found then
        v_duplicate:=v_duplicate+1;
      else
        raise exception 'LAZADA_SUPPLEMENTAL_EVENT_KEY_CONFLICT' using errcode='23505';
      end if;
    end if;
  end loop;
  return jsonb_build_object(
    'contractVersion','sellerpilot-lazada-supplemental-ingest/1',
    'readOnly',true,'credentialId',v_credential.id,'country',v_country,
    'surface',p_surface,'seen',v_seen,'inserted',v_inserted,'duplicates',v_duplicate
  );
end
$$;

create function public.sellerpilot_read_lazada_supplemental_cs_v1(
  p_surface text default null,
  p_before_at timestamptz default null,
  p_before_event_key text default null,
  p_before_credential_id uuid default null,
  p_before_country text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_rows jsonb;
  v_result jsonb;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  if (p_surface is not null and p_surface not in('product_review','reverse_order_after_sales'))
     or p_limit is null or p_limit not between 1 and 100
     or ((p_before_at is null)<>(p_before_event_key is null))
     or ((p_before_at is null)<>(p_before_credential_id is null))
     or ((p_before_at is null)<>(p_before_country is null))
     or (p_before_event_key is not null and p_before_event_key !~ '^[a-f0-9]{64}$')
     or (p_before_country is not null and p_before_country not in('SG','MY','TH','VN','ID','PH')) then
    raise exception 'LAZADA_SUPPLEMENTAL_READ_INVALID' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(row_value order by occurred_at desc,event_key desc,credential_id desc,country desc),'[]'::jsonb)
    into v_rows
    from(
      select event.occurred_at,event.event_key,event.credential_id,event.country,jsonb_build_object(
        'credentialId',event.credential_id,'country',event.country,
        'surface',event.surface,'sourcePath',event.source_path,
        'resourceKey',event.resource_key,'eventKey',event.event_key,
        'status',event.status,'title',event.title,'body',event.body,
        'externalOrderId',event.external_order_id,'externalItemId',event.external_item_id,
        'rating',event.rating,'occurredAt',event.occurred_at,'observedAt',event.observed_at,
        'providerContext',event.provider_context
      ) row_value
      from sellerpilot_private.lazada_supplemental_cs_events event
      where (p_surface is null or event.surface=p_surface)
        and (p_before_at is null or (event.occurred_at,event.event_key,event.credential_id,event.country)
          <(p_before_at,p_before_event_key,p_before_credential_id,p_before_country))
      order by event.occurred_at desc,event.event_key desc,event.credential_id desc,event.country desc
      limit p_limit+1
    ) page;
  select coalesce(jsonb_agg(value),'[]'::jsonb) into v_result
    from(select value from jsonb_array_elements(v_rows) with ordinality item(value,n)
      where n<=p_limit order by n) selected;
  return jsonb_build_object(
    'events',v_result,
    'nextCursor',case when jsonb_array_length(v_rows)>p_limit then jsonb_build_object(
      'occurredAt',v_result->(p_limit-1)->>'occurredAt',
      'eventKey',v_result->(p_limit-1)->>'eventKey',
      'credentialId',v_result->(p_limit-1)->>'credentialId',
      'country',v_result->(p_limit-1)->>'country'
    ) else null end
  );
end
$$;

revoke all on function public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
  uuid,text,text,text,jsonb
) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
  uuid,text,text,text,jsonb
) to service_role;
revoke all on function public.sellerpilot_read_lazada_supplemental_cs_v1(
  text,timestamptz,text,uuid,text,integer
) from public,anon,service_role;
grant execute on function public.sellerpilot_read_lazada_supplemental_cs_v1(
  text,timestamptz,text,uuid,text,integer
) to authenticated;

comment on table sellerpilot_private.lazada_supplemental_cs_events is
  'Immutable read-only Lazada product review and reverse-order CS history. No commerce mutation surface.';
comment on function public.sellerpilot_service_ingest_lazada_supplemental_cs_v1(
  uuid,text,text,text,jsonb
) is 'Stores bounded normalized supplemental CS reads after exact credential and country binding checks.';
comment on function public.sellerpilot_read_lazada_supplemental_cs_v1(
  text,timestamptz,text,uuid,text,integer
) is 'Shared-admin read-only Lazada supplemental CS history projection.';

notify pgrst,'reload schema';
commit;
