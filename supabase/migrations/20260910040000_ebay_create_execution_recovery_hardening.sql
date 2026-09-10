begin;

-- eBay r5 execution recovery. Do not wrap public.sellerpilot_claim_channel_gateway_job:
-- other channels still enqueue jobs whose attempt_id is null.

alter table sellerpilot_private.channel_gateway_jobs
  add column if not exists ebay_publication_recovery_claim_count smallint
    not null default 0
    check (ebay_publication_recovery_claim_count between 0 and 2);

create table if not exists sellerpilot_private.ebay_create_stage_receipts (
  job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  attempt_id uuid not null references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  credential_version integer not null check (credential_version > 0),
  credential_fingerprint text not null check (credential_fingerprint ~ '^[A-Fa-f0-9]{12,64}$'),
  owner_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid not null references sellerpilot_private.products(id) on delete restrict,
  import_id uuid not null references sellerpilot_private.external_detail_imports(id) on delete restrict,
  claim_token uuid not null,
  stage text not null check (stage in ('inventory','offer','publish')),
  prewrite_receipt_sha256 text not null check (prewrite_receipt_sha256 ~ '^[a-f0-9]{64}$'),
  previous_stage_receipt_sha256 text check (previous_stage_receipt_sha256 is null or previous_stage_receipt_sha256 ~ '^[a-f0-9]{64}$'),
  stage_receipt_sha256 text not null unique check (stage_receipt_sha256 ~ '^[a-f0-9]{64}$'),
  fence jsonb not null check (jsonb_typeof(fence)='object' and octet_length(fence::text)<=32768),
  created_at timestamptz not null default clock_timestamp(),
  primary key (job_id, stage)
);
alter table sellerpilot_private.ebay_create_stage_receipts enable row level security;
revoke all on sellerpilot_private.ebay_create_stage_receipts from public, anon, authenticated, service_role;

-- Bind the mutable local ledgers before enqueue. The stage RPC below locks the
-- same rows and compares this exact snapshot immediately before every eBay
-- Inventory/Offer/Publish mutation.
create or replace function public.sellerpilot_service_ebay_create_ledger_snapshot_v1(
  p_owner_id uuid,
  p_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p sellerpilot_private.products%rowtype;
  d sellerpilot_private.product_registration_drafts%rowtype;
begin
  if p_owner_id is null or p_product_id is null then
    raise exception 'EBAY_CREATE_LEDGER_SNAPSHOT_INVALID';
  end if;
  select * into p from sellerpilot_private.products
   where id=p_product_id and owner_id=p_owner_id and not demo and status<>'archived'
   for share;
  select * into d from sellerpilot_private.product_registration_drafts
   where owner_id=p_owner_id and product_id=p_product_id
     and draft_id=p_product_id and kind='publish'
   for share;
  if p.id is null or d.id is null then
    raise exception 'EBAY_CREATE_LEDGER_SNAPSHOT_UNAVAILABLE';
  end if;
  if coalesce(d.data#>>'{common,globalBaseUsdPrice}','') !~ '^(?:0|[1-9][0-9]*)(?:[.][0-9]{1,2})?$'
     or (d.data#>>'{common,globalBaseUsdPrice}')::numeric<=0
     or coalesce(d.data#>>'{common,quantity}','') !~ '^[1-9][0-9]*$'
     or (d.data#>>'{common,quantity}')::integer
        is distinct from greatest(p.on_hand-p.reserved-p.safety_stock,0) then
    raise exception 'EBAY_CREATE_LEDGER_SNAPSHOT_COMMERCE_STALE';
  end if;
  return jsonb_build_object(
    'contract','sellerpilot_ebay_create_ledger_snapshot_v1',
    'productUpdatedAt',p.updated_at,
    'productSku',p.sku,
    'availableQuantity',greatest(p.on_hand-p.reserved-p.safety_stock,0),
    'priceUsd',d.data#>>'{common,globalBaseUsdPrice}',
    'draftId',d.draft_id,
    'draftVersion',d.version,
    'draftUpdatedAt',d.updated_at,
    'draftDataSha256',encode(extensions.digest(d.data::text,'sha256'),'hex')
  );
end;
$$;

revoke all on function public.sellerpilot_service_ebay_create_ledger_snapshot_v1(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_ebay_create_ledger_snapshot_v1(uuid,uuid)
  to service_role;

create table if not exists sellerpilot_private.ebay_create_credential_rebind_receipts (
  job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  from_credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  to_credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  from_version integer not null,
  from_fingerprint text not null,
  to_version integer not null,
  to_fingerprint text not null,
  provider_account_subject_sha256 text not null check(provider_account_subject_sha256 ~ '^[a-f0-9]{64}$'),
  refresh_token_sha256 text not null check(refresh_token_sha256 ~ '^[a-f0-9]{64}$'),
  receipt_sha256 text not null unique check(receipt_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  primary key(job_id,from_credential_id,to_credential_id)
);
alter table sellerpilot_private.ebay_create_credential_rebind_receipts enable row level security;
revoke all on sellerpilot_private.ebay_create_credential_rebind_receipts from public,anon,authenticated,service_role;

create or replace function sellerpilot_private.ebay_create_credential_rebind_is_valid(
  p_job_id uuid,p_from uuid,p_to uuid,p_from_version integer,p_from_fingerprint text,
  p_to_version integer,p_to_fingerprint text
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(select 1
    from sellerpilot_private.ebay_create_credential_rebind_receipts r
   where r.job_id=p_job_id and r.from_credential_id=p_from and r.to_credential_id=p_to
     and r.from_version=p_from_version and r.from_fingerprint=p_from_fingerprint
     and r.to_version=p_to_version and r.to_fingerprint=p_to_fingerprint)
$$;
revoke all on function sellerpilot_private.ebay_create_credential_rebind_is_valid(uuid,uuid,uuid,integer,text,integer,text)
  from public,anon,authenticated,service_role;

-- After OAuth refresh creates a new credential row, rebind the still-running
-- attempt and return the exact current incarnation to both runtimes.
create or replace function public.sellerpilot_service_ebay_create_credential_incarnation_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j sellerpilot_private.channel_gateway_jobs%rowtype;
  c sellerpilot_private.channel_credentials%rowtype;
  old_credential sellerpilot_private.channel_credentials%rowtype;
  old_secret jsonb;
  new_secret jsonb;
  staged record;
  rebind_receipt text;
begin
  select * into j from sellerpilot_private.channel_gateway_jobs
   where id=p_job_id for update;
  if j.id is null or j.status<>'running' or j.claim_token is distinct from p_claim_token
     or j.lease_expires_at<=clock_timestamp() then
    raise exception 'EBAY_CREATE_CREDENTIAL_JOB_STALE';
  end if;
  if j.channel<>'ebay' or j.operation<>'listing.create' then return null; end if;
  if j.environment<>'production' or j.attempt_id is null then
    raise exception 'EBAY_CREATE_CREDENTIAL_JOB_STALE';
  end if;
  if not exists (
    select 1 from sellerpilot_private.ai_cli_worker_tokens t
     where t.id=j.worker_token_id and t.token_hash=p_token_hash
       and t.scope='gateway' and t.status='active' and t.expires_at>clock_timestamp()
  ) then raise exception 'EBAY_CREATE_CREDENTIAL_WORKER_STALE'; end if;
  select * into c from sellerpilot_private.channel_credentials
   where id=j.credential_id for share;
  if c.id is null or c.channel<>'ebay' or c.environment<>'production'
     or c.status<>'active' or c.version<1
     or coalesce(c.fingerprint,'') !~ '^[A-Fa-f0-9]{12,64}$'
     or (c.expires_at is not null and c.expires_at<=clock_timestamp()) then
    raise exception 'EBAY_CREATE_CREDENTIAL_LINEAGE_STALE';
  end if;
  update sellerpilot_private.channel_operation_attempts a
     set credential_id=c.id
   where a.id=j.attempt_id and a.owner_id=j.created_by
     and a.channel='ebay' and a.operation='listing.create'
     and a.status='running' and a.request_fingerprint=j.request_fingerprint;
  if not found then raise exception 'EBAY_CREATE_CREDENTIAL_ATTEMPT_STALE'; end if;
  select secret_row.decrypted_secret::jsonb into new_secret
    from vault.decrypted_secrets secret_row where secret_row.id=c.vault_secret_id;
  for staged in select distinct r.credential_id,r.credential_version,r.credential_fingerprint
      from sellerpilot_private.ebay_create_stage_receipts r
     where r.job_id=j.id and r.credential_id<>c.id
  loop
    select * into old_credential from sellerpilot_private.channel_credentials
     where id=staged.credential_id for share;
    select secret_row.decrypted_secret::jsonb into old_secret
      from vault.decrypted_secrets secret_row where secret_row.id=old_credential.vault_secret_id;
    if old_credential.id is null or old_credential.channel<>'ebay'
       or old_credential.environment<>'production'
       or old_secret->>'provider_account_subject' is null
       or old_secret->>'provider_account_subject' is distinct from new_secret->>'provider_account_subject'
       or coalesce(old_secret->>'refresh_token','')=''
       or old_secret->>'refresh_token' is distinct from new_secret->>'refresh_token' then
      raise exception 'EBAY_CREATE_CREDENTIAL_REBIND_LINEAGE_STALE';
    end if;
    rebind_receipt:=encode(extensions.digest(concat_ws('|',j.id::text,old_credential.id::text,
      staged.credential_version::text,staged.credential_fingerprint,c.id::text,c.version::text,
      c.fingerprint,new_secret->>'provider_account_subject',new_secret->>'refresh_token'),'sha256'),'hex');
    insert into sellerpilot_private.ebay_create_credential_rebind_receipts(
      job_id,from_credential_id,to_credential_id,from_version,from_fingerprint,
      to_version,to_fingerprint,provider_account_subject_sha256,refresh_token_sha256,receipt_sha256
    ) values(j.id,old_credential.id,c.id,staged.credential_version,staged.credential_fingerprint,
      c.version,c.fingerprint,
      encode(extensions.digest(new_secret->>'provider_account_subject','sha256'),'hex'),
      encode(extensions.digest(new_secret->>'refresh_token','sha256'),'hex'),rebind_receipt)
    on conflict do nothing;
  end loop;
  return jsonb_build_object(
    'contract','sellerpilot_ebay_create_credential_incarnation_v1',
    'id',c.id,'version',c.version,'fingerprint',c.fingerprint
  );
end;
$$;

revoke all on function public.sellerpilot_service_ebay_create_credential_incarnation_v1(text,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_ebay_create_credential_incarnation_v1(text,uuid,uuid)
  to service_role;

create or replace function sellerpilot_private.reject_ebay_create_stage_receipt_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'EBAY_CREATE_STAGE_RECEIPT_IMMUTABLE';
end;
$$;

revoke all on function sellerpilot_private.reject_ebay_create_stage_receipt_mutation()
  from public, anon, authenticated, service_role;
drop trigger if exists ebay_create_stage_receipt_append_only
  on sellerpilot_private.ebay_create_stage_receipts;
create trigger ebay_create_stage_receipt_append_only
before update or delete on sellerpilot_private.ebay_create_stage_receipts
for each row execute function sellerpilot_private.reject_ebay_create_stage_receipt_mutation();
drop trigger if exists ebay_create_credential_rebind_append_only
  on sellerpilot_private.ebay_create_credential_rebind_receipts;
create trigger ebay_create_credential_rebind_append_only
before update or delete on sellerpilot_private.ebay_create_credential_rebind_receipts
for each row execute function sellerpilot_private.reject_ebay_create_stage_receipt_mutation();

create table if not exists sellerpilot_private.ebay_create_stage_outcomes (
  job_id uuid not null references sellerpilot_private.channel_gateway_jobs(id) on delete restrict,
  attempt_id uuid not null references sellerpilot_private.channel_operation_attempts(id) on delete restrict,
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete restrict,
  stage text not null check (stage in ('inventory','offer','publish')),
  stage_receipt_sha256 text not null check (stage_receipt_sha256 ~ '^[a-f0-9]{64}$'),
  provider_resource_id text not null check (provider_resource_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$'),
  created_at timestamptz not null default clock_timestamp(),
  primary key(job_id,stage),
  unique(job_id,stage_receipt_sha256)
);
alter table sellerpilot_private.ebay_create_stage_outcomes enable row level security;
revoke all on sellerpilot_private.ebay_create_stage_outcomes from public,anon,authenticated,service_role;
drop trigger if exists ebay_create_stage_outcome_append_only
  on sellerpilot_private.ebay_create_stage_outcomes;
create trigger ebay_create_stage_outcome_append_only
before update or delete on sellerpilot_private.ebay_create_stage_outcomes
for each row execute function sellerpilot_private.reject_ebay_create_stage_receipt_mutation();

create or replace function public.sellerpilot_service_complete_ebay_create_stage_v1(
  p_token_hash text,p_job_id uuid,p_claim_token uuid,p_attempt_id uuid,
  p_credential_id uuid,p_stage text,p_stage_receipt_sha256 text,
  p_provider_resource_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  j sellerpilot_private.channel_gateway_jobs%rowtype;
  r sellerpilot_private.ebay_create_stage_receipts%rowtype;
  o sellerpilot_private.ebay_create_stage_outcomes%rowtype;
begin
  if p_stage not in ('inventory','offer','publish')
     or coalesce(p_stage_receipt_sha256,'') !~ '^[a-f0-9]{64}$'
     or coalesce(p_provider_resource_id,'') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$' then
    raise exception 'EBAY_CREATE_STAGE_OUTCOME_INVALID';
  end if;
  select * into j from sellerpilot_private.channel_gateway_jobs where id=p_job_id for update;
  if j.id is null or j.channel<>'ebay' or j.operation<>'listing.create'
     or j.environment<>'production' or j.status<>'running'
     or j.claim_token is distinct from p_claim_token
     or j.lease_expires_at<=clock_timestamp()
     or j.attempt_id is distinct from p_attempt_id
     or j.credential_id is distinct from p_credential_id then
    raise exception 'EBAY_CREATE_STAGE_OUTCOME_JOB_STALE';
  end if;
  if not exists(select 1 from sellerpilot_private.ai_cli_worker_tokens t
    where t.id=j.worker_token_id and t.token_hash=p_token_hash and t.status='active'
      and t.scope='gateway' and t.expires_at>clock_timestamp()) then
    raise exception 'EBAY_CREATE_STAGE_OUTCOME_WORKER_STALE';
  end if;
  select * into r from sellerpilot_private.ebay_create_stage_receipts
   where job_id=j.id and stage=p_stage;
  if r.job_id is null or r.attempt_id is distinct from j.attempt_id
     or r.stage_receipt_sha256 is distinct from p_stage_receipt_sha256
     or (r.credential_id is distinct from p_credential_id
       and not sellerpilot_private.ebay_create_credential_rebind_is_valid(
         j.id,r.credential_id,p_credential_id,r.credential_version,r.credential_fingerprint,
         (select version from sellerpilot_private.channel_credentials where id=p_credential_id),
         (select fingerprint from sellerpilot_private.channel_credentials where id=p_credential_id))) then
    raise exception 'EBAY_CREATE_STAGE_OUTCOME_RECEIPT_STALE';
  end if;
  select * into o from sellerpilot_private.ebay_create_stage_outcomes
   where job_id=j.id and stage=p_stage;
  if o.job_id is not null then
    if o.attempt_id is distinct from p_attempt_id
       or (o.credential_id is distinct from p_credential_id
         and not sellerpilot_private.ebay_create_credential_rebind_is_valid(
           j.id,o.credential_id,p_credential_id,r.credential_version,r.credential_fingerprint,
           (select version from sellerpilot_private.channel_credentials where id=p_credential_id),
           (select fingerprint from sellerpilot_private.channel_credentials where id=p_credential_id)))
       or o.stage_receipt_sha256 is distinct from p_stage_receipt_sha256
       or o.provider_resource_id is distinct from p_provider_resource_id then
      raise exception 'EBAY_CREATE_STAGE_OUTCOME_REPLAY_CONFLICT';
    end if;
    return jsonb_build_object('contract','sellerpilot_ebay_create_stage_outcome_v1',
      'status','replayed','stage',o.stage,'providerResourceId',o.provider_resource_id);
  end if;
  if (p_stage='inventory' and p_provider_resource_id is distinct from r.fence#>>'{tuple,sku}')
     or (p_stage='offer' and p_provider_resource_id='')
     or (p_stage='publish' and p_provider_resource_id='') then
    raise exception 'EBAY_CREATE_STAGE_OUTCOME_IDENTITY_STALE';
  end if;
  insert into sellerpilot_private.ebay_create_stage_outcomes(
    job_id,attempt_id,credential_id,stage,stage_receipt_sha256,provider_resource_id
  ) values(j.id,j.attempt_id,p_credential_id,p_stage,p_stage_receipt_sha256,p_provider_resource_id)
  returning * into o;
  return jsonb_build_object('contract','sellerpilot_ebay_create_stage_outcome_v1',
    'status','recorded','stage',o.stage,'providerResourceId',o.provider_resource_id);
end;
$$;
revoke all on function public.sellerpilot_service_complete_ebay_create_stage_v1(text,uuid,uuid,uuid,uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.sellerpilot_service_complete_ebay_create_stage_v1(text,uuid,uuid,uuid,uuid,text,text,text)
  to service_role;

create or replace function public.sellerpilot_service_begin_ebay_create_stage_v1(
  p_token_hash text,
  p_job_id uuid,
  p_claim_token uuid,
  p_attempt_id uuid,
  p_credential_id uuid,
  p_fence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j sellerpilot_private.channel_gateway_jobs%rowtype;
  a sellerpilot_private.channel_operation_attempts%rowtype;
  c sellerpilot_private.channel_credentials%rowtype;
  p sellerpilot_private.products%rowtype;
  d sellerpilot_private.product_registration_drafts%rowtype;
  l sellerpilot_private.product_listings%rowtype;
  assignment sellerpilot_private.product_category_assignments%rowtype;
  existing sellerpilot_private.ebay_create_stage_receipts%rowtype;
  prior sellerpilot_private.ebay_create_stage_receipts%rowtype;
  stage_name text := p_fence->>'stage';
  v_product_id uuid;
  v_import_id uuid;
  v_category_assignment_id uuid;
  receipt text;
  stored_subject text;
  object_paths jsonb := p_fence#>'{tuple,normalizedImageObjectPaths}';
  content_hashes jsonb := p_fence#>'{tuple,normalizedImageContentSha256s}';
  body_hashes jsonb := p_fence#>'{approval,providerRequestBodiesSha256}';
begin
  if coalesce(p_token_hash,'') !~ '^[a-f0-9]{64}$'
     or p_job_id is null or p_claim_token is null or p_attempt_id is null or p_credential_id is null
     or jsonb_typeof(p_fence) is distinct from 'object' or octet_length(p_fence::text)>32768
     or p_fence->>'contract' is distinct from 'sellerpilot_ebay_create_stage_fence_v1'
     or stage_name not in ('inventory','offer','publish')
     or p_fence->>'mode' not in ('write','readback')
     or coalesce(p_fence->>'prewriteReceiptSha256','') !~ '^[a-f0-9]{64}$'
     or coalesce(p_fence->>'stageProviderRequestBodySha256','') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(body_hashes) is distinct from 'object'
     or coalesce(body_hashes->>'inventory','') !~ '^[a-f0-9]{64}$'
     or coalesce(body_hashes->>'offer','') !~ '^[a-f0-9]{64}$'
     or coalesce(body_hashes->>'publish','') !~ '^[a-f0-9]{64}$'
     or p_fence->>'stageProviderRequestBodySha256' is distinct from
        (case when p_fence->>'mode'='readback'
          then 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
          else body_hashes->>stage_name end)
     or p_fence->>'providerRequestMethod' is distinct from
        (case when p_fence->>'mode'='readback' then 'GET'
          when stage_name='inventory' then 'PUT' else 'POST' end)
     or p_fence->>'providerRequestPath' is distinct from
        (case when stage_name='inventory'
          then '/sell/inventory/v1/inventory_item/'||(p_fence#>>'{tuple,sku}')
          when stage_name='offer' and p_fence->>'mode'='write'
          then '/sell/inventory/v1/offer'
          when coalesce(p_fence->>'remoteOfferId','')<>''
          then '/sell/inventory/v1/offer/'||(p_fence->>'remoteOfferId')||
            (case when stage_name='publish' and p_fence->>'mode'='write' then '/publish' else '' end)
          else '' end)
     or coalesce(p_fence#>>'{approval,categoryAssignmentRevisionSha256}','') !~ '^[a-f0-9]{64}$'
     or coalesce(p_fence#>>'{approval,categoryAssignment,id}','') !~ '^[0-9a-f-]{36}$'
     or coalesce(p_fence#>>'{approval,categoryAssignment,confirmedAt}','')=''
     or coalesce(p_fence#>>'{approval,categoryAssignment,updatedAt}','')=''
     or p_fence#>>'{approval,currency}' is distinct from 'USD'
     or p_fence#>>'{approval,inventoryQuantity}' is distinct from p_fence#>>'{tuple,quantity}'
     or p_fence#>>'{approval,priceUsd}' is distinct from p_fence#>>'{tuple,priceUsd}'
     or coalesce(p_fence#>>'{approval,revisionSha256}','') !~ '^[a-f0-9]{64}$'
     or coalesce(p_fence#>>'{approval,contentSha256}','') !~ '^[a-f0-9]{64}$'
     or coalesce(p_fence#>>'{approval,requestSha256}','') !~ '^[a-f0-9]{64}$'
     or p_fence#>>'{approval,ledgerSnapshot,contract}' is distinct from 'sellerpilot_ebay_create_ledger_snapshot_v1'
     or coalesce(p_fence#>>'{approval,ledgerSnapshot,productUpdatedAt}','')=''
     or p_fence#>>'{approval,ledgerSnapshot,productSku}' is distinct from p_fence#>>'{tuple,sku}'
     or p_fence#>>'{approval,ledgerSnapshot,availableQuantity}' is distinct from p_fence#>>'{tuple,quantity}'
     or p_fence#>>'{approval,ledgerSnapshot,priceUsd}' is distinct from p_fence#>>'{tuple,priceUsd}'
     or p_fence#>>'{approval,ledgerSnapshot,draftId}' is distinct from p_fence#>>'{approval,productId}'
     or coalesce(p_fence#>>'{approval,ledgerSnapshot,draftVersion}','') !~ '^[1-9][0-9]{0,9}$'
     or coalesce(p_fence#>>'{approval,ledgerSnapshot,draftUpdatedAt}','')=''
     or coalesce(p_fence#>>'{approval,ledgerSnapshot,draftDataSha256}','') !~ '^[a-f0-9]{64}$'
     or coalesce(p_fence->>'providerAccountSubjectSha256','') !~ '^[a-f0-9]{64}$'
     or p_fence#>>'{credential,id}' is distinct from p_credential_id::text
     or coalesce(p_fence#>>'{credential,version}','') !~ '^[1-9][0-9]{0,9}$'
     or coalesce(p_fence#>>'{credential,fingerprint}','') !~ '^[A-Fa-f0-9]{12,64}$'
     or jsonb_typeof(object_paths) is distinct from 'array' or jsonb_array_length(object_paths)<>8
     or jsonb_typeof(content_hashes) is distinct from 'array' or jsonb_array_length(content_hashes)<>8
     or (select count(distinct value) from jsonb_array_elements_text(object_paths))<>8
     or (select count(distinct value) from jsonb_array_elements_text(content_hashes))<>8
     or (stage_name='inventory' and p_fence->>'mode'='write' and p_fence->>'remoteAction'<>'create_inventory')
     or (stage_name='inventory' and p_fence->>'mode'='readback' and p_fence->>'remoteAction' not in ('create_offer','resume_offer'))
     or (stage_name='offer' and p_fence->>'mode'='write' and p_fence->>'remoteAction'<>'create_offer')
     or (stage_name='offer' and p_fence->>'mode'='readback' and p_fence->>'remoteAction'<>'resume_offer')
     or (stage_name='publish' and p_fence->>'remoteAction'<>'resume_offer')
     or (p_fence->>'remoteAction'='resume_offer' and coalesce(p_fence->>'remoteOfferId','')='') then
    raise exception 'EBAY_CREATE_STAGE_FENCE_INVALID';
  end if;
  v_product_id := (p_fence#>>'{approval,productId}')::uuid;
  v_import_id := (p_fence#>>'{approval,importId}')::uuid;
  v_category_assignment_id := (p_fence#>>'{approval,categoryAssignment,id}')::uuid;
  select * into j from sellerpilot_private.channel_gateway_jobs where id=p_job_id for update;
  if j.id is null or j.channel<>'ebay' or j.operation<>'listing.create' or j.environment<>'production'
     or j.status<>'running' or j.claim_token is distinct from p_claim_token
     or j.lease_expires_at<=clock_timestamp() or j.attempt_id is distinct from p_attempt_id
     or j.credential_id is distinct from p_credential_id then
    raise exception 'EBAY_CREATE_STAGE_JOB_STALE';
  end if;
  if not exists (select 1 from sellerpilot_private.ai_cli_worker_tokens t
    where t.id=j.worker_token_id and t.token_hash=p_token_hash and t.status='active'
      and t.scope='gateway' and t.expires_at>clock_timestamp()) then
    raise exception 'EBAY_CREATE_STAGE_WORKER_STALE';
  end if;
  select * into a from sellerpilot_private.channel_operation_attempts where id=j.attempt_id for update;
  select * into c from sellerpilot_private.channel_credentials where id=j.credential_id for share;
  if a.id is null or a.owner_id is distinct from j.created_by or a.credential_id is distinct from j.credential_id
     or a.channel<>'ebay' or a.operation<>'listing.create' or a.status<>'running'
     or a.request_fingerprint is distinct from j.request_fingerprint
     or c.id is null or c.channel<>'ebay' or c.environment<>'production' or c.status<>'active'
     or c.version is distinct from (p_fence#>>'{credential,version}')::integer
     or c.fingerprint is distinct from p_fence#>>'{credential,fingerprint}'
     or (c.expires_at is not null and c.expires_at<=clock_timestamp()) then
    raise exception 'EBAY_CREATE_STAGE_LINEAGE_STALE';
  end if;
  select * into p from sellerpilot_private.products where id=v_product_id for update;
  if p.id is null or p.owner_id is distinct from j.created_by then
    raise exception 'EBAY_CREATE_STAGE_OWNER_STALE';
  end if;
  if p.demo or p.status='archived'
     or p.sku is distinct from p_fence#>>'{approval,ledgerSnapshot,productSku}'
     or p.updated_at is distinct from (p_fence#>>'{approval,ledgerSnapshot,productUpdatedAt}')::timestamptz
     or greatest(p.on_hand-p.reserved-p.safety_stock,0)::text
        is distinct from p_fence#>>'{approval,ledgerSnapshot,availableQuantity}' then
    raise exception 'EBAY_CREATE_STAGE_PRODUCT_LEDGER_STALE';
  end if;
  select * into d from sellerpilot_private.product_registration_drafts
   where owner_id=j.created_by and product_id=v_product_id
     and draft_id=(p_fence#>>'{approval,ledgerSnapshot,draftId}')::uuid and kind='publish'
   for update;
  if d.id is null
     or d.version is distinct from (p_fence#>>'{approval,ledgerSnapshot,draftVersion}')::bigint
     or d.updated_at is distinct from (p_fence#>>'{approval,ledgerSnapshot,draftUpdatedAt}')::timestamptz
     or encode(extensions.digest(d.data::text,'sha256'),'hex')
        is distinct from p_fence#>>'{approval,ledgerSnapshot,draftDataSha256}' then
    raise exception 'EBAY_CREATE_STAGE_DRAFT_LEDGER_STALE';
  end if;
  if coalesce(d.data#>>'{common,globalBaseUsdPrice}','') is distinct from p_fence#>>'{tuple,priceUsd}'
     or coalesce(d.data#>>'{common,quantity}','') is distinct from p_fence#>>'{tuple,quantity}'
     or greatest(p.on_hand-p.reserved-p.safety_stock,0)::text is distinct from p_fence#>>'{tuple,quantity}' then
    raise exception 'EBAY_CREATE_STAGE_COMMERCE_STALE';
  end if;
  select * into l from sellerpilot_private.product_listings where id=j.listing_id for update;
  if l.id is null or l.owner_id is distinct from j.created_by
     or l.product_id is distinct from v_product_id or l.channel_key<>'ebay'
     or upper(l.market)<>'US' or l.target_id<>'EBAY_US' or l.status<>'queued'
     or l.currency<>'USD'
     or l.price is distinct from (p_fence#>>'{approval,priceUsd}')::numeric then
    raise exception 'EBAY_CREATE_STAGE_PRICE_LEDGER_STALE';
  end if;
  if not exists (select 1 from sellerpilot_private.external_detail_imports i where i.id=v_import_id and i.product_id=v_product_id and i.owner_id=j.created_by) then
    raise exception 'EBAY_CREATE_STAGE_OWNER_STALE';
  end if;
  select secret_row.decrypted_secret::jsonb->>'provider_account_subject' into stored_subject
    from vault.decrypted_secrets secret_row where secret_row.id=c.vault_secret_id;
  if stored_subject is null or encode(extensions.digest(stored_subject,'sha256'),'hex')
       is distinct from p_fence->>'providerAccountSubjectSha256' then
    raise exception 'EBAY_CREATE_STAGE_SELLER_STALE';
  end if;
  if j.request_payload#>>'{arguments,sellerpilotExternalDetail,productId}' is distinct from v_product_id::text
     or j.request_payload#>>'{arguments,sellerpilotExternalDetail,importId}' is distinct from v_import_id::text
     or j.request_payload#>>'{arguments,sellerpilotExternalDetail,approvalRevision}' is distinct from p_fence#>>'{approval,approvalRevision}'
     or j.request_payload#>>'{arguments,sellerpilotExternalDetail,contentSha256}' is distinct from p_fence#>>'{approval,contentSha256}'
     or j.request_payload#>>'{arguments,sellerpilotExternalDetail,requestSha256}' is distinct from p_fence#>>'{approval,requestSha256}'
     or j.request_payload#>>'{arguments,sellerpilotEbayCreateApproval,revisionSha256}' is distinct from p_fence#>>'{approval,revisionSha256}'
     or j.request_payload#>>'{arguments,sellerpilotEbayCreateApproval,inventoryQuantity}' is distinct from p_fence#>>'{approval,inventoryQuantity}'
     or j.request_payload#>>'{arguments,sellerpilotEbayCreateApproval,priceUsd}' is distinct from p_fence#>>'{approval,priceUsd}'
     or j.request_payload#>>'{arguments,sellerpilotEbayCreateApproval,currency}' is distinct from p_fence#>>'{approval,currency}'
     or j.request_payload#>>'{arguments,sellerpilotEbayCreateApproval,categoryAssignmentRevisionSha256}' is distinct from p_fence#>>'{approval,categoryAssignmentRevisionSha256}'
     or j.request_payload#>'{arguments,sellerpilotEbayCreateApproval,categoryAssignment}' is distinct from p_fence#>'{approval,categoryAssignment}'
     or j.request_payload#>'{arguments,sellerpilotEbayCreateApproval,ledgerSnapshot}' is distinct from p_fence#>'{approval,ledgerSnapshot}'
     or j.request_payload#>>'{arguments,sellerpilotEbayCategoryAssignment,id}' is distinct from v_category_assignment_id::text
     or j.request_payload#>>'{arguments,sellerpilotEbayCategoryAssignment,confirmedAt}' is distinct from p_fence#>>'{approval,categoryAssignment,confirmedAt}'
     or j.request_payload#>>'{arguments,sellerpilotEbayCategoryAssignment,updatedAt}' is distinct from p_fence#>>'{approval,categoryAssignment,updatedAt}'
     or j.request_payload#>'{arguments,sellerpilotEbayCreateApproval,providerRequestBodiesSha256}' is distinct from body_hashes
     or encode(extensions.digest(coalesce(j.request_payload#>>'{arguments,sellerpilotEbayProviderRequestBodies,inventory}',''),'sha256'),'hex')
        is distinct from body_hashes->>'inventory'
     or encode(extensions.digest(coalesce(j.request_payload#>>'{arguments,sellerpilotEbayProviderRequestBodies,offer}',''),'sha256'),'hex')
        is distinct from body_hashes->>'offer'
     or encode(extensions.digest(coalesce(j.request_payload#>>'{arguments,sellerpilotEbayProviderRequestBodies,publish}',''),'sha256'),'hex')
        is distinct from body_hashes->>'publish'
     or (j.request_payload#>>'{arguments,sellerpilotEbayProviderRequestBodies,inventory}')::jsonb
        is distinct from j.request_payload#>'{arguments,inventoryItem}'
     or (j.request_payload#>>'{arguments,sellerpilotEbayProviderRequestBodies,offer}')::jsonb
        is distinct from jsonb_set(
          j.request_payload#>'{arguments,offer}',
          '{sku}',
          to_jsonb(j.request_payload#>>'{arguments,sku}'),
          true
        )
     or j.request_payload#>>'{arguments,sku}' is distinct from p_fence#>>'{tuple,sku}'
     or j.request_payload#>>'{arguments,offer,marketplaceId}' is distinct from p_fence#>>'{tuple,marketplaceId}'
     or j.request_payload#>>'{arguments,offer,categoryId}' is distinct from p_fence#>>'{tuple,categoryId}'
     or j.request_payload#>>'{arguments,offer,pricingSummary,price,value}' is distinct from p_fence#>>'{tuple,priceUsd}'
     or j.request_payload#>>'{arguments,offer,pricingSummary,price,currency}' is distinct from 'USD'
     or j.request_payload#>>'{arguments,offer,listingPolicies,fulfillmentPolicyId}' is distinct from p_fence#>>'{tuple,fulfillmentPolicyId}'
     or j.request_payload#>>'{arguments,offer,listingPolicies,paymentPolicyId}' is distinct from p_fence#>>'{tuple,paymentPolicyId}'
     or j.request_payload#>>'{arguments,offer,listingPolicies,returnPolicyId}' is distinct from p_fence#>>'{tuple,returnPolicyId}'
     or j.request_payload#>>'{arguments,offer,merchantLocationKey}' is distinct from p_fence#>>'{tuple,merchantLocationKey}'
     or j.request_payload#>'{arguments,inventoryItem,product,aspects}' is distinct from p_fence#>'{tuple,aspects}'
     or j.request_payload#>>'{arguments,inventoryItem,availability,shipToLocationAvailability,quantity}' is distinct from p_fence#>>'{tuple,quantity}' then
    raise exception 'EBAY_CREATE_STAGE_REQUEST_STALE';
  end if;
  select * into assignment from sellerpilot_private.product_category_assignments
   where id=v_category_assignment_id for update;
  if assignment.id is null
     or assignment.owner_id is distinct from j.created_by
     or assignment.product_id is distinct from v_product_id
     or assignment.channel<>'ebay' or assignment.environment<>'production'
     or upper(assignment.market)<>'US' or assignment.status<>'confirmed'
     or not assignment.is_leaf or jsonb_array_length(assignment.missing_required_attributes)<>0
     or assignment.category_id is distinct from p_fence#>>'{tuple,categoryId}'
     or assignment.confirmed_at is distinct from (p_fence#>>'{approval,categoryAssignment,confirmedAt}')::timestamptz
     or assignment.updated_at is distinct from (p_fence#>>'{approval,categoryAssignment,updatedAt}')::timestamptz
  then raise exception 'EBAY_CREATE_STAGE_CATEGORY_ASSIGNMENT_STALE'; end if;
  if not sellerpilot_private.external_detail_approval_revision_is_current(
    v_import_id,(p_fence#>>'{approval,approvalRevision}')::bigint,p_fence#>>'{approval,contentSha256}'
  ) then raise exception 'EBAY_CREATE_STAGE_APPROVAL_STALE'; end if;
  if (select count(*) from sellerpilot_private.marketplace_normalized_asset_refs ref
      join sellerpilot_private.marketplace_normalized_assets asset on asset.object_path=ref.object_path
      where ref.attempt_id=j.attempt_id and ref.owner_id=j.created_by and ref.product_id=v_product_id
        and ref.channel='ebay' and upper(ref.market)='US' and ref.upload_confirmed_at is not null
        and asset.status='available'
        and exists (select 1 from jsonb_array_elements_text(object_paths) x where x.value=ref.object_path)
        and exists (select 1 from jsonb_array_elements_text(content_hashes) x where x.value=asset.content_sha256)
  )<>8 then raise exception 'EBAY_CREATE_STAGE_IMAGES_STALE'; end if;

  select * into existing from sellerpilot_private.ebay_create_stage_receipts
   where job_id=j.id and stage=stage_name;
  if existing.job_id is not null then
    if existing.attempt_id is distinct from j.attempt_id
       or ((existing.credential_id,existing.credential_version,existing.credential_fingerprint)
             is distinct from (j.credential_id,c.version,c.fingerprint)
           and not sellerpilot_private.ebay_create_credential_rebind_is_valid(
             j.id,existing.credential_id,j.credential_id,existing.credential_version,
             existing.credential_fingerprint,c.version,c.fingerprint))
       or existing.owner_id is distinct from j.created_by
       or existing.product_id is distinct from v_product_id
       or existing.import_id is distinct from v_import_id
       or existing.prewrite_receipt_sha256 is distinct from p_fence->>'prewriteReceiptSha256'
       or existing.previous_stage_receipt_sha256 is distinct from p_fence->>'previousStageReceiptSha256'
       or existing.fence#>'{approval}' is distinct from p_fence#>'{approval}'
       or existing.fence#>'{tuple}' is distinct from p_fence#>'{tuple}'
       or (p_fence->>'mode'='write' and (
         existing.fence->>'stageProviderRequestBodySha256' is distinct from p_fence->>'stageProviderRequestBodySha256'
         or existing.fence->>'providerRequestMethod' is distinct from p_fence->>'providerRequestMethod'
         or existing.fence->>'providerRequestPath' is distinct from p_fence->>'providerRequestPath'))
       or existing.fence->>'providerAccountSubjectSha256' is distinct from p_fence->>'providerAccountSubjectSha256' then
      raise exception 'EBAY_CREATE_STAGE_REPLAY_CONFLICT';
    end if;
    return jsonb_build_object('contract','sellerpilot_ebay_create_stage_receipt_v1','status','replayed',
      'stage',existing.stage,'prewriteReceiptSha256',existing.prewrite_receipt_sha256,
      'previousStageReceiptSha256',existing.previous_stage_receipt_sha256,'stageReceiptSha256',existing.stage_receipt_sha256);
  end if;
  if stage_name='inventory' then
    if p_fence->>'previousStageReceiptSha256' is not null then raise exception 'EBAY_CREATE_STAGE_PREVIOUS_RECEIPT_STALE'; end if;
  else
    select * into prior from sellerpilot_private.ebay_create_stage_receipts
     where job_id=j.id and stage=(case stage_name when 'offer' then 'inventory' else 'offer' end);
    if prior.job_id is null or prior.attempt_id is distinct from j.attempt_id
       or ((prior.credential_id,prior.credential_version,prior.credential_fingerprint)
             is distinct from (j.credential_id,c.version,c.fingerprint)
           and not sellerpilot_private.ebay_create_credential_rebind_is_valid(
             j.id,prior.credential_id,j.credential_id,prior.credential_version,
             prior.credential_fingerprint,c.version,c.fingerprint))
       or prior.owner_id is distinct from j.created_by or prior.product_id is distinct from v_product_id
       or prior.import_id is distinct from v_import_id
       or p_fence->>'previousStageReceiptSha256' is distinct from prior.stage_receipt_sha256 then
      raise exception 'EBAY_CREATE_STAGE_PREVIOUS_RECEIPT_STALE';
    end if;
  end if;
  receipt := encode(extensions.digest(concat_ws('|',j.id::text,j.attempt_id::text,j.credential_id::text,
    c.version::text,c.fingerprint,stage_name,p_fence->>'prewriteReceiptSha256',
    coalesce(prior.stage_receipt_sha256,''),p_fence::text),'sha256'),'hex');
  insert into sellerpilot_private.ebay_create_stage_receipts(job_id,attempt_id,credential_id,
    credential_version,credential_fingerprint,owner_id,product_id,import_id,claim_token,stage,
    prewrite_receipt_sha256,previous_stage_receipt_sha256,stage_receipt_sha256,fence)
  values(j.id,j.attempt_id,j.credential_id,c.version,c.fingerprint,j.created_by,v_product_id,v_import_id,
    j.claim_token,stage_name,p_fence->>'prewriteReceiptSha256',prior.stage_receipt_sha256,receipt,p_fence);
  return jsonb_build_object('contract','sellerpilot_ebay_create_stage_receipt_v1','status','staged',
    'stage',stage_name,'prewriteReceiptSha256',p_fence->>'prewriteReceiptSha256',
    'previousStageReceiptSha256',prior.stage_receipt_sha256,'stageReceiptSha256',receipt);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'EBAY_CREATE_STAGE_FENCE_INVALID';
end;
$$;

revoke all on function public.sellerpilot_service_begin_ebay_create_stage_v1(text,uuid,uuid,uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_begin_ebay_create_stage_v1(text,uuid,uuid,uuid,uuid,jsonb)
  to service_role;

-- Replace the older offerId-only recovery selector. A fresh Offer response can
-- be lost before its runtime id is known; the append-only stage receipt is the
-- durable proof that permits GET-only discovery by exact SKU and marketplace.
create or replace function public.sellerpilot_claim_ebay_publication_reconciliation(
  p_token_hash text,p_worker_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_token_id uuid;
  v_job_id uuid;
  v_attempt_id uuid;
  v_listing_id uuid;
  v_credential_id uuid;
  v_job_status text;
  v_claim_token uuid:=gen_random_uuid();
  v_result jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993,821065042);
  select id into v_token_id from sellerpilot_private.ai_cli_worker_tokens
   where token_hash=p_token_hash and scope in('gateway','legacy_combined')
     and status='active' and expires_at>clock_timestamp() for update;
  if not found then raise exception 'invalid worker token' using errcode='42501'; end if;
  update sellerpilot_private.ai_cli_worker_tokens
     set last_seen_at=clock_timestamp(),last_version=left(nullif(trim(p_worker_version),''),80)
   where id=v_token_id;

  with exhausted as (
    update sellerpilot_private.channel_gateway_jobs job
       set status='reconciliation_required',worker_token_id=null,claim_token=null,
           lease_expires_at=null,completed_at=clock_timestamp(),
           error_message='EBAY_PUBLICATION_RECONCILIATION_RETRY_EXHAUSTED',updated_at=clock_timestamp()
     where job.channel='ebay' and job.operation='listing.create' and job.status='running'
       and job.lease_expires_at<=clock_timestamp() and job.ebay_publication_recovery_claim_count>=2
     returning job.attempt_id,job.listing_id
  ), reset_attempt as (
    update sellerpilot_private.channel_operation_attempts attempt
       set status='manual_required',http_status=409,
           safe_message='eBay 공식 조회 복구가 두 번 중단되어 운영 확인이 필요합니다.',
           completed_at=clock_timestamp()
      from exhausted where attempt.id=exhausted.attempt_id and attempt.status='running'
     returning exhausted.listing_id
  )
  update sellerpilot_private.product_listings listing
     set status='failed',failure_class='external_action',
         last_error='EBAY_PUBLICATION_RECONCILIATION_RETRY_EXHAUSTED',updated_at=clock_timestamp()
    from reset_attempt where listing.id=reset_attempt.listing_id and listing.status='queued';

  select job.id,job.attempt_id,job.listing_id,job.credential_id,job.status
    into v_job_id,v_attempt_id,v_listing_id,v_credential_id,v_job_status
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential on credential.id=job.credential_id
      and credential.channel='ebay' and credential.environment='production'
      and credential.status='active' and (credential.expires_at is null or credential.expires_at>clock_timestamp())
    join sellerpilot_private.channel_operation_attempts attempt on attempt.id=job.attempt_id
      and attempt.credential_id=job.credential_id and attempt.channel='ebay' and attempt.operation='listing.create'
    join sellerpilot_private.product_listings listing on listing.id=job.listing_id
      and listing.operation_attempt_id=job.attempt_id and listing.channel_key='ebay'
   where job.channel='ebay' and job.operation='listing.create' and job.environment='production'
     and ((job.status='reconciliation_required'
       and (job.lease_expires_at is null or job.lease_expires_at<=clock_timestamp())
       and ((attempt.status='manual_required' and listing.status='failed' and listing.failure_class='external_action')
         or (attempt.status='running' and listing.status='queued' and listing.failure_class is null)))
       or (job.status='running' and job.lease_expires_at<=clock_timestamp()
         and attempt.status='running' and listing.status='queued' and listing.failure_class is null))
     and job.ebay_publication_recovery_claim_count<2
     and job.credential_refresh_in_flight is false
     and job.credential_refresh_recovery_vault_id is null and job.prepared_credential_id is null
     and job.request_payload#>>'{arguments,publicationStateContract}'='verified_remote_state_v1'
     and job.request_payload#>>'{arguments,publicationIntent}'='live'
     and job.request_payload#>>'{arguments,offer,marketplaceId}'='EBAY_US'
     and coalesce(job.request_payload#>>'{arguments,sku}','') ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$'
     and coalesce(job.request_payload#>>'{arguments,publicationExpectedFingerprint}','') ~ '^[a-f0-9]{64}$'
     and job.request_fingerprint=job.request_payload#>>'{arguments,publicationExpectedFingerprint}'
     and exists(select 1 from sellerpilot_private.ebay_create_stage_receipts r
       where r.job_id=job.id and r.attempt_id=job.attempt_id)
     and not exists(select 1 from sellerpilot_private.channel_gateway_jobs sibling
       where sibling.id<>job.id and sibling.credential_id=job.credential_id and sibling.status='running')
   order by job.completed_at,job.id
   for update of job,credential,attempt,listing skip locked limit 1;
  if not found then return null; end if;

  update sellerpilot_private.channel_gateway_jobs set status='running',worker_token_id=v_token_id,
    claim_token=v_claim_token,lease_expires_at=clock_timestamp()+interval '15 minutes',
    started_at=clock_timestamp(),completed_at=null,error_message=null,
    ebay_publication_recovery_claim_count=ebay_publication_recovery_claim_count+1,
    updated_at=clock_timestamp()
   where id=v_job_id and status=v_job_status
     and (v_job_status<>'running' or lease_expires_at<=clock_timestamp());
  if not found then raise exception 'eBay publication reconciliation claim changed' using errcode='40001'; end if;
  update sellerpilot_private.channel_operation_attempts set status='running',http_status=null,
    safe_message='eBay 공식 조회로 기존 게시 결과를 재연결하고 있습니다.',completed_at=null
   where id=v_attempt_id and credential_id=v_credential_id and status in('manual_required','running');
  if not found then raise exception 'eBay publication reconciliation attempt changed' using errcode='40001'; end if;
  update sellerpilot_private.product_listings set status='queued',last_error=null,
    failure_class=null,updated_at=clock_timestamp()
   where id=v_listing_id and operation_attempt_id=v_attempt_id
     and ((status='failed' and failure_class='external_action') or (status='queued' and failure_class is null));
  if not found then raise exception 'eBay publication reconciliation listing changed' using errcode='40001'; end if;

  select jsonb_build_object(
    'id',job.id,'claim_token',job.claim_token,'credential_id',job.credential_id,
    'attempt_id',job.attempt_id,'credential_version',credential.version,
    'credential_fingerprint',credential.fingerprint,'channel',job.channel,
    'operation',job.operation,'environment',job.environment,'request',job.request_payload,
    'attempt_count',job.attempt_count,'credential',decrypted.decrypted_secret::jsonb,
    'ebay_publication_reconciliation',jsonb_build_object(
      'contract','sellerpilot-ebay-publication-reconciliation/1',
      'sourceJobId',job.id,'attemptId',job.attempt_id,'credentialId',job.credential_id,
      'sku',job.request_payload#>>'{arguments,sku}','marketplaceId','EBAY_US',
      'offerId',(select o.provider_resource_id from sellerpilot_private.ebay_create_stage_outcomes o
        where o.job_id=job.id and o.stage='offer'),
      'lastStage',(select r.stage from sellerpilot_private.ebay_create_stage_receipts r
        where r.job_id=job.id order by case r.stage when 'inventory' then 1 when 'offer' then 2 else 3 end desc limit 1),
      'requestFingerprint',job.request_fingerprint)) into v_result
    from sellerpilot_private.channel_gateway_jobs job
    join sellerpilot_private.channel_credentials credential on credential.id=job.credential_id
    join vault.decrypted_secrets decrypted on decrypted.id=credential.vault_secret_id
   where job.id=v_job_id
     and decrypted.decrypted_secret::jsonb#>>'{provider_account_identity_version}'='v1'
     and decrypted.decrypted_secret::jsonb#>>'{provider_account_subject}'
       ~ '^ebay:eias:[A-Za-z0-9+/]{16,}={0,2}$';
  if v_result is null then
    raise exception 'eBay publication reconciliation credential is not decryptable or attested' using errcode='55000';
  end if;
  return v_result;
end;
$$;
revoke all on function public.sellerpilot_claim_ebay_publication_reconciliation(text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.sellerpilot_claim_ebay_publication_reconciliation(text,text) to service_role;

commit;
