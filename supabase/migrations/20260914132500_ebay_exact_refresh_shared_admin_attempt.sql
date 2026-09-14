-- The actual category attempt belongs to the authenticated shared admin,
-- while credentials and gateway jobs retain their original creator lineage.
-- Match sellerpilot_verify_channel_credential_owner_v1's existing shared-admin
-- policy: current admin membership grants access, not equality with created_by.
-- This service-only incident RPC does not impersonate auth.uid(), grant a role,
-- change either owner, or claim that service access is a user login.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
do $patch$
declare
  target regprocedure:='public.sellerpilot_service_store_ebay_exact_listing_refresh(uuid,jsonb,timestamptz)'::regprocedure;
  definition text;
  needle text;
  replacement text;
begin
  if (select md5(prosrc) from pg_proc where oid=target) is distinct from '03ece524ce771a6820b661b788bd2cd1' then
    raise exception 'EBAY_EXACT_SHARED_ADMIN_PREIMAGE_DRIFT'; end if;
  definition:=pg_get_functiondef(target);
  needle:='  select decrypted_secret::jsonb into old_payload from vault.decrypted_secrets where id=source.vault_secret_id;';
  replacement:=$replacement$  -- Exact existing actor, still approved under the official shared-admin
  -- membership rule. No ownership fields are changed during refresh.
  perform 1 from sellerpilot_private.admin_users
    where user_id='768ce4ac-0ef2-4e01-89dc-05aa4fa8543c' for share;
  if not found then raise exception 'EBAY_EXACT_REFRESH_SHARED_ADMIN_DENIED'; end if;
  select decrypted_secret::jsonb into old_payload from vault.decrypted_secrets where id=source.vault_secret_id;$replacement$;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'EBAY_EXACT_SHARED_ADMIN_POLICY_ANCHOR_DRIFT'; end if;
  definition:=replace(definition,needle,replacement);
  needle:='and owner_id=source.created_by and channel=''ebay'' and operation=''categories.suggest''';
  replacement:='and owner_id=''768ce4ac-0ef2-4e01-89dc-05aa4fa8543c''::uuid and channel=''ebay'' and operation=''categories.suggest''';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'EBAY_EXACT_SHARED_ADMIN_ATTEMPT_ANCHOR_DRIFT'; end if;
  definition:=replace(definition,needle,replacement);
  needle:='and a.owner_id=source.created_by and a.seller_account_key=source.seller_account_key';
  replacement:='and a.owner_id=''768ce4ac-0ef2-4e01-89dc-05aa4fa8543c''::uuid and a.seller_account_key=source.seller_account_key';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'EBAY_EXACT_SHARED_ADMIN_READBACK_ANCHOR_DRIFT'; end if;
  execute replace(definition,needle,replacement);
end;
$patch$;
commit;
