import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === "server-only"
    ? { shortCircuit: true, url: "data:text/javascript,export default {}" }
    : nextResolve(specifier, context);
} });

const { executeCsProviderJob } = await import("../lib/cs/operations/provider.ts");
const { completeCsClaim } = await import("../lib/cs/operations/complete.ts");
const migration = await readFile(new URL(
  "../supabase/migrations/20260909132027_cs_ebay_asq_reply_readback_delivery.sql",
  import.meta.url,
), "utf8");

const ownerId = "10000000-0000-4000-8000-000000000001";
const credentialId = "10000000-0000-4000-8000-000000000002";
const ticketId = "10000000-0000-4000-8000-000000000003";
const jobId = "10000000-0000-4000-8000-000000000004";
const claimToken = "10000000-0000-4000-8000-000000000005";
const inboundMessageId = "10000000-0000-4000-8000-000000000006";
const inboundKey = "ebay:" + "a".repeat(64);
const sellerAccountKey = "c".repeat(64);
const reply = "Exact ASQ answer";
const replyFingerprint = createHash("sha256").update(reply).digest("hex");
const replyContext = {
  itemId: "1234567890123456789",
  marketplaceId: "EBAY_US",
  parentMessageId: "message-1",
  recipientId: "buyer-1",
};
const replyBindingDigest = createHash("sha256").update(JSON.stringify(replyContext)).digest("hex");

const request = {
  sellerpilotTicketId: ticketId,
  sellerpilotInboundKey: inboundKey,
  sellerpilotReplyFingerprint: replyFingerprint,
  arguments: { ...replyContext, reply },
};
const job = {
  id: jobId, claim_token: claimToken, credential_id: credentialId,
  channel: "ebay", operation: "inquiries.reply", environment: "production",
  request,
  credential: {
    access_token: "fixture-token",
    access_token_expires_at: "2099-01-01T00:00:00.000Z",
    marketplace_id: "EBAY_US",
    provider_account_identity_version: "v1",
    provider_account_subject: "ebay:eias:ABCDEFGHIJKLMNOP",
  },
  attempt_count: 1,
};

function memberMessagesXml(responses, status = "Unanswered", overrides = {}) {
  return "<GetMemberMessagesResponse><Ack>Success</Ack><MemberMessage><MemberMessageExchange>"
    + "<Item><ItemID>" + (overrides.itemId ?? "1234567890123456789") + "</ItemID></Item>"
    + "<Question><SenderID>" + (overrides.senderId ?? "buyer-1") + "</SenderID><MessageID>"
    + (overrides.messageId ?? "message-1") + "</MessageID></Question>"
    + responses.map((body) => "<Response>" + body + "</Response>").join("")
    + "<MessageStatus>" + status + "</MessageStatus></MemberMessageExchange></MemberMessage>"
    + "<PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages><TotalNumberOfEntries>1</TotalNumberOfEntries></PaginationResult>"
    + "<HasMoreItems>false</HasMoreItems></GetMemberMessagesResponse>";
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema extensions;
    create function extensions.digest(text,text) returns bytea language sql immutable
      as $$select sha256(convert_to($1,'UTF8'))$$;
    create schema sellerpilot_private;
    create table sellerpilot_private.channel_gateway_jobs(
      id uuid primary key,credential_id uuid,channel text,operation text,environment text,
      request_payload jsonb,response_payload jsonb,status text,claim_token uuid,
      seller_account_key text,created_by uuid,provider_mutation_started_at timestamptz,
      error_message text,created_at timestamptz default clock_timestamp(),
      started_at timestamptz default clock_timestamp(),completed_at timestamptz,
      updated_at timestamptz default clock_timestamp()
    );
    create table sellerpilot_private.support_tickets(
      id uuid primary key,owner_id uuid,channel_key text,source_credential_id uuid,
      seller_account_key text,
      demo boolean default false,external_ticket_id text,reply_context jsonb default '{}',
      latest_inbound_key text,status text default 'waiting',provider_status text default 'waiting',
      provider_status_updated_at timestamptz,reply_delivery_status text default 'sending',
      reply_delivery_error text,resolved_at timestamptz,last_delivery_job_id uuid,
      updated_at timestamptz default clock_timestamp()
    );
    create table sellerpilot_private.support_inbound_messages(
      id uuid primary key,ticket_id uuid,owner_id uuid,channel_key text,
      inbound_key text,remote_message_id text,sender_role text,body text,
      provider_context jsonb default '{}',received_at timestamptz default clock_timestamp()
    );
    create table sellerpilot_private.support_reply_deliveries(
      id uuid primary key default gen_random_uuid(),ticket_id uuid,owner_id uuid,
      gateway_job_id uuid unique,channel_key text,status text,reply_fingerprint text,
      provider_request_id text,provider_message_id text,safe_message text,
      reconciliation_reason text,acknowledged_at timestamptz,acknowledged_by uuid,
      acknowledgement_reason text,queued_at timestamptz,started_at timestamptz,
      completed_at timestamptz,verification_status text default 'unverified',
      verification_contract text,provider_accepted_at timestamptz,
      remote_observed_at timestamptz,observed_message_id uuid,
      created_at timestamptz default clock_timestamp(),updated_at timestamptz default clock_timestamp()
    );
    create function sellerpilot_private.track_reply_acceptance_verification()
    returns trigger language plpgsql security definer set search_path='' as $$
    begin
      if new.verification_status='remote_observed' then return new; end if;
      if new.status='succeeded' then
        new.verification_status:='provider_accepted';
        new.verification_contract:='sellerpilot-reply-acceptance/1';
        new.provider_accepted_at:=coalesce(new.provider_accepted_at,new.completed_at,clock_timestamp());
      elsif new.status='reconciliation_required' then new.verification_status:='reconciliation_required';
      elsif new.status in ('failed','cancelled') then new.verification_status:='failed';
      else new.verification_status:='unverified'; end if;
      return new;
    end $$;
    create trigger track_reply_acceptance_verification
      before insert or update of status on sellerpilot_private.support_reply_deliveries
      for each row execute function sellerpilot_private.track_reply_acceptance_verification();
    create function sellerpilot_private.sync_inquiry_reply_delivery_ledger()
    returns trigger language plpgsql security definer set search_path='' as $$
    declare v_ticket sellerpilot_private.support_tickets%rowtype;
    begin
      if new.operation<>'inquiries.reply' or new.status not in ('succeeded','reconciliation_required') then return new; end if;
      select * into v_ticket from sellerpilot_private.support_tickets
       where id=(new.request_payload->>'sellerpilotTicketId')::uuid for update;
      insert into sellerpilot_private.support_reply_deliveries(
        ticket_id,owner_id,gateway_job_id,channel_key,status,reply_fingerprint,
        provider_message_id,queued_at,started_at,completed_at,updated_at
      ) values(
        v_ticket.id,v_ticket.owner_id,new.id,new.channel,new.status,
        new.request_payload->>'sellerpilotReplyFingerprint',
        nullif(new.response_payload->>'remoteId',''),new.created_at,new.started_at,
        new.completed_at,clock_timestamp()
      ) on conflict(gateway_job_id) do update set
        status=excluded.status,completed_at=excluded.completed_at,updated_at=clock_timestamp();
      update sellerpilot_private.support_tickets set
        last_delivery_job_id=new.id,
        provider_status=case when new.status='succeeded' then 'answered' else provider_status end,
        provider_status_updated_at=case when new.status='succeeded' then clock_timestamp() else provider_status_updated_at end
      where id=v_ticket.id and latest_inbound_key=new.request_payload->>'sellerpilotInboundKey';
      return new;
    end $$;
    create trigger sync_inquiry_reply_delivery_ledger
      after insert or update of status,response_payload,error_message
      on sellerpilot_private.channel_gateway_jobs
      for each row execute function sellerpilot_private.sync_inquiry_reply_delivery_ledger();
  `);
  await db.query(`insert into sellerpilot_private.support_tickets(
    id,owner_id,channel_key,source_credential_id,seller_account_key,
    external_ticket_id,reply_context,latest_inbound_key
  ) values($1,$2,'ebay',$3,$4,'ebay:message-1',$5::jsonb,$6)`, [
    ticketId, ownerId, credentialId,
    sellerAccountKey, JSON.stringify(request.arguments), inboundKey,
  ]);
  await db.query(`insert into sellerpilot_private.support_inbound_messages(
    id,ticket_id,owner_id,channel_key,inbound_key,remote_message_id,sender_role,body,provider_context
  ) values($1,$2,$3,'ebay',$4,'message-1','customer','synthetic buyer question',$5::jsonb)`, [
    inboundMessageId, ticketId, ownerId, inboundKey, JSON.stringify(replyContext),
  ]);
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,channel,operation,environment,request_payload,status,
    claim_token,seller_account_key,created_by
  ) values($1,$2,'ebay','inquiries.reply','production',$3::jsonb,'running',$4,$5,$6)`, [
    jobId, credentialId, JSON.stringify(request), claimToken, sellerAccountKey, ownerId,
  ]);
  await db.exec(migration);
  return db;
}

function dependencies(db) {
  return {
    rpc: async (name, arguments_) => {
      if (name === "sellerpilot_service_serverless_cs_completion_context") {
        const row = (await db.query(
          "select status,channel,operation from sellerpilot_private.channel_gateway_jobs where id=$1",
          [arguments_.p_job_id],
        )).rows[0];
        return { data: {
          status: row.status === "running" ? "running" : "completed_replay",
          channel: row.channel, operation: row.operation,
        }, error: null };
      }
      if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
        try {
          await db.query(`update sellerpilot_private.channel_gateway_jobs set
            status=$2,response_payload=$3::jsonb,error_message=$4,
            completed_at=clock_timestamp(),updated_at=clock_timestamp()
            where id=$1 and claim_token=$5`, [
            arguments_.p_job_id, arguments_.p_status,
            arguments_.p_response_payload === null ? null : JSON.stringify(arguments_.p_response_payload),
            arguments_.p_error_message, arguments_.p_claim_token,
          ]);
          return { data: { status: "completed" }, error: null };
        } catch (error) {
          return { data: null, error: { code: error?.code ?? "db_error" } };
        }
      }
      throw new Error("unexpected RPC " + name);
    },
  };
}

async function executeProvider(db, fetchImplementation) {
  const originalFetch = globalThis.fetch;
  let addCalls = 0;
  globalThis.fetch = async (input, init) => {
    const requestValue = new Request(input, init);
    const call = requestValue.headers.get("x-ebay-api-call-name") ?? "";
    if (call === "AddMemberMessageRTQ") addCalls += 1;
    return fetchImplementation(call);
  };
  try {
    const result = await executeCsProviderJob({
      job, signal: new AbortController().signal,
      hooks: {
        beginCredentialMutation: async () => {}, stageCredentialRefresh: async () => {},
        beginProviderMutation: async () => {
          await db.query(
            "update sellerpilot_private.channel_gateway_jobs set provider_mutation_started_at=clock_timestamp() where id=$1",
            [jobId],
          );
        },
        assertLeaseHealthy: async () => {}, reserveProviderRequest: async () => {},
      },
    });
    return { result, addCalls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function exactProviderExecution(db) {
  let readCount = 0;
  return executeProvider(db, async (call) => {
    if (call === "GetMemberMessages") {
      const xml = readCount === 0 ? memberMessagesXml([]) : memberMessagesXml([reply], "Answered");
      readCount += 1;
      return new Response(xml, { status: 200 });
    }
    return new Response(
      "<AddMemberMessageRTQResponse><Ack>Success</Ack></AddMemberMessageRTQResponse>",
      { status: 200 },
    );
  });
}

function observedCompletionPayload() {
  return {
    ok: true,
    channel: "ebay",
    operation: "inquiries.reply",
    steps: [{
      name: "inquiry-reply",
      ok: true,
      status: 200,
      data: {
        sellerpilotReplyReadback: {
          contract: "sellerpilot-ebay-asq-reply-readback/1",
          level: "provider_observed",
          bindingDigest: replyBindingDigest,
          replyBodyDigest: replyFingerprint,
          baselineResponseCount: 0,
          observedResponseCount: 1,
          observedAt: new Date().toISOString(),
          providerAnswerId: null,
          providerAnswerOccurredAt: null,
        },
        sellerpilotReplyAcceptance: {
          contract: "sellerpilot-reply-acceptance/1",
          level: "provider_accepted",
          channel: "ebay",
          kind: "asq",
          bindingDigest: replyBindingDigest,
        },
      },
    }],
    remoteId: "message-1",
  };
}

async function directObservedCompletion(db, response = observedCompletionPayload()) {
  await db.query(
    "update sellerpilot_private.channel_gateway_jobs set provider_mutation_started_at=clock_timestamp() where id=$1",
    [jobId],
  );
  return db.query(`update sellerpilot_private.channel_gateway_jobs set
    status='succeeded',response_payload=$2::jsonb,completed_at=clock_timestamp()
    where id=$1`, [jobId, JSON.stringify(response)]);
}

test("actual provider completion atomically persists an eBay ASQ delivery observation", async () => {
  const db = await fixture();
  try {
    const executed = await exactProviderExecution(db);
    assert.equal(executed.addCalls, 1);
    assert.equal(executed.result.ok, true);
    assert.equal(await completeCsClaim(
      dependencies(db), "b".repeat(64), job,
      { status: "succeeded", result: executed.result },
    ), "completed");
    assert.deepEqual((await db.query(`select status,verification_status,verification_contract,
      provider_message_id,remote_observed_at is not null as observed
      from sellerpilot_private.support_reply_deliveries where gateway_job_id=$1`, [jobId])).rows[0], {
      status: "succeeded", verification_status: "remote_observed",
      verification_contract: "sellerpilot-ebay-asq-reply-readback/1",
      provider_message_id: null, observed: true,
    });
    assert.deepEqual((await db.query(
      "select status,provider_status,reply_delivery_status from sellerpilot_private.support_tickets where id=$1",
      [ticketId],
    )).rows[0], {
      status: "resolved", provider_status: "answered", reply_delivery_status: "succeeded",
    });
    assert.equal(await completeCsClaim(
      dependencies(db), "b".repeat(64), job,
      { status: "succeeded", result: executed.result },
    ), "completed");
    assert.equal((await db.query(
      "select count(*)::integer n from sellerpilot_private.support_reply_deliveries",
    )).rows[0].n, 1);
    assert.equal(executed.addCalls, 1);
  } finally {
    await db.close();
  }
});

test("a newer inbound keeps the ticket open while the accepted original reply is durably observed without resend", async () => {
  const db = await fixture();
  try {
    const executed = await exactProviderExecution(db);
    const newerInboundKey = "ebay:" + "f".repeat(64);
    const newerReplyContext = {
      itemId: replyContext.itemId,
      marketplaceId: replyContext.marketplaceId,
      parentMessageId: "message-2",
      recipientId: replyContext.recipientId,
    };
    await db.query(`insert into sellerpilot_private.support_inbound_messages(
      id,ticket_id,owner_id,channel_key,inbound_key,remote_message_id,sender_role,body,provider_context
    ) values('10000000-0000-4000-8000-000000000007',$1,$2,'ebay',$3,'message-2','customer',
      'new buyer question',$4::jsonb)`, [
      ticketId, ownerId, newerInboundKey, JSON.stringify(newerReplyContext),
    ]);
    await db.query(`update sellerpilot_private.support_tickets set
      latest_inbound_key=$2,reply_context=$3::jsonb,status='waiting',provider_status='waiting',
      reply_delivery_status='sending',resolved_at=null where id=$1`, [
      ticketId, newerInboundKey, JSON.stringify(newerReplyContext),
    ]);

    assert.equal(await completeCsClaim(
      dependencies(db), "b".repeat(64), job,
      { status: "succeeded", result: executed.result },
    ), "completed");
    assert.deepEqual((await db.query(`select status,verification_status,
      verification_contract,remote_observed_at is not null observed
      from sellerpilot_private.support_reply_deliveries where gateway_job_id=$1`, [jobId])).rows[0], {
      status: "succeeded",
      verification_status: "remote_observed",
      verification_contract: "sellerpilot-ebay-asq-reply-readback/1",
      observed: true,
    });
    assert.deepEqual((await db.query(`select latest_inbound_key,status,provider_status,
      reply_delivery_status,resolved_at,last_delivery_job_id
      from sellerpilot_private.support_tickets where id=$1`, [ticketId])).rows[0], {
      latest_inbound_key: newerInboundKey,
      status: "waiting",
      provider_status: "waiting",
      reply_delivery_status: "sending",
      resolved_at: null,
      last_delivery_job_id: null,
    });
    assert.equal(await completeCsClaim(
      dependencies(db), "b".repeat(64), job,
      { status: "succeeded", result: executed.result },
    ), "completed");
    assert.equal((await db.query(
      "select count(*)::integer n from sellerpilot_private.support_reply_deliveries where gateway_job_id=$1",
      [jobId],
    )).rows[0].n, 1);
    assert.equal(executed.addCalls, 1);
  } finally {
    await db.close();
  }
});

test("a mismatched eBay ASQ exchange is rejected before the provider mutation fence", async () => {
  const db = await fixture();
  const originalFetch = globalThis.fetch;
  let adds = 0;
  let mutationFences = 0;
  try {
    globalThis.fetch = async (input, init) => {
      const requestValue = new Request(input, init);
      const call = requestValue.headers.get("x-ebay-api-call-name") ?? "";
      if (call === "AddMemberMessageRTQ") adds += 1;
      return new Response(memberMessagesXml([], "Unanswered", {
        messageId: "other-message",
      }), { status: 200 });
    };
    await assert.rejects(executeCsProviderJob({
      job, signal: new AbortController().signal,
      hooks: {
        beginCredentialMutation: async () => {}, stageCredentialRefresh: async () => {},
        beginProviderMutation: async () => { mutationFences += 1; },
        assertLeaseHealthy: async () => {}, reserveProviderRequest: async () => {},
      },
    }), /EBAY_ASQ_REPLY_READBACK_TARGET_MISMATCH/);
    assert.equal(mutationFences, 0);
    assert.equal(adds, 0);
    assert.deepEqual((await db.query(
      "select status,provider_mutation_started_at from sellerpilot_private.channel_gateway_jobs where id=$1",
      [jobId],
    )).rows[0], { status: "running", provider_mutation_started_at: null });
  } finally {
    globalThis.fetch = originalFetch;
    await db.close();
  }
});

test("two new identical eBay ASQ responses stay ambiguous and never cause a reply retry", async () => {
  const db = await fixture();
  const originalFetch = globalThis.fetch;
  let reads = 0;
  let adds = 0;
  try {
    globalThis.fetch = async (input, init) => {
      const requestValue = new Request(input, init);
      const call = requestValue.headers.get("x-ebay-api-call-name") ?? "";
      if (call === "GetMemberMessages") {
        const responses = reads === 0 ? [reply] : [reply, reply, reply];
        reads += 1;
        return new Response(memberMessagesXml(responses, "Answered"), { status: 200 });
      }
      adds += 1;
      return new Response(
        "<AddMemberMessageRTQResponse><Ack>Success</Ack></AddMemberMessageRTQResponse>",
        { status: 200 },
      );
    };
    await assert.rejects(executeCsProviderJob({
      job, signal: new AbortController().signal,
      hooks: {
        beginCredentialMutation: async () => {}, stageCredentialRefresh: async () => {},
        beginProviderMutation: async () => {
          await db.query(
            "update sellerpilot_private.channel_gateway_jobs set provider_mutation_started_at=clock_timestamp() where id=$1",
            [jobId],
          );
        },
        assertLeaseHealthy: async () => {}, reserveProviderRequest: async () => {},
      },
    }), /EBAY_ASQ_REPLY_READBACK_NOT_OBSERVED/);
    assert.equal(adds, 1);
    assert.equal(await completeCsClaim(
      dependencies(db), "b".repeat(64), job,
      { status: "reconciliation_required", error: "EBAY_ASQ_REPLY_READBACK_NOT_OBSERVED" },
    ), "completed_reconciliation");
    assert.deepEqual((await db.query(
      "select status,verification_status from sellerpilot_private.support_reply_deliveries",
    )).rows[0], {
      status: "reconciliation_required",
      verification_status: "reconciliation_required",
    });
    assert.equal((await db.query(
      "select count(*)::integer n from sellerpilot_private.channel_gateway_jobs where operation='inquiries.reply'",
    )).rows[0].n, 1);
    assert.equal(adds, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await db.close();
  }
});

test("ACK followed by GET failure becomes reconciliation without another reply mutation", async () => {
  const db = await fixture();
  const originalFetch = globalThis.fetch;
  let reads = 0;
  let adds = 0;
  try {
    globalThis.fetch = async (input, init) => {
      const requestValue = new Request(input, init);
      const call = requestValue.headers.get("x-ebay-api-call-name") ?? "";
      if (call === "GetMemberMessages") {
        reads += 1;
        return reads === 1
          ? new Response(memberMessagesXml([]), { status: 200 })
          : new Response("<GetMemberMessagesResponse><Ack>Failure</Ack></GetMemberMessagesResponse>", { status: 503 });
      }
      adds += 1;
      return new Response(
        "<AddMemberMessageRTQResponse><Ack>Success</Ack></AddMemberMessageRTQResponse>",
        { status: 200 },
      );
    };
    await assert.rejects(executeCsProviderJob({
      job, signal: new AbortController().signal,
      hooks: {
        beginCredentialMutation: async () => {}, stageCredentialRefresh: async () => {},
        beginProviderMutation: async () => {
          await db.query(
            "update sellerpilot_private.channel_gateway_jobs set provider_mutation_started_at=clock_timestamp() where id=$1",
            [jobId],
          );
        },
        assertLeaseHealthy: async () => {}, reserveProviderRequest: async () => {},
      },
    }), /EBAY_ASQ_REPLY_READBACK_PROVIDER_ERROR/);
    assert.equal(adds, 1);
    assert.equal(await completeCsClaim(
      dependencies(db), "b".repeat(64), job,
      { status: "reconciliation_required", error: "EBAY_ASQ_REPLY_READBACK_PROVIDER_ERROR" },
    ), "completed_reconciliation");
    assert.deepEqual((await db.query(
      "select status from sellerpilot_private.channel_gateway_jobs where id=$1", [jobId],
    )).rows[0], { status: "reconciliation_required" });
    assert.equal((await db.query(
      "select count(*)::integer n from sellerpilot_private.channel_gateway_jobs where operation='inquiries.reply'",
    )).rows[0].n, 1);
    assert.equal(adds, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await db.close();
  }
});

test("DB rejection after observed GET rolls back completion and terminalizes without resending", async () => {
  const db = await fixture();
  try {
    const executed = await exactProviderExecution(db);
    const tampered = structuredClone(executed.result);
    tampered.steps[0].data.sellerpilotReplyReadback.bindingDigest = "0".repeat(64);
    assert.equal(await completeCsClaim(
      dependencies(db), "b".repeat(64), job,
      { status: "succeeded", result: tampered },
    ), "unavailable");
    assert.deepEqual((await db.query(
      "select status,provider_mutation_started_at is not null as mutation_started from sellerpilot_private.channel_gateway_jobs where id=$1",
      [jobId],
    )).rows[0], { status: "running", mutation_started: true });
    assert.equal((await db.query(
      "select count(*)::integer n from sellerpilot_private.support_reply_deliveries",
    )).rows[0].n, 0);
    assert.equal(await completeCsClaim(
      dependencies(db), "b".repeat(64), job,
      { status: "reconciliation_required", error: "EBAY_ASQ_REPLY_OBSERVATION_BINDING_INVALID" },
    ), "completed_reconciliation");
    assert.equal((await db.query(
      "select count(*)::integer n from sellerpilot_private.channel_gateway_jobs where operation='inquiries.reply'",
    )).rows[0].n, 1);
    assert.deepEqual((await db.query(
      "select verification_status from sellerpilot_private.support_reply_deliveries",
    )).rows[0], { verification_status: "reconciliation_required" });
    assert.equal(executed.addCalls, 1);
  } finally {
    await db.close();
  }
});

test("required eBay ASQ observation scalars reject absent, null and wrong JSON types", async () => {
  const cases = [];
  for (const field of ["baselineResponseCount", "observedResponseCount", "observedAt"]) {
    cases.push([`${field}:absent`, (marker) => { delete marker[field]; }]);
    cases.push([`${field}:null`, (marker) => { marker[field] = null; }]);
  }
  cases.push(
    ["baselineResponseCount:string", (marker) => { marker.baselineResponseCount = "0"; }],
    ["observedResponseCount:object", (marker) => { marker.observedResponseCount = {}; }],
    ["observedAt:number", (marker) => { marker.observedAt = Date.now(); }],
  );
  for (const [label, mutate] of cases) {
    const db = await fixture();
    try {
      const response = observedCompletionPayload();
      mutate(response.steps[0].data.sellerpilotReplyReadback);
      await assert.rejects(directObservedCompletion(db, response), /EBAY_ASQ_REPLY_OBSERVATION_INVALID/, label);
      assert.deepEqual((await db.query(
        "select status,response_payload from sellerpilot_private.channel_gateway_jobs where id=$1",
        [jobId],
      )).rows[0], { status: "running", response_payload: null }, label);
      assert.equal((await db.query(
        "select count(*)::integer n from sellerpilot_private.support_reply_deliveries",
      )).rows[0].n, 0, label);
    } finally {
      await db.close();
    }
  }
});

test("non-finite, fractional and overflow eBay ASQ observation values fail closed", async () => {
  const cases = [
    ["observedAt:infinity", (marker) => { marker.observedAt = "infinity"; }],
    ["baselineResponseCount:fractional", (marker) => { marker.baselineResponseCount = 0.5; }],
    ["observedResponseCount:fractional", (marker) => { marker.observedResponseCount = 1.5; }],
    ["baselineResponseCount:integer-overflow", (marker) => { marker.baselineResponseCount = 2147483648; }],
    ["observedResponseCount:integer-overflow", (marker) => { marker.observedResponseCount = 2147483648; }],
    ["response-count:provider-bound-overflow", (marker) => {
      marker.baselineResponseCount = 100;
      marker.observedResponseCount = 101;
    }],
  ];
  for (const [label, mutate] of cases) {
    const db = await fixture();
    try {
      const response = observedCompletionPayload();
      mutate(response.steps[0].data.sellerpilotReplyReadback);
      await assert.rejects(directObservedCompletion(db, response), /EBAY_ASQ_REPLY_OBSERVATION_INVALID/, label);
      assert.deepEqual((await db.query(
        "select status,response_payload from sellerpilot_private.channel_gateway_jobs where id=$1",
        [jobId],
      )).rows[0], { status: "running", response_payload: null }, label);
    } finally {
      await db.close();
    }
  }
});

test("eBay ASQ observation binds delivery, owner, credential, seller and immutable inbound context", async () => {
  const otherOwner = "10000000-0000-4000-8000-000000000099";
  const otherCredential = "10000000-0000-4000-8000-000000000098";
  const cases = [
    ["owner", async (db) => db.query(
      "update sellerpilot_private.channel_gateway_jobs set created_by=$2 where id=$1", [jobId, otherOwner],
    ), /EBAY_ASQ_REPLY_OBSERVATION_IDENTITY_INVALID/],
    ["credential", async (db) => db.query(
      "update sellerpilot_private.channel_gateway_jobs set credential_id=$2 where id=$1", [jobId, otherCredential],
    ), /EBAY_ASQ_REPLY_OBSERVATION_IDENTITY_INVALID/],
    ["seller", async (db) => db.query(
      "update sellerpilot_private.channel_gateway_jobs set seller_account_key=$2 where id=$1", [jobId, "d".repeat(64)],
    ), /EBAY_ASQ_REPLY_OBSERVATION_IDENTITY_INVALID/],
    ["inbound-generation", async (db) => db.query(
      "update sellerpilot_private.channel_gateway_jobs set request_payload=jsonb_set(request_payload,'{sellerpilotInboundKey}',to_jsonb($2::text)) where id=$1",
      [jobId, "ebay:" + "e".repeat(64)],
    ), /EBAY_ASQ_REPLY_OBSERVATION_IDENTITY_INVALID/],
    ["inbound-context", async (db) => db.query(
      "update sellerpilot_private.support_inbound_messages set provider_context=jsonb_set(provider_context,'{recipientId}',to_jsonb('other-buyer'::text)) where id=$1",
      [inboundMessageId],
    ), /EBAY_ASQ_REPLY_OBSERVATION_IDENTITY_INVALID/],
    ["delivery-owner", async (db) => db.query(`insert into sellerpilot_private.support_reply_deliveries(
      ticket_id,owner_id,gateway_job_id,channel_key,status,reply_fingerprint
    ) values($1,$2,$3,'ebay','queued',$4)`, [ticketId, otherOwner, jobId, replyFingerprint]),
    /EBAY_ASQ_REPLY_OBSERVATION_DELIVERY_MISSING/],
  ];
  for (const [label, mutate, expectedError] of cases) {
    const db = await fixture();
    try {
      await mutate(db);
      await assert.rejects(directObservedCompletion(db), expectedError, label);
      assert.equal((await db.query(
        "select status from sellerpilot_private.channel_gateway_jobs where id=$1", [jobId],
      )).rows[0].status, "running", label);
      assert.equal((await db.query(
        "select count(*)::integer n from sellerpilot_private.gateway_completion_receipts",
      ).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n, 0, label);
    } finally {
      await db.close();
    }
  }
});
