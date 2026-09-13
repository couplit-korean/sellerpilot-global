begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

-- The first-draft completion route stores a JSON quality manifest beside its
-- PNGs. The original image-only bucket policy rejected that final write, after
-- the generated images themselves had already uploaded successfully.
-- Preserve the private bucket, size limit and every existing allowed MIME type.
do $migration$
declare
  v_bucket storage.buckets%rowtype;
begin
  select * into v_bucket from storage.buckets where id = 'sellerpilot-ai' for update;
  if not found then
    raise exception 'sellerpilot-ai bucket is required';
  end if;
  if v_bucket.public then
    raise exception 'sellerpilot-ai must remain private';
  end if;
  if v_bucket.allowed_mime_types is not null
     and not ('application/json' = any(v_bucket.allowed_mime_types)) then
    update storage.buckets
       set allowed_mime_types = array_append(v_bucket.allowed_mime_types, 'application/json')
     where id = v_bucket.id;
  end if;
end;
$migration$;
commit;
