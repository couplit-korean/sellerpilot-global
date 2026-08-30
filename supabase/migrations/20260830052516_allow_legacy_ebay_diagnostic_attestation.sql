-- Break the eBay provider-identity bootstrap deadlock without widening any
-- provider-mutation path. A legacy OAuth credential can be attested only by
-- the read-only diagnostic that fetches the stable EIASToken. Keep the newest
-- queued probe for each exact credential and retire stale duplicate clicks.

begin;

with ranked_diagnostics as (
  select
    job.id,
    row_number() over (
      partition by job.credential_id, job.channel, job.environment, job.operation
      order by job.created_at desc, job.id desc
    ) as recency_rank
  from sellerpilot_private.channel_gateway_jobs job
  join sellerpilot_private.channel_credentials credential
    on credential.id = job.credential_id
   and credential.channel = job.channel
   and credential.environment = job.environment
  where job.status = 'queued'
    and job.channel = 'ebay'
    and job.operation = 'diagnostic.test'
    and job.seller_account_key is null
    and credential.status = 'active'
    and credential.seller_account_key is null
    and credential.seller_account_key_source = 'legacy_unattested'
    and credential.seller_account_verified_at is null
), superseded_diagnostics as (
  update sellerpilot_private.channel_gateway_jobs job
     set status = 'cancelled',
         worker_token_id = null,
         claim_token = null,
         lease_expires_at = null,
         completed_at = clock_timestamp(),
         error_message = 'Superseded by a newer queued eBay identity diagnostic.',
         updated_at = clock_timestamp()
    from ranked_diagnostics ranked
   where ranked.id = job.id
     and ranked.recency_rank > 1
  returning job.id
)
select count(*) from superseded_diagnostics;

do $migration$
declare
  v_definition text;
  v_rewritten text;
  v_old constant text := $old$and (
       job.channel <> 'ebay'
       or job.operation = 'oauth.exchange'
       or (
         credential.seller_account_key ~ '^[a-f0-9]{64}$'
         and credential.seller_account_key_source = 'provider_certified_v1'
         and credential.seller_account_verified_at is not null
       )
     )$old$;
  v_new constant text := $new$and (
       job.channel <> 'ebay'
       or job.operation = 'oauth.exchange'
       or (
         job.operation = 'diagnostic.test'
         and credential.seller_account_key is null
         and credential.seller_account_key_source = 'legacy_unattested'
         and credential.seller_account_verified_at is null
       )
       or (
         credential.seller_account_key ~ '^[a-f0-9]{64}$'
         and credential.seller_account_key_source = 'provider_certified_v1'
         and credential.seller_account_verified_at is not null
       )
     )$new$;
begin
  if to_regprocedure(
    'public.sellerpilot_claim_serverless_gateway_job(text,text)'
  ) is null then
    return;
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.sellerpilot_claim_serverless_gateway_job(text,text)'::regprocedure
  ) into v_definition;

  if position(
    'job.operation = ''diagnostic.test''' || chr(10)
      || '         and credential.seller_account_key is null' || chr(10)
      || '         and credential.seller_account_key_source = ''legacy_unattested'''
    in v_definition
  ) > 0 then
    return;
  end if;

  if (
    length(v_definition) - length(replace(v_definition, v_old, ''))
  ) / length(v_old) <> 1 then
    raise exception 'expected one eBay serverless credential fence';
  end if;

  v_rewritten := replace(v_definition, v_old, v_new);
  if v_rewritten = v_definition
     or position('legacy_unattested' in v_rewritten) = 0 then
    raise exception 'eBay diagnostic attestation claim rewrite failed';
  end if;

  execute v_rewritten;
end;
$migration$;

-- Reduced migration fixtures intentionally omit the bounded serverless
-- claimant. Preserve that compatibility without creating a weaker fallback.
do $privileges$
begin
  if to_regprocedure(
    'public.sellerpilot_claim_serverless_gateway_job(text,text)'
  ) is null then
    return;
  end if;

  execute $sql$
    revoke all on function
      public.sellerpilot_claim_serverless_gateway_job(text, text)
      from public, anon, authenticated
  $sql$;
  execute $sql$
    grant execute on function
      public.sellerpilot_claim_serverless_gateway_job(text, text)
      to service_role
  $sql$;
  execute $sql$
    comment on function
      public.sellerpilot_claim_serverless_gateway_job(text, text) is
      'Claims one exact allowlisted channel operation for the bounded Vercel gateway; legacy eBay credentials may claim only diagnostic.test to obtain provider identity attestation.'
  $sql$;
end;
$privileges$;

commit;
