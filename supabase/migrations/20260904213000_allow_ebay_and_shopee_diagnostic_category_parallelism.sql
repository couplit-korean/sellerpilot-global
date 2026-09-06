-- Operator-verified 2026-09-04: eBay inspect hangs because the workbench
-- labels the wait as attributes/validate while it first queues
-- categories.suggest, and eBay still allows only one running gateway job.
-- Periodic orders.list / inquiries.list therefore starve category reads
-- (jobs sat queued ~74 minutes). Same shape as Shopee: except category
-- reads from the one-running unique index and parallelism guard.
-- Also except Shopee diagnostic.test so Mac 연결 검사 can run beside
-- orders.list. Do not invent eBay aspect values. Do not buy Static IP.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';

drop index if exists
  sellerpilot_private.channel_gateway_jobs_one_running_mutation_scope_idx;
create unique index
  channel_gateway_jobs_one_running_mutation_scope_idx
  on sellerpilot_private.channel_gateway_jobs (channel, environment)
  where status = 'running'
    and not (
      (
        channel = 'coupang'
        and operation in ('orders.list', 'inquiries.list')
      )
      or (
        channel = 'shopee'
        and operation in (
          'categories.list', 'categories.suggest',
          'categories.attributes', 'categories.validate',
          'diagnostic.test'
        )
      )
      or (
        channel = 'ebay'
        and operation in (
          'categories.list', 'categories.suggest',
          'categories.attributes', 'categories.validate'
        )
      )
    );

create or replace function
  sellerpilot_private.guard_channel_gateway_running_parallelism()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_running integer;
  v_mutating integer;
begin
  if new.status <> 'running'
     or (
       tg_op = 'UPDATE'
       and old.status = 'running'
       and old.channel = new.channel
       and old.environment = new.environment
       and old.operation = new.operation
     ) then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    193674995,
    pg_catalog.hashtext(new.channel || ':' || new.environment)
  );

  select count(*),
         count(*) filter (where running.operation not in (
           'orders.list', 'inquiries.list',
           'categories.list', 'categories.suggest',
           'categories.attributes', 'categories.validate',
           'diagnostic.test'
         ))
    into v_running, v_mutating
    from sellerpilot_private.channel_gateway_jobs running
   where running.channel = new.channel
     and running.environment = new.environment
     and running.status = 'running'
     and running.id <> new.id;

  if new.channel = 'coupang'
     and new.operation in ('orders.list', 'inquiries.list') then
    if v_running >= 2 or v_mutating > 0 then
      raise exception using
        errcode = 'SPC02',
        message = 'Coupang read concurrency limit reached';
    end if;
  elsif new.channel = 'shopee'
     and new.operation in (
       'categories.list', 'categories.suggest',
       'categories.attributes', 'categories.validate',
       'diagnostic.test'
     ) then
    if v_mutating > 0 then
      raise exception using
        errcode = 'SPC02',
        message = 'Shopee category read blocked by a running mutation';
    end if;
  elsif new.channel = 'ebay'
     and new.operation in (
       'categories.list', 'categories.suggest',
       'categories.attributes', 'categories.validate'
     ) then
    if v_mutating > 0 then
      raise exception using
        errcode = 'SPC02',
        message = 'eBay category read blocked by a running mutation';
    end if;
  elsif v_running > 0 then
    raise exception using
      errcode = 'SPC02',
      message = 'channel gateway running operation already exists';
  end if;

  return new;
end;
$$;

revoke all on function
  sellerpilot_private.guard_channel_gateway_running_parallelism()
  from public, anon, authenticated, service_role;

commit;
