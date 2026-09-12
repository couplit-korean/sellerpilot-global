-- Same active credential, provider certification renewed on 2026-09-12.
-- The two read routes still carry its pre-certification key. Bind only those
-- exact observed routes; listing.create and its approval remain untouched.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
do $rebind$
declare c sellerpilot_private.channel_credentials%rowtype; n integer;
begin
 select * into c from sellerpilot_private.channel_credentials
 where id='ca2af447-0706-4694-aed5-7658f12ec2c4' for update;
 if c.id is null or c.channel is distinct from 'temu' or c.environment is distinct from 'production'
    or c.status is distinct from 'active' or c.version is distinct from 2
    or c.seller_account_key_source is distinct from 'provider_certified_v1'
    or c.seller_account_verified_at is distinct from '2026-09-12T00:33:28.879102+00:00'::timestamptz
    or c.seller_account_key is distinct from 'b2b1f26b257cd0085b05c4ed7007bf42cd2f468fb0d336dabbf9ab05ca492935'
    or (c.expires_at is not null and c.expires_at<=clock_timestamp()) then
   raise exception 'TEMU_READ_REBIND_CERTIFICATION_CHANGED';
 end if;
 update sellerpilot_private.local_channel_executor_routes
 set seller_account_key=c.seller_account_key
 where channel='temu' and operation in ('orders.list','inquiries.list')
   and credential_id=c.id and worker_token_id='02955cb4-fa9f-466b-824f-b61f06276190'
   and owner_id='768ce4ac-0ef2-4e01-89dc-05aa4fa8543c'
   and seller_account_key='5d6323f145c4b635be9eaa87feddbdd311734721fda9c94398628afc2196b37d'
   and enabled and approved_by is not null and expires_at>clock_timestamp();
 get diagnostics n=row_count;
 if n<>2 then raise exception 'TEMU_READ_REBIND_ROUTE_SET_CHANGED';end if;
 perform sellerpilot_private.refresh_local_diagnostic_read_routes();
end $rebind$;
commit;
