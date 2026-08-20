-- Authenticate the existing fixed-IP SellerPilot worker before it requests a
-- periodic order/inquiry collection pass. The raw worker token never reaches
-- the database; only its SHA-256 hash is checked.

begin;

create or replace function public.sellerpilot_service_validate_worker_token(
  p_token_hash text,
  p_worker_version text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, sellerpilot_private
as $$
declare
  v_updated integer;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  update sellerpilot_private.ai_cli_worker_tokens
     set last_seen_at = now(),
         last_version = left(nullif(trim(p_worker_version), ''), 80)
   where token_hash = p_token_hash
     and status = 'active'
     and expires_at > now();
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.sellerpilot_service_validate_worker_token(text, text)
  from public, anon, authenticated;
grant execute on function public.sellerpilot_service_validate_worker_token(text, text)
  to service_role;

commit;
