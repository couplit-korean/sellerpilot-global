create role anon;
create role authenticated;
create role service_role;

create schema auth;
create table auth.users(id uuid primary key);
insert into auth.users values
  ('00000000-0000-4000-8000-000000003001'),
  ('00000000-0000-4000-8000-000000003002');
create function auth.uid() returns uuid language sql stable
  as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function public.sellerpilot_is_admin() returns boolean
language sql stable security definer set search_path=''
as $$select auth.uid()='00000000-0000-4000-8000-000000003001'::uuid$$;

create schema sellerpilot_private;
create table sellerpilot_private.channel_credentials(
  id uuid primary key,
  created_by uuid not null,
  channel text not null,
  status text not null
);
create table sellerpilot_private.support_tickets(
  id uuid primary key,
  owner_id uuid not null,
  source_credential_id uuid,
  channel_key text not null,
  external_ticket_id text not null,
  external_order_reference text,
  ticket_kind text not null,
  status text not null,
  provider_status text not null,
  received_at timestamptz not null,
  provider_context jsonb not null default '{}',
  demo boolean not null default false
);
create table sellerpilot_private.support_inbound_messages(
  id uuid primary key,
  ticket_id uuid not null,
  owner_id uuid not null,
  channel_key text not null,
  inbound_key text not null,
  remote_message_id text,
  sender_role text not null,
  body text not null,
  provider_context jsonb not null default '{}',
  received_at timestamptz not null
);

insert into sellerpilot_private.channel_credentials values
  ('00000000-0000-4000-8000-000000003011','00000000-0000-4000-8000-000000003001','coupang','active'),
  ('00000000-0000-4000-8000-000000003012','00000000-0000-4000-8000-000000003002','coupang','active');

insert into sellerpilot_private.support_tickets values
  ('00000000-0000-4000-8000-000000003021','00000000-0000-4000-8000-000000003001',
   '00000000-0000-4000-8000-000000003011','coupang','call-center:3101','9001',
   'conversation','waiting','waiting','2024-02-10T00:00:00Z',
   '{"receiverPhone":"010-0000-0000","returnAddress":"비공개 주소"}',false),
  ('00000000-0000-4000-8000-000000003022','00000000-0000-4000-8000-000000003001',
   '00000000-0000-4000-8000-000000003011','coupang','product:3201','9002',
   'conversation','waiting','waiting','2024-02-11T00:00:00Z','{}',false),
  ('00000000-0000-4000-8000-000000003023','00000000-0000-4000-8000-000000003002',
   '00000000-0000-4000-8000-000000003012','coupang','call-center:3101','9001',
   'conversation','waiting','waiting','2024-02-10T00:00:00Z','{}',false);

insert into sellerpilot_private.support_inbound_messages values
  ('00000000-0000-4000-8000-000000003031','00000000-0000-4000-8000-000000003021',
   '00000000-0000-4000-8000-000000003001','coupang',
   'coupang:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','4103',
   'customer','합성 신규 문의','{"parentAnswerId":"4103","receiverPhone":"010-0000-0000"}',
   '2024-02-10T00:00:00Z'),
  ('00000000-0000-4000-8000-000000003032','00000000-0000-4000-8000-000000003021',
   '00000000-0000-4000-8000-000000003001','coupang',
   'coupang:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','4104',
   'seller','합성 판매자 답변','{"binding":{"parentAnswerId":"4103"},"returnAddress":"비공개 주소"}',
   '2024-02-10T00:05:00Z'),
  ('00000000-0000-4000-8000-000000003033','00000000-0000-4000-8000-000000003023',
   '00000000-0000-4000-8000-000000003002','coupang',
   'coupang:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','4999',
   'customer','다른 판매자 합성 문의','{}','2024-02-10T00:00:00Z');

alter table sellerpilot_private.channel_credentials enable row level security;
alter table sellerpilot_private.support_tickets enable row level security;
alter table sellerpilot_private.support_inbound_messages enable row level security;
revoke all on sellerpilot_private.channel_credentials,
  sellerpilot_private.support_tickets,
  sellerpilot_private.support_inbound_messages
  from public,anon,authenticated,service_role;

