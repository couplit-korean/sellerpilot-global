begin;

do $preimage$
begin
  if to_regclass('sellerpilot_private.channel_credentials') is null
      or to_regprocedure('public.sellerpilot_is_admin()') is null then
    raise exception 'QOO10_REVIEW_CHAT_OBSERVATION_PREIMAGE_MISSING';
  end if;
  if to_regclass('sellerpilot_private.qoo10_review_chat_observations') is not null
      or to_regprocedure(
        'public.sellerpilot_read_qoo10_review_chat_accounts_v1()'
      ) is not null
      or to_regprocedure(
        'public.sellerpilot_read_qoo10_review_chat_observation_v1(uuid)'
      ) is not null
      or to_regprocedure(
        'public.sellerpilot_service_record_qoo10_review_chat_observation_v1(uuid,bigint,jsonb,jsonb)'
      ) is not null then
    raise exception 'QOO10_REVIEW_CHAT_OBSERVATION_ALREADY_APPLIED';
  end if;
end
$preimage$;

create table sellerpilot_private.qoo10_review_chat_observations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  credential_id uuid not null
    references sellerpilot_private.channel_credentials(id) on delete restrict,
  environment text not null check (environment in ('sandbox','production')),
  seller_account_key text not null check (seller_account_key ~ '^[a-f0-9]{64}$'),
  credential_version integer not null check (credential_version > 0),
  source_revision bigint not null check (source_revision > 0),
  source_artifact_id text not null check (
    length(source_artifact_id) between 8 and 240
    and source_artifact_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]+$'
  ),
  source_artifact_sha256 text not null check (
    source_artifact_sha256 ~ '^[a-f0-9]{64}$'
  ),
  observation_sha256 text not null check (observation_sha256 ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null,
  valid_until timestamptz not null,
  seller_dashboard_visible boolean not null,
  buyer_inquiry_summary_visible boolean not null,
  review_history_visible boolean not null,
  review_navigation_result text not null check (
    review_navigation_result in ('history_visible','redirected_to_login','unavailable')
  ),
  review_history_state text not null check (
    review_history_state in ('unknown','verified_zero')
  ),
  review_observed_count integer check (
    review_observed_count is null or review_observed_count >= 0
  ),
  review_imported_count integer not null check (review_imported_count = 0),
  review_reconciled_count integer not null check (review_reconciled_count = 0),
  recorded_at timestamptz not null default clock_timestamp(),
  unique (credential_id, source_revision),
  check (valid_until > observed_at and valid_until <= observed_at + interval '15 minutes'),
  check (
    (
      review_history_state = 'unknown'
      and review_observed_count is null
      and review_imported_count = 0
      and review_reconciled_count = 0
    )
    or (
      review_history_state = 'verified_zero'
      and review_history_visible
      and review_navigation_result = 'history_visible'
      and review_observed_count = 0
      and review_imported_count = 0
      and review_reconciled_count = 0
    )
  )
);

create index qoo10_review_chat_observations_latest_idx
  on sellerpilot_private.qoo10_review_chat_observations (
    credential_id, source_revision desc, observed_at desc
  );

create function sellerpilot_private.reject_qoo10_review_chat_observation_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'QOO10_REVIEW_CHAT_OBSERVATION_IMMUTABLE' using errcode = '55000';
end;
$$;

create trigger qoo10_review_chat_observations_immutable
before update or delete on sellerpilot_private.qoo10_review_chat_observations
for each row execute function
  sellerpilot_private.reject_qoo10_review_chat_observation_change();

alter table sellerpilot_private.qoo10_review_chat_observations enable row level security;
revoke all on sellerpilot_private.qoo10_review_chat_observations
  from public, anon, authenticated, service_role;
revoke all on function
  sellerpilot_private.reject_qoo10_review_chat_observation_change()
  from public, anon, authenticated, service_role;

create function public.sellerpilot_read_qoo10_review_chat_accounts_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'credentialId',credential.id,
    'label','Qoo10 연결 계정 · ' || left(credential.fingerprint,12),
    'credentialState',case
      when credential.expires_at is not null
        and credential.expires_at <= statement_timestamp() then 'expired'
      when credential.status = 'active'
        and credential.seller_account_key ~ '^[a-f0-9]{64}$'
        and credential.seller_account_key_source in (
          'provider_certified_v1','credential_incarnation_v1'
        )
        and credential.seller_account_verified_at is not null then 'active'
      when credential.status = 'grace' then 'grace'
      when credential.status = 'revoked' then 'revoked'
      when credential.status = 'invalid' then 'invalid'
      else 'unverified'
    end,
    'credentialExpiresAt',credential.expires_at,
    'sellerAccountBinding',case
      when credential.seller_account_key_source = 'provider_certified_v1'
        and credential.seller_account_verified_at is not null then 'provider_certified'
      when credential.seller_account_key_source = 'credential_incarnation_v1'
        and credential.seller_account_verified_at is not null then 'credential_incarnation'
      else 'unverified'
    end,
    'sellerAccountKeyHash',case
      when credential.seller_account_key ~ '^[a-f0-9]{64}$'
        then credential.seller_account_key
      else null
    end,
    'environment',credential.environment
  ) order by
    case credential.status when 'active' then 0 when 'grace' then 1 else 2 end,
    credential.version desc,credential.id),'[]'::jsonb)
    into v_rows
    from sellerpilot_private.channel_credentials credential
   where credential.channel = 'qoo10'
     and credential.environment = 'production';

  return jsonb_build_object(
    'contract','sellerpilot-qoo10-review-chat-accounts/2',
    'checkedAt',statement_timestamp(),
    'accounts',v_rows
  );
end;
$$;

create function public.sellerpilot_read_qoo10_review_chat_observation_v1(
  p_credential_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_evidence sellerpilot_private.qoo10_review_chat_observations%rowtype;
  v_credential_state text;
  v_binding text;
begin
  if auth.uid() is null or public.sellerpilot_is_admin() is distinct from true then
    raise exception 'administrator required' using errcode = '42501';
  end if;

  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'qoo10'
     and credential.environment = 'production';
  if not found then
    raise exception 'QOO10_REVIEW_CHAT_ACCOUNT_SELECTION_INVALID'
      using errcode = '22023';
  end if;

  v_credential_state := case
    when v_credential.expires_at is not null and v_credential.expires_at <= v_now
      then 'expired'
    when v_credential.status = 'active'
      and v_credential.seller_account_key ~ '^[a-f0-9]{64}$'
      and v_credential.seller_account_key_source in (
        'provider_certified_v1','credential_incarnation_v1'
      )
      and v_credential.seller_account_verified_at is not null then 'active'
    when v_credential.status = 'grace' then 'grace'
    when v_credential.status = 'revoked' then 'revoked'
    when v_credential.status = 'invalid' then 'invalid'
    else 'unverified'
  end;
  v_binding := case
    when v_credential.seller_account_key_source = 'provider_certified_v1'
      and v_credential.seller_account_verified_at is not null
      then 'provider_certified'
    when v_credential.seller_account_key_source = 'credential_incarnation_v1'
      and v_credential.seller_account_verified_at is not null
      then 'credential_incarnation'
    else 'unverified'
  end;

  if v_credential.seller_account_key ~ '^[a-f0-9]{64}$' then
    select evidence.* into v_evidence
      from sellerpilot_private.qoo10_review_chat_observations evidence
     where evidence.credential_id = v_credential.id
       and evidence.owner_id = v_credential.created_by
       and evidence.environment = v_credential.environment
       and evidence.seller_account_key = v_credential.seller_account_key
       and evidence.credential_version = v_credential.version
     order by evidence.source_revision desc,evidence.observed_at desc
     limit 1;
  end if;

  return jsonb_build_object(
    'contract','sellerpilot-qoo10-review-chat-observation-read/1',
    'checkedAt',v_now,
    'account',jsonb_build_object(
      'credentialId',v_credential.id,
      'label','Qoo10 연결 계정 · ' || left(v_credential.fingerprint,12),
      'credentialState',v_credential_state,
      'credentialExpiresAt',v_credential.expires_at,
      'sellerAccountBinding',v_binding,
      'sellerAccountKeyHash',case
        when v_credential.seller_account_key ~ '^[a-f0-9]{64}$'
          then v_credential.seller_account_key
        else null
      end,
      'environment',v_credential.environment
    ),
    'observationState',case
      when v_evidence.id is null then 'no_evidence'
      when v_evidence.valid_until <= v_now then 'expired'
      else 'current'
    end,
    'evidence',case when v_evidence.id is null then null else jsonb_build_object(
      'contract','sellerpilot-qoo10-review-chat-durable-observation/1',
      'source','sellerpilot_private.qoo10_review_chat_observations',
      'sourceRevision',v_evidence.source_revision,
      'sourceRevisionSha256',v_evidence.observation_sha256,
      'sourceArtifactId',v_evidence.source_artifact_id,
      'sourceArtifactSha256',v_evidence.source_artifact_sha256,
      'credentialId',v_evidence.credential_id,
      'sellerAccountKeyHash',v_evidence.seller_account_key,
      'environment',v_evidence.environment,
      'observedAt',v_evidence.observed_at,
      'validUntil',v_evidence.valid_until,
      'sellerDashboardVisible',v_evidence.seller_dashboard_visible,
      'buyerInquirySummaryVisible',v_evidence.buyer_inquiry_summary_visible,
      'reviewHistoryVisible',v_evidence.review_history_visible,
      'reviewNavigationResult',v_evidence.review_navigation_result,
      'review',jsonb_build_object(
        'historyState',v_evidence.review_history_state,
        'observedCount',v_evidence.review_observed_count,
        'importedCount',v_evidence.review_imported_count,
        'reconciledCount',v_evidence.review_reconciled_count
      ),
      'buyerChatHistoryVisible',false,
      'buyerChatNavigationResult','unavailable',
      'buyerChat',jsonb_build_object(
        'historyState','unknown',
        'observedCount',null,
        'importedCount',0,
        'reconciledCount',0
      )
    ) end
  );
end;
$$;

create function public.sellerpilot_service_record_qoo10_review_chat_observation_v1(
  p_credential_id uuid,
  p_source_revision bigint,
  p_source_artifact jsonb,
  p_observation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_credential sellerpilot_private.channel_credentials%rowtype;
  v_existing sellerpilot_private.qoo10_review_chat_observations%rowtype;
  v_latest_revision bigint;
  v_observed_at timestamptz;
  v_valid_until timestamptz;
  v_review jsonb;
  v_buyer_chat jsonb;
  v_canonical jsonb;
  v_observation_sha text;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then
    raise exception 'QOO10_REVIEW_CHAT_SERVICE_ROLE_REQUIRED'
      using errcode = '42501';
  end if;
  if p_source_revision is null or p_source_revision < 1 then
    raise exception 'QOO10_REVIEW_CHAT_SOURCE_REVISION_INVALID';
  end if;
  if jsonb_typeof(p_source_artifact) is distinct from 'object'
      or not p_source_artifact ?& array[
        'contract','sourceKind','artifactId','sha256'
      ]
      or p_source_artifact - array[
        'contract','sourceKind','artifactId','sha256'
      ] <> '{}'::jsonb
      or p_source_artifact->>'contract' is distinct from
        'sellerpilot-qoo10-review-chat-source-artifact/1'
      or p_source_artifact->>'sourceKind' is distinct from
        'authenticated_qsm_seller_ui'
      or length(coalesce(p_source_artifact->>'artifactId','')) not between 8 and 240
      or coalesce(p_source_artifact->>'artifactId','')
        !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]+$'
      or coalesce(p_source_artifact->>'sha256','') !~ '^[a-f0-9]{64}$' then
    raise exception 'QOO10_REVIEW_CHAT_SOURCE_ARTIFACT_INVALID';
  end if;
  if jsonb_typeof(p_observation) is distinct from 'object'
      or not p_observation ?& array[
        'contract','observedAt','validUntil','sellerDashboardVisible',
        'buyerInquirySummaryVisible','reviewHistoryVisible',
        'reviewNavigationResult','review','buyerChatHistoryVisible',
        'buyerChatNavigationResult','buyerChat'
      ]
      or p_observation - array[
        'contract','observedAt','validUntil','sellerDashboardVisible',
        'buyerInquirySummaryVisible','reviewHistoryVisible',
        'reviewNavigationResult','review','buyerChatHistoryVisible',
        'buyerChatNavigationResult','buyerChat'
      ] <> '{}'::jsonb
      or p_observation->>'contract' is distinct from
        'sellerpilot-qoo10-review-chat-recording/1'
      or jsonb_typeof(p_observation->'sellerDashboardVisible') <> 'boolean'
      or jsonb_typeof(p_observation->'buyerInquirySummaryVisible') <> 'boolean'
      or jsonb_typeof(p_observation->'reviewHistoryVisible') <> 'boolean'
      or coalesce(p_observation->>'reviewNavigationResult','') not in (
        'history_visible','redirected_to_login','unavailable'
      )
      or jsonb_typeof(p_observation->'buyerChatHistoryVisible') <> 'boolean'
      or p_observation->'buyerChatHistoryVisible' <> 'false'::jsonb
      or p_observation->>'buyerChatNavigationResult' is distinct from
        'unavailable' then
    raise exception 'QOO10_REVIEW_CHAT_OBSERVATION_INVALID';
  end if;

  begin
    v_observed_at := (p_observation->>'observedAt')::timestamptz;
    v_valid_until := (p_observation->>'validUntil')::timestamptz;
  exception when others then
    raise exception 'QOO10_REVIEW_CHAT_OBSERVATION_TIME_INVALID';
  end;
  if v_observed_at > v_now + interval '60 seconds'
      or v_valid_until <= v_observed_at
      or v_valid_until > v_observed_at + interval '15 minutes' then
    raise exception 'QOO10_REVIEW_CHAT_OBSERVATION_TIME_INVALID';
  end if;

  v_review := p_observation->'review';
  if jsonb_typeof(v_review) is distinct from 'object'
      or not v_review ?& array[
        'historyState','observedCount','importedCount','reconciledCount'
      ]
      or v_review - array[
        'historyState','observedCount','importedCount','reconciledCount'
      ] <> '{}'::jsonb
      or (
        v_review->>'historyState' = 'unknown'
        and not (
          v_review->'observedCount' = 'null'::jsonb
          and v_review->'importedCount' = '0'::jsonb
          and v_review->'reconciledCount' = '0'::jsonb
        )
      )
      or (
        v_review->>'historyState' = 'verified_zero'
        and not (
          p_observation->'reviewHistoryVisible' = 'true'::jsonb
          and p_observation->>'reviewNavigationResult' = 'history_visible'
          and v_review->'observedCount' = '0'::jsonb
          and v_review->'importedCount' = '0'::jsonb
          and v_review->'reconciledCount' = '0'::jsonb
        )
      )
      or coalesce(v_review->>'historyState','') not in (
        'unknown','verified_zero'
      ) then
    raise exception 'QOO10_REVIEW_CHAT_REVIEW_OBSERVATION_INVALID';
  end if;

  v_buyer_chat := p_observation->'buyerChat';
  if jsonb_typeof(v_buyer_chat) is distinct from 'object'
      or not v_buyer_chat ?& array[
        'historyState','observedCount','importedCount','reconciledCount'
      ]
      or v_buyer_chat - array[
        'historyState','observedCount','importedCount','reconciledCount'
      ] <> '{}'::jsonb
      or v_buyer_chat <> jsonb_build_object(
        'historyState','unknown','observedCount',null,
        'importedCount',0,'reconciledCount',0
      ) then
    raise exception 'QOO10_BUYER_CHAT_OBSERVATION_UNVERIFIED';
  end if;

  select credential.* into v_credential
    from sellerpilot_private.channel_credentials credential
   where credential.id = p_credential_id
     and credential.channel = 'qoo10'
     and credential.environment = 'production'
     and credential.status = 'active'
     and (credential.expires_at is null or credential.expires_at > v_now)
     and credential.seller_account_key ~ '^[a-f0-9]{64}$'
     and credential.seller_account_key_source in (
       'provider_certified_v1','credential_incarnation_v1'
     )
     and credential.seller_account_verified_at is not null
   for update;
  if not found then
    raise exception 'QOO10_REVIEW_CHAT_CREDENTIAL_BINDING_INVALID'
      using errcode = '42501';
  end if;

  v_canonical := jsonb_build_object(
    'contract','sellerpilot-qoo10-review-chat-durable-observation/1',
    'ownerId',v_credential.created_by,
    'credentialId',v_credential.id,
    'credentialVersion',v_credential.version,
    'environment',v_credential.environment,
    'sellerAccountKeyHash',v_credential.seller_account_key,
    'sourceRevision',p_source_revision,
    'sourceArtifact',p_source_artifact,
    'observation',p_observation
  );
  v_observation_sha := encode(
    extensions.digest(v_canonical::text,'sha256'),'hex'
  );

  select evidence.* into v_existing
    from sellerpilot_private.qoo10_review_chat_observations evidence
   where evidence.credential_id = v_credential.id
     and evidence.source_revision = p_source_revision;
  if found then
    if v_existing.observation_sha256 = v_observation_sha
        and v_existing.source_artifact_id = p_source_artifact->>'artifactId'
        and v_existing.source_artifact_sha256 = p_source_artifact->>'sha256' then
      return jsonb_build_object(
        'contract','sellerpilot-qoo10-review-chat-recording-result/1',
        'status','already_recorded',
        'credentialId',v_credential.id,
        'sourceRevision',p_source_revision,
        'observationSha256',v_observation_sha,
        'permissionsGranted',false
      );
    end if;
    raise exception 'QOO10_REVIEW_CHAT_SOURCE_REVISION_IMMUTABLE'
      using errcode = '55000';
  end if;

  select max(evidence.source_revision) into v_latest_revision
    from sellerpilot_private.qoo10_review_chat_observations evidence
   where evidence.credential_id = v_credential.id;
  if p_source_revision <> coalesce(v_latest_revision,0) + 1 then
    raise exception 'QOO10_REVIEW_CHAT_SOURCE_REVISION_SEQUENCE_INVALID';
  end if;

  insert into sellerpilot_private.qoo10_review_chat_observations (
    owner_id,credential_id,environment,seller_account_key,credential_version,
    source_revision,source_artifact_id,source_artifact_sha256,
    observation_sha256,observed_at,valid_until,seller_dashboard_visible,
    buyer_inquiry_summary_visible,review_history_visible,
    review_navigation_result,review_history_state,review_observed_count,
    review_imported_count,review_reconciled_count
  ) values (
    v_credential.created_by,v_credential.id,v_credential.environment,
    v_credential.seller_account_key,v_credential.version,p_source_revision,
    p_source_artifact->>'artifactId',p_source_artifact->>'sha256',
    v_observation_sha,v_observed_at,v_valid_until,
    (p_observation->>'sellerDashboardVisible')::boolean,
    (p_observation->>'buyerInquirySummaryVisible')::boolean,
    (p_observation->>'reviewHistoryVisible')::boolean,
    p_observation->>'reviewNavigationResult',
    v_review->>'historyState',
    case when v_review->'observedCount' = 'null'::jsonb
      then null else (v_review->>'observedCount')::integer end,
    0,0
  );

  return jsonb_build_object(
    'contract','sellerpilot-qoo10-review-chat-recording-result/1',
    'status','recorded',
    'credentialId',v_credential.id,
    'sourceRevision',p_source_revision,
    'observationSha256',v_observation_sha,
    'permissionsGranted',false
  );
end;
$$;

revoke all on function public.sellerpilot_read_qoo10_review_chat_accounts_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.sellerpilot_read_qoo10_review_chat_accounts_v1()
  to authenticated;
revoke all on function
  public.sellerpilot_read_qoo10_review_chat_observation_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_read_qoo10_review_chat_observation_v1(uuid)
  to authenticated;
revoke all on function
  public.sellerpilot_service_record_qoo10_review_chat_observation_v1(
    uuid,bigint,jsonb,jsonb
  )
  from public, anon, authenticated;
grant execute on function
  public.sellerpilot_service_record_qoo10_review_chat_observation_v1(
    uuid,bigint,jsonb,jsonb
  )
  to service_role;

comment on table sellerpilot_private.qoo10_review_chat_observations is
  'Immutable credential, seller-account and environment-bound QSM observation ledger. It grants no review import, Buyer Chat, or reply permission.';
comment on function
  public.sellerpilot_service_record_qoo10_review_chat_observation_v1(
    uuid,bigint,jsonb,jsonb
  ) is
  'Service-role-only append boundary. Caller owner, seller and environment claims are never accepted; Buyer Chat and import completion claims are rejected.';

notify pgrst,'reload schema';
commit;
