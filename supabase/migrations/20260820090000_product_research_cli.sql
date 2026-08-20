begin;

alter table sellerpilot_private.ai_cli_jobs
  drop constraint if exists ai_cli_jobs_kind_check;

alter table sellerpilot_private.ai_cli_jobs
  add constraint ai_cli_jobs_kind_check
  check (kind in ('product_studio', 'product_research'));

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
  v_research_input text := trim(coalesce(p_request_payload->>'research_input', ''));
  v_image_count integer := 0;
begin
  if not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  if p_kind = 'product_research' then
    if jsonb_typeof(p_request_payload) <> 'object'
       or length(v_research_input) not between 2 and 12000
       or octet_length(p_request_payload::text) > 50000 then
      raise exception 'invalid AI product research payload';
    end if;
  elsif p_kind = 'product_studio' then
    if jsonb_typeof(p_request_payload) <> 'object'
       or jsonb_typeof(p_request_payload->'image_paths') <> 'array'
       or jsonb_array_length(p_request_payload->'image_paths') not between 1 and 100
       or jsonb_typeof(p_request_payload->'image_specs') <> 'array'
       or jsonb_array_length(p_request_payload->'image_specs') <> jsonb_array_length(p_request_payload->'image_paths')
       or jsonb_typeof(v_manual) <> 'object'
       or length(trim(coalesce(v_manual->>'researchInput', ''))) not between 2 and 12000
       or length(trim(coalesce(v_manual->>'productName', ''))) not between 2 and 160
       or trim(coalesce(v_manual->>'sellerSku', '')) !~ '^[A-Za-z0-9._-]{2,100}$'
       or length(trim(coalesce(v_manual->>'categoryHint', ''))) not between 2 and 120
       or length(trim(coalesce(v_manual->>'brandName', ''))) not between 1 and 120
       or length(trim(coalesce(v_manual->>'manufacturer', ''))) not between 1 and 160
       or length(trim(coalesce(v_manual->>'countryOfOrigin', ''))) not between 2 and 80
       or length(trim(coalesce(v_manual->>'material', ''))) not between 2 and 500
       or length(trim(coalesce(v_manual->>'packageContents', ''))) not between 2 and 500
       or length(trim(coalesce(v_manual->>'description', ''))) not between 20 and 4000
       or (coalesce(v_manual->>'productUrl', '') <> '' and coalesce(v_manual->>'productUrl', '') !~ '^https?://')
       or coalesce(v_manual->>'imageRightsConfirmed', 'false') <> 'true'
       or coalesce(v_manual->>'productFactsConfirmed', 'false') <> 'true'
       or jsonb_typeof(v_manual->'sellingPrice') <> 'number'
       or (v_manual->>'sellingPrice')::numeric <= 0
       or jsonb_typeof(v_manual->'stock') <> 'number'
       or (v_manual->>'stock')::integer < 1
       or jsonb_typeof(v_manual->'weightKg') <> 'number'
       or (v_manual->>'weightKg')::numeric <= 0
       or octet_length(p_request_payload::text) > 131072 then
      raise exception 'invalid AI product studio payload';
    end if;
    v_image_count := jsonb_array_length(p_request_payload->'image_paths');
  else
    raise exception 'unsupported AI job kind';
  end if;

  insert into sellerpilot_private.ai_cli_jobs (id, kind, request_payload, created_by)
  values (p_id, p_kind, p_request_payload, auth.uid());

  insert into sellerpilot_private.ai_cli_audit (action, actor_user_id, job_id, safe_detail)
  values ('job_queued', auth.uid(), p_id, jsonb_build_object(
    'kind', p_kind,
    'image_count', v_image_count,
    'seller_sku', case when jsonb_typeof(v_manual) = 'object' then v_manual->>'sellerSku' else null end
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
     and j.kind = 'product_studio'
     and j.created_by = auth.uid()
     and j.status = 'succeeded';

  if jsonb_typeof(v_manual) <> 'object'
     or length(trim(coalesce(v_manual->>'productName', ''))) not between 2 and 160
     or trim(coalesce(v_manual->>'sellerSku', '')) !~ '^[A-Za-z0-9._-]{2,100}$'
     or length(trim(coalesce(v_manual->>'description', ''))) not between 20 and 4000
     or (coalesce(v_manual->>'productUrl', '') <> '' and coalesce(v_manual->>'productUrl', '') !~ '^https?://')
     or coalesce(v_manual->>'productFactsConfirmed', 'false') <> 'true' then
    raise exception 'invalid required product intake';
  end if;

  insert into sellerpilot_private.products (
    id, owner_id, external_code, sku, name, description, source_url,
    ai_job_id, status, on_hand, reorder_point, demo
  ) values (
    v_id, auth.uid(), 'SP-AI-' || v_suffix, upper(trim(v_manual->>'sellerSku')),
    trim(v_manual->>'productName'), trim(v_manual->>'description'), nullif(trim(v_manual->>'productUrl'), ''),
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

revoke all on function public.sellerpilot_create_ai_job(uuid, text, jsonb) from public, anon;
grant execute on function public.sellerpilot_create_ai_job(uuid, text, jsonb) to authenticated;
revoke all on function public.sellerpilot_create_product_from_ai_v2(uuid) from public, anon;
grant execute on function public.sellerpilot_create_product_from_ai_v2(uuid) to authenticated;

commit;
