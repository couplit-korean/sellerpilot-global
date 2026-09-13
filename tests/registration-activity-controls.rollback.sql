-- Run after applying the migration, with the isolated fixtures rolled back. No provider calls.
begin;
select set_config('request.jwt.claim.sub','768ce4ac-0ef2-4e01-89dc-05aa4fa8543c',true);
do $test$
declare owner uuid:=auth.uid(); queued uuid:=gen_random_uuid(); running uuid:=gen_random_uuid(); research uuid:=gen_random_uuid();
 product uuid:=gen_random_uuid(); newjob uuid:=gen_random_uuid(); cred uuid; chan text; attempt uuid:=gen_random_uuid(); listing uuid:=gen_random_uuid(); gateway uuid:=gen_random_uuid();
 active_product uuid:=gen_random_uuid(); active_attempt uuid:=gen_random_uuid(); active_listing uuid:=gen_random_uuid(); active_gateway uuid:=gen_random_uuid();
 result jsonb; failed boolean; before_receipts bigint; after_receipts bigint;
begin
 insert into sellerpilot_private.ai_cli_jobs(id,kind,status,request_payload,created_by,claim_token) values
 (queued,'product_studio','queued','{}',owner,null),(running,'product_studio','running','{}',owner,gen_random_uuid()),(research,'product_research','succeeded','{}',owner,null);
 insert into sellerpilot_private.first_draft_image_requests(job_id,owner_id,status) values(research,owner,'generating');
 perform public.sellerpilot_control_registration_activity('job:'||queued,'stop');
 if (select status from sellerpilot_private.ai_cli_jobs where id=queued)<>'cancelled' then raise exception 'QUEUED_NOT_CANCELLED';end if;
 perform public.sellerpilot_control_registration_activity('job:'||running,'stop');
 if (select status from sellerpilot_private.ai_cli_jobs where id=running)<>'cancelled' then raise exception 'RUNNING_NOT_CANCELLED';end if;
 perform public.sellerpilot_control_registration_activity('research:'||research,'stop');
 if (select status from sellerpilot_private.first_draft_image_requests where job_id=research)<>'cancelled' then raise exception 'FIRST_DRAFT_NOT_CANCELLED';end if;
 failed:=false;
 begin update sellerpilot_private.ai_cli_jobs set status='queued' where id=queued; exception when raise_exception then failed:=sqlerrm='REGISTRATION_ACTIVITY_STOPPED';end;
 if not failed then raise exception 'RETRY_FENCE_MISSING';end if;
 failed:=false;
 begin insert into sellerpilot_private.ai_cli_jobs(id,kind,request_payload,created_by) values(gen_random_uuid(),'product_studio',jsonb_build_object('source_research_job_id',research),owner);
 exception when raise_exception then failed:=sqlerrm='REGISTRATION_ACTIVITY_STOPPED';end;
 if not failed then raise exception 'DELETED_SOURCE_REUSED';end if;
 perform public.sellerpilot_control_registration_activity('job:'||queued,'delete');
 if exists(select 1 from jsonb_array_elements(public.sellerpilot_list_registration_activity(300)) c where c->>'id'='job:'||queued) then raise exception 'DELETED_CARD_VISIBLE';end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
 failed:=false;begin perform public.sellerpilot_control_registration_activity('job:'||running,'delete');exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'OWNER_FENCE_MISSING';end if;
 perform set_config('request.jwt.claim.sub',owner::text,true);
 insert into sellerpilot_private.products(id,owner_id,external_code,sku,name,demo) values(product,owner,'CONTROL-'||product,'CONTROL-'||product,'등록 중지 롤백 검증',false);
 select credential_id,channel into cred,chan from sellerpilot_private.channel_operation_attempts where owner_id=owner limit 1;
 insert into sellerpilot_private.channel_operation_attempts(id,owner_id,credential_id,channel,operation,idempotency_key,request_fingerprint,status)
 values(attempt,owner,cred,chan,'listing.create','control-test-'||attempt,repeat('a',64),'running');
 insert into sellerpilot_private.product_listings(id,owner_id,product_id,channel_key,status,operation_attempt_id) values(listing,owner,product,chan,'queued',attempt);
 insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,channel,operation,environment,created_by,attempt_id,status,request_payload,claim_token)
 values(gateway,cred,chan,'listing.create','production',owner,attempt,'queued','{}',null);
 perform public.sellerpilot_control_registration_activity('product:'||product,'stop');
 if (select status from sellerpilot_private.channel_gateway_jobs where id=gateway)<>'cancelled' then raise exception 'GATEWAY_QUEUED_NOT_CANCELLED';end if;
 failed:=false;begin update sellerpilot_private.channel_gateway_jobs set status='running' where id=gateway;exception when raise_exception then failed:=sqlerrm='REGISTRATION_ACTIVITY_STOPPED';end;
 if not failed then raise exception 'GATEWAY_RECLAIM_NOT_FENCED';end if;
 insert into sellerpilot_private.products(id,owner_id,external_code,sku,name,demo) values(active_product,owner,'CONTROL-'||active_product,'CONTROL-'||active_product,'실행 결과 보존 롤백 검증',false);
 insert into sellerpilot_private.channel_operation_attempts(id,owner_id,credential_id,channel,operation,idempotency_key,request_fingerprint,status)
 values(active_attempt,owner,cred,chan,'listing.create','control-test-'||active_attempt,repeat('b',64),'running');
 insert into sellerpilot_private.product_listings(id,owner_id,product_id,channel_key,status,operation_attempt_id) values(active_listing,owner,active_product,chan,'queued',active_attempt);
 insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,channel,operation,environment,created_by,attempt_id,status,request_payload,claim_token)
 values(active_gateway,cred,chan,'listing.create','production',owner,active_attempt,'running','{}',gen_random_uuid());
 result:=public.sellerpilot_control_registration_activity('product:'||active_product,'stop');
 if (result->>'inFlight')::int<>1 or (select status from sellerpilot_private.channel_gateway_jobs where id=active_gateway)<>'running' then raise exception 'IN_FLIGHT_OUTCOME_DESTROYED';end if;
 if not exists(select 1 from jsonb_array_elements(public.sellerpilot_list_registration_activity(300)) c where c->>'id'='product:'||active_product and c->>'controlState'='stopping') then raise exception 'STOPPING_STATUS_MISSING';end if;
 update sellerpilot_private.channel_gateway_jobs set status='reconciliation_required',completed_at=clock_timestamp() where id=active_gateway;
 update sellerpilot_private.channel_operation_attempts set status='manual_required',completed_at=clock_timestamp() where id=active_attempt;
 select count(*) into before_receipts from sellerpilot_private.channel_gateway_jobs where status in ('succeeded','reconciliation_required');
 perform public.sellerpilot_control_registration_activity(null,'clear');
 if public.sellerpilot_list_registration_activity(300)<>'[]'::jsonb then raise exception 'CLEAR_NOT_EMPTY';end if;
 select count(*) into after_receipts from sellerpilot_private.channel_gateway_jobs where status in ('succeeded','reconciliation_required');
 if after_receipts<>before_receipts then raise exception 'PROVIDER_RECEIPTS_CHANGED';end if;
 insert into sellerpilot_private.ai_cli_jobs(id,kind,request_payload,created_by) values(newjob,'product_research','{}',owner);
 if not exists(select 1 from jsonb_array_elements(public.sellerpilot_list_registration_activity(300)) c where c->>'id'='research:'||newjob and c->>'queueState'='queued') then raise exception 'NEW_RESEARCH_CARD_MISSING';end if;
end;$test$;
select 'passed' as registration_controls_transaction_tests;
rollback;
