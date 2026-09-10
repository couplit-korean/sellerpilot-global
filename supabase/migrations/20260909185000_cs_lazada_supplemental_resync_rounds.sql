-- Additive follow-up to 20260909181000: immutable completed rounds plus explicit admin resync.
begin;

do $$
begin
  if to_regclass('sellerpilot_private.lazada_supplemental_read_progress') is null
     or to_regprocedure('public.sellerpilot_service_prepare_lazada_supplemental_read_v1(uuid,text,text,text,integer)') is null
     or to_regprocedure('public.sellerpilot_service_ingest_and_ack_lazada_supplemental_page_v1(uuid,bigint,uuid,text,text,text,text,integer,integer,jsonb,jsonb)') is null then
    raise exception 'LAZADA_SUPPLEMENTAL_RESYNC_PREIMAGE_MISSING';
  end if;
  if exists(select 1 from information_schema.columns
    where table_schema='sellerpilot_private' and table_name='lazada_supplemental_read_progress'
      and column_name='run_number')
     or to_regprocedure('public.sellerpilot_service_begin_lazada_supplemental_resync_v1(uuid,uuid,bigint,uuid,text,text,text,integer,uuid)') is not null then
    raise exception 'LAZADA_SUPPLEMENTAL_RESYNC_ALREADY_INSTALLED';
  end if;
end
$$;

alter table sellerpilot_private.lazada_supplemental_read_progress
  drop constraint lazada_supplemental_read_prog_credential_id_country_surface_key;

alter table sellerpilot_private.lazada_supplemental_read_progress
  add column run_number bigint not null default 1 check(run_number>=1),
  add column supersedes_continuation_id uuid
    references sellerpilot_private.lazada_supplemental_read_progress(continuation_id) on delete restrict,
  add column start_request_id uuid,
  add column started_by uuid references sellerpilot_private.admin_users(user_id) on delete restrict,
  add constraint lazada_supplemental_read_progress_round_origin_check check(
    (run_number=1 and supersedes_continuation_id is null and start_request_id is null and started_by is null)
    or (run_number>1 and supersedes_continuation_id is not null and start_request_id is not null and started_by is not null)
  );

create unique index lazada_supplemental_read_progress_one_active_idx
on sellerpilot_private.lazada_supplemental_read_progress(
  credential_id,country,surface,source_path,resource_id
) where complete=false;

create unique index lazada_supplemental_read_progress_round_idx
on sellerpilot_private.lazada_supplemental_read_progress(
  credential_id,country,surface,source_path,resource_id,run_number
);

create unique index lazada_supplemental_read_progress_parent_idx
on sellerpilot_private.lazada_supplemental_read_progress(supersedes_continuation_id)
where supersedes_continuation_id is not null;

create unique index lazada_supplemental_read_progress_start_request_idx
on sellerpilot_private.lazada_supplemental_read_progress(start_request_id)
where start_request_id is not null;

create or replace function public.sellerpilot_service_prepare_lazada_supplemental_read_v1(
  p_credential_id uuid,
  p_country text,
  p_source_path text,
  p_resource_id text,
  p_page_size integer
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_country text:=upper(trim(coalesce(p_country,'')));
  v_resource text:=trim(coalesce(p_resource_id,''));
  v_surface text;
  v_credential record;
  v_grant record;
  v_progress record;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  v_surface:=case p_source_path when '/review/seller/list' then 'product_review'
    when '/reverse/getreverseordersforseller' then 'reverse_order_after_sales'
    when '/order/reverse/return/detail/list' then 'reverse_order_after_sales'
    when '/order/reverse/return/history/list' then 'reverse_order_after_sales' else null end;
  if p_credential_id is null or v_country not in('SG','MY','TH','VN','ID','PH')
     or v_surface is null or p_page_size is null or p_page_size not between 1 and 50
     or length(v_resource)>32 or (v_resource<>'' and v_resource !~ '^[1-9][0-9]{0,31}$')
     or (p_source_path<>'/reverse/getreverseordersforseller' and v_resource='') then
    raise exception 'LAZADA_SUPPLEMENTAL_PREPARE_INVALID' using errcode='22023';
  end if;
  select credential.id,credential.seller_account_key
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id and credential.channel='lazada'
     and credential.environment='production' and credential.status='active'
     and (credential.expires_at is null or credential.expires_at>v_now)
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source='provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found then
    raise exception 'LAZADA_SUPPLEMENTAL_CREDENTIAL_UNBOUND' using errcode='42501';
  end if;
  select capability_grant.id,capability_grant.binding_id
    into v_grant
    from sellerpilot_private.lazada_supplemental_read_grants capability_grant
    join sellerpilot_private.cs_credential_capability_bindings binding on binding.id=capability_grant.binding_id
   where capability_grant.credential_id=v_credential.id
     and capability_grant.seller_account_key=v_credential.seller_account_key
     and capability_grant.country=v_country and capability_grant.surface=v_surface
     and capability_grant.source_path=p_source_path
     and capability_grant.verification_source='lazada_app_permission_readback'
     and capability_grant.status='active'
     and (capability_grant.expires_at is null or capability_grant.expires_at>v_now)
     and binding.credential_id=v_credential.id and binding.channel='lazada'
     and binding.operation='inquiries.list' and upper(binding.country)=v_country
     and binding.target_fingerprint=capability_grant.binding_target_fingerprint
     and binding.status='active' and (binding.expires_at is null or binding.expires_at>v_now)
   order by capability_grant.verified_at desc limit 1;
  if not found then
    raise exception 'LAZADA_SUPPLEMENTAL_EXACT_PERMISSION_REQUIRED' using errcode='42501';
  end if;
  select progress.* into v_progress
    from sellerpilot_private.lazada_supplemental_read_progress progress
   where progress.credential_id=v_credential.id and progress.country=v_country
     and progress.surface=v_surface and progress.source_path=p_source_path
     and progress.resource_id=v_resource and progress.complete=false
   for update;
  if not found then
    if exists(select 1 from sellerpilot_private.lazada_supplemental_read_progress progress
      where progress.credential_id=v_credential.id and progress.country=v_country
        and progress.surface=v_surface and progress.source_path=p_source_path
        and progress.resource_id=v_resource) then
      raise exception 'LAZADA_SUPPLEMENTAL_READ_ALREADY_COMPLETE' using errcode='22023';
    end if;
    insert into sellerpilot_private.lazada_supplemental_read_progress(
      grant_id,credential_id,seller_account_key,country,surface,source_path,resource_id,page_size,run_number
    ) values(
      v_grant.id,v_credential.id,v_credential.seller_account_key,v_country,v_surface,
      p_source_path,v_resource,p_page_size,1
    ) on conflict do nothing;
    select progress.* into v_progress
      from sellerpilot_private.lazada_supplemental_read_progress progress
     where progress.credential_id=v_credential.id and progress.country=v_country
       and progress.surface=v_surface and progress.source_path=p_source_path
       and progress.resource_id=v_resource and progress.complete=false
     for update;
  end if;
  if not found or v_progress.grant_id<>v_grant.id
     or v_progress.seller_account_key<>v_credential.seller_account_key
     or v_progress.page_size<>p_page_size then
    raise exception 'LAZADA_SUPPLEMENTAL_PROGRESS_BINDING_MISMATCH' using errcode='42501';
  end if;
  return jsonb_build_object(
    'contractVersion','sellerpilot-lazada-supplemental-read-prepare/1',
    'continuationId',v_progress.continuation_id,'revision',v_progress.revision,
    'grantId',v_grant.id,'credentialId',v_credential.id,
    'sellerAccountKey',v_credential.seller_account_key,'country',v_country,
    'surface',v_surface,'sourcePath',p_source_path,'resourceId',v_resource,
    'pageSize',v_progress.page_size,'pageNumber',v_progress.next_page,
    'readOnly',true,'mutationAllowed',false
  );
end
$$;

create function public.sellerpilot_service_begin_lazada_supplemental_resync_v1(
  p_actor_id uuid,
  p_completed_continuation_id uuid,
  p_expected_completed_revision bigint,
  p_credential_id uuid,
  p_country text,
  p_source_path text,
  p_resource_id text,
  p_page_size integer,
  p_start_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_country text:=upper(trim(coalesce(p_country,'')));
  v_resource text:=trim(coalesce(p_resource_id,''));
  v_surface text;
  v_credential record;
  v_grant record;
  v_parent record;
  v_child record;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  v_surface:=case p_source_path when '/review/seller/list' then 'product_review'
    when '/reverse/getreverseordersforseller' then 'reverse_order_after_sales'
    when '/order/reverse/return/detail/list' then 'reverse_order_after_sales'
    when '/order/reverse/return/history/list' then 'reverse_order_after_sales' else null end;
  if p_actor_id is null or not exists(select 1 from sellerpilot_private.admin_users admin
       where admin.user_id=p_actor_id)
     or p_completed_continuation_id is null or p_expected_completed_revision is null
     or p_expected_completed_revision<1 or p_credential_id is null or p_start_request_id is null
     or v_country not in('SG','MY','TH','VN','ID','PH') or v_surface is null
     or p_page_size is null or p_page_size not between 1 and 50
     or length(v_resource)>32 or (v_resource<>'' and v_resource !~ '^[1-9][0-9]{0,31}$')
     or (p_source_path<>'/reverse/getreverseordersforseller' and v_resource='') then
    raise exception 'LAZADA_SUPPLEMENTAL_RESYNC_INVALID' using errcode='22023';
  end if;
  select credential.id,credential.seller_account_key
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id and credential.channel='lazada'
     and credential.environment='production' and credential.status='active'
     and (credential.expires_at is null or credential.expires_at>v_now)
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source='provider_certified_v1'
     and credential.seller_account_verified_at is not null;
  if not found then
    raise exception 'LAZADA_SUPPLEMENTAL_CREDENTIAL_UNBOUND' using errcode='42501';
  end if;
  select capability_grant.id into v_grant
    from sellerpilot_private.lazada_supplemental_read_grants capability_grant
    join sellerpilot_private.cs_credential_capability_bindings binding on binding.id=capability_grant.binding_id
   where capability_grant.credential_id=v_credential.id
     and capability_grant.seller_account_key=v_credential.seller_account_key
     and capability_grant.country=v_country and capability_grant.surface=v_surface
     and capability_grant.source_path=p_source_path and capability_grant.status='active'
     and (capability_grant.expires_at is null or capability_grant.expires_at>v_now)
     and binding.credential_id=v_credential.id and binding.channel='lazada'
     and binding.operation='inquiries.list' and upper(binding.country)=v_country
     and binding.target_fingerprint=capability_grant.binding_target_fingerprint
     and binding.status='active' and (binding.expires_at is null or binding.expires_at>v_now)
   order by capability_grant.verified_at desc limit 1;
  if not found then
    raise exception 'LAZADA_SUPPLEMENTAL_EXACT_PERMISSION_REQUIRED' using errcode='42501';
  end if;
  select progress.* into v_child
    from sellerpilot_private.lazada_supplemental_read_progress progress
   where progress.start_request_id=p_start_request_id
   for update;
  if found then
    if v_child.started_by<>p_actor_id
       or v_child.supersedes_continuation_id<>p_completed_continuation_id
       or v_child.credential_id<>p_credential_id or v_child.country<>v_country
       or v_child.surface<>v_surface or v_child.source_path<>p_source_path
       or v_child.resource_id<>v_resource or v_child.page_size<>p_page_size
       or v_child.grant_id<>v_grant.id
       or not exists(select 1 from sellerpilot_private.lazada_supplemental_read_progress parent
         where parent.continuation_id=v_child.supersedes_continuation_id
           and parent.complete and parent.revision=p_expected_completed_revision) then
      raise exception 'LAZADA_SUPPLEMENTAL_RESYNC_REQUEST_CONFLICT' using errcode='23505';
    end if;
    return jsonb_build_object(
      'contractVersion','sellerpilot-lazada-supplemental-resync-begin/1',
      'startRequestId',p_start_request_id,'continuationId',v_child.continuation_id,
      'completedContinuationId',p_completed_continuation_id,
      'grantId',v_child.grant_id,'credentialId',p_credential_id,
      'sellerAccountKey',v_child.seller_account_key,'country',v_country,'surface',v_surface,
      'sourcePath',p_source_path,'resourceId',v_resource,'pageSize',p_page_size,
      'runNumber',v_child.run_number,'revision',v_child.revision,'pageNumber',v_child.next_page,
      'complete',v_child.complete,
      'replayed',true,'readOnly',true,'mutationAllowed',false
    );
  end if;
  select progress.* into v_parent
    from sellerpilot_private.lazada_supplemental_read_progress progress
   where progress.continuation_id=p_completed_continuation_id
   for update;
  if not found or v_parent.credential_id<>p_credential_id or v_parent.country<>v_country
     or v_parent.surface<>v_surface or v_parent.source_path<>p_source_path
     or v_parent.resource_id<>v_resource or not v_parent.complete
     or v_parent.revision<>p_expected_completed_revision then
    raise exception 'LAZADA_SUPPLEMENTAL_RESYNC_PARENT_MISMATCH' using errcode='42501';
  end if;
  if exists(select 1 from sellerpilot_private.lazada_supplemental_read_progress progress
    where progress.credential_id=p_credential_id and progress.country=v_country
      and progress.surface=v_surface and progress.source_path=p_source_path
      and progress.resource_id=v_resource and progress.run_number>v_parent.run_number) then
    raise exception 'LAZADA_SUPPLEMENTAL_RESYNC_ALREADY_STARTED' using errcode='40001';
  end if;
  insert into sellerpilot_private.lazada_supplemental_read_progress(
    grant_id,credential_id,seller_account_key,country,surface,source_path,resource_id,
    page_size,run_number,supersedes_continuation_id,start_request_id,started_by
  ) values(
    v_grant.id,v_credential.id,v_credential.seller_account_key,v_country,v_surface,p_source_path,
    v_resource,p_page_size,v_parent.run_number+1,v_parent.continuation_id,p_start_request_id,p_actor_id
  ) returning * into v_child;
  return jsonb_build_object(
    'contractVersion','sellerpilot-lazada-supplemental-resync-begin/1',
    'startRequestId',p_start_request_id,'continuationId',v_child.continuation_id,
    'completedContinuationId',p_completed_continuation_id,
    'grantId',v_child.grant_id,'credentialId',p_credential_id,
    'sellerAccountKey',v_child.seller_account_key,'country',v_country,'surface',v_surface,
    'sourcePath',p_source_path,'resourceId',v_resource,'pageSize',p_page_size,
    'runNumber',v_child.run_number,'revision',v_child.revision,'pageNumber',v_child.next_page,
    'complete',false,
    'replayed',false,'readOnly',true,'mutationAllowed',false
  );
end
$$;

alter function public.sellerpilot_service_ingest_and_ack_lazada_supplemental_page_v1(
  uuid,bigint,uuid,text,text,text,text,integer,integer,jsonb,jsonb
) rename to sellerpilot_service_lazada_supplemental_ack_s01;

revoke all on function public.sellerpilot_service_lazada_supplemental_ack_s01(
  uuid,bigint,uuid,text,text,text,text,integer,integer,jsonb,jsonb
) from public,anon,authenticated,service_role;

create function public.sellerpilot_service_ingest_and_ack_lazada_supplemental_page_v1(
  p_continuation_id uuid,
  p_expected_revision bigint,
  p_credential_id uuid,
  p_country text,
  p_surface text,
  p_source_path text,
  p_resource_id text,
  p_page_number integer,
  p_page_size integer,
  p_rows jsonb,
  p_pagination jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  if exists(select 1 from sellerpilot_private.lazada_supplemental_read_progress child
    where child.supersedes_continuation_id=p_continuation_id) then
    raise exception 'LAZADA_SUPPLEMENTAL_SUPERSEDED_CONTINUATION' using errcode='40001';
  end if;
  return public.sellerpilot_service_lazada_supplemental_ack_s01(
    p_continuation_id,p_expected_revision,p_credential_id,p_country,p_surface,p_source_path,
    p_resource_id,p_page_number,p_page_size,p_rows,p_pagination
  );
end
$$;

revoke all on function public.sellerpilot_service_begin_lazada_supplemental_resync_v1(
  uuid,uuid,bigint,uuid,text,text,text,integer,uuid
) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_begin_lazada_supplemental_resync_v1(
  uuid,uuid,bigint,uuid,text,text,text,integer,uuid
) to service_role;
revoke all on function public.sellerpilot_service_ingest_and_ack_lazada_supplemental_page_v1(
  uuid,bigint,uuid,text,text,text,text,integer,integer,jsonb,jsonb
) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_ingest_and_ack_lazada_supplemental_page_v1(
  uuid,bigint,uuid,text,text,text,text,integer,integer,jsonb,jsonb
) to service_role;

comment on function public.sellerpilot_service_begin_lazada_supplemental_resync_v1(
  uuid,uuid,bigint,uuid,text,text,text,integer,uuid
) is 'Creates one new immutable supplemental read round only from an exact completed parent and explicit administrator request.';

notify pgrst,'reload schema';
commit;
