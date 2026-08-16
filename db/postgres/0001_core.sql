-- SellerPilot production core schema
-- PostgreSQL 16+ / organization-scoped / append-only operational evidence

create extension if not exists pgcrypto;

create type member_role as enum ('owner', 'admin', 'operator', 'viewer');
create type channel_kind as enum ('qoo10', 'shopee', 'lazada', 'coupang', 'elevenst', 'smartstore', 'ebay', 'alibaba', 'one688');
create type connection_state as enum ('draft', 'pending', 'connected', 'degraded', 'expired', 'disabled');
create type product_state as enum ('draft', 'identifying', 'blocked', 'ready', 'publishing', 'active', 'archived');
create type job_state as enum ('queued', 'running', 'retry_wait', 'succeeded', 'failed', 'cancelled');
create type order_state as enum ('pending', 'paid', 'reserved', 'packing', 'shipped', 'delivered', 'cancelled', 'returned');
create type compliance_result as enum ('allow', 'reshoot', 'exclude', 'manual_review');
create type notification_state as enum ('queued', 'sent', 'failed', 'suppressed');

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'Asia/Seoul',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  password_hash text,
  mfa_enabled boolean not null default false,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table organization_members (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  role member_role not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table channel_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  channel channel_kind not null,
  seller_account_id text,
  country_code char(2) not null,
  currency_code char(3) not null,
  state connection_state not null default 'draft',
  credential_secret_ref text,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  fixed_egress_ip inet,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, channel, seller_account_id, country_code)
);

create table products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  internal_sku text not null,
  state product_state not null default 'draft',
  brand text,
  name text not null,
  model_number text,
  barcode text,
  country_of_origin char(2),
  manufacturer text,
  category_path text[],
  locked_facts jsonb not null default '{}'::jsonb,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, internal_sku)
);

create table product_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  internal_sku text not null,
  option_values jsonb not null default '{}'::jsonb,
  barcode text,
  weight_grams integer check (weight_grams is null or weight_grams >= 0),
  dimensions_mm jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, internal_sku)
);

create table bundle_components (
  organization_id uuid not null references organizations(id) on delete cascade,
  bundle_variant_id uuid not null references product_variants(id) on delete cascade,
  component_variant_id uuid not null references product_variants(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  primary key (bundle_variant_id, component_variant_id),
  check (bundle_variant_id <> component_variant_id)
);

create table product_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  parent_asset_id uuid references product_assets(id),
  asset_kind text not null check (asset_kind in ('source', 'front', 'back', 'left', 'right', 'top', 'bottom', 'label', 'barcode', 'thumbnail', 'detail', 'channel_upload')),
  object_key text not null,
  media_type text not null,
  sha256 char(64) not null,
  width integer,
  height integer,
  quality_result jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (organization_id, object_key),
  unique (product_id, asset_kind, sha256)
);

create table product_identification_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  barcode_matches jsonb not null default '[]'::jsonb,
  ocr_facts jsonb not null default '{}'::jsonb,
  supplier_matches jsonb not null default '[]'::jsonb,
  image_matches jsonb not null default '[]'::jsonb,
  ranked_candidates jsonb not null default '[]'::jsonb,
  confidence numeric(6,5),
  decision compliance_result not null,
  decision_reasons jsonb not null default '[]'::jsonb,
  rules_version text not null,
  created_at timestamptz not null default now()
);

create table compliance_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  country_code char(2) not null,
  channel channel_kind,
  category_pattern text not null,
  version text not null,
  effective_from timestamptz not null,
  effective_to timestamptz,
  rule jsonb not null,
  source_url text,
  created_at timestamptz not null default now(),
  unique (organization_id, country_code, channel, category_pattern, version)
);

create table compliance_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  channel_account_id uuid references channel_accounts(id) on delete cascade,
  result compliance_result not null,
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  reasons jsonb not null default '[]'::jsonb,
  rule_versions jsonb not null default '[]'::jsonb,
  decided_at timestamptz not null default now()
);

create table content_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  channel channel_kind,
  locale text not null,
  version integer not null,
  source_facts_hash char(64) not null,
  title text not null,
  bullets jsonb not null default '[]'::jsonb,
  description text not null,
  detail_page jsonb not null default '{}'::jsonb,
  validation jsonb not null default '{}'::jsonb,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  unique (product_id, channel, locale, version)
);

create table product_channel_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  channel_account_id uuid not null references channel_accounts(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete cascade,
  external_product_id text,
  external_variant_id text,
  external_category_id text,
  listing_state text not null default 'draft',
  last_payload_hash char(64),
  last_synced_at timestamptz,
  last_error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_account_id, product_id, variant_id)
);

create table price_calculations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  variant_id uuid not null references product_variants(id) on delete cascade,
  channel_account_id uuid not null references channel_accounts(id) on delete cascade,
  input_currency char(3) not null,
  output_currency char(3) not null,
  exchange_rate numeric(20,8) not null,
  exchange_rate_at timestamptz not null,
  cost_breakdown jsonb not null,
  target_margin_rate numeric(8,4) not null,
  break_even_price numeric(20,4) not null,
  recommended_price numeric(20,4) not null,
  expected_profit numeric(20,4) not null,
  expected_margin_rate numeric(8,4) not null,
  decision text not null check (decision in ('allow', 'adjust', 'block')),
  created_at timestamptz not null default now()
);

create table inventory_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  code text not null,
  name text not null,
  type text not null check (type in ('owned', 'supplier', '3pl', 'channel')),
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table inventory_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  variant_id uuid not null references product_variants(id) on delete restrict,
  location_id uuid not null references inventory_locations(id) on delete restrict,
  quantity_delta integer not null check (quantity_delta <> 0),
  movement_type text not null check (movement_type in ('receipt', 'reserve', 'release', 'sale', 'cancel', 'return', 'adjust', 'bundle')),
  reference_type text not null,
  reference_id text not null,
  idempotency_key text not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (organization_id, idempotency_key)
);

create index inventory_ledger_variant_time_idx on inventory_ledger (organization_id, variant_id, occurred_at, id);

create table orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  channel_account_id uuid not null references channel_accounts(id) on delete restrict,
  external_order_id text not null,
  state order_state not null,
  ordered_at timestamptz not null,
  currency_code char(3) not null,
  total_amount numeric(20,4) not null,
  buyer_encrypted jsonb not null default '{}'::jsonb,
  shipping_encrypted jsonb not null default '{}'::jsonb,
  shipping_deadline_at timestamptz,
  raw_payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_account_id, external_order_id)
);

create table order_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  external_line_id text not null,
  variant_id uuid references product_variants(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price numeric(20,4) not null,
  raw_payload jsonb not null default '{}'::jsonb,
  unique (order_id, external_line_id)
);

create table order_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  state order_state not null,
  source text not null,
  source_event_id text not null,
  occurred_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  unique (source, source_event_id)
);

create table inbound_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  channel_account_id uuid references channel_accounts(id) on delete cascade,
  source text not null,
  external_event_id text not null,
  signature_valid boolean not null,
  received_at timestamptz not null default now(),
  occurred_at timestamptz,
  payload jsonb not null,
  processed_at timestamptz,
  process_error jsonb,
  unique (source, external_event_id)
);

create table background_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  job_type text not null,
  state job_state not null default 'queued',
  idempotency_key text not null,
  payload jsonb not null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 8,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_type, idempotency_key)
);

create index background_jobs_claim_idx on background_jobs (state, available_at, created_at) where state in ('queued', 'retry_wait');

create table job_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references background_jobs(id) on delete cascade,
  attempt integer not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  outcome text check (outcome in ('succeeded', 'retry', 'failed')),
  request_summary jsonb not null default '{}'::jsonb,
  response_summary jsonb not null default '{}'::jsonb,
  error jsonb,
  unique (job_id, attempt)
);

create table customer_tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  channel_account_id uuid not null references channel_accounts(id) on delete restrict,
  external_ticket_id text not null,
  order_id uuid references orders(id) on delete set null,
  locale text,
  category text,
  risk_level text not null default 'normal' check (risk_level in ('normal', 'money', 'legal', 'dispute')),
  state text not null default 'open',
  first_response_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_account_id, external_ticket_id)
);

create table customer_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  ticket_id uuid not null references customer_tickets(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  body_encrypted text not null,
  locale text,
  ai_confidence numeric(6,5),
  auto_send_allowed boolean not null default false,
  approval_user_id uuid references app_users(id),
  external_message_id text,
  created_at timestamptz not null default now(),
  unique (ticket_id, external_message_id)
);

create table outbound_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  event_type text not null,
  channel text not null check (channel in ('kakao_alimtalk', 'email', 'sms', 'push')),
  template_key text not null,
  recipient_ref text not null,
  state notification_state not null default 'queued',
  payload jsonb not null,
  provider_message_id text,
  last_error jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references organizations(id) on delete set null,
  actor_user_id uuid references app_users(id) on delete set null,
  actor_type text not null check (actor_type in ('user', 'system', 'channel', 'support')),
  action text not null,
  resource_type text not null,
  resource_id text not null,
  reason text,
  before_data jsonb,
  after_data jsonb,
  trace_id text,
  ip_hash char(64),
  created_at timestamptz not null default now()
);

create index audit_logs_resource_idx on audit_logs (organization_id, resource_type, resource_id, created_at desc);

create table acceptance_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  requirement_id text not null check (requirement_id ~ '^[A-Q]-[0-9]{2}$'),
  environment text not null check (environment in ('development', 'staging', 'production')),
  result text not null check (result in ('passed', 'failed', 'blocked')),
  evidence_url text,
  evidence_summary text not null,
  verified_by uuid references app_users(id),
  verified_at timestamptz not null default now(),
  unique (organization_id, requirement_id, environment, verified_at)
);

-- Tenant isolation is enabled before any application role receives table access.
alter table channel_accounts enable row level security;
alter table products enable row level security;
alter table product_variants enable row level security;
alter table product_assets enable row level security;
alter table product_channel_mappings enable row level security;
alter table inventory_ledger enable row level security;
alter table orders enable row level security;
alter table customer_tickets enable row level security;
alter table audit_logs enable row level security;
alter table acceptance_evidence enable row level security;

