-- Bind approved detail ownership to its authorized attempt, not the shared credential creator.
-- Preserve approval, digest, timestamp, locale, image and immutable-binding guards.
-- Verified in isolated PGlite: 27 cases including old failure reproduction and owner/credential negatives.
begin;
set local lock_timeout = '5s';
do $migration$
declare
  source text;
  patched text;
  old_predicate constant text := 'r.owner_id is distinct from new.created_by';
  new_predicate constant text := $predicate$(r.owner_id is distinct from p.owner_id or not exists (
   select 1 from sellerpilot_private.channel_operation_attempts a
   join sellerpilot_private.channel_credentials c on c.id=a.credential_id
   where a.id=new.attempt_id and a.owner_id=p.owner_id
     and a.credential_id=new.credential_id and a.channel=new.channel
     and a.operation=new.operation and c.created_by=new.created_by
 ))$predicate$;
begin
  source := pg_catalog.pg_get_functiondef('sellerpilot_private.guard_external_detail_gateway_source()'::regprocedure);
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(source, 'UTF8')), 'hex') = 'f86cc63050ff8dabe527b00ceab78b0164cf6c775520abdc01034a53fd6cbd9b' then
    return;
  end if;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(source, 'UTF8')), 'hex') <> '5105690e320024720e16c2607bcfa7f9c68af7660c8bf5679b432ab6d949212c' then
    raise exception 'EXTERNAL_DETAIL_OWNER_GUARD_SOURCE_DRIFT';
  end if;
  patched := pg_catalog.replace(source, old_predicate, new_predicate);
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(patched, 'UTF8')), 'hex') <> 'f86cc63050ff8dabe527b00ceab78b0164cf6c775520abdc01034a53fd6cbd9b' then
    raise exception 'EXTERNAL_DETAIL_OWNER_GUARD_PATCH_MISMATCH';
  end if;
  execute patched;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef('sellerpilot_private.guard_external_detail_gateway_source()'::regprocedure), 'UTF8')), 'hex') <> 'f86cc63050ff8dabe527b00ceab78b0164cf6c775520abdc01034a53fd6cbd9b' then
    raise exception 'EXTERNAL_DETAIL_OWNER_GUARD_READBACK_MISMATCH';
  end if;
end
$migration$;
commit;
