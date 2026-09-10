begin;

create table sellerpilot_private.cs_credential_capability_bindings(
 id uuid primary key default gen_random_uuid(),credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete cascade,
 channel text not null,operation text not null check(operation in('inquiries.list','inquiries.reply')),
 country text not null check(length(country) between 1 and 40 and country ~ '^[A-Z0-9_-]+$'),
 app_fingerprint text not null check(app_fingerprint~'^[a-f0-9]{64}$'),token_fingerprint text not null check(token_fingerprint~'^[a-f0-9]{64}$'),
 target_fingerprint text not null check(target_fingerprint~'^[a-f0-9]{64}$'),status text not null default'active' check(status in('active','superseded','revoked','expired')),
 verified_job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
 verified_at timestamptz not null,expires_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(credential_id,operation,country,app_fingerprint,token_fingerprint,target_fingerprint)
);
create index cs_credential_capability_bindings_health_idx on sellerpilot_private.cs_credential_capability_bindings(credential_id,status,operation,updated_at desc);
alter table sellerpilot_private.cs_credential_capability_bindings enable row level security;
revoke all on sellerpilot_private.cs_credential_capability_bindings from public,anon,authenticated,service_role;

create function public.sellerpilot_service_record_cs_credential_binding_v1(p_token_hash text,p_job_id uuid,p_claim_token uuid,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job sellerpilot_private.channel_gateway_jobs%rowtype;v_credential sellerpilot_private.channel_credentials%rowtype;v_target text;v_count integer:=0;v_now timestamptz:=clock_timestamp();
begin
 if not exists(select 1 from sellerpilot_private.ai_cli_worker_tokens token where token.token_hash=p_token_hash and token.scope='gateway' and token.status='active' and token.expires_at>v_now)
  then raise exception'invalid worker token'using errcode='42501';end if;
 select job.* into v_job from sellerpilot_private.channel_gateway_jobs job join sellerpilot_private.gateway_completion_receipts receipt
  on receipt.job_id=job.id and receipt.claim_token=p_claim_token
  where job.id=p_job_id and job.status='succeeded' and job.operation in('inquiries.list','inquiries.reply');
 if not found then raise exception'CS_BINDING_COMPLETION_REQUIRED';end if;
 select*into v_credential from sellerpilot_private.channel_credentials credential where credential.id=v_job.credential_id and credential.channel=v_job.channel;
 if not found then raise exception'CS_BINDING_CREDENTIAL_REQUIRED';end if;
 if jsonb_typeof(p_evidence)<>'object' or p_evidence->>'contract'<>'sellerpilot-cs-credential-binding/1'
  or p_evidence->>'channel'<>v_job.channel or p_evidence->>'operation'<>v_job.operation
  or coalesce(p_evidence->>'appFingerprint','')!~'^[a-f0-9]{64}$' or coalesce(p_evidence->>'tokenFingerprint','')!~'^[a-f0-9]{64}$'
  or coalesce(p_evidence->>'country','')!~'^[A-Z0-9_-]{1,40}$' or jsonb_typeof(p_evidence->'targetFingerprints')<>'array'
  or jsonb_array_length(p_evidence->'targetFingerprints')not between 1 and 100 then raise exception'CS_BINDING_EVIDENCE_INVALID';end if;
 update sellerpilot_private.cs_credential_capability_bindings binding set status='superseded',updated_at=v_now
  where binding.credential_id=v_credential.id and binding.operation=v_job.operation and binding.status='active'
   and(binding.app_fingerprint<>p_evidence->>'appFingerprint' or binding.token_fingerprint<>p_evidence->>'tokenFingerprint');
 for v_target in select distinct value#>>'{}' from jsonb_array_elements(p_evidence->'targetFingerprints') item(value) loop
  if v_target!~'^[a-f0-9]{64}$'then raise exception'CS_BINDING_TARGET_INVALID';end if;
  insert into sellerpilot_private.cs_credential_capability_bindings(credential_id,channel,operation,country,app_fingerprint,token_fingerprint,target_fingerprint,status,verified_job_id,verified_at,expires_at,updated_at)
  values(v_credential.id,v_job.channel,v_job.operation,p_evidence->>'country',p_evidence->>'appFingerprint',p_evidence->>'tokenFingerprint',v_target,
   case when v_credential.status='active' and(v_credential.expires_at is null or v_credential.expires_at>v_now)then'active' when v_credential.expires_at<=v_now then'expired'else'revoked'end,
   v_job.id,v_now,v_credential.expires_at,v_now)
  on conflict(credential_id,operation,country,app_fingerprint,token_fingerprint,target_fingerprint)do update set
   status=excluded.status,verified_job_id=excluded.verified_job_id,verified_at=excluded.verified_at,expires_at=excluded.expires_at,updated_at=v_now;
  v_count:=v_count+1;
 end loop;
 return jsonb_build_object('contract','sellerpilot-cs-credential-binding/1','status','recorded','bindingCount',v_count);
end$$;
revoke all on function public.sellerpilot_service_record_cs_credential_binding_v1(text,uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.sellerpilot_service_record_cs_credential_binding_v1(text,uuid,uuid,jsonb)to service_role;

create function sellerpilot_private.expire_cs_credential_bindings() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.status<>'active' or(new.expires_at is not null and new.expires_at<=clock_timestamp())then
  update sellerpilot_private.cs_credential_capability_bindings set status=case when new.expires_at is not null and new.expires_at<=clock_timestamp()then'expired'else'revoked'end,updated_at=clock_timestamp()
   where credential_id=new.id and status='active';
 end if;return new;
end $$;
revoke all on function sellerpilot_private.expire_cs_credential_bindings()from public,anon,authenticated,service_role;
create trigger sellerpilot_expire_cs_credential_bindings after update of status,expires_at on sellerpilot_private.channel_credentials for each row execute function sellerpilot_private.expire_cs_credential_bindings();

create function public.sellerpilot_read_cs_credential_bindings_v1() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_rows jsonb;begin
 if auth.uid()is null or public.sellerpilot_is_admin()is distinct from true then raise exception'administrator access required'using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('credentialId',credential.id,'channel',credential.channel,'credentialFingerprint',credential.fingerprint,
  'sellerAccountBinding',case when credential.seller_account_key_source='provider_certified_v1'and credential.seller_account_verified_at is not null then'provider_certified'else'unverified'end,
  'credentialStatus',credential.status,'credentialExpiresAt',credential.expires_at,'operation',binding.operation,'country',binding.country,
  'appFingerprint',binding.app_fingerprint,'tokenFingerprint',binding.token_fingerprint,'targetFingerprint',binding.target_fingerprint,
  'bindingStatus',coalesce(binding.status,'unverified'),'verifiedAt',binding.verified_at)order by credential.channel,credential.id,binding.operation,binding.target_fingerprint),'[]'::jsonb)
 into v_rows from sellerpilot_private.channel_credentials credential left join sellerpilot_private.cs_credential_capability_bindings binding on binding.credential_id=credential.id
 where credential.environment='production';
 return jsonb_build_object('contract','sellerpilot-cs-credential-bindings-read/1','checkedAt',statement_timestamp(),'bindings',v_rows);
end $$;
revoke all on function public.sellerpilot_read_cs_credential_bindings_v1()from public,anon,service_role;
grant execute on function public.sellerpilot_read_cs_credential_bindings_v1()to authenticated;
notify pgrst,'reload schema';commit;
