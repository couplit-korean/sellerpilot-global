// Incident-only operator command. Default: read-only, no token request.
// Execute only after reviewing/applying the companion migration:
// node --import tsx scripts/ebay-exact-listing-read-refresh.mjs --execute
// SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) uses the existing secure runtime.
// Never print credentials, SQL containing credentials, HTTP bodies or GetUser PII.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const sourceCredentialId = "8e43e9e0-2674-41a2-8a62-905afad415c0";
const project = "sqaoqucxakebqkiygdxb";
const sourceSql = `select c.id,c.version,c.status,c.created_by,c.channel,c.environment,
 c.seller_account_key_source,c.seller_account_verified_at is not null as identity_verified,
 d.decrypted_secret::jsonb as payload
 from sellerpilot_private.channel_credentials c join vault.decrypted_secrets d on d.id=c.vault_secret_id
 where c.id='${sourceCredentialId}'`;

export function validateSource(source, now = Date.now()) {
  if (!source || source.id !== sourceCredentialId || source.version !== 209 || source.status !== "active"
      || source.created_by !== "21eb1892-0894-4f9f-b414-4c9464182dd6"
      || source.channel !== "ebay" || source.environment !== "production"
      || source.seller_account_key_source !== "provider_certified_v1" || source.identity_verified !== true) {
    throw new Error("EBAY_EXACT_READ_REFRESH_SOURCE_DRIFT");
  }
  const p = source.payload;
  if (!p || !["access_token", "refresh_token", "client_id", "client_secret", "ru_name", "scopes"].every(k => typeof p[k] === "string" && p[k].trim())
      || p.provider_account_identity_version !== "v1" || !p.provider_account_subject?.startsWith("ebay:eias:")
      || !Number.isFinite(Date.parse(p.refresh_token_expires_at)) || Date.parse(p.refresh_token_expires_at) <= now
      || !Number.isFinite(Date.parse(p.access_token_expires_at)) || Date.parse(p.access_token_expires_at) > now) {
    throw new Error("EBAY_EXACT_READ_REFRESH_SOURCE_TOKEN_STATE_INVALID");
  }
  return p;
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.some(a => a !== "--execute") || argv.length > 1) throw new Error("EBAY_EXACT_READ_REFRESH_ARGUMENTS_INVALID");
  const execute = argv.includes("--execute");
  let managementToken = execFileSync("security", ["find-generic-password", "-s", "Supabase CLI", "-a", "supabase", "-w"], {encoding:"utf8", stdio:["ignore","pipe","pipe"]}).trim();
  if (managementToken.startsWith("go-keyring-base64:")) managementToken = Buffer.from(managementToken.slice(18), "base64").toString("utf8");
  const query = async sql => {
    const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
      method:"POST", headers:{authorization:`Bearer ${managementToken}`,"content-type":"application/json"},
      body:JSON.stringify({query:sql}), signal:AbortSignal.timeout(30_000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`EBAY_EXACT_MANAGEMENT_HTTP_${response.status}`); }
    return response.json();
  };
  const preflight = (await query(`select
    exists(select 1 from sellerpilot_private.channel_credentials where id='${sourceCredentialId}' and version=209 and status='active') as source_current,
    to_regprocedure('public.sellerpilot_service_store_ebay_exact_listing_refresh(uuid,jsonb,timestamptz)') is not null as rpc_installed,
    (select count(*) from sellerpilot_private.channel_gateway_jobs where channel='ebay' and environment='production' and status='running') as running,
    (select count(*) from sellerpilot_private.channel_gateway_jobs where id in ('d49fcf37-32b6-41f5-a822-0f9bc99b51de','1654d17e-2ef7-421d-b90f-6bf0e536e626') and status='queued' and attempt_count=0 and credential_id='${sourceCredentialId}') as exact_queued`))[0];
  if (preflight?.source_current !== true || Number(preflight.running) !== 0 || Number(preflight.exact_queued) !== 2) throw new Error("EBAY_EXACT_READ_REFRESH_PREFLIGHT_DRIFT");
  if (!execute) { console.log(JSON.stringify({mode:"read-only",...preflight})); return; }
  if (preflight.rpc_installed !== true) throw new Error("EBAY_EXACT_READ_REFRESH_RPC_NOT_INSTALLED");
  const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey?.trim()) throw new Error("EBAY_EXACT_READ_REFRESH_SERVICE_KEY_REQUIRED");
  const source = (await query(sourceSql))[0];
  const payload = validateSource(source);
  const {ensureEbayAccessToken} = await import("../lib/channels/protocols.ts");
  const {ebayOAuthScopes} = await import("../lib/channels/ebay-oauth-scopes.ts");
  const granted = new Set(payload.scopes.trim().split(/\s+/));
  if (ebayOAuthScopes(payload).some(scope => !granted.has(scope))) throw new Error("EBAY_EXACT_READ_REFRESH_SCOPE_EXPANSION_BLOCKED");
  // Official eBay refresh tokens remain reusable. This is NOT a new consent or
  // authorization-code exchange. ensure requires GetUser to match stored EIAS.
  const refreshed = await ensureEbayAccessToken(payload,"production",undefined,undefined,undefined,true);
  if (!refreshed.refreshed || refreshed.payload.refresh_token !== payload.refresh_token
      || refreshed.payload.provider_account_subject !== payload.provider_account_subject) throw new Error("EBAY_EXACT_READ_REFRESH_PROVIDER_PROOF_INVALID");
  const verifiedAt = new Date().toISOString();
  const response = await fetch(`https://${project}.supabase.co/rest/v1/rpc/sellerpilot_service_store_ebay_exact_listing_refresh`, {
    method:"POST", headers:{apikey:serviceKey,authorization:`Bearer ${serviceKey}`,"content-type":"application/json"},
    body:JSON.stringify({p_source_credential_id:sourceCredentialId,p_secret_payload:refreshed.payload,p_provider_verified_at:verifiedAt}),
    signal:AbortSignal.timeout(45_000),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`EBAY_EXACT_READ_REFRESH_STORE_HTTP_${response.status}_CHECK_LEDGER_BEFORE_RETRY`); }
  const result = await response.json();
  if (result?.version !== 210 || result?.forcedProviderJobsStarted !== 0
      || !Number.isInteger(result?.automaticQueuedCredentialRebinds)
      || !/^[0-9a-f-]{36}$/.test(result?.credentialId ?? "")) throw new Error("EBAY_EXACT_READ_REFRESH_STORE_READBACK_INVALID");
  console.log(JSON.stringify({mode:"executed",...result}));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Provider helpers can include response details. Only our static codes leave
    // the process; all other errors are classified without exposing raw bodies.
    const message = error instanceof Error ? error.message : "";
    console.error(/^EBAY_EXACT_[A-Z0-9_]+$/.test(message) ? message : "EBAY_EXACT_READ_REFRESH_FAILED_NO_SECRET_OUTPUT");
    process.exitCode=1;
  });
}
