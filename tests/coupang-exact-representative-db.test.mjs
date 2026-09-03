import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260901173990_bind_coupang_exact_representative.sql",
  import.meta.url,
);
const fullReplayUrl = new URL("./supabase-migrations.test.mjs", import.meta.url);

function occurrenceCount(source, value) {
  return source.split(value).length - 1;
}

test("Coupang representative migration exposes only exact service RPCs and durable fences", async () => {
  const source = await readFile(migrationUrl, "utf8");
  const compact = source.replace(/\s+/gu, " ");
  for (const name of [
    "sellerpilot_service_arm_coupang_exact_rep",
    "sellerpilot_service_bind_coupang_rep_prewrite",
  ]) {
    assert.ok(Buffer.byteLength(name, "utf8") <= 63, name);
  }
  for (const signature of [
    "public.sellerpilot_service_arm_coupang_exact_rep( text,uuid,uuid,text,text,text,text,text,text )",
    "public.sellerpilot_service_bind_coupang_rep_prewrite( text,uuid,uuid,jsonb )",
    "public.sellerpilot_service_enqueue_listing_gateway_job( uuid,uuid,uuid,text,text,jsonb )",
    "public.sellerpilot_service_complete_gateway_transaction( text,uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,jsonb )",
  ]) {
    assert.ok(
      compact.includes(`revoke all on function ${signature} from public, anon, authenticated, service_role;`),
      signature,
    );
  }
  assert.match(source, /grant execute on function public\.sellerpilot_service_arm_coupang_exact_rep[\s\S]*to service_role;/u);
  assert.match(source, /grant execute on function public\.sellerpilot_service_bind_coupang_rep_prewrite[\s\S]*to service_role;/u);
  assert.equal(source.includes("if false and"), false);
  assert.ok(occurrenceCount(source, "coupang_exact_rep_response_valid(") >= 5);
  for (const exactFence of [
    "7ffc6e46-3173-4695-9889-5fa1529765f1",
    "16356981734",
    "95962393877",
    "QA-20260823-CC-001",
    "coupang_exact_rep_prewrites",
    "providerPrewriteSnapshotSha256",
    "providerReadbackSnapshotSha256",
    "providerVendorBasenamesVerified",
    "providerDetailImagesPreserved",
    "coupang_exact_rep_listing_update_allowed",
    "sellerpilot.coupang_exact_rep_apply",
    "gateway_completion_receipts",
  ]) {
    assert.ok(source.includes(exactFence), exactFence);
  }
});

test("the full replay owns the real Coupang one-shot lifecycle and negative proofs", async () => {
  const source = await readFile(fullReplayUrl, "utf8");
  const lifecycle = [
    "sellerpilot_service_arm_coupang_exact_rep",
    "sellerpilot_claim_channel_operation",
    "sellerpilot_service_enqueue_listing_gateway_job",
    "sellerpilot_claim_serverless_gateway_job",
    "sellerpilot_service_bind_coupang_rep_prewrite",
    "sellerpilot_service_begin_serverless_gateway_provider_mutation",
    "tampered Coupang ${label} completion succeeded",
    "gateway_completion_receipts where job_id=$1",
  ];
  let previous = -1;
  for (const marker of lifecycle) {
    const index = source.indexOf(marker, previous + 1);
    assert.ok(index > previous, marker);
    previous = index;
  }
  assert.match(source, /a consumed permit must not begin a second provider mutation/u);
  assert.match(source, /different active permit|conflict/u);
  assert.match(source, /providerRepresentativeChanged/u);
  assert.match(source, /providerDetailImagesPreserved/u);
});
