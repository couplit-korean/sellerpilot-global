do $test$
declare
 owner uuid := '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c';
 job uuid; token uuid; token_hash text; ids text[]; paths jsonb; lineage jsonb; entries jsonb; entry jsonb; result jsonb; role text; ordinal int; total int;
begin
 perform set_config('request.jwt.claim.sub',owner::text,true);
 select id,t.token_hash into token,token_hash from sellerpilot_private.ai_cli_worker_tokens t where t.status='active' and t.scope='ai' and t.expires_at>now() limit 1;
 if token is null then raise exception 'TEST_WORKER_MISSING';end if;
 foreach total in array array[8,6] loop
  job:=gen_random_uuid();
  ids:=array['portrait','wide','detail-overview','detail-use','detail-routine','detail-scale','detail-storage','detail-context']; ids:=ids[1:total];
  paths:='{}';lineage:='{}';entries:='[]';ordinal:=0;
  foreach role in array ids loop
   ordinal:=ordinal+1;
   paths:=paths||jsonb_build_object(role,'tests/unified-'||job||'/'||role||'.png');
   lineage:=lineage||jsonb_build_object(role,jsonb_build_object('auditMode','source-photo-catalog','digest',repeat('a',64),'sourceRole','main'));
   insert into storage.objects(bucket_id,name) values('sellerpilot-ai',paths->>role);
   entry:=jsonb_build_object('id',role,'path',paths->>role,'digest',repeat(to_hex(ordinal),64),'bytes',100,'width',case when role in ('wide','detail-context') then 1600 else 1200 end,'height',case when role in ('wide','detail-context') then 900 when role='detail-scale' then 1200 else 1500 end);
   entries:=entries||jsonb_build_array(entry);
  end loop;
  insert into sellerpilot_private.ai_cli_jobs(id,kind,status,created_by,request_payload,result_payload) values(job,'product_research','succeeded',owner,'{}',jsonb_build_object('asset_storage_paths',paths,'preflightAssetLineage',lineage));
  result:=public.sellerpilot_enqueue_first_draft_image_request(job);
  if result->>'status'<>'queued' then raise exception 'ENQUEUE_%_%',total,result;end if;
  update sellerpilot_private.first_draft_image_requests set status='generating',worker_token_id=token where job_id=job;
  for ordinal in 0..total-1 loop
   result:=public.sellerpilot_service_record_first_draft_image_assets(token_hash,job,jsonb_build_array(entries->ordinal));
   if result is null then raise exception 'RECORD_NULL_%_%',total,ordinal;end if;
   if ordinal<total-1 and result->>'status'<>'recorded' then raise exception 'PREMATURE_COMPLETION_%_%',total,ordinal;end if;
  end loop;
  if result->>'status'<>'done' then raise exception 'NOT_DONE_%',total;end if;
  if (select count(*) from jsonb_object_keys(result->'result'->'preflightAssetLineage'))<>total then raise exception 'MISSING_IMAGE_%',total;end if;
 end loop;
end;$test$;
select 'eight-role completion and legacy six-role completion passed' as verification;
rollback;
