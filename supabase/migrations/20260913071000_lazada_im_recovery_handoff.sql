begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
create table sellerpilot_private.lazada_im_recovery_handoffs(
 source_job_id uuid primary key references sellerpilot_private.channel_gateway_jobs(id),
 next_job_id uuid not null unique references sellerpilot_private.channel_gateway_jobs(id),
 credential_id uuid not null references sellerpilot_private.channel_credentials(id),
 source_payload_sha256 text not null check(source_payload_sha256 ~ '^[a-f0-9]{64}$'),
 recovery_payload_sha256 text not null check(recovery_payload_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp()
);
alter table sellerpilot_private.lazada_im_recovery_handoffs enable row level security;
revoke all on sellerpilot_private.lazada_im_recovery_handoffs from public,anon,authenticated,service_role;

create function sellerpilot_private.lazada_im_recoverable_payload(p_source_job_id uuid,p_credential_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j sellerpilot_private.channel_gateway_jobs%rowtype;c sellerpilot_private.channel_credentials%rowtype;b jsonb;r jsonb;bb jsonb;rr jsonb;im jsonb;
begin
 select * into j from sellerpilot_private.channel_gateway_jobs where id=p_source_job_id;
 select * into c from sellerpilot_private.channel_credentials where id=p_credential_id;
 if j.id is null or c.id is null or j.credential_id<>c.id or j.channel<>'lazada' or j.operation<>'diagnostic.test'
  or j.status not in('reconciliation_required','cancelled') or j.environment<>'production'
  or j.request_payload#>'{arguments,lazadaImCapabilityProbe}' is distinct from 'true'::jsonb
  or j.credential_refresh_in_flight or j.provider_mutation_started_at is not null
  or j.prepared_credential_id is not null or j.credential_refresh_recovery_vault_id is null
  or c.status<>'active' or c.channel<>'lazada' or c.environment<>'production'
  or (c.expires_at is not null and c.expires_at<=clock_timestamp())
  or c.created_by<>j.created_by or c.seller_account_key is distinct from j.seller_account_key
  or c.seller_account_key_source<>'provider_certified_v1' or c.seller_account_verified_at is null
  or not exists(select 1 from sellerpilot_private.gateway_completion_receipts x where x.job_id=j.id)
  then return null;end if;
 select decrypted_secret::jsonb into b from vault.decrypted_secrets where id=c.vault_secret_id;
 select decrypted_secret::jsonb into r from vault.decrypted_secrets where id=j.credential_refresh_recovery_vault_id;
 select jsonb_object_agg(key,value) into bb from jsonb_each(b) where left(key,3)<>'im_' and key not in('provider_account_subject','provider_account_identity_version');
 select jsonb_object_agg(key,value) into rr from jsonb_each(r) where left(key,3)<>'im_' and key not in('provider_account_subject','provider_account_identity_version');
 if bb is distinct from rr or b->>'im_app_key' is distinct from r->>'im_app_key'
  or b->>'im_app_secret' is distinct from r->>'im_app_secret'
  or coalesce(r->>'im_access_token','')='' or coalesce(r->>'im_refresh_token','')=''
  or coalesce((r->>'im_refresh_token_expires_at')::timestamptz>clock_timestamp(),false) is not true
  then return null;end if;
 select jsonb_object_agg(key,value) into im from jsonb_each(r) where left(key,3)='im_';
 return b||im;
exception when invalid_datetime_format or datetime_field_overflow then return null;
end $$;
revoke all on function sellerpilot_private.lazada_im_recoverable_payload(uuid,uuid) from public,anon,authenticated,service_role;

create function public.sellerpilot_service_resume_lazada_im_diagnostic(p_source_job_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare j sellerpilot_private.channel_gateway_jobs%rowtype;next_id uuid;b text;r text;country text;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'service role required';end if;
 select * into j from sellerpilot_private.channel_gateway_jobs where id=p_source_job_id for update;
 select next_job_id into next_id from sellerpilot_private.lazada_im_recovery_handoffs where source_job_id=p_source_job_id;
 if found then return next_id;end if;
 country:=j.request_payload#>>'{arguments,country}';
 if j.status is distinct from 'reconciliation_required' or country not in('my','sg','ph','th','vn','id')
  or sellerpilot_private.lazada_im_recoverable_payload(j.id,j.credential_id) is null
  then raise exception 'LAZADA_IM_RECOVERY_SOURCE_INVALID';end if;
 select encode(extensions.digest(v.decrypted_secret::jsonb::text,'sha256'),'hex') into b
  from sellerpilot_private.channel_credentials c join vault.decrypted_secrets v on v.id=c.vault_secret_id where c.id=j.credential_id;
 select encode(extensions.digest(decrypted_secret::jsonb::text,'sha256'),'hex') into r from vault.decrypted_secrets where id=j.credential_refresh_recovery_vault_id;
 next_id:=public.sellerpilot_enqueue_channel_gateway_job(j.credential_id,null,'lazada','diagnostic.test',
  jsonb_build_object('arguments',jsonb_build_object('lazadaImCapabilityProbe',true,'country',country,'lazadaImRecoveryJobId',j.id)));
 insert into sellerpilot_private.lazada_im_recovery_handoffs(source_job_id,next_job_id,credential_id,source_payload_sha256,recovery_payload_sha256)
 values(j.id,next_id,j.credential_id,b,r);
 update sellerpilot_private.channel_gateway_jobs set status='cancelled',updated_at=clock_timestamp(),
  error_message='Superseded by IM recovery diagnostic '||next_id::text||'; original failure receipt and recovery tokens preserved.'
 where id=j.id and status='reconciliation_required' and not credential_refresh_in_flight and provider_mutation_started_at is null;
 if not found then raise exception 'LAZADA_IM_RECOVERY_SOURCE_CHANGED';end if;
 return next_id;
end $$;
revoke all on function public.sellerpilot_service_resume_lazada_im_diagnostic(uuid) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_resume_lazada_im_diagnostic(uuid) to service_role;

create function sellerpilot_private.hydrate_lazada_im_recovery_claim(p_claim jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare h sellerpilot_private.lazada_im_recovery_handoffs%rowtype;j sellerpilot_private.channel_gateway_jobs%rowtype;payload jsonb;b text;r text;
begin
 if p_claim is null or p_claim#>>'{request,arguments,lazadaImRecoveryJobId}' is null then return p_claim;end if;
 select * into h from sellerpilot_private.lazada_im_recovery_handoffs where next_job_id=(p_claim->>'id')::uuid;
 select * into j from sellerpilot_private.channel_gateway_jobs where id=h.next_job_id;
 if h.source_job_id is null or j.status is distinct from 'running' or j.claim_token::text is distinct from p_claim->>'claim_token'
  or j.lease_expires_at<=clock_timestamp() or j.credential_id is distinct from h.credential_id
  or p_claim#>>'{request,arguments,lazadaImRecoveryJobId}' is distinct from h.source_job_id::text
  or not exists(select 1 from sellerpilot_private.ai_cli_worker_tokens t where t.id=j.worker_token_id and t.scope='gateway' and t.status='active' and t.expires_at>clock_timestamp())
  then raise exception 'LAZADA_IM_RECOVERY_CLAIM_INVALID';end if;
 select encode(extensions.digest(v.decrypted_secret::jsonb::text,'sha256'),'hex') into b
  from sellerpilot_private.channel_credentials c join vault.decrypted_secrets v on v.id=c.vault_secret_id where c.id=h.credential_id;
 select encode(extensions.digest(v.decrypted_secret::jsonb::text,'sha256'),'hex') into r
  from sellerpilot_private.channel_gateway_jobs s join vault.decrypted_secrets v on v.id=s.credential_refresh_recovery_vault_id where s.id=h.source_job_id;
 if b is distinct from h.source_payload_sha256 or r is distinct from h.recovery_payload_sha256 then raise exception 'LAZADA_IM_RECOVERY_PAYLOAD_CHANGED';end if;
 payload:=sellerpilot_private.lazada_im_recoverable_payload(h.source_job_id,h.credential_id);
 if payload is null then raise exception 'LAZADA_IM_RECOVERY_SOURCE_INVALID';end if;
 return jsonb_set(p_claim,'{credential}',payload,false);
end $$;
revoke all on function sellerpilot_private.hydrate_lazada_im_recovery_claim(jsonb) from public,anon,authenticated,service_role;

do $guard$ begin
 if md5(pg_get_functiondef('public.sellerpilot_claim_local_channel_executor_job(text,text,text,text)'::regprocedure)) is distinct from '3eb4ef53f44490f60892312a2c0a2731' then raise exception 'LOCAL_CLAIM_RECOVERY_PREIMAGE_DRIFT';end if;
end $guard$;
alter function public.sellerpilot_claim_local_channel_executor_job(text,text,text,text) rename to sellerpilot_130710_claim_before_im_recovery;
revoke all on function public.sellerpilot_130710_claim_before_im_recovery(text,text,text,text) from public,anon,authenticated,service_role;
create function public.sellerpilot_claim_local_channel_executor_job(p_token_hash text,p_worker_version text,p_release_sha text,p_egress_ip_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 return sellerpilot_private.hydrate_lazada_im_recovery_claim(public.sellerpilot_130710_claim_before_im_recovery(p_token_hash,p_worker_version,p_release_sha,p_egress_ip_sha256));
end $$;
revoke all on function public.sellerpilot_claim_local_channel_executor_job(text,text,text,text) from public,anon,authenticated;
grant execute on function public.sellerpilot_claim_local_channel_executor_job(text,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
