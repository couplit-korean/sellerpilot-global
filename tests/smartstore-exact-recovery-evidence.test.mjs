import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalRecoveryJson, recoveryEvidenceHash, classifySmartstoreCreateRejection, reviewSmartstoreRecoveryEvidence } from '../scripts/smartstore-exact-recovery-evidence.mjs';

const rejection = () => ({ channel: 'smartstore', operation: 'listing.create', ok: false, steps: [
  { name: 'listing-image-upload', status: 200, ok: true, data: { sellerpilotMutation: 'accepted' } },
  { name: 'product-create', status: 400, ok: false, data: { code: 'BAD_REQUEST', invalidInputs: [{ name: 'originProduct.detailAttribute.unitCapacity.unitPriceYn', type: 'Required.product.unitPriceYn' }] } },
] });

test('exact rejection preserves image effect and does not authorize retry', () => {
  const value = rejection(), before = structuredClone(value);
  assert.deepEqual(classifySmartstoreCreateRejection(value), { productCreate: 'rejected', imageUpload: 'accepted', retryAuthorized: false, requiresCurrentRemoteRead: true });
  assert.deepEqual(value, before);
});

for (const [label, change] of [
  ['timeout', r => { r.steps[1].status = 408; }],
  ['server error', r => { r.steps[1].status = 500; }],
  ['accepted create', r => { r.steps[1].ok = true; r.steps[1].status = 200; }],
  ['different required field', r => { r.steps[1].data.invalidInputs[0].name = 'price'; }],
  ['second error', r => { r.steps[1].data.invalidInputs.push({ name: 'price' }); }],
  ['extra operation', r => { r.steps.push({ name: 'unknown-mutation', ok: true }); }],
  ['missing image outcome', r => { delete r.steps[0].data.sellerpilotMutation; }],
  ['other channel', r => { r.channel = 'coupang'; }],
  ['other operation', r => { r.operation = 'listing.update'; }],
]) test(`rejects ${label}`, () => {
  const value = rejection(); change(value); assert.equal(classifySmartstoreCreateRejection(value), null);
});

test('canonical hashing is stable under key order and changes under content/order changes', () => {
  assert.equal(recoveryEvidenceHash({ b: 2, a: ['가', 1] }), recoveryEvidenceHash({ a: ['가', 1], b: 2 }));
  assert.notEqual(recoveryEvidenceHash({ a: [1, 2] }), recoveryEvidenceHash({ a: [2, 1] }));
  assert.throws(() => canonicalRecoveryJson({ missing: undefined }), /NON_JSON/);
  assert.throws(() => canonicalRecoveryJson({ invalid: NaN }), /NON_JSON/);
});

test('missing or caller-fabricated partial evidence never authorizes mutation', () => {
  for (const evidence of [null, {}, { sourceJob: { response_payload: rejection() } }]) {
    const result = reviewSmartstoreRecoveryEvidence(evidence, {}, Date.now());
    assert.equal(result.evidenceConsistent, false);
    assert.equal(result.productionMutationAuthorized, false);
    assert.ok(result.errors.length > 0);
  }
});

test('missing trusted pins cannot be supplied by response status alone', () => {
  const evidence = { sourceJob: { response_payload: rejection() } };
  const result = reviewSmartstoreRecoveryEvidence(evidence, { sourceJob: '0'.repeat(64) }, Date.now());
  assert.ok(result.errors.includes('PIN_sourceJob'));
  assert.equal(result.next, 'collect_or_correct_evidence');
});
