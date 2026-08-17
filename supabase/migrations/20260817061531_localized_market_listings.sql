-- Expose only AI-generated localized sales copy in the authenticated product
-- publishing context. Raw job requests and worker metadata remain private.

begin;

create or replace function public.sellerpilot_get_product_publish_context(p_product_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
  select jsonb_build_object(
    'product', jsonb_build_object(
      'id', p.id,
      'externalCode', p.external_code,
      'sku', p.sku,
      'name', p.name,
      'description', p.description,
      'sourceUrl', p.source_url,
      'status', p.status,
      'onHand', p.on_hand,
      'costKrw', p.cost_krw
    ),
    'sourceImagePaths', coalesce(j.request_payload->'image_paths', '[]'::jsonb),
    'generatedImagePaths', coalesce(j.result_payload->'asset_storage_paths', '{}'::jsonb),
    'localizedListings', coalesce(j.result_payload->'localizedListings', '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'channel', a.channel,
        'environment', a.environment,
        'market', a.market,
        'categoryId', a.category_id,
        'categoryPath', a.category_path,
        'providedAttributes', a.provided_attributes,
        'status', a.status,
        'confirmedAt', a.confirmed_at
      ) order by a.channel, a.market)
        from sellerpilot_private.product_category_assignments a
       where a.owner_id = auth.uid()
         and a.product_id = p.id
    ), '[]'::jsonb),
    'listings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'channel', l.channel_key,
        'remoteId', l.remote_id,
        'status', l.status,
        'currency', l.currency,
        'price', l.price,
        'lastError', l.last_error,
        'updatedAt', l.updated_at
      ) order by l.channel_key)
        from sellerpilot_private.product_listings l
       where l.owner_id = auth.uid()
         and l.product_id = p.id
    ), '[]'::jsonb)
  )
    from sellerpilot_private.products p
    left join sellerpilot_private.ai_cli_jobs j on j.id = p.ai_job_id
   where public.sellerpilot_is_admin()
     and p.id = p_product_id
     and p.owner_id = auth.uid()
     and not p.demo
$$;

revoke all on function public.sellerpilot_get_product_publish_context(uuid) from public, anon;
grant execute on function public.sellerpilot_get_product_publish_context(uuid) to authenticated;

commit;
