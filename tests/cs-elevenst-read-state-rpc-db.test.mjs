import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { projectElevenstReadStateRpc } from "../lib/cs/channels/elevenst/web-rpc.ts";

const integratedMigration = new URL(
  "../supabase/migrations/20260908140411_cs_elevenst_read_state_alimi_ledger.sql",
  import.meta.url,
);
const migration = existsSync(integratedMigration)
  ? integratedMigration
  : new URL(
    "../supabase/migrations/20260908140411_cs_elevenst_read_state_alimi_ledger.sql",
    import.meta.url,
  );
const owner = "11111111-1111-4111-8111-111111111111";
const admin = "22222222-2222-4222-8222-222222222222";
const credential = "33333333-3333-4333-8333-333333333333";
const wrongCredential = "44444444-4444-4444-8444-444444444444";
const sellerAccountKey = "a".repeat(64);
const wrongSellerAccountKey = "b".repeat(64);

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

function alimiRow({
  emerNtceSeq,
  emerCtntSeq = "1",
  kind = "urgent_inquiry",
  status = "02",
  body = "출고 일정을 확인해 주세요.",
  replies = [],
  orderNo = "202609080001",
} = {}) {
  const externalTicketId = `elevenst:alimi:${emerNtceSeq}`;
  const remoteMessageId = `alimi:${emerNtceSeq}:${emerCtntSeq}:inbound`;
  const resolved = ["03", "05", "06"].includes(status);
  const system = kind === "urgent_notice";
  return {
    externalTicketId,
    customerName: system ? "11번가 시스템" : "11번가 고객",
    subject: system ? "정산 안내" : "배송 확인 요청",
    message: body,
    status: resolved ? "resolved" : "waiting",
    priority: 1,
    receivedAt: "2026-09-08T03:30:30.000Z",
    remoteMessageId,
    senderRole: system ? "system" : "customer",
    ...(orderNo ? { externalOrderReference: orderNo } : {}),
    providerContext: {
      kind,
      emerNtceSeq,
      emerCtntSeq,
      type: system ? "notice" : "reply_request",
      status,
      replyDueDate: "20260909",
      orderNo: orderNo || null,
      orderProductSequence: orderNo ? "1" : null,
      replySupported: false,
      sourceDigest: sha(JSON.stringify({ emerNtceSeq, emerCtntSeq, kind, status, body, replies })),
      unsequencedReplies: replies.map((replyBody) => ({
        body: replyBody,
        reason: "provider_timestamp_unavailable",
      })),
    },
    replyContext: {},
    inboundKey: `elevenst:${sha(["v2", "elevenst", externalTicketId, remoteMessageId].join("\u001f"))}`,
    providerStatus: resolved ? "answered" : "waiting",
    ticketKind: "conversation",
  };
}

function observation({
  surface,
  checkedAt,
  accepted,
  resultCode,
  providerRows,
  evidenceSha256,
  statusFilter = null,
  parseIncomplete = false,
}) {
  return {
    surface,
    sellerId: "couplit",
    sellerName: "커플릿",
    scopeStart: surface === "product_qna" ? "20260902" : "20260810",
    scopeEnd: "20260908",
    statusFilter,
    checkedAt,
    httpStatus: 200,
    accepted,
    resultCode,
    providerRows,
    parserMarker: surface === "urgent_alimi" ? "sellerpilot-elevenst-alimi-parser/1" : null,
    parseIncomplete,
    evidenceSha256,
  };
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema auth;
    create schema extensions;
    create schema sellerpilot_private;
    create function auth.uid() returns uuid language sql stable set search_path=''
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.sellerpilot_is_admin() returns boolean language sql stable security definer set search_path=''
      as $$select auth.uid()='${admin}'::uuid$$;
    create function extensions.digest(value text,algorithm text) returns bytea language sql immutable set search_path=''
      as $$select sha256(convert_to(value,'UTF8'))$$;
    create table sellerpilot_private.channel_credentials(
      id uuid primary key,channel text,environment text,created_by uuid,status text,
      seller_account_key text,seller_account_key_source text,seller_account_verified_at timestamptz,
      expires_at timestamptz,version integer default 1,created_at timestamptz default now()
    );
    create table sellerpilot_private.support_tickets(
      id uuid primary key default gen_random_uuid(),owner_id uuid,external_ticket_id text,channel_key text,
      customer_name text,subject text,message text,status text,priority integer,received_at timestamptz,
      resolved_at timestamptz,demo boolean default false,updated_at timestamptz default now(),
      source_credential_id uuid,channel_account_id uuid,seller_account_key text,
      reply_context jsonb default '{}'::jsonb,
      provider_status text default 'unknown',provider_status_updated_at timestamptz,
      latest_inbound_key text,provider_context jsonb default '{}'::jsonb,
      external_order_reference text,ticket_kind text default 'conversation',
      unique(owner_id,channel_key,external_ticket_id)
    );
    create table sellerpilot_private.support_inbound_messages(
      id uuid primary key default gen_random_uuid(),ticket_id uuid,owner_id uuid,channel_key text,
      inbound_key text,remote_message_id text,sender_role text,body text,provider_context jsonb,
      received_at timestamptz,updated_at timestamptz default now(),
      unique(owner_id,channel_key,inbound_key)
    );
    create function public.sellerpilot_service_ingest_inquiries(
      p_credential_id uuid,p_channel text,p_inquiries jsonb
    ) returns integer language plpgsql security definer set search_path='' as $$
    begin
      if false then raise exception 'ELEVENST_PRODUCT_QNA_CONTEXT_INVALID'; end if;
      return jsonb_array_length(p_inquiries);
    end$$;
    revoke all on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
      from public,anon,authenticated,service_role;
    grant execute on function public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)
      to service_role;
    insert into sellerpilot_private.channel_credentials(
      id,channel,environment,created_by,status,seller_account_key,
      seller_account_key_source,seller_account_verified_at,expires_at,version,created_at
    ) values
      ('${credential}','elevenst','production','${owner}','active','${sellerAccountKey}',
       'credential_incarnation_v1',now(),now()+interval '30 days',2,now()-interval '1 minute'),
      ('${wrongCredential}','elevenst','production','${owner}','grace','${wrongSellerAccountKey}',
       'provider_certified_v1',now(),now()+interval '30 days',1,now()-interval '2 minutes');
  `);
  await db.exec(await readFile(migration, "utf8"));
  return db;
}

async function asRole(db, role, callback) {
  await db.exec(`set role ${role}`);
  try {
    return await callback();
  } finally {
    await db.exec("reset role");
  }
}

async function recordRead(db, credentialId, read, rows = []) {
  return asRole(db, "service_role", async () => {
    if (read.surface === "urgent_alimi" && read.accepted) {
      await db.query(
        "select public.sellerpilot_service_ingest_inquiries($1,'elevenst',$2::jsonb)",
        [credentialId, JSON.stringify(rows)],
      );
    }
    return (await db.query(
      "select public.sellerpilot_service_record_elevenst_cs_read_v1($1,$2::jsonb,$3::jsonb) result",
      [credentialId, JSON.stringify(read), JSON.stringify(rows)],
    )).rows[0].result;
  });
}

test("004 SQL stores exact Alimi states, reopens status 04, separates notices and deduplicates", async () => {
  const db = await fixture();
  try {
    await db.exec(`insert into sellerpilot_private.support_tickets(
      owner_id,external_ticket_id,channel_key,customer_name,subject,message,status,priority,
      received_at,source_credential_id,seller_account_key,provider_status,provider_context,ticket_kind
    ) values('${owner}','elevenst:81234567','elevenst','11번가 고객','Q&A','질문','waiting',3,
      '2026-09-08T01:00:00Z','${credential}','${sellerAccountKey}','waiting',
      '{"kind":"product_qna"}'::jsonb,'conversation')`);
    await recordRead(db, credential, observation({
      surface: "product_qna", checkedAt: "2026-09-08T07:00:00.000Z",
      accepted: false, resultCode: "500", providerRows: 0,
      statusFilter: "00", evidenceSha256: sha("qna-business-error"),
    }));

    const replied = alimiRow({
      emerNtceSeq: "5590778", status: "03", replies: ["과거 답변"],
    });
    const notice = alimiRow({
      emerNtceSeq: "5590779", kind: "urgent_notice", status: "01",
      body: "정산 일정이 변경되었습니다.", orderNo: "",
    });
    const first = await recordRead(db, credential, observation({
      surface: "urgent_alimi", checkedAt: "2026-09-08T07:01:00.000Z",
      accepted: true, resultCode: "0", providerRows: 2,
      evidenceSha256: sha("alimi-first"),
    }), [replied, notice]);
    assert.equal(first.accepted, true);
    assert.equal(first.storedRows, 2);

    const requestedAgain = alimiRow({
      emerNtceSeq: "5590778", status: "04", replies: ["과거 답변"],
    });
    const secondObservation = observation({
      surface: "urgent_alimi", checkedAt: "2026-09-08T07:02:00.000Z",
      accepted: true, resultCode: "0", providerRows: 1,
      evidenceSha256: sha("alimi-rerequest"),
    });
    const second = await recordRead(db, credential, secondObservation, [requestedAgain]);
    const duplicate = await recordRead(db, credential, {
      ...secondObservation, checkedAt: "2026-09-08T07:03:00.000Z",
    }, [requestedAgain]);
    assert.equal(second.duplicateObservation, false);
    assert.equal(duplicate.duplicateObservation, true);
    assert.equal(duplicate.observationId, second.observationId);

    const tickets = (await db.query(`select external_ticket_id,status,provider_status,
      provider_context->>'kind' kind,provider_context->>'status' provider_current_status,
      provider_context->>'replySupported' reply_supported
      from sellerpilot_private.support_tickets
      where provider_context->>'kind' in('urgent_inquiry','urgent_notice')
      order by external_ticket_id`)).rows;
    assert.deepEqual(tickets, [
      {
        external_ticket_id: "elevenst:alimi:5590778", status: "waiting",
        provider_status: "waiting", kind: "urgent_inquiry",
        provider_current_status: "04", reply_supported: "false",
      },
      {
        external_ticket_id: "elevenst:alimi:5590779", status: "waiting",
        provider_status: "waiting", kind: "urgent_notice",
        provider_current_status: "01", reply_supported: "false",
      },
    ]);
    const messages = (await db.query(`select sender_role,provider_context->>'kind' kind
      from sellerpilot_private.support_inbound_messages order by sender_role`)).rows;
    assert.deepEqual(messages, [
      { sender_role: "customer", kind: "urgent_inquiry" },
      { sender_role: "system", kind: "urgent_notice" },
    ]);
    assert.equal((await db.query(
      "select count(*)::int n from sellerpilot_private.elevenst_alimi_state_events where emer_ntce_seq='5590778'",
    )).rows[0].n, 2);
    assert.equal((await db.query(
      "select count(*)::int n from sellerpilot_private.elevenst_cs_read_observations where surface='urgent_alimi'",
    )).rows[0].n, 2);
  } finally {
    await db.close();
  }
});

test("004 SQL enforces service/admin ACLs, active seller lineage and safe read projection", async () => {
  const db = await fixture();
  try {
    const requestedAgain = alimiRow({ emerNtceSeq: "5590778", status: "04", replies: ["과거 답변"] });
    await recordRead(db, credential, observation({
      surface: "product_qna", checkedAt: "2026-09-08T07:00:00.000Z",
      accepted: false, resultCode: "500", providerRows: 0,
      statusFilter: "00", evidenceSha256: sha("qna-business-error"),
    }));
    await recordRead(db, credential, observation({
      surface: "urgent_alimi", checkedAt: "2026-09-08T07:02:00.000Z",
      accepted: true, resultCode: "0", providerRows: 1,
      evidenceSha256: sha("alimi-one"),
    }), [requestedAgain]);

    for (const role of ["anon", "authenticated"]) {
      assert.equal((await db.query(
        "select has_function_privilege($1,'public.sellerpilot_service_record_elevenst_cs_read_v1(uuid,jsonb,jsonb)','EXECUTE') ok",
        [role],
      )).rows[0].ok, false);
    }
    assert.equal((await db.query(
      "select has_function_privilege('service_role','public.sellerpilot_service_record_elevenst_cs_read_v1(uuid,jsonb,jsonb)','EXECUTE') ok",
    )).rows[0].ok, true);
    assert.equal((await db.query(
      "select has_function_privilege('authenticated','public.sellerpilot_read_elevenst_cs_read_state_v1(text)','EXECUTE') ok",
    )).rows[0].ok, true);
    assert.equal((await db.query(
      "select has_function_privilege('service_role','public.sellerpilot_read_elevenst_cs_read_state_v1(text)','EXECUTE') ok",
    )).rows[0].ok, false);
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal((await db.query(
        "select has_table_privilege($1,'sellerpilot_private.elevenst_cs_read_observations','SELECT') ok",
        [role],
      )).rows[0].ok, false);
    }
    const sharedLedgerCounts = (await db.query(`select
      count(*) filter(where provider_context->>'kind'='product_qna')::int product_qna,
      count(*) filter(where provider_context->>'kind' in('urgent_inquiry','urgent_notice'))::int urgent_alimi
      from sellerpilot_private.support_tickets
      where owner_id=$1 and channel_key='elevenst' and seller_account_key=$2 and not demo`,
    [owner, sellerAccountKey])).rows[0];

    await asRole(db, "authenticated", async () => {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
      await assert.rejects(
        db.query(
          "select public.sellerpilot_service_record_elevenst_cs_read_v1($1,$2::jsonb,'[]'::jsonb)",
          [credential, JSON.stringify(observation({
            surface: "product_qna", checkedAt: "2026-09-08T07:00:01.000Z",
            accepted: false, resultCode: "500", providerRows: 0,
            statusFilter: "00", evidenceSha256: sha("unauthorized-writer"),
          }))],
        ),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select * from sellerpilot_private.elevenst_cs_read_observations"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select public.sellerpilot_read_elevenst_cs_read_state_v1('couplit')"),
        /administrator required/,
      );
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
      await assert.rejects(
        db.query("select public.sellerpilot_read_elevenst_cs_read_state_v1('wrong-seller')"),
        /ELEVENST_SELLER_SCOPE_INVALID/,
      );
      const raw = (await db.query(
        "select public.sellerpilot_read_elevenst_cs_read_state_v1('couplit') result",
      )).rows[0].result;
      assert.equal(JSON.stringify(raw).includes("과거 답변"), false);
      assert.equal(JSON.stringify(raw).includes(sellerAccountKey), false);
      const projection = projectElevenstReadStateRpc(raw);
      assert.equal(projection.productQna.providerState, "business_error");
      assert.equal(projection.productQna.remoteCount, null);
      assert.equal(projection.productQna.emptyConfirmed, false);
      assert.equal(projection.urgentAlimi.providerState, "ready");
      assert.equal(projection.urgentAlimi.remoteCount, 1);
      assert.equal(projection.urgentAlimi.storedCount, 1);
      assert.equal(projection.urgentAlimi.replyEnabled, false);
      assert.equal(projection.productQna.storedCount, sharedLedgerCounts.product_qna);
      assert.equal(projection.urgentAlimi.storedCount, sharedLedgerCounts.urgent_alimi);
    });

    await db.exec(`update sellerpilot_private.channel_credentials
      set status='active' where id='${wrongCredential}'`);
    await assert.rejects(recordRead(db, wrongCredential, observation({
      surface: "urgent_alimi", checkedAt: "2026-09-08T07:04:00.000Z",
      accepted: true, resultCode: "0", providerRows: 1,
      evidenceSha256: sha("wrong-account"),
    }), [requestedAgain]), /ELEVENST_ALIMI_ACCOUNT_BOUNDARY_MISMATCH/);

    const injected = structuredClone(requestedAgain);
    injected.providerContext.memId = "must-not-persist";
    await assert.rejects(recordRead(db, credential, observation({
      surface: "urgent_alimi", checkedAt: "2026-09-08T07:05:00.000Z",
      accepted: true, resultCode: "0", providerRows: 1,
      evidenceSha256: sha("member-id-injection"),
    }), [injected]), /ELEVENST_ALIMI_CONTEXT_INVALID/);
  } finally {
    await db.close();
  }
});

test("004 SQL records the 5001-row parser boundary as incomplete without ingesting rows", async () => {
  const db = await fixture();
  try {
    const result = await recordRead(db, credential, observation({
      surface: "urgent_alimi", checkedAt: "2026-09-08T07:06:00.000Z",
      accepted: false, resultCode: "0", providerRows: 5001,
      evidenceSha256: sha("alimi-5001"), parseIncomplete: true,
    }), []);
    assert.equal(result.accepted, false);
    assert.equal(result.providerRows, 5001);
    assert.equal(result.storedRows, 0);
    assert.equal((await db.query(
      "select count(*)::int n from sellerpilot_private.support_tickets",
    )).rows[0].n, 0);
    const row = (await db.query(`select accepted,provider_rows,parse_incomplete
      from sellerpilot_private.elevenst_cs_read_observations`)).rows[0];
    assert.deepEqual(row, { accepted: false, provider_rows: 5001, parse_incomplete: true });
  } finally {
    await db.close();
  }
});
