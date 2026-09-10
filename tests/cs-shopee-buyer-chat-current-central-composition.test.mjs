import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = relativePath => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
const [credentialBase, shopeeConnector, accountBinding, proposal, historyUi, capabilityInventory,
  buyerChatContract, ingestEntitlement, ingestRoute] = await Promise.all([
  read("supabase/migrations/20260816060000_channel_credentials_and_roles.sql"),
  read("supabase/migrations/20260816133601_add_shopee_connector.sql"),
  read("supabase/migrations/20260825111800_bind_listing_seller_accounts.sql"),
  read("supabase/migrations/20260909165247_cs_shopee_buyer_chat_read_ledger.sql"),
  read("app/cs/channels/shopee/history-progress.tsx"),
  read("lib/cs/capability-inventory.ts"),
  read("lib/cs/channels/shopee/buyer-chat-contract.ts"),
  read("supabase/migrations/20260909185400_cs_shopee_buyer_chat_ingest_entitlement.sql"),
  read("app/api/channel-gateway/worker/shopee-buyer-chat/ingest/route.ts"),
]);

test("R04 proposal composes against the actual credential, admin and Shopee migration lineage", () => {
  assert.match(credentialBase, /create table if not exists sellerpilot_private\.admin_users/u);
  assert.match(credentialBase, /create table if not exists sellerpilot_private\.channel_credentials/u);
  assert.match(credentialBase, /create or replace function public\.sellerpilot_is_admin\(\)/u);
  assert.match(shopeeConnector, /'shopee'/u);
  assert.match(accountBinding, /seller_account_key_source text/u);
  assert.match(accountBinding, /seller_account_verified_at timestamptz/u);
  assert.match(accountBinding, /alter column seller_account_key_source set not null/u);
  assert.match(accountBinding,
    /seller_account_key_source in \('provider_certified_v1', 'credential_incarnation_v1'\)/u);

  assert.match(proposal, /credential\.seller_account_key_source='provider_certified_v1'/u);
  assert.match(proposal,
    /credential\.seller_account_verified_at=capability\.credential_seller_account_verified_at/u);
  assert.match(proposal,
    /credential\.seller_account_verified_at=v_capability\.credential_seller_account_verified_at/u);
  assert.match(proposal, /public\.sellerpilot_is_admin\(\) is distinct from true/u);
  assert.match(proposal,
    /revoke all on function public\.sellerpilot_read_cs_shopee_buyer_chat_v1[\s\S]*from public,anon,service_role;[\s\S]*grant execute[\s\S]*to authenticated;/u);
  assert.doesNotMatch(proposal,
    /grant execute on function public\.sellerpilot_service_ingest_cs_shopee_buyer_chat_v1\(uuid,uuid,jsonb\)\s+to authenticated/u);
});

test("current-central accepted R01 state and R04 permission-pending inventory survive composition", () => {
  assert.match(historyUi, /JSON\.stringify\(\[historyRunId, scopeKey\]\)/u);
  assert.match(historyUi, /if \(abort\.signal\.aborted\) return;/u);
  assert.match(historyUi, /<ShopeeBuyerChatStatus authenticatedFetch=\{authenticatedFetch\}/u);
  for (const key of ["buyer_chat_push", "buyer_chat_history", "buyer_chat_reply"]) {
    assert.match(capabilityInventory, new RegExp(`key:"${key}"[^\\n]+state:"permission_pending"`, "u"));
  }
  assert.match(capabilityInventory, /endpoint·pagination·raw envelope를 추측하지 않음/u);
});

test("the API page bound and UI accumulation bound are intentionally separate", () => {
  assert.match(buyerChatContract,
    /messages: z\.array\(shopeeBuyerChatMessageSchema\)\.max\(100\)/u);
  assert.match(buyerChatContract, /SHOPEE_BUYER_CHAT_UI_MESSAGE_LIMIT = 500/u);
  assert.match(buyerChatContract, /messages: mergedMessages\.slice\(-SHOPEE_BUYER_CHAT_UI_MESSAGE_LIMIT\)/u);
  assert.match(buyerChatContract, /memoryLimitReached/u);
});

test("CONNECT-01 preserves the canonical ledger and adds only a service-authorized extension", () => {
  assert.equal(createHash("sha256").update(proposal).digest("hex"),
    "d6e984b26fd4f2e052edaadd1579ef18fa3c9fd6eef9fd623ab094baaba4350a");
  assert.match(ingestEntitlement, /Apply after 20260909165247_cs_shopee_buyer_chat_read_ledger[.]sql/u);
  assert.match(ingestEntitlement, /cs_shopee_buyer_chat_ingest_entitlements/u);
  assert.match(ingestEntitlement, /state in \('approved','revoked'\)/u);
  assert.match(ingestEntitlement, /expires_at>statement_timestamp\(\)/u);
  assert.match(ingestEntitlement,
    /v_ingest:=public[.]sellerpilot_service_ingest_cs_shopee_buyer_chat_v1/u);
  assert.match(ingestEntitlement, /committed_cursor=v_next_cursor/u);
  assert.match(ingestEntitlement,
    /grant execute on function public[.]sellerpilot_service_ingest_cs_shopee_buyer_chat_authorized_v1[\s\S]*to service_role/u);
  assert.doesNotMatch(ingestEntitlement,
    /grant execute on function public[.]sellerpilot_service_ingest_cs_shopee_buyer_chat_authorized_v1[\s\S]*to authenticated/u);
  assert.match(ingestRoute, /sellerpilot_service_validate_worker_token/u);
  assert.doesNotMatch(ingestRoute, /open[.]shopee|fetch\(/u);
});
