alter table sellerpilot_private.channel_operation_attempts
  drop constraint if exists channel_operation_attempts_channel_check;

alter table sellerpilot_private.channel_operation_attempts
  add constraint channel_operation_attempts_channel_check
  check (
    channel = any (
      array[
        'qoo10'::text,
        'shopee'::text,
        'lazada'::text,
        'coupang'::text,
        'elevenst'::text,
        'smartstore'::text,
        'ebay'::text,
        'temu'::text
      ]
    )
  );
