// Product-specific one-day handling change for the already published Narangd
// eBay listing. Default mode performs provider GETs only. --execute can create
// one uniquely named fulfillment policy and update only the existing Offer's
// fulfillmentPolicyId. It never publishes, creates an Offer, refreshes OAuth,
// or writes SellerPilot database state.
//
// node scripts/ebay-narangd-one-day-fulfillment-policy.mjs
// node scripts/ebay-narangd-one-day-fulfillment-policy.mjs --execute
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const target = Object.freeze({
  projectRef: "sqaoqucxakebqkiygdxb",
  productId: "c0bdb493-6447-41bf-af0a-46a3da7a75a8",
  productSku: "AUTO-00BF58A2E8434FF09667",
  localListingId: "b66bdb38-a9e2-4883-a147-5122659eec88",
  sourceJobId: "81f79abf-ed3f-44cd-a445-fe76e2dcba65",
  sourceAttemptId: "51ccc22f-36d3-4032-9125-d712cdb59f46",
  credentialId: "374cd5d4-89dc-402b-bed4-067d4dbbe836",
  offerId: "265437447011",
  listingId: "800659240462",
  sku: "AUTO-00BF58A2E8434FF09667-US",
  marketplaceId: "EBAY_US",
  sourcePolicyId: "287802829015",
  policyName: "SellerPilot-Narangd-1Day-800659240462",
  policyDescription: "Product-specific 1-day handling policy for eBay listing 800659240462; shipping services copied from policy 287802829015.",
  expectedOfferDigest: "a59a00b6432e0be14d23dfb0829850f060491f85e1bf97f65705b3dfc08efe4b",
  expectedSourcePolicyDigest: "96d7c3433aa5982d782719aa5778c39af46b9d5a0373b94f7e757932dbafb17c",
  repairReceiptDigest: "2267faf785338ba10317e11565076cbe347cebb324d44ceb3cde272de5421fb8",
});

const evidenceDirectory = join(homedir(), "Library/Application Support/SellerPilot/private-evidence");
const evidenceNames = Object.freeze({
  policy: "ebay-narangd-offer-265437447011-one-day-policy.json",
  complete: "ebay-narangd-offer-265437447011-one-day-complete.json",
  failure: "ebay-narangd-offer-265437447011-one-day-failure.json",
});
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const textValue = (value) => typeof value === "string" ? value.trim() : "";
const canonical = (value) => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
    : item);
const digest = (value) => createHash("sha256").update(canonical(value)).digest("hex");
const fail = (code) => { throw new Error(code); };
const clone = (value) => structuredClone(value);

function optional(targetObject, key, value) {
  if (value !== undefined) targetObject[key] = value;
}

function money(value) {
  const row = record(value);
  return { value: textValue(row.value), currency: textValue(row.currency) };
}

function shipToLocations(value) {
  const row = record(value);
  const result = {};
  if (Array.isArray(row.regionIncluded)) result.regionIncluded = row.regionIncluded.map((entry) => ({
    regionName: textValue(record(entry).regionName),
  }));
  if (Array.isArray(row.regionExcluded)) result.regionExcluded = row.regionExcluded.map((entry) => {
    const source = record(entry);
    const item = { regionName: textValue(source.regionName) };
    optional(item, "regionType", source.regionType === undefined ? undefined : textValue(source.regionType));
    return item;
  });
  return Object.keys(result).length ? result : undefined;
}

function shippingService(value) {
  const source = record(value);
  const item = {
    shippingCarrierCode: textValue(source.shippingCarrierCode),
    shippingServiceCode: textValue(source.shippingServiceCode),
  };
  optional(item, "sortOrder", Number.isSafeInteger(source.sortOrder) ? source.sortOrder : undefined);
  optional(item, "shippingCost", source.shippingCost === undefined ? undefined : money(source.shippingCost));
  optional(item, "additionalShippingCost", source.additionalShippingCost === undefined
    ? undefined : money(source.additionalShippingCost));
  optional(item, "freeShipping", typeof source.freeShipping === "boolean" ? source.freeShipping : undefined);
  optional(item, "shipToLocations", shipToLocations(source.shipToLocations));
  return item;
}

export function buildOneDayPolicy(sourceValue) {
  const source = record(sourceValue);
  const policy = {
    name: target.policyName,
    description: target.policyDescription,
    marketplaceId: target.marketplaceId,
    categoryTypes: Array.isArray(source.categoryTypes)
      ? source.categoryTypes.map((entry) => ({ name: textValue(record(entry).name) }))
      : [],
    handlingTime: { value: 1, unit: "DAY" },
    shippingOptions: Array.isArray(source.shippingOptions)
      ? source.shippingOptions.map((entry) => {
        const option = record(entry);
        return {
          optionType: textValue(option.optionType),
          costType: textValue(option.costType),
          shippingServices: Array.isArray(option.shippingServices)
            ? option.shippingServices.map(shippingService) : [],
        };
      })
      : [],
  };
  for (const key of ["globalShipping", "pickupDropOff", "freightShipping", "localPickup"]) {
    optional(policy, key, typeof source[key] === "boolean" ? source[key] : undefined);
  }
  optional(policy, "shipToLocations", shipToLocations(source.shipToLocations));
  if (!policy.categoryTypes.length || !policy.shippingOptions.length
      || policy.shippingOptions.some((item) => !item.shippingServices.length)
      || policy.name.length > 64 || policy.description.length > 250) {
    fail("EBAY_NARANGD_ONE_DAY_SOURCE_POLICY_UNSUPPORTED");
  }
  return policy;
}

export function buildOfferUpdate(offerValue, fulfillmentPolicyId) {
  const offer = record(offerValue);
  const body = {};
  for (const key of [
    "sku", "marketplaceId", "format", "availableQuantity", "pricingSummary",
    "categoryId", "merchantLocationKey", "tax", "listingDuration",
    "includeCatalogProductDetails", "hideBuyerDetails", "listingDescription",
    "quantityLimitPerBuyer", "lotSize", "charity", "extendedProducerResponsibility",
  ]) optional(body, key, offer[key] === undefined ? undefined : clone(offer[key]));
  body.listingPolicies = {
    ...clone(record(offer.listingPolicies)),
    fulfillmentPolicyId,
  };
  return body;
}

function offerIdentity(offerValue) {
  const offer = record(offerValue);
  const listing = record(offer.listing);
  return textValue(offer.offerId) === target.offerId
    && textValue(offer.sku) === target.sku
    && textValue(offer.marketplaceId) === target.marketplaceId
    && textValue(offer.status).toUpperCase() === "PUBLISHED"
    && textValue(listing.listingId) === target.listingId
    && textValue(listing.listingStatus).toUpperCase() === "ACTIVE";
}

function normalizedOfferForComparison(offerValue) {
  const offer = clone(record(offerValue));
  delete offer.offerId;
  delete offer.listing;
  delete offer.status;
  return offer;
}

export function verifyOfferPolicyOnlyChange(beforeValue, afterValue, policyId) {
  if (!offerIdentity(beforeValue) || !offerIdentity(afterValue)) return false;
  const expected = buildOfferUpdate(beforeValue, policyId);
  return canonical(expected) === canonical(normalizedOfferForComparison(afterValue));
}

export function verifyTargetPolicy(policyValue, expectedBody) {
  const policy = record(policyValue);
  const policyId = textValue(policy.fulfillmentPolicyId);
  if (!/^\d{6,30}$/.test(policyId)) return "";
  const reconstructed = buildOneDayPolicy(policy);
  return canonical(reconstructed) === canonical(expectedBody)
    && textValue(policy.name) === target.policyName
    && textValue(policy.marketplaceId) === target.marketplaceId
    && Number(record(policy.handlingTime).value) === 1
    && textValue(record(policy.handlingTime).unit).toUpperCase() === "DAY"
    ? policyId : "";
}

export function validateDatabaseSource(row, now = Date.now()) {
  const credential = record(row?.credential_payload);
  if (!row || row.product_id !== target.productId || row.product_sku !== target.productSku
      || row.listing_id !== target.localListingId || row.listing_product_id !== target.productId
      || row.source_job_id !== target.sourceJobId || row.source_attempt_id !== target.sourceAttemptId
      || row.credential_id !== target.credentialId || row.channel_key !== "ebay"
      || row.market !== "US" || row.target_id !== target.marketplaceId
      || row.listing_status !== "published" || row.remote_visibility !== "live"
      || row.provider_status !== "ACTIVE" || row.remote_id !== target.listingId
      || row.marketplace_sku !== target.sku || row.provider_resource_id !== target.offerId
      || row.product_owner_id !== row.listing_owner_id
      || row.listing_owner_id !== row.attempt_owner_id
      || row.listing_operation_attempt_id !== target.sourceAttemptId
      || row.credential_status !== "active" || row.credential_channel !== "ebay"
      || row.credential_environment !== "production"
      || row.credential_seller_account_key !== row.listing_seller_account_key
      || row.receipt_digest !== target.repairReceiptDigest
      || row.receipt_offer_id !== target.offerId || row.receipt_remote_listing_id !== target.listingId
      || Number(row.running_ebay_jobs) !== 0
      || !textValue(credential.access_token)
      || !Number.isFinite(Date.parse(credential.access_token_expires_at))
      || Date.parse(credential.access_token_expires_at) <= now + 60_000
      || credential.provider_account_identity_version !== "v1"
      || !textValue(credential.provider_account_subject).startsWith("ebay:eias:")) {
    fail("EBAY_NARANGD_ONE_DAY_DB_PREIMAGE_DRIFT");
  }
  return credential;
}

function responseData(response, code) {
  if (!response?.ok || response.status !== 200) fail(code);
  return record(response.data);
}

function targetLookup(response) {
  if (response?.ok && response.status === 200) return record(response.data);
  if (response?.status === 404) return null;
  fail("EBAY_NARANGD_ONE_DAY_TARGET_LOOKUP_UNVERIFIED");
}

function validateSourcePolicy(sourcePolicy, expectedDigest) {
  if (textValue(sourcePolicy.fulfillmentPolicyId) !== target.sourcePolicyId
      || textValue(sourcePolicy.marketplaceId) !== target.marketplaceId
      || Number(record(sourcePolicy.handlingTime).value) !== 2
      || textValue(record(sourcePolicy.handlingTime).unit).toUpperCase() !== "DAY"
      || digest(sourcePolicy) !== expectedDigest) {
    fail("EBAY_NARANGD_ONE_DAY_SOURCE_POLICY_DRIFT");
  }
}

function assertInitialOffer(offer, expectedDigest) {
  if (!offerIdentity(offer)
      || textValue(record(offer.listingPolicies).fulfillmentPolicyId) !== target.sourcePolicyId
      || digest(offer) !== expectedDigest) {
    fail("EBAY_NARANGD_ONE_DAY_OFFER_PREIMAGE_DRIFT");
  }
}

function assertPolicyReceipt(receipt, body, policyId, expectedOfferDigest) {
  if (!receipt || receipt.version !== 1 || receipt.outcome !== "policy_verified"
      || receipt.offerId !== target.offerId || receipt.listingId !== target.listingId
      || receipt.policyId !== policyId || receipt.policyBodyDigest !== digest(body)
      || receipt.originalOfferDigest !== expectedOfferDigest) {
    fail("EBAY_NARANGD_ONE_DAY_POLICY_RECEIPT_DRIFT");
  }
}

export async function runOneDayChange({
  execute, sourceRow, request,
  readEvidence = async () => null,
  writeEvidence = async () => null,
  expectations = {
    offerDigest: target.expectedOfferDigest,
    sourcePolicyDigest: target.expectedSourcePolicyDigest,
  },
}) {
  validateDatabaseSource(sourceRow);
  const getOffer = () => request("GET", `/sell/inventory/v1/offer/${target.offerId}`);
  const getSourcePolicy = () => request("GET", `/sell/account/v1/fulfillment_policy/${target.sourcePolicyId}`);
  const getTargetPolicy = () => request("GET", "/sell/account/v1/fulfillment_policy/get_by_policy_name",
    new URLSearchParams({ marketplace_id: target.marketplaceId, name: target.policyName }));

  const [offerResponse, sourceResponse, targetResponse] = await Promise.all([
    getOffer(), getSourcePolicy(), getTargetPolicy(),
  ]);
  const initialOffer = responseData(offerResponse, "EBAY_NARANGD_ONE_DAY_OFFER_GET_FAILED");
  const sourcePolicy = responseData(sourceResponse, "EBAY_NARANGD_ONE_DAY_SOURCE_POLICY_GET_FAILED");
  validateSourcePolicy(sourcePolicy, expectations.sourcePolicyDigest);
  const body = buildOneDayPolicy(sourcePolicy);
  let existingPolicy = targetLookup(targetResponse);
  let policyId = existingPolicy ? verifyTargetPolicy(existingPolicy, body) : "";
  if (existingPolicy && !policyId) fail("EBAY_NARANGD_ONE_DAY_TARGET_POLICY_CONFLICT");
  const currentPolicyId = textValue(record(initialOffer.listingPolicies).fulfillmentPolicyId);
  const storedPolicyAtStart = await readEvidence("policy");
  if (currentPolicyId === target.sourcePolicyId) assertInitialOffer(initialOffer, expectations.offerDigest);
  else if (!policyId || currentPolicyId !== policyId || !storedPolicyAtStart
      || !verifyOfferPolicyOnlyChange({ ...initialOffer, listingPolicies: {
        ...record(initialOffer.listingPolicies), fulfillmentPolicyId: target.sourcePolicyId,
      } }, initialOffer, policyId)) {
    fail("EBAY_NARANGD_ONE_DAY_OFFER_PREIMAGE_DRIFT");
  }
  if (storedPolicyAtStart) assertPolicyReceipt(storedPolicyAtStart, body, policyId, expectations.offerDigest);

  if (!execute) return {
    mode: "dry-run", eligible: true, providerWrites: 0,
    offerId: target.offerId, listingId: target.listingId,
    currentHandlingDays: 2, targetHandlingDays: 1,
    sourcePolicyId: target.sourcePolicyId,
    targetPolicyState: policyId ? "existing_exact" : "absent",
    targetPolicyId: policyId || null,
    offerAlreadyBound: Boolean(policyId && currentPolicyId === policyId),
    offerDigest: digest(initialOffer), sourcePolicyDigest: digest(sourcePolicy),
    policyBodyDigest: digest(body),
  };

  let providerWrites = 0;
  let policyCreate = { ok: false, status: 0, data: {} };
  let offerPut = { ok: false, status: 0, data: {} };
  let stage = "policy-create";
  try {
    if (!policyId) {
      try {
        policyCreate = await request("POST", "/sell/account/v1/fulfillment_policy", undefined, body);
        providerWrites += 1;
      } catch {
        providerWrites += 1;
      }
      existingPolicy = targetLookup(await getTargetPolicy());
      policyId = existingPolicy ? verifyTargetPolicy(existingPolicy, body) : "";
      if (!policyId) fail("EBAY_NARANGD_ONE_DAY_POLICY_CREATE_NOT_VERIFIED");
    }
    const storedPolicy = storedPolicyAtStart ?? await readEvidence("policy");
    if (storedPolicy) assertPolicyReceipt(storedPolicy, body, policyId, expectations.offerDigest);
    else await writeEvidence("policy", {
      version: 1, outcome: "policy_verified", verifiedAt: new Date().toISOString(),
      offerId: target.offerId, listingId: target.listingId,
      sourcePolicyId: target.sourcePolicyId, policyId,
      policyBodyDigest: digest(body), originalOfferDigest: expectations.offerDigest,
      providerStatus: existingPolicy ? 200 : policyCreate.status,
      providerReadback: clone(existingPolicy),
    });

    stage = "offer-update";
    let currentOffer = responseData(await getOffer(), "EBAY_NARANGD_ONE_DAY_OFFER_GET_FAILED");
    const current = textValue(record(currentOffer.listingPolicies).fulfillmentPolicyId);
    if (current === target.sourcePolicyId) {
      assertInitialOffer(currentOffer, expectations.offerDigest);
      const updateBody = buildOfferUpdate(currentOffer, policyId);
      try {
        offerPut = await request("PUT", `/sell/inventory/v1/offer/${target.offerId}`, undefined, updateBody);
        providerWrites += 1;
      } catch {
        providerWrites += 1;
      }
      currentOffer = responseData(await getOffer(), "EBAY_NARANGD_ONE_DAY_OFFER_FINAL_GET_FAILED");
      if (!verifyOfferPolicyOnlyChange(initialOffer, currentOffer, policyId)) {
        fail("EBAY_NARANGD_ONE_DAY_OFFER_UPDATE_NOT_VERIFIED");
      }
    } else if (current !== policyId || !verifyOfferPolicyOnlyChange({
      ...currentOffer,
      listingPolicies: { ...record(currentOffer.listingPolicies), fulfillmentPolicyId: target.sourcePolicyId },
    }, currentOffer, policyId)) {
      fail("EBAY_NARANGD_ONE_DAY_OFFER_FINAL_DRIFT");
    }

    stage = "final-readback";
    const [finalOfferResponse, finalPolicyResponse] = await Promise.all([getOffer(), getTargetPolicy()]);
    const finalOffer = responseData(finalOfferResponse, "EBAY_NARANGD_ONE_DAY_OFFER_FINAL_GET_FAILED");
    const finalPolicy = targetLookup(finalPolicyResponse);
    if (!finalPolicy || verifyTargetPolicy(finalPolicy, body) !== policyId
        || !verifyOfferPolicyOnlyChange(initialOffer, finalOffer, policyId)) {
      fail("EBAY_NARANGD_ONE_DAY_FINAL_READBACK_MISMATCH");
    }
    const finalReceipt = {
      version: 1, outcome: "one_day_verified", verifiedAt: new Date().toISOString(),
      offerId: target.offerId, listingId: target.listingId, sku: target.sku,
      sourcePolicyId: target.sourcePolicyId, fulfillmentPolicyId: policyId,
      handlingTime: { value: 1, unit: "DAY" },
      originalOfferDigest: expectations.offerDigest,
      finalOfferDigest: digest(finalOffer), policyBodyDigest: digest(body),
      providerStatuses: { policyCreate: policyCreate.status, offerPut: offerPut.status,
        offerReadback: finalOfferResponse.status, policyReadback: finalPolicyResponse.status },
      providerReadback: { offer: clone(finalOffer), fulfillmentPolicy: clone(finalPolicy) },
    };
    const storedComplete = await readEvidence("complete");
    let evidence;
    if (storedComplete) {
      if (storedComplete.version !== 1 || storedComplete.outcome !== "one_day_verified"
          || storedComplete.offerId !== target.offerId || storedComplete.listingId !== target.listingId
          || storedComplete.fulfillmentPolicyId !== policyId
          || storedComplete.originalOfferDigest !== expectations.offerDigest
          || storedComplete.finalOfferDigest !== digest(finalOffer)
          || storedComplete.policyBodyDigest !== digest(body)) {
        fail("EBAY_NARANGD_ONE_DAY_COMPLETE_RECEIPT_DRIFT");
      }
      evidence = { state: "existing_exact", digest: digest(storedComplete) };
    } else evidence = await writeEvidence("complete", finalReceipt);
    return { mode: "executed", eligible: true, providerWrites,
      offerId: target.offerId, listingId: target.listingId,
      fulfillmentPolicyId: policyId, handlingTime: { value: 1, unit: "DAY" },
      receiptDigest: digest(finalReceipt), evidence };
  } catch (error) {
    const failureCode = error instanceof Error && /^EBAY_NARANGD_ONE_DAY_[A-Z0-9_]+$/.test(error.message)
      ? error.message : "EBAY_NARANGD_ONE_DAY_PROVIDER_FAILURE";
    await writeEvidence("failure", {
      version: 1, outcome: "failed", failedAt: new Date().toISOString(), failedStage: stage,
      failureCode, offerId: target.offerId, listingId: target.listingId,
      providerStatuses: { policyCreate: policyCreate.status, offerPut: offerPut.status },
      providerResponses: { policyCreate: clone(policyCreate.data), offerPut: clone(offerPut.data) },
    }).catch(() => {});
    throw error;
  }
}

function managementToken() {
  let value = execFileSync("security", ["find-generic-password", "-s", "Supabase CLI", "-a", "supabase", "-w"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (value.startsWith("go-keyring-base64:")) value = Buffer.from(value.slice(18), "base64").toString("utf8");
  return value;
}

async function managementQuery(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${target.projectRef}/database/query`, {
    method: "POST", headers: { authorization: `Bearer ${managementToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) { await response.body?.cancel(); fail(`EBAY_NARANGD_ONE_DAY_MANAGEMENT_HTTP_${response.status}`); }
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1) fail("EBAY_NARANGD_ONE_DAY_DB_ROW_NOT_UNIQUE");
  return rows[0];
}

function sourceSql() {
  return `select p.id::text product_id,p.sku product_sku,p.owner_id::text product_owner_id,
 l.id::text listing_id,l.product_id::text listing_product_id,l.owner_id::text listing_owner_id,
 l.operation_attempt_id::text listing_operation_attempt_id,l.channel_key,l.market,l.target_id,l.status listing_status,
 l.remote_visibility,l.provider_status,l.remote_id,l.marketplace_sku,l.provider_resource_id,l.seller_account_key listing_seller_account_key,
 r.source_job_id::text,r.source_attempt_id::text,r.credential_id::text,r.verified_receipt_digest receipt_digest,
 r.offer_id receipt_offer_id,r.remote_listing_id receipt_remote_listing_id,a.owner_id::text attempt_owner_id,
 c.id::text credential_id,c.status credential_status,c.channel credential_channel,c.environment credential_environment,
 c.seller_account_key credential_seller_account_key,d.decrypted_secret::jsonb credential_payload,
 (select count(*)::int from sellerpilot_private.channel_gateway_jobs x where x.channel='ebay' and x.environment='production' and x.status='running') running_ebay_jobs
 from sellerpilot_private.product_listings l
 join sellerpilot_private.products p on p.id=l.product_id
 join sellerpilot_private.ebay_narangd_offer_repair_receipts r on r.listing_id=l.id
 join sellerpilot_private.channel_operation_attempts a on a.id=r.source_attempt_id
 join sellerpilot_private.channel_credentials c on c.id=r.credential_id
 join vault.decrypted_secrets d on d.id=c.vault_secret_id
 where l.id='${target.localListingId}'::uuid and p.id='${target.productId}'::uuid
 and r.source_job_id='${target.sourceJobId}'::uuid and r.source_attempt_id='${target.sourceAttemptId}'::uuid
 and c.id='${target.credentialId}'::uuid`;
}

function providerRequest(credential) {
  return async (method, path, query, body) => {
    const suffix = query?.toString() ? `?${query}` : "";
    const response = await fetch(`https://api.ebay.com${path}${suffix}`, {
      method, headers: {
        accept: "application/json", "accept-language": "en-US", "content-type": "application/json",
        "content-language": "en-US", authorization: `Bearer ${credential.access_token}`,
        "x-ebay-c-marketplace-id": target.marketplaceId,
        "user-agent": "SellerPilot-eBay-Narangd-One-Day/1.0",
      }, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000), cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  };
}

async function privateEvidence(kind, value) {
  const directory = resolve(evidenceDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const targetPath = join(directory, evidenceNames[kind]);
  const temporary = join(directory, `.ebay-narangd-one-day-${randomUUID()}.tmp`);
  const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
  try {
    await link(temporary, targetPath).catch((error) => {
      if (error?.code === "EEXIST") fail("EBAY_NARANGD_ONE_DAY_EVIDENCE_EXISTS");
      throw error;
    });
  } finally { await unlink(temporary).catch(() => {}); }
  return { path: targetPath, digest: digest(value) };
}

async function readPrivateEvidence(kind) {
  const targetPath = join(resolve(evidenceDirectory), evidenceNames[kind]);
  const stat = await lstat(targetPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) fail("EBAY_NARANGD_ONE_DAY_EVIDENCE_UNSAFE");
  const file = await open(targetPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return JSON.parse(await file.readFile("utf8")); } finally { await file.close(); }
}

export async function main(argv = process.argv.slice(2), options = {}) {
  if (argv.some((arg) => arg !== "--execute") || argv.length > 1) fail("EBAY_NARANGD_ONE_DAY_ARGUMENTS_INVALID");
  const execute = argv.includes("--execute");
  const sourceRow = options.sourceRow ?? await managementQuery(sourceSql());
  const credential = validateDatabaseSource(sourceRow);
  const result = await runOneDayChange({
    execute, sourceRow,
    request: options.request ?? providerRequest(credential),
    readEvidence: options.readEvidence ?? readPrivateEvidence,
    writeEvidence: options.writeEvidence ?? privateEvidence,
  });
  (options.output ?? console.log)(JSON.stringify(result));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "";
    console.error(/^EBAY_NARANGD_ONE_DAY_[A-Z0-9_]+$/.test(message)
      ? message : "EBAY_NARANGD_ONE_DAY_FAILED_NO_SECRET_OUTPUT");
    process.exitCode = 1;
  });
}
