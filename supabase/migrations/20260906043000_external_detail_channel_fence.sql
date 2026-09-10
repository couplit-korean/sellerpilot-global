begin;
-- These guards do not open any channel release/claim/publication gate.
create function sellerpilot_private.guard_external_detail_gateway_source()
returns trigger language plpgsql security definer set search_path='' as $$
declare binding jsonb; r sellerpilot_private.external_detail_imports%rowtype; p sellerpilot_private.products%rowtype; image jsonb; n integer:=0;
begin
 binding:=new.request_payload#>'{arguments,sellerpilotExternalDetail}';
 if tg_op='UPDATE' and old.request_payload#>'{arguments,sellerpilotExternalDetail}' is not null and binding is distinct from old.request_payload#>'{arguments,sellerpilotExternalDetail}' then raise exception 'EXTERNAL_DETAIL_JOB_BINDING_IMMUTABLE';end if;
 if binding is null then return new;end if;
 if tg_op='UPDATE' and new.status not in ('queued','running') and new.provider_mutation_started_at is not distinct from old.provider_mutation_started_at then return new;end if;
 if new.operation not in ('listing.create','listing.update','listing.activate') then raise exception 'EXTERNAL_DETAIL_OPERATION_INVALID';end if;
 select * into p from sellerpilot_private.products where id=(binding->>'productId')::uuid for update;
 select * into r from sellerpilot_private.external_detail_imports where id=p.external_detail_import_id;
 if p.id is distinct from '1ed4acfc-7603-48ec-a638-241131e59358'::uuid or r.id is null or r.id::text is distinct from binding->>'importId' or r.owner_id is distinct from new.created_by or r.status<>'approved' or r.approved_product_updated_at is distinct from p.updated_at or r.approved_detail_version is distinct from p.detail_page_version or p.ai_job_id is distinct from (r.payload->>'expectedAiJobId')::uuid or r.request_sha256 is distinct from binding->>'requestSha256' or r.approved_detail_version::text is distinct from binding->>'version' or r.approved_product_updated_at is distinct from (binding->>'productUpdatedAt')::timestamptz or new.channel is distinct from binding->>'channel' then raise exception 'EXTERNAL_DETAIL_JOB_SOURCE_STALE';end if;
 if binding->>'language' not in ('ko','ja','en') or r.payload#>>array['reviewedCopy',binding->>'language','documentSha256'] is distinct from binding->>'documentSha256' or binding->>'locale' is distinct from new.request_payload#>>'{arguments,publicationExpectedLocale}' then raise exception 'EXTERNAL_DETAIL_JOB_LOCALE_INVALID';end if;
 for image in select value from jsonb_array_elements(r.payload->'assets') loop
  if image->>'sourceSha256' is distinct from binding#>>array['imageSha256s',n::text] or r.receipts#>>array[n::text,'decodedRgbaSha256'] is distinct from binding#>>array['pixelSha256s',n::text] then raise exception 'EXTERNAL_DETAIL_JOB_IMAGE_MISMATCH';end if;n:=n+1;
 end loop;
 if n<>8 or jsonb_array_length(binding->'imageSha256s') is distinct from 8 or jsonb_array_length(binding->'pixelSha256s') is distinct from 8 then raise exception 'EXTERNAL_DETAIL_JOB_IMAGE_MISMATCH';end if;
 return new;
end$$;
revoke all on function sellerpilot_private.guard_external_detail_gateway_source() from public,anon,authenticated,service_role;
create trigger external_detail_gateway_source_guard before insert or update of request_payload,status,provider_mutation_started_at on sellerpilot_private.channel_gateway_jobs for each row execute function sellerpilot_private.guard_external_detail_gateway_source();
create function sellerpilot_private.freeze_inflight_external_detail_product()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.external_detail_import_id is not null and (to_jsonb(new)-array['updated_at','on_hand','reserved','status']) is distinct from (to_jsonb(old)-array['updated_at','on_hand','reserved','status']) and exists(select 1 from sellerpilot_private.channel_gateway_jobs j where j.status in ('queued','running','reconciliation_required') and j.request_payload#>>'{arguments,sellerpilotExternalDetail,importId}'=old.external_detail_import_id::text) then raise exception 'EXTERNAL_DETAIL_PRODUCT_HAS_INFLIGHT_PUBLICATION';end if;
 return new;
end$$;
revoke all on function sellerpilot_private.freeze_inflight_external_detail_product() from public,anon,authenticated,service_role;
create trigger external_detail_product_inflight_guard before update on sellerpilot_private.products for each row execute function sellerpilot_private.freeze_inflight_external_detail_product();
commit;
