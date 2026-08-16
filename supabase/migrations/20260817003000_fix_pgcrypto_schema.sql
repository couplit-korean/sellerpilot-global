-- Supabase installs pgcrypto in the extensions schema. Existing credential
-- functions used an unqualified digest() call while pinning search_path, so
-- live credential writes failed even though the extension was installed.

begin;

alter function public.sellerpilot_rotate_credential(
  text, text, jsonb, timestamptz, integer, integer, integer
) set search_path = pg_catalog, public, sellerpilot_private, vault, extensions;

alter function public.sellerpilot_service_refresh_lazada(
  uuid, jsonb, timestamptz
) set search_path = pg_catalog, public, sellerpilot_private, vault, extensions;

alter function public.sellerpilot_service_refresh_ebay(
  uuid, jsonb, timestamptz
) set search_path = pg_catalog, public, sellerpilot_private, vault, extensions;

alter function public.sellerpilot_service_refresh_shopee(
  uuid, jsonb, timestamptz
) set search_path = pg_catalog, public, sellerpilot_private, vault, extensions;

commit;
