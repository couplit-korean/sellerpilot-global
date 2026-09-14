-- Preserve product-owner approval lineage while admitting the existing shared-admin credential model.
-- No claim, policy, TTL, provider, or job state is changed.
begin;
do $migration$
declare definition text; original text; target regprocedure;
begin
  target := 'public.sellerpilot_complete_smartstore_listing_create(text,uuid,uuid,text,text,jsonb)'::regprocedure;
  if (select md5(prosrc) from pg_proc where oid=target) <> '7f6d82070a103a4e198bfa1a6737d396' then
    raise exception 'SMARTSTORE_SHARED_ADMIN_PREIMAGE_DRIFT:sellerpilot_complete_smartstore_listing_create';
  end if;
  original := pg_get_functiondef(target);
  definition := original;
  if (length(definition)-length(replace(definition,$old$attempt.owner_id is distinct from job.created_by$old$,'')))/length($old$attempt.owner_id is distinct from job.created_by$old$) <> 1 then
    raise exception 'SMARTSTORE_SHARED_ADMIN_REPLACEMENT_DRIFT';
  end if;
  definition := replace(definition,$old$attempt.owner_id is distinct from job.created_by$old$,$new$not (attempt.owner_id = job.created_by or (
       exists(select 1 from sellerpilot_private.admin_users admin where admin.user_id = attempt.owner_id)
       and exists(select 1 from sellerpilot_private.channel_credentials shared_credential
         where shared_credential.id = job.credential_id and shared_credential.created_by = job.created_by)
     ))$new$);
  if (length(definition)-length(replace(definition,$old$listing.owner_id is distinct from job.created_by$old$,'')))/length($old$listing.owner_id is distinct from job.created_by$old$) <> 1 then
    raise exception 'SMARTSTORE_SHARED_ADMIN_REPLACEMENT_DRIFT';
  end if;
  definition := replace(definition,$old$listing.owner_id is distinct from job.created_by$old$,$new$listing.owner_id is distinct from attempt.owner_id$new$);
  if (length(definition)-length(replace(definition,$old$product.owner_id is distinct from job.created_by$old$,'')))/length($old$product.owner_id is distinct from job.created_by$old$) <> 1 then
    raise exception 'SMARTSTORE_SHARED_ADMIN_REPLACEMENT_DRIFT';
  end if;
  definition := replace(definition,$old$product.owner_id is distinct from job.created_by$old$,$new$product.owner_id is distinct from attempt.owner_id$new$);
  if (length(definition)-length(replace(definition,$old$transport.owner_id is distinct from job.created_by$old$,'')))/length($old$transport.owner_id is distinct from job.created_by$old$) <> 1 then
    raise exception 'SMARTSTORE_SHARED_ADMIN_REPLACEMENT_DRIFT';
  end if;
  definition := replace(definition,$old$transport.owner_id is distinct from job.created_by$old$,$new$transport.owner_id is distinct from attempt.owner_id$new$);
  execute definition;
  target := 'public.sellerpilot_service_stage_smartstore_create_transport(text,uuid,uuid,text,text,integer,text)'::regprocedure;
  if (select md5(prosrc) from pg_proc where oid=target) <> '0e6a8335bfcca30c4fe17f4cfbeb345a' then
    raise exception 'SMARTSTORE_SHARED_ADMIN_PREIMAGE_DRIFT:sellerpilot_service_stage_smartstore_create_transport';
  end if;
  original := pg_get_functiondef(target);
  definition := original;
  if (length(definition)-length(replace(definition,$old$attempt.owner_id is distinct from job.created_by$old$,'')))/length($old$attempt.owner_id is distinct from job.created_by$old$) <> 1 then
    raise exception 'SMARTSTORE_SHARED_ADMIN_REPLACEMENT_DRIFT';
  end if;
  definition := replace(definition,$old$attempt.owner_id is distinct from job.created_by$old$,$new$not (attempt.owner_id = job.created_by or (
       exists(select 1 from sellerpilot_private.admin_users admin where admin.user_id = attempt.owner_id)
       and exists(select 1 from sellerpilot_private.channel_credentials shared_credential
         where shared_credential.id = job.credential_id and shared_credential.created_by = job.created_by)
     ))$new$);
  if (length(definition)-length(replace(definition,$old$listing.owner_id is distinct from job.created_by$old$,'')))/length($old$listing.owner_id is distinct from job.created_by$old$) <> 1 then
    raise exception 'SMARTSTORE_SHARED_ADMIN_REPLACEMENT_DRIFT';
  end if;
  definition := replace(definition,$old$listing.owner_id is distinct from job.created_by$old$,$new$listing.owner_id is distinct from attempt.owner_id$new$);
  if (length(definition)-length(replace(definition,$old$product.owner_id is distinct from job.created_by$old$,'')))/length($old$product.owner_id is distinct from job.created_by$old$) <> 1 then
    raise exception 'SMARTSTORE_SHARED_ADMIN_REPLACEMENT_DRIFT';
  end if;
  definition := replace(definition,$old$product.owner_id is distinct from job.created_by$old$,$new$product.owner_id is distinct from attempt.owner_id$new$);
  execute definition;
  target := 'sellerpilot_private.smartstore_create_source_is_current(uuid,uuid)'::regprocedure;
  if (select md5(prosrc) from pg_proc where oid=target) <> '3b739931dc2c9d8e3ff37a52d98c8b1e' then
    raise exception 'SMARTSTORE_SHARED_ADMIN_PREIMAGE_DRIFT:smartstore_create_source_is_current';
  end if;
  original := pg_get_functiondef(target);
  definition := original;
  if (length(definition)-length(replace(definition,$old$    join sellerpilot_private.smartstore_create_category_attribute_sources source
      on source.owner_id = job.created_by$old$,'')))/length($old$    join sellerpilot_private.smartstore_create_category_attribute_sources source
      on source.owner_id = job.created_by$old$) <> 2 then
    raise exception 'SMARTSTORE_SHARED_ADMIN_REPLACEMENT_DRIFT';
  end if;
  definition := replace(definition,$old$    join sellerpilot_private.smartstore_create_category_attribute_sources source
      on source.owner_id = job.created_by$old$,$new$    join sellerpilot_private.channel_operation_attempts attempt
      on attempt.id = job.attempt_id
     and (attempt.owner_id = job.created_by or (
       exists(select 1 from sellerpilot_private.admin_users admin where admin.user_id = attempt.owner_id)
       and exists(select 1 from sellerpilot_private.channel_credentials shared_credential
         where shared_credential.id = job.credential_id and shared_credential.created_by = job.created_by)
     ))
    join sellerpilot_private.smartstore_create_category_attribute_sources source
      on source.owner_id = attempt.owner_id$new$);
  execute definition;
  target := 'sellerpilot_private.sp_60910031000_smartstore_source_before_category(uuid,uuid)'::regprocedure;
  if (select md5(prosrc) from pg_proc where oid=target) <> '0a5306defcb1f013ad73ecd976ce2c5f' then
    raise exception 'SMARTSTORE_SHARED_ADMIN_PREIMAGE_DRIFT:sp_60910031000_smartstore_source_before_category';
  end if;
  original := pg_get_functiondef(target);
  definition := original;
  if (length(definition)-length(replace(definition,$old$attempt.owner_id = job.created_by$old$,'')))/length($old$attempt.owner_id = job.created_by$old$) <> 1 then
    raise exception 'SMARTSTORE_SHARED_ADMIN_REPLACEMENT_DRIFT';
  end if;
  definition := replace(definition,$old$attempt.owner_id = job.created_by$old$,$new$(attempt.owner_id = job.created_by or (
       exists(select 1 from sellerpilot_private.admin_users admin where admin.user_id = attempt.owner_id)
       and exists(select 1 from sellerpilot_private.channel_credentials shared_credential
         where shared_credential.id = job.credential_id and shared_credential.created_by = job.created_by)
     ))$new$);
  execute definition;
end $migration$;
notify pgrst,'reload schema';
commit;
