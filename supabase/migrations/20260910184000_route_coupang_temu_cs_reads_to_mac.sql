-- Coupang/Temu CS reads must not be reserved for Vercel serverless.
-- Mac gateway already has the allowlisted IP. Do not buy Static IP.
create or replace function sellerpilot_private.serverless_gateway_job_allowed(
  p_channel text,
  p_operation text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_channel in ('coupang', 'temu')
         and p_operation in ('inquiries.list', 'diagnostic.test', 'orders.list')
      then false
    else sellerpilot_private.serverless_gateway_job_allowed_before_temu_173960(
      p_channel, p_operation
    )
  end
$$;
