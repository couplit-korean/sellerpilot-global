begin;

do $$
declare
  v_updated integer;
begin
  update storage.buckets
     set public = false,
         file_size_limit = 20971520,
         allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
   where id = 'sellerpilot-ai';

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'sellerpilot-ai storage bucket is missing';
  end if;
end;
$$;

commit;
