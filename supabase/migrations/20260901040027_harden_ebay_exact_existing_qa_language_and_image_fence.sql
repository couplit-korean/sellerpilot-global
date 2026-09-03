begin;

alter function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) rename to sellerpilot_09010400_enqueue_before_ebay_exact_content_fence;

revoke all on function
  public.sellerpilot_09010400_enqueue_before_ebay_exact_content_fence(
    uuid, uuid, uuid, text, text, jsonb
  ) from public, anon, authenticated, service_role;

create function public.sellerpilot_service_enqueue_listing_gateway_job(
  p_listing_id uuid,
  p_credential_id uuid,
  p_attempt_id uuid,
  p_channel text,
  p_operation text,
  p_request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marker jsonb :=
    p_request_payload#>'{arguments,sellerpilotEbayExactExistingQaRecovery}';
  v_image_count integer;
  v_unique_image_count integer;
  v_all_https boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(193674993, 821065042);

  if p_listing_id = '8b2cbfaf-3854-437d-b381-abfd70291354'::uuid
     or v_marker is not null then
    if p_channel is distinct from 'ebay'
       or p_operation is distinct from 'listing.update'
       or jsonb_typeof(v_marker) is distinct from 'object'
       or v_marker->>'contract' is distinct from
         'ebay_exact_existing_qa_recovery_v2'
       or jsonb_typeof(
         p_request_payload#>'{arguments,inventoryItem,product,imageUrls}'
       ) is distinct from 'array'
       or regexp_replace(
         coalesce(p_request_payload#>>'{arguments,inventoryItem,product,title}', ''),
         '<[^>]*>', ' ', 'g'
       ) !~* '[a-z]'
       or coalesce(p_request_payload#>>'{arguments,inventoryItem,product,title}', '')
            ~ '[가-힣一-龯ぁ-ゟァ-ヿ]'
       or regexp_replace(
         coalesce(
           p_request_payload#>>'{arguments,inventoryItem,product,description}',
           ''
         ),
         '<[^>]*>', ' ', 'g'
       ) !~* '[a-z]'
       or coalesce(
         p_request_payload#>>'{arguments,inventoryItem,product,description}',
         ''
       ) ~ '[가-힣一-龯ぁ-ゟァ-ヿ]'
       or regexp_replace(
         coalesce(p_request_payload#>>'{arguments,offer,listingDescription}', ''),
         '<[^>]*>', ' ', 'g'
       ) !~* '[a-z]'
       or coalesce(
         p_request_payload#>>'{arguments,offer,listingDescription}',
         ''
       ) ~ '[가-힣一-龯ぁ-ゟァ-ヿ]' then
      raise exception 'EBAY_EXACT_EXISTING_QA_ENQUEUE_FENCE_MISMATCH'
        using errcode = '55000';
    end if;

    select count(*), count(distinct image_url),
           coalesce(bool_and(image_url ~ '^https://'), false)
      into v_image_count, v_unique_image_count, v_all_https
      from jsonb_array_elements_text(
        p_request_payload#>'{arguments,inventoryItem,product,imageUrls}'
      ) as images(image_url);
    if v_image_count <> 1
       or v_unique_image_count <> 1
       or not v_all_https then
      raise exception 'EBAY_EXACT_EXISTING_QA_ENQUEUE_FENCE_MISMATCH'
        using errcode = '55000';
    end if;
  end if;

  return public.sellerpilot_09010400_enqueue_before_ebay_exact_content_fence(
    p_listing_id,
    p_credential_id,
    p_attempt_id,
    p_channel,
    p_operation,
    p_request_payload
  );
end;
$$;

revoke all on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) to service_role;

comment on function public.sellerpilot_service_enqueue_listing_gateway_job(
  uuid, uuid, uuid, text, text, jsonb
) is
  'Preserves all existing listing enqueue gates and additionally requires the exact eBay existing-QA update to carry English-only content and one HTTPS representative image before its eight approved detail images are transported in detail content.';

commit;
