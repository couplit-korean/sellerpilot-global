import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  readEbayAccountReadinessGetOnly,
  readEbaySelectedPoliciesGetOnly,
} from "../lib/channels/ebay-account-readiness-get-only.ts";
import {
  ebayCookieCategoryId,
  readEbayTaxonomyPolicyGetOnly,
} from "../lib/channels/ebay-taxonomy-policy-get-only.ts";
import {
  exchangeEbayOAuthToken,
  ebayRequest,
  fetchEbayTradingUserIdentity,
  runWithProviderReadOnlyTransport,
} from "../lib/channels/protocols.ts";
import { readProviderAccountIdentity } from "../lib/channels/provider-account-identity.ts";
import { ebayCreateLineageDecision } from "../lib/channels/ebay-create-preflight.ts";

const PROJECT_REF = "sqaoqucxakebqkiygdxb";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const REQUIRED_SCOPES = [
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
];
const categoryId = String(process.env.EBAY_CATEGORY_ID ?? ebayCookieCategoryId).trim();
const targetSku = String(process.env.EBAY_TARGET_SKU ?? "");

function keychainSecret(service, account) {
  try {
    return execFileSync("security", ["find-generic-password", "-s", service, "-a", account, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function textField(value, key) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const field = value[key];
  return typeof field === "string" ? field.trim() : "";
}

function containsAsciiControl(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function normalizedScopes(value) {
  const values = typeof value === "string"
    ? value.split(/\s+/u)
    : Array.isArray(value)
      ? value
      : [];
  return [...new Set(values.filter((scope) =>
    typeof scope === "string"
      && /^https:\/\/api\.ebay\.com\/oauth\/api_scope(?:\/[a-z.]+)?$/u.test(scope)))]
    .sort();
}

function aspectSummary(value) {
  if (!value) return null;
  return {
    name: value.name,
    required: value.required,
    usage: value.usage,
    mode: value.mode,
    cardinality: value.cardinality,
    valueCount: value.valueCount,
    valuesSample: value.valuesSample,
  };
}

function taxonomySummary(taxonomy) {
  return {
    marketplaceId: taxonomy.marketplaceId,
    categoryId: taxonomy.categoryId,
    categoryTreeId: taxonomy.categoryTreeId,
    treeHttpStatus: taxonomy.treeHttpStatus,
    aspectsHttpStatus: taxonomy.aspectsHttpStatus,
    aspectsShapeVerified: taxonomy.aspectsShapeVerified,
    aspectCount: taxonomy.aspectCount,
    requiredAspectNames: taxonomy.requiredAspectNames,
    upcomingRequiredAspectNames: taxonomy.upcomingRequiredAspectNames,
    brandAspect: aspectSummary(taxonomy.brandAspect),
    productAspect: aspectSummary(taxonomy.productAspect),
    conditionPolicyHttpStatus: taxonomy.conditionPolicyHttpStatus,
    conditionPolicyCategoryTreeId: taxonomy.conditionPolicyCategoryTreeId,
    conditionRequired: taxonomy.conditionRequired,
    conditionIds: taxonomy.conditionIds,
    fulfillmentPolicy: taxonomy.fulfillmentPolicy,
    paymentPolicy: taxonomy.paymentPolicy,
    returnPolicy: taxonomy.returnPolicy,
    returnPolicyDetails: taxonomy.returnPolicyDetails,
    unverifiedReason: taxonomy.unverifiedReason ?? null,
  };
}

async function readTargetLineageGetOnly(payload, marketplaceId, sku) {
  if (!sku) return null;
  if (sku !== sku.trim() || sku.length > 50 || containsAsciiControl(sku)) {
    throw new Error("EBAY_TARGET_SKU_INVALID");
  }
  const [inventory, offers] = await runWithProviderReadOnlyTransport(() => Promise.all([
    ebayRequest({
      payload,
      environment: "production",
      method: "GET",
      path: `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    }),
    ebayRequest({
      payload,
      environment: "production",
      method: "GET",
      path: "/sell/inventory/v1/offer",
      query: new URLSearchParams({ sku, marketplace_id: marketplaceId, limit: "200" }),
    }),
  ]));
  const decision = ebayCreateLineageDecision({
    inventory,
    offers,
    sku,
    marketplaceId,
    format: "FIXED_PRICE",
  });
  const safeErrors = (value) => Array.isArray(value)
    ? value.slice(0, 5).flatMap((candidate) =>
        candidate && typeof candidate === "object" && !Array.isArray(candidate)
          ? [{
              errorId: Number.isSafeInteger(candidate.errorId) ? candidate.errorId : null,
              domain: textField(candidate, "domain") || null,
              category: textField(candidate, "category") || null,
              message: textField(candidate, "message").slice(0, 300) || null,
            }]
          : [])
    : [];
  const rows = Array.isArray(offers.data.offers) ? offers.data.offers : [];
  return {
    sku,
    inventoryHttpStatus: inventory.response.status,
    inventorySku: textField(inventory.data, "sku") || null,
    inventoryTitle: textField(inventory.data.product, "title") || null,
    inventoryErrors: safeErrors(inventory.data.errors),
    offersHttpStatus: offers.response.status,
    offersTotal: Number.isSafeInteger(offers.data.total) ? offers.data.total : null,
    offersErrors: safeErrors(offers.data.errors),
    offers: rows.flatMap((value) => value && typeof value === "object" && !Array.isArray(value)
      ? [{
          offerId: textField(value, "offerId") || null,
          listingId: textField(value, "listingId") || null,
          status: textField(value, "status") || null,
          marketplaceId: textField(value, "marketplaceId") || null,
          format: textField(value, "format") || null,
        }]
      : []),
    decision,
  };
}

async function serviceRoleFromSupabaseManagement(accessToken) {
  if (!accessToken) return "";
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!response.ok) return "";
  const keys = await response.json().catch(() => null);
  if (!Array.isArray(keys)) return "";
  const service = keys.find((item) => item && (item.name === "service_role" || item.id === "service_role"));
  return textField(service, "api_key");
}

async function vaultedEbayPayload(serviceRoleKey, accessToken) {
  if (!serviceRoleKey || !accessToken) return { error: "EBAY_VAULT_UNAVAILABLE" };
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: "select id::text as id, channel, status, environment from sellerpilot_private.channel_credentials where channel = 'ebay' and status = 'active' and environment = 'production'",
    }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!response.ok) return { error: `EBAY_VAULT_METADATA_UNREADABLE:HTTP_${response.status}` };
  const rows = await response.json().catch(() => null);
  const list = Array.isArray(rows) ? rows : Array.isArray(rows?.data) ? rows.data : [];
  const matches = list.filter((row) => row && row.channel === "ebay" && row.status === "active");
  if (matches.length !== 1 || !textField(matches[0], "id")) {
    return { error: "EBAY_VAULT_ACTIVE_CREDENTIAL_NOT_UNIQUE" };
  }
  const service = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const credentialId = textField(matches[0], "id");
  const decrypted = await service.rpc("sellerpilot_decrypt_credential", { p_credential_id: credentialId });
  if (decrypted.error || !decrypted.data || typeof decrypted.data !== "object" || Array.isArray(decrypted.data)) {
    return { error: "EBAY_VAULT_DECRYPT_FAILED" };
  }
  return { credentialId, payload: decrypted.data };
}

async function refreshApprovedTokenInMemory(payload, recordedScopes) {
  const clientId = textField(payload, "client_id");
  const clientSecret = textField(payload, "client_secret");
  const refreshToken = textField(payload, "refresh_token");
  if (!clientId || !clientSecret || !refreshToken) {
    return { error: "EBAY_APPROVED_REFRESH_CREDENTIALS_MISSING" };
  }
  const remote = await exchangeEbayOAuthToken({
    environment: "production",
    clientId,
    clientSecret,
    ruName: textField(payload, "ru_name"),
    refreshToken,
    // Preserve the recorded approved grant exactly. Never request a default or
    // newly expanded scope from this operational readiness probe.
    scopes: recordedScopes,
  });
  const accessToken = textField(remote.data, "access_token");
  if (!remote.response.ok || !accessToken) {
    return { error: `EBAY_APPROVED_REFRESH_FAILED:HTTP_${remote.response.status}` };
  }
  return {
    payload: { ...payload, access_token: accessToken },
    providerReturnedScopes: normalizedScopes(remote.data.scope),
  };
}

if (!/^[1-9]\d{0,9}$/u.test(categoryId)) {
  console.log(JSON.stringify({ contract: "ebay_approved_oauth_readiness_v1", blocked: "EBAY_CATEGORY_ID_INVALID" }));
  process.exit(2);
}

let payload = null;
try {
  const managementToken = keychainSecret("Supabase CLI", "supabase");
  const envServiceRole = String(process.env.SUPABASE_SECRET_KEY ?? "").trim();
  const serviceRole = envServiceRole || await serviceRoleFromSupabaseManagement(managementToken);
  const vault = await vaultedEbayPayload(serviceRole, managementToken);
  if (!vault.payload) {
    console.log(JSON.stringify({
      contract: "ebay_approved_oauth_readiness_v1",
      blocked: vault.error || "EBAY_CREDENTIALS_UNAVAILABLE_WITHOUT_EXPOSURE",
    }));
    process.exit(2);
  }
  payload = vault.payload;
  const marketplaceId = textField(payload, "marketplace_id").toUpperCase() || "EBAY_US";
  const recordedScopes = normalizedScopes(payload.scopes);
  const missingRequiredScopes = REQUIRED_SCOPES.filter((scope) => !recordedScopes.includes(scope));
  if (marketplaceId !== "EBAY_US" || missingRequiredScopes.length) {
    console.log(JSON.stringify({
      contract: "ebay_approved_oauth_readiness_v1",
      credentialId: vault.credentialId,
      marketplaceId,
      recordedScopes,
      missingRequiredScopes,
      blocked: marketplaceId !== "EBAY_US"
        ? "EBAY_US_MARKETPLACE_REQUIRED"
        : "EBAY_REQUIRED_RECORDED_SCOPE_MISSING",
    }));
    process.exit(2);
  }

  let oauthRefreshPerformed = false;
  let account = await readEbayAccountReadinessGetOnly({ payload, marketplaceId });
  let providerReturnedScopes = [];
  if (account.privilege.httpStatus === 401 || account.inventoryLocations.httpStatus === 401) {
    const refreshed = await refreshApprovedTokenInMemory(payload, recordedScopes);
    if (!refreshed.payload) {
      console.log(JSON.stringify({
        contract: "ebay_approved_oauth_readiness_v1",
        credentialId: vault.credentialId,
        marketplaceId,
        recordedScopes,
        oauthRefreshPerformed: false,
        blocked: refreshed.error,
      }));
      process.exit(2);
    }
    payload = refreshed.payload;
    providerReturnedScopes = refreshed.providerReturnedScopes;
    oauthRefreshPerformed = true;
    account = await readEbayAccountReadinessGetOnly({ payload, marketplaceId });
  }

  const [providerIdentity, taxonomy] = await Promise.all([
    runWithProviderReadOnlyTransport(() => fetchEbayTradingUserIdentity({
      environment: "production",
      accessToken: textField(payload, "access_token"),
    })),
    readEbayTaxonomyPolicyGetOnly({
      payload,
      categoryId,
      marketplaceId,
      environment: "production",
    }),
  ]);
  const storedIdentity = readProviderAccountIdentity(payload, "ebay");
  const selectedPolicyDetails = taxonomy.fulfillmentPolicy.exactId
      && taxonomy.paymentPolicy.exactId
    ? await readEbaySelectedPoliciesGetOnly({
        payload,
        marketplaceId,
        fulfillmentPolicyId: taxonomy.fulfillmentPolicy.exactId,
        paymentPolicyId: taxonomy.paymentPolicy.exactId,
      })
    : null;
  const targetLineage = await readTargetLineageGetOnly(payload, marketplaceId, targetSku);
  console.log(JSON.stringify({
    contract: "ebay_approved_oauth_readiness_v1",
    checkedAt: new Date().toISOString(),
    credentialId: vault.credentialId,
    marketplaceId,
    recordedScopes,
    providerReturnedScopes,
    requiredScopesVerified: missingRequiredScopes.length === 0,
    oauthRefreshPerformed,
    oauthRefreshPersisted: false,
    sellerUserId: providerIdentity.userId || null,
    storedIdentityPresent: Boolean(storedIdentity),
    storedIdentityMatchesRemote: Boolean(storedIdentity)
      && storedIdentity.subject === providerIdentity.identity.subject,
    account,
    taxonomy: taxonomySummary(taxonomy),
    selectedPolicyDetails,
    targetLineage,
    providerListingWrites: 0,
    databaseWrites: 0,
  }));
} catch (error) {
  const reason = error instanceof Error && /^[A-Z0-9_.:-]{1,120}$/iu.test(error.message)
    ? error.message
    : "EBAY_APPROVED_OAUTH_READINESS_FAILED";
  console.log(JSON.stringify({ contract: "ebay_approved_oauth_readiness_v1", blocked: reason }));
  process.exitCode = 2;
} finally {
  if (payload) {
    payload.access_token = "";
    payload.refresh_token = "";
    payload.client_secret = "";
  }
}
