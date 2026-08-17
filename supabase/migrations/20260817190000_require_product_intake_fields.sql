begin;

create or replace function public.sellerpilot_create_ai_job(
  p_id uuid,
  p_kind text,
  p_request_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_manual jsonb := p_request_payload->'manual_fields';
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_kind <> 'product_studio'
     or jsonb_typeof(p_request_payload) <> 'object'
     or jsonb_typeof(p_request_payload->'image_paths') <> 'array'
     or jsonb_array_length(p_request_payload->'image_paths') not between 1 and 100
     or jsonb_typeof(p_request_payload->'image_specs') <> 'array'
     or jsonb_array_length(p_request_payload->'image_specs') <> jsonb_array_length(p_request_payload->'image_paths')
     or jsonb_typeof(v_manual) <> 'object'
     or length(trim(coalesce(v_manual->>'productName', ''))) not between 2 and 160
     or trim(coalesce(v_manual->>'sellerSku', '')) !~ '^[A-Za-z0-9._-]{2,100}$'
     or length(trim(coalesce(v_manual->>'categoryHint', ''))) not between 2 and 120
     or length(trim(coalesce(v_manual->>'brandName', ''))) not between 1 and 120
     or length(trim(coalesce(v_manual->>'manufacturer', ''))) not between 1 and 160
     or length(trim(coalesce(v_manual->>'countryOfOrigin', ''))) not between 2 and 80
     or length(trim(coalesce(v_manual->>'material', ''))) not between 2 and 500
     or length(trim(coalesce(v_manual->>'packageContents', ''))) not between 2 and 500
     or length(trim(coalesce(v_manual->>'description', ''))) not between 20 and 4000
     or coalesce(v_manual->>'productUrl', '') !~ '^https?://'
     or coalesce(v_manual->>'imageRightsConfirmed', 'false') <> 'true'
     or coalesce(v_manual->>'productFactsConfirmed', 'false') <> 'true'
     or jsonb_typeof(v_manual->'sellingPrice') <> 'number'
     or (v_manual->>'sellingPrice')::numeric <= 0
     or jsonb_typeof(v_manual->'stock') <> 'number'
     or (v_manual->>'stock')::integer < 1
     or jsonb_typeof(v_manual->'weightKg') <> 'number'
     or (v_manual->>'weightKg')::numeric <= 0
     or octet_length(p_request_payload::text) > 65536 then
    raise exception 'invalid AI job payload';
  end if;

  insert into sellerpilot_private.ai_cli_jobs (id, kind, request_payload, created_by)
  values (p_id, p_kind, p_request_payload, auth.uid());

  insert into sellerpilot_private.ai_cli_audit (action, actor_user_id, job_id, safe_detail)
  values ('job_queued', auth.uid(), p_id, jsonb_build_object(
    'kind', p_kind,
    'image_count', jsonb_array_length(p_request_payload->'image_paths'),
    'seller_sku', v_manual->>'sellerSku'
  ));
  return p_id;
end;
$$;

create or replace function public.sellerpilot_create_product_from_ai_v2(p_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_id uuid := gen_random_uuid();
  v_suffix text := upper(substr(replace(p_job_id::text, '-', ''), 1, 10));
  v_manual jsonb;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  select j.request_payload->'manual_fields'
    into v_manual
    from sellerpilot_private.ai_cli_jobs j
   where j.id = p_job_id
     and j.created_by = auth.uid()
     and j.status = 'succeeded';

  if jsonb_typeof(v_manual) <> 'object'
     or length(trim(coalesce(v_manual->>'productName', ''))) not between 2 and 160
     or trim(coalesce(v_manual->>'sellerSku', '')) !~ '^[A-Za-z0-9._-]{2,100}$'
     or length(trim(coalesce(v_manual->>'description', ''))) not between 20 and 4000
     or coalesce(v_manual->>'productUrl', '') !~ '^https?://'
     or coalesce(v_manual->>'productFactsConfirmed', 'false') <> 'true' then
    raise exception 'invalid required product intake';
  end if;

  insert into sellerpilot_private.products (
    id, owner_id, external_code, sku, name, description, source_url,
    ai_job_id, status, on_hand, reorder_point, demo
  ) values (
    v_id, auth.uid(), 'SP-AI-' || v_suffix, upper(trim(v_manual->>'sellerSku')),
    trim(v_manual->>'productName'), trim(v_manual->>'description'), trim(v_manual->>'productUrl'),
    p_job_id, 'draft', (v_manual->>'stock')::integer, 10, false
  )
  on conflict (owner_id, ai_job_id) do update set
    sku = excluded.sku,
    name = excluded.name,
    description = excluded.description,
    source_url = excluded.source_url,
    on_hand = excluded.on_hand,
    updated_at = now()
  returning id into v_id;

  insert into sellerpilot_private.operation_audit (owner_id, action, entity_type, entity_id, safe_detail)
  values (auth.uid(), 'product_created_from_required_intake', 'product', v_id::text, jsonb_build_object(
    'job_id', p_job_id,
    'seller_sku', v_manual->>'sellerSku'
  ));
  return v_id;
end;
$$;

create or replace function public.sellerpilot_get_product_publish_context(p_product_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
  select jsonb_build_object(
    'product', jsonb_build_object(
      'id', p.id, 'externalCode', p.external_code, 'sku', p.sku,
      'name', p.name, 'description', p.description, 'sourceUrl', p.source_url,
      'status', p.status, 'onHand', p.on_hand, 'costKrw', p.cost_krw
    ),
    'manualFields', coalesce(j.request_payload->'manual_fields', '{}'::jsonb),
    'imageSpecs', coalesce(j.request_payload->'image_specs', '[]'::jsonb),
    'sourceImagePaths', coalesce(j.request_payload->'image_paths', '[]'::jsonb),
    'generatedImagePaths', coalesce(j.result_payload->'asset_storage_paths', '{}'::jsonb),
    'localizedListings', coalesce(j.result_payload->'localizedListings', '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'channel', a.channel, 'environment', a.environment,
        'market', a.market, 'categoryId', a.category_id, 'categoryPath', a.category_path,
        'providedAttributes', a.provided_attributes, 'status', a.status, 'confirmedAt', a.confirmed_at
      ) order by a.channel, a.market)
      from sellerpilot_private.product_category_assignments a
      where a.owner_id = auth.uid() and a.product_id = p.id
    ), '[]'::jsonb),
    'listings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'channel', l.channel_key, 'market', l.market, 'targetId', l.target_id,
        'remoteId', l.remote_id, 'status', l.status, 'currency', l.currency,
        'price', l.price, 'lastError', l.last_error, 'updatedAt', l.updated_at
      ) order by l.channel_key, l.market, l.target_id)
      from sellerpilot_private.product_listings l
      where l.owner_id = auth.uid() and l.product_id = p.id
    ), '[]'::jsonb)
  )
  from sellerpilot_private.products p
  left join sellerpilot_private.ai_cli_jobs j on j.id = p.ai_job_id
  where public.sellerpilot_is_admin() and p.id = p_product_id
    and p.owner_id = auth.uid() and not p.demo
$$;

revoke all on function public.sellerpilot_create_product_from_ai_v2(uuid) from public, anon;
grant execute on function public.sellerpilot_create_product_from_ai_v2(uuid) to authenticated;

commit;
