import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const claimRouteUrl = new URL("../app/api/channel-gateway/worker/claim/route.ts", import.meta.url);
const completeRouteUrl = new URL("../app/api/channel-gateway/worker/complete/route.ts", import.meta.url);
const heartbeatRouteUrl = new URL("../app/api/channel-gateway/worker/heartbeat/route.ts", import.meta.url);
const beginMutationRouteUrl = new URL("../app/api/channel-gateway/worker/begin-mutation/route.ts", import.meta.url);
const credentialStageRouteUrl = new URL("../app/api/channel-gateway/worker/credential-refresh/route.ts", import.meta.url);
const ebayAuthorizeRouteUrl = new URL("../app/api/admin/channel-credentials/ebay/authorize/route.ts", import.meta.url);
const shopeeAuthorizeRouteUrl = new URL("../app/api/admin/channel-credentials/shopee/authorize/route.ts", import.meta.url);
const lazadaAuthorizeRouteUrl = new URL("../app/api/admin/channel-credentials/lazada/authorize/route.ts", import.meta.url);
const gatewayContractUrl = new URL("../lib/channels/gateway-contract.ts", import.meta.url);
const workerUrl = new URL("../scripts/ai-cli-worker.mjs", import.meta.url);
const providerListingRuntimeUrl = new URL(
  "../lib/channels/provider-listing-runtime.ts",
  import.meta.url,
);
const credentialRefreshMigrationUrl = new URL(
  "../supabase/migrations/20260825104500_prepare_gateway_credential_refresh.sql",
  import.meta.url,
);
const atomicCompletionMigrationUrl = new URL(
  "../supabase/migrations/20260826090400_atomic_gateway_completion_side_effects.sql",
  import.meta.url,
);

test("gateway claim distinguishes malformed credentials from unavailable server configuration", async () => {
  const source = await readFile(claimRouteUrl, "utf8");
  const malformedToken = source.indexOf("workerToken.length < 24");
  const missingConfiguration = source.indexOf("if (!supabaseUrl || !secretKey)");

  assert.notEqual(malformedToken, -1);
  assert.notEqual(missingConfiguration, -1);
  assert.equal(malformedToken < missingConfiguration, true);
  assert.match(source.slice(malformedToken, missingConfiguration), /status: 401/);
  assert.match(source.slice(missingConfiguration), /workerRpcErrorMessage\(503\)[\s\S]*status: 503/);
  assert.match(source, /global: \{ fetch: createBoundedSupabaseFetch\(\) \}/);
  assert.match(source, /gatewayClaimSchema\.safeParse\(data\)/);
});

test("gateway completion bounds Supabase calls and classifies only authorization boundary RPC errors", async () => {
  const source = await readFile(completeRouteUrl, "utf8");
  const snapshotFailure = source.indexOf("if (snapshotError)");
  const domainConflict = source.indexOf('if (!job || (job.status !== "running" && job.status !== "completed_replay"))');
  const normalization = source.indexOf("normalizedOrders = normalizeChannelOrders");
  const lineageTerminal = source.indexOf('if (job.operation === "listing.lineage.verify")', normalization);
  const finalRpc = source.lastIndexOf('serviceClient.rpc("sellerpilot_service_complete_gateway_transaction"');
  const finalFailure = source.indexOf("if (error) {", finalRpc);
  const finalConflict = source.indexOf('if (completion?.status !== "completed")');

  assert.match(source, /workerToken\.length < 24[\s\S]*status: 401/);
  assert.match(source, /if \(!supabaseUrl \|\| !secretKey\)[\s\S]*workerRpcErrorMessage\(503\)[\s\S]*status: 503/);
  assert.match(source, /global: \{ fetch: createBoundedSupabaseFetch\(\) \}/);
  assert.equal(snapshotFailure >= 0 && snapshotFailure < domainConflict, true);
  assert.match(source.slice(snapshotFailure, domainConflict), /workerRpcErrorStatus\(snapshotError\)/);
  assert.match(source.slice(snapshotFailure, domainConflict), /workerRpcErrorMessage\(status\)/);
  assert.match(source.slice(domainConflict, normalization), /status: 409/);
  assert.equal(finalFailure >= 0 && finalFailure < finalConflict, true);
  assert.match(source.slice(finalFailure, finalConflict), /workerRpcErrorStatus\(error\)/);
  assert.match(source.slice(finalFailure, finalConflict), /workerRpcErrorMessage\(status\)/);
  assert.match(source.slice(finalConflict), /status: 409/);
  assert.ok((source.match(/p_claim_token: parsed\.data\.claimToken/g) ?? []).length >= 3);
  assert.equal(lineageTerminal > normalization && lineageTerminal < finalRpc, true);
  assert.doesNotMatch(source, /serviceClient\.rpc\("sellerpilot_service_(?:ingest_orders|ingest_inquiries|mark_channel_sync|prepare_gateway_credential_refresh)"/);
  assert.match(source.slice(finalRpc), /p_normalized_orders: normalizedOrders/);
  assert.match(source.slice(finalRpc), /p_normalized_inquiries: normalizedInquiries/);
  assert.match(source.slice(finalRpc), /p_credential_refresh: credentialRefresh \?\? null/);
});

test("gateway heartbeat separates auth and configuration failures and rejects lost ownership", async () => {
  const source = await readFile(heartbeatRouteUrl, "utf8");
  const malformedToken = source.indexOf("workerToken.length < 24");
  const missingConfiguration = source.indexOf("if (!supabaseUrl || !secretKey)");

  assert.notEqual(malformedToken, -1);
  assert.notEqual(missingConfiguration, -1);
  assert.equal(malformedToken < missingConfiguration, true);
  assert.match(source.slice(malformedToken, missingConfiguration), /status: 401/);
  assert.match(source.slice(missingConfiguration), /workerRpcErrorMessage\(503\)[\s\S]*status: 503/);
  assert.match(source, /global: \{ fetch: createBoundedSupabaseFetch\(\) \}/);
  assert.match(source, /sellerpilot_touch_channel_gateway_job/);
  assert.match(source, /const status = workerRpcErrorStatus\(error\)/);
  assert.match(source, /workerRpcErrorMessage\(status\)/);
  assert.match(source, /채널 작업을 찾지 못했습니다[^\n]+status: 404/);
  assert.match(source, /data !== "running"[\s\S]*status: 409/);
  assert.match(source, /claimToken: z\.string\(\)\.uuid\(\)/);
  assert.match(source, /p_claim_token: parsed\.data\.claimToken/);
  assert.match(source, /p_worker_version: parsed\.data\.version \?\? "sellerpilot-cli-worker\/unknown"/);
});

test("gateway mutation fence separates a live gate denial from lost ownership", async () => {
  const source = await readFile(beginMutationRouteUrl, "utf8");
  const deniedFence = source.indexOf("if (data !== true)");
  const ownershipRecheck = source.indexOf('"sellerpilot_touch_channel_gateway_job"', deniedFence);
  const ownershipLoss = source.indexOf('if (ownership !== "running")', ownershipRecheck);
  const mutationContext = source.indexOf('"sellerpilot_service_gateway_completion_context"', ownershipLoss);
  const contextContract = source.indexOf("const context =", mutationContext);
  const markerCheck = source.indexOf("context.publication_verification_boundary != null", contextContract);
  const preconditionFailure = source.indexOf("status: 412", markerCheck);

  assert.equal(deniedFence >= 0, true);
  assert.equal(ownershipRecheck > deniedFence, true);
  assert.equal(ownershipLoss > ownershipRecheck, true);
  assert.equal(mutationContext > ownershipLoss, true);
  assert.equal(contextContract > mutationContext, true);
  assert.equal(markerCheck > contextContract, true);
  assert.equal(preconditionFailure > markerCheck, true);
  assert.match(source.slice(ownershipRecheck, ownershipLoss), /p_token_hash: tokenHash/);
  assert.match(source.slice(ownershipRecheck, ownershipLoss), /p_job_id: parsed\.data\.jobId/);
  assert.match(source.slice(ownershipRecheck, ownershipLoss), /p_claim_token: parsed\.data\.claimToken/);
  assert.match(source.slice(ownershipRecheck, ownershipLoss), /sellerpilot-cli-worker\/provider-fence-recheck/);
  assert.match(source.slice(ownershipRecheck, ownershipLoss), /workerRpcErrorStatus\(ownershipError\)/);
  assert.match(source.slice(ownershipRecheck, ownershipLoss), /workerRpcErrorMessage\(status\)/);
  assert.match(source.slice(ownershipLoss, mutationContext), /status: 409/);
  assert.match(source.slice(mutationContext, contextContract), /p_claim_token: parsed\.data\.claimToken/);
  assert.match(source.slice(mutationContext, contextContract), /workerRpcErrorStatus\(contextError\)/);
  assert.match(source.slice(contextContract, markerCheck), /context\.status !== "running"[\s\S]*status: 409/);
  assert.match(source.slice(preconditionFailure - 220), /GATEWAY_PROVIDER_MUTATION_NOT_STARTED/);
});

test("gateway mutation context errors preserve uncertain state instead of failing pre-provider", async () => {
  const source = await readFile(beginMutationRouteUrl, "utf8");
  const helper = source.indexOf("function providerMutationStateUncertainResponse");
  const contextError = source.indexOf("if (contextError)");
  const contextContract = source.indexOf("const context =", contextError);

  assert.equal(helper >= 0 && helper < contextError, true);
  assert.match(source.slice(helper, source.indexOf("export async function POST", helper)), /GATEWAY_PROVIDER_MUTATION_STATE_UNCERTAIN/);
  assert.match(source.slice(helper, source.indexOf("export async function POST", helper)), /status: 409/);
  assert.match(source.slice(contextError, contextContract), /status === 401/);
  assert.match(source.slice(contextError, contextContract), /workerRpcErrorMessage\(status\)/);
  assert.match(source.slice(contextError, contextContract), /providerMutationStateUncertainResponse\(\)/);
  assert.doesNotMatch(source.slice(contextError, contextContract), /status: 412/);
});

test("gateway mutation marker replay is reconciliation-safe and never reaches the 412 failure", async () => {
  const source = await readFile(beginMutationRouteUrl, "utf8");
  const markerCheck = source.indexOf("context.publication_verification_boundary != null");
  const uncertainReturn = source.indexOf("providerMutationStateUncertainResponse()", markerCheck);
  const deniedCode = source.indexOf("GATEWAY_PROVIDER_MUTATION_NOT_STARTED", markerCheck);
  const preconditionFailure = source.indexOf("status: 412", markerCheck);

  assert.equal(markerCheck >= 0, true);
  assert.equal(uncertainReturn > markerCheck, true);
  assert.equal(deniedCode > uncertainReturn, true);
  assert.equal(preconditionFailure > deniedCode, true);
});

test("gateway completion accepts a terminal reconciliation state without disguising it as failure", async () => {
  const [routeSource, contractSource, migrationSource] = await Promise.all([
    readFile(completeRouteUrl, "utf8"),
    readFile(gatewayContractUrl, "utf8"),
    readFile(credentialRefreshMigrationUrl, "utf8"),
  ]);

  assert.match(contractSource, /status: z\.literal\("reconciliation_required"\)/);
  assert.match(contractSource, /result: operationResultSchema\.optional\(\)/);
  assert.match(contractSource, /claim_token: z\.string\(\)\.uuid\(\)/);
  assert.ok((contractSource.match(/claimToken: z\.string\(\)\.uuid\(\)/g) ?? []).length >= 3);
  assert.match(routeSource, /publicationVerificationBoundary[\s\S]*job\.publication_verification_boundary/);
  assert.match(routeSource, /gatewayJobCompletionStatusAtJobBoundary\([\s\S]*publicationVerificationBoundary/);
  assert.match(routeSource, /effectiveCompletionStatus === "reconciliation_required"[\s\S]*LISTING_REMOTE_STATE_PROVIDER_MUTATION_BOUNDARY_MISMATCH/);
  assert.match(routeSource, /p_status: effectiveCompletionStatus/);
  assert.match(routeSource, /p_error_message: effectiveCompletionError/);
  assert.match(routeSource, /parsed\.data\.status === "reconciliation_required"/);
  assert.match(migrationSource, /status in \('queued', 'running', 'succeeded', 'failed', 'cancelled', 'reconciliation_required'\)/);
  assert.match(migrationSource, /p_status not in \('succeeded', 'failed', 'reconciliation_required'\)/);
  assert.match(migrationSource, /set status = 'manual_required',[\s\S]*failure_class = 'external_action'/);
});

test("listing media mutations are fenced before upload and preserved in structured reconciliation", async () => {
  const [workerSource, listingRuntimeSource, routeSource] = await Promise.all([
    readFile(workerUrl, "utf8"),
    readFile(providerListingRuntimeUrl, "utf8"),
    readFile(completeRouteUrl, "utf8"),
  ]);

  const shopeeUpload = listingRuntimeSource.indexOf("async function uploadShopeeImage");
  const shopeeFence = listingRuntimeSource.indexOf("await hooks.beginProviderMutation()", shopeeUpload);
  const shopeeFetch = listingRuntimeSource.indexOf("const response = await fetch", shopeeFence);
  const lazadaPrepare = listingRuntimeSource.indexOf("async function prepareLazadaListing");
  const lazadaFence = listingRuntimeSource.indexOf("await input.hooks.beginProviderMutation()", lazadaPrepare);
  const lazadaRequest = listingRuntimeSource.indexOf("const remote = await dependencies.lazadaRequest", lazadaFence);
  const smartstorePrepare = listingRuntimeSource.indexOf("async function prepareSmartstoreListing");
  const smartstoreFence = listingRuntimeSource.indexOf("await input.hooks.beginProviderMutation()", smartstorePrepare);
  const smartstoreUpload = listingRuntimeSource.indexOf("const uploadResponse = await fetch", smartstoreFence);
  assert.equal(shopeeUpload >= 0 && shopeeUpload < shopeeFence && shopeeFence < shopeeFetch, true);
  assert.equal(lazadaPrepare >= 0 && lazadaPrepare < lazadaFence && lazadaFence < lazadaRequest, true);
  assert.equal(smartstorePrepare >= 0 && smartstorePrepare < smartstoreFence && smartstoreFence < smartstoreUpload, true);
  assert.match(listingRuntimeSource, /downloadMarketplaceImage\(urlValue, signal\)/);
  assert.match(listingRuntimeSource, /assertPublicReferenceUrl\(imageUrl, \{ signal: input\.signal \}\)/);
  assert.match(workerSource, /name: "listing-image-upload"[\s\S]*sellerpilotMutation: "accepted"/);
  assert.match(workerSource, /gatewayJobCompletionStatus\(result\.operation, result\.ok, result\.steps \?\? \[\]\)/);
  assert.match(workerSource, /status: "reconciliation_required", error: result\.safeMessage, result/);
  assert.doesNotMatch(workerSource, /\[Lazada listing debug\]/);
  assert.match(routeSource, /parsed\.data\.status === "reconciliation_required" && parsed\.data\.result/);
  assert.match(routeSource, /storedResponse = parsed\.data\.result/);
});

test("gateway credential refresh preparation is ownership-bound and never forces a provider-success job to failed", async () => {
  const [source, migration] = await Promise.all([
    readFile(completeRouteUrl, "utf8"),
    readFile(atomicCompletionMigrationUrl, "utf8"),
  ]);
  const refreshSelection = source.indexOf("const credentialRefresh = parsed.data.credentialRefresh");
  const atomicCompletion = source.indexOf('"sellerpilot_service_complete_gateway_transaction"');

  assert.notEqual(refreshSelection, -1);
  assert.notEqual(atomicCompletion, -1);
  assert.equal(refreshSelection < atomicCompletion, true);
  assert.match(source.slice(refreshSelection, atomicCompletion), /parsed\.data\.credentialRefresh/);
  assert.match(source.slice(atomicCompletion), /p_token_hash: tokenHash/);
  assert.match(source.slice(atomicCompletion), /p_job_id: parsed\.data\.jobId/);
  assert.match(source.slice(atomicCompletion), /p_claim_token: parsed\.data\.claimToken/);
  assert.match(source.slice(atomicCompletion), /p_credential_refresh: credentialRefresh \?\? null/);
  assert.doesNotMatch(source, /sellerpilot_service_refresh_(?:shopee|lazada|ebay)/);
  assert.doesNotMatch(source, /sellerpilot_service_prepare_gateway_credential_refresh/);
  assert.doesNotMatch(source, /oauthResult\.credentialPayload/);
  assert.match(source, /oauthResult[\s\S]*\? \{ ok: true, channel: oauthResult\.channel, operation: oauthResult\.operation, safeMessage: oauthResult\.safeMessage \}/);
  assert.match(migration, /sellerpilot_service_prepare_gateway_credential_refresh\([\s\S]*v_preparation_status/);
  assert.match(migration, /sellerpilot_service_ingest_orders\([\s\S]*sellerpilot_service_ingest_inquiries\([\s\S]*sellerpilot_complete_channel_gateway_job\(/);
  assert.match(migration, /gateway_completion_receipts/);
  assert.match(migration, /gateway completion replay mismatch/);
});

test("all OAuth callbacks use the durable gateway and keep one-time grants out of ordinary job payloads", async () => {
  const [ebaySource, shopeeSource, lazadaSource, migrationSource] = await Promise.all([
    readFile(ebayAuthorizeRouteUrl, "utf8"),
    readFile(shopeeAuthorizeRouteUrl, "utf8"),
    readFile(lazadaAuthorizeRouteUrl, "utf8"),
    readFile(credentialRefreshMigrationUrl, "utf8"),
  ]);

  for (const source of [ebaySource, shopeeSource, lazadaSource]) {
    assert.match(source, /exchangeOAuthViaChannelGateway/);
    assert.match(source, /ChannelGatewayInProgressError[\s\S]*status: 202/);
    assert.match(source, /ChannelGatewayReconciliationRequiredError[\s\S]*status: 409/);
  }
  assert.doesNotMatch(ebaySource, /exchangeEbayOAuthToken/);
  assert.match(migrationSource, /oauth_request_vault_id/);
  assert.match(migrationSource, /oauth_source_credential_id/);
  assert.match(migrationSource, /channel_gateway_jobs_oauth_grant_replay_idx/);
  assert.match(migrationSource, /when j\.operation = 'oauth\.exchange' then oauth_d\.decrypted_secret::jsonb/);
  assert.match(migrationSource, /delete from vault\.secrets where id = v_oauth_request_vault_id/);
  assert.doesNotMatch(migrationSource, /vault\.delete_secret/);
});

test("gateway stages every received OAuth token under the exact live claim before terminal completion", async () => {
  const [stageSource, completeSource, contractSource, migrationSource] = await Promise.all([
    readFile(credentialStageRouteUrl, "utf8"),
    readFile(completeRouteUrl, "utf8"),
    readFile(gatewayContractUrl, "utf8"),
    readFile(credentialRefreshMigrationUrl, "utf8"),
  ]);

  assert.match(contractSource, /gatewayCredentialRefreshLifecycleSchema/);
  assert.match(contractSource, /action: z\.literal\("begin"\)/);
  assert.match(contractSource, /action: z\.literal\("stage"\)/);
  assert.match(contractSource, /recoveryOnly: z\.boolean\(\)\.optional\(\)/);
  assert.match(contractSource, /oauthComplete: z\.boolean\(\)\.optional\(\)/);
  assert.match(stageSource, /gatewayCredentialRefreshLifecycleSchema\.safeParse/);
  assert.match(stageSource, /sellerpilot_service_begin_gateway_credential_refresh/);
  assert.match(stageSource, /p_token_hash: tokenHash/);
  assert.match(stageSource, /p_job_id: parsed\.data\.jobId/);
  assert.match(stageSource, /p_claim_token: parsed\.data\.claimToken/);
  assert.match(stageSource, /p_recovery_only: refresh\.recoveryOnly === true/);
  assert.match(stageSource, /p_oauth_complete: refresh\.oauthComplete === true/);
  assert.match(stageSource, /createBoundedSupabaseFetch\(\)/);
  assert.match(completeSource, /p_credential_refresh: credentialRefresh \?\? null/);
  assert.match(migrationSource, /j\.claim_token = p_claim_token[\s\S]*j\.lease_expires_at > now\(\)[\s\S]*for update/);
  assert.match(migrationSource, /credential_refresh_recovery_vault_id/);
  assert.match(migrationSource, /credential_refresh_in_flight/);
  assert.match(migrationSource, /vault\.create_secret\(/);
  assert.match(migrationSource, /status', 'recovery_preserved'/);
  assert.match(migrationSource, /if v_job\.prepared_credential_id is not null[\s\S]*v_job\.credential_refresh_fingerprint = v_request_fingerprint/);
  assert.doesNotMatch(migrationSource, /credential_refresh_fingerprint <> v_request_fingerprint[\s\S]*status', 'conflict'/);
  assert.match(migrationSource, /unresolved\.status = 'reconciliation_required'[\s\S]*unresolved\.credential_refresh_in_flight/);
  assert.match(migrationSource, /oauth_exchange_completed/);
  assert.match(migrationSource, /when j\.oauth_exchange_completed and not j\.credential_refresh_in_flight then 'succeeded'/);
  assert.match(migrationSource, /j\.operation = 'oauth\.exchange'[\s\S]*j\.credential_refresh_recovery_vault_id is not null[\s\S]*then 'reconciliation_required'/);
});

test("gateway credential serialization preserves live leases and repoints queued attempt-backed work", async () => {
  const source = await readFile(credentialRefreshMigrationUrl, "utf8");
  const rolloutRepointStart = source.indexOf("-- Move only queued work to the active credential");
  const uniqueIndexStart = source.indexOf("create unique index if not exists channel_gateway_jobs_one_running_per_credential_idx");
  const claimStart = source.indexOf("create or replace function public.sellerpilot_claim_channel_gateway_job");
  const preparationStart = source.indexOf("create function public.sellerpilot_service_prepare_gateway_credential_refresh");
  const preparationQueueRepoint = source.indexOf("update sellerpilot_private.channel_gateway_jobs queued", preparationStart);
  const preparationCurrentJob = source.indexOf("update sellerpilot_private.channel_gateway_jobs j", preparationQueueRepoint);

  assert.equal(rolloutRepointStart >= 0 && rolloutRepointStart < uniqueIndexStart, true);
  const rolloutRepoint = source.slice(rolloutRepointStart, uniqueIndexStart);
  assert.match(rolloutRepoint, /j\.status = 'queued'/);
  assert.doesNotMatch(rolloutRepoint, /attempt_id\s+is\s+null/i);

  const rolloutGuard = source.slice(0, rolloutRepointStart);
  assert.match(rolloutGuard, /where j\.status = 'running'[\s\S]*live gateway jobs must drain before claim nonce rollout/);

  assert.match(
    source.slice(uniqueIndexStart, claimStart),
    /on sellerpilot_private\.channel_gateway_jobs \(credential_id\)[\s\S]*where status = 'running'/,
  );
  const claimFunction = source.slice(claimStart, preparationStart);
  assert.match(claimFunction, /running_c\.channel = c\.channel/);
  assert.match(claimFunction, /running_c\.environment = c\.environment/);
  assert.match(claimFunction, /for update of j, c skip locked/);
  assert.match(claimFunction, /lease_expires_at = now\(\) \+ interval '15 minutes'/);

  assert.match(source, /create function public\.sellerpilot_touch_channel_gateway_job\(/);
  assert.match(
    source,
    /j\.status = 'running'[\s\S]*j\.worker_token_id = v_token_id[\s\S]*j\.claim_token = p_claim_token[\s\S]*j\.lease_expires_at > now\(\)[\s\S]*return 'ownership_lost'/,
  );
  assert.match(source, /revoke all on function public\.sellerpilot_touch_channel_gateway_job\(text, uuid, uuid, text\)[\s\S]*grant execute[\s\S]*to service_role/);
  assert.match(source, /Gateway write lease expired; provider outcome requires reconciliation\./);
  assert.match(source, /when j\.operation in \([\s\S]*'listing\.create'[\s\S]*then 'reconciliation_required'/);

  assert.equal(preparationQueueRepoint >= 0 && preparationQueueRepoint < preparationCurrentJob, true);
  const refreshQueueRepoint = source.slice(preparationQueueRepoint, preparationCurrentJob);
  assert.match(refreshQueueRepoint, /queued\.status = 'queued'/);
  assert.doesNotMatch(refreshQueueRepoint, /attempt_id\s+is\s+null/i);
  assert.match(source.slice(preparationCurrentJob), /set credential_id = v_refreshed_credential_id,[\s\S]*prepared_credential_id = v_refreshed_credential_id/);
});
