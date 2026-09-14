-- Match the SmartStore local preclaim credential-source check to the existing
-- source snapshot, route, and provider preflight contracts. A credential
-- incarnation remains eligible only when its seller account was verified.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '25s';

do $forward$
declare
  definition text;
  old_condition constant text :=
    $condition$c.seller_account_key_source='provider_certified_v1' and c.seller_account_verified_at is not null$condition$;
  new_condition constant text :=
    $condition$c.seller_account_key_source in ('provider_certified_v1','credential_incarnation_v1') and c.seller_account_verified_at is not null$condition$;
begin
  if (
    select md5(prosrc)
      from pg_proc
     where oid = 'sellerpilot_private.smartstore_approved_ai_local_claim_allowed(uuid,uuid,uuid,text,text,text)'::regprocedure
  ) is distinct from '935e2a83f8f03a3282f0304f1c4b3adb' then
    raise exception 'SMARTSTORE_INCARNATION_LOCAL_CLAIM_PREIMAGE_DRIFT';
  end if;

  definition := pg_get_functiondef(
    'sellerpilot_private.smartstore_approved_ai_local_claim_allowed(uuid,uuid,uuid,text,text,text)'::regprocedure
  );
  if (length(definition) - length(replace(definition, old_condition, '')))
       / length(old_condition) <> 1 then
    raise exception 'SMARTSTORE_INCARNATION_LOCAL_CLAIM_ANCHOR_DRIFT';
  end if;

  execute replace(definition, old_condition, new_condition);

  definition := pg_get_functiondef(
    'sellerpilot_private.smartstore_approved_ai_local_claim_allowed(uuid,uuid,uuid,text,text,text)'::regprocedure
  );
  if position(old_condition in definition) <> 0
     or (length(definition) - length(replace(definition, new_condition, '')))
          / length(new_condition) <> 1 then
    raise exception 'SMARTSTORE_INCARNATION_LOCAL_CLAIM_POSTCONDITION_FAILED';
  end if;
end
$forward$;

notify pgrst, 'reload schema';
commit;
