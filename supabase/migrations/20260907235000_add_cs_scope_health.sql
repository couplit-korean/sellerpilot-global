begin;

create function public.sellerpilot_read_cs_scope_health_v1()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_rows jsonb;
begin
 if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
  raise exception 'administrator access required' using errcode='42501';
 end if;
 with credential_base as (
  select credential.id credential_id,credential.channel,credential.status credential_status,
   credential.expires_at,credential.last_checked_at,credential.last_check_status
  from sellerpilot_private.channel_credentials credential
  where credential.environment='production' and credential.status in('active','grace','invalid','revoked')
 ), credential_scopes as (
  select credential.*,null::text shop_id,'conversation'::text ticket_kind
  from credential_base credential where credential.channel<>'temu'
  union all
  select credential.*,null::text shop_id,'after_sales'::text ticket_kind
  from credential_base credential where credential.channel in('shopee','temu')
 ), ticket_scopes as (
  select distinct credential.id credential_id,credential.channel,credential.status credential_status,
   credential.expires_at,credential.last_checked_at,credential.last_check_status,
   coalesce(nullif(ticket.reply_context->>'shopId',''),nullif(ticket.provider_context->>'shopId',''),
    nullif(ticket.provider_context->>'sellerId',''),nullif(ticket.provider_context->>'sellerNo',''),
    nullif(ticket.provider_context->>'accountId','')) shop_id,ticket.ticket_kind
  from sellerpilot_private.support_tickets ticket join sellerpilot_private.channel_credentials credential
   on credential.id=ticket.source_credential_id and credential.channel=ticket.channel_key
  where not ticket.demo and credential.environment='production'
 ), job_scopes as (
  select distinct credential.id credential_id,credential.channel,credential.status credential_status,
   credential.expires_at,credential.last_checked_at,credential.last_check_status,
   coalesce(nullif(job.request_payload#>>'{arguments,shopId}',''),
    nullif(job.response_payload#>>'{steps,0,data,sellerpilotProviderContext,shopId}',''),
    nullif(job.response_payload#>>'{result,steps,0,data,sellerpilotProviderContext,shopId}','')) shop_id,
   case when coalesce(job.request_payload#>>'{arguments,kind}','') in('return_refund','after_sales','return_request','cancel_request','exchange_request')
    then 'after_sales' else 'conversation' end ticket_kind
  from sellerpilot_private.channel_gateway_jobs job
  join sellerpilot_private.channel_credentials credential
   on credential.id=job.credential_id and credential.channel=job.channel
  where job.operation='inquiries.list' and credential.environment='production'
   and coalesce(nullif(job.request_payload#>>'{arguments,shopId}',''),
    nullif(job.response_payload#>>'{steps,0,data,sellerpilotProviderContext,shopId}',''),
    nullif(job.response_payload#>>'{result,steps,0,data,sellerpilotProviderContext,shopId}','')) is not null
 ), scopes as (
  select * from credential_scopes union select * from ticket_scopes union select * from job_scopes
 ), facts as (
  select scope.*,
   (select max(job.created_at) from sellerpilot_private.channel_gateway_jobs job
     where job.credential_id=scope.credential_id and job.channel=scope.channel and job.operation in('inquiries.list','inquiries.reply')
      and case when coalesce(job.request_payload#>>'{arguments,kind}','') in('return_refund','after_sales','return_request','cancel_request','exchange_request')
       then 'after_sales' else 'conversation' end=scope.ticket_kind
      and (scope.shop_id is null or scope.shop_id=coalesce(nullif(job.request_payload#>>'{arguments,shopId}',''),
       nullif(job.response_payload#>>'{steps,0,data,sellerpilotProviderContext,shopId}',''),
       nullif(job.response_payload#>>'{result,steps,0,data,sellerpilotProviderContext,shopId}','')))) last_attempt_at,
   (select max(job.completed_at) from sellerpilot_private.channel_gateway_jobs job
     where job.credential_id=scope.credential_id and job.channel=scope.channel and job.operation='inquiries.list' and job.status='succeeded'
      and case when coalesce(job.request_payload#>>'{arguments,kind}','') in('return_refund','after_sales','return_request','cancel_request','exchange_request')
       then 'after_sales' else 'conversation' end=scope.ticket_kind
      and (scope.shop_id is null or scope.shop_id=coalesce(nullif(job.request_payload#>>'{arguments,shopId}',''),
       nullif(job.response_payload#>>'{steps,0,data,sellerpilotProviderContext,shopId}',''),
       nullif(job.response_payload#>>'{result,steps,0,data,sellerpilotProviderContext,shopId}','')))) last_success_at,
   (select max(message.received_at) from sellerpilot_private.support_inbound_messages message
     join sellerpilot_private.support_tickets ticket on ticket.id=message.ticket_id
     where ticket.source_credential_id=scope.credential_id and ticket.channel_key=scope.channel and ticket.ticket_kind=scope.ticket_kind
      and (scope.shop_id is null or scope.shop_id=coalesce(nullif(ticket.reply_context->>'shopId',''),nullif(ticket.provider_context->>'shopId',''),nullif(ticket.provider_context->>'sellerId',''),nullif(ticket.provider_context->>'sellerNo',''),nullif(ticket.provider_context->>'accountId','')))) last_inbound_at,
   (select min(delivery.queued_at) from sellerpilot_private.support_reply_deliveries delivery
     join sellerpilot_private.support_tickets ticket on ticket.id=delivery.ticket_id
     where ticket.source_credential_id=scope.credential_id and ticket.channel_key=scope.channel
      and ticket.ticket_kind=scope.ticket_kind
      and (scope.shop_id is null or scope.shop_id=coalesce(nullif(ticket.reply_context->>'shopId',''),nullif(ticket.provider_context->>'shopId',''),nullif(ticket.provider_context->>'sellerId',''),nullif(ticket.provider_context->>'sellerNo',''),nullif(ticket.provider_context->>'accountId','')))
      and delivery.status in('queued','running','reconciliation_required')) oldest_pending_at,
   (select count(*)::integer from sellerpilot_private.support_reply_deliveries delivery
     join sellerpilot_private.support_tickets ticket on ticket.id=delivery.ticket_id
     where ticket.source_credential_id=scope.credential_id and ticket.channel_key=scope.channel
      and ticket.ticket_kind=scope.ticket_kind
      and (scope.shop_id is null or scope.shop_id=coalesce(nullif(ticket.reply_context->>'shopId',''),nullif(ticket.provider_context->>'shopId',''),nullif(ticket.provider_context->>'sellerId',''),nullif(ticket.provider_context->>'sellerNo',''),nullif(ticket.provider_context->>'accountId','')))
      and delivery.status in('queued','running')) pending_reply_count,
   (select count(*)::integer from sellerpilot_private.support_reply_deliveries delivery
     join sellerpilot_private.support_tickets ticket on ticket.id=delivery.ticket_id
     where ticket.source_credential_id=scope.credential_id and ticket.channel_key=scope.channel
      and ticket.ticket_kind=scope.ticket_kind
      and (scope.shop_id is null or scope.shop_id=coalesce(nullif(ticket.reply_context->>'shopId',''),nullif(ticket.provider_context->>'shopId',''),nullif(ticket.provider_context->>'sellerId',''),nullif(ticket.provider_context->>'sellerNo',''),nullif(ticket.provider_context->>'accountId','')))
      and delivery.status='reconciliation_required') uncertain_reply_count,
   (select count(*)::integer from sellerpilot_private.cs_history_scan_gaps gap
     join sellerpilot_private.channel_gateway_jobs gap_job on gap_job.id=gap.job_id
     where gap.credential_id=scope.credential_id and gap.channel=scope.channel and gap.resolved_at is null
      and case when coalesce(gap_job.request_payload#>>'{arguments,kind}','') in('return_refund','after_sales','return_request','cancel_request','exchange_request')
       then 'after_sales' else 'conversation' end=scope.ticket_kind) archive_gap_count,
   (select max(budget.next_allowed_at) from sellerpilot_private.provider_rate_budgets budget
     where budget.credential_id=scope.credential_id and budget.channel=scope.channel
      and budget.operation_lane like 'cs_%' and budget.next_allowed_at>statement_timestamp()) rate_limit_retry_at
  from scopes scope
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'channel',channel,'credentialId',credential_id,'shopId',shop_id,'ticketKind',ticket_kind,
  'credentialStatus',credential_status,'credentialExpiresAt',expires_at,'permissionCheckedAt',last_checked_at,
  'permissionStatus',coalesce(last_check_status,'unverified'),'lastAttemptAt',last_attempt_at,
  'lastSuccessAt',last_success_at,'lastInboundAt',last_inbound_at,'oldestPendingAt',oldest_pending_at,
  'queueAgeSeconds',case when oldest_pending_at is null then null else greatest(0,extract(epoch from(statement_timestamp()-oldest_pending_at))::bigint) end,
  'pendingReplyCount',pending_reply_count,'uncertainReplyCount',uncertain_reply_count,
  'archiveGapCount',archive_gap_count,'rateLimitRetryAt',rate_limit_retry_at,
  'zeroResultIsComplete',false,
  'state',case when credential_status<>'active' or (expires_at is not null and expires_at<=statement_timestamp())
    or uncertain_reply_count>0 or archive_gap_count>0 then 'needs_attention'
    when last_success_at is null then 'unverified'
    when last_inbound_at is null then 'zero_unverified'
    else 'observed' end
 ) order by channel,credential_id,shop_id nulls first,ticket_kind),'[]'::jsonb) into v_rows from facts;
 return jsonb_build_object('contract','sellerpilot-cs-scope-health/1','checkedAt',statement_timestamp(),'scopes',v_rows);
end$$;

revoke all on function public.sellerpilot_read_cs_scope_health_v1() from public,anon,service_role;
grant execute on function public.sellerpilot_read_cs_scope_health_v1() to authenticated;
notify pgrst,'reload schema';
commit;
