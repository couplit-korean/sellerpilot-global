-- Parent-only operational application. Worker is already running: applying can consume immediately.
-- One existing Coupang categories.suggest only; no enqueue/retry/state/lease mutation.
-- Preserve installed220000 Smartstore exception and original recovery/other-channel/running/recon locks.
-- Requires disabled serverless Coupang policy; do not enable policy or forge egress headers.
-- Shared admin workspace: pin authenticated request actor independently from service-token issuer.
-- Credential creator remains storage lineage; do not substitute it for the request actor.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
select pg_catalog.pg_advisory_xact_lock(193674993,900622000);
do $migration$
declare s text; patched text;
old_predicate constant text := $old$j.channel in ('coupang', 'temu')$old$;
new_predicate constant text := $new$(j.channel = 'temu' or (j.channel = 'coupang' and not coalesce((
                   j.id = '3af980f7-d7d9-4882-a261-ec8461321c25'::uuid
                   and j.attempt_id = '97ef985c-7c2d-4885-8ec0-d373ee2d890f'::uuid
                   and j.credential_id = '32de2968-d4b7-4fda-a84b-16a7ce0257cc'::uuid
                   and j.operation = 'categories.suggest' and j.environment = 'production'
                   and j.status = 'queued' and j.attempt_count = 0
                   and j.started_at is null and j.completed_at is null
                   and j.provider_mutation_started_at is null
                   and j.worker_token_id is null and j.claim_token is null and j.lease_expires_at is null
                   and j.credential_refresh_in_flight is false
                   and j.credential_refresh_recovery_vault_id is null
                   and j.prepared_credential_id is null and j.oauth_exchange_completed is false
                   and j.request_payload#>>'{arguments,query}' = '[SELLERPILOT_LOCALIZATION_REVIEW_REQUIRED] 롯데 롯샌 파스퇴르 순우유맛 315g (6봉입) - 구매 전 확인'
                   and c.id = j.credential_id and c.channel = j.channel and c.environment = j.environment
                   and c.created_by = j.created_by
                   and c.created_by = '21eb1892-0894-4f9f-b414-4c9464182dd6'::uuid and c.status = 'active'
                   and (c.expires_at is null or c.expires_at > clock_timestamp())
                   and j.seller_account_key is not distinct from c.seller_account_key
                   and p_worker_version = 'sellerpilot-cli-worker/1.60'
                   and exists (
                     select 1 from sellerpilot_private.serverless_static_egress_policy policy
                     where policy.channel = 'coupang' and policy.enabled is false
                   )
                   and exists (
                     select 1 from sellerpilot_private.ai_cli_worker_tokens bound_token
                     join sellerpilot_private.channel_operation_attempts a
                       on a.id = j.attempt_id
                       and a.owner_id = '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid
                     where bound_token.id = v_token_id
                       and bound_token.id = '02955cb4-fa9f-466b-824f-b61f06276190'::uuid
                       and bound_token.created_by = '7f448e38-f86f-4749-bc5f-cecf6d0723e5'::uuid
                       and bound_token.token_hash = p_token_hash
                       and bound_token.scope = 'gateway' and bound_token.status = 'active'
                       and bound_token.expires_at > clock_timestamp()
                       and a.id = j.attempt_id and a.credential_id = j.credential_id
                       and a.channel = j.channel and a.operation = j.operation
                       and a.status = 'running' and a.remote_id is null
                   )
                 ), false)))$new$;
begin
s:=pg_get_functiondef('public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure);
if encode(sha256(convert_to(s,'UTF8')),'hex')='aefc3cd4d8c56c25d513d86c38ee3979c1fb9bb927f1f77996f3078bb504a5c7' then return; end if;
if encode(sha256(convert_to(s,'UTF8')),'hex')<>'e3badc98aeb7a95b349e3379d749078ae34b7fba1267232abad2a19a65283145' then raise exception 'COUPANG_BOUND_LOCAL_CATEGORY_SOURCE_DRIFT'; end if;
patched:=replace(s,old_predicate,new_predicate);
if encode(sha256(convert_to(patched,'UTF8')),'hex')<>'aefc3cd4d8c56c25d513d86c38ee3979c1fb9bb927f1f77996f3078bb504a5c7' then raise exception 'COUPANG_BOUND_LOCAL_CATEGORY_PATCH_MISMATCH'; end if;
execute patched;
s:=pg_get_functiondef('public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure);
if encode(sha256(convert_to(s,'UTF8')),'hex')<>'aefc3cd4d8c56c25d513d86c38ee3979c1fb9bb927f1f77996f3078bb504a5c7' then raise exception 'COUPANG_BOUND_LOCAL_CATEGORY_READBACK_MISMATCH'; end if;
end $migration$;
commit;
