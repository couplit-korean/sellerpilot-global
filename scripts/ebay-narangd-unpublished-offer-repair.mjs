// Exact one-off recovery for the Narangd EBAY_US offer rejected at publish
// because a complete ingredient declaration was sent as the optional Material
// aspect. Default mode performs provider GETs only. --execute performs exactly
// one Inventory Item PUT and one publish POST after all immutable checks pass.
//
// node --import tsx scripts/ebay-narangd-unpublished-offer-repair.mjs
// node --import tsx scripts/ebay-narangd-unpublished-offer-repair.mjs --execute
//
// The original gateway job, attempt and listing rows are read-only. Successful
// execution writes a private local receipt for later exact lineage succession.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const incident = Object.freeze({
  projectRef: "sqaoqucxakebqkiygdxb",
  productId: "c0bdb493-6447-41bf-af0a-46a3da7a75a8",
  listingId: "b66bdb38-a9e2-4883-a147-5122659eec88",
  jobId: "81f79abf-ed3f-44cd-a445-fe76e2dcba65",
  attemptId: "51ccc22f-36d3-4032-9125-d712cdb59f46",
  offerId: "265437447011",
  sku: "AUTO-00BF58A2E8434FF09667-US",
  marketplaceId: "EBAY_US",
  categoryId: "179188",
  rejectedErrorId: 25002,
  rejectedAspect: "Material",
});

const evidenceDirectory = join(
  homedir(),
  "Library/Application Support/SellerPilot/private-evidence",
);
const evidenceName = "ebay-narangd-offer-265437447011-repair.json";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const text = (value) => typeof value === "string" ? value.trim() : "";
const clone = (value) => structuredClone(value);
const canonical = (value) => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]))
    : item);
const fail = (code) => { throw new Error(code); };

function stepsByName(payload) {
  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  return Object.fromEntries(steps.map((item) => [item?.name, item]));
}

function oneError(step, errorId) {
  const errors = Array.isArray(step?.data?.errors) ? step.data.errors : [];
  return errors.length === 1 && Number(errors[0]?.errorId) === errorId
    ? errors[0]
    : null;
}

export function validateIncidentSource(row, now = Date.now()) {
  if (!row || row.job_id !== incident.jobId || row.listing_id !== incident.listingId
      || row.attempt_id !== incident.attemptId || row.product_id !== incident.productId
      || row.job_channel !== "ebay" || row.job_operation !== "listing.create"
      || row.job_status !== "reconciliation_required" || row.attempt_status !== "manual_required"
      || row.listing_status !== "failed" || row.failure_class !== "external_action"
      || row.listing_remote_id !== incident.offerId || row.attempt_remote_id !== incident.offerId
      || row.marketplace_sku !== null || row.provider_resource_id !== null
      || canonical(row.remote_resources) !== "{}" || row.remote_visibility !== "unknown"
      || row.market !== "US" || row.target_id !== incident.marketplaceId
      || row.provider_mutation_started !== true || Number(row.running_ebay_jobs) !== 0
      || row.request_fingerprint !== row.attempt_fingerprint
      || row.job_seller_account_key !== row.attempt_seller_account_key
      || row.job_seller_account_key !== row.credential_seller_account_key
      || row.active_credential_count !== 1 || row.credential_channel !== "ebay"
      || row.credential_environment !== "production" || row.credential_status !== "active"
      || row.credential_identity_source !== "provider_certified_v1"
      || row.credential_identity_verified !== true) {
    fail("EBAY_NARANGD_REPAIR_DB_PREIMAGE_DRIFT");
  }
  const request = record(row.request_payload);
  const args = record(request.arguments);
  const offer = record(args.offer);
  const inventoryItem = record(args.inventoryItem);
  const product = record(inventoryItem.product);
  const aspects = record(product.aspects);
  const material = Array.isArray(aspects.Material) ? aspects.Material.map(text).filter(Boolean) : [];
  const response = record(row.response_payload);
  const steps = stepsByName(response);
  const rejected = oneError(steps.publish, incident.rejectedErrorId);
  const parameters = Array.isArray(rejected?.parameters) ? rejected.parameters : [];
  const rejectedMaterial = text(parameters.find((item) => item?.name === "4")?.value);
  const rejectedAspect = text(parameters.find((item) => item?.name === "3")?.value);
  const detail = record(steps["offer-detail-image-readback"]?.data);
  if (text(args.sku) !== incident.sku || text(offer.sku) !== incident.sku
      || text(offer.marketplaceId) !== incident.marketplaceId
      || text(offer.categoryId) !== incident.categoryId
      || material.length !== 1 || material[0].length <= 65
      || !text(product.description).toLowerCase().includes("ingredient")
      || !text(offer.listingDescription).toLowerCase().includes("ingredient")
      || response.ok !== false || response.remoteId !== incident.offerId
      || steps["inventory-item"]?.ok !== true || steps["inventory-item"]?.status !== 204
      || steps.offer?.ok !== true || steps.offer?.status !== 201
      || text(steps.offer?.data?.offerId) !== incident.offerId
      || steps["offer-detail-image-readback"]?.ok !== true
      || text(detail.offerId) !== incident.offerId || text(detail.sku) !== incident.sku
      || text(detail.marketplaceId) !== incident.marketplaceId
      || text(detail.categoryId) !== incident.categoryId
      || text(detail.status).toUpperCase() !== "UNPUBLISHED"
      || steps.publish?.ok !== false || steps.publish?.status !== 400
      || rejectedAspect !== incident.rejectedAspect || rejectedMaterial !== material[0]) {
    fail("EBAY_NARANGD_REPAIR_SOURCE_EVIDENCE_DRIFT");
  }
  const credential = record(row.credential_payload);
  if (!text(credential.access_token)
      || !Number.isFinite(Date.parse(credential.access_token_expires_at))
      || Date.parse(credential.access_token_expires_at) <= now + 60_000
      || text(credential.marketplace_id || incident.marketplaceId) !== incident.marketplaceId
      || credential.provider_account_identity_version !== "v1"
      || !text(credential.provider_account_subject).startsWith("ebay:eias:")) {
    fail("EBAY_NARANGD_REPAIR_CREDENTIAL_UNUSABLE");
  }
  return { args, offer, inventoryItem, material: material[0], credential };
}

function subsetMismatches(expected, actual, path = "") {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || canonical(expected) !== canonical(actual)) return [path];
    return [];
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return [path];
    return Object.entries(expected).flatMap(([key, value]) =>
      subsetMismatches(value, actual[key], path ? `${path}.${key}` : key));
  }
  return Object.is(expected, actual) ? [] : [path];
}

function correctedInventory(sourceInventory) {
  const corrected = clone(sourceInventory);
  const product = record(corrected.product);
  const aspects = { ...record(product.aspects) };
  delete aspects.Material;
  product.aspects = aspects;
  corrected.product = product;
  return corrected;
}

function validateProviderPreflight(source, inventory, offers, offerDetail) {
  const exactOffers = Array.isArray(offers?.data?.offers) ? offers.data.offers : [];
  const exactOffer = exactOffers[0];
  const sourceWithoutMaterial = correctedInventory(source.inventoryItem);
  const currentMaterial = record(record(inventory.data).product).aspects;
  const currentMaterialValues = Array.isArray(record(currentMaterial).Material)
    ? record(currentMaterial).Material.map(text).filter(Boolean)
    : [];
  if (!inventory.ok || !offers.ok || !offerDetail.ok
      || subsetMismatches(source.inventoryItem, inventory.data).length !== 0
      || subsetMismatches(source.offer, offerDetail.data).length !== 0
      || currentMaterialValues.length !== 1 || currentMaterialValues[0] !== source.material
      || offers.data?.total !== 1 || exactOffers.length !== 1 || offers.data?.next
      || text(exactOffer?.offerId) !== incident.offerId || text(exactOffer?.sku) !== incident.sku
      || text(exactOffer?.marketplaceId) !== incident.marketplaceId
      || text(exactOffer?.format) !== text(source.offer.format)
      || text(offerDetail.data?.offerId) !== incident.offerId
      || text(offerDetail.data?.sku) !== incident.sku
      || text(offerDetail.data?.marketplaceId) !== incident.marketplaceId
      || text(offerDetail.data?.categoryId) !== incident.categoryId
      || text(offerDetail.data?.status).toUpperCase() !== "UNPUBLISHED"
      || Object.keys(record(offerDetail.data?.listing)).length !== 0) {
    fail("EBAY_NARANGD_REPAIR_PROVIDER_PREFLIGHT_DRIFT");
  }
  return sourceWithoutMaterial;
}

function validateCorrectedInventory(expected, readback) {
  const aspects = record(record(readback.data).product).aspects;
  if (!readback.ok || Object.hasOwn(record(aspects), "Material")
      || subsetMismatches(expected, readback.data).length !== 0) {
    fail("EBAY_NARANGD_REPAIR_INVENTORY_READBACK_MISMATCH");
  }
}

function verifiedPublishedOffer(response) {
  const listing = record(response?.data?.listing);
  const listingId = text(listing.listingId);
  return response?.ok
    && text(response.data?.offerId) === incident.offerId
    && text(response.data?.sku) === incident.sku
    && text(response.data?.marketplaceId) === incident.marketplaceId
    && text(response.data?.categoryId) === incident.categoryId
    && text(response.data?.status).toUpperCase() === "PUBLISHED"
    && /^\d{9,19}$/.test(listingId)
    && text(listing.listingStatus).toUpperCase() === "ACTIVE"
    ? listingId
    : "";
}

export async function runRepair({ execute, sourceRow, request, writeEvidence = async () => null }) {
  const source = validateIncidentSource(sourceRow);
  const getInventory = () => request("GET", `/sell/inventory/v1/inventory_item/${encodeURIComponent(incident.sku)}`);
  const getOffers = () => request("GET", "/sell/inventory/v1/offer", new URLSearchParams({
    sku: incident.sku, marketplace_id: incident.marketplaceId, limit: "200",
  }));
  const getOffer = () => request("GET", `/sell/inventory/v1/offer/${incident.offerId}`);
  const [inventory, offers, offer] = await Promise.all([getInventory(), getOffers(), getOffer()]);
  const correction = validateProviderPreflight(source, inventory, offers, offer);
  const preflightDigest = hash(canonical({ inventory: inventory.data, offers: offers.data, offer: offer.data }));
  if (!execute) return {
    mode: "dry-run", eligible: true, providerWrites: 0,
    jobId: incident.jobId, listingId: incident.listingId,
    offerId: incident.offerId, sku: incident.sku, preflightDigest,
  };

  let stage = "inventory-put";
  let inventoryWrite = { ok: false, status: 0, data: {} };
  let inventoryReadback = { ok: false, status: 0, data: {} };
  let offerBeforePublish = { ok: false, status: 0, data: {} };
  let publish = { ok: false, status: 0, data: {} };
  let finalOffer = { ok: false, status: 0, data: {} };
  let finalInventory = { ok: false, status: 0, data: {} };
  let listingId = "";
  try {
    try {
      inventoryWrite = await request(
        "PUT", `/sell/inventory/v1/inventory_item/${encodeURIComponent(incident.sku)}`,
        undefined, correction,
      );
    } catch {
      inventoryWrite = { ok: false, status: 0, data: {} };
    }
    stage = "inventory-readback";
    inventoryReadback = await getInventory();
    validateCorrectedInventory(correction, inventoryReadback);
    if ((!inventoryWrite.ok || inventoryWrite.status !== 204)
        && inventoryReadback.status !== 200) {
      fail("EBAY_NARANGD_REPAIR_INVENTORY_WRITE_REJECTED");
    }
    stage = "offer-prepublish-readback";
    offerBeforePublish = await getOffer();
    validateProviderPreflight(source, {
      ...inventoryReadback,
      data: { ...inventoryReadback.data, product: {
        ...record(inventoryReadback.data?.product),
        aspects: { ...record(inventoryReadback.data?.product?.aspects), Material: [source.material] },
      } },
    }, offers, offerBeforePublish);

    stage = "publish";
    try {
      publish = await request("POST", `/sell/inventory/v1/offer/${incident.offerId}/publish`);
    } catch {
      publish = { ok: false, status: 0, data: {} };
    }
    stage = "offer-final-readback";
    finalOffer = await getOffer();
    listingId = verifiedPublishedOffer(finalOffer);
    if (!listingId) {
      // Never repeat publish: an uncertain response may still have published.
      if (!publish.ok) fail("EBAY_NARANGD_REPAIR_PUBLISH_NOT_VERIFIED");
      fail("EBAY_NARANGD_REPAIR_FINAL_OFFER_MISMATCH");
    }
    stage = "inventory-final-readback";
    finalInventory = await getInventory();
    validateCorrectedInventory(correction, finalInventory);
  } catch (error) {
    const failureCode = error instanceof Error
      && /^EBAY_NARANGD_REPAIR_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "EBAY_NARANGD_REPAIR_PROVIDER_FAILURE";
    await writeEvidence({
      version: 1,
      outcome: "failed",
      failedStage: stage,
      failureCode,
      incident: { ...incident },
      executedAt: new Date().toISOString(),
      originalEvidenceDigest: hash(canonical(sourceRow.response_payload)),
      preflightDigest,
      providerStatuses: {
        inventoryPut: inventoryWrite.status,
        inventoryReadback: inventoryReadback.status,
        offerBeforePublish: offerBeforePublish.status,
        publish: publish.status,
        offerReadback: finalOffer.status,
        inventoryFinalReadback: finalInventory.status,
      },
      providerReadback: {
        inventoryItem: clone(inventoryReadback.data),
        offerBeforePublish: clone(offerBeforePublish.data),
        publish: clone(publish.data),
        offer: clone(finalOffer.data),
        finalInventoryItem: clone(finalInventory.data),
      },
    });
    throw error;
  }
  const receipt = {
    version: 1,
    outcome: "published",
    incident: { ...incident },
    executedAt: new Date().toISOString(),
    originalEvidenceDigest: hash(canonical(sourceRow.response_payload)),
    preflightDigest,
    correctedInventoryDigest: hash(canonical(finalInventory.data)),
    finalOfferDigest: hash(canonical(finalOffer.data)),
    listingId,
    providerStatuses: {
      inventoryPut: inventoryWrite.status,
      publish: publish.status,
      inventoryReadback: finalInventory.status,
      offerReadback: finalOffer.status,
    },
    providerReadback: {
      inventoryItem: clone(finalInventory.data),
      offer: clone(finalOffer.data),
      publish: clone(publish.data),
    },
  };
  const evidence = await writeEvidence(receipt);
  publish = null;
  finalOffer = null;
  return {
    mode: "executed", eligible: true, providerWrites: 2,
    jobId: incident.jobId, sourceAttemptId: incident.attemptId,
    localListingId: incident.listingId, offerId: incident.offerId,
    sku: incident.sku, publishedListingId: listingId,
    receiptDigest: hash(canonical(receipt)), evidence,
    next: "exact-lineage-succession-required",
  };
}

function managementToken() {
  let token = execFileSync("security", ["find-generic-password", "-s", "Supabase CLI", "-a", "supabase", "-w"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (token.startsWith("go-keyring-base64:")) {
    token = Buffer.from(token.slice(18), "base64").toString("utf8");
  }
  return token;
}

async function managementQuery(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${incident.projectRef}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${managementToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) { await response.body?.cancel(); fail(`EBAY_NARANGD_REPAIR_MANAGEMENT_HTTP_${response.status}`); }
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1) fail("EBAY_NARANGD_REPAIR_DB_ROW_NOT_UNIQUE");
  return rows[0];
}

function sourceSql() {
  return `select j.id::text job_id,j.listing_id::text listing_id,j.attempt_id::text attempt_id,l.product_id::text product_id,
 j.channel job_channel,j.operation job_operation,j.status job_status,a.status attempt_status,l.status listing_status,l.failure_class,
 l.remote_id listing_remote_id,a.remote_id attempt_remote_id,l.marketplace_sku,l.provider_resource_id,l.remote_resources,l.remote_visibility,l.market,l.target_id,
 j.provider_mutation_started_at is not null provider_mutation_started,j.request_fingerprint,a.request_fingerprint attempt_fingerprint,
 j.seller_account_key job_seller_account_key,a.seller_account_key attempt_seller_account_key,c.seller_account_key credential_seller_account_key,
 j.request_payload,j.response_payload,c.id::text credential_id,c.version credential_version,c.channel credential_channel,c.environment credential_environment,
 c.status credential_status,c.seller_account_key_source credential_identity_source,c.seller_account_verified_at is not null credential_identity_verified,
 d.decrypted_secret::jsonb credential_payload,
 (select count(*)::int from sellerpilot_private.channel_credentials x where x.channel='ebay' and x.environment='production' and x.status='active' and x.seller_account_key=j.seller_account_key) active_credential_count,
 (select count(*)::int from sellerpilot_private.channel_gateway_jobs x where x.channel='ebay' and x.environment='production' and x.status='running') running_ebay_jobs
 from sellerpilot_private.channel_gateway_jobs j
 join sellerpilot_private.product_listings l on l.id=j.listing_id
 join sellerpilot_private.channel_operation_attempts a on a.id=j.attempt_id
 join sellerpilot_private.channel_credentials c on c.id=(select x.id from sellerpilot_private.channel_credentials x where x.channel='ebay' and x.environment='production' and x.status='active' and x.seller_account_key=j.seller_account_key order by x.version desc limit 1)
 join vault.decrypted_secrets d on d.id=c.vault_secret_id
 where j.id='${incident.jobId}'::uuid and j.listing_id='${incident.listingId}'::uuid and j.attempt_id='${incident.attemptId}'::uuid`;
}

function providerRequest(credential) {
  return async (method, path, query, body) => {
    const suffix = query?.toString() ? `?${query}` : "";
    const response = await fetch(`https://api.ebay.com${path}${suffix}`, {
      method, headers: {
        accept: "application/json", "accept-language": "en-US",
        "content-type": "application/json", "content-language": "en-US",
        authorization: `Bearer ${credential.access_token}`,
        "x-ebay-c-marketplace-id": incident.marketplaceId,
        "user-agent": "SellerPilot-eBay-Exact-Narangd-Repair/1.0",
      }, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000), cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  };
}

async function writePrivateEvidence(receipt) {
  const directory = resolve(evidenceDirectory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, evidenceName);
  const temporary = join(directory, `.ebay-narangd-${randomUUID()}.tmp`);
  const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(JSON.stringify(receipt)); await file.sync(); } finally { await file.close(); }
  try {
    await link(temporary, target).catch((error) => {
      if (error?.code === "EEXIST") fail("EBAY_NARANGD_REPAIR_EVIDENCE_EXISTS");
      throw error;
    });
  } finally {
    await unlink(temporary).catch(() => {});
  }
  return { path: target, digest: hash(canonical(receipt)) };
}

async function assertPrivateEvidenceAbsent() {
  const target = join(resolve(evidenceDirectory), evidenceName);
  const existing = await lstat(target).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existing) fail("EBAY_NARANGD_REPAIR_EVIDENCE_EXISTS");
}

export async function main(argv = process.argv.slice(2), options = {}) {
  if (argv.some((arg) => arg !== "--execute") || argv.length > 1) fail("EBAY_NARANGD_REPAIR_ARGUMENTS_INVALID");
  const execute = argv.includes("--execute");
  if (execute && !options.writeEvidence) await assertPrivateEvidenceAbsent();
  const sourceRow = options.sourceRow ?? await managementQuery(sourceSql());
  const source = validateIncidentSource(sourceRow);
  const result = await runRepair({
    execute, sourceRow,
    request: options.request ?? providerRequest(source.credential),
    writeEvidence: options.writeEvidence ?? writePrivateEvidence,
  });
  (options.output ?? console.log)(JSON.stringify(result));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "";
    console.error(/^EBAY_NARANGD_REPAIR_[A-Z0-9_]+$/.test(message)
      ? message : "EBAY_NARANGD_REPAIR_FAILED_NO_SECRET_OUTPUT");
    process.exitCode = 1;
  });
}
