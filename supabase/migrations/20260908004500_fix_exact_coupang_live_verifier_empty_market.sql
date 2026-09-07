-- The exact production listing stores an empty marketplace market value. The
-- dedicated verifier must preserve that value instead of inventing KR.

begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local timezone='UTC';

select pg_catalog.pg_advisory_xact_lock(1637578093,8072038);
lock table sellerpilot_private.channel_gateway_jobs in share row exclusive mode;
lock table sellerpilot_private.coupang_exact_live_verify_runs,
 sellerpilot_private.coupang_exact_live_verify_receipts
 in share row exclusive mode;

do $preflight$
declare
 j sellerpilot_private.channel_gateway_jobs%rowtype;
 a sellerpilot_private.channel_operation_attempts%rowtype;
 l sellerpilot_private.product_listings%rowtype;
 c sellerpilot_private.channel_credentials%rowtype;
 index_definition text;
 matcher_definition text;
 active_count integer;
 source_active_count integer;
begin
 select * into j from sellerpilot_private.channel_gateway_jobs
  where id='25adf712-1e9a-432b-8b0d-09cf35a826c5' for update;
 select * into a from sellerpilot_private.channel_operation_attempts
  where id='d771421b-f408-4f75-addd-03879393fab8' for update;
 select * into l from sellerpilot_private.product_listings
  where id='fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4' for update;
 select * into c from sellerpilot_private.channel_credentials
  where id='32de2968-d4b7-4fda-a84b-16a7ce0257cc' for update;

 select pg_catalog.pg_get_indexdef(indexrelid) into index_definition
 from pg_catalog.pg_index where indexrelid=
  'sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'::regclass;
 select pg_catalog.pg_get_functiondef(
  'sellerpilot_private.coupang_exact_live_verifier_job_matches(sellerpilot_private.channel_gateway_jobs)'::regprocedure
 ) into matcher_definition;
 select count(*),count(*) filter(
   where candidate.id='25adf712-1e9a-432b-8b0d-09cf35a826c5'::uuid
 ) into active_count,source_active_count
 from sellerpilot_private.channel_gateway_jobs candidate
 where candidate.listing_id='fe4ed8ac-7a49-4ccf-97a1-ee435388cbf4'::uuid
  and candidate.operation in(
   'listing.create','listing.update','listing.stop','listing.activate',
   'price.update','inventory.update','listing.lineage.verify',
   'listing.publication.verify'
  )
  and candidate.status in('queued','running','reconciliation_required');

 if pg_catalog.md5(index_definition)<>'4c9eb100e6c7ac8bdcc513cdf859a0de'
    or pg_catalog.md5(matcher_definition)<>'66ed2bd8561f3b5e9d68f29837bc8785'
 then raise exception 'COUPANG_EXACT_LIVE_EMPTY_MARKET_PREIMAGE_DRIFT'
  using errcode='55000';end if;
 if sellerpilot_private.coupang_exact_live_source_current() is not true
    or j.id is null or a.id is null or l.id is null or c.id is null
    or j.attempt_id is distinct from a.id
    or j.listing_id is distinct from l.id
    or j.credential_id is distinct from c.id
    or j.created_by is distinct from
      '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid
    or j.seller_account_key is distinct from
      'e058c9ed30bbc778380a1791e943ce9dbb04a066f5000ea792e5cc95b33dfacd'
    or j.request_fingerprint is distinct from
      'f7b6824dbf307943672d45cfa6edca817b46aaab9d924efa38d60ddec908221d'
    or l.market is distinct from '' or l.target_id is distinct from ''
    or active_count<>1 or source_active_count<>1
 then raise exception 'COUPANG_EXACT_LIVE_EMPTY_MARKET_SOURCE_DRIFT'
  using errcode='55000';end if;
 if exists(select 1 from sellerpilot_private.coupang_exact_live_verify_runs)
    or exists(select 1 from sellerpilot_private.coupang_exact_live_verify_receipts)
    or exists(
      select 1 from sellerpilot_private.channel_gateway_jobs candidate
      where coalesce((candidate.request_payload#>'{arguments}') ?
        'sellerpilotCoupangExactLiveReconciliation',false)
    )
 then raise exception 'COUPANG_EXACT_LIVE_EMPTY_MARKET_NOT_PRISTINE'
  using errcode='55000';end if;
end
$preflight$;

create or replace function sellerpilot_private.coupang_exact_live_verifier_job_matches(
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
  and job.request_payload#>>'{arguments,market}'=''
  and job.request_payload#>>'{arguments,targetId}'=''
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

-- The preflight proves that no stored row used either the old or new special
-- classification. Reindex so every expression entry is nevertheless rebuilt
-- under the corrected immutable function before enqueue can resume.
reindex index sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx;

do $postcondition$
declare definition text;matcher_definition text;normalized text;begin
 select pg_catalog.pg_get_indexdef(indexrelid) into definition
 from pg_catalog.pg_index where indexrelid=
  'sellerpilot_private.channel_gateway_jobs_one_active_listing_or_lineage_idx'::regclass
  and indisunique and indisvalid and indisready and indislive;
 select pg_catalog.pg_get_functiondef(
  'sellerpilot_private.coupang_exact_live_verifier_job_matches(sellerpilot_private.channel_gateway_jobs)'::regprocedure
 ) into matcher_definition;
 normalized:=pg_catalog.regexp_replace(matcher_definition,'\s','','g');
 if definition is null
    or pg_catalog.md5(definition)<>'4c9eb100e6c7ac8bdcc513cdf859a0de'
    or pg_catalog.strpos(normalized,
      $needle$job.request_payload#>>'{arguments,market}'=''$needle$)=0
    or pg_catalog.strpos(normalized,
      $needle$job.request_payload#>>'{arguments,targetId}'=''$needle$)=0
    or pg_catalog.strpos(normalized,
      $needle$job.request_payload#>>'{arguments,market}'='KR'$needle$)>0
    or sellerpilot_private.coupang_exact_live_source_current() is not true
    or exists(select 1 from sellerpilot_private.coupang_exact_live_verify_runs)
    or exists(select 1 from sellerpilot_private.coupang_exact_live_verify_receipts)
 then raise exception 'COUPANG_EXACT_LIVE_EMPTY_MARKET_POSTCONDITION_FAILED'
  using errcode='55000';end if;
end
$postcondition$;

commit;
