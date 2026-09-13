begin;
create function public.sellerpilot_service_local_cs_schedule_channels()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if current_setting('role',true) is distinct from 'service_role' then
  raise exception 'service role required' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(channel order by channel),'[]'::jsonb) from (
  select distinct r.channel
  from sellerpilot_private.local_channel_executor_routes r
  join sellerpilot_private.channel_credentials c on c.id=r.credential_id
   and c.channel=r.channel and c.created_by=r.owner_id and c.seller_account_key=r.seller_account_key
   and c.status='active' and c.environment='production'
   and (c.expires_at is null or c.expires_at>now())
  join sellerpilot_private.ai_cli_worker_tokens t on t.id=r.worker_token_id
   and t.scope='gateway' and t.status='active' and t.expires_at>now()
  where r.channel in('coupang','smartstore','elevenst','temu','shopee','lazada')
   and r.operation='inquiries.list' and r.enabled
   and r.approved_by is not null and r.approved_at is not null
   and (r.expires_at is null or r.expires_at>now())
   and r.release_sha=sellerpilot_private.active_serverless_runtime_release_sha()
   and r.egress_ip_sha256 ~ '^[a-f0-9]{64}$'
 ) admitted);
end $$;
revoke all on function public.sellerpilot_service_local_cs_schedule_channels() from public,anon,authenticated;
grant execute on function public.sellerpilot_service_local_cs_schedule_channels() to service_role;
notify pgrst,'reload schema';
commit;
