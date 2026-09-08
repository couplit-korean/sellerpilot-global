import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const integratedRoot = process.env.SELLERPILOT_QOO10_INTEGRATED_ROOT
  ?? "/Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908";
const canonicalTestPath = path.join(integratedRoot, "tests/supabase-migrations.test.mjs");
const canonicalMigrationUrl = pathToFileURL(path.join(integratedRoot, "supabase/migrations/"));
const canonicalMigrationSourceFilesUrl = pathToFileURL(path.join(
  integratedRoot,
  "tests/migration-source-files.mjs",
));
const unrelatedShopeeBlocker = "20260904211500_allow_local_shopee_category_and_diagnostic_claims.sql";
const fixtureIds = {
  owner: "62000000-0000-4000-8000-000000000001",
  vault: "62000000-0000-4000-8000-000000000002",
  credential: "62000000-0000-4000-8000-000000000003",
  gatewayWorker: "62000000-0000-4000-8000-000000000004",
  serverlessWorker: "62000000-0000-4000-8000-000000000005",
  ticket: "62000000-0000-4000-8000-000000000006",
  inbound: "62000000-0000-4000-8000-000000000007",
  replyJob: "62000000-0000-4000-8000-000000000008",
  replyClaim: "62000000-0000-4000-8000-000000000009",
  readClaim: "62000000-0000-4000-8000-000000000010",
};
const replyFingerprint = "e8a791c05cc3fce91b348087ccb79f6bb0efcf5a959986d62f5e9e3cbebfcb87";
const gatewayTokenHash = "9".repeat(64);
const serverlessTokenHash = "a".repeat(64);
const inboundKey = "qoo10:canonical:synthetic-inbound";

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
  '\n    assert.ok(migrationNames.includes("20260908153341_cs_qoo10_reply_s3_actual_completion.sql"));',
);

canonicalSource = canonicalSource.replace(
  'test("Supabase migrations apply in order and core RPC flows persist safely"',
  'test("canonical migrations apply until the pre-existing Shopee source-drift blocker"',
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
    globalThis.__sellerpilotQoo10CanonicalStack = db;
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

test("Qoo10 actual completion installs over canonical terminal, token, ledger, and workspace definitions", async () => {
  const db = globalThis.__sellerpilotQoo10CanonicalStack;
  assert.ok(db, "canonical migration stack must finish before Qoo10 assertions");
  try {
    for (const migrationName of [
      "20260907232000_add_cs_reply_remote_observation.sql",
      "20260908140419_cs_qoo10_reply_s3_status.sql",
      "20260908140421_cs_qoo10_reply_s3_response_seal.sql",
      "20260908145336_cs_qoo10_reply_s3_common_paths.sql",
      "20260908153341_cs_qoo10_reply_s3_actual_completion.sql",
    ]) {
      await db.exec(await readFile(path.join(integratedRoot, "supabase/migrations", migrationName), "utf8"));
    }
    const objects = (await db.query(`select
      to_regprocedure('public.sellerpilot_complete_channel_gateway_job(text,uuid,uuid,text,jsonb,text)') is not null terminal,
      to_regprocedure('sellerpilot_private.worker_token_may_complete_gateway_job(text,uuid,uuid)') is not null token_gate,
      to_regprocedure('sellerpilot_private.sync_inquiry_reply_delivery_ledger()') is not null reply_ledger,
      to_regprocedure('public.sellerpilot_get_cs_workspace_snapshot()') is not null workspace,
      to_regprocedure('public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)') is not null completion,
      to_regclass('sellerpilot_private.qoo10_reply_s3_readback_enqueues') is not null enqueue_ledger,
      to_regclass('sellerpilot_private.qoo10_reply_s3_completion_seals') is not null completion_seal`)).rows[0];
    assert.deepEqual(objects, {
      terminal: true,
      token_gate: true,
      reply_ledger: true,
      workspace: true,
      completion: true,
      enqueue_ledger: true,
      completion_seal: true,
    });

    const canonicalDefinitions = (await db.query(`select
      pg_get_functiondef('public.sellerpilot_complete_channel_gateway_job(text,uuid,uuid,text,jsonb,text)'::regprocedure) terminal,
      pg_get_functiondef('sellerpilot_private.worker_token_may_complete_gateway_job(text,uuid,uuid)'::regprocedure) token_gate,
      pg_get_functiondef('sellerpilot_private.sync_inquiry_reply_delivery_ledger()'::regprocedure) reply_ledger,
      pg_get_functiondef('public.sellerpilot_get_cs_workspace_snapshot()'::regprocedure) workspace`)).rows[0];
    assert.match(canonicalDefinitions.terminal, /sellerpilot_222257_complete_gateway_before_qoo10_retry_preserve/u);
    assert.match(canonicalDefinitions.token_gate, /serverless_cs/u);
    assert.match(canonicalDefinitions.reply_ledger, /support_reply_deliveries/u);
    assert.match(canonicalDefinitions.workspace, /qoo10S3StatusObserved/u);

    await db.query("insert into auth.users(id,email) values($1,'qoo10-canonical@example.invalid')", [fixtureIds.owner]);
    await db.query(
      "insert into sellerpilot_private.admin_users(user_id,display_name) values($1,'Qoo10 Canonical Fixture')",
      [fixtureIds.owner],
    );
    await db.query(
      `insert into vault.secrets(id,secret,name,description)
       values($1,$2,'qoo10-canonical-fixture','synthetic test only')`,
      [fixtureIds.vault, JSON.stringify({ api_key: "synthetic-qapi-fixture" })],
    );
    await db.query(`insert into sellerpilot_private.channel_credentials(
      id,channel,environment,version,vault_secret_id,fingerprint,status,expires_at,
      created_by,seller_account_key,seller_account_key_source,seller_account_verified_at
    ) values($1,'qoo10','sandbox',999,$2,'CANONICAL0001','active',clock_timestamp()+interval '1 day',
      $3,$4,'provider_certified_v1',clock_timestamp())`, [
      fixtureIds.credential, fixtureIds.vault, fixtureIds.owner, "7".repeat(64),
    ]);
    const canonicalSellerAccountKey = (await db.query(
      `select seller_account_key
       from sellerpilot_private.channel_credentials
       where id=$1`,
      [fixtureIds.credential],
    )).rows[0]?.seller_account_key;
    assert.match(canonicalSellerAccountKey, /^[a-f0-9]{64}$/u);
    for (const [id, label, tokenHash, scope] of [
      [fixtureIds.gatewayWorker, "qoo10-canonical-gateway", gatewayTokenHash, "gateway"],
      [fixtureIds.serverlessWorker, "qoo10-canonical-serverless", serverlessTokenHash, "serverless_cs"],
    ]) {
      await db.query(`insert into sellerpilot_private.ai_cli_worker_tokens(
        id,label,token_hash,fingerprint,status,expires_at,created_by,scope
      ) values($1,$2,$3,'CANONICAL002','active',clock_timestamp()+interval '1 day',$4,$5)`, [
        id, label, tokenHash, fixtureIds.owner, scope,
      ]);
    }
    await db.query(`insert into sellerpilot_private.support_tickets(
      id,owner_id,external_ticket_id,channel_key,customer_name,subject,message,status,
      received_at,demo,source_credential_id,seller_account_key,latest_inbound_key,ticket_kind
    ) values($1,$2,'MSG:9700','qoo10','synthetic','synthetic','synthetic','waiting',
      '2026-09-07T15:30:00Z',false,$3,$4,$5,'conversation')`, [
      fixtureIds.ticket, fixtureIds.owner, fixtureIds.credential, canonicalSellerAccountKey, inboundKey,
    ]);
    await db.query(`insert into sellerpilot_private.support_inbound_messages(
      id,ticket_id,owner_id,channel_key,inbound_key,sender_role,body,provider_context,received_at
    ) values($1,$2,$3,'qoo10',$4,'customer','synthetic','{}'::jsonb,'2026-09-07T15:30:00Z')`, [
      fixtureIds.inbound, fixtureIds.ticket, fixtureIds.owner, inboundKey,
    ]);
    const bindingDigest = (await db.query(
      "select sellerpilot_private.qoo10_reply_acceptance_binding_sha256('MSG','9700','9701') value",
    )).rows[0].value;
    const replyRequest = {
      arguments: { params: {
        inq_type: "MSG", question_no: "9700", seq_no: "9701", contents: "synthetic approved reply",
      } },
      sellerpilotInboundKey: inboundKey,
      sellerpilotReplyFingerprint: replyFingerprint,
      sellerpilotTicketId: fixtureIds.ticket,
    };
    const replyResponse = {
      ok: true,
      channel: "qoo10",
      operation: "inquiries.reply",
      steps: [{
        name: "SetInquiryMessage",
        ok: true,
        status: 200,
        data: {
          ResultCode: 0,
          sellerpilotReplyAcceptance: {
            contract: "sellerpilot-reply-acceptance/1",
            level: "provider_accepted",
            channel: "qoo10",
            kind: "inquiry",
            bindingDigest,
          },
        },
      }],
      safeMessage: "synthetic provider ACK",
    };
    await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
      id,credential_id,channel,operation,environment,request_payload,status,worker_token_id,
      attempt_count,lease_expires_at,created_by,started_at,updated_at,claim_token,
      seller_account_key,provider_mutation_started_at
    ) values($1,$2,'qoo10','inquiries.reply','sandbox',$3::jsonb,'running',$4,1,
      clock_timestamp()+interval '10 minutes',$5,clock_timestamp(),clock_timestamp(),$6,$7,clock_timestamp())`, [
      fixtureIds.replyJob, fixtureIds.credential, JSON.stringify(replyRequest), fixtureIds.gatewayWorker,
      fixtureIds.owner, fixtureIds.replyClaim, canonicalSellerAccountKey,
    ]);
    await db.query(`update sellerpilot_private.support_tickets set
      reply_gateway_job_id=$2,reply_delivery_status='sending',reply_delivery_error=null
      where id=$1`, [fixtureIds.ticket, fixtureIds.replyJob]);
    const parentCompletion = (await db.query(`select public.sellerpilot_service_complete_gateway_transaction(
      $1,$2,$3,'succeeded',$4::jsonb,null,null,null,null,null
    ) value`, [gatewayTokenHash, fixtureIds.replyJob, fixtureIds.replyClaim, JSON.stringify(replyResponse)])).rows[0].value;
    assert.equal(parentCompletion.status, "completed");
    const child = (await db.query(`select job.*
      from sellerpilot_private.qoo10_reply_s3_readback_enqueues enqueue
      join sellerpilot_private.channel_gateway_jobs job on job.id=enqueue.readback_job_id
      where enqueue.reply_job_id=$1`, [fixtureIds.replyJob])).rows[0];
    const parentState = {
      completion: parentCompletion,
      job: (await db.query(`select status,completed_at,response_payload,error_message
        from sellerpilot_private.channel_gateway_jobs where id=$1`, [fixtureIds.replyJob])).rows[0],
      receiptCount: (await db.query(`select count(*)::integer count
        from sellerpilot_private.gateway_completion_receipts where job_id=$1`, [fixtureIds.replyJob])).rows[0].count,
      delivery: (await db.query(`select status,verification_status,verification_contract
        from sellerpilot_private.support_reply_deliveries where gateway_job_id=$1`, [fixtureIds.replyJob])).rows[0],
      enqueueCount: (await db.query(`select count(*)::integer count
        from sellerpilot_private.qoo10_reply_s3_readback_enqueues where reply_job_id=$1`, [fixtureIds.replyJob])).rows[0].count,
    };
    assert.ok(child?.id, JSON.stringify(parentState));
    assert.equal(child.status, "queued");

    await db.query(`update sellerpilot_private.channel_gateway_jobs set
      status='running',worker_token_id=$2,claim_token=$3,attempt_count=attempt_count+1,
      lease_expires_at=clock_timestamp()+interval '10 minutes',started_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=$1`, [child.id, fixtureIds.serverlessWorker, fixtureIds.readClaim]);
    const resultObject = [{
      INQ_TYPE: "MSG", QUESTION_NO: "9700", SEQ_NO: "9701", STATUS: "S3",
    }];
    const storedResponse = {
      ok: true,
      channel: "qoo10",
      operation: "inquiries.list",
      steps: [{
        name: "GetInquiryMessage",
        ok: true,
        status: 200,
        data: {
          ResultCode: 0,
          ResultObject: resultObject,
          sellerpilotMarker: "sellerpilot-qoo10-s3-stored-evidence/1",
        },
      }],
      safeMessage: "synthetic S3 read",
    };
    const readCompletion = (await db.query(`select public.sellerpilot_service_complete_serverless_cs_transaction(
      $1,$2,$3,'succeeded',$4::jsonb,null,null,null,null,null
    ) value`, [serverlessTokenHash, child.id, fixtureIds.readClaim, JSON.stringify(storedResponse)])).rows[0].value;
    assert.equal(readCompletion.status, "completed");
    const readCompletionReplay = (await db.query(`select public.sellerpilot_service_complete_serverless_cs_transaction(
      $1,$2,$3,'succeeded',$4::jsonb,null,null,null,null,null
    ) value`, [serverlessTokenHash, child.id, fixtureIds.readClaim, JSON.stringify(storedResponse)])).rows[0].value;
    assert.deepEqual(readCompletionReplay, {
      status: "completed",
      replayed: true,
      continuationJobId: null,
    });
    const deliveryId = child.request_payload.arguments.sellerpilotQoo10ReplyReadback.deliveryId;
    const statusResult = (await db.query(`select public.sellerpilot_service_record_qoo10_reply_s3_readback_v1(
      $1,$2,$3,$4,'verified','exact_s3_status_observed',1,false,false
    ) value`, [serverlessTokenHash, child.id, fixtureIds.readClaim, deliveryId])).rows[0].value;
    assert.equal(statusResult.state, "verified");
    const statusReplay = (await db.query(`select public.sellerpilot_service_record_qoo10_reply_s3_readback_v1(
      $1,$2,$3,$4,'verified','exact_s3_status_observed',1,false,false
    ) value`, [serverlessTokenHash, child.id, fixtureIds.readClaim, deliveryId])).rows[0].value;
    assert.equal(statusReplay.state, "verified");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [fixtureIds.owner]);
    const delivery = (await db.query(
      "select public.sellerpilot_get_inquiry_reply_delivery($1,$2) value",
      [fixtureIds.ticket, fixtureIds.replyJob],
    )).rows[0].value;
    assert.equal(delivery.qoo10S3StatusObserved, true);
    assert.equal(delivery.qoo10S3ReadbackState, "verified");
    assert.equal(delivery.qoo10ReplyContentObserved, false);
    assert.equal(delivery.qoo10AutomaticResendAllowed, false);
    assert.equal((await db.query(`select count(*)::integer count
      from sellerpilot_private.gateway_completion_receipts
      where job_id in($1,$2)`, [fixtureIds.replyJob, child.id])).rows[0].count, 2);
    assert.equal((await db.query(`select count(*)::integer count
      from sellerpilot_private.qoo10_reply_s3_completion_seals
      where job_id=$1`, [child.id])).rows[0].count, 1);
  } finally {
    await db.close();
    delete globalThis.__sellerpilotQoo10CanonicalStack;
  }
});
