import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";
import { z } from "zod";
import {
  temuBuyerChatReadinessViewSchema,
  temuBuyerChatRuntimeReadSchema,
  temuCsReadiness,
} from "../lib/channels/cs/temu/runtime-readiness";
import { temuHistoryAccountsSchema } from "../lib/cs/channels/temu/history-resume";
import { gatewayClaimSchema } from "../lib/channels/gateway-contract";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const { executeServerlessCsProviderJob, runOneServerlessCsGatewayJob } = await import(
  "../lib/channels/serverless-gateway"
);
const { executeCsOperation } = await import("../lib/cs/operations/execute");

const readMigration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const sources = Object.fromEntries(await Promise.all(Object.entries({
  credentialBase: "20260816060000_channel_credentials_and_roles.sql",
  connectorExpansion: "20260816120321_expand_channel_connectors.sql",
  workerBase: "20260816065848_sellerpilot_ai_cli_jobs.sql",
  gatewayBase: "20260817054039_channel_gateway_queue.sql",
  temuChannel: "20260817213000_add_temu_and_route_naver.sql",
  inquiryOperations: "20260825110000_enable_channel_inquiry_replies.sql",
  credentialRefresh: "20260825104500_prepare_gateway_credential_refresh.sql",
  sellerLineage: "20260825111800_bind_listing_seller_accounts.sql",
  workerScope: "20260826090000_scope_worker_tokens_and_idempotent_ai_completion.sql",
  workerRotation: "20260826090500_atomic_worker_token_set_rotation.sql",
  atomicCompletion: "20260826090400_atomic_gateway_completion_side_effects.sql",
  serverless: "20260828145600_serverless_cs_claim_and_runtime_bootstrap.sql",
  generalizedServerless: "20260828210000_non_cs_release_integrity.sql",
  binding: "20260908000000_add_cs_credential_capability_bindings.sql",
  temuBindingContext: "20260909134538_temu_cs_verified_account_binding_context.sql",
  temuAccounts: "20260909134540_temu_account_scoped_history_metadata.sql",
  readiness: "20260910033000_cs_temu_buyer_chat_readiness.sql",
  observationWriter: "20260910051600_cs_temu_buyer_chat_observation_writer.sql",
}).map(async ([key, name]) => [key, await readMigration(name)])));

const routeSource = await readFile(new URL(
  "../app/api/admin/cs/channels/temu/buyer-chat-readiness/route.ts", import.meta.url,
), "utf8");
const transpiledRoute = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal(transpiledRoute.diagnostics?.filter(
  item => item.category === ts.DiagnosticCategory.Error,
).length ?? 0, 0);

function exactFragment(source, pattern, label) {
  const match = source.match(pattern)?.[0];
  assert.ok(match, `missing canonical migration fragment: ${label}`);
  return match;
}

function functionStatement(source, qualifiedName, occurrence = "first") {
  const markers = [
    `create or replace function ${qualifiedName}`,
    `create function ${qualifiedName}`,
  ];
  const positions = markers.flatMap(marker => {
    const found = [];
    let cursor = source.indexOf(marker);
    while (cursor >= 0) {
      found.push(cursor);
      cursor = source.indexOf(marker, cursor + marker.length);
    }
    return found;
  }).sort((left, right) => left - right);
  assert.ok(positions.length > 0, `missing function ${qualifiedName}`);
  const start = occurrence === "last" ? positions.at(-1) : positions[0];
  const end = source.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated function ${qualifiedName}`);
  return source.slice(start, end + 4);
}

function blockStatement(source, tag) {
  const start = source.indexOf(`do $${tag}$`);
  const marker = `$${tag}$;`;
  const end = source.indexOf(marker, start + 3);
  assert.ok(start >= 0 && end >= 0, `missing block ${tag}`);
  return source.slice(start, end + marker.length);
}

const canonical = {
  adminTable: exactFragment(sources.credentialBase,
    /create table if not exists sellerpilot_private\.admin_users \([\s\S]*?\n\);/u,
    "admin_users"),
  credentialTable: exactFragment(sources.credentialBase,
    /create table if not exists sellerpilot_private\.channel_credentials \([\s\S]*?\n\);/u,
    "channel_credentials"),
  credentialIndex: exactFragment(sources.credentialBase,
    /create unique index if not exists channel_credentials_one_active_idx[\s\S]*?;/u,
    "channel credential uniqueness"),
  isAdmin: functionStatement(sources.credentialBase, "public.sellerpilot_is_admin"),
  credentialTemuConstraint: exactFragment(sources.temuChannel,
    /alter table sellerpilot_private\.channel_credentials drop constraint[\s\S]*?check \(channel in \('qoo10',[\s\S]*?'temu'\)\);/u,
    "Temu credential channel constraint"),
  sellerCredentialColumns: exactFragment(sources.sellerLineage,
    /alter table sellerpilot_private\.channel_credentials\n {2}add column[\s\S]*?;/u,
    "credential seller columns"),
  sellerCredentialConstraint: exactFragment(sources.sellerLineage,
    /alter table sellerpilot_private\.channel_credentials\n {2}drop constraint[\s\S]*?\n {2}\);/u,
    "credential seller constraint"),
  sellerCredentialNotNull: exactFragment(sources.sellerLineage,
    /alter table sellerpilot_private\.channel_credentials\n {2}alter column seller_account_key_source set not null;/u,
    "credential seller source not null"),
  operationAttemptTable: exactFragment(sources.connectorExpansion,
    /create table if not exists sellerpilot_private\.channel_operation_attempts \([\s\S]*?\n\);/u,
    "channel_operation_attempts"),
  workerTable: exactFragment(sources.workerBase,
    /create table if not exists sellerpilot_private\.ai_cli_worker_tokens \([\s\S]*?\n\);/u,
    "ai_cli_worker_tokens"),
  workerIndex: exactFragment(sources.workerBase,
    /create unique index if not exists ai_cli_worker_one_active_idx[\s\S]*?;/u,
    "worker token uniqueness"),
  workerScopeColumn: exactFragment(sources.workerScope,
    /alter table sellerpilot_private\.ai_cli_worker_tokens\n {2}add column if not exists scope[\s\S]*?;/u,
    "worker token scope"),
  workerScopeIndex: exactFragment(sources.workerScope,
    /drop index if exists sellerpilot_private\.ai_cli_worker_one_active_idx;[\s\S]*?where status = 'active';/u,
    "worker per-scope uniqueness"),
  workerRotationStatus: exactFragment(sources.workerRotation,
    /alter table sellerpilot_private\.ai_cli_worker_tokens\n {2}drop constraint[\s\S]*?status in \('pending', 'active', 'revoked'\)\);/u,
    "worker rotation status"),
  workerRotationColumns: exactFragment(sources.workerRotation,
    /alter table sellerpilot_private\.ai_cli_worker_tokens\n {2}add column if not exists rotation_set_id[\s\S]*?;/u,
    "worker rotation columns"),
  workerServerlessScope: exactFragment(sources.serverless,
    /alter table sellerpilot_private\.ai_cli_worker_tokens\n {2}drop constraint[\s\S]*?'serverless_cs_scheduler'\n {2}\)\);/u,
    "serverless worker scopes"),
  workerRls: exactFragment(sources.workerBase,
    /alter table sellerpilot_private\.ai_cli_worker_tokens enable row level security;/u,
    "worker token RLS"),
  workerAcl: exactFragment(sources.workerBase,
    /revoke all on sellerpilot_private\.ai_cli_worker_tokens from public, anon, authenticated;/u,
    "worker token ACL"),
  gatewayTable: exactFragment(sources.gatewayBase,
    /create table sellerpilot_private\.channel_gateway_jobs \([\s\S]*?\n\);/u,
    "channel_gateway_jobs"),
  gatewayIndexes: exactFragment(sources.gatewayBase,
    /create index channel_gateway_jobs_queue_idx[\s\S]*?where attempt_id is not null;/u,
    "gateway indexes"),
  gatewayRlsAcl: exactFragment(sources.gatewayBase,
    /alter table sellerpilot_private\.channel_gateway_jobs enable row level security;\nrevoke all on sellerpilot_private\.channel_gateway_jobs from public, anon, authenticated;/u,
    "gateway ACL"),
  gatewayTemuConstraint: exactFragment(sources.temuChannel,
    /alter table sellerpilot_private\.channel_gateway_jobs drop constraint[\s\S]*?check \(channel in \('shopee',[\s\S]*?'temu'\)\);/u,
    "Temu gateway channel constraint"),
  gatewayInquiryConstraint: exactFragment(sources.inquiryOperations,
    /alter table sellerpilot_private\.channel_gateway_jobs\n {2}drop constraint[\s\S]*?'inquiries\.reply'[\s\S]*?\)\) not valid;/u,
    "gateway inquiry operation constraint"),
  gatewayRefreshColumns: exactFragment(sources.credentialRefresh,
    /alter table sellerpilot_private\.channel_gateway_jobs\n {2}add column if not exists credential_refresh_fingerprint[\s\S]*?claim_token uuid;/u,
    "gateway claim columns"),
  gatewayStatusConstraint: exactFragment(sources.credentialRefresh,
    /alter table sellerpilot_private\.channel_gateway_jobs\n {2}drop constraint if exists channel_gateway_jobs_status_check;[\s\S]*?'reconciliation_required'\)\n {2}\);/u,
    "gateway status constraint"),
  gatewayRunningClaimConstraint: exactFragment(sources.credentialRefresh,
    /alter table sellerpilot_private\.channel_gateway_jobs\n {6}add constraint channel_gateway_jobs_running_claim_token_check[\s\S]*?;/u,
    "gateway running claim constraint"),
  gatewaySellerColumn: exactFragment(sources.sellerLineage,
    /alter table sellerpilot_private\.channel_gateway_jobs\n {2}add column if not exists seller_account_key text;/u,
    "gateway seller column"),
  gatewaySellerConstraint: exactFragment(sources.sellerLineage,
    /alter table sellerpilot_private\.channel_gateway_jobs\n {2}drop constraint[\s\S]*?seller_account_key ~ '\^\[a-f0-9\]\{64\}\$'\);/u,
    "gateway seller constraint"),
  gatewayProviderMutationColumn: exactFragment(sources.generalizedServerless,
    /alter table sellerpilot_private\.channel_gateway_jobs\n {2}add column if not exists provider_mutation_started_at timestamptz;/u,
    "gateway provider mutation column"),
  workerTokenHasScope: functionStatement(sources.workerScope,
    "sellerpilot_private.worker_token_has_scope"),
  serverlessAllowed: functionStatement(sources.generalizedServerless,
    "sellerpilot_private.serverless_gateway_job_allowed"),
  workerMayComplete: functionStatement(sources.generalizedServerless,
    "sellerpilot_private.worker_token_may_complete_gateway_job"),
  completionReceiptTable: exactFragment(sources.atomicCompletion,
    /create table if not exists sellerpilot_private\.gateway_completion_receipts \([\s\S]*?\n\);/u,
    "gateway completion receipts"),
  completionReceiptAcl: exactFragment(sources.atomicCompletion,
    /alter table sellerpilot_private\.gateway_completion_receipts enable row level security;[\s\S]*?from public, anon, authenticated, service_role;/u,
    "gateway completion receipt ACL"),
  gatewayCompletionContext: functionStatement(sources.atomicCompletion,
    "public.sellerpilot_service_gateway_completion_context"),
  gatewayCompletion: functionStatement(sources.atomicCompletion,
    "public.sellerpilot_service_complete_gateway_transaction"),
  serverlessRewrite: blockStatement(sources.serverless, "migration"),
  serverlessCompletionContext: functionStatement(sources.serverless,
    "public.sellerpilot_service_serverless_cs_completion_context"),
  accountList: functionStatement(sources.temuAccounts,
    "public.sellerpilot_list_temu_cs_accounts_v1"),
  accountListAcl: exactFragment(sources.temuAccounts,
    /revoke all on function public\.sellerpilot_list_temu_cs_accounts_v1\(\)[\s\S]*?to authenticated;/u,
    "Temu account list ACL"),
};

const admin = "00000000-0000-4000-8000-00000000c901";
const outsider = "00000000-0000-4000-8000-00000000c902";
const owner = "00000000-0000-4000-8000-00000000c903";
const wrongOwner = "00000000-0000-4000-8000-00000000c904";
const credentialId = "00000000-0000-4000-8000-00000000c905";
const secondaryCredentialId = "00000000-0000-4000-8000-00000000c906";
const workerTokenId = "00000000-0000-4000-8000-00000000c907";
const jobId = "00000000-0000-4000-8000-00000000c908";
const claimToken = "00000000-0000-4000-8000-00000000c909";
const tokenHash = "7".repeat(64);
const sellerAccountKey = "8".repeat(64);
const secondarySellerAccountKey = "9".repeat(64);

async function value(db, sql, parameters = []) {
  const result = await db.query(sql, parameters);
  return Object.values(result.rows[0] ?? {})[0];
}

async function canonicalFixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema sellerpilot_private; create schema extensions;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create function extensions.digest(text,text) returns bytea language sql immutable
      as $$select sha256(convert_to($1,'UTF8'))$$;
    ${canonical.adminTable}
    ${canonical.credentialTable}
    ${canonical.credentialIndex}
    ${canonical.credentialTemuConstraint}
    ${canonical.sellerCredentialColumns}
    ${canonical.sellerCredentialConstraint}
    ${canonical.sellerCredentialNotNull}
    ${canonical.operationAttemptTable}
    ${canonical.workerTable}
    ${canonical.workerIndex}
    ${canonical.workerScopeColumn}
    ${canonical.workerScopeIndex}
    ${canonical.workerRotationStatus}
    ${canonical.workerRotationColumns}
    ${canonical.workerServerlessScope}
    ${canonical.workerRls}
    ${canonical.workerAcl}
    ${canonical.gatewayTable}
    ${canonical.gatewayIndexes}
    ${canonical.gatewayRlsAcl}
    ${canonical.gatewayTemuConstraint}
    ${canonical.gatewayInquiryConstraint}
    ${canonical.gatewayRefreshColumns}
    ${canonical.gatewayStatusConstraint}
    ${canonical.gatewayRunningClaimConstraint}
    ${canonical.gatewaySellerColumn}
    ${canonical.gatewaySellerConstraint}
    ${canonical.gatewayProviderMutationColumn}
    ${canonical.isAdmin}
    ${canonical.workerTokenHasScope}
    ${canonical.serverlessAllowed}
    ${canonical.completionReceiptTable}
    ${canonical.completionReceiptAcl}
    ${canonical.workerMayComplete}
  `);
  await db.exec("set check_function_bodies = off");
  await db.exec(canonical.gatewayCompletionContext);
  await db.exec(canonical.gatewayCompletion);
  await db.exec(canonical.serverlessRewrite);
  await db.exec(canonical.serverlessCompletionContext);
  await db.exec("set check_function_bodies = on");
  await db.exec(sources.binding);
  await db.exec(sources.temuBindingContext);
  await db.exec(canonical.accountList);
  await db.exec(canonical.accountListAcl);
  await db.exec(sources.readiness);
  await db.exec(sources.observationWriter);
  await db.query("insert into auth.users values($1),($2),($3),($4)", [
    admin, outsider, owner, wrongOwner,
  ]);
  await db.query(
    "insert into sellerpilot_private.admin_users(user_id,display_name) values($1,'공유 관리자')",
    [admin],
  );
  await db.query(`insert into sellerpilot_private.channel_credentials(
    id,channel,environment,version,vault_secret_id,fingerprint,status,expires_at,
    rotation_interval_days,warning_days,last_rotated_at,created_by,created_at,
    seller_account_key,seller_account_key_source,seller_account_verified_at
  ) values
    ($1,'temu','production',1,$3,'TEMUCRED0001','active',clock_timestamp()+interval '1 day',
      90,30,clock_timestamp(),$5,clock_timestamp(),$7,'provider_certified_v1',clock_timestamp()),
    ($2,'temu','production',2,$4,'TEMUCRED0002','revoked',clock_timestamp()+interval '1 day',
      90,30,clock_timestamp(),$6,clock_timestamp(),$8,'provider_certified_v1',clock_timestamp())`, [
    credentialId, secondaryCredentialId,
    "00000000-0000-4000-8000-00000000c911",
    "00000000-0000-4000-8000-00000000c912",
    owner, wrongOwner, sellerAccountKey, secondarySellerAccountKey,
  ]);
  await db.query(`insert into sellerpilot_private.ai_cli_worker_tokens(
    id,label,token_hash,fingerprint,status,scope,expires_at,created_by,created_at
  ) values($1,'shared serverless',$2,'AAAAAAAAAAAA','active','serverless_cs',
    clock_timestamp()+interval '1 day',$3,clock_timestamp())`, [workerTokenId, tokenHash, admin]);
  await db.query(`insert into sellerpilot_private.channel_gateway_jobs(
    id,credential_id,attempt_id,channel,operation,environment,request_payload,status,
    worker_token_id,claim_token,attempt_count,lease_expires_at,created_by,created_at,
    started_at,updated_at,seller_account_key
  ) values($1,$2,null,'temu','inquiries.list','production',
    '{"arguments":{"kind":"buyer_chat"}}','running',$3,$4,1,
    clock_timestamp()+interval '10 minutes',$5,clock_timestamp(),clock_timestamp(),
    clock_timestamp(),$6)`, [
    jobId, credentialId, workerTokenId, claimToken, owner, sellerAccountKey,
  ]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
  return db;
}

async function insertEvidence(db, overrides = {}) {
  const evidence = {
    ownerId: owner,
    credentialId,
    environment: "production",
    sellerAccountKey,
    region: "GLOBAL",
    sourceRevision: 1,
    sourceSha: "a".repeat(64),
    appStatus: "Inactive",
    complianceStatus: "Reviewing",
    securityStatus: "Reviewing",
    sellerStatus: "Reviewing",
    contractKey: null,
    contractSha: null,
    permissionPackage: null,
    grants: [],
    ...overrides,
  };
  await db.query(`insert into sellerpilot_private.temu_buyer_chat_readiness_evidence(
    owner_id,credential_id,environment,seller_account_key,region,source_kind,
    source_revision,source_revision_sha256,observed_at,expires_at,app_status,
    compliance_status,security_questionnaire_status,seller_authorization_status,
    contract_key,contract_revision_sha256,permission_package,granted_permission_packages
  ) values($1,$2,$3,$4,$5,'partner_center_authenticated_readback',$6,$7,
    clock_timestamp()-interval '1 minute',clock_timestamp()+interval '5 minutes',
    $8,$9,$10,$11,$12,$13,$14,$15::jsonb)`, [
    evidence.ownerId, evidence.credentialId, evidence.environment,
    evidence.sellerAccountKey, evidence.region, evidence.sourceRevision,
    evidence.sourceSha, evidence.appStatus, evidence.complianceStatus,
    evidence.securityStatus, evidence.sellerStatus, evidence.contractKey,
    evidence.contractSha, evidence.permissionPackage, JSON.stringify(evidence.grants),
  ]);
}

async function roleRpc(db, role, name, arguments_ = {}) {
  await db.exec(`set role ${role}`);
  try {
    if (name === "sellerpilot_list_temu_cs_accounts_v1") {
      return { data: await value(db,
        "select public.sellerpilot_list_temu_cs_accounts_v1() result"), error: null };
    }
    if (name === "sellerpilot_read_temu_buyer_chat_readiness_v1") {
      return { data: await value(db,
        "select public.sellerpilot_read_temu_buyer_chat_readiness_v1($1) result",
        [arguments_.p_credential_id]), error: null };
    }
    if (name === "sellerpilot_record_temu_buyer_chat_observation_diagnostic_v1") {
      return { data: await value(db, `select
        public.sellerpilot_record_temu_buyer_chat_observation_diagnostic_v1(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
        ) result`, [
        arguments_.p_credential_id, arguments_.p_client_observation_id,
        arguments_.p_artifact_id, arguments_.p_artifact_sha256,
        arguments_.p_expected_revision, arguments_.p_observed_at,
        arguments_.p_claimed_app_status, arguments_.p_claimed_compliance_status,
        arguments_.p_claimed_security_questionnaire_status,
        arguments_.p_claimed_seller_authorization_status,
      ]), error: null };
    }
    if (name === "sellerpilot_service_serverless_cs_completion_context") {
      return { data: await value(db, `select
        public.sellerpilot_service_serverless_cs_completion_context($1,$2,$3) result`, [
        arguments_.p_token_hash, arguments_.p_job_id, arguments_.p_claim_token,
      ]), error: null };
    }
    if (name === "sellerpilot_service_get_temu_buyer_chat_readiness_v1") {
      return { data: await value(db, `select
        public.sellerpilot_service_get_temu_buyer_chat_readiness_v1($1,$2,$3) result`, [
        arguments_.p_token_hash, arguments_.p_job_id, arguments_.p_claim_token,
      ]), error: null };
    }
    throw new Error(`unexpected database RPC ${name}`);
  } catch (error) {
    return { data: null, error };
  } finally {
    await db.exec("reset role");
  }
}

function loadRouteWithDatabase(db, providerFetchCounter) {
  const calls = [];
  const exportsObject = {};
  const sandbox = vm.createContext({
    exports: exportsObject,
    Request,
    Response,
    URL,
    Object,
    fetch: async () => {
      providerFetchCounter.count += 1;
      throw new Error("readiness GET must not fetch a provider");
    },
    require(name) {
      if (name === "zod") return { z };
      if (name === "node:crypto") return { createHash, randomUUID };
      if (name === "next/server") return { NextResponse: Response };
      if (name.endsWith("/admin-api")) return {
        authenticateAdminRequest: async () => ({
          userClient: {
            rpc: async (rpcName, args = {}) => {
              calls.push({ name: rpcName, arguments_: args });
              return roleRpc(db, "authenticated", rpcName, args);
            },
          },
        }),
        isAdminApiError: value_ => value_ instanceof Response,
      };
      if (name.endsWith("/channels/cs/temu/runtime-readiness")) return {
        temuBuyerChatReadinessViewSchema,
        temuBuyerChatRuntimeReadSchema,
        temuCsReadiness,
      };
      if (name.endsWith("/cs/channels/temu/history-resume")) {
        return { temuHistoryAccountsSchema };
      }
      throw new Error(`unexpected route import ${name}`);
    },
  });
  vm.runInContext(transpiledRoute.outputText, sandbox);
  return { GET: exportsObject.GET, POST: exportsObject.POST, calls };
}

function gatewayClaim() {
  return {
    id: jobId,
    claim_token: claimToken,
    credential_id: credentialId,
    channel: "temu",
    operation: "inquiries.list",
    environment: "production",
    request: { arguments: { kind: "buyer_chat" } },
    credential: {
      app_key: "must-not-use",
      app_secret: "must-not-use",
      access_token: "must-not-use",
    },
    attempt_count: 1,
  };
}

test("readiness composes from canonical credential, token, job, binding, account and ACL migrations", async () => {
  assert.match(canonical.credentialTable, /vault_secret_id uuid not null/u);
  assert.match(canonical.workerTable, /created_by uuid not null references auth\.users\(id\)/u);
  assert.match(canonical.gatewayTable, /credential_id uuid not null references sellerpilot_private\.channel_credentials/u);
  assert.match(sources.binding, /verified_job_id uuid not null references sellerpilot_private\.channel_gateway_jobs/u);
  assert.match(canonical.accountList, /seller_account_key_source='provider_certified_v1'/u);
  assert.match(sources.readiness, /token\.id = job\.worker_token_id/u);

  const db = await canonicalFixture();
  try {
    const columns = (await db.query(`select table_name,column_name from information_schema.columns
      where table_schema='sellerpilot_private' and table_name in(
        'channel_credentials','ai_cli_worker_tokens','channel_gateway_jobs',
        'cs_credential_capability_bindings','temu_buyer_chat_readiness_evidence'
      )`)).rows;
    assert.equal(columns.some(row => row.table_name === "channel_gateway_jobs"
      && row.column_name === "claim_token"), true);
    assert.equal(columns.some(row => row.table_name === "ai_cli_worker_tokens"
      && row.column_name === "scope"), true);
    const acl = (await db.query(`select
      has_table_privilege('authenticated','sellerpilot_private.channel_gateway_jobs','SELECT') gateway_read,
      has_table_privilege('authenticated','sellerpilot_private.cs_credential_capability_bindings','SELECT') binding_read,
      has_table_privilege('authenticated','sellerpilot_private.temu_buyer_chat_readiness_evidence','INSERT') evidence_insert,
      has_table_privilege('authenticated','sellerpilot_private.temu_buyer_chat_observation_diagnostics','INSERT') diagnostic_insert,
      has_function_privilege('authenticated','public.sellerpilot_list_temu_cs_accounts_v1()','EXECUTE') account_list,
      has_function_privilege('authenticated','public.sellerpilot_read_temu_buyer_chat_readiness_v1(uuid)','EXECUTE') readiness_read,
      has_function_privilege('authenticated','public.sellerpilot_service_get_temu_buyer_chat_readiness_v1(text,uuid,uuid)','EXECUTE') service_read,
      has_function_privilege('service_role','public.sellerpilot_service_get_temu_buyer_chat_readiness_v1(text,uuid,uuid)','EXECUTE') service_role_read`
    )).rows[0];
    assert.deepEqual(acl, {
      gateway_read: false,
      binding_read: false,
      evidence_insert: false,
      diagnostic_insert: false,
      account_list: true,
      readiness_read: true,
      service_read: false,
      service_role_read: true,
    });
  } finally {
    await db.close();
  }
});

test("authenticated GET uses actual account/readiness RPCs and preserves current external blockers", async () => {
  const db = await canonicalFixture();
  const providerFetchCounter = { count: 0 };
  try {
    await insertEvidence(db);
    const loaded = loadRouteWithDatabase(db, providerFetchCounter);
    const response = await loaded.GET(new Request(
      `https://sellerpilot.invalid/api/admin/cs/channels/temu/buyer-chat-readiness?credentialId=${credentialId}`,
    ));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    const body = await response.json();
    assert.equal(body.ready, false);
    assert.deepEqual(body.blockers, [
      "TEMU_APP_INACTIVE",
      "TEMU_COMPLIANCE_NOT_APPROVED",
      "TEMU_SECURITY_QUESTIONNAIRE_NOT_APPROVED",
      "TEMU_SELLER_AUTHORIZATION_NOT_APPROVED",
      "TEMU_BUYER_CHAT_CONTRACT_UNVERIFIED",
    ]);
    assert.equal(body.credentialId, credentialId);
    assert.equal(body.sellerAccountKey, sellerAccountKey);
    assert.equal(body.providerFetchPerformed, false);
    assert.equal(providerFetchCounter.count, 0);
    assert.deepEqual(loaded.calls.map(call => call.name), [
      "sellerpilot_list_temu_cs_accounts_v1",
      "sellerpilot_read_temu_buyer_chat_readiness_v1",
    ]);
  } finally {
    await db.close();
  }
});

test("actual DB context and evidence hydrate serverless runtime and deny unknown contract before provider fetch", async () => {
  const db = await canonicalFixture();
  const originalFetch = globalThis.fetch;
  let providerFetchCount = 0;
  let claimCount = 0;
  let providerResult;
  const rpcCalls = [];
  globalThis.fetch = async () => {
    providerFetchCount += 1;
    throw new Error("provider fetch must remain closed");
  };
  try {
    await insertEvidence(db, {
      appStatus: "Active",
      complianceStatus: "Approved",
      securityStatus: "Approved",
      sellerStatus: "Approved",
      contractKey: "TEMU.BUYER_CHAT.CANDIDATE",
      contractSha: "b".repeat(64),
      permissionPackage: "BuyerChatCandidate",
      grants: ["BuyerChatCandidate"],
    });
    const context = await roleRpc(db, "service_role",
      "sellerpilot_service_serverless_cs_completion_context", {
        p_token_hash: tokenHash, p_job_id: jobId, p_claim_token: claimToken,
      });
    assert.equal(context.error, null);
    assert.equal(context.data.status, "running");
    assert.equal(context.data.credential_binding_context.status, "verified");
    assert.equal(context.data.credential_binding_context.workerIdentityCompared, false);
    assert.notEqual(admin, owner);
    const hydratedClaim = gatewayClaimSchema.safeParse({
      ...gatewayClaim(),
      credential_binding_context: context.data.credential_binding_context,
    });
    assert.equal(hydratedClaim.success, true,
      hydratedClaim.success ? undefined : JSON.stringify(hydratedClaim.error.issues));

    const response = await runOneServerlessCsGatewayJob({
      staticEgressChannels: ["temu"],
      executeProvider: async input => {
        providerResult = await executeServerlessCsProviderJob(input);
        return providerResult;
      },
      rpc: async (name, arguments_ = {}) => {
        rpcCalls.push({ name, arguments_ });
        if (name === "sellerpilot_claim_serverless_gateway_job") {
          claimCount += 1;
          return { data: claimCount === 1 ? gatewayClaim() : null, error: null };
        }
        if (name === "sellerpilot_service_reserve_provider_rate_budget_v1") {
          return { data: {
            contract: "sellerpilot-provider-rate-budget/1",
            status: "reserved",
            retryAfterSeconds: 0,
          }, error: null };
        }
        if (name === "sellerpilot_touch_serverless_cs_job") {
          return { data: "running", error: null };
        }
        if (name === "sellerpilot_service_serverless_cs_completion_context"
            || name === "sellerpilot_service_get_temu_buyer_chat_readiness_v1") {
          return roleRpc(db, "service_role", name, arguments_);
        }
        if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
          return { data: { status: "completed" }, error: null };
        }
        throw new Error(`unexpected serverless RPC ${name}`);
      },
    }, tokenHash);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "failed");
    assert.equal(providerFetchCount, 0);
    assert.equal(rpcCalls.some(call =>
      call.name === "sellerpilot_service_serverless_cs_completion_context"), true);
    assert.equal(rpcCalls.some(call =>
      call.name === "sellerpilot_service_get_temu_buyer_chat_readiness_v1"), true,
    JSON.stringify(rpcCalls.map(call => call.name)));
    const completion = rpcCalls.find(call =>
      call.name === "sellerpilot_service_complete_serverless_cs_transaction");
    assert.equal(completion.arguments_.p_status, "failed");
    assert.deepEqual(providerResult.steps[0].data.blockers,
      ["TEMU_BUYER_CHAT_CONTRACT_UNKNOWN"]);
    assert.equal(providerResult.steps[0].data.providerFetchPerformed, false);
  } finally {
    globalThis.fetch = originalFetch;
    await db.close();
  }
});

test("service evidence read allows shared admin separation and rejects claim, token, credential and owner drift", async () => {
  const db = await canonicalFixture();
  const read = overrides => roleRpc(db, "service_role",
    "sellerpilot_service_get_temu_buyer_chat_readiness_v1", {
      p_token_hash: tokenHash,
      p_job_id: jobId,
      p_claim_token: claimToken,
      ...overrides,
    });
  try {
    await insertEvidence(db);
    const accepted = await read();
    assert.equal(accepted.error, null);
    assert.equal(accepted.data.credentialId, credentialId);
    assert.notEqual(admin, owner);

    for (const overrides of [
      { p_token_hash: "6".repeat(64) },
      { p_claim_token: "00000000-0000-4000-8000-00000000c999" },
    ]) {
      const denied = await read(overrides);
      assert.match(String(denied.error), /TEMU_BUYER_CHAT_JOB_OWNERSHIP_INVALID/u);
    }

    await db.query("update sellerpilot_private.ai_cli_worker_tokens set expires_at=clock_timestamp()-interval '1 second' where id=$1", [workerTokenId]);
    assert.match(String((await read()).error), /TEMU_BUYER_CHAT_JOB_OWNERSHIP_INVALID/u);
    await db.query("update sellerpilot_private.ai_cli_worker_tokens set expires_at=clock_timestamp()+interval '1 day',status='revoked' where id=$1", [workerTokenId]);
    assert.match(String((await read()).error), /TEMU_BUYER_CHAT_JOB_OWNERSHIP_INVALID/u);
    await db.query("update sellerpilot_private.ai_cli_worker_tokens set status='active' where id=$1", [workerTokenId]);

    await db.query("update sellerpilot_private.channel_credentials set expires_at=clock_timestamp()-interval '1 second' where id=$1", [credentialId]);
    assert.match(String((await read()).error), /TEMU_BUYER_CHAT_ACCOUNT_BINDING_INVALID/u);
    await db.query("update sellerpilot_private.channel_credentials set expires_at=clock_timestamp()+interval '1 day',status='revoked' where id=$1", [credentialId]);
    assert.match(String((await read()).error), /TEMU_BUYER_CHAT_ACCOUNT_BINDING_INVALID/u);
    await db.query("update sellerpilot_private.channel_credentials set status='active' where id=$1", [credentialId]);

    await db.query("update sellerpilot_private.channel_gateway_jobs set created_by=$2 where id=$1", [jobId, wrongOwner]);
    assert.match(String((await read()).error), /TEMU_BUYER_CHAT_ACCOUNT_BINDING_INVALID/u);
    await db.query("update sellerpilot_private.channel_gateway_jobs set created_by=$2,lease_expires_at=clock_timestamp()-interval '1 second' where id=$1", [jobId, owner]);
    assert.match(String((await read()).error), /TEMU_BUYER_CHAT_JOB_OWNERSHIP_INVALID/u);
  } finally {
    await db.close();
  }
});

test("evidence remains immutable and after-sales still uses only its official list operation", async () => {
  const db = await canonicalFixture();
  const originalFetch = globalThis.fetch;
  const requestTypes = [];
  try {
    await insertEvidence(db);
    await assert.rejects(db.query(`update sellerpilot_private.temu_buyer_chat_readiness_evidence
      set source_revision=2 where credential_id=$1`, [credentialId]),
    /TEMU_BUYER_CHAT_EVIDENCE_IMMUTABLE/u);
    await assert.rejects(db.query(`insert into sellerpilot_private.temu_buyer_chat_readiness_evidence(
      owner_id,credential_id,environment,seller_account_key,region,source_kind,
      source_revision,source_revision_sha256,observed_at,expires_at,app_status,
      compliance_status,security_questionnaire_status,seller_authorization_status,
      granted_permission_packages
    ) values($1,$2,'production',$3,'GLOBAL','partner_center_authenticated_readback',2,$4,
      clock_timestamp(),clock_timestamp()+interval '16 minutes','Active','Approved',
      'Approved','Approved','[]')`, [owner, credentialId, sellerAccountKey, "d".repeat(64)]),
    /check constraint/iu);

    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      requestTypes.push(String(body.type));
      return Response.json({ success: true, result: { data: [], total: 0, pageNumber: 1 } });
    };
    const afterSales = await executeCsOperation({
      channel: "temu",
      operation: "inquiries.list",
      payload: { app_key: "app", app_secret: "secret", access_token: "token" },
      arguments: {
        kind: "after_sales",
        includeDetails: true,
        pageNo: 1,
        pageSize: 200,
        updateAtStart: 1_787_000_000,
        updateAtEnd: 1_788_000_000,
      },
      environment: "production",
    });
    assert.equal(afterSales.ok, true);
    assert.deepEqual(requestTypes, ["bg.aftersales.parentaftersales.list.get"]);
  } finally {
    globalThis.fetch = originalFetch;
    await db.close();
  }
});

test("non-admin authenticated caller cannot use the canonical readiness reader", async () => {
  const db = await canonicalFixture();
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [outsider]);
    const denied = await roleRpc(db, "authenticated",
      "sellerpilot_read_temu_buyer_chat_readiness_v1", { p_credential_id: credentialId });
    assert.match(String(denied.error), /administrator required/u);
  } finally {
    await db.close();
  }
});

function diagnosticRequestBody(overrides = {}) {
  return {
    credentialId,
    clientObservationId: "00000000-0000-4000-8000-00000000ca01",
    expectedRevision: 1,
    observedAt: new Date().toISOString(),
    claimedAppStatus: "Active",
    claimedComplianceStatus: "Approved",
    claimedSecurityQuestionnaireStatus: "Approved",
    claimedSellerAuthorizationStatus: "Approved",
    ...overrides,
  };
}

function postDiagnostic(loaded, body) {
  return loaded.POST(new Request(
    "https://sellerpilot.invalid/api/admin/cs/channels/temu/buyer-chat-readiness",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  ));
}

test("authenticated observation ingestion is immutable canonical diagnostic and never trusted readiness", async () => {
  const db = await canonicalFixture();
  const providerFetchCounter = { count: 0 };
  try {
    const loaded = loadRouteWithDatabase(db, providerFetchCounter);
    const response = await postDiagnostic(loaded, diagnosticRequestBody());
    assert.equal(response.status, 201);
    const receipt = await response.json();
    assert.equal(receipt.verificationState, "unverified");
    assert.equal(receipt.trustedReadinessEvidenceCreated, false);
    assert.equal(receipt.providerAuthenticatedSourceVerified, false);
    assert.equal(receipt.providerFetchPerformed, false);
    assert.match(receipt.artifactSha256, /^[a-f0-9]{64}$/u);

    const diagnostic = (await db.query(`select owner_id,credential_id,environment,
      seller_account_key,region,source_kind,verification_state,source_actor_id,
      source_revision,diagnostic_reason from
      sellerpilot_private.temu_buyer_chat_observation_diagnostics`)).rows[0];
    assert.deepEqual(diagnostic, {
      owner_id: owner,
      credential_id: credentialId,
      environment: "production",
      seller_account_key: sellerAccountKey,
      region: "GLOBAL",
      source_kind: "authenticated_admin_diagnostic",
      verification_state: "unverified",
      source_actor_id: admin,
      source_revision: 1,
      diagnostic_reason: "PROVIDER_AUTHENTICATED_SOURCE_UNVERIFIED",
    });
    assert.equal(await value(db,
      "select count(*)::int from sellerpilot_private.temu_buyer_chat_readiness_evidence"), 0);

    const readiness = await loaded.GET(new Request(
      `https://sellerpilot.invalid/api/admin/cs/channels/temu/buyer-chat-readiness?credentialId=${credentialId}`,
    ));
    assert.equal(readiness.status, 200);
    assert.deepEqual((await readiness.json()).blockers,
      ["TEMU_BUYER_CHAT_EVIDENCE_UNAVAILABLE"]);
    assert.equal(providerFetchCounter.count, 0);

    await assert.rejects(db.query(`update
      sellerpilot_private.temu_buyer_chat_observation_diagnostics
      set verification_state='unverified' where credential_id=$1`, [credentialId]),
    /TEMU_BUYER_CHAT_OBSERVATION_IMMUTABLE/u);
  } finally {
    await db.close();
  }
});

test("observation writer rejects account drift, revision drift, expiry, replay and malicious trust claims", async () => {
  const db = await canonicalFixture();
  const providerFetchCounter = { count: 0 };
  try {
    const loaded = loadRouteWithDatabase(db, providerFetchCounter);
    const malicious = await postDiagnostic(loaded, {
      ...diagnosticRequestBody(),
      verificationState: "provider_authenticated",
      trustedReadinessEvidenceCreated: true,
      contractKey: "INVENTED.BUYER.CHAT",
      grantedPermissionPackages: ["BuyerChat"],
    });
    assert.equal(malicious.status, 400);
    assert.equal(loaded.calls.length, 0);

    for (const body of [
      diagnosticRequestBody({ credentialId: secondaryCredentialId }),
      diagnosticRequestBody({ expectedRevision: 2 }),
      diagnosticRequestBody({ observedAt: new Date(Date.now() - 16 * 60_000).toISOString() }),
    ]) {
      const denied = await postDiagnostic(loaded, body);
      assert.equal(denied.status, 409);
      assert.equal((await denied.json()).trustedReadinessEvidenceCreated, false);
    }

    assert.equal((await postDiagnostic(loaded, diagnosticRequestBody())).status, 201);
    const replay = await postDiagnostic(loaded, diagnosticRequestBody({ expectedRevision: 2 }));
    assert.equal(replay.status, 409);
    assert.equal(await value(db, `select count(*)::int from
      sellerpilot_private.temu_buyer_chat_observation_diagnostics`), 1);
    assert.equal(await value(db, `select count(*)::int from
      sellerpilot_private.temu_buyer_chat_readiness_evidence`), 0);
    assert.equal(providerFetchCounter.count, 0);
  } finally {
    await db.close();
  }
});

test("unverified diagnostic leaves runtime blocked before provider fetch", async () => {
  const db = await canonicalFixture();
  const originalFetch = globalThis.fetch;
  let providerFetchCount = 0;
  let claimCount = 0;
  let providerResult;
  try {
    const loaded = loadRouteWithDatabase(db, { count: 0 });
    assert.equal((await postDiagnostic(loaded, diagnosticRequestBody())).status, 201);
    globalThis.fetch = async () => {
      providerFetchCount += 1;
      throw new Error("provider fetch must remain closed");
    };
    const response = await runOneServerlessCsGatewayJob({
      staticEgressChannels: ["temu"],
      executeProvider: async input => {
        providerResult = await executeServerlessCsProviderJob(input);
        return providerResult;
      },
      rpc: async (name, arguments_ = {}) => {
        if (name === "sellerpilot_claim_serverless_gateway_job") {
          claimCount += 1;
          return { data: claimCount === 1 ? gatewayClaim() : null, error: null };
        }
        if (name === "sellerpilot_service_reserve_provider_rate_budget_v1") {
          return { data: { contract: "sellerpilot-provider-rate-budget/1",
            status: "reserved", retryAfterSeconds: 0 }, error: null };
        }
        if (name === "sellerpilot_touch_serverless_cs_job") {
          return { data: "running", error: null };
        }
        if (name === "sellerpilot_service_serverless_cs_completion_context"
            || name === "sellerpilot_service_get_temu_buyer_chat_readiness_v1") {
          return roleRpc(db, "service_role", name, arguments_);
        }
        if (name === "sellerpilot_service_complete_serverless_cs_transaction") {
          return { data: { status: "completed" }, error: null };
        }
        throw new Error(`unexpected serverless RPC ${name}`);
      },
    }, tokenHash);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "failed");
    assert.equal(providerFetchCount, 0);
    assert.deepEqual(providerResult.steps[0].data.blockers,
      ["TEMU_BUYER_CHAT_EVIDENCE_UNAVAILABLE"]);
    assert.equal(providerResult.steps[0].data.providerFetchPerformed, false);
  } finally {
    globalThis.fetch = originalFetch;
    await db.close();
  }
});
