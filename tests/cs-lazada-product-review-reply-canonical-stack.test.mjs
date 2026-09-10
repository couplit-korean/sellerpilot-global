import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { withLazadaProviderAccountIdentity } from "../lib/channels/provider-account-identity.ts";
import { assertLazadaExactRefresh, parseLazadaExactClaim } from "../lib/channels/lazada-oauth-exact.ts";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runLazadaProductReviewCanonicalUiHarness } from "./helpers/lazada-product-review-canonical-ui-harness.mjs";

const integratedRoot = process.env.SELLERPILOT_LAZADA_INTEGRATED_ROOT
  ?? "/Users/kimchangheemac/dev/sellerpilot-cs-central-20260909";
const candidateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalTestPath = path.join(integratedRoot, "tests/supabase-migrations.test.mjs");
const canonicalMigrationUrl = pathToFileURL(path.join(integratedRoot, "supabase/migrations/"));
const canonicalMigrationSourceFilesUrl = pathToFileURL(path.join(
  integratedRoot,
  "tests/migration-source-files.mjs",
));
const unrelatedShopeeBlocker = "20260904211500_allow_local_shopee_category_and_diagnostic_claims.sql";
const ids = {
  owner: "63000000-0000-4000-8000-000000000001",
  vault: "63000000-0000-4000-8000-000000000002",
  credential: "63000000-0000-4000-8000-000000000003",
  verificationJob: "63000000-0000-4000-8000-000000000004",
  binding: "63000000-0000-4000-8000-000000000005",
  localWorker: "63000000-0000-4000-8000-000000000006",
  serverlessWorker: "63000000-0000-4000-8000-000000000007",
  exactClaim: "63000000-0000-4000-8000-000000000009",
  exactClaimToken: "63000000-0000-4000-8000-000000000010",
};
const providerCredential = withLazadaProviderAccountIdentity({
  app_key: "137451", app_secret: "canonical-secret",
  im_app_key: "137571", im_app_secret: "canonical-im-secret",
  im_access_token: "canonical-im-access-token",
  access_token: "canonical-access-token", refresh_token: "canonical-refresh-token",
  country: "my", access_token_expires_at: "2099-01-01T00:00:00.000Z",
}, {
  account_platform: "seller_center",
  country_user_info: [{
    country: "my", seller_id: "300872000183", user_id: "200872000183", short_code: "MY4NNISR2D",
  }],
});
const exactOAuthSession = "63000000-0000-4000-8000-000000000011";
const exactOAuthClaim = parseLazadaExactClaim({
  id: ids.exactClaim,
  claim_token: ids.exactClaimToken,
  credential_id: ids.credential,
  channel: "lazada",
  operation: "shops.get",
  environment: "production",
  attempt_count: 1,
  request: { country: "my", lazadaExactSession: exactOAuthSession },
  credential: providerCredential.payload,
}, exactOAuthSession);
assertLazadaExactRefresh(providerCredential.payload, exactOAuthClaim.credential);
const sellerAccountKey = createHash("sha256")
  .update(["lazada", "production", providerCredential.identity.subject].join("\u001f"), "utf8")
  .digest("hex");
const localTokenHash = "7".repeat(64);
const serverlessTokenHash = "8".repeat(64);
const eventKey = "9".repeat(64);
const observedAt = "2026-09-09T22:00:00.000Z";

function escapeRegExp(value) {
  return value.replace(/[.*+?^$()|[\]{}\\]/gu, "\\$&");
}

function functionStatement(source, qualifiedName) {
  const pattern = new RegExp(`create(?: or replace)? function ${escapeRegExp(qualifiedName)}\\s*\\(`, "giu");
  const starts = [...source.matchAll(pattern)].map((match) => match.index);
  assert.ok(starts.length, `missing canonical function ${qualifiedName}`);
  const tail = source.slice(starts.at(-1));
  const delimiterMatch = tail.match(/\bas\s+(\$[A-Za-z0-9_]*\$)/iu);
  assert.ok(delimiterMatch?.index !== undefined, `missing body delimiter for ${qualifiedName}`);
  const delimiter = delimiterMatch[1];
  const bodyStart = delimiterMatch.index + delimiterMatch[0].length;
  const bodyEnd = tail.indexOf(`${delimiter};`, bodyStart);
  assert.ok(bodyEnd >= 0, `missing body end for ${qualifiedName}`);
  return tail.slice(0, bodyEnd + delimiter.length + 1);
}

let canonicalSource = await readFile(canonicalTestPath, "utf8");
const secondTestStart = canonicalSource.indexOf(
  '\ntest("Temu pending activation patches the exact production chain without 310540 history"',
);
assert.ok(secondTestStart > 0, "canonical full-stack test boundary must remain exact");
canonicalSource = canonicalSource.slice(0, secondTestStart);

const expectedListPattern = /\n {4}assert\.deepEqual\(migrationNames, \[[\s\S]*?\n {4}\]\);/u;
assert.match(canonicalSource, expectedListPattern);
canonicalSource = canonicalSource.replace(
  expectedListPattern,
  '\n    assert.ok(migrationNames.includes("20260909165423_cs_lazada_supplemental_read_ledger.sql"));',
);

canonicalSource = canonicalSource.replace(
  'test("Supabase migrations apply in order and core RPC flows persist safely"',
  'test("canonical migrations apply with the isolated Shopee source-drift migration skipped"',
);
const migrationLoopNeedle = "    for (const name of migrationNames) {";
assert.equal(canonicalSource.split(migrationLoopNeedle).length - 1, 1);
canonicalSource = canonicalSource.replace(
  migrationLoopNeedle,
  `${migrationLoopNeedle}\n      if (name === ${JSON.stringify(unrelatedShopeeBlocker)}) break;`,
);
const postLoopStart = canonicalSource.indexOf(
  '\n    assert.equal(typeof shopeeStaticEgressMigration, "string");',
);
assert.ok(postLoopStart > 0, "canonical migration loop end must remain exact");
canonicalSource = `${canonicalSource.slice(0, postLoopStart)}
    globalThis.__sellerpilotLazadaProductReviewCanonicalStack = db;
  } catch (error) {
    await db.close();
    throw error;
  }
});
`;

canonicalSource = canonicalSource.replace(
  'from "./migration-source-files.mjs"',
  `from ${JSON.stringify(canonicalMigrationSourceFilesUrl.href)}`,
);
canonicalSource = canonicalSource.replace(
  'new URL("../supabase/migrations/", import.meta.url)',
  `new URL(${JSON.stringify(canonicalMigrationUrl.href)})`,
);
canonicalSource = canonicalSource.replace(
  'from "@electric-sql/pglite"',
  `from ${JSON.stringify(import.meta.resolve("@electric-sql/pglite"))}`,
);

await import(`data:text/javascript;base64,${Buffer.from(canonicalSource).toString("base64")}`);

test("Lazada product-review reply installs over the canonical claim and provider-mutation stack", async (context) => {
  const db = globalThis.__sellerpilotLazadaProductReviewCanonicalStack;
  assert.ok(db, "canonical migration stack must finish before Lazada assertions");
  try {
    const concurrentReplySource = await readFile(path.join(
      integratedRoot,
      "supabase/migrations/20260909111201_cs_lazada_concurrent_reply_fence.sql",
    ), "utf8");
    await db.exec(`
      alter function public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)
        rename to sellerpilot_09100000_begin_gateway_mutation_unsafe;
      ${functionStatement(concurrentReplySource, "public.sellerpilot_service_begin_gateway_provider_mutation")}
      alter function public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)
        rename to sellerpilot_09100000_begin_serverless_gateway_mutation_unsafe;
      ${functionStatement(concurrentReplySource, "public.sellerpilot_service_begin_serverless_gateway_provider_mutation")}
    `);
    await db.exec(await readFile(path.join(
      integratedRoot,
      "supabase/migrations/20260908000000_add_cs_credential_capability_bindings.sql",
    ), "utf8"));
    await db.exec(await readFile(path.join(
      integratedRoot,
      "supabase/migrations/20260909165423_cs_lazada_supplemental_read_ledger.sql",
    ), "utf8"));
    await db.exec(await readFile(new URL(
      "../supabase/migrations/20260910061000_cs_lazada_product_review_reply.sql",
      import.meta.url,
    ), "utf8"));
    await db.exec(await readFile(new URL(
      "../supabase/migrations/20260910064500_cs_lazada_product_review_reply_ui.sql",
      import.meta.url,
    ), "utf8"));
    if (process.env.SELLERPILOT_LAZADA_RESULT_UI_PRE_FIX !== "1") {
      await db.exec(await readFile(new URL(
        "../supabase/migrations/20260910100300_cs_lazada_product_review_reply_exact_result.sql",
        import.meta.url,
      ), "utf8"));
    }
    const definitions = (await db.query(`select
      pg_get_functiondef('public.sellerpilot_claim_channel_gateway_job(text,text)'::regprocedure) local_claim,
      pg_get_functiondef('public.sellerpilot_claim_serverless_gateway_job(text,text)'::regprocedure) serverless_claim,
      pg_get_functiondef('public.sellerpilot_service_begin_gateway_provider_mutation(text,uuid,uuid)'::regprocedure) local_begin,
      pg_get_functiondef('public.sellerpilot_service_begin_serverless_gateway_provider_mutation(text,uuid,uuid)'::regprocedure) serverless_begin,
      pg_get_functiondef('public.sellerpilot_complete_channel_gateway_job(text,uuid,uuid,text,jsonb,text)'::regprocedure) completion`)).rows[0];
    assert.match(definitions.local_claim, /sellerpilot_/u);
    assert.match(definitions.serverless_claim, /sellerpilot_/u);
    assert.match(definitions.local_begin, /sellerpilot_09100000/u);
    assert.match(definitions.serverless_begin, /sellerpilot_09100000/u);
    assert.match(definitions.completion, /channel_gateway_jobs/u);

    await db.query("insert into auth.users(id,email) values($1,'lazada-review-canonical@example.invalid')", [ids.owner]);
    await db.query(
      "insert into sellerpilot_private.admin_users(user_id,display_name) values($1,'Lazada Review Canonical')",
      [ids.owner],
    );
    await db.query(
      `insert into vault.secrets(id,secret,name,description)
       values($1,$2,'lazada-review-canonical','synthetic test only')`,
      [ids.vault, JSON.stringify(exactOAuthClaim.credential)],
    );
    await db.query("select set_config('request.jwt.claim.role','service_role',false)");
    await db.query(`insert into sellerpilot_private.channel_credentials(
      id,channel,environment,version,vault_secret_id,fingerprint,status,expires_at,
      created_by,seller_account_key,seller_account_key_source,seller_account_verified_at
    ) values($1,'lazada','production',999,$2,'LAZREVIEW001','active',
      clock_timestamp()+interval '1 day',$3,$4,'provider_certified_v1',clock_timestamp())`, [
      ids.credential, ids.vault, ids.owner, sellerAccountKey,
    ]);
    const canonicalSellerAccountKey = (await db.query(`select seller_account_key
      from sellerpilot_private.channel_credentials where id=$1`, [ids.credential])).rows[0].seller_account_key;
    assert.match(canonicalSellerAccountKey, /^[a-f0-9]{64}$/u);
    await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,channel,operation,environment,request_payload,response_payload,status,
      created_by,seller_account_key,completed_at
    ) values($1,$2,'lazada','inquiries.list','production','{}'::jsonb,'{"ok":true}'::jsonb,
      'succeeded',$3,$4,clock_timestamp())`, [
      ids.verificationJob, ids.credential, ids.owner, canonicalSellerAccountKey,
    ]);
    await db.query(`insert into sellerpilot_private.cs_credential_capability_bindings(
      id,credential_id,channel,operation,country,app_fingerprint,token_fingerprint,
      target_fingerprint,status,verified_job_id,verified_at,expires_at
    ) values($1,$2,'lazada','inquiries.reply','MY',$3,$4,$5,'active',$6,
      clock_timestamp(),clock_timestamp()+interval '1 day')`, [
      ids.binding, ids.credential, "a".repeat(64), "b".repeat(64), "c".repeat(64), ids.verificationJob,
    ]);
    for (const [id, label, tokenHash, scope] of [
      [ids.localWorker, "lazada-review-canonical-local", localTokenHash, "gateway"],
      [ids.serverlessWorker, "lazada-review-canonical-serverless", serverlessTokenHash, "serverless_cs"],
    ]) {
      await db.query(`insert into sellerpilot_private.ai_cli_worker_tokens(
        id,label,token_hash,fingerprint,status,expires_at,created_by,scope
      ) values($1,$2,$3,'LAZREVIEW002','active',clock_timestamp()+interval '1 day',$4,$5)`, [
        id, label, tokenHash, ids.owner, scope,
      ]);
    }
    await db.query(`insert into sellerpilot_private.lazada_supplemental_cs_events(
      owner_id,credential_id,seller_account_key,country,surface,source_path,resource_key,event_key,
      status,title,body,external_item_id,rating,occurred_at,observed_at,provider_context
    ) values($1,$2,$3,'MY','product_review','/review/seller/list','11111111111',$4,
      'published','상품 리뷰 · 평점 5','synthetic review','22222222222',5,$5,$6,$7::jsonb)`, [
      ids.owner, ids.credential, canonicalSellerAccountKey, eventKey,
      "2026-09-09T21:00:00.000Z", observedAt,
      JSON.stringify({ reviewId: "11111111111", itemId: "22222222222", reviewType: "PRODUCT_REVIEW" }),
    ]);
    await db.exec("set role service_role");
    await db.query(`select public.sellerpilot_service_record_lazada_product_review_reply_grant_v1(
      $1,$2::jsonb)`, [ids.binding, JSON.stringify({
      contract: "sellerpilot-lazada-product-review-reply-permission/1",
      verificationSource: "lazada_app_permission_readback",
      credentialId: ids.credential,
      sellerAccountKey: canonicalSellerAccountKey,
      country: "MY",
      replyPath: "/review/seller/reply/add",
      readbackPath: "/review/seller/list/v2",
      replyProviderRequestId: "canonical-reply-permission",
      readbackProviderRequestId: "canonical-readback-permission",
      evidenceDigest: "d".repeat(64),
    })]);
    await db.exec("reset role");
    const canonicalUi = await runLazadaProductReviewCanonicalUiHarness({
      db,
      candidateRoot,
      ownerId: ids.owner,
      credentialId: ids.credential,
      sellerAccountKey: canonicalSellerAccountKey,
      eventKey,
      observedAt,
      localTokenHash,
    });
    assert.deepEqual(canonicalUi.counts, { delivery: 1, jobs: 1 });
    assert.equal(canonicalUi.httpCalls.filter((call) => call.method === "POST").length, 3);
    context.diagnostic(`canonical-ui ${JSON.stringify({
      http: {
        total: canonicalUi.httpCalls.length,
        post: canonicalUi.httpCalls.filter((call) => call.method === "POST").length,
      },
      rpc: Object.fromEntries([...new Set(canonicalUi.rpcCalls.map((call) => call.name))].map((name) => [
        name, canonicalUi.rpcCalls.filter((call) => call.name === name).length,
      ])),
      database: canonicalUi.counts,
    })}`);
    assert.equal(canonicalUi.providerCalls.filter((call) => call.path === "/review/seller/reply/add").length, 1);
    assert.equal(canonicalUi.providerCalls.filter((call) => call.path === "/review/seller/list/v2").length, 1);
    assert.equal(canonicalUi.actualProvider.mutationBegins, 1);
    assert.equal(canonicalUi.actualProvider.delivery.status, "verified");
    assert.equal(canonicalUi.actualProvider.claimed.credential_id, exactOAuthClaim.credential_id);
    assert.equal(canonicalUi.actualProvider.claimed.credential.app_key, "137451");
    assert.equal(canonicalUi.actualProvider.claimed.credential.im_app_key, "137571");
    assert.equal(canonicalUi.actualProvider.claimed.credential.provider_account_subject,
      providerCredential.identity.subject);
    assertLazadaExactRefresh(exactOAuthClaim.credential, canonicalUi.actualProvider.claimed.credential);
    const bindingReceipt = (await db.query(`select
      delivery.owner_id,
      delivery.credential_id,
      delivery.seller_account_key,
      delivery.review_id,
      delivery.review_generation,
      delivery.review_event_key,
      credential.created_by credential_owner_id,
      credential.seller_account_key credential_seller_account_key,
      job.created_by job_owner_id,
      job.credential_id job_credential_id,
      job.seller_account_key job_seller_account_key,
      job.request_payload#>>'{arguments,generation}' job_generation,
      event.owner_id event_owner_id,
      event.credential_id event_credential_id,
      event.seller_account_key event_seller_account_key,
      event.event_key,
      greatest(1,floor(extract(epoch from event.observed_at)*1000)::bigint) event_generation,
      capability.credential_id grant_credential_id,
      capability.seller_account_key grant_seller_account_key,
      capability.country grant_country
    from sellerpilot_private.lazada_product_review_reply_deliveries delivery
    join sellerpilot_private.channel_credentials credential on credential.id=delivery.credential_id
    join sellerpilot_private.channel_gateway_jobs job on job.id=delivery.gateway_job_id
    join sellerpilot_private.lazada_supplemental_cs_events event
      on event.event_key=delivery.review_event_key
    join sellerpilot_private.lazada_product_review_reply_grants capability
      on capability.id=delivery.grant_id
    where delivery.id=$1`, [canonicalUi.actualProvider.delivery.id])).rows[0];
    assert.deepEqual({
      deliveryOwner: bindingReceipt.owner_id,
      credentialOwner: bindingReceipt.credential_owner_id,
      jobOwner: bindingReceipt.job_owner_id,
      eventOwner: bindingReceipt.event_owner_id,
    }, {
      deliveryOwner: ids.owner,
      credentialOwner: ids.owner,
      jobOwner: ids.owner,
      eventOwner: ids.owner,
    });
    assert.deepEqual([
      bindingReceipt.credential_id,
      bindingReceipt.job_credential_id,
      bindingReceipt.event_credential_id,
      bindingReceipt.grant_credential_id,
    ], [ids.credential, ids.credential, ids.credential, ids.credential]);
    assert.deepEqual([
      bindingReceipt.seller_account_key,
      bindingReceipt.credential_seller_account_key,
      bindingReceipt.job_seller_account_key,
      bindingReceipt.event_seller_account_key,
      bindingReceipt.grant_seller_account_key,
    ], [sellerAccountKey, sellerAccountKey, sellerAccountKey, sellerAccountKey, sellerAccountKey]);
    assert.equal(bindingReceipt.review_id, "11111111111");
    assert.equal(bindingReceipt.review_event_key, eventKey);
    assert.equal(bindingReceipt.event_key, eventKey);
    assert.equal(bindingReceipt.review_generation, bindingReceipt.event_generation);
    assert.equal(bindingReceipt.job_generation, String(bindingReceipt.review_generation));
    assert.equal(bindingReceipt.grant_country, "MY");
    context.diagnostic(`exact-binding ${JSON.stringify({
      commit: "4153c259",
      appKey: exactOAuthClaim.credential.app_key,
      imAppKey: exactOAuthClaim.credential.im_app_key,
      sellerId: providerCredential.countryUserInfo[0]?.seller_id,
      shortCode: providerCredential.countryUserInfo[0]?.short_code,
      sellerAccountKey,
      ownerId: bindingReceipt.owner_id,
      credentialId: bindingReceipt.credential_id,
      reviewId: bindingReceipt.review_id,
      generation: bindingReceipt.review_generation,
      deliveryStatus: canonicalUi.actualProvider.delivery.status,
    })}`);
  } finally {
    await db.close();
    delete globalThis.__sellerpilotLazadaProductReviewCanonicalStack;
  }
});
