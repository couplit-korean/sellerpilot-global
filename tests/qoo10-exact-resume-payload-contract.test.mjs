import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appliedResumeUrl = new URL(
  "../supabase/migrations/20260831056500_resume_exact_qoo10_preprovider_job.sql",
  import.meta.url,
);
const payloadContractUrl = new URL(
  "../supabase/migrations/20260831056600_correct_exact_qoo10_resume_payload_contract.sql",
  import.meta.url,
);

test("56600 is a forward-only correction of the exact sparse Qoo10 payload contract", async () => {
  const [appliedResume, correction] = await Promise.all([
    readFile(appliedResumeUrl, "utf8"),
    readFile(payloadContractUrl, "utf8"),
  ]);

  assert.match(
    appliedResume,
    /request_payload#>>'\{arguments,params,ItemPrice\}'\s*=\s*'1871'/,
    "the applied 56500 history must retain its original, now-known-wrong equality",
  );
  assert.match(
    appliedResume,
    /request_payload#>>'\{arguments,params,ItemQty\}'\s*=\s*'1'/,
  );
  assert.match(
    correction,
    /not \(\(job\.request_payload#>'\{arguments,params\}'\) \? 'ItemPrice'\)/,
  );
  assert.match(
    correction,
    /not \(\(job\.request_payload#>'\{arguments,params\}'\) \? 'ItemQty'\)/,
  );
  assert.doesNotMatch(
    correction,
    /request_payload#>>'\{arguments,params,ItemPrice\}'\s*=\s*'1871'/,
  );
  assert.doesNotMatch(
    correction,
    /request_payload#>>'\{arguments,params,ItemQty\}'\s*=\s*'1'/,
  );
});

test("56600 keeps the exact lineage, recovery evidence, and pre/post function images bound", async () => {
  const sql = await readFile(payloadContractUrl, "utf8");

  for (const evidence of [
    "fac9c5c4-940d-4600-88f3-8f97a069dfbf",
    "4402cc76-295b-4e17-8c07-d5d0e9967ce9",
    "4e5b97be-3fe5-4537-9e26-d36fb36ec1fc",
    "ddccde35-9c58-4856-b673-d7aa27ce4220",
    "2b49d081-5188-4a75-9555-e0a6438e8a2b",
    "5fb751b6-0372-4ad3-b238-6670d58b42f9",
    "52c0a26c93a3c377b042b65554234fb559bdab3f",
    "76be7b79b89497d6841fb3fd921b5ffb57036ea3a93029fa8fa84f6440e85799",
    "c6baf120f58bdfd3cd10adcb85a1f6a5820b9a003ca5c3160959ecdb1fb7d26d",
    "ec01294fe79dd0b730ecde015dcb357c17cd35ea135a30f5342e00c81f17a89d",
    "283ea8340708a4666e6948fb205f371f7481d7cb976cca8ec99c8d1018c395d3",
  ]) {
    assert.match(sql, new RegExp(evidence));
  }
  assert.match(sql, /octet_length\(job\.request_payload::text\) = 23555/);
  assert.match(
    sql,
    /sellerpilotQoo10RollbackUpdateRecovery,expectedState,sellPriceJpy\}'\s*=\s*'1871'/,
  );
  assert.match(
    sql,
    /sellerpilotQoo10RollbackUpdateRecovery,expectedState,quantity\}'\s*=\s*'1'/,
  );
  assert.match(sql, /history\.version = '20260831056500'/);
  assert.match(sql, /history\.version = '20260831056600'/);
  assert.match(sql, /qoo10_exact_preprovider_resume_permits\) <> 0/);
  assert.match(sql, /provolatile = 's'::"char"/);
  assert.match(sql, /proconfig = array\['search_path=""'\]::text\[\]/);
  assert.match(
    sql,
    /revoke all on function[\s\S]*?qoo10_exact_preprovider_resume_lineage_is_current\(uuid,text\)[\s\S]*?from public, anon, authenticated, service_role/,
  );
});

test("56600 cannot arm, enqueue, open a gate, or begin a provider mutation", async () => {
  const sql = await readFile(payloadContractUrl, "utf8");

  assert.equal(
    (sql.match(/create or replace function/gi) ?? []).length,
    1,
    "the forward fix may replace only the private lineage predicate",
  );
  assert.match(
    sql,
    /create or replace function sellerpilot_private\.qoo10_exact_preprovider_resume_lineage_is_current/,
  );
  assert.doesNotMatch(sql, /create or replace function public\./i);
  assert.doesNotMatch(sql, /insert\s+into/i);
  assert.doesNotMatch(sql, /update\s+sellerpilot_private/i);
  assert.doesNotMatch(sql, /delete\s+from/i);
  assert.doesNotMatch(sql, /set\s+is_open\s*=\s*true/i);
  assert.doesNotMatch(sql, /sellerpilot_service_arm_exact_qoo10_preprovider_resume\s*\(/i);
  assert.doesNotMatch(sql, /begin_(?:serverless_)?gateway_provider_mutation\s*\(/i);
});
