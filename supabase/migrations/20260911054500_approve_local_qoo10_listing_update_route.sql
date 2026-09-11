-- Approve exactly one local channel-executor route so the release-aligned
-- local gateway worker can execute the already-enqueued Qoo10 content update
-- for the 롯데 롯샌 canonical listing.
--
-- Context:
--   * The Qoo10 remote 1217536689 is the existing 롯데 롯샌 listing. The UI
--     "지원 항목만 원격 반영" action enqueues a listing.update whose DB-side
--     safety contract (release gate, verified publication contract, listing
--     and attempt lineage, S1 fence) all pass.
--   * The serverless gateway queue is not being drained, so the local
--     release-aligned gateway worker is the only available executor.
--   * local_channel_executor_routes excluded 'qoo10' entirely and excluded
--     listing.update for every channel except smartstore, so the approved
--     worker could not claim the job.
--
-- Scope of this change:
--   * one channel ('qoo10') is added to the channel allowlist;
--   * exactly one new operation tuple is allowed for it (listing.update);
--   * one time-boxed (1 day) route row is inserted for the Qoo10 credential
--     at the currently attested release, bound to the local worker egress.
--   * No other channel or operation gains any new permission.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local timezone = 'UTC';

select pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

alter table sellerpilot_private.local_channel_executor_routes
  drop constraint local_channel_executor_routes_channel_check;

alter table sellerpilot_private.local_channel_executor_routes
  add constraint local_channel_executor_routes_channel_check
  check (channel = any (array[
    'coupang', 'smartstore', 'elevenst', 'temu', 'shopee', 'lazada', 'qoo10'
  ]));

alter table sellerpilot_private.local_channel_executor_routes
  drop constraint local_channel_executor_routes_operation_check;

alter table sellerpilot_private.local_channel_executor_routes
  add constraint local_channel_executor_routes_operation_check
  check (
    (channel = 'coupang' and operation = any (array[
      'categories.attributes', 'categories.validate', 'listing.create',
      'listing.publication.verify', 'orders.list', 'inquiries.list',
      'diagnostic.test'
    ]))
    or (channel = 'smartstore' and operation = any (array[
      'listing.create', 'listing.update', 'orders.list', 'inquiries.list',
      'diagnostic.test'
    ]))
    or (channel = any (array['elevenst', 'temu', 'shopee', 'lazada']) and operation = any (array[
      'orders.list', 'inquiries.list', 'diagnostic.test'
    ]))
    -- Added 2026-09-11: existing Qoo10 listings only. This tuple lets the
    -- approved local worker apply seller-pilot content to an already-existing
    -- remote; it does not permit listing.create.
    or (channel = 'qoo10' and operation = 'listing.update')
  );

insert into sellerpilot_private.local_channel_executor_routes (
  owner_id, channel, operation, credential_id, seller_account_key,
  worker_token_id, release_sha, egress_ip_sha256, approved_by, approved_at,
  expires_at, enabled
) values (
  '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid,
  'qoo10',
  'listing.update',
  '2b49d081-5188-4a75-9555-e0a6438e8a2b'::uuid,
  '2d5f4c65827e9f360ee013422ae6730ed1a7c67679a2e4beaa144d6a2c73ac46',
  '02955cb4-fa9f-466b-824f-b61f06276190'::uuid,
  '54170455780b6b4ae57d65aaa30ce102a08e2f22',
  '92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01',
  '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'::uuid,
  clock_timestamp(),
  clock_timestamp() + interval '1 day',
  true
);

commit;
