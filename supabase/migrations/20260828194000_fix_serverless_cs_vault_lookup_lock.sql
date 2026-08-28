begin;

-- The bootstrap already holds a transaction-scoped advisory lock, so the
-- Vault name lookup does not need a row lock. Hosted Vault grants postgres
-- SELECT, but intentionally not UPDATE, on vault.secrets; SELECT FOR UPDATE
-- therefore made the otherwise service-role-only bootstrap fail with 42501.
create or replace function public.sellerpilot_service_bootstrap_ebay_asq_serverless_runtime(
  p_gateway_token_hash text,
  p_gateway_fingerprint text,
  p_scheduler_token_hash text,
  p_scheduler_fingerprint text,
  p_wake_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz := clock_timestamp() + interval '365 days';
  v_owner_id uuid;
  v_gateway_token_id uuid;
  v_scheduler_token_id uuid;
  v_wake_vault_id uuid;
begin
  if coalesce(p_gateway_token_hash, '') !~ '^[a-f0-9]{64}$'
     or coalesce(p_scheduler_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_gateway_token_hash = p_scheduler_token_hash
     or coalesce(p_gateway_fingerprint, '') !~ '^[A-F0-9]{12}$'
     or coalesce(p_scheduler_fingerprint, '') !~ '^[A-F0-9]{12}$'
     or coalesce(p_wake_secret, '') !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'invalid serverless runtime metadata';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065043);
  lock table sellerpilot_private.ai_cli_worker_tokens
    in share row exclusive mode;

  select administrator.user_id
    into v_owner_id
    from sellerpilot_private.admin_users administrator
   order by administrator.created_at, administrator.user_id
   limit 1;
  if v_owner_id is null then
    raise exception 'administrator bootstrap owner required'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from sellerpilot_private.ai_cli_worker_tokens token
     where (
       token.token_hash = p_gateway_token_hash
       and token.scope <> 'serverless_cs'
     ) or (
       token.token_hash = p_scheduler_token_hash
       and token.scope <> 'serverless_cs_scheduler'
     )
  ) then
    raise exception 'derived worker token hash already belongs to another scope'
      using errcode = '23505';
  end if;

  if exists (
    select 1
      from sellerpilot_private.channel_gateway_jobs job
      join sellerpilot_private.ai_cli_worker_tokens token
        on token.id = job.worker_token_id
     where job.status = 'running'
       and token.scope = 'serverless_cs'
       and token.token_hash <> p_gateway_token_hash
  ) then
    raise exception 'gateway worker leases must drain before token rotation'
      using errcode = '55000';
  end if;

  with revoked as (
    update sellerpilot_private.ai_cli_worker_tokens token
       set status = 'revoked',
           revoked_at = coalesce(token.revoked_at, v_now)
     where token.scope in ('serverless_cs', 'serverless_cs_scheduler')
       and token.status = 'active'
       and token.token_hash <> case token.scope
             when 'serverless_cs' then p_gateway_token_hash
             else p_scheduler_token_hash
           end
    returning token.id, token.scope, token.fingerprint
  )
  insert into sellerpilot_private.ai_cli_audit (
    action, actor_user_id, worker_token_id, safe_detail
  )
  select
    'token_revoked',
    v_owner_id,
    revoked.id,
    jsonb_build_object(
      'reason', 'serverless_runtime_rotation',
      'scope', revoked.scope,
      'fingerprint', revoked.fingerprint
    )
  from revoked;

  select token.id
    into v_gateway_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_gateway_token_hash
     and token.scope = 'serverless_cs'
   for update;
  if v_gateway_token_id is null then
    insert into sellerpilot_private.ai_cli_worker_tokens (
      label, token_hash, fingerprint, status, scope, expires_at, created_by,
      activated_at
    ) values (
      'SellerPilot Vercel serverless CS gateway',
      p_gateway_token_hash,
      p_gateway_fingerprint,
      'active',
      'serverless_cs',
      v_expires_at,
      v_owner_id,
      v_now
    )
    returning id into v_gateway_token_id;
  else
    if exists (
      select 1
        from sellerpilot_private.ai_cli_worker_tokens token
       where token.id = v_gateway_token_id
         and token.status = 'pending'
    ) then
      raise exception 'pending rotation token cannot be bootstrapped independently'
        using errcode = '55000';
    end if;
    update sellerpilot_private.ai_cli_worker_tokens token
       set label = 'SellerPilot Vercel serverless CS gateway',
           fingerprint = p_gateway_fingerprint,
           status = 'active',
           expires_at = v_expires_at,
           revoked_at = null,
           activated_at = coalesce(token.activated_at, v_now)
     where token.id = v_gateway_token_id;
  end if;

  select token.id
    into v_scheduler_token_id
    from sellerpilot_private.ai_cli_worker_tokens token
   where token.token_hash = p_scheduler_token_hash
     and token.scope = 'serverless_cs_scheduler'
   for update;
  if v_scheduler_token_id is null then
    insert into sellerpilot_private.ai_cli_worker_tokens (
      label, token_hash, fingerprint, status, scope, expires_at, created_by,
      activated_at
    ) values (
      'SellerPilot Supabase serverless CS scheduler',
      p_scheduler_token_hash,
      p_scheduler_fingerprint,
      'active',
      'serverless_cs_scheduler',
      v_expires_at,
      v_owner_id,
      v_now
    )
    returning id into v_scheduler_token_id;
  else
    if exists (
      select 1
        from sellerpilot_private.ai_cli_worker_tokens token
       where token.id = v_scheduler_token_id
         and token.status = 'pending'
    ) then
      raise exception 'pending rotation token cannot be bootstrapped independently'
        using errcode = '55000';
    end if;
    update sellerpilot_private.ai_cli_worker_tokens token
       set label = 'SellerPilot Supabase serverless CS scheduler',
           fingerprint = p_scheduler_fingerprint,
           status = 'active',
           expires_at = v_expires_at,
           revoked_at = null,
           activated_at = coalesce(token.activated_at, v_now)
     where token.id = v_scheduler_token_id;
  end if;

  insert into sellerpilot_private.ai_cli_audit (
    action, actor_user_id, worker_token_id, safe_detail
  ) values
  (
    'token_issued',
    v_owner_id,
    v_gateway_token_id,
    jsonb_build_object(
      'reason', 'serverless_runtime_bootstrap_or_renewal',
      'scope', 'serverless_cs',
      'fingerprint', p_gateway_fingerprint,
      'renewed_at', v_now,
      'expires_at', v_expires_at
    )
  ),
  (
    'token_issued',
    v_owner_id,
    v_scheduler_token_id,
    jsonb_build_object(
      'reason', 'serverless_runtime_bootstrap_or_renewal',
      'scope', 'serverless_cs_scheduler',
      'fingerprint', p_scheduler_fingerprint,
      'renewed_at', v_now,
      'expires_at', v_expires_at
    )
  );

  select secret.id
    into v_wake_vault_id
    from vault.secrets secret
   where secret.name = 'sellerpilot_serverless_cs_wake_v1'
   order by secret.created_at desc, secret.id
   limit 1;
  if v_wake_vault_id is null then
    select vault.create_secret(
      p_wake_secret,
      'sellerpilot_serverless_cs_wake_v1',
      'Derived Vercel serverless CS wake bearer; rotate through service bootstrap only'
    ) into v_wake_vault_id;
  else
    perform vault.update_secret(
      v_wake_vault_id,
      p_wake_secret,
      'sellerpilot_serverless_cs_wake_v1',
      'Derived Vercel serverless CS wake bearer; rotate through service bootstrap only'
    );
  end if;

  return jsonb_build_object(
    'configured', true,
    'version', 'serverless_cs_v1',
    'fingerprints', jsonb_build_object(
      'gateway', p_gateway_fingerprint,
      'scheduler', p_scheduler_fingerprint
    )
  );
end;
$$;

revoke all on function
  public.sellerpilot_service_bootstrap_ebay_asq_serverless_runtime(
    text, text, text, text, text
  )
  from public, anon, authenticated, service_role;
grant execute on function
  public.sellerpilot_service_bootstrap_ebay_asq_serverless_runtime(
    text, text, text, text, text
  )
  to service_role;

comment on function
  public.sellerpilot_service_bootstrap_ebay_asq_serverless_runtime(
    text, text, text, text, text
  ) is
  'Installs dedicated serverless CS hashes and a derived wake bearer without requiring UPDATE on Vault tables.';

commit;
