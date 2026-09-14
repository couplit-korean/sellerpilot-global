begin;
-- Read only: resume one existing SG shop discovery without starting another
-- provider request. The ordinary gateway reader and all refresh ledgers remain unchanged.
do $$ begin
 if to_regprocedure('public.sellerpilot_service_read_shopee_sg_discovery(uuid,uuid,integer,text)') is not null then
   raise exception 'SHOPEE_SG_DISCOVERY_READER_ALREADY_EXISTS';
 end if;
end $$;
create function public.sellerpilot_service_read_shopee_sg_discovery(
 p_actor_id uuid,p_credential_id uuid,p_credential_version integer,p_target_id text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 active_credential sellerpilot_private.channel_credentials%rowtype;
 source_credential sellerpilot_private.channel_credentials%rowtype;
 discovery sellerpilot_private.channel_gateway_jobs%rowtype;
 active_secret jsonb; source_secret jsonb; profile jsonb; response jsonb;
begin
 if not sellerpilot_private.request_has_unambiguous_service_role_claim()
   or p_actor_id is null or not exists(select 1 from sellerpilot_private.admin_users where user_id=p_actor_id) then
   raise exception 'SHOPEE_SG_DISCOVERY_ACCESS_DENIED' using errcode='42501';
 end if;
 if coalesce(p_target_id,'') !~ '^[1-9][0-9]{0,31}$' then
   raise exception 'SHOPEE_SG_DISCOVERY_INPUT_INVALID' using errcode='22023';
 end if;
 -- Matches existing shared_admin_workspace authorization: the actor is an
 -- administrator; the credential keeps its own owner, never reassigned to actor.
 select * into active_credential from sellerpilot_private.channel_credentials
 where id=p_credential_id and version=p_credential_version and status='active'
   and channel='shopee' and environment='production' and created_by is not null
   and seller_account_key is not null and seller_account_key_source='provider_certified_v1'
   and seller_account_verified_at is not null
   and (expires_at is null or expires_at>clock_timestamp());
 if not found then raise exception 'SHOPEE_SG_DISCOVERY_CREDENTIAL_CHANGED'; end if;
 select decrypted_secret::jsonb into active_secret from vault.decrypted_secrets where id=active_credential.vault_secret_id;
 if active_secret->>'provider_account_identity_version' is distinct from 'v1'
   or coalesce(active_secret->>'provider_account_subject','') !~ '^shopee:(main|shop):[1-9][0-9]{0,31}$'
   or (select count(*) from jsonb_array_elements(case when jsonb_typeof(active_secret->'shopee_targets')='array' then active_secret->'shopee_targets' else '[]'::jsonb end) t
       where t->>'type'='shop' and t->>'id'=p_target_id)<>1 then
   raise exception 'SHOPEE_SG_DISCOVERY_TARGET_NOT_AUTHORIZED';
 end if;
 -- Pending jobs take precedence so a prior success cannot hide an active read.
 -- Finished older reads remain visible as blocked; this reader never authorizes a retry.
 select j.* into discovery from sellerpilot_private.channel_gateway_jobs j
 join sellerpilot_private.channel_credentials c on c.id=j.credential_id
 where j.channel='shopee' and j.environment='production' and j.operation='shops.get'
   and j.attempt_id is null and j.created_by=c.created_by
   and j.seller_account_key=c.seller_account_key
   and c.created_by=active_credential.created_by and c.seller_account_key=active_credential.seller_account_key
   and c.channel='shopee' and c.environment='production'
   and j.request_payload=jsonb_build_object('shopId',p_target_id)
   and (c.id=active_credential.id or (j.prepared_credential_id=active_credential.id and c.version<active_credential.version))
 order by case when j.status in ('queued','running','reconciliation_required') then 0 else 1 end,j.created_at desc,j.id desc limit 1;
 if not found then return jsonb_build_object('contract','shopee_sg_discovery_read_v1','actorId',p_actor_id,
   'credentialId',active_credential.id,'credentialVersion',active_credential.version,'targetId',p_target_id,'marketCode','SG','status','none'); end if;
 select * into source_credential from sellerpilot_private.channel_credentials where id=discovery.credential_id;
 select decrypted_secret::jsonb into source_secret from vault.decrypted_secrets where id=source_credential.vault_secret_id;
 if source_secret->>'provider_account_subject' is distinct from active_secret->>'provider_account_subject'
   or source_secret->>'provider_account_identity_version' is distinct from 'v1'
   or (select count(*) from jsonb_array_elements(case when jsonb_typeof(source_secret->'shopee_targets')='array' then source_secret->'shopee_targets' else '[]'::jsonb end) t
       where t->>'type'='shop' and t->>'id'=p_target_id)<>1 then
   raise exception 'SHOPEE_SG_DISCOVERY_IDENTITY_CHANGED';
 end if;
 -- Only the exact one-step official get_shop_info receipt is returned. No
 -- credential fields, provider raw text, request headers or unrelated responses.
 if discovery.status='succeeded' then
   response:=discovery.response_payload; profile:=response#>'{steps,0,data}';
   if response->'ok' is distinct from 'true'::jsonb or response->>'channel' is distinct from 'shopee'
     or response->>'operation' is distinct from 'shops.get' or jsonb_typeof(response->'steps') is distinct from 'array'
     or jsonb_array_length(response->'steps')<>1 or response#>>'{steps,0,name}' is distinct from 'shop-info'
     or response#>'{steps,0,ok}' is distinct from 'true'::jsonb
     or coalesce(response#>>'{steps,0,status}','') !~ '^2[0-9]{2}$'
     or jsonb_typeof(profile) is distinct from 'object' or coalesce(profile->>'error','')<>'' then
     raise exception 'SHOPEE_SG_DISCOVERY_RECEIPT_INVALID';
   end if;
   profile:=jsonb_strip_nulls(jsonb_build_object('shop_id',profile->'shop_id','shop_name',profile->'shop_name',
     'region',profile->'region','country',profile->'country','status',profile->'status',
     'response',case when jsonb_typeof(profile->'response')='object' then jsonb_strip_nulls(jsonb_build_object(
       'shop_id',profile#>'{response,shop_id}','shop_name',profile#>'{response,shop_name}',
       'region',profile#>'{response,region}','country',profile#>'{response,country}','status',profile#>'{response,status}')) end));
   response:=jsonb_build_object('ok',true,'channel','shopee','operation','shops.get','steps',jsonb_build_array(
     jsonb_build_object('ok',true,'name','shop-info','status',discovery.response_payload#>'{steps,0,status}','data',profile)));
 else response:=null; end if;
 return jsonb_build_object('contract','shopee_sg_discovery_read_v1','actorId',p_actor_id,
   'credentialId',active_credential.id,'credentialVersion',active_credential.version,'targetId',p_target_id,'marketCode','SG',
   'status',discovery.status,'job',jsonb_build_object('id',discovery.id,'ownerId',discovery.created_by,
   'credentialOwnerId',source_credential.created_by,'sourceCredentialId',source_credential.id,'sourceCredentialVersion',source_credential.version,
   'preparedCredentialId',discovery.prepared_credential_id,'channel',discovery.channel,'environment',discovery.environment,
   'operation',discovery.operation,'request',discovery.request_payload,'createdAt',discovery.created_at,
   'completedAt',discovery.completed_at,'preparedAt',discovery.credential_refresh_prepared_at,'response',response));
end $$;
revoke all on function public.sellerpilot_service_read_shopee_sg_discovery(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.sellerpilot_service_read_shopee_sg_discovery(uuid,uuid,integer,text) to service_role;
commit;
