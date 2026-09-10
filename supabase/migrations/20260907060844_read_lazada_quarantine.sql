-- Approved administrators share one operations workspace. Read-only access to
-- bounded quarantine is not promotion to a ticket, a reply, or provider ACK.
begin;
do $$
begin
  if not exists(select 1 from pg_proc where oid=to_regprocedure('public.sellerpilot_is_admin()')
    and encode(sha256(convert_to(prosrc,'UTF8')),'hex')='46867f0998ac5b1d3f02f000c50c6c2303ea7b7a35e527801543889b65209de5'
    and prosecdef and proowner='postgres'::regrole) then
    raise exception 'CS_QUARANTINE_ADMIN_POLICY_REVIEW_REQUIRED';
  end if;
end $$;

create function public.sellerpilot_read_lazada_quarantine(
  p_before_time timestamptz default null, p_before_key text default null,
  p_as_of timestamptz default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_as_of timestamptz := coalesce(p_as_of,statement_timestamp()); v_rows jsonb;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator required' using errcode='42501';
  end if;
  if (p_before_time is null) <> (p_before_key is null)
     or (p_before_key is not null and (p_before_key !~ '^[a-f0-9]{64}$' or p_as_of is null))
     or not isfinite(v_as_of) or v_as_of>statement_timestamp()
     or (p_before_time is not null and (not isfinite(p_before_time) or p_before_time>v_as_of)) then
    raise exception 'invalid quarantine cursor' using errcode='22023';
  end if;
  with available as (
    select q.*,encode(sha256(convert_to(jsonb_build_array(q.owner_id,q.seller_account_key,
      q.external_ticket_id,q.remote_message_id,q.body_digest,q.sender_role)::text,'UTF8')),'hex') row_key,
      coalesce(d.conflicted,false) conflicted
    from sellerpilot_private.lazada_unordered_messages q
    left join sellerpilot_private.lazada_unordered_dedup d on d.owner_id=q.owner_id
      and d.identity_digest=encode(sha256(convert_to(jsonb_build_array(q.owner_id,q.seller_account_key,q.external_ticket_id,q.remote_message_id)::text,'UTF8')),'hex')
    where q.observed_at<=v_as_of and q.expires_at>statement_timestamp()
      -- Unknown send evidence cannot prove this is later than deletion.
      and not exists(select 1 from sellerpilot_private.support_ticket_deletions x
        where x.owner_id=q.owner_id and x.channel_key='lazada'
          and x.external_ticket_fingerprint=sellerpilot_private.support_deletion_fingerprint(q.owner_id,'lazada',q.external_ticket_id))
  ), bounded as (
    select * from available where p_before_time is null or (observed_at,row_key)<(p_before_time,p_before_key)
    order by observed_at desc,row_key desc limit 26
  )
  select coalesce(jsonb_agg(jsonb_build_object('key',row_key,'sessionId',external_ticket_id,
    'messageId',remote_message_id,'body',body,'senderRole',sender_role,'observedAt',observed_at,
    'expiresAt',expires_at,'reason',case when conflicted then 'conflict' else 'unverified' end)
    order by observed_at desc,row_key desc),'[]'::jsonb) into v_rows from bounded;
  return jsonb_build_object('contract','lazada_quarantine_read_v1','asOf',v_as_of,
    'messages',case when jsonb_array_length(v_rows)>25 then v_rows-25 else v_rows end,
    'nextCursor',case when jsonb_array_length(v_rows)>25 then jsonb_build_object(
      'beforeTime',v_rows->24->>'observedAt','beforeKey',v_rows->24->>'key','asOf',v_as_of) else null end);
end $$;
revoke all on function public.sellerpilot_read_lazada_quarantine(timestamptz,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_read_lazada_quarantine(timestamptz,text,timestamptz) to authenticated;
commit;
