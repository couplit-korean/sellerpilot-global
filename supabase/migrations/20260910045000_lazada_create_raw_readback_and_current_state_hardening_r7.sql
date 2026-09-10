-- Lazada r7: distinguish POST CreateProduct vs GET-recovery receipts, bind
-- raw request/response bytes, and re-read product status/demo/stock plus
-- listing status/remote_id even when updated_at is unchanged.
begin;

do $$
begin
  if to_regclass('sellerpilot_private.products') is null
     or to_regclass('sellerpilot_private.product_listings') is null then
    raise exception 'LAZADA_CREATE_R7_PREIMAGE_REQUIRED';
  end if;
  if to_regclass('sellerpilot_private.lazada_create_raw_receipts_r7') is not null
     or to_regprocedure('public.sellerpilot_lzd_store_post_rcpt_r7(uuid,text,text,text,text,text,text)') is not null
     or to_regprocedure('public.sellerpilot_lzd_store_get_rcpt_r7(uuid,text,text,text,text,text,text)') is not null
     or to_regprocedure('public.sellerpilot_lzd_cas_current_src_r7(uuid,uuid,timestamptz,text,boolean,integer,timestamptz,text,text)') is not null then
    raise exception 'LAZADA_CREATE_R7_ALREADY_DEFINED';
  end if;
end $$;

create table sellerpilot_private.lazada_create_raw_receipts_r7 (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  receipt_kind text not null
    check (receipt_kind in ('post_create', 'get_recovery')),
  http_method text not null,
  http_path text not null,
  request_bytes text not null check (char_length(request_bytes) > 1),
  response_bytes text not null check (char_length(response_bytes) > 1),
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  response_sha256 text not null check (response_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  constraint lazada_r7_receipt_kind_path check (
    (
      receipt_kind = 'post_create'
      and http_method = 'POST'
      and http_path = '/product/create'
    )
    or (
      receipt_kind = 'get_recovery'
      and http_method = 'GET'
      and http_path = '/product/item/get'
    )
  ),
  constraint lazada_r7_receipt_not_products_get check (
    http_path <> '/products/get'
  )
);

create unique index lazada_r7_one_post_receipt_per_job
  on sellerpilot_private.lazada_create_raw_receipts_r7 (job_id)
  where receipt_kind = 'post_create';

create function public.sellerpilot_lzd_store_post_rcpt_r7(
  p_job_id uuid,
  p_http_method text,
  p_http_path text,
  p_request_bytes text,
  p_response_bytes text,
  p_request_sha256 text,
  p_response_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_job_id is null
     or p_http_method is distinct from 'POST'
     or p_http_path is distinct from '/product/create'
     or p_http_path = '/products/get'
     or char_length(coalesce(p_request_bytes, '')) < 2
     or char_length(coalesce(p_response_bytes, '')) < 2
     or coalesce(p_request_sha256, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_response_sha256, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'LAZADA_MY_CREATE_POST_RECEIPT_REQUIRED' using errcode = '22023';
  end if;
  insert into sellerpilot_private.lazada_create_raw_receipts_r7 (
    job_id, receipt_kind, http_method, http_path,
    request_bytes, response_bytes, request_sha256, response_sha256
  ) values (
    p_job_id,
    'post_create',
    p_http_method,
    p_http_path,
    p_request_bytes,
    p_response_bytes,
    p_request_sha256,
    p_response_sha256
  )
  returning id into v_id;
  return v_id;
end;
$$;

create function public.sellerpilot_lzd_store_get_rcpt_r7(
  p_job_id uuid,
  p_http_method text,
  p_http_path text,
  p_request_bytes text,
  p_response_bytes text,
  p_request_sha256 text,
  p_response_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_http_path = '/products/get'
     or p_http_method is distinct from 'GET'
     or p_http_path is distinct from '/product/item/get'
     or coalesce(p_response_bytes, '') like '%"sku_list"%' then
    raise exception 'LAZADA_MY_CREATE_GET_RECOVERY_SYNTHETIC_CREATE' using errcode = '22023';
  end if;
  if p_job_id is null
     or char_length(coalesce(p_request_bytes, '')) < 2
     or char_length(coalesce(p_response_bytes, '')) < 2
     or coalesce(p_request_sha256, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_response_sha256, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'LAZADA_MY_CREATE_GET_RECOVERY_RECEIPT_REQUIRED' using errcode = '22023';
  end if;
  insert into sellerpilot_private.lazada_create_raw_receipts_r7 (
    job_id, receipt_kind, http_method, http_path,
    request_bytes, response_bytes, request_sha256, response_sha256
  ) values (
    p_job_id,
    'get_recovery',
    p_http_method,
    p_http_path,
    p_request_bytes,
    p_response_bytes,
    p_request_sha256,
    p_response_sha256
  )
  returning id into v_id;
  return v_id;
end;
$$;

create function public.sellerpilot_lzd_cas_current_src_r7(
  p_product_id uuid,
  p_listing_id uuid,
  p_product_updated_at timestamptz,
  p_product_status text,
  p_product_demo boolean,
  p_product_on_hand integer,
  p_listing_updated_at timestamptz,
  p_listing_status text,
  p_listing_remote_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_status text;
  v_product_demo boolean;
  v_product_on_hand integer;
  v_product_updated_at timestamptz;
  v_listing_status text;
  v_listing_remote_id text;
  v_listing_updated_at timestamptz;
begin
  if p_product_id is null or p_listing_id is null then
    raise exception 'LAZADA_MY_CREATE_CURRENT_SOURCE_INVALID' using errcode = '22023';
  end if;

  select product.status, product.demo, product.on_hand, product.updated_at
    into v_product_status, v_product_demo, v_product_on_hand, v_product_updated_at
    from sellerpilot_private.products product
   where product.id = p_product_id
   for update;
  if not found then
    raise exception 'LAZADA_MY_CREATE_CURRENT_SOURCE_INVALID';
  end if;

  select listing.status, listing.remote_id, listing.updated_at
    into v_listing_status, v_listing_remote_id, v_listing_updated_at
    from sellerpilot_private.product_listings listing
   where listing.id = p_listing_id
     and listing.product_id = p_product_id
     and listing.channel_key = 'lazada'
   for update;
  if not found then
    raise exception 'LAZADA_MY_CREATE_CURRENT_SOURCE_INVALID';
  end if;

  if v_product_updated_at is distinct from p_product_updated_at
     or v_listing_updated_at is distinct from p_listing_updated_at
     or v_product_status is distinct from p_product_status
     or v_product_demo is distinct from p_product_demo
     or v_product_on_hand is distinct from p_product_on_hand
     or v_listing_status is distinct from p_listing_status
     or v_listing_remote_id is distinct from nullif(p_listing_remote_id, '') then
    raise exception 'LAZADA_MY_CREATE_CURRENT_SOURCE_DRIFT';
  end if;
  return true;
end;
$$;

revoke all on function public.sellerpilot_lzd_store_post_rcpt_r7(uuid,text,text,text,text,text,text) from public;
revoke all on function public.sellerpilot_lzd_store_get_rcpt_r7(uuid,text,text,text,text,text,text) from public;
revoke all on function public.sellerpilot_lzd_cas_current_src_r7(uuid,uuid,timestamptz,text,boolean,integer,timestamptz,text,text) from public;
grant execute on function public.sellerpilot_lzd_store_post_rcpt_r7(uuid,text,text,text,text,text,text) to service_role;
grant execute on function public.sellerpilot_lzd_store_get_rcpt_r7(uuid,text,text,text,text,text,text) to service_role;
grant execute on function public.sellerpilot_lzd_cas_current_src_r7(uuid,uuid,timestamptz,text,boolean,integer,timestamptz,text,text) to service_role;

commit;
