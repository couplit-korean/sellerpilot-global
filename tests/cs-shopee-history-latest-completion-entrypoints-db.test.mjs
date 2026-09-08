import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

const frozenUrl = new URL("./cs-shopee-history-canonical-completion-route-db.test.mjs", import.meta.url);
const frozenBytes = readFileSync(frozenUrl);
assert.equal(createHash("sha256").update(frozenBytes).digest("hex"),
  "9853790ab04c09e0a629a35a5e2fe61d7369c6fd135df45ab8e85aab91fd91e4");

const directEntryPointProof = `
    const directResponse = JSON.stringify({ ok: true, channel: "shopee", operation: "inquiries.list",
      steps: [{ name: "inquiries-normalized", ok: true, status: 200,
        data: { sellerpilotMarker: "normalized_inquiries_v1", normalizedInquiryCount: 0, providerStepCount: 1 } }],
      safeMessage: "synthetic direct completion proof" });
    const directJobs = [
      { id: uuid(13901), claim: uuid(13911), entry: "gateway" },
      { id: uuid(13902), claim: uuid(13912), entry: "serverless" },
    ];
    for (const item of directJobs) {
      await db.query(\`insert into sellerpilot_private.channel_gateway_jobs(
        id,credential_id,channel,operation,environment,request_payload,status,created_by,
        claim_token,worker_token_id,lease_expires_at,started_at
      ) values($1,$2,'shopee','inquiries.list','production','{}','running',$3,$4,$5,
        clock_timestamp()+interval '5 minutes',clock_timestamp())\`,
      [item.id, credential, owner, item.claim, worker]);
      const functionName = item.entry === "gateway"
        ? "sellerpilot_service_complete_gateway_transaction"
        : "sellerpilot_service_complete_serverless_cs_transaction";
      const result = (await db.query(\`select public.\${functionName}(
        $1,$2,$3,'succeeded',$4::jsonb,null,null,null,$5::jsonb,null
      ) result\`, [tokenHash, item.id, item.claim, directResponse, "[]"])).rows[0].result;
      assert.equal(result.status, "completed");
      assert.equal((await db.query(\`select status from sellerpilot_private.channel_gateway_jobs where id=$1\`,
        [item.id])).rows[0].status, "succeeded");
      assert.equal((await db.query(\`select count(*)::int n from sellerpilot_private.gateway_completion_receipts
        where job_id=$1 and claim_token=$2\`, [item.id, item.claim])).rows[0].n, 1);
    }
    await db.query("delete from sellerpilot_private.gateway_completion_receipts where job_id=any($1::uuid[])",
      [directJobs.map((item) => item.id)]);
    await db.query("delete from sellerpilot_private.channel_gateway_jobs where id=any($1::uuid[])",
      [directJobs.map((item) => item.id)]);
    await db.query("delete from sellerpilot_private.isolated_ingest_log");
`;

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  assert.ok(first >= 0, `missing frozen transform anchor: ${label}`);
  assert.equal(source.indexOf(needle, first + needle.length), -1, `ambiguous frozen transform anchor: ${label}`);
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url !== frozenUrl.href) return loaded;
    let source = Buffer.isBuffer(loaded.source) ? loaded.source.toString("utf8") : String(loaded.source);
    source = replaceOnce(source,
      "  coupangLive: await migration(\"20260907191500_reconcile_exact_coupang_live_create_get_only.sql\"),",
      "  coupangLive: await migration(\"20260907191500_reconcile_exact_coupang_live_create_get_only.sql\"),\n"
        + "  qoo10LatestCompletion: await migration(\"20260908153341_cs_qoo10_reply_s3_actual_completion.sql\"),",
      "latest migration source");
    source = replaceOnce(source,
      "  await run(\"install Coupang live wrapper\", functionStatement(sources.coupangLive, \"public.sellerpilot_service_complete_gateway_transaction\"));",
      "  await run(\"install Coupang live wrapper\", functionStatement(sources.coupangLive, \"public.sellerpilot_service_complete_gateway_transaction\"));\n"
        + "  await run(\"rename latest Qoo10 S3 predecessor\", `alter function public.sellerpilot_service_complete_gateway_transaction(${completionSignature}) rename to sellerpilot_145336_complete_before_qoo10_reply_s3`);\n"
        + "  await run(\"install latest Qoo10 S3 completion wrapper\", functionStatement(sources.qoo10LatestCompletion, \"public.sellerpilot_service_complete_gateway_transaction\"));\n"
        + "  await run(\"recreate latest serverless completion entrypoint\", functionStatement(sources.qoo10LatestCompletion, \"public.sellerpilot_service_complete_serverless_cs_transaction\"));",
      "latest completion installation");
    source = replaceOnce(source,
      "      to_regprocedure('public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)')",
      "      to_regprocedure('public.sellerpilot_145336_complete_before_qoo10_reply_s3(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)'),\n"
        + "      to_regprocedure('public.sellerpilot_service_complete_gateway_transaction(text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb)')",
      "latest predecessor assertion");
    source = replaceOnce(source, ")).rows[0].n, 8);", ")).rows[0].n, 9);",
      "completion wrapper count");
    source = replaceOnce(source, "    const runId = started.historyRunId;",
      `    const runId = started.historyRunId;${directEntryPointProof}`,
      "direct completion entrypoint proof");
    source = replaceOnce(source,
      "canonical common completion chain feeds owner GET with per-country partial, authorization and resume truth",
      "latest canonical completion entrypoints feed owner GET with per-country partial, authorization and resume truth",
      "test title");
    return { ...loaded, format: "module", source };
  },
});

await import(frozenUrl.href);
