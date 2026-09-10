import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migration = (name) => readFile(resolve(root, "supabase/migrations", name), "utf8");
const sources = {
  atomic: await migration("20260826090400_atomic_gateway_completion_side_effects.sql"),
   serverless: await migration("20260828145600_serverless_cs_claim_and_runtime_bootstrap.sql"),
  terminal: await migration("20260825104500_prepare_gateway_credential_refresh.sql"),
  replyFence: await migration("20260825111757_harden_inquiry_reply_delivery_fence.sql"),
  ledger: await migration("20260831033000_add_cs_message_delivery_ledger.sql"),
  observation: await migration("20260907232000_add_cs_reply_remote_observation.sql"),
  latestCompletion: await migration("20260908153341_cs_qoo10_reply_s3_actual_completion.sql"),
  ebayObservation: await migration("20260909132027_cs_ebay_asq_reply_readback_delivery.sql"),
};

const ids = {
  owner: "20000000-0000-4000-8000-000000000001",
  credential: "20000000-0000-4000-8000-000000000002",
  worker: "20000000-0000-4000-8000-000000000003",
  ticket: "20000000-0000-4000-8000-000000000004",
  inbound: "20000000-0000-4000-8000-000000000005",
  job: "20000000-0000-4000-8000-000000000006",
  claim: "20000000-0000-4000-8000-000000000007",
  newerInbound: "20000000-0000-4000-8000-000000000008",
};
const tokenHash = "b".repeat(64);
const sellerAccountKey = "c".repeat(64);
const inboundKey = "ebay:" + "d".repeat(64);
const reply = "Canonical exact reply";
const replyFingerprint = createHash("sha256").update(reply).digest("hex");
const binding = {
  itemId: "1234567890123456789",
  marketplaceId: "EBAY_US",
  parentMessageId: "message-canonical",
  recipientId: "buyer-canonical",
};
const bindingDigest = createHash("sha256").update(JSON.stringify(binding)).digest("hex");
const requestPayload = {
  sellerpilotTicketId: ids.ticket,
  sellerpilotInboundKey: inboundKey,
  sellerpilotReplyFingerprint: replyFingerprint,
  arguments: { ...binding, reply },
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^$()|[\]{}\\]/gu, "\\$&");
}

function functionStatement(source, qualifiedName, occurrence = "last") {
  const pattern = new RegExp(`create(?: or replace)? function ${escapeRegExp(qualifiedName)}\\s*\\(`, "giu");
  const starts = [...source.matchAll(pattern)].map((match) => match.index);
  assert.ok(starts.length, `missing canonical function ${qualifiedName}`);
  const start = occurrence === "first" ? starts[0] : starts.at(-1);
  const tail = source.slice(start);
  const delimiterMatch = tail.match(/\bas\s+(\$[A-Za-z0-9_]*\$)/iu);
  assert.ok(delimiterMatch?.index !== undefined, `missing body delimiter for ${qualifiedName}`);
  const delimiter = delimiterMatch[1];
  const bodyStart = delimiterMatch.index + delimiterMatch[0].length;
  const bodyEnd = tail.indexOf(`${delimiter};`, bodyStart);
  assert.ok(bodyEnd >= 0, `missing body end for ${qualifiedName}`);
  return tail.slice(0, bodyEnd + delimiter.length + 1);
}

function taggedDoStatement(source, tag) {
  const startMarker = `do $${tag}$`;
  const endMarker = `$${tag}$;`;
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing canonical DO ${tag}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end >= 0, `missing canonical DO end ${tag}`);
  return source.slice(start, end + endMarker.length);
}

function triggerStatement(source, name) {
  const pattern = new RegExp(`create trigger ${escapeRegExp(name)}[\\s\\S]*?;`, "iu");
  const match = source.match(pattern);
  assert.ok(match, `missing canonical trigger ${name}`);
  return match[0];
}

function completionPayload() {
  return {
    ok: true,
    channel: "ebay",
    operation: "inquiries.reply",
    steps: [{
      name: "inquiry-reply",
      ok: true,
      status: 200,
      data: {
        sellerpilotReplyAcceptance: {
          contract: "sellerpilot-reply-acceptance/1",
          level: "provider_accepted",
          channel: "ebay",
          kind: "asq",
          bindingDigest,
        },
        sellerpilotReplyReadback: {
          contract: "sellerpilot-ebay-asq-reply-readback/1",
          level: "provider_observed",
          bindingDigest,
          replyBodyDigest: replyFingerprint,
          baselineResponseCount: 0,
          observedResponseCount: 1,
          observedAt: new Date().toISOString(),
          providerAnswerId: null,
          providerAnswerOccurredAt: null,
        },
      },
    }],
    remoteId: binding.parentMessageId,
    safeMessage: "synthetic canonical completion",
  };
}

async function installCanonicalCompletionAndLedger(db) {
  const run = async (label, sql) => {
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`${label}: ${error.message}`, { cause: error });
    }
  };

  await run("reply mutation classifier", functionStatement(
    sources.replyFence,
    "sellerpilot_private.gateway_external_write_observed",
  ));
  await run("canonical terminal", functionStatement(
    sources.terminal,
    "public.sellerpilot_complete_channel_gateway_job",
  ));
  await run("atomic completion fingerprint", functionStatement(
    sources.atomic,
    "sellerpilot_private.gateway_completion_fingerprint",
  ));
  await run("atomic completion context", functionStatement(
    sources.atomic,
    "public.sellerpilot_service_gateway_completion_context",
  ));
  await run("atomic gateway completion", functionStatement(
    sources.atomic,
    "public.sellerpilot_service_complete_gateway_transaction",
  ));
  await run("serverless ownership", functionStatement(
    sources.serverless,
    "sellerpilot_private.worker_token_may_complete_gateway_job",
    "first",
  ));
  await run("serverless canonical token rewrite", taggedDoStatement(sources.serverless, "migration"));

  await run(
    "rename current gateway completion beneath latest canonical wrapper",
    `alter function public.sellerpilot_service_complete_gateway_transaction(
      text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb
    ) rename to sellerpilot_145336_complete_before_qoo10_reply_s3`,
  );
  await run("latest canonical gateway completion", functionStatement(
    sources.latestCompletion,
    "public.sellerpilot_service_complete_gateway_transaction",
  ));
  await run("latest canonical serverless completion", functionStatement(
    sources.latestCompletion,
    "public.sellerpilot_service_complete_serverless_cs_transaction",
  ));

  await run("canonical reply ledger", functionStatement(
    sources.ledger,
    "sellerpilot_private.sync_inquiry_reply_delivery_ledger",
  ));
  await run("canonical reply ledger trigger", triggerStatement(
    sources.ledger,
    "sync_inquiry_reply_delivery_ledger",
  ));
  await run("canonical reply acceptance projection", functionStatement(
    sources.observation,
    "sellerpilot_private.track_reply_acceptance_verification",
  ));
  await run("canonical reply acceptance trigger", triggerStatement(
    sources.observation,
    "track_reply_acceptance_verification",
  ));
  await run("eBay observation projection", sources.ebayObservation);
}

async function canonicalFixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema extensions; create schema vault; create schema sellerpilot_private;
    create table auth.users(id uuid primary key,email text);
    create function extensions.digest(text,text) returns bytea language sql immutable
      as $$select sha256(convert_to($1,'UTF8'))$$;
    create table vault.secrets(id uuid primary key,secret text);
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,created_by uuid not null,channel text not null,environment text not null,
      version integer not null default 1,status text not null default 'active',vault_secret_id uuid
    );
    create table sellerpilot_private.ai_cli_worker_tokens(
      id uuid primary key,token_hash text not null,scope text not null,status text not null,
      expires_at timestamptz not null,last_seen_at timestamptz,last_version text
    );
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,credential_id uuid not null,attempt_id uuid,listing_id uuid,
      channel text not null,operation text not null,environment text not null,
      request_payload jsonb not null default '{}'::jsonb,response_payload jsonb,error_message text,
      status text not null,created_by uuid not null,claim_token uuid,worker_token_id uuid,
      lease_expires_at timestamptz,attempt_count integer not null default 0,
      credential_refresh_in_flight boolean not null default false,oauth_request_vault_id uuid,
      oauth_exchange_completed boolean not null default false,seller_account_key text,
      provider_mutation_started_at timestamptz,created_at timestamptz not null default clock_timestamp(),
      started_at timestamptz,completed_at timestamptz,updated_at timestamptz not null default clock_timestamp()
    );
    create unique index channel_gateway_jobs_continuation_once_idx
      on sellerpilot_private.channel_gateway_jobs((request_payload->>'continuationOf'))
      where nullif(request_payload->>'continuationOf','') is not null;
    create table sellerpilot_private.gateway_completion_receipts(
      job_id uuid primary key,claim_token uuid not null,worker_token_id uuid not null,
      completion_fingerprint text not null,continuation_job_id uuid,
      created_at timestamptz not null default clock_timestamp(),unique(job_id,claim_token)
    );
    create table sellerpilot_private.support_tickets(
      id uuid primary key,owner_id uuid not null,channel_key text not null,
      source_credential_id uuid,seller_account_key text,demo boolean not null default false,
      external_ticket_id text not null,ticket_kind text not null default 'conversation',
      reply_context jsonb not null default '{}'::jsonb,provider_context jsonb not null default '{}'::jsonb,
      latest_inbound_key text,status text not null default 'waiting',
      provider_status text not null default 'waiting',provider_status_updated_at timestamptz,
      reply_delivery_status text not null default 'sending',reply_delivery_error text,
      resolved_at timestamptz,last_delivery_job_id uuid,received_at timestamptz default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp()
    );
    create table sellerpilot_private.support_inbound_messages(
      id uuid primary key,ticket_id uuid not null,owner_id uuid not null,channel_key text not null,
      inbound_key text not null,remote_message_id text,sender_role text,body text,
      provider_context jsonb not null default '{}'::jsonb,received_at timestamptz
    );
    create table sellerpilot_private.support_reply_deliveries(
      id uuid primary key default gen_random_uuid(),ticket_id uuid not null,owner_id uuid not null,
      gateway_job_id uuid unique,channel_key text not null,status text not null,reply_fingerprint text,
      provider_request_id text,provider_message_id text,safe_message text,reconciliation_reason text,
      acknowledged_at timestamptz,acknowledged_by uuid,acknowledgement_reason text,
      queued_at timestamptz,started_at timestamptz,completed_at timestamptz,
      verification_status text not null default 'unverified',verification_contract text,
      provider_accepted_at timestamptz,remote_observed_at timestamptz,observed_message_id uuid,
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp()
    );
  `);
  await installCanonicalCompletionAndLedger(db);
  await db.query("insert into auth.users(id,email) values($1,'canonical@example.invalid')", [ids.owner]);
  await db.query(`insert into sellerpilot_private.channel_credentials(
    id,created_by,channel,environment,version,status
  ) values($1,$2,'ebay','production',1,'active')`, [ids.credential, ids.owner]);
  await db.query(`insert into sellerpilot_private.ai_cli_worker_tokens(
    id,token_hash,scope,status,expires_at
  ) values($1,$2,'serverless_cs','active',clock_timestamp()+interval '1 day')`, [ids.worker, tokenHash]);
  await db.query(`insert into sellerpilot_private.support_tickets(
    id,owner_id,channel_key,source_credential_id,seller_account_key,external_ticket_id,
    ticket_kind,reply_context,latest_inbound_key,status,provider_status,reply_delivery_status
  ) values($1,$2,'ebay',$3,$4,'ebay:message-canonical','conversation',$5::jsonb,$6,
    'waiting','waiting','sending')`, [
    ids.ticket, ids.owner, ids.credential, sellerAccountKey, JSON.stringify(binding), inboundKey,
  ]);
  await db.query(`insert into sellerpilot_private.support_inbound_messages(
    id,ticket_id,owner_id,channel_key,inbound_key,remote_message_id,sender_role,body,provider_context,received_at
  ) values($1,$2,$3,'ebay',$4,'message-canonical','customer','synthetic buyer question',$5::jsonb,clock_timestamp())`, [
    ids.inbound, ids.ticket, ids.owner, inboundKey, JSON.stringify(binding),
  ]);
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,channel,operation,environment,request_payload,status,created_by,
    claim_token,worker_token_id,lease_expires_at,attempt_count,seller_account_key,
    provider_mutation_started_at,started_at
  ) values($1,$2,'ebay','inquiries.reply','production',$3::jsonb,'running',$4,$5,$6,
    clock_timestamp()+interval '10 minutes',1,$7,clock_timestamp(),clock_timestamp())`, [
    ids.job, ids.credential, JSON.stringify(requestPayload), ids.owner, ids.claim, ids.worker,
    sellerAccountKey,
  ]);
  return db;
}

async function canonicalComplete(db, payload, entrypoint = "serverless") {
  const functionName = entrypoint === "gateway"
    ? "sellerpilot_service_complete_gateway_transaction"
    : "sellerpilot_service_complete_serverless_cs_transaction";
  return db.transaction(async (transaction) =>
    (await transaction.query(`select public.${functionName}(
      $1,$2,$3,'succeeded',$4::jsonb,null,null,null,null,null
    ) value`, [tokenHash, ids.job, ids.claim, JSON.stringify(payload)])).rows[0].value);
}

async function advanceTicketToNewInbound(db, input = {}) {
  const newerInboundKey = "ebay:" + "e".repeat(64);
  const newerBinding = input.binding ?? {
    ...binding,
    parentMessageId: "message-newer",
  };
  await db.query(`insert into sellerpilot_private.support_inbound_messages(
    id,ticket_id,owner_id,channel_key,inbound_key,remote_message_id,sender_role,body,provider_context,received_at
  ) values($1,$2,$3,'ebay',$4,$5,'customer','newer buyer question',$6::jsonb,clock_timestamp())`, [
    ids.newerInbound, ids.ticket, ids.owner, newerInboundKey,
    newerBinding.parentMessageId, JSON.stringify(newerBinding),
  ]);
  await db.query(`update sellerpilot_private.support_tickets set
    latest_inbound_key=$2,reply_context=$3::jsonb,status='waiting',provider_status='waiting',
    reply_delivery_status='sending',resolved_at=null,last_delivery_job_id=null where id=$1`, [
    ids.ticket, newerInboundKey, JSON.stringify(newerBinding),
  ]);
  return { newerInboundKey, newerBinding };
}

test("canonical serverless completion and reply ledger atomically persist one eBay observation and replay", async () => {
  const db = await canonicalFixture();
  try {
    const payload = completionPayload();
    const completion = await canonicalComplete(db, payload);
    assert.equal(completion.status, "completed");
    assert.deepEqual((await db.query(`select status,verification_status,verification_contract,
      provider_message_id,remote_observed_at is not null observed
      from sellerpilot_private.support_reply_deliveries where gateway_job_id=$1`, [ids.job])).rows[0], {
      status: "succeeded",
      verification_status: "remote_observed",
      verification_contract: "sellerpilot-ebay-asq-reply-readback/1",
      provider_message_id: null,
      observed: true,
    });
    assert.deepEqual((await db.query(`select status,provider_status,reply_delivery_status,
      last_delivery_job_id from sellerpilot_private.support_tickets where id=$1`, [ids.ticket])).rows[0], {
      status: "resolved",
      provider_status: "answered",
      reply_delivery_status: "succeeded",
      last_delivery_job_id: ids.job,
    });
    assert.equal((await db.query(
      "select count(*)::integer n from sellerpilot_private.gateway_completion_receipts where job_id=$1",
      [ids.job],
    )).rows[0].n, 1);
    assert.deepEqual(await canonicalComplete(db, payload), {
      status: "completed",
      replayed: true,
      continuationJobId: null,
    });
    assert.equal((await db.query(
      "select count(*)::integer n from sellerpilot_private.support_reply_deliveries where gateway_job_id=$1",
      [ids.job],
    )).rows[0].n, 1);
  } finally {
    await db.close();
  }
});

for (const entrypoint of ["gateway", "serverless"]) {
  test(`canonical ${entrypoint} completion preserves original observation when a newer inbound is current`, async () => {
    const db = await canonicalFixture();
    try {
      const { newerInboundKey, newerBinding } = await advanceTicketToNewInbound(db);
      const payload = completionPayload();
      const completion = await canonicalComplete(db, payload, entrypoint);
      assert.equal(completion.status, "completed");
      assert.deepEqual((await db.query(`select status,verification_status,verification_contract,
        provider_message_id,remote_observed_at is not null observed
        from sellerpilot_private.support_reply_deliveries where gateway_job_id=$1`, [ids.job])).rows[0], {
        status: "succeeded",
        verification_status: "remote_observed",
        verification_contract: "sellerpilot-ebay-asq-reply-readback/1",
        provider_message_id: null,
        observed: true,
      });
      assert.deepEqual((await db.query(`select latest_inbound_key,reply_context,status,provider_status,
        reply_delivery_status,resolved_at,last_delivery_job_id
        from sellerpilot_private.support_tickets where id=$1`, [ids.ticket])).rows[0], {
        latest_inbound_key: newerInboundKey,
        reply_context: newerBinding,
        status: "waiting",
        provider_status: "waiting",
        reply_delivery_status: "sending",
        resolved_at: null,
        last_delivery_job_id: null,
      });
      assert.deepEqual(await canonicalComplete(db, payload, entrypoint), {
        status: "completed",
        replayed: true,
        continuationJobId: null,
      });
      assert.equal((await db.query(
        "select count(*)::integer n from sellerpilot_private.support_reply_deliveries where gateway_job_id=$1",
        [ids.job],
      )).rows[0].n, 1);
    } finally {
      await db.close();
    }
  });
}

test("canonical gateway completion rejects malformed observation after a newer inbound without losing either generation", async () => {
  const db = await canonicalFixture();
  try {
    const { newerInboundKey } = await advanceTicketToNewInbound(db);
    const deliveryBefore = (await db.query(
      "select gateway_job_id,status,verification_status,remote_observed_at from sellerpilot_private.support_reply_deliveries",
    )).rows;
    const payload = completionPayload();
    payload.steps[0].data.sellerpilotReplyReadback.observedResponseCount = null;
    await assert.rejects(
      canonicalComplete(db, payload, "gateway"),
      /EBAY_ASQ_REPLY_OBSERVATION_INVALID/,
    );
    assert.deepEqual((await db.query(`select status,response_payload,completed_at,
      claim_token,worker_token_id from sellerpilot_private.channel_gateway_jobs where id=$1`, [ids.job])).rows[0], {
      status: "running",
      response_payload: null,
      completed_at: null,
      claim_token: ids.claim,
      worker_token_id: ids.worker,
    });
    assert.deepEqual((await db.query(
      "select gateway_job_id,status,verification_status,remote_observed_at from sellerpilot_private.support_reply_deliveries",
    )).rows, deliveryBefore);
    assert.deepEqual((await db.query(
      "select latest_inbound_key,status,resolved_at from sellerpilot_private.support_tickets where id=$1",
      [ids.ticket],
    )).rows[0], { latest_inbound_key: newerInboundKey, status: "waiting", resolved_at: null });
  } finally {
    await db.close();
  }
});

for (const [label, mutate] of [
  ["missing original inbound", async (db) => db.query(
    "delete from sellerpilot_private.support_inbound_messages where id=$1", [ids.inbound],
  )],
  ["tampered original inbound context", async (db) => db.query(
    "update sellerpilot_private.support_inbound_messages set provider_context=jsonb_set(provider_context,'{recipientId}',to_jsonb('other-buyer'::text)) where id=$1",
    [ids.inbound],
  )],
]) {
  test(`canonical completion rejects ${label} while a newer inbound remains open`, async () => {
    const db = await canonicalFixture();
    try {
      const { newerInboundKey } = await advanceTicketToNewInbound(db);
      await mutate(db);
      await assert.rejects(
        canonicalComplete(db, completionPayload()),
        /EBAY_ASQ_REPLY_OBSERVATION_IDENTITY_INVALID/,
      );
      assert.deepEqual((await db.query(
        "select latest_inbound_key,status,resolved_at from sellerpilot_private.support_tickets where id=$1",
        [ids.ticket],
      )).rows[0], { latest_inbound_key: newerInboundKey, status: "waiting", resolved_at: null });
    } finally {
      await db.close();
    }
  });
}

test("canonical completion rolls back terminal state, receipt and ledger when eBay observation fails", async () => {
  const db = await canonicalFixture();
  try {
    const deliveryBefore = (await db.query(
      "select gateway_job_id,status,verification_status,verification_contract,remote_observed_at from sellerpilot_private.support_reply_deliveries",
    )).rows;
    assert.deepEqual(deliveryBefore, [{
      gateway_job_id: ids.job,
      status: "running",
      verification_status: "unverified",
      verification_contract: null,
      remote_observed_at: null,
    }]);
    const payload = completionPayload();
    delete payload.steps[0].data.sellerpilotReplyReadback.observedAt;
    await assert.rejects(canonicalComplete(db, payload), /EBAY_ASQ_REPLY_OBSERVATION_INVALID/);
    assert.deepEqual((await db.query(`select status,response_payload,completed_at,
      claim_token,worker_token_id from sellerpilot_private.channel_gateway_jobs where id=$1`, [ids.job])).rows[0], {
      status: "running",
      response_payload: null,
      completed_at: null,
      claim_token: ids.claim,
      worker_token_id: ids.worker,
    });
    assert.equal((await db.query(
      "select count(*)::integer n from sellerpilot_private.gateway_completion_receipts",
    )).rows[0].n, 0);
    assert.deepEqual((await db.query(
      "select gateway_job_id,status,verification_status,verification_contract,remote_observed_at from sellerpilot_private.support_reply_deliveries",
    )).rows, deliveryBefore);
    assert.equal((await db.query(
      "select status from sellerpilot_private.support_tickets where id=$1", [ids.ticket],
    )).rows[0].status, "waiting");
  } finally {
    await db.close();
  }
});
