begin;
create table sellerpilot_private.cs_recovery_drills(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id)on delete cascade,
 channel text,scope_key text not null check(length(scope_key)between 1 and 240),
 drill text not null check(drill in('raw_restart','provider_429','provider_5xx','reply_timeout_unknown','token_expiry','permission_revoked','attachment_expired','daily_restart','backup_restore','delete_and_recollect','admin_revoked')),
 result text not null check(result in('passed','failed','inconclusive')),evidence_digest text not null check(evidence_digest~'^[a-f0-9]{64}$'),
 safe_detail jsonb not null default'{}'::jsonb check(jsonb_typeof(safe_detail)='object'and octet_length(safe_detail::text)<=8192),
 observed_at timestamptz not null,recorded_by uuid not null references auth.users(id)on delete restrict,created_at timestamptz not null default clock_timestamp(),
 unique(owner_id,channel,scope_key,drill,evidence_digest)
);
alter table sellerpilot_private.cs_recovery_drills enable row level security;revoke all on sellerpilot_private.cs_recovery_drills from public,anon,authenticated,service_role;
create index cs_recovery_drills_readiness_idx on sellerpilot_private.cs_recovery_drills(owner_id,drill,result,observed_at desc);
create function public.sellerpilot_record_cs_recovery_drill_v1(p_channel text,p_scope_key text,p_drill text,p_result text,p_evidence_digest text,p_safe_detail jsonb,p_observed_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;begin
 if auth.uid()is null or public.sellerpilot_is_admin()is distinct from true then raise exception'administrator access required'using errcode='42501';end if;
 if(p_channel is not null and p_channel not in('qoo10','shopee','lazada','coupang','elevenst','smartstore','ebay','temu'))or length(trim(p_scope_key))not between 1 and 240
  or p_drill not in('raw_restart','provider_429','provider_5xx','reply_timeout_unknown','token_expiry','permission_revoked','attachment_expired','daily_restart','backup_restore','delete_and_recollect','admin_revoked')
  or p_result not in('passed','failed','inconclusive')or p_evidence_digest!~'^[a-f0-9]{64}$'or jsonb_typeof(p_safe_detail)<>'object'or octet_length(p_safe_detail::text)>8192
  or p_observed_at>clock_timestamp()+interval'5 minutes'then raise exception'CS_RECOVERY_DRILL_INVALID'using errcode='22023';end if;
 insert into sellerpilot_private.cs_recovery_drills(owner_id,channel,scope_key,drill,result,evidence_digest,safe_detail,observed_at,recorded_by)
 values(auth.uid(),p_channel,trim(p_scope_key),p_drill,p_result,p_evidence_digest,p_safe_detail,p_observed_at,auth.uid())
 on conflict(owner_id,channel,scope_key,drill,evidence_digest)do update set result=excluded.result,safe_detail=excluded.safe_detail,observed_at=excluded.observed_at
 returning id into v_id;return jsonb_build_object('contract','sellerpilot-cs-recovery-drill/1','id',v_id,'status','recorded');
end $$;
revoke all on function public.sellerpilot_record_cs_recovery_drill_v1(text,text,text,text,text,jsonb,timestamptz)from public,anon,service_role;grant execute on function public.sellerpilot_record_cs_recovery_drill_v1(text,text,text,text,text,jsonb,timestamptz)to authenticated;
create function public.sellerpilot_read_cs_recovery_readiness_v1() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_rows jsonb;v_ready boolean;begin
 if auth.uid()is null or public.sellerpilot_is_admin()is distinct from true then raise exception'administrator access required'using errcode='42501';end if;
 with requirements(drill,required_days,owner,retry_procedure)as(values
  ('raw_restart',1,'cs_operator','마지막 durable checkpoint에서 멱등 재개'),('provider_429',1,'cs_operator','Retry-After 이후 같은 읽기 scope 재개'),('provider_5xx',1,'cs_operator','backoff 이후 같은 읽기 scope 재개'),
  ('reply_timeout_unknown',1,'cs_operator','원격 readback 후 미관측일 때만 수동 판정'),('token_expiry',1,'cs_operator','자격 복구 후 동일 scope 읽기 재검증'),('permission_revoked',1,'cs_operator','권한 복구 후 동일 scope 읽기 재검증'),
  ('attachment_expired',1,'cs_operator','재발급 또는 복구 불가 사유 확인'),('daily_restart',2,'cs_operator','마지막 durable checkpoint에서 멱등 재개'),('backup_restore',1,'database_operator','백업 복원 후 원장과 tombstone 대조'),
  ('delete_and_recollect',1,'cs_operator','삭제 범위 재수집 후 provider ID 대조'),('admin_revoked',1,'security_operator','세션 폐기와 민감 UI 캐시 제거 확인')),
 observed as(select drill,count(distinct(observed_at at time zone'Asia/Seoul')::date)::integer observed_days,max(observed_at)last_passed_at from sellerpilot_private.cs_recovery_drills where owner_id=auth.uid()and result='passed'group by drill),
 rows as(select requirements.*,coalesce(observed.observed_days,0)observed_days,observed.last_passed_at from requirements left join observed using(drill))
 select jsonb_agg(jsonb_build_object('drill',drill,'requiredDistinctDays',required_days,'observedDistinctDays',observed_days,'lastPassedAt',last_passed_at,'state',case when observed_days>=required_days then'passed'else'missing'end,'owner',owner,'retryProcedure',retry_procedure)order by drill),bool_and(observed_days>=required_days)into v_rows,v_ready from rows;
 return jsonb_build_object('contract','sellerpilot-cs-recovery-readiness/1','checkedAt',statement_timestamp(),'ready',coalesce(v_ready,false),'requirements',v_rows);
end $$;
revoke all on function public.sellerpilot_read_cs_recovery_readiness_v1()from public,anon,service_role;grant execute on function public.sellerpilot_read_cs_recovery_readiness_v1()to authenticated;
notify pgrst,'reload schema';commit;
