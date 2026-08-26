-- Keep the persisted Puck allowlist aligned with the evidence-first renderer.
-- This forward migration replaces only the validator body; ownership, version
-- fencing, audit logging and grants remain unchanged.

begin;

create or replace function public.sellerpilot_save_product_detail_page(
  p_product_id uuid,
  p_data jsonb,
  p_expected_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product sellerpilot_private.products%rowtype;
  v_next_version bigint;
  v_updated_at timestamptz := clock_timestamp();
begin
  if auth.uid() is null or not public.sellerpilot_is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_product_id is null
     or p_data is null
     or jsonb_typeof(p_data) <> 'object'
     or octet_length(p_data::text) > 262144
     or jsonb_typeof(p_data->'root') is distinct from 'object'
     or jsonb_typeof(p_data->'content') is distinct from 'array'
     or jsonb_array_length(p_data->'content') > 64
     or exists (
       select 1
         from jsonb_array_elements(p_data->'content') block
        where jsonb_typeof(block) is distinct from 'object'
           or coalesce(block->>'type', '') not in (
             'HeroBlock',
             'VerificationRibbonBlock',
             'BenefitBlock',
             'ImageStoryBlock',
             'StoryBlock',
             'CtaBlock'
           )
           or jsonb_typeof(block->'props') is distinct from 'object'
           or length(trim(coalesce(block->'props'->>'id', ''))) not between 1 and 120
     )
     or (
       select count(*) <> count(distinct block->'props'->>'id')
         from jsonb_array_elements(p_data->'content') block
     ) then
    raise exception 'DETAIL_PAGE_INVALID';
  end if;

  select product.* into v_product
    from sellerpilot_private.products product
   where product.id = p_product_id
     and product.owner_id = auth.uid()
     and not product.demo
     and product.status <> 'archived'
   for update;
  if not found then return null; end if;

  if (p_expected_version is null and v_product.detail_page_version <> 0)
     or (
       p_expected_version is not null
       and p_expected_version <> v_product.detail_page_version
     ) then
    raise exception 'DETAIL_PAGE_VERSION_CONFLICT' using errcode = '40001';
  end if;

  v_next_version := v_product.detail_page_version + 1;
  update sellerpilot_private.products product
     set detail_page_data = p_data,
         detail_page_version = v_next_version,
         detail_page_updated_at = v_updated_at,
         updated_at = v_updated_at
   where product.id = p_product_id;

  insert into sellerpilot_private.operation_audit (
    owner_id, action, entity_type, entity_id, safe_detail
  ) values (
    auth.uid(),
    'product_detail_page_saved',
    'product',
    p_product_id::text,
    jsonb_build_object(
      'version', v_next_version,
      'block_count', jsonb_array_length(p_data->'content'),
      'document_bytes', octet_length(p_data::text)
    )
  );

  return jsonb_build_object(
    'productId', p_product_id,
    'data', p_data,
    'version', v_next_version,
    'updatedAt', v_updated_at
  );
end;
$$;

revoke all on function public.sellerpilot_save_product_detail_page(uuid, jsonb, bigint)
  from public, anon;
grant execute on function public.sellerpilot_save_product_detail_page(uuid, jsonb, bigint)
  to authenticated;

commit;
