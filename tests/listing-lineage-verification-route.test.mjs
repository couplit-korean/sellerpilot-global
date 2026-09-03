import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeUrl = new URL(
  "../app/api/admin/listings/lineage/verify/route.ts",
  import.meta.url,
);

test("listing lineage verification is an authenticated service-RPC-only route", async () => {
  const source = await readFile(routeUrl, "utf8");

  const auth = source.indexOf("authenticateAdminRequest(request");
  const bodyParse = source.indexOf("requestSchema.safeParse");
  const prepare = source.indexOf('"sellerpilot_service_prepare_listing_lineage_verification"');
  const enqueue = source.indexOf('"sellerpilot_service_enqueue_listing_lineage_verification"');

  assert.ok(auth >= 0 && auth < bodyParse);
  assert.ok(bodyParse < prepare && prepare < enqueue);
  assert.match(source, /prepareRpc[\s\S]*sellerpilot_service_prepare_listing_lineage_verification/);
  assert.match(source, /admin\.serviceClient\.rpc\(\s*prepareRpc,/);
  assert.match(source, /admin\.serviceClient\.rpc\([\s\S]*sellerpilot_service_enqueue_listing_lineage_verification/);
  assert.doesNotMatch(source, /admin\.userClient\.rpc/);
  assert.doesNotMatch(source, /executeViaChannelGateway|executeChannelOperation|\bfetch\(/);
  assert.doesNotMatch(source, /SUPABASE_SECRET_KEY|process\.env|vault|decrypted_secret/i);
});

test("dry-run cannot enqueue and execute returns honest deduplicated states", async () => {
  const source = await readFile(routeUrl, "utf8");

  const dryRunBranch = source.indexOf('parsed.data.mode === "dry_run"');
  const enqueueCall = source.indexOf('"sellerpilot_service_enqueue_listing_lineage_verification"');
  assert.ok(dryRunBranch > 0 && dryRunBranch < enqueueCall);
  assert.match(
    source.slice(dryRunBranch, enqueueCall),
    /return response\([\s\S]*dryRun: true[\s\S]*eligible:[\s\S]*verified:[\s\S]*manualRequired:/,
  );

  assert.match(source, /status: z\.enum\(\["queued", "running", "already_bound", "manual_required"\]\)/);
  assert.match(source, /result\.status === "manual_required"[\s\S]*manualRequired: true[\s\S]*}, 409\)/);
  assert.match(source, /result\.status === "already_bound"[\s\S]*verified: true/);
  assert.match(source, /accepted: true[\s\S]*inProgress: result\.status === "running"/);
  assert.match(source, /status: result\.status,[\s\S]*reused: result\.reused[\s\S]*}, 202\)/);
  assert.match(source, /status === "queued"[\s\S]{0,160}return reused[\s\S]{0,160}새 작업을 만들지 않았습니다/);
  assert.match(source, /return response\(\{\n\s+ok: false,\n\s+accepted: true,/);
});

test("the one exact Lazada live listing uses dedicated fail-closed adoption RPCs", async () => {
  const source = await readFile(routeUrl, "utf8");

  assert.match(source, /lazadaExactExistingPublicationIdentity\.listingId/);
  assert.match(
    source,
    /exactLazadaLiveAdoption[\s\S]*sellerpilot_service_prepare_exact_lazada_live_adoption/,
  );
  assert.match(
    source,
    /exactLazadaLiveAdoption[\s\S]*sellerpilot_service_enqueue_exact_lazada_live_adoption/,
  );
  assert.doesNotMatch(source, /sellerpilotExactLazadaLiveAdoption|marketplaceSku/);
});

test("the public DTO strips credential and provider identity material", async () => {
  const source = await readFile(routeUrl, "utf8");

  assert.match(source, /requestSchema = z\.object\(\{[\s\S]*listingId:[\s\S]*mode:[\s\S]*\}\)\.strict\(\)/);
  assert.doesNotMatch(
    source.match(/const requestSchema[\s\S]*?\.strict\(\);/)?.[0] ?? "",
    /credentialId|token|provider|subject|secret/i,
  );
  assert.match(source, /prepareResultSchema[\s\S]*credential_id:[\s\S]*\.strip\(\)/);
  assert.match(source, /enqueueResultSchema[\s\S]*job_id:[\s\S]*\.strip\(\)/);
  assert.doesNotMatch(source, /\.json\((?:prepareData|enqueueData|preparation|result)\)/);
  assert.doesNotMatch(source, /\.\.\.(?:prepareData|enqueueData|preparation|result)/);
  assert.doesNotMatch(source, /credentialId:|credential_id:[^\n]*[,}][\s\S]{0,80}(?:return|response\()/);
  assert.doesNotMatch(source, /targetId:|target_id|provider_account_subject|access_token|refresh_token/i);
  assert.match(source, /prepareError \|\| !prepared\.success/);
  assert.match(source, /enqueueError \|\| !enqueued\.success/);
  assert.doesNotMatch(source, /message:\s*(?:prepareError|enqueueError)|String\((?:prepareError|enqueueError)\)/);
});

test("all route responses are non-cacheable and RPC identity mismatches fail closed", async () => {
  const source = await readFile(routeUrl, "utf8");

  assert.match(source, /const noStoreHeaders = \{ "cache-control": "no-store, max-age=0" \}/);
  assert.match(source, /prepared\.data\.listing_id !== parsed\.data\.listingId/);
  assert.match(source, /enqueued\.data\.listing_id !== parsed\.data\.listingId/);
  assert.match(source, /status: "unavailable"[\s\S]*}, 503\)/);
  assert.match(source, /export async function POST\(request: Request\)/);
  assert.doesNotMatch(source, /export async function (?:GET|PUT|PATCH|DELETE)\(/);
});
