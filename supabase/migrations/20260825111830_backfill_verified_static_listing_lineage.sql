-- Bind legacy published listings only when their original static-credential
-- listing.create attempt has one unambiguous, successful provider readback.
-- OAuth listings remain intentionally unbound: no public seller identifier or
-- current token is treated as historical account proof.

begin;

-- Return the one credential-incarnation key proved by the immutable legacy
-- ledger. NULL means that any part of the evidence chain is missing or
-- ambiguous. Legacy jobs may predate listing_id, but operation_attempt_id is
-- unique per listing after 20260825111800 and therefore remains an exact join.
create or replace function sellerpilot_private.verified_static_listing_lineage_key(
  p_listing_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with exact_candidates as materialized (
    select c.seller_account_key,
           j.id as job_id,
           l.id as listing_id,
           l.operation_attempt_id
      from sellerpilot_private.product_listings l
      join sellerpilot_private.channel_operation_attempts a
        on a.id = l.operation_attempt_id
      join sellerpilot_private.channel_credentials c
        on c.id = a.credential_id
       and c.channel = a.channel
      join sellerpilot_private.channel_gateway_jobs j
        on j.attempt_id = a.id
       and j.credential_id = a.credential_id
       and j.channel = a.channel
       and j.environment = c.environment
     where l.id = p_listing_id
       and l.status = 'published'
       and l.seller_account_key is null
       and l.channel_key in ('coupang', 'elevenst', 'qoo10', 'smartstore')
       and l.channel_key = a.channel
       and a.operation = 'listing.create'
       and a.status = 'succeeded'
       and a.seller_account_key is null
       and nullif(trim(l.remote_id), '') is not null
       and nullif(trim(a.remote_id), '') = trim(l.remote_id)
       and c.seller_account_key is not null
       and c.seller_account_key ~ '^[a-f0-9]{64}$'
       and c.seller_account_key_source = 'credential_incarnation_v1'
       and c.seller_account_verified_at is not null
       and j.operation = 'listing.create'
       and j.status = 'succeeded'
       and j.seller_account_key is null
       and (j.listing_id is null or j.listing_id = l.id)
       and (j.request_fingerprint is null or j.request_fingerprint = a.request_fingerprint)
       and nullif(trim(j.response_payload->>'remoteId'), '') = trim(l.remote_id)
       and sellerpilot_private.gateway_listing_create_readback_verified(
         l.channel_key,
         j.response_payload
       )
  ), unambiguous_candidates as (
    select candidate.*
      from exact_candidates candidate
     where not exists (
       select 1
         from sellerpilot_private.channel_gateway_jobs other_job
        where other_job.id <> candidate.job_id
          and other_job.operation = 'listing.create'
          and other_job.status = 'succeeded'
          and (
            other_job.attempt_id = candidate.operation_attempt_id
            or other_job.listing_id = candidate.listing_id
          )
     )
  )
  select min(candidate.seller_account_key)
    from unambiguous_candidates candidate
  having count(*) = 1
     and count(distinct candidate.seller_account_key) = 1
$$;

revoke all on function sellerpilot_private.verified_static_listing_lineage_key(uuid)
  from public, anon, authenticated, service_role;

-- Preserve the normal immutable-listing trigger. The only additional path is
-- a transaction-local maintenance mode, and it still re-verifies the complete
-- evidence chain while allowing seller_account_key to be the only changed
-- column. The mode is set solely by the private one-shot function below.
create or replace function sellerpilot_private.guard_product_listing_seller_lineage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt record;
  v_credential_key text;
  v_job record;
  v_sensitive_completion boolean := false;
  v_binding_verified boolean := false;
  v_backfill_key text;
begin
  if old.seller_account_key is null
     and new.seller_account_key is not null
     and new.seller_account_key is distinct from old.seller_account_key
     and current_setting('sellerpilot.static_listing_lineage_backfill', true) = 'verified-v1' then
    if (to_jsonb(new) - 'seller_account_key')
       is distinct from (to_jsonb(old) - 'seller_account_key') then
      raise exception 'static listing lineage backfill may only bind seller account key';
    end if;

    select sellerpilot_private.verified_static_listing_lineage_key(old.id)
      into v_backfill_key;
    if v_backfill_key is null
       or new.seller_account_key is distinct from v_backfill_key then
      raise exception 'verified static listing lineage evidence required';
    end if;
    return new;
  end if;

  if old.marketplace_sku is not null
     and new.marketplace_sku is distinct from old.marketplace_sku then
    raise exception 'product listing marketplace sku is immutable';
  end if;
  if old.operation_attempt_id is not null and new.operation_attempt_id is null then
    raise exception 'product listing operation lineage cannot be cleared';
  end if;
  if new.seller_account_key is not null
     and old.seller_account_key is not null
     and new.seller_account_key is distinct from old.seller_account_key then
    raise exception 'product listing seller lineage is immutable';
  end if;

  if new.operation_attempt_id is not null then
    select a.id, a.credential_id, a.channel, a.operation, a.status, a.seller_account_key
      into v_attempt
      from sellerpilot_private.channel_operation_attempts a
     where a.id = new.operation_attempt_id;
    if found then
      select c.seller_account_key into v_credential_key
        from sellerpilot_private.channel_credentials c
       where c.id = v_attempt.credential_id
         and c.channel = v_attempt.channel;
      if v_attempt.channel <> new.channel_key then
        raise exception 'product listing attempt channel mismatch';
      end if;
      if v_attempt.operation in ('listing.update', 'listing.stop', 'price.update', 'inventory.update') and (
        old.seller_account_key is null
        or v_attempt.seller_account_key is null
        or v_credential_key is null
        or old.seller_account_key is distinct from v_attempt.seller_account_key
        or old.seller_account_key is distinct from v_credential_key
      ) then
        raise exception 'product listing seller account mismatch';
      end if;
      if v_attempt.operation = 'listing.create'
         and old.seller_account_key is not null
         and (
           v_attempt.seller_account_key is null
           or old.seller_account_key is distinct from v_attempt.seller_account_key
           or old.seller_account_key is distinct from v_credential_key
         ) then
        raise exception 'product listing seller account mismatch';
      end if;
    end if;
  end if;

  v_sensitive_completion := new.operation_attempt_id is not null
    and (
      new.remote_id is distinct from old.remote_id
      or (new.status is distinct from old.status and new.status in ('published', 'paused', 'failed'))
      or new.seller_account_key is distinct from old.seller_account_key
    );

  if old.seller_account_key is not null
     and (
       new.remote_id is distinct from old.remote_id
       or (new.status is distinct from old.status and new.status in ('published', 'paused', 'failed'))
     )
     and (new.operation_attempt_id is null or not found) then
    raise exception 'exact listing operation lineage required';
  end if;

  if v_sensitive_completion and found and v_attempt.operation in ('listing.create', 'listing.update', 'listing.stop') then
    select j.id, j.credential_id, j.attempt_id, j.listing_id, j.channel,
           j.operation, j.status, j.request_payload, j.response_payload,
           j.seller_account_key
      into v_job
      from sellerpilot_private.channel_gateway_jobs j
     where j.listing_id = new.id
       and j.attempt_id = new.operation_attempt_id
       and j.channel = new.channel_key
       and j.operation = v_attempt.operation
       and j.status in ('succeeded', 'failed', 'reconciliation_required')
     order by j.completed_at desc nulls last, j.created_at desc, j.id desc
     limit 1;

    if not found then
      -- A local pre-provider validation failure may safely mark the listing as
      -- failed, but it may not attach or replace a remote identity.
      if new.status = 'failed'
         and new.remote_id is not distinct from old.remote_id
         and new.seller_account_key is not distinct from old.seller_account_key then
        return new;
      end if;
      raise exception 'exact terminal listing gateway job required';
    end if;

    if v_job.credential_id <> v_attempt.credential_id
       or v_job.seller_account_key is null
       or v_attempt.seller_account_key is null
       or v_credential_key is null
       or v_job.seller_account_key is distinct from v_attempt.seller_account_key
       or v_job.seller_account_key is distinct from v_credential_key then
      raise exception 'terminal listing seller account mismatch';
    end if;

    if new.status in ('published', 'paused') and (
      v_job.status <> 'succeeded'
      or not coalesce((v_job.response_payload->>'ok')::boolean, false)
      or (new.status = 'paused' and v_attempt.operation <> 'listing.stop')
      or (new.status = 'published' and v_attempt.operation not in ('listing.create', 'listing.update'))
    ) then
      raise exception 'successful terminal listing job required';
    end if;

    if v_attempt.operation in ('listing.update', 'listing.stop') and (
      old.seller_account_key is null
      or old.seller_account_key is distinct from v_job.seller_account_key
    ) then
      raise exception 'terminal listing seller account mismatch';
    end if;

    if v_attempt.operation = 'listing.create'
       and v_job.status = 'succeeded'
       and coalesce((v_job.response_payload->>'ok')::boolean, false) then
      if not sellerpilot_private.gateway_listing_create_readback_verified(
        new.channel_key,
        v_job.response_payload
      ) then
        raise exception 'listing create readback required for seller lineage';
      end if;
      if old.seller_account_key is null then
        new.seller_account_key := v_job.seller_account_key;
        v_binding_verified := true;
      elsif old.seller_account_key is distinct from v_job.seller_account_key then
        raise exception 'terminal listing seller account mismatch';
      end if;
      if new.channel_key = 'ebay' and old.marketplace_sku is null then
        new.marketplace_sku := nullif(trim(v_job.request_payload#>>'{arguments,sku}'), '');
        if new.marketplace_sku is null then
          raise exception 'verified ebay marketplace sku required';
        end if;
      end if;
    end if;
  end if;

  if new.seller_account_key is distinct from old.seller_account_key
     and old.seller_account_key is not null then
    raise exception 'product listing seller lineage is immutable';
  end if;
  if new.seller_account_key is distinct from old.seller_account_key
     and new.seller_account_key is null then
    raise exception 'product listing seller lineage cannot be cleared';
  end if;
  if new.seller_account_key is distinct from old.seller_account_key
     and old.seller_account_key is null
     and not v_binding_verified then
    raise exception 'verified listing create completion required for seller lineage';
  end if;
  return new;
end;
$$;

revoke all on function sellerpilot_private.guard_product_listing_seller_lineage()
  from public, anon, authenticated, service_role;

-- This one-shot owner-only function is removed in the same transaction after
-- it updates eligible rows. It neither disables nor drops the immutable
-- listing trigger; the trigger performs the final proof check for every row.
create or replace function sellerpilot_private.backfill_verified_static_listing_lineage()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bound_count integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);
  perform pg_catalog.set_config(
    'sellerpilot.static_listing_lineage_backfill',
    'verified-v1',
    true
  );

  with candidates as materialized (
    select listing.id,
           sellerpilot_private.verified_static_listing_lineage_key(listing.id) as seller_account_key
      from sellerpilot_private.product_listings listing
     where listing.seller_account_key is null
       and listing.status = 'published'
       and listing.channel_key in ('coupang', 'elevenst', 'qoo10', 'smartstore')
  ), updated as (
    update sellerpilot_private.product_listings listing
       set seller_account_key = candidate.seller_account_key
      from candidates candidate
     where listing.id = candidate.id
       and candidate.seller_account_key is not null
       and listing.seller_account_key is null
    returning listing.id,
              listing.owner_id,
              listing.channel_key,
              listing.operation_attempt_id
  )
  insert into sellerpilot_private.operation_audit (
    owner_id,
    action,
    entity_type,
    entity_id,
    safe_detail
  )
  select updated.owner_id,
         'listing_lineage_backfilled',
         'product_listing',
         updated.id::text,
         jsonb_build_object(
           'channel', updated.channel_key,
           'operation_attempt_id', updated.operation_attempt_id,
           'evidence', 'exact_static_listing_create_readback_v1'
         )
    from updated;

  get diagnostics v_bound_count = row_count;
  return v_bound_count;
end;
$$;

revoke all on function sellerpilot_private.backfill_verified_static_listing_lineage()
  from public, anon, authenticated, service_role;

do $$
declare
  v_bound_count integer;
begin
  select sellerpilot_private.backfill_verified_static_listing_lineage()
    into v_bound_count;
  raise notice 'verified static listing lineage backfilled: %', v_bound_count;
end
$$;

drop function sellerpilot_private.backfill_verified_static_listing_lineage();

commit;
