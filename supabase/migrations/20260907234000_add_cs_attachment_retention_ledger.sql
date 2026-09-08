begin;

create table sellerpilot_private.cs_attachment_evidence (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references sellerpilot_private.support_inbound_messages(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('qoo10','shopee','lazada','coupang','elevenst','smartstore','ebay','temu')),
  source_url text not null check (length(source_url) between 9 and 8000),
  source_url_digest text not null check (source_url_digest ~ '^[a-f0-9]{64}$'),
  source_expires_at timestamptz,
  retention_policy text not null default 'provider_url_only'
    check (retention_policy in ('provider_url_only','metadata_only','private_copy')),
  recovery_policy text not null default 'refresh_channel_history'
    check (recovery_policy in ('refresh_channel_history','provider_url_unrecoverable','private_copy')),
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(message_id,source_url_digest)
);

create index cs_attachment_evidence_owner_health_idx
  on sellerpilot_private.cs_attachment_evidence(owner_id,channel,source_expires_at,last_observed_at);
alter table sellerpilot_private.cs_attachment_evidence enable row level security;
revoke all on sellerpilot_private.cs_attachment_evidence from public,anon,authenticated,service_role;

create function sellerpilot_private.replace_cs_attachment_evidence(
  p_message_id uuid,p_owner_id uuid,p_channel text,p_provider_context jsonb,p_observed_at timestamptz
)
returns void language plpgsql security definer set search_path='' as $$
declare v_url text;v_match text[];v_expiry timestamptz;v_now timestamptz:=clock_timestamp();
begin
  delete from sellerpilot_private.cs_attachment_evidence evidence where evidence.message_id=p_message_id;
  if jsonb_typeof(p_provider_context->'nativeMedia')<>'object' then return;end if;
  for v_url in select distinct item.value#>>'{}'
    from jsonb_path_query(p_provider_context->'nativeMedia','$.** ? (@.type() == "string")') item(value)
   where length(item.value#>>'{}') between 9 and 8000
     and item.value#>>'{}' ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/|$)'
   order by 1 limit 20
  loop
    v_match:=regexp_match(v_url,'[?&](expires|expiry|x-oss-expires)=([0-9]{10})([&#]|$)','i');
    v_expiry:=case when v_match is not null then to_timestamp((v_match[2])::double precision) else null end;
    insert into sellerpilot_private.cs_attachment_evidence(
      message_id,owner_id,channel,source_url,source_url_digest,source_expires_at,
      retention_policy,recovery_policy,first_observed_at,last_observed_at,updated_at
    ) values(
      p_message_id,p_owner_id,p_channel,v_url,
      encode(extensions.digest(v_url,'sha256'),'hex'),v_expiry,'provider_url_only',
      case when v_expiry is not null and v_expiry<=v_now then 'refresh_channel_history'
        else 'provider_url_unrecoverable' end,
      coalesce(p_observed_at,v_now),coalesce(p_observed_at,v_now),v_now
    );
  end loop;
end$$;
revoke all on function sellerpilot_private.replace_cs_attachment_evidence(uuid,uuid,text,jsonb,timestamptz)
 from public,anon,authenticated,service_role;

create function sellerpilot_private.capture_cs_attachment_evidence()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform sellerpilot_private.replace_cs_attachment_evidence(
  new.id,new.owner_id,new.channel_key,new.provider_context,coalesce(new.updated_at,new.created_at,clock_timestamp())
 );
 return new;
end$$;
revoke all on function sellerpilot_private.capture_cs_attachment_evidence()
 from public,anon,authenticated,service_role;

create trigger sellerpilot_capture_cs_attachment_evidence
after insert or update of provider_context on sellerpilot_private.support_inbound_messages
for each row execute function sellerpilot_private.capture_cs_attachment_evidence();

select sellerpilot_private.replace_cs_attachment_evidence(
 message.id,message.owner_id,message.channel_key,message.provider_context,
 coalesce(message.updated_at,message.created_at,clock_timestamp())
)
from sellerpilot_private.support_inbound_messages message
where jsonb_typeof(message.provider_context->'nativeMedia')='object';

create function public.sellerpilot_read_cs_attachment_health_v1()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_rows jsonb;
begin
 if auth.uid() is null or not public.sellerpilot_is_admin() then
  raise exception 'administrator access required' using errcode='42501';
 end if;
 with channels(channel) as (values('qoo10'),('shopee'),('lazada'),('coupang'),('elevenst'),('smartstore'),('ebay'),('temu')),
 counts as (
  select evidence.channel,count(*)::integer total,
   count(*) filter(where evidence.source_expires_at is not null and evidence.source_expires_at<=statement_timestamp())::integer expired,
   count(*) filter(where evidence.source_expires_at is null)::integer expiry_unknown
  from sellerpilot_private.cs_attachment_evidence evidence where evidence.owner_id=auth.uid()
  group by evidence.channel
 )
 select jsonb_agg(jsonb_build_object(
  'channel',channels.channel,'retentionPolicy','provider_url_only','privateCopyImplemented',false,
  'refreshSupport',case when channels.channel in('ebay','shopee','lazada') then 'conditional_history_refresh' else 'unverified_or_unavailable' end,
  'total',coalesce(counts.total,0),'expired',coalesce(counts.expired,0),'expiryUnknown',coalesce(counts.expiry_unknown,0)
 ) order by channels.channel) into v_rows from channels left join counts using(channel);
 return jsonb_build_object('contract','sellerpilot-cs-attachment-health/1','attachments',v_rows,'checkedAt',statement_timestamp());
end$$;
revoke all on function public.sellerpilot_read_cs_attachment_health_v1() from public,anon,service_role;
grant execute on function public.sellerpilot_read_cs_attachment_health_v1() to authenticated;

comment on table sellerpilot_private.cs_attachment_evidence is
 'Private CS attachment URL retention evidence. It does not claim that provider bytes were copied.';
notify pgrst,'reload schema';
commit;
