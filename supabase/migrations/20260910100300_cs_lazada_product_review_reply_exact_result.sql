-- Preserve an exact Lazada Product Review readback when the shared inquiry
-- completion layer conservatively classifies the job as reconciliation-required.
begin;

do $$ begin
  if to_regclass('sellerpilot_private.lazada_product_review_reply_deliveries') is null
     or to_regprocedure('sellerpilot_private.assert_lazada_product_review_reply_job_v1(uuid,boolean)') is null then
    raise exception 'LAZADA_PRODUCT_REVIEW_REPLY_EXACT_RESULT_PREIMAGE_MISSING';
  end if;
end $$;

create function sellerpilot_private.sync_lazada_product_review_reply_exact_result_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_delivery sellerpilot_private.lazada_product_review_reply_deliveries%rowtype;
  v_kind text;
  v_readback jsonb;
  v_acceptance jsonb;
begin
  if new.channel<>'lazada' or new.operation<>'inquiries.reply'
     or new.status not in('succeeded','reconciliation_required')
     or new.response_payload is null
     or new.response_payload @> '{"ok":true}'::jsonb is not true
     or new.request_payload#>>'{sellerpilotLazadaProductReviewReply,contract}'
        is distinct from 'sellerpilot-lazada-product-review-reply-job/1' then
    return new;
  end if;
  v_kind:=new.request_payload#>>'{arguments,kind}';
  if v_kind not in('product_review','product_review_readback') then return new; end if;
  begin
    select delivery.* into strict v_delivery
      from sellerpilot_private.lazada_product_review_reply_deliveries delivery
     where delivery.id=(new.request_payload#>>'{sellerpilotLazadaProductReviewReply,deliveryId}')::uuid
       and delivery.credential_id=new.credential_id
       and delivery.seller_account_key is not distinct from new.seller_account_key
       and delivery.identity_fingerprint=
         new.request_payload#>>'{sellerpilotLazadaProductReviewReply,identityFingerprint}'
       and ((v_kind='product_review' and delivery.gateway_job_id=new.id)
         or (v_kind='product_review_readback' and delivery.readback_job_id=new.id));
  exception when others then return new; end;
  if new.environment<>'production'
     or new.request_payload#>>'{arguments,deliveryId}'<>v_delivery.id::text
     or new.request_payload#>>'{arguments,country}'<>v_delivery.country
     or new.request_payload#>>'{arguments,sellerAccountKey}'<>v_delivery.seller_account_key
     or new.request_payload#>>'{arguments,reviewId}'<>v_delivery.review_id
     or new.request_payload#>>'{arguments,generation}'<>v_delivery.review_generation::text
     or new.request_payload#>>'{arguments,identityFingerprint}'<>v_delivery.identity_fingerprint
     or new.request_payload#>>'{arguments,reply}'<>v_delivery.reply_text
     or encode(extensions.digest(new.request_payload#>>'{arguments,reply}','sha256'),'hex')<>
       v_delivery.reply_fingerprint then
    return new;
  end if;
  v_readback:=new.response_payload#>'{steps,0,data,sellerpilotLazadaProductReviewReadback}';
  v_acceptance:=new.response_payload#>'{steps,0,data,sellerpilotReplyAcceptance}';
  if v_kind='product_review' and not (
       v_acceptance->>'contract'='sellerpilot-reply-acceptance/1'
       and v_acceptance->>'channel'='lazada'
       and v_acceptance->>'kind'='product_review'
       and v_acceptance->>'level'='provider_accepted') then
    return new;
  end if;
  if v_readback->>'contract'='sellerpilot-lazada-product-review-reply-readback/1'
     and v_readback->>'deliveryId'=v_delivery.id::text
     and v_readback->>'country'=v_delivery.country
     and v_readback->>'reviewId'=v_delivery.review_id
     and v_readback->>'generation'=v_delivery.review_generation::text
     and v_readback->>'identityFingerprint'=v_delivery.identity_fingerprint
     and v_readback->>'state'='verified'
     and v_readback->>'exactReplyObserved'='true' then
    update sellerpilot_private.lazada_product_review_reply_deliveries set
      status='verified',
      provider_request_id=nullif(new.response_payload#>>'{steps,0,requestId}',''),
      reply_observed_at=clock_timestamp(),last_error=null,
      revision=revision+1,updated_at=clock_timestamp()
     where id=v_delivery.id and status<>'verified';
  end if;
  return new;
end $$;

revoke all on function sellerpilot_private.sync_lazada_product_review_reply_exact_result_v1()
  from public,anon,authenticated,service_role;
create trigger zz_sync_lazada_product_review_reply_exact_result
after update of status,response_payload,error_message,provider_mutation_started_at
on sellerpilot_private.channel_gateway_jobs for each row
execute function sellerpilot_private.sync_lazada_product_review_reply_exact_result_v1();

notify pgrst,'reload schema';
commit;
