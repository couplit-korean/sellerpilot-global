begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
-- Keep cumulative failures and the automatic three-attempt default. An operator
-- can grant a bounded retry after a verified generator fix without erasing history.
alter table sellerpilot_private.first_draft_image_requests
 drop constraint first_draft_image_requests_max_attempts_check;
alter table sellerpilot_private.first_draft_image_requests
 add constraint first_draft_image_requests_max_attempts_check
 check (max_attempts between 3 and 8);
commit;
