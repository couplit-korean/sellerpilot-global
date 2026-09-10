-- 11st and Shopee CS reads must run on the Mac allowlisted IP.
-- Do not buy Vercel Static IP.
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
    when p_channel in ('elevenst', 'shopee')
         and p_operation = 'inquiries.list'
      then false
    else sellerpilot_private.serverless_gateway_job_allowed_before_temu_173960(
      p_channel, p_operation
    )
  end
$$;
