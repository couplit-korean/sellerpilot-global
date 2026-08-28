-- Preserve the exact full 11st Product document that was successfully
-- created or updated. The provider's update endpoint replaces the complete
-- product document, so later content edits must merge into this trusted
-- snapshot instead of reconstructing price, stock, category, or delivery
-- policy from a browser request.

begin;

create table if not exists sellerpilot_private.elevenst_listing_snapshots (
  listing_id uuid primary key
    references sellerpilot_private.product_listings(id) on delete cascade,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  remote_id text not null check (remote_id ~ '^[1-9][0-9]{0,18}$'),
  product_payload jsonb not null check (
    jsonb_typeof(product_payload) = 'object'
    and octet_length(product_payload::text) <= 128000
  ),
  source_job_id uuid unique
    references sellerpilot_private.channel_gateway_jobs(id) on delete set null,
  source_operation text not null check (source_operation in ('listing.create', 'listing.update')),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table sellerpilot_private.elevenst_listing_snapshots enable row level security;
revoke all on sellerpilot_private.elevenst_listing_snapshots from public, anon, authenticated;

create or replace function sellerpilot_private.capture_elevenst_listing_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product jsonb;
  v_remote_id text;
  v_credential record;
  v_listing record;
begin
  if new.channel <> 'elevenst'
     or new.operation not in ('listing.create', 'listing.update')
     or new.status <> 'succeeded'
     or new.listing_id is null
     or new.response_payload is null
     or jsonb_typeof(new.response_payload) <> 'object'
     or not coalesce((new.response_payload->>'ok')::boolean, false)
     or new.response_payload->>'channel' <> 'elevenst'
     or new.response_payload->>'operation' <> new.operation then
    return new;
  end if;

  v_product := new.request_payload#>'{arguments,product}';
  v_remote_id := nullif(trim(new.response_payload->>'remoteId'), '');
  if v_product is null
     or jsonb_typeof(v_product) <> 'object'
     or octet_length(v_product::text) > 128000
     or v_product->>'dispCtgrNo' <> '1341821'
     or nullif(trim(v_product->>'sellerPrdCd'), '') is null
     or v_remote_id is null
     or v_remote_id !~ '^[1-9][0-9]{0,18}$' then
    return new;
  end if;

  select credential.id, credential.seller_account_key,
         credential.seller_account_key_source,
         credential.seller_account_verified_at
    into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = new.credential_id
     and credential.channel = 'elevenst';
  select listing.id, listing.channel_key, listing.remote_id,
         listing.seller_account_key
    into v_listing
    from sellerpilot_private.product_listings listing
   where listing.id = new.listing_id;

  if not found
     or v_credential.seller_account_key is null
     or v_credential.seller_account_key_source <> 'credential_incarnation_v1'
     or v_credential.seller_account_verified_at is null
     or new.seller_account_key is distinct from v_credential.seller_account_key
     or v_listing.channel_key <> 'elevenst'
     or (
       new.operation = 'listing.update'
       and nullif(trim(v_listing.remote_id), '') is distinct from v_remote_id
     )
     or (
       v_listing.seller_account_key is not null
       and v_listing.seller_account_key is distinct from v_credential.seller_account_key
     ) then
    return new;
  end if;

  insert into sellerpilot_private.elevenst_listing_snapshots (
    listing_id, credential_id, seller_account_key, remote_id,
    product_payload, source_job_id, source_operation
  ) values (
    new.listing_id, new.credential_id, v_credential.seller_account_key,
    v_remote_id, v_product, new.id, new.operation
  )
  on conflict (listing_id) do update
    set credential_id = excluded.credential_id,
        seller_account_key = excluded.seller_account_key,
        remote_id = excluded.remote_id,
        product_payload = excluded.product_payload,
        source_job_id = excluded.source_job_id,
        source_operation = excluded.source_operation,
        revision = sellerpilot_private.elevenst_listing_snapshots.revision + 1,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists capture_elevenst_listing_snapshot
  on sellerpilot_private.channel_gateway_jobs;
create trigger capture_elevenst_listing_snapshot
after update of status, response_payload on sellerpilot_private.channel_gateway_jobs
for each row execute function sellerpilot_private.capture_elevenst_listing_snapshot();

with candidates as (
  select distinct on (job.listing_id)
         job.listing_id, job.credential_id, credential.seller_account_key,
         job.response_payload->>'remoteId' as remote_id,
         job.request_payload#>'{arguments,product}' as product_payload,
         job.id as source_job_id, job.operation as source_operation,
         coalesce(job.completed_at, job.updated_at, job.created_at) as observed_at
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential
      on credential.id = job.credential_id
     and credential.channel = 'elevenst'
     and credential.seller_account_key is not null
     and credential.seller_account_key_source = 'credential_incarnation_v1'
     and credential.seller_account_verified_at is not null
    join sellerpilot_private.product_listings listing
      on listing.id = job.listing_id
     and listing.channel_key = 'elevenst'
     and listing.remote_id = job.response_payload->>'remoteId'
     and listing.seller_account_key = credential.seller_account_key
   where job.channel = 'elevenst'
     and job.operation in ('listing.create', 'listing.update')
     and job.status = 'succeeded'
     and job.seller_account_key = credential.seller_account_key
     and coalesce((job.response_payload->>'ok')::boolean, false)
     and job.response_payload->>'channel' = 'elevenst'
     and job.response_payload->>'operation' = job.operation
     and jsonb_typeof(job.request_payload#>'{arguments,product}') = 'object'
     and job.request_payload#>>'{arguments,product,dispCtgrNo}' = '1341821'
     and nullif(trim(job.request_payload#>>'{arguments,product,sellerPrdCd}'), '') is not null
     and job.response_payload->>'remoteId' ~ '^[1-9][0-9]{0,18}$'
   order by job.listing_id, coalesce(job.completed_at, job.updated_at, job.created_at) desc, job.id desc
)
insert into sellerpilot_private.elevenst_listing_snapshots (
  listing_id, credential_id, seller_account_key, remote_id,
  product_payload, source_job_id, source_operation, created_at, updated_at
)
select listing_id, credential_id, seller_account_key, remote_id,
       product_payload, source_job_id, source_operation, observed_at, observed_at
  from candidates
on conflict (listing_id) do nothing;

create or replace function public.sellerpilot_service_get_elevenst_listing_snapshot(
  p_listing_id uuid,
  p_credential_id uuid,
  p_remote_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_snapshot record;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_remote_id, '')), '') is null
     or trim(p_remote_id) !~ '^[1-9][0-9]{0,18}$' then
    return null;
  end if;

  select snapshot.product_payload, snapshot.remote_id, snapshot.revision,
         snapshot.updated_at
    into v_snapshot
    from sellerpilot_private.elevenst_listing_snapshots snapshot
    join sellerpilot_private.product_listings listing
      on listing.id = snapshot.listing_id
     and listing.channel_key = 'elevenst'
     and listing.remote_id = snapshot.remote_id
     and listing.seller_account_key = snapshot.seller_account_key
    join sellerpilot_private.channel_credentials credential
      on credential.id = p_credential_id
     and credential.channel = 'elevenst'
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > clock_timestamp())
     and credential.seller_account_key = snapshot.seller_account_key
     and credential.seller_account_key_source = 'credential_incarnation_v1'
     and credential.seller_account_verified_at is not null
   where snapshot.listing_id = p_listing_id
     and snapshot.credential_id = p_credential_id
     and snapshot.remote_id = trim(p_remote_id);
  if not found then return null; end if;
  return jsonb_build_object(
    'product', v_snapshot.product_payload,
    'remoteId', v_snapshot.remote_id,
    'revision', v_snapshot.revision,
    'updatedAt', v_snapshot.updated_at
  );
end;
$$;

revoke all on function sellerpilot_private.capture_elevenst_listing_snapshot()
  from public, anon, authenticated;
revoke all on function public.sellerpilot_service_get_elevenst_listing_snapshot(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_get_elevenst_listing_snapshot(uuid, uuid, text)
  to service_role;

commit;
