-- Put the single exact Coupang GET verifier beside its immutable terminal
-- source CREATE without weakening the default listing mutation lane.

begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local timezone='UTC';

create function sellerpilot_private.coupang_exact_live_verifier_job_matches(
  job sellerpilot_private.channel_gateway_jobs
)returns boolean language sql immutable strict set search_path='' as $$
 select job.listing_id='fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid
  and job.credential_id='32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid
  and job.attempt_id is null and job.channel='coupang'
  and job.operation='listing.publication.verify' and job.environment='production'
  and job.provider_mutation_started_at is null
  and job.write_resource_kind is null and job.write_resource_key is null
  and job.seller_account_key=
      'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd'
  and job.request_fingerprint=
      'f7b6824dbf307943672d45cfa6edca817b46aaab9d924efa38d60ddec908221d'
  and job.created_by='21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
  and job.request_payload->>'periodicKey'=
      'coupang-exact-live:25adf712-1e9a-432b-8b0d-09cf35a826c5'
  and job.request_payload#>>'{arguments,publicationReviewSourceJobId}'=
      '25adf712-1e9a-432b-8b0d-09cf35a826c5'
  and job.request_payload#>>'{arguments,sellerpilotCoupangExactLiveReconciliation}'=
      'coupang_exact_live_get_only_v1'
  and job.request_payload#>'{arguments,sellerpilotReadOnly}'='true'::jsonb
  and job.request_payload#>>'{arguments,remoteId}'='16375780938'
  and job.request_payload#>>'{arguments,market}'='KR'
  and coalesce(job.request_payload#>>'{arguments,targetId}','')=''
  and job.request_payload#>>'{arguments,publicationIntent}'='live'
  and job.request_payload#>>'{arguments,publicationStateContract}'=
      'verified_remote_state_v1'
  and job.request_payload#>>'{arguments,publicationExpectedLocale}'='ko-KR'
  and job.request_payload#>>'{arguments,publicationExpectedFingerprint}'=
      'f7b6824dbf307943672d45cfa6edca817b46aaab9d924efa38d60ddec908221d'
  and job.request_payload#>>'{arguments,publicationExpectedImageCount}'='8'
$$;
revoke all on function sellerpilot_private.coupang_exact_live_verifier_job_matches(
  sellerpilot_private.channel_gateway_jobs
) from public,anon,authenticated,service_role;

create function sellerpilot_private.guard_coupang_exact_live_verifier_lineage()
returns trigger language plpgsql security definer set search_path='' as $$
declare old_marked boolean:=false;new_marked boolean:=false;
begin
 if tg_op<>'INSERT' then
  old_marked:=coalesce((old.request_payload#>'{arguments}') ?
    'sellerpilotCoupangExactLiveReconciliation',false);
 end if;
 new_marked:=coalesce((new.request_payload#>'{arguments}') ?
   'sellerpilotCoupangExactLiveReconciliation',false);
 if not old_marked and not new_marked then return new;end if;
 if sellerpilot_private.coupang_exact_live_verifier_job_matches(new) is not true
    or (tg_op='INSERT' and
      sellerpilot_private.coupang_exact_live_source_current() is not true)
    or (tg_op='INSERT' and current_setting(
      'sellerpilot.coupang_exact_live_verifier_enqueue',true
    ) is distinct from new.id::text)
    or (tg_op='UPDATE' and (
      old_marked is not true
      or old.id is distinct from new.id
      or old.listing_id is distinct from new.listing_id
      or old.credential_id is distinct from new.credential_id
      or old.attempt_id is distinct from new.attempt_id
      or old.channel is distinct from new.channel
      or old.operation is distinct from new.operation
      or old.environment is distinct from new.environment
      or old.request_payload is distinct from new.request_payload
      or old.seller_account_key is distinct from new.seller_account_key
      or old.request_fingerprint is distinct from new.request_fingerprint
      or old.created_by is distinct from new.created_by
      or old.provider_mutation_started_at is distinct from new.provider_mutation_started_at
      or old.write_resource_kind is distinct from new.write_resource_kind
      or old.write_resource_key is distinct from new.write_resource_key
    )) then
  raise exception 'COUPANG_EXACT_LIVE_VERIFIER_LINEAGE_INVALID'
    using errcode='55000';
 end if;
 return new;
end$$;
revoke all on function sellerpilot_private.guard_coupang_exact_live_verifier_lineage()
 from public,anon,authenticated,service_role;
create trigger coupang_exact_live_verifier_lineage_guard
before insert or update on sellerpilot_private.channel_gateway_jobs
for each row execute function
 sellerpilot_private.guard_coupang_exact_live_verifier_lineage();

create or replace function public.sellerpilot_service_enqueue_exact_coupang_live_verifier()
returns uuid language plpgsql security definer set search_path='' as $$
declare j sellerpilot_private.channel_gateway_jobs%rowtype;a sellerpilot_private.channel_operation_attempts%rowtype;l sellerpilot_private.product_listings%rowtype;c sellerpilot_private.channel_credentials%rowtype;v uuid;args jsonb;
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'service role required' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(1637578093,8072038);
 select * into j from sellerpilot_private.channel_gateway_jobs where id='25adf712-1e9a-432b-8b0d-09cf35a826c5' for update;
 select * into a from sellerpilot_private.channel_operation_attempts where id='d771421b-f408-4f75-addd-03879393fab8' for update;
 select * into l from sellerpilot_private.product_listings where id='fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4' for update;
 select * into c from sellerpilot_private.channel_credentials where id='32de2968-d4b7-4fda-a84b-16a7ce0257cc' for update;
 if c.id is distinct from '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid then raise exception 'exact Coupang credential missing' using errcode='55000';end if;
 if sellerpilot_private.coupang_exact_live_source_current() is not true then raise exception 'exact Coupang source evidence drifted' using errcode='55000';end if;
 select verifier_job_id into v from sellerpilot_private.coupang_exact_live_verify_runs; if v is not null then return v;end if;
 v:=gen_random_uuid();
 args:=jsonb_build_object('publicationReviewSourceJobId',j.id,'sellerpilotReadOnly',true,'sellerpilotCoupangExactLiveReconciliation','coupang_exact_live_get_only_v1','remoteId','16375780938','market',l.market,'targetId',l.target_id,'publicationIntent','live','publicationStateContract','verified_remote_state_v1','publicationExpectedLocale','ko-KR','publicationExpectedFingerprint',j.request_fingerprint,'publicationExpectedImageCount',8);
 perform pg_catalog.set_config('sellerpilot.coupang_exact_live_verifier_enqueue',v::text,true);
 insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,attempt_id,listing_id,channel,operation,environment,request_payload,status,seller_account_key,request_fingerprint,created_by,created_at,updated_at)
 values(v,j.credential_id,null,j.listing_id,'coupang','listing.publication.verify','production',jsonb_build_object('periodicKey','coupang-exact-live:'||j.id,'arguments',args),'queued',j.seller_account_key,j.request_fingerprint,j.created_by,clock_timestamp(),clock_timestamp());
 insert into sellerpilot_private.coupang_exact_live_verify_runs values(v,j.id,a.id,l.id,'16375780938',encode(extensions.digest(to_jsonb(j)::text,'sha256'),'hex'),encode(extensions.digest(to_jsonb(a)::text,'sha256'),'hex'),encode(extensions.digest(to_jsonb(l)::text,'sha256'),'hex'),clock_timestamp());
 return v;
end$$;
revoke all on function public.sellerpilot_service_enqueue_exact_coupang_live_verifier()
 from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_service_enqueue_exact_coupang_live_verifier()
 to service_role;

do $preimage$ declare definition text;begin
 select pg_catalog.pg_get_indexdef(indexrelid) into definition
 from pg_catalog.pg_index where indexrelid=
  'sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'::regclass;
 if definition is null
    or pg_catalog.md5(definition)<>'72d7d74fc3ad4049850c92b74a051442'
 then raise exception 'COUPANG_EXACT_LIVE_ACTIVE_LINEAGE_PREIMAGE_DRIFT'
  using errcode='55000';end if;
end$preimage$;

drop index sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx;
create unique index channel_gateway_jobs_one_active_listing_or_lineage_idx
 on sellerpilot_private.channel_gateway_jobs(
  listing_id,
  (case
    when sellerpilot_private.qoo10_shipping_s1_verifier_job_matches(channel_gateway_jobs)
      then 'qoo10_shipping_s1_verifier_v1'
    when sellerpilot_private.qoo10_shipping_s1_activation_job_matches(channel_gateway_jobs)
      then 'qoo10_shipping_s1_activation_v1'
    when sellerpilot_private.qoo10_exact_s1_verifier_job_matches(channel_gateway_jobs)
      then 'qoo10_exact_s1_verifier_v1'
    when listing_id='4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     and channel='qoo10' and operation='listing.update'
     and credential_id='2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
     and seller_account_key='2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
     and request_payload#>>'{arguments,sellerpilotQoo10ExactLocalization,status}'='allowed'
     and request_payload#>>'{arguments,sellerpilotQoo10ExactLocalization,contract}'='qoo10_exact_localization_update_v2'
      then 'qoo10_exact_localization_update_v2'
    when listing_id='4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'::uuid
     and channel='qoo10' and operation='listing.activate'
     and credential_id='2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid
     and seller_account_key='2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46'
     and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,status}'='allowed'
     and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,contract}'='qoo10_s1_activation_v1'
     and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,listingId}'='4e5b97be-3fe5-4537-9e26-d36fb36ec1fc'
     and request_payload#>>'{arguments,sellerpilotQoo10S1Activation,remoteId}'='1217336970'
      then 'qoo10_exact_s1_activation_v1'
    when channel='temu' and operation='listing.stop'
     and request_payload#>>'{arguments,sellerpilotTemuContainment,version}'='temu_safe_test_containment_v1'
      then 'temu_safe_test_containment_v1'
    when channel='temu' and operation='listing.publication.verify'
     and request_payload#>>'{arguments,sellerpilotTemuContainmentDiscovery,version}'='temu_safe_test_containment_discovery_v1'
     and request_payload#>'{arguments,sellerpilotReadOnly}'='true'::jsonb
      then 'temu_safe_test_containment_discovery_v1'
    when sellerpilot_private.smartstore_repair_adoption_recheck_job_matches(channel_gateway_jobs)
      then 'smartstore_repair_adoption_recheck_v1'
    when sellerpilot_private.smartstore_manual_adoption_readback_job_matches(channel_gateway_jobs)
      then 'smartstore_manual_adoption_readback_v1'
    when sellerpilot_private.smartstore_existing_content_repair_job_matches(channel_gateway_jobs)
     and request_payload?'sellerpilotSmartstoreRepairRecoveryReceiptId'
      then 'smartstore_existing_content_repair_recovery_v1'
    when sellerpilot_private.smartstore_existing_content_repair_job_matches(channel_gateway_jobs)
      then 'smartstore_existing_content_repair_v1'
    when channel='smartstore' and operation='listing.update'
     and request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoption,contract}'='smartstore_manual_adoption_verified_v1'
     and request_payload#>>'{arguments,sellerpilotSmartstoreManualAdoption,status}'='verified'
      then 'smartstore_manual_adoption_normal_update_v1'
    when sellerpilot_private.coupang_exact_live_verifier_job_matches(channel_gateway_jobs)
      then 'coupang_exact_live_get_only_v1'
    else 'default'
  end)
 ) where listing_id is not null
  and operation in('listing.create','listing.update','listing.stop','listing.activate','price.update','inventory.update','listing.lineage.verify','listing.publication.verify')
  and status in('queued','running','reconciliation_required');

comment on index sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx is
 'Default mutation exclusion remains closed; only the immutable exact Coupang provider-live GET verifier has a separate lineage.';

commit;
