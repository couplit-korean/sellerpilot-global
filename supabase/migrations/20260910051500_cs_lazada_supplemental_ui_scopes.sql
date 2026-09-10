-- Authenticated administrator projection for explicit Lazada supplemental read controls.
-- This migration exposes no secret, grant writer, provider call, automatic polling or reply operation.
begin;

do $$
begin
  if to_regclass('sellerpilot_private.lazada_supplemental_read_progress') is null
     or to_regclass('sellerpilot_private.lazada_supplemental_read_grants') is null
     or to_regclass('sellerpilot_private.lazada_supplemental_cs_events') is null
     or to_regprocedure('public.sellerpilot_is_admin()') is null then
    raise exception 'LAZADA_SUPPLEMENTAL_UI_PREIMAGE_MISSING';
  end if;
  if to_regprocedure('public.sellerpilot_list_lazada_supplemental_ui_scopes_v1()') is not null
     or to_regprocedure('public.sellerpilot_read_lazada_supplemental_ui_scope_v1(uuid,text,text,text,integer)') is not null then
    raise exception 'LAZADA_SUPPLEMENTAL_UI_ALREADY_INSTALLED';
  end if;
end
$$;

create function public.sellerpilot_list_lazada_supplemental_ui_scopes_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_accounts jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(account_value order by label,credential_id),'[]'::jsonb)
    into v_accounts
    from(
      select credential.id credential_id,
             concat('Lazada 운영 v',credential.version,' · ',credential.fingerprint) label,
             jsonb_build_object(
               'credentialId',credential.id,
               'label',concat('Lazada 운영 v',credential.version,' · ',credential.fingerprint),
               'scopes',(
                 select coalesce(jsonb_agg(jsonb_build_object(
                   'country',scope.country,
                   'surface',scope.surface,
                   'sourcePath',scope.source_path,
                   'permissionState',case when exists(
                     select 1 from sellerpilot_private.lazada_supplemental_read_grants capability_grant
                     join sellerpilot_private.cs_credential_capability_bindings current_binding
                       on current_binding.id=capability_grant.binding_id
                      where capability_grant.credential_id=credential.id
                        and capability_grant.seller_account_key=credential.seller_account_key
                        and capability_grant.country=scope.country
                        and capability_grant.surface=scope.surface
                        and capability_grant.source_path=scope.source_path
                        and capability_grant.verification_source='lazada_app_permission_readback'
                        and capability_grant.status='active'
                        and (capability_grant.expires_at is null or capability_grant.expires_at>clock_timestamp())
                        and current_binding.credential_id=credential.id
                        and current_binding.channel='lazada'
                        and current_binding.operation='inquiries.list'
                        and upper(current_binding.country)=scope.country
                        and current_binding.target_fingerprint=capability_grant.binding_target_fingerprint
                        and current_binding.status='active'
                        and (current_binding.expires_at is null or current_binding.expires_at>clock_timestamp())
                   ) then 'authorized' else 'permission_pending' end,
                   'resourceRequired',scope.source_path<>'/reverse/getreverseordersforseller',
                   'resourceLabel',case scope.source_path
                     when '/review/seller/list' then 'Lazada 상품 Item ID'
                     when '/reverse/getreverseordersforseller' then '전체 목록'
                     when '/order/reverse/return/detail/list' then 'Reverse Order ID'
                     else 'Reverse Order Line ID' end,
                   'message',case when exists(
                     select 1 from sellerpilot_private.lazada_supplemental_read_grants capability_grant
                     join sellerpilot_private.cs_credential_capability_bindings current_binding
                       on current_binding.id=capability_grant.binding_id
                      where capability_grant.credential_id=credential.id
                        and capability_grant.seller_account_key=credential.seller_account_key
                        and capability_grant.country=scope.country
                        and capability_grant.surface=scope.surface
                        and capability_grant.source_path=scope.source_path
                        and capability_grant.verification_source='lazada_app_permission_readback'
                        and capability_grant.status='active'
                        and (capability_grant.expires_at is null or capability_grant.expires_at>clock_timestamp())
                        and current_binding.credential_id=credential.id
                        and current_binding.channel='lazada'
                        and current_binding.operation='inquiries.list'
                        and upper(current_binding.country)=scope.country
                        and current_binding.target_fingerprint=capability_grant.binding_target_fingerprint
                        and current_binding.status='active'
                        and (current_binding.expires_at is null or current_binding.expires_at>clock_timestamp())
                   ) then '현재 계정·국가·조회 경로의 별도 provider 권한 증거가 유효합니다.'
                   else '현재 계정·국가·조회 경로의 별도 provider 권한 증거가 없어 실행할 수 없습니다.' end
                 ) order by scope.country,scope.surface,scope.source_path),'[]'::jsonb)
                 from(
                   select distinct upper(binding.country) country,path.surface,path.source_path
                     from sellerpilot_private.cs_credential_capability_bindings binding
                     cross join(values
                       ('product_review','/review/seller/list'),
                       ('reverse_order_after_sales','/reverse/getreverseordersforseller'),
                       ('reverse_order_after_sales','/order/reverse/return/detail/list'),
                       ('reverse_order_after_sales','/order/reverse/return/history/list')
                     ) path(surface,source_path)
                    where binding.credential_id=credential.id
                      and binding.channel='lazada' and binding.operation='inquiries.list'
                      and upper(binding.country) in('SG','MY','TH','VN','ID','PH')
                      and binding.status='active'
                      and (binding.expires_at is null or binding.expires_at>clock_timestamp())
                 ) scope
               )
             ) account_value
        from sellerpilot_private.channel_credentials credential
       where credential.channel='lazada' and credential.environment='production'
         and credential.status='active'
         and (credential.expires_at is null or credential.expires_at>clock_timestamp())
         and credential.seller_account_key ~ '^[a-f0-9]{64}$'
         and credential.seller_account_key_source='provider_certified_v1'
         and credential.seller_account_verified_at is not null
         and exists(select 1 from sellerpilot_private.cs_credential_capability_bindings binding
           where binding.credential_id=credential.id and binding.channel='lazada'
             and binding.operation='inquiries.list' and binding.status='active'
             and (binding.expires_at is null or binding.expires_at>clock_timestamp()))
    ) accounts;

  return jsonb_build_object(
    'contractVersion','sellerpilot-lazada-supplemental-ui-scopes/1',
    'checkedAt',clock_timestamp(),
    'accounts',v_accounts,
    'automaticReadEnabled',false,
    'replyEnabled',false,
    'mutationAllowed',false
  );
end
$$;

create function public.sellerpilot_read_lazada_supplemental_ui_scope_v1(
  p_credential_id uuid,
  p_country text,
  p_source_path text,
  p_resource_id text,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_country text:=upper(trim(coalesce(p_country,'')));
  v_resource text:=trim(coalesce(p_resource_id,''));
  v_surface text;
  v_credential record;
  v_progress record;
  v_parent_revision bigint;
  v_permission text;
  v_events jsonb;
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  v_surface:=case p_source_path when '/review/seller/list' then 'product_review'
    when '/reverse/getreverseordersforseller' then 'reverse_order_after_sales'
    when '/order/reverse/return/detail/list' then 'reverse_order_after_sales'
    when '/order/reverse/return/history/list' then 'reverse_order_after_sales' else null end;
  if p_credential_id is null or v_country not in('SG','MY','TH','VN','ID','PH')
     or v_surface is null or p_limit is null or p_limit not between 1 and 50
     or length(v_resource)>32 or (v_resource<>'' and v_resource !~ '^[1-9][0-9]{0,31}$')
     or (p_source_path<>'/reverse/getreverseordersforseller' and v_resource='') then
    raise exception 'LAZADA_SUPPLEMENTAL_UI_SCOPE_INVALID' using errcode='22023';
  end if;
  select credential.id,credential.version,credential.fingerprint,credential.seller_account_key
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id=p_credential_id and credential.channel='lazada'
     and credential.environment='production' and credential.status='active'
     and (credential.expires_at is null or credential.expires_at>clock_timestamp())
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source='provider_certified_v1'
     and credential.seller_account_verified_at is not null
     and exists(select 1 from sellerpilot_private.cs_credential_capability_bindings binding
       where binding.credential_id=credential.id and binding.channel='lazada'
         and binding.operation='inquiries.list' and upper(binding.country)=v_country
         and binding.status='active'
         and (binding.expires_at is null or binding.expires_at>clock_timestamp()));
  if not found then
    raise exception 'LAZADA_SUPPLEMENTAL_UI_SCOPE_UNAVAILABLE' using errcode='42501';
  end if;
  v_permission:=case when exists(
    select 1 from sellerpilot_private.lazada_supplemental_read_grants capability_grant
    join sellerpilot_private.cs_credential_capability_bindings current_binding
      on current_binding.id=capability_grant.binding_id
     where capability_grant.credential_id=v_credential.id
       and capability_grant.seller_account_key=v_credential.seller_account_key
       and capability_grant.country=v_country and capability_grant.surface=v_surface
       and capability_grant.source_path=p_source_path
       and capability_grant.verification_source='lazada_app_permission_readback'
       and capability_grant.status='active'
       and (capability_grant.expires_at is null or capability_grant.expires_at>clock_timestamp())
       and current_binding.credential_id=v_credential.id
       and current_binding.channel='lazada'
       and current_binding.operation='inquiries.list'
       and upper(current_binding.country)=v_country
       and current_binding.target_fingerprint=capability_grant.binding_target_fingerprint
       and current_binding.status='active'
       and (current_binding.expires_at is null or current_binding.expires_at>clock_timestamp())
  ) then 'authorized' else 'permission_pending' end;

  select progress.* into v_progress
    from sellerpilot_private.lazada_supplemental_read_progress progress
   where progress.credential_id=v_credential.id and progress.country=v_country
     and progress.surface=v_surface and progress.source_path=p_source_path
     and progress.resource_id=v_resource
   order by progress.run_number desc limit 1;
  if found and v_progress.supersedes_continuation_id is not null then
    select parent.revision into v_parent_revision
      from sellerpilot_private.lazada_supplemental_read_progress parent
     where parent.continuation_id=v_progress.supersedes_continuation_id;
  end if;

  select coalesce(jsonb_agg(event_value order by occurred_at desc,event_key desc),'[]'::jsonb)
    into v_events
    from(
      select event.occurred_at,event.event_key,jsonb_build_object(
        'credentialId',event.credential_id,'country',event.country,
        'surface',event.surface,'sourcePath',event.source_path,
        'resourceKey',event.resource_key,'eventKey',event.event_key,
        'status',event.status,'title',event.title,'body',event.body,
        'externalOrderId',event.external_order_id,'externalItemId',event.external_item_id,
        'rating',event.rating,'occurredAt',event.occurred_at,'observedAt',event.observed_at,
        'providerContext',event.provider_context
      ) event_value
        from sellerpilot_private.lazada_supplemental_cs_events event
       where event.credential_id=v_credential.id and event.country=v_country
         and event.surface=v_surface and event.source_path=p_source_path
         and (p_source_path='/reverse/getreverseordersforseller'
           or p_source_path='/order/reverse/return/history/list'
             and (event.resource_key=v_resource
               or event.provider_context->>'reverseOrderLineId'=v_resource)
           or p_source_path='/review/seller/list' and event.provider_context->>'itemId'=v_resource
           or p_source_path='/order/reverse/return/detail/list'
             and (event.provider_context->>'reverseOrderId'=v_resource or event.resource_key=v_resource))
       order by event.occurred_at desc,event.event_key desc
       limit p_limit
    ) selected;

  return jsonb_build_object(
    'contractVersion','sellerpilot-lazada-supplemental-ui-scope/1',
    'checkedAt',clock_timestamp(),
    'credentialId',v_credential.id,
    'accountLabel',concat('Lazada 운영 v',v_credential.version,' · ',v_credential.fingerprint),
    'country',v_country,'surface',v_surface,'sourcePath',p_source_path,
    'resourceId',v_resource,'permissionState',v_permission,
    'progress',case when v_progress.continuation_id is null then null else jsonb_build_object(
      'continuationId',v_progress.continuation_id,'revision',v_progress.revision,
      'pageNumber',v_progress.next_page,'runNumber',v_progress.run_number,
      'complete',v_progress.complete,'startRequestId',v_progress.start_request_id,
      'parentContinuationId',v_progress.supersedes_continuation_id,
      'parentRevision',v_parent_revision,'updatedAt',v_progress.updated_at
    ) end,
    'events',v_events,
    'automaticReadEnabled',false,'replyEnabled',false,'mutationAllowed',false
  );
end
$$;

revoke all on function public.sellerpilot_list_lazada_supplemental_ui_scopes_v1()
  from public,anon,service_role;
grant execute on function public.sellerpilot_list_lazada_supplemental_ui_scopes_v1()
  to authenticated;
revoke all on function public.sellerpilot_read_lazada_supplemental_ui_scope_v1(uuid,text,text,text,integer)
  from public,anon,service_role;
grant execute on function public.sellerpilot_read_lazada_supplemental_ui_scope_v1(uuid,text,text,text,integer)
  to authenticated;

comment on function public.sellerpilot_list_lazada_supplemental_ui_scopes_v1() is
  'Safe shared-admin Lazada account, country, source-path and permission-state projection for explicit UI reads.';
comment on function public.sellerpilot_read_lazada_supplemental_ui_scope_v1(uuid,text,text,text,integer) is
  'Read-only exact-scope progress and canonical supplemental ledger projection. No provider or commerce mutation.';

notify pgrst,'reload schema';
commit;
