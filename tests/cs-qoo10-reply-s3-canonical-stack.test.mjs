import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === "server-only"
    ? { shortCircuit: true, url: "data:text/javascript,export default {}" }
    : nextResolve(specifier, context);
} });

const { normalizeChannelInquiries } = await import("../lib/channels/inquiry-sync.ts");
const { qoo10HistoryGatewayCompletion } = await import("../lib/channels/cs/qoo10/history-gateway.ts");
const { qoo10HistoryExecutionRequests } = await import("../lib/channels/cs/qoo10/history-runtime.ts");
const { qoo10InquirySourceReadSchema } = await import("../lib/cs/channels/qoo10/source-capability.ts");

const integratedRoot = process.env.SELLERPILOT_QOO10_INTEGRATED_ROOT
  ?? "/Users/kimchangheemac/dev/sellerpilot-cs-central-20260909";
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
  credentialOther: "62000000-0000-4000-8000-000000000011",
  credentialRotated: "62000000-0000-4000-8000-000000000012",
  credentialAccountAOld: "62000000-0000-4000-8000-000000000017",
  vaultOther: "62000000-0000-4000-8000-000000000013",
  vaultRotated: "62000000-0000-4000-8000-000000000014",
  vaultAccountAOld: "62000000-0000-4000-8000-000000000018",
  draftA: "62000000-0000-4000-8000-000000000015",
  draftB: "62000000-0000-4000-8000-000000000016",
  gatewayWorker: "62000000-0000-4000-8000-000000000004",
  serverlessWorker: "62000000-0000-4000-8000-000000000005",
  ticket: "62000000-0000-4000-8000-000000000006",
  inbound: "62000000-0000-4000-8000-000000000007",
  replyJob: "62000000-0000-4000-8000-000000000008",
  replyClaim: "62000000-0000-4000-8000-000000000009",
  readClaim: "62000000-0000-4000-8000-000000000010",
  historyVault: "62000000-0000-4000-8000-000000000019",
  historyCredential: "62000000-0000-4000-8000-000000000020",
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
    await db.exec(`
      drop index sellerpilot_private.channel_credentials_one_active_idx;
      create unique index channel_credentials_one_active_non_lazada_elevenst_smartstore_idx
        on sellerpilot_private.channel_credentials(channel,environment)
        where status='active' and channel not in ('lazada','elevenst','smartstore');
      create unique index channel_credentials_one_active_lazada_account_idx
        on sellerpilot_private.channel_credentials(environment,seller_account_key)
        where status='active' and channel='lazada' and seller_account_key is not null;
      create unique index channel_credentials_one_active_lazada_pending_owner_idx
        on sellerpilot_private.channel_credentials(created_by,environment)
        where status='active' and channel='lazada' and seller_account_key is null;
      create unique index channel_credentials_elevenst_active_account_idx
        on sellerpilot_private.channel_credentials(channel,environment,seller_account_key)
        where status='active' and channel='elevenst';
      create table sellerpilot_private.elevenst_credential_identity_claims(
        credential_id uuid primary key,
        seller_account_key text not null,
        lifecycle_state text not null
      );
    `);
    await db.exec(await readFile(new URL(
      "../supabase/migrations/20260909153340_cs_qoo10_multi_account_credential_storage.sql",
      import.meta.url,
    ), "utf8"));
    await db.exec(await readFile(new URL(
      "../supabase/migrations/20260909153334_cs_qoo10_history_window_ledger.sql",
      import.meta.url,
    ), "utf8"));
    const preservedAccountIndexes = (await db.query(`
      select indexname from pg_indexes
      where schemaname='sellerpilot_private' and indexname in(
        'channel_credentials_one_active_lazada_account_idx',
        'channel_credentials_one_active_lazada_pending_owner_idx',
        'channel_credentials_elevenst_active_account_idx',
        'channel_credentials_one_active_other_cs_idx',
        'channel_credentials_one_active_qoo10_account_idx'
      ) order by indexname
    `)).rows.map((row) => row.indexname);
    assert.deepEqual(preservedAccountIndexes, [
      "channel_credentials_elevenst_active_account_idx",
      "channel_credentials_one_active_lazada_account_idx",
      "channel_credentials_one_active_lazada_pending_owner_idx",
      "channel_credentials_one_active_other_cs_idx",
      "channel_credentials_one_active_qoo10_account_idx",
    ]);
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
      [fixtureIds.vault, JSON.stringify({
        api_key: "synthetic-qapi-fixture",
        provider_account_subject: "qoo10:v1:reply-fixture",
        provider_account_identity_version: "v1",
      })],
    );
    await db.query("select set_config('request.jwt.claim.role','service_role',false)");
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
    for (const [vaultId, credentialId, version, fingerprint, providerSubject] of [
      [fixtureIds.vaultAccountAOld, fixtureIds.credentialAccountAOld, 1000, "CANONICAL0003", "qoo10:v1:account-a"],
      [fixtureIds.vaultOther, fixtureIds.credentialOther, 1001, "CANONICAL0004", "qoo10:v1:account-b"],
    ]) {
      await db.query(
        `insert into vault.secrets(id,secret,name,description)
         values($1,$2,$3,'synthetic test only')`,
        [vaultId, JSON.stringify({
          api_key: `synthetic-${version}`,
          provider_account_subject: providerSubject,
          provider_account_identity_version: "v1",
        }), `qoo10-account-${version}`],
      );
      await db.query(`insert into sellerpilot_private.channel_credentials(
        id,channel,environment,version,vault_secret_id,fingerprint,status,expires_at,created_by
      ) values($1,'qoo10','sandbox',$2,$3,$4,'active',clock_timestamp()+interval '1 day',$5)`, [
        credentialId, version, vaultId, fingerprint, fixtureIds.owner,
      ]);
    }
    const accountASellerAccountKey = (await db.query(`select seller_account_key
      from sellerpilot_private.channel_credentials where id=$1`, [
      fixtureIds.credentialAccountAOld,
    ])).rows[0].seller_account_key;
    const otherSellerAccountKey = (await db.query(`select seller_account_key
      from sellerpilot_private.channel_credentials where id=$1`, [
      fixtureIds.credentialOther,
    ])).rows[0].seller_account_key;
    assert.match(accountASellerAccountKey, /^[a-f0-9]{64}$/u);
    assert.match(otherSellerAccountKey, /^[a-f0-9]{64}$/u);
    assert.notEqual(accountASellerAccountKey, otherSellerAccountKey);
    await db.query(`update sellerpilot_private.channel_credentials set
      status='grace',grace_ends_at=clock_timestamp()+interval '1 day'
      where id=$1`, [fixtureIds.credentialAccountAOld]);
    await db.query(`insert into vault.secrets(id,secret,name,description)
      values($1,$2,'qoo10-account-rotation','synthetic test only')`, [
      fixtureIds.vaultRotated,
      JSON.stringify({
        api_key: "synthetic-rotation",
        provider_account_subject: "qoo10:v1:account-a",
        provider_account_identity_version: "v1",
      }),
    ]);
    await db.query(`insert into sellerpilot_private.channel_credentials(
      id,channel,environment,version,vault_secret_id,fingerprint,status,expires_at,created_by
    ) values($1,'qoo10','sandbox',1002,$2,'CANONICAL0005','active',
      clock_timestamp()+interval '1 day',$3)`, [
      fixtureIds.credentialRotated, fixtureIds.vaultRotated, fixtureIds.owner,
    ]);
    assert.equal((await db.query(`select seller_account_key=$2 matches
      from sellerpilot_private.channel_credentials where id=$1`, [
      fixtureIds.credentialRotated, accountASellerAccountKey,
    ])).rows[0].matches, true);
    assert.equal((await db.query(`select count(*)::integer count
      from sellerpilot_private.channel_credentials
      where id in($1,$2) and status='active'`, [
      fixtureIds.credentialOther, fixtureIds.credentialRotated,
    ])).rows[0].count, 2);

    const normalizeInquiry = ({ sellerAccountKey, sourceCredentialId, sequenceNo, contents, inquiryDate }) => (
      normalizeChannelInquiries("qoo10", {
        ok: true,
        channel: "qoo10",
        operation: "inquiries.list",
        steps: [{ name: "GetInquiryMessage", ok: true, status: 200, data: {
          ResultCode: 0,
          ResultObject: [{
            INQ_TYPE: "MSG", QUESTION_NO: "8800", SEQ_NO: sequenceNo,
            CONTENTS: contents, STATUS: "S1", INQ_DT: inquiryDate,
          }],
        } }],
        safeMessage: "synthetic inquiry read",
      }, "2026-09-09T02:00:00.000Z", {
        qoo10Identity: {
          account: { ownerId: fixtureIds.owner, sellerAccountKey, environment: "sandbox" },
          sourceCredentialId,
        },
      })[0]
    );
    const accountAOld = normalizeInquiry({
      sellerAccountKey: accountASellerAccountKey,
      sourceCredentialId: fixtureIds.credentialAccountAOld,
      sequenceNo: "8801",
      contents: "account A old sequence",
      inquiryDate: "20260909090000",
    });
    const accountBOld = normalizeInquiry({
      sellerAccountKey: otherSellerAccountKey,
      sourceCredentialId: fixtureIds.credentialOther,
      sequenceNo: "8801",
      contents: "account B same provider sequence",
      inquiryDate: "20260909090000",
    });
    const accountANew = normalizeInquiry({
      sellerAccountKey: accountASellerAccountKey,
      sourceCredentialId: fixtureIds.credentialRotated,
      sequenceNo: "8802",
      contents: "account A next sequence",
      inquiryDate: "20260909090100",
    });
    const sqlIdentity = (await db.query(`select
      encode(extensions.digest('sellerpilot-qoo10-account-v1'||chr(31)||lower($1)||chr(31)||$2||chr(31)||'sandbox','sha256'),'hex') account_digest,
      encode(extensions.digest('qoo10-thread-v2'||chr(31)||$3||chr(31)||'MSG'||chr(31)||'8800','sha256'),'hex') conversation_digest,
      encode(extensions.digest('qoo10-message-v2'||chr(31)||$4||chr(31)||'8801','sha256'),'hex') message_digest`, [
      fixtureIds.owner, accountASellerAccountKey,
      accountAOld.providerContext.accountIdentityDigest,
      accountAOld.providerContext.conversationIdentityDigest,
    ])).rows[0];
    assert.deepEqual(sqlIdentity, {
      account_digest: accountAOld.providerContext.accountIdentityDigest,
      conversation_digest: accountAOld.providerContext.conversationIdentityDigest,
      message_digest: accountAOld.providerContext.messageIdentityDigest,
    });
    for (const [credentialId, inquiry] of [
      [fixtureIds.credentialAccountAOld, accountAOld],
      [fixtureIds.credentialOther, accountBOld],
    ]) {
      assert.equal((await db.query(
        "select public.sellerpilot_service_ingest_inquiries($1,'qoo10',$2::jsonb) value",
        [credentialId, JSON.stringify([inquiry])],
      )).rows[0].value, 1);
    }
    const beforeRotation = (await db.query(`select external_ticket_id,seller_account_key,
      source_credential_id from sellerpilot_private.support_tickets
      where owner_id=$1 and channel_key='qoo10'
        and external_ticket_id like 'qoo10:conversation:%'
      order by seller_account_key`, [fixtureIds.owner])).rows;
    const credentialLineage = (await db.query(`select id,status,seller_account_key
      from sellerpilot_private.channel_credentials
      where id in($1,$2,$3) order by id`, [
      fixtureIds.credential, fixtureIds.credentialOther, fixtureIds.credentialRotated,
    ])).rows;
    assert.equal(beforeRotation.length, 2, JSON.stringify({ beforeRotation, credentialLineage }));
    assert.equal(beforeRotation.find((row) => row.external_ticket_id === accountAOld.externalTicketId)?.seller_account_key,
      accountASellerAccountKey, JSON.stringify({ beforeRotation, credentialLineage }));
    for (const [credentialId, inquiry] of [
      [fixtureIds.credentialRotated, accountANew],
      [fixtureIds.credentialAccountAOld, accountAOld],
    ]) {
      assert.equal((await db.query(
        "select public.sellerpilot_service_ingest_inquiries($1,'qoo10',$2::jsonb) value",
        [credentialId, JSON.stringify([inquiry])],
      )).rows[0].value, 1);
    }
    const accountTickets = (await db.query(`select id,external_ticket_id,seller_account_key,
      source_credential_id,latest_inbound_key,message,reply_context,provider_context
      from sellerpilot_private.support_tickets
      where owner_id=$1 and channel_key='qoo10'
        and external_ticket_id like 'qoo10:conversation:%'
      order by seller_account_key`, [fixtureIds.owner])).rows;
    assert.equal(accountTickets.length, 2);
    const ticketA = accountTickets.find((row) => row.seller_account_key === accountASellerAccountKey);
    const ticketB = accountTickets.find((row) => row.seller_account_key === otherSellerAccountKey);
    assert.ok(ticketA && ticketB);
    assert.notEqual(ticketA.external_ticket_id, ticketB.external_ticket_id);
    assert.equal(ticketA.latest_inbound_key, accountANew.inboundKey);
    assert.equal(ticketA.message, "account A next sequence");
    assert.equal(ticketA.source_credential_id, fixtureIds.credentialRotated);
    assert.equal(ticketB.latest_inbound_key, accountBOld.inboundKey);
    assert.deepEqual(ticketA.provider_context.legacyExternalTicketIds, ["qoo10:MSG:8800:8802"]);
    assert.deepEqual(ticketB.provider_context.legacyExternalTicketIds, ["qoo10:MSG:8800:8801"]);
    assert.deepEqual(ticketA.reply_context, accountANew.replyContext);
    assert.deepEqual(ticketB.reply_context, accountBOld.replyContext);
    assert.equal((await db.query(`select count(*)::integer count
      from sellerpilot_private.support_inbound_messages
      where owner_id=$1 and channel_key='qoo10'
        and ticket_id in($2,$3)`, [fixtureIds.owner, ticketA.id, ticketB.id])).rows[0].count, 3);

    const normalizeClaim = (sellerAccountKey, sourceCredentialId) => normalizeChannelInquiries(
      "qoo10", {
        ok: true,
        channel: "qoo10",
        operation: "inquiries.list",
        steps: [{ name: "GetClaimInfo_V3", ok: true, status: 200, data: {
          sellerpilotInquiryKind: "claim",
          ResultCode: 0,
          ResultObject: [{
            claimStatus: "4", requestDate: "20260909090000",
            orderNo: "990012345678", reason: "same provider claim fixture",
          }],
        } }],
        safeMessage: "synthetic claim read",
      }, "2026-09-09T02:00:00.000Z", {
        qoo10Identity: {
          account: { ownerId: fixtureIds.owner, sellerAccountKey, environment: "sandbox" },
          sourceCredentialId,
        },
      },
    )[0];
    const claimA = normalizeClaim(accountASellerAccountKey, fixtureIds.credentialRotated);
    const claimB = normalizeClaim(otherSellerAccountKey, fixtureIds.credentialOther);
    assert.notEqual(claimA.externalTicketId, claimB.externalTicketId);
    for (const [credentialId, claim] of [
      [fixtureIds.credentialRotated, claimA],
      [fixtureIds.credentialOther, claimB],
    ]) {
      assert.equal((await db.query(
        "select public.sellerpilot_service_ingest_inquiries($1,'qoo10',$2::jsonb) value",
        [credentialId, JSON.stringify([claim])],
      )).rows[0].value, 1);
    }
    const storedClaims = (await db.query(`select external_ticket_id,seller_account_key,
      latest_inbound_key,provider_context->'legacyExternalTicketIds' aliases
      from sellerpilot_private.support_tickets
      where owner_id=$1 and channel_key='qoo10'
        and external_ticket_id like 'qoo10:claim-conversation:%'
      order by seller_account_key`, [fixtureIds.owner])).rows;
    assert.equal(storedClaims.length, 2);
    assert.equal(new Set(storedClaims.map((row) => row.external_ticket_id)).size, 2);
    assert.equal(new Set(storedClaims.map((row) => row.latest_inbound_key)).size, 2);
    assert.deepEqual(storedClaims.map((row) => row.aliases), [
      ["qoo10:claim:990012345678:20260909000000"],
      ["qoo10:claim:990012345678:20260909000000"],
    ]);

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [fixtureIds.owner]);
    for (const [draftId, ticketId, expectedInboundKey] of [
      [fixtureIds.draftA, ticketA.id, accountANew.inboundKey],
      [fixtureIds.draftB, ticketB.id, accountBOld.inboundKey],
    ]) {
      assert.equal((await db.query(`select public.sellerpilot_create_support_reply_job(
        $1,$2,$3,'ko-KR','polite'
      ) value`, [draftId, ticketId, expectedInboundKey])).rows[0].value, draftId);
    }
    await assert.rejects(db.query(`select public.sellerpilot_create_support_reply_job(
      gen_random_uuid(),$1,$2,'ko-KR','polite'
    )`, [ticketA.id, accountAOld.inboundKey]), /INQUIRY_CONTEXT_STALE/u);
    await assert.rejects(db.query(`select public.sellerpilot_create_support_reply_job(
      gen_random_uuid(),$1,$2,'ko-KR','polite'
    )`, [ticketA.id, accountBOld.inboundKey]), /INQUIRY_CONTEXT_STALE/u);
    const queuedDrafts = (await db.query(`select id,request_payload->>'ticket_id' ticket_id,
      request_payload->>'sellerpilotInboundKey' inbound_key
      from sellerpilot_private.ai_cli_jobs where id in($1,$2) order by id`, [
      fixtureIds.draftA, fixtureIds.draftB,
    ])).rows;
    assert.deepEqual(queuedDrafts, [
      { id: fixtureIds.draftA, ticket_id: ticketA.id, inbound_key: accountANew.inboundKey },
      { id: fixtureIds.draftB, ticket_id: ticketB.id, inbound_key: accountBOld.inboundKey },
    ]);
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

    await db.query(
      `insert into vault.secrets(id,secret,name,description)
       values($1,$2,'qoo10-history-canonical-fixture','synthetic test only')`,
      [fixtureIds.historyVault, JSON.stringify({
        api_key: "synthetic-history-qapi-fixture",
        provider_account_subject: "qoo10:v1:history-fixture",
        provider_account_identity_version: "v1",
      })],
    );
    const proposedHistorySellerAccountKey = "6".repeat(64);
    await db.query(`insert into sellerpilot_private.channel_credentials(
      id,channel,environment,version,vault_secret_id,fingerprint,status,expires_at,
      created_by,seller_account_key,seller_account_key_source,seller_account_verified_at
    ) values($1,'qoo10','production',2000,$2,'CANONICALH001','active',clock_timestamp()+interval '1 day',
      $3,$4,'provider_certified_v1',clock_timestamp())`, [
      fixtureIds.historyCredential, fixtureIds.historyVault, fixtureIds.owner, proposedHistorySellerAccountKey,
    ]);
    const historySellerAccountKey = (await db.query(`select seller_account_key
      from sellerpilot_private.channel_credentials where id=$1`, [
      fixtureIds.historyCredential,
    ])).rows[0].seller_account_key;
    assert.match(historySellerAccountKey, /^[a-f0-9]{64}$/u);

    const historyRequest = qoo10HistoryExecutionRequests("2026-09-08", "2026-09-08")[0];
    const enqueue = (await db.query(`select public.sellerpilot_service_enqueue_periodic_sync(
      'qoo10','inquiries.list',$1::jsonb,5
    ) value`, [JSON.stringify(historyRequest)])).rows[0].value;
    assert.equal(enqueue.status, "queued");
    const historyJobId = enqueue.jobId;
    const claimedParent = (await db.query(
      "select public.sellerpilot_claim_serverless_cs_job($1,'qoo10-history-canonical/1') value",
      [serverlessTokenHash],
    )).rows[0].value;
    assert.equal(claimedParent.id, historyJobId);
    assert.equal(claimedParent.credential_id, fixtureIds.historyCredential);
    assert.equal(claimedParent.environment, "production");
    assert.equal(claimedParent.request.periodicKey, historyRequest.periodicKey);
    const parentProviderResult = {
      ok: true,
      channel: "qoo10",
      operation: "inquiries.list",
      steps: [{ name: "GetInquiryMessage", ok: true, status: 200, data: {
        ResultCode: 0, ResultObject: [], TotalCount: 5,
      } }],
      safeMessage: "synthetic history parent",
    };
    const canonicalHistoryCompletion = qoo10HistoryGatewayCompletion({
      arguments: claimedParent.request.arguments,
      result: parentProviderResult,
    });
    assert.equal(canonicalHistoryCompletion.state, "refining");
    const actualParentCompletion = (await db.query(`select public.sellerpilot_service_complete_serverless_cs_transaction(
      $1,$2,$3,'succeeded',$4::jsonb,null,null,null,'[]'::jsonb,null
    ) value`, [
      serverlessTokenHash, historyJobId, claimedParent.claim_token, JSON.stringify(parentProviderResult),
    ])).rows[0].value;
    assert.equal(actualParentCompletion.status, "completed");
    assert.equal((await db.query(`select count(*)::integer count
      from sellerpilot_private.gateway_completion_receipts where job_id=$1 and claim_token=$2`, [
      historyJobId, claimedParent.claim_token,
    ])).rows[0].count, 1);
    const parentRecord = (await db.query(`select public.sellerpilot_service_record_qoo10_history_window_v1(
      $1,$2,$3,$4::jsonb
    ) value`, [
      serverlessTokenHash, historyJobId, claimedParent.claim_token,
      JSON.stringify(canonicalHistoryCompletion),
    ])).rows[0].value;
    assert.equal(parentRecord.status, "recorded");
    assert.equal(parentRecord.refinementCount, 24);

    const historyChildren = (await db.query(`select id,credential_id,seller_account_key,
      environment,request_payload,status
      from sellerpilot_private.channel_gateway_jobs
      where request_payload#>>'{arguments,sellerpilotHistoryWindow,parentWindowKey}'=$1
      order by request_payload->>'periodicKey'`, [historyRequest.periodicKey])).rows;
    assert.equal(historyChildren.length, 24);
    for (const historyChild of historyChildren) {
      assert.equal(historyChild.credential_id, fixtureIds.historyCredential);
      assert.equal(historyChild.seller_account_key, historySellerAccountKey);
      assert.equal(historyChild.environment, "production");
      assert.equal(historyChild.status, "queued");
      assert.equal(historyChild.request_payload.arguments.sellerpilotHistoryWindow.contractVersion,
        "sellerpilot-qoo10-history-window/1");
    }

    const claimedChild = (await db.query(
      "select public.sellerpilot_claim_serverless_cs_job($1,'qoo10-history-canonical/1') value",
      [serverlessTokenHash],
    )).rows[0].value;
    assert.ok(historyChildren.some((historyChild) => historyChild.id === claimedChild.id));
    assert.equal(claimedChild.credential_id, fixtureIds.historyCredential);
    const childProviderResult = structuredClone(parentProviderResult);
    childProviderResult.steps[0].data.TotalCount = 0;
    childProviderResult.safeMessage = "synthetic history child";
    const canonicalChildCompletion = qoo10HistoryGatewayCompletion({
      arguments: claimedChild.request.arguments,
      result: childProviderResult,
    });
    assert.equal(canonicalChildCompletion.state, "complete");
    assert.equal((await db.query(`select public.sellerpilot_service_complete_serverless_cs_transaction(
      $1,$2,$3,'succeeded',$4::jsonb,null,null,null,'[]'::jsonb,null
    ) value`, [
      serverlessTokenHash, claimedChild.id, claimedChild.claim_token, JSON.stringify(childProviderResult),
    ])).rows[0].value.status, "completed");
    assert.equal((await db.query(`select public.sellerpilot_service_record_qoo10_history_window_v1(
      $1,$2,$3,$4::jsonb
    ) value`, [
      serverlessTokenHash, claimedChild.id, claimedChild.claim_token,
      JSON.stringify(canonicalChildCompletion),
    ])).rows[0].value.status, "recorded");
    assert.equal((await db.query(`select public.sellerpilot_service_record_qoo10_history_window_v1(
      $1,$2,$3,$4::jsonb
    ) value`, [
      serverlessTokenHash, historyJobId, claimedParent.claim_token,
      JSON.stringify(canonicalHistoryCompletion),
    ])).rows[0].value.status, "duplicate");

    await db.query("update sellerpilot_private.ai_cli_worker_tokens set status='revoked' where id=$1", [
      fixtureIds.serverlessWorker,
    ]);
    const gatewayClaimedChild = (await db.query(
      "select public.sellerpilot_claim_channel_gateway_job($1,'qoo10-history-canonical/1') value",
      [gatewayTokenHash],
    )).rows[0].value;
    assert.ok(historyChildren.some((historyChild) => historyChild.id === gatewayClaimedChild.id));
    assert.equal(gatewayClaimedChild.credential_id, fixtureIds.historyCredential);
    const gatewayChildCompletion = qoo10HistoryGatewayCompletion({
      arguments: gatewayClaimedChild.request.arguments,
      result: childProviderResult,
    });
    assert.equal((await db.query(`select public.sellerpilot_service_complete_gateway_transaction(
      $1,$2,$3,'succeeded',$4::jsonb,null,null,null,'[]'::jsonb,null
    ) value`, [
      gatewayTokenHash, gatewayClaimedChild.id, gatewayClaimedChild.claim_token,
      JSON.stringify(childProviderResult),
    ])).rows[0].value.status, "completed");
    assert.equal((await db.query(`select public.sellerpilot_service_record_qoo10_history_window_v1(
      $1,$2,$3,$4::jsonb
    ) value`, [
      gatewayTokenHash, gatewayClaimedChild.id, gatewayClaimedChild.claim_token,
      JSON.stringify(gatewayChildCompletion),
    ])).rows[0].value.status, "recorded");

    const productionInquiry = normalizeChannelInquiries("qoo10", {
      ok: true,
      channel: "qoo10",
      operation: "inquiries.list",
      steps: [{ name: "GetInquiryMessage", ok: true, status: 200, data: {
        ResultCode: 0,
        ResultObject: [{
          INQ_TYPE: "ITEM", QUESTION_NO: "9900", SEQ_NO: "9901",
          CONTENTS: "production canonical source fixture", STATUS: "S1",
          INQ_DT: "20260910090000",
        }],
      } }],
      safeMessage: "synthetic production inquiry read",
    }, "2026-09-10T00:05:00.000Z", {
      qoo10Identity: {
        account: {
          ownerId: fixtureIds.owner,
          sellerAccountKey: historySellerAccountKey,
          environment: "production",
        },
        sourceCredentialId: fixtureIds.historyCredential,
      },
    });
    assert.equal((await db.query(
      "select public.sellerpilot_service_ingest_inquiries($1,'qoo10',$2::jsonb) value",
      [fixtureIds.historyCredential, JSON.stringify(productionInquiry)],
    )).rows[0].value, 1);
    await db.exec(await readFile(new URL(
      "../supabase/migrations/20260910050000_cs_qoo10_source_capability_status.sql",
      import.meta.url,
    ), "utf8"));
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [fixtureIds.owner]);
    await db.exec("set role authenticated");
    const sourceRead = qoo10InquirySourceReadSchema.parse((await db.query(
      "select public.sellerpilot_read_qoo10_inquiry_source_v1($1) value",
      [fixtureIds.historyCredential],
    )).rows[0].value);
    assert.equal(sourceRead.canonical.ticketCount, 1);
    assert.equal(sourceRead.canonical.inboundMessageCount, 1);
    assert.ok(sourceRead.history.windowCount >= 3);
    assert.ok(sourceRead.history.completeWindowCount >= 2);
    assert.ok(sourceRead.history.verifiedZeroWindowCount >= 1);
  } finally {
    await db.close();
    delete globalThis.__sellerpilotQoo10CanonicalStack;
  }
});
