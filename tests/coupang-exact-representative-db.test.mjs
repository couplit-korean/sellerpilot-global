import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260901173990_bind_coupang_exact_representative.sql",
  import.meta.url,
);
const listingId = "7ffc6e46-3173-4695-9889-5fa1529765f1";
const permitId = "10000000-0000-4000-8000-000000000001";
const credentialId = "10000000-0000-4000-8000-000000000002";
const attemptId = "10000000-0000-4000-8000-000000000003";
const jobId = "10000000-0000-4000-8000-000000000004";
const workerId = "10000000-0000-4000-8000-000000000005";
const claimId = "10000000-0000-4000-8000-000000000006";
const releaseSha = "a".repeat(40);
const fingerprint = "b".repeat(64);
const sourceSha = "c".repeat(64);
const contentSha = "d".repeat(64);
const sourcePath =
  "results/20000000-0000-4000-8000-000000000001/claims/20000000-0000-4000-8000-000000000002/thumbnail-square.png";
const normalizedPath = `normalized/${contentSha.slice(0, 2)}/${contentSha}.jpg`;

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const bodyStart = source.indexOf("as $$", start);
  assert.notEqual(bodyStart, -1);
  const end = source.indexOf("$$;", bodyStart + 5);
  assert.notEqual(end, -1);
  return source.slice(start, end + 3);
}

function extractTaggedDo(source, tag) {
  const marker = `$${tag}$`;
  const start = source.indexOf(`do ${marker}`);
  assert.notEqual(start, -1, `${tag} must exist`);
  const end = source.indexOf(`${marker};`, start + marker.length);
  assert.notEqual(end, -1);
  return source.slice(start, end + marker.length + 1);
}

function extractStatement(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1);
  const end = source.indexOf(endText, start);
  assert.notEqual(end, -1);
  return source.slice(start, end + endText.length);
}

function exactArguments() {
  const approved = Array.from({ length: 8 }, (_, index) => {
    const digest = (index + 1).toString(16).repeat(64).slice(0, 64);
    return {
      role: `detail-${index + 1}`,
      approvedObjectPath: `results/detail-${index + 1}.png`,
      approvedSourceSha256: digest,
      publicUrl: `https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/normalized/${digest.slice(0, 2)}/${digest}.jpg`,
      objectPath: `normalized/${digest.slice(0, 2)}/${digest}.jpg`,
      contentSha256: digest,
    };
  });
  const representativeUrl =
    `https://sellerpilot.supabase.co/storage/v1/object/public/sellerpilot-marketplace/${normalizedPath}`;
  const transport = [{
    role: "gallery-representative",
    approvedObjectPath: sourcePath,
    approvedSourceSha256: sourceSha,
    publicUrl: representativeUrl,
    objectPath: normalizedPath,
    contentSha256: contentSha,
  }, ...approved];
  return {
    publicationIntent: "live",
    publicationStateContract: "verified_remote_state_v1",
    publicationExpectedLocale: "ko-KR",
    publicationExpectedImageCount: 8,
    publicationExpectedFingerprint: fingerprint,
    sellerpilotCoupangExactQaRecovery: {
      contract: "coupang_exact_qa_recovery_v1",
      phase: "listing.update",
      productId: "ddccde35-9c58-4856-b673-d7aa27ce4220",
      listingId,
      sellerProductId: "16356981734",
      vendorItemId: "95962393877",
      sellerSku: "QA-20260823-CC-001",
      sellerAccountLineage: "validated_by_service_rpc",
    },
    sellerpilotCoupangExactQaRepresentative: {
      contract: "coupang_exact_qa_representative_v1",
      role: "gallery-representative",
      sourceBucket: "sellerpilot-ai",
      sourceObjectPath: sourcePath,
      sourceSha256: sourceSha,
      normalizedObjectPath: normalizedPath,
      contentSha256: contentSha,
    },
    sellerpilotPublicationAssetBinding: {
      contract: "sellerpilot_publication_asset_binding_v1",
      providerImageSurface: "gallery",
      approvedDetailImages: approved,
      providerTransportImages: transport,
    },
    body: {
      sellerProductId: "16356981734",
      items: [{
        sellerpilotItemMatchId: "95962393877",
        modelNo: "QA-20260823-CC-001",
        images: transport.map((row, index) => ({
          imageOrder: index,
          imageType: index === 0 ? "REPRESENTATION" : "DETAIL",
          vendorPath: row.publicUrl,
        })),
        contents: approved.map((row) => ({
          contentsType: "IMAGE",
          contentDetails: [{ detailType: "IMAGE", content: row.publicUrl }],
        })),
      }],
    },
  };
}

function successResponse() {
  const rep = exactArguments().sellerpilotCoupangExactQaRepresentative;
  return {
    ok: true,
    channel: "coupang",
    operation: "listing.update",
    remoteId: "16356981734",
    publicationIntent: "live",
    publicationFulfilled: true,
    publicationStateContract: "verified_remote_state_v1",
    remoteState: {
      verified: true,
      visibility: "live",
      locale: "ko-KR",
      fingerprint,
      imageCount: 8,
    },
    steps: [{
      name: "listing-readback",
      ok: true,
      data: {
        sellerpilotCoupangExactRepresentativeReadback: {
          ...rep,
          contract: "coupang_exact_qa_representative_readback_v1",
          sellerProductId: "16356981734",
          vendorItemId: "95962393877",
          representativeImageCount: 1,
          detailImageCount: 8,
          remoteGalleryVerified: true,
        },
      },
    }],
  };
}

test("Coupang representative permit runs one bound lifecycle and rejects tampering", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema sellerpilot_private;
      create table sellerpilot_private.exact_existing_update_permits(
        permit_id uuid primary key, channel text not null, listing_id uuid not null,
        release_sha text not null, request_fingerprint text not null,
        update_job_id uuid, bound_claim_token uuid, bound_worker_token_id uuid,
        consumed_at timestamptz, expires_at timestamptz not null
      );
      create table sellerpilot_private.channel_gateway_jobs(
        id uuid primary key, attempt_id uuid, listing_id uuid, credential_id uuid,
        channel text, operation text, environment text, status text,
        request_fingerprint text, request_payload jsonb, worker_token_id uuid,
        claim_token uuid, provider_mutation_started_at timestamptz,
        completed_at timestamptz, response_payload jsonb
      );
      create table sellerpilot_private.gateway_completion_receipts(
        job_id uuid primary key, claim_token uuid not null,
        worker_token_id uuid not null, completion_fingerprint text not null
      );
      create function sellerpilot_private.exact_existing_update_arguments_valid(
        p_channel text,p_arguments jsonb,p_release_sha text,
        p_request_fingerprint text,p_expected_stock integer
      ) returns boolean language sql immutable as $$ select true $$;
      create function sellerpilot_private.exact_existing_update_provider_allowed(
        p_job_id uuid, p_claim_token uuid
      ) returns boolean language sql stable as $$
        select exists(select 1 from sellerpilot_private.exact_existing_update_permits p
          join sellerpilot_private.channel_gateway_jobs j on j.id=p.update_job_id
          where j.id=p_job_id and j.claim_token=p_claim_token
            and j.status='running' and p.consumed_at is null
            and p.expires_at > statement_timestamp())
      $$;
      create function public.sellerpilot_service_arm_exact_existing_update(
        channel text, requested_listing uuid, requested_credential uuid,
        release text, fingerprint text
      ) returns jsonb language plpgsql security definer set search_path='' as $$
      begin
        insert into sellerpilot_private.exact_existing_update_permits(
          permit_id,channel,listing_id,release_sha,request_fingerprint,expires_at
        ) values('${permitId}',channel,requested_listing,release,fingerprint,
          statement_timestamp()+interval '5 minutes') on conflict do nothing;
        return jsonb_build_object('contract','exact_existing_update_permit_v1',
          'permitId','${permitId}','channel',channel,'listingId',requested_listing,
          'releaseSha',release,'requestFingerprint',fingerprint,'bound',false);
      end $$;
    `);
    await db.exec(extractStatement(
      migration,
      "create table sellerpilot_private.coupang_exact_representative_permits (",
      ");\n\nalter table sellerpilot_private.coupang_exact_representative_permits",
    ).replace(/\n\nalter table[\s\S]*$/u, ";"));
    await db.exec(extractTaggedDo(migration, "copy_exact_arguments_predecessor"));
    await db.exec(extractFunction(
      migration,
      "create or replace function sellerpilot_private.exact_existing_update_arguments_valid(",
    ));
    await db.exec(extractFunction(
      migration,
      "create function public.sellerpilot_service_arm_coupang_exact_rep(",
    ));
    await db.exec(`revoke all on function public.sellerpilot_service_arm_coupang_exact_rep(
      text,uuid,uuid,text,text,text,text,text,text) from public,anon,authenticated,service_role;
      grant execute on function public.sellerpilot_service_arm_coupang_exact_rep(
      text,uuid,uuid,text,text,text,text,text,text) to service_role;`);

    await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
    const armed = await db.query(`select public.sellerpilot_service_arm_coupang_exact_rep(
      'coupang',$1,$2,$3,$4,$5,$6,$7,$8) value`, [
      listingId,credentialId,releaseSha,fingerprint,sourcePath,sourceSha,
      normalizedPath,contentSha,
    ]);
    assert.equal(armed.rows[0].value.representativeContract,
      "coupang_exact_qa_representative_v1");
    await assert.rejects(
      db.query(`select public.sellerpilot_service_arm_coupang_exact_rep(
        'coupang',gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7)`, [
        credentialId,releaseSha,fingerprint,sourcePath,sourceSha,normalizedPath,contentSha,
      ]),
      /identity invalid/u,
    );

    const args = exactArguments();
    const validation = await db.query(`select sellerpilot_private.exact_existing_update_arguments_valid(
      'coupang',$1::jsonb,$2,$3,1) value`, [JSON.stringify(args),releaseSha,fingerprint]);
    const diagnostics = await db.query(`with source as (select $1::jsonb value)
      select jsonb_build_object(
        'fingerprint',value->>'publicationExpectedFingerprint'=$2::text,
        'state',value->>'publicationStateContract'='verified_remote_state_v1',
        'intent',value->>'publicationIntent'='live',
        'locale',value->>'publicationExpectedLocale'='ko-KR',
        'expectedCount',(value->>'publicationExpectedImageCount')::integer=8,
        'recovery',value->'sellerpilotCoupangExactQaRecovery'=jsonb_build_object(
          'contract','coupang_exact_qa_recovery_v1','phase','listing.update',
          'productId','ddccde35-9c58-4856-b673-d7aa27ce4220','listingId',$3::text,
          'sellerProductId','16356981734','vendorItemId','95962393877',
          'sellerSku','QA-20260823-CC-001','sellerAccountLineage','validated_by_service_rpc'),
        'sourcePath',(value#>>'{sellerpilotCoupangExactQaRepresentative,sourceObjectPath}') ~
          '^results/[0-9a-f-]+/claims/[0-9a-f-]+/thumbnail-square[.]png$',
        'transport',jsonb_array_length(value#>'{sellerpilotPublicationAssetBinding,providerTransportImages}'),
        'approved',jsonb_array_length(value#>'{sellerpilotPublicationAssetBinding,approvedDetailImages}'),
        'images',jsonb_array_length(value#>'{body,items,0,images}'),
        'forbidden',(value#>'{body,items,0}') ?| array['externalVendorSku','originalPrice','salePrice','maximumBuyCount'],
        'rep', jsonb_build_object(
          'contract',value#>>'{sellerpilotCoupangExactQaRepresentative,contract}',
          'sourceBucket',value#>>'{sellerpilotCoupangExactQaRepresentative,sourceBucket}',
          'sourceSha',(value#>>'{sellerpilotCoupangExactQaRepresentative,sourceSha256}') ~ '^[a-f0-9]{64}$',
          'contentSha',(value#>>'{sellerpilotCoupangExactQaRepresentative,contentSha256}') ~ '^[a-f0-9]{64}$',
          'normalizedEq',(value#>>'{sellerpilotCoupangExactQaRepresentative,normalizedObjectPath}') =
            'normalized/' || left((value#>>'{sellerpilotCoupangExactQaRepresentative,contentSha256}'),2) || '/' ||
            (value#>>'{sellerpilotCoupangExactQaRepresentative,contentSha256}') || '.jpg',
          'role',value#>>'{sellerpilotPublicationAssetBinding,providerTransportImages,0,role}',
          'pathEq',value#>>'{sellerpilotPublicationAssetBinding,providerTransportImages,0,objectPath}' =
            value#>>'{sellerpilotCoupangExactQaRepresentative,normalizedObjectPath}',
          'urlPath',split_part(value#>>'{sellerpilotPublicationAssetBinding,providerTransportImages,0,publicUrl}',
            '/storage/v1/object/public/sellerpilot-marketplace/',2) =
            value#>>'{sellerpilotPublicationAssetBinding,providerTransportImages,0,objectPath}',
          'imageType',value#>>'{body,items,0,images,0,imageType}',
          'vendorEq',value#>>'{body,items,0,images,0,vendorPath}' =
            value#>>'{sellerpilotPublicationAssetBinding,providerTransportImages,0,publicUrl}'
        ),
        'item',jsonb_build_object(
          'sellerProduct',value#>>'{body,sellerProductId}',
          'itemsType',jsonb_typeof(value#>'{body,items}'),
          'itemsCount',jsonb_array_length(value#>'{body,items}'),
          'match',value#>>'{body,items,0,sellerpilotItemMatchId}',
          'model',value#>>'{body,items,0,modelNo}',
          'assetsType',jsonb_typeof(value#>'{sellerpilotPublicationAssetBinding}'),
          'assetContract',value#>>'{sellerpilotPublicationAssetBinding,contract}',
          'surface',value#>>'{sellerpilotPublicationAssetBinding,providerImageSurface}',
          'approvedType',jsonb_typeof(value#>'{sellerpilotPublicationAssetBinding,approvedDetailImages}'),
          'transportType',jsonb_typeof(value#>'{sellerpilotPublicationAssetBinding,providerTransportImages}'),
          'imagesType',jsonb_typeof(value#>'{body,items,0,images}')
        ),
        'detailMismatch', exists(
          select 1 from generate_series(0,7) as positions(image_index)
           where ((value#>'{sellerpilotPublicationAssetBinding,providerTransportImages}'->(image_index+1))->>'role') is distinct from
                   ((value#>'{sellerpilotPublicationAssetBinding,approvedDetailImages}'->image_index)->>'role')
              or ((value#>'{sellerpilotPublicationAssetBinding,providerTransportImages}'->(image_index+1))->>'publicUrl') is distinct from
                   ((value#>'{sellerpilotPublicationAssetBinding,approvedDetailImages}'->image_index)->>'publicUrl')
              or ((value#>'{sellerpilotPublicationAssetBinding,providerTransportImages}'->(image_index+1))->>'approvedObjectPath') is distinct from
                   ((value#>'{sellerpilotPublicationAssetBinding,approvedDetailImages}'->image_index)->>'approvedObjectPath')
              or ((value#>'{sellerpilotPublicationAssetBinding,providerTransportImages}'->(image_index+1))->>'approvedSourceSha256') is distinct from
                   ((value#>'{sellerpilotPublicationAssetBinding,approvedDetailImages}'->image_index)->>'approvedSourceSha256')
              or ((value#>'{sellerpilotPublicationAssetBinding,providerTransportImages}'->(image_index+1))->>'objectPath') is distinct from
                   ((value#>'{sellerpilotPublicationAssetBinding,approvedDetailImages}'->image_index)->>'objectPath')
              or ((value#>'{sellerpilotPublicationAssetBinding,providerTransportImages}'->(image_index+1))->>'contentSha256') is distinct from
                   ((value#>'{sellerpilotPublicationAssetBinding,approvedDetailImages}'->image_index)->>'contentSha256')
              or value#>>array['body','items','0','images',(image_index+1)::text,'imageType'] is distinct from 'DETAIL'
              or value#>>array['body','items','0','images',(image_index+1)::text,'vendorPath'] is distinct from
                   ((value#>'{sellerpilotPublicationAssetBinding,providerTransportImages}'->(image_index+1))->>'publicUrl')
        ),
        'contents',(value#>'{body,items,0,contents}')::text
      ) value from source`,[JSON.stringify(args),fingerprint,listingId]);
    assert.equal(validation.rows[0].value, true, JSON.stringify(diagnostics.rows[0].value));
    const arbitrary = structuredClone(args);
    arbitrary.sellerpilotCoupangExactQaRepresentative.sourceObjectPath =
      arbitrary.sellerpilotCoupangExactQaRepresentative.sourceObjectPath.replace("thumbnail-square.png","hero.png");
    assert.equal((await db.query(`select sellerpilot_private.exact_existing_update_arguments_valid(
      'coupang',$1::jsonb,$2,$3,1) value`, [JSON.stringify(arbitrary),releaseSha,fingerprint])).rows[0].value, false);
    const external = structuredClone(args);
    external.sellerpilotPublicationAssetBinding.providerTransportImages[0].publicUrl =
      `https://example.com/${normalizedPath}`;
    external.body.items[0].images[0].vendorPath = `https://example.com/${normalizedPath}`;
    assert.equal((await db.query(`select sellerpilot_private.exact_existing_update_arguments_valid(
      'coupang',$1::jsonb,$2,$3,1) value`, [JSON.stringify(external),releaseSha,fingerprint])).rows[0].value, false);
    const missingDigest = structuredClone(args);
    delete missingDigest.sellerpilotCoupangExactQaRepresentative.contentSha256;
    assert.equal((await db.query(`select sellerpilot_private.exact_existing_update_arguments_valid(
      'coupang',$1::jsonb,$2,$3,1) value`, [JSON.stringify(missingDigest),releaseSha,fingerprint])).rows[0].value, false);

    await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,attempt_id,listing_id,credential_id,channel,operation,environment,status,
      request_fingerprint,request_payload,worker_token_id,claim_token
    ) values($1,$2,$3,$4,'coupang','listing.update','production','running',
      $5,jsonb_build_object('arguments',$6::jsonb),$7,$8)`, [
      jobId,attemptId,listingId,credentialId,fingerprint,JSON.stringify(args),workerId,claimId,
    ]);
    await db.query(`update sellerpilot_private.exact_existing_update_permits
      set update_job_id=$2,bound_worker_token_id=$3,bound_claim_token=$4
      where permit_id=$1`, [permitId,jobId,workerId,claimId]);
    await db.exec(extractTaggedDo(migration, "copy_provider_allowed_predecessor"));
    await db.exec(extractFunction(
      migration,
      "create or replace function sellerpilot_private.exact_existing_update_provider_allowed(",
    ));
    assert.equal((await db.query(`select sellerpilot_private.exact_existing_update_provider_allowed($1,$2) value`, [jobId,claimId])).rows[0].value, true);
    await db.query(`update sellerpilot_private.exact_existing_update_permits
      set expires_at=statement_timestamp()-interval '1 second' where permit_id=$1`, [permitId]);
    assert.equal((await db.query(`select sellerpilot_private.exact_existing_update_provider_allowed($1,$2) value`, [jobId,claimId])).rows[0].value, false);
    await db.query(`update sellerpilot_private.exact_existing_update_permits
      set expires_at=statement_timestamp()+interval '5 minutes' where permit_id=$1`, [permitId]);
    await db.query(`update sellerpilot_private.channel_gateway_jobs set request_payload =
      jsonb_set(request_payload,'{arguments,sellerpilotCoupangExactQaRepresentative,contentSha256}',to_jsonb($2::text)) where id=$1`, [jobId,"e".repeat(64)]);
    assert.equal((await db.query(`select sellerpilot_private.exact_existing_update_provider_allowed($1,$2) value`, [jobId,claimId])).rows[0].value, false);
    await db.query(`update sellerpilot_private.channel_gateway_jobs set request_payload=jsonb_build_object('arguments',$2::jsonb) where id=$1`, [jobId,JSON.stringify(args)]);
    await db.query(`update sellerpilot_private.exact_existing_update_permits set consumed_at=clock_timestamp() where permit_id=$1`, [permitId]);

    await db.exec(extractFunction(
      migration,
      "create function sellerpilot_private.coupang_exact_rep_response_valid(",
    ));
    await db.exec(extractFunction(
      migration,
      "create function sellerpilot_private.guard_coupang_exact_rep_completion(",
    ));
    await db.exec(`create constraint trigger guard_coupang_exact_rep_completion
      after update on sellerpilot_private.channel_gateway_jobs
      deferrable initially deferred for each row execute function
      sellerpilot_private.guard_coupang_exact_rep_completion()`);
    const response = successResponse();
    await db.exec("begin");
    await db.query(`update sellerpilot_private.channel_gateway_jobs set
      status='succeeded',provider_mutation_started_at=clock_timestamp(),
      completed_at=clock_timestamp(),response_payload=$2::jsonb where id=$1`,
    [jobId,JSON.stringify(response)]);
    await db.query(`insert into sellerpilot_private.gateway_completion_receipts
      values($1,$2,$3,$4)`,[jobId,claimId,workerId,"f".repeat(64)]);
    await db.exec("commit");
    assert.equal((await db.query(`select sellerpilot_private.coupang_exact_rep_response_valid($1,$2::jsonb) value`, [jobId,JSON.stringify(response)])).rows[0].value, true);
    const tampered = structuredClone(response);
    tampered.steps[0].data.sellerpilotCoupangExactRepresentativeReadback.sourceSha256 = "0".repeat(64);
    assert.equal((await db.query(`select sellerpilot_private.coupang_exact_rep_response_valid($1,$2::jsonb) value`, [jobId,JSON.stringify(tampered)])).rows[0].value, false);
    const missingEvidence = structuredClone(response);
    delete missingEvidence.steps[0].data.sellerpilotCoupangExactRepresentativeReadback.contentSha256;
    assert.equal((await db.query(`select sellerpilot_private.coupang_exact_rep_response_valid($1,$2::jsonb) value`, [jobId,JSON.stringify(missingEvidence)])).rows[0].value, false);
    assert.equal((await db.query(`select sellerpilot_private.exact_existing_update_provider_allowed($1,$2) value`, [jobId,claimId])).rows[0].value, false);

    for (const role of ["public","anon","authenticated"]) {
      assert.equal((await db.query(`select has_function_privilege($1,
        'public.sellerpilot_service_arm_coupang_exact_rep(text,uuid,uuid,text,text,text,text,text,text)','EXECUTE') value`,[role])).rows[0].value,false);
    }
    assert.equal((await db.query(`select has_function_privilege('service_role',
      'public.sellerpilot_service_arm_coupang_exact_rep(text,uuid,uuid,text,text,text,text,text,text)','EXECUTE') value`)).rows[0].value,true);
  } finally {
    await db.close();
  }
});
