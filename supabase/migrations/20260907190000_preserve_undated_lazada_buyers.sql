-- Forward-only extension of the reviewed bounded unordered-message store.
-- Deploy before the receiver uses the explicit v3 readiness fence.
begin;
do $migration$
declare
  original_definition text;
  before_clause text := 'if e->>''orderingStatus''=''unverified'' and (role<>''seller'' or coalesce(e->>''receivedAt'','''')<>'''') then pc:=pc+1; continue; end if;';
  after_clause text := 'if e->>''orderingStatus''=''unverified'' and coalesce(e->>''receivedAt'','''')<>'''' then pc:=pc+1; continue; end if;';
begin
  if (select count(*) from pg_proc p where
    (p.oid,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')) in (
      (to_regprocedure('public.sellerpilot_service_ingest_lazada_inquiries_v2(uuid,jsonb)'), '06e37744d997fa0495180f156e227f0f75f0bc660b4fecf6df8e014bb00492f6'),
      (to_regprocedure('public.sellerpilot_service_lazada_quarantine_ready()'), 'd95892506adc2c70423d1da857139277282327979577841606470f7c0989f26a'),
      (to_regprocedure('public.sellerpilot_prune_personal_data(timestamptz)'), '16d7e35db9d15ec2b6c0569cdc080af59874e0a3390617e48f4b29317cee43c8')
    ) and p.prosecdef and p.proowner='postgres'::regrole and p.proconfig=array['search_path=""']::text[]
      and cardinality(p.proacl)=2 and p.proacl @> array['postgres=X/postgres','service_role=X/postgres']::aclitem[]
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')
      and has_function_privilege('service_role',p.oid,'EXECUTE')) <> 3 then
    raise exception 'LAZADA_UNDATED_BUYER_PREIMAGE_REVIEW_REQUIRED';
  end if;
  if to_regprocedure('public.sellerpilot_service_lazada_quarantine_ready_v3()') is not null then
    raise exception 'LAZADA_UNDATED_BUYER_VERSION_ALREADY_EXISTS';
  end if;
  select pg_get_functiondef('public.sellerpilot_service_ingest_lazada_inquiries_v2(uuid,jsonb)'::regprocedure)
    into original_definition;
  if (length(original_definition)-length(replace(original_definition,before_clause,''))) / length(before_clause) <> 1 then
    raise exception 'LAZADA_UNDATED_BUYER_TRANSFORM_REQUIRED';
  end if;
  -- The preceding native role whitelist still permits only customer/seller.
  -- Identity certification, exact originals, deletion tombstones, per-owner
  -- capacity/locking, partial receipts, dedup and expiry remain byte-identical.
  execute replace(original_definition,before_clause,after_clause);
end
$migration$;

comment on table sellerpilot_private.lazada_unordered_messages is
  'Customer or seller text with unknown/conflicting send evidence, never an inbound/reply/approval event. Minimal original body, no customer names or provider envelope. Seven-day observation retention; no replay extension. Max 1000 rows per owner. Explicit operator review only, no automatic promotion.';

create function public.sellerpilot_service_lazada_quarantine_ready_v3()
returns boolean language sql stable security definer set search_path = '' as $$ select true $$;
revoke all on function public.sellerpilot_service_lazada_quarantine_ready_v3() from public,anon,authenticated;
grant execute on function public.sellerpilot_service_lazada_quarantine_ready_v3() to service_role;
commit;
