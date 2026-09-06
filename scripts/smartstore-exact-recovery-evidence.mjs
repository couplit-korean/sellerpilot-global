import { createHash } from 'node:crypto';

// Offline review only. This module has no database, network, filesystem write,
// enqueue, credential or provider capability. A passing review is NOT authority
// to mutate production. Pins must come from independently inspected evidence.
export const smartstoreRecoveryTarget = Object.freeze({
  jobId: '66147e5d-0479-4c51-896e-97e782af99e1',
  attemptId: '0d2c492e-2025-4717-bb3f-0fd2b886fd4f',
  productId: '1ed4acfc-7603-48ec-a638-241131e59358',
  importId: '08acb37f-7ed0-40b0-8fb3-4a217a7ac912',
  ownerId: '768ce4ac-0ef2-4e01-89dc-05aa4fa8543c',
  credentialId: '2aa76829-3d63-4842-9c3e-622acd3d0d2f',
  aiJobId: 'e0ae47da-1493-4c6d-934f-d984e179b264',
  sku: 'AUTO-780720401E2D4E4EA45F',
  fingerprint: '7ca96928ee67fa1285c74754ec65ca45807861836afa23c34bec17c52a8aabea',
  importRequestSha256: '8f1ebe5d61834100351b96385d84f063f39b329e7e68b9b255abb286caf056f2',
  approvedAt: '2026-09-06T03:19:01.757195Z',
  changedAt: '2026-09-06T13:08:23.846181Z',
});
export function canonicalRecoveryJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalRecoveryJson).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalRecoveryJson(value[key])}`).join(',')}}`;
  }
  throw new Error('RECOVERY_NON_JSON_EVIDENCE');
}
export const recoveryEvidenceHash = value => createHash('sha256').update(canonicalRecoveryJson(value)).digest('hex');
const same = (a, b) => canonicalRecoveryJson(a) === canonicalRecoveryJson(b);
const omit = (value, fields) => Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key)));

export function classifySmartstoreCreateRejection(response) {
  const steps = response?.steps;
  if (response?.channel !== 'smartstore' || response.operation !== 'listing.create' || response.ok !== false || !Array.isArray(steps) || steps.length !== 2) return null;
  const [image, create] = steps;
  if (image?.name !== 'listing-image-upload' || image.ok !== true || image.status !== 200 || image.data?.sellerpilotMutation !== 'accepted') return null;
  if (create?.name !== 'product-create' || create.ok !== false || create.status !== 400 || create.data?.code !== 'BAD_REQUEST') return null;
  const errors = create.data.invalidInputs;
  if (!Array.isArray(errors) || errors.length !== 1 || errors[0]?.name !== 'originProduct.detailAttribute.unitCapacity.unitPriceYn' || errors[0].type !== 'Required.product.unitPriceYn') return null;
  return Object.freeze({ productCreate: 'rejected', imageUpload: 'accepted', retryAuthorized: false, requiresCurrentRemoteRead: true });
}

export function reviewSmartstoreRecoveryEvidence(e, pins, nowMs) {
  const errors = [];
  const check = (condition, code) => { if (!condition) errors.push(code); };
  try {
    const t = smartstoreRecoveryTarget;
    check(Number.isFinite(nowMs), 'REVIEW_CLOCK_REQUIRED');
    for (const name of ['sourceJob', 'sourceAttempt', 'approval', 'productBefore', 'productCurrent', 'columnNames', 'readback', 'databaseObservation']) {
      check(/^[a-f0-9]{64}$/.test(pins?.[name] ?? '') && recoveryEvidenceHash(e[name]) === pins[name], `PIN_${name}`);
    }
    const j = e.sourceJob, a = e.sourceAttempt, r = e.approval, before = e.productBefore, p = e.productCurrent;
    check(j.id === t.jobId && j.attempt_id === t.attemptId && a.id === t.attemptId, 'SOURCE_IDENTITY');
    check(j.channel === 'smartstore' && j.operation === 'listing.create' && j.environment === 'production', 'SOURCE_OPERATION');
    check(j.credential_id === t.credentialId && a.credential_id === t.credentialId && a.owner_id === t.ownerId, 'CREDENTIAL_OWNER');
    check(j.request_fingerprint === t.fingerprint && a.request_fingerprint === t.fingerprint, 'SOURCE_FINGERPRINT');
    check(j.status === 'reconciliation_required' && j.attempt_count === 1 && a.status === 'manual_required' && a.remote_id === null && a.pre_gateway_retryable === false, 'SOURCE_STATE');
    check(typeof j.provider_mutation_started_at === 'string' && typeof j.completed_at === 'string' && Date.parse(j.completed_at) >= Date.parse(j.provider_mutation_started_at), 'SOURCE_TIMING');
    const steps = j.response_payload.steps;
    check(classifySmartstoreCreateRejection(j.response_payload) !== null, 'EXACT_REJECTION_CLASSIFICATION');
    check(j.response_payload.channel === 'smartstore' && j.response_payload.operation === 'listing.create' && j.response_payload.ok === false, 'RESPONSE_OPERATION');
    check(steps.length === 2 && steps[0].name === 'listing-image-upload' && steps[0].ok === true && steps[0].status === 200 && steps[0].data.sellerpilotMutation === 'accepted', 'IMAGE_EFFECT');
    check(steps[1].name === 'product-create' && steps[1].ok === false && steps[1].status === 400 && steps[1].data.code === 'BAD_REQUEST', 'CREATE_REJECTION');
    check(steps[1].data.invalidInputs.length === 1 && steps[1].data.invalidInputs[0].name === 'originProduct.detailAttribute.unitCapacity.unitPriceYn' && steps[1].data.invalidInputs[0].type === 'Required.product.unitPriceYn', 'EXACT_PROVIDER_ERROR');
    const b = j.request_payload.arguments.sellerpilotExternalDetail;
    check(b.productId === t.productId && b.ownerId === t.ownerId && b.importId === t.importId && b.version === 2 && b.requestSha256 === t.importRequestSha256 && b.productUpdatedAt === t.approvedAt, 'SOURCE_APPROVAL_BINDING');
    check(r.id === t.importId && r.product_id === t.productId && r.owner_id === t.ownerId && r.status === 'approved' && r.approved_detail_version === 2 && r.approved_product_updated_at === t.approvedAt && r.request_sha256 === t.importRequestSha256, 'APPROVAL_IDENTITY');
    check(r.payload.expectedAiJobId === t.aiJobId && recoveryEvidenceHash(omit(r.payload, ['requestSha256'])) === r.request_sha256, 'APPROVAL_PAYLOAD');
    const columns = e.columnNames;
    check(Array.isArray(columns) && columns.length > 0 && new Set(columns).size === columns.length && same([...columns].sort(), Object.keys(before).sort()) && same([...columns].sort(), Object.keys(p).sort()), 'FULL_PRODUCT_ROW_REQUIRED');
    for (const row of [before, p]) check(row.id === t.productId && row.owner_id === t.ownerId && row.external_detail_import_id === t.importId && row.ai_job_id === t.aiJobId && row.detail_page_version === 2 && row.sku === t.sku, 'PRODUCT_IDENTITY');
    check(before.updated_at === t.approvedAt && p.updated_at === t.changedAt, 'EXACT_SOURCE_TIME_DRIFT');
    // Only completion's documented status and timestamp changes are considered.
    check(same(omit(before, ['updated_at', 'status']), omit(p, ['updated_at', 'status'])), 'PRODUCT_CONTENT_CHANGED');
    const db = e.databaseObservation;
    check(db.sourceJobId === t.jobId && db.productId === t.productId && db.laterMutations.length === 0 && db.activeCompetingJobs.length === 0 && db.liveLeaseCount === 0, 'COMPETING_ACTIVITY');
    check(db.completionSourceMd5 === 'e60d369fd7622189e641096fce20d061' && db.unsafeCompletionSourceMd5 === 'd47a1c134a92061a6cfbc2c63698f868', 'COMPLETION_FIX_NOT_CONFIRMED');
    check(db.beforeStatus === before.status && db.afterStatus === p.status && db.cause === 'verified_completion_bookkeeping_only', 'DRIFT_ATTRIBUTION');
    const read = e.readback;
    check(read.jobId === t.jobId && read.credentialId === t.credentialId && read.credentialVersion === 1 && read.sellerCode === t.sku && typeof read.sellerAccountKey === 'string' && read.sellerAccountKey.length > 0 && read.sellerAccountKey === j.seller_account_key, 'READBACK_IDENTITY');
    check(read.httpStatus === 200 && read.totalElements === 0 && read.rows.length === 0 && read.allPagesRead === true && read.allProductStatesIncluded === true && read.newCreate === false, 'READBACK_NOT_COMPLETE_ZERO');
    check(Date.parse(read.at) >= Date.parse(j.completed_at) && nowMs - Date.parse(read.at) >= 0 && nowMs - Date.parse(read.at) <= 300000, 'READBACK_NOT_FRESH');
    check(Date.parse(db.at) >= Date.parse(read.at) && nowMs - Date.parse(db.at) >= 0 && nowMs - Date.parse(db.at) <= 300000, 'DATABASE_NOT_FRESH');
  } catch { errors.push('MALFORMED_OR_MISSING_EVIDENCE'); }
  return { contract: 'smartstore_exact_recovery_offline_review_v1', evidenceConsistent: errors.length === 0, productionMutationAuthorized: false, next: errors.length ? 'collect_or_correct_evidence' : 'review_and_implement_atomic_recovery_contract', errors: [...new Set(errors)] };
}
