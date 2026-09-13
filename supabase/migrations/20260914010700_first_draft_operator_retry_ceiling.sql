begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
-- Only the operator ceiling changes. Ordinary requests still receive three
-- attempts; no row budget or cumulative failure counter is changed here.
alter table sellerpilot_private.first_draft_image_requests
 drop constraint first_draft_image_requests_max_attempts_check;
alter table sellerpilot_private.first_draft_image_requests
 add constraint first_draft_image_requests_max_attempts_check
 check (max_attempts between 3 and 12);
commit;
