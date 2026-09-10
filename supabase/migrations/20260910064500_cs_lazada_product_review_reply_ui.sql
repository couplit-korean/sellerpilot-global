-- Admin UI projection for the exact Lazada product-review reply permission.
begin;

do $$ begin
  if to_regclass('sellerpilot_private.lazada_product_review_reply_grants') is null
     or to_regclass('sellerpilot_private.lazada_product_review_reply_deliveries') is null
     or to_regprocedure('public.sellerpilot_is_admin()') is null then
    raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_UI_PREIMAGE_MISSING';
  end if;
end $$;

create function public.sellerpilot_get_lazada_product_review_reply_capability_v1(
  p_credential_id uuid,
  p_country text
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_country text:=upper(trim(coalesce(p_country,'')));
  v_authorized boolean:=false;
  v_now timestamptz:=clock_timestamp();
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode='42501';
  end if;
  if p_credential_id is null or v_country not in('SG','MY','TH','VN','ID','PH') then
    raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_CAPABILITY_INVALID' using errcode='22023';
  end if;
  select true into v_authorized
    from sellerpilot_private.channel_credentials credential
    join sellerpilot_private.lazada_product_review_reply_grants capability
      on capability.credential_id=credential.id and capability.country=v_country
    join sellerpilot_private.cs_credential_capability_bindings binding
      on binding.id=capability.binding_id
   where credential.id=p_credential_id and credential.channel='lazada'
     and credential.environment='production' and credential.status='active'
     and (credential.expires_at is null or credential.expires_at>v_now)
     and credential.seller_account_key=capability.seller_account_key
     and credential.seller_account_key_source='provider_certified_v1'
     and credential.seller_account_verified_at is not null
     and capability.reply_path='/review/seller/reply/add'
     and capability.readback_path='/review/seller/list/v2'
     and capability.verification_source='lazada_app_permission_readback'
     and capability.status='active'
     and (capability.expires_at is null or capability.expires_at>v_now)
     and binding.credential_id=credential.id and binding.channel='lazada'
     and binding.operation='inquiries.reply' and upper(binding.country)=v_country
     and binding.status='active' and (binding.expires_at is null or binding.expires_at>v_now)
   limit 1;
  return jsonb_build_object(
    'contract','sellerpilot-lazada-product-review-reply-capability/1',
    'credentialId',p_credential_id,'country',v_country,
    'permissionState',case when coalesce(v_authorized,false) then 'authorized' else 'permission_pending' end,
    'replyPath','/review/seller/reply/add','readbackPath','/review/seller/list/v2',
    'automaticReplyEnabled',false
  );
end $$;

revoke all on function public.sellerpilot_get_lazada_product_review_reply_capability_v1(uuid,text)
  from public,anon,service_role;
grant execute on function public.sellerpilot_get_lazada_product_review_reply_capability_v1(uuid,text)
  to authenticated;

notify pgrst,'reload schema';
commit;
