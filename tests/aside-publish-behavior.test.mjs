import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { stripTypeScriptTypes } from 'node:module';

// Executes exact current source blocks, not copied predicates. No DB/provider calls.
const route = readFileSync(new URL('../app/api/admin/channel-operations/route.ts', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../app/product-publish-workbench.tsx', import.meta.url), 'utf8');
function between(source, start, end) {
  const a = source.indexOf(start); const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `source boundaries: ${start}`);
  return source.slice(a, b);
}
const response = { json: (body, options) => ({ body, ...options }) };
const bindSource = between(route, '// EXTERNAL_DETAIL_SOURCE_BEGIN', '    const approvedDetail =');
async function bind({ verified = true, throws = false, target = true } = {}) {
  const receipts = [{ decodedRgbaSha256: 'synthetic-pixel-digest' }];
  const publishContext = { externalDetailImport: { status: 'approved', receipts } };
  let gets = 0;
  const result = await runInNewContext(`(async()=>{${bindSource};return {accepted:true};})()`, {
    parsed: { data: { productId: target ? 'fixture-product' : 'other', market: 'KR' } },
    externalDetailImportTarget: 'fixture-product', publishContext,
    externallyVerifiedPublishContext: verified ? publishContext : null,
    userData: { user: {} }, userClient: {}, serviceClient: {}, channel: 'smartstore', NextResponse: response,
    readExternalDetailImportContext: async () => { gets++; if (throws) throw Error('mock'); return { externalDetailImport: { status: 'approved' } }; },
  });
  return { result, publishContext, receipts, gets };
}
test('verified publish snapshot retains exact receipt identity and does not GET again', async () => {
  const r = await bind(); assert.equal(r.gets, 0);
  assert.equal(r.publishContext.externalDetailImport.receipts, r.receipts);
  assert.equal(r.publishContext.externalDetailChannel, 'smartstore');
  assert.equal(r.publishContext.externalDetailMarket, 'KR');
  assert.equal(r.publishContext.externalDetailProductId, 'fixture-product');
});
test('unverified fallback GET runs once; failure returns 409 mode rather than continuing', async () => {
  const ok = await bind({ verified: false }); assert.equal(ok.gets, 1);
  const bad = await bind({ verified: false, throws: true });
  assert.equal(bad.result.status, 409); assert.equal(bad.result.body.mode, 'external_detail_context_unavailable');
});
test('different product never takes external receipt override branch', async () => {
  const r = await bind({ target: false, verified: false }); assert.equal(r.gets, 0);
  assert.equal(r.publishContext.externalDetailImport.receipts, r.receipts);
  assert.equal(r.publishContext.detailAssetSource, undefined);
});
const predicates = between(route, '    const globalReleaseGateIsExact =', '    if (boundQoo10ExactLocalizationUpdate');
const decision = between(route, '    const channelReleaseGateIsEffective =', '\n  if (boundShopeeSgExistingUpdate?.phase === "inventory")');
function gate(status, overrides = {}) {
  return runInNewContext(`(()=>{${predicates}${decision.replace(/\n  }\s*$/, '')};return {accepted:true};})()`, {
    releaseGateStatus: status, releaseGateError: null,
    runtimeRelease: { status: 'valid', release: 'a'.repeat(40) },
    isRecord: v => Boolean(v && typeof v === 'object' && !Array.isArray(v)),
    NextResponse: response, verifiedPublicationReleaseChannels: new Set(['qoo10', 'smartstore']), channel: 'smartstore',
    qoo10ExactLocalizationUpdatePermitArmed: false, smartstoreExactQaUpdatePermitArmed: false,
    exactExistingUpdatePermitArmed: false, ebayExactAtomicEnqueueRequired: false, shopeeSgExistingUpdatePermitArmed: false,
    ...overrides,
  });
}
const sha = 'a'.repeat(40);
const open = { contract: 'verified_publication_release_gate_v1', effectiveOpen: true, open: true, state: 'open', openedChannel: null, openedRelease: sha, attestedRelease: sha, activeRuntimeRelease: sha };
test('gate accepts exact attested release and rejects each missing or mismatched response field', () => {
  assert.equal(gate(open).accepted, true);
  for (const key of Object.keys(open)) {
    const invalid = { ...open }; delete invalid[key];
    const r = gate(invalid); assert.equal(r.status, 503, key);
    assert.equal(r.body.mode, 'listing_mutation_release_gate_unavailable', key);
    assert.equal(r.headers['cache-control'], 'no-store, max-age=0');
  }
  assert.equal(gate({ ...open, activeRuntimeRelease: 'b'.repeat(40) }).status, 503);
  assert.equal(gate(open, { releaseGateError: Error('mock RPC failure') }).status, 503);
});
test('effectiveOpen false and closed gate return exact closed response; unverified scope cannot open other channel', () => {
  const closed = { contract: open.contract, open: false, state: 'closed', openedChannel: null };
  for (const s of [{ ...open, effectiveOpen: false }, closed]) {
    const r = gate(s); assert.equal(r.status, 503); assert.equal(r.body.mode, 'listing_mutation_release_gate_closed');
  }
  const scoped = { ...open, openedChannel: 'qoo10', qoo10EffectiveOpen: true, qoo10AttestedRelease: sha };
  assert.equal(gate(scoped).body.mode, 'listing_mutation_release_gate_closed');
  assert.equal(gate(scoped, { channel: 'qoo10' }).accepted, true);
});
test('closed gate requires an independently armed exception flag; malformed gate is not bypassed', () => {
  const closed = { contract: open.contract, open: false, state: 'closed', openedChannel: null };
  for (const flag of ['qoo10ExactLocalizationUpdatePermitArmed', 'smartstoreExactQaUpdatePermitArmed', 'exactExistingUpdatePermitArmed', 'ebayExactAtomicEnqueueRequired', 'shopeeSgExistingUpdatePermitArmed']) {
    assert.equal(gate(closed, { [flag]: true }).accepted, true, flag);
    assert.equal(gate({}, { [flag]: true }).body.mode, 'listing_mutation_release_gate_unavailable', flag);
  }
});
const uiFunctions = stripTypeScriptTypes(between(ui, 'export function workbenchExternalPublicationReady(', '\nexport ',).replaceAll('export function', 'function'));
const ready = runInNewContext(`${uiFunctions};workbenchExternalPublicationReady`, { productDetailImageCount: 8 });
function validExternalContext() {
  return { contentMode: 'external_generated', externalDetailImport: { status: 'approved', signedImages: Array.from({ length: 8 }, (_, i) => ({ path: `image-${i}`, url: `https://example.invalid/${i}.png` })) } };
}
test('external UI guard accepts eight distinct approved images', () => {
  assert.equal(ready(validExternalContext()), true);
});
for (const field of ['path', 'url']) {
  test(`external UI guard rejects duplicate ${field}, including whitespace-normalized duplicates`, () => {
    const c = validExternalContext();
    c.externalDetailImport.signedImages[1][field] = c.externalDetailImport.signedImages[0][field];
    assert.equal(ready(c), false);
    c.externalDetailImport.signedImages[1][field] = ` ${c.externalDetailImport.signedImages[0][field]} `;
    assert.equal(ready(c), false);
  });
  test(`external UI guard rejects empty and whitespace-only ${field}`, () => {
    for (const value of ['', ' ', String.fromCharCode(10, 9), null, undefined]) {
      const c = validExternalContext(); c.externalDetailImport.signedImages[0][field] = value;
      assert.equal(ready(c), false);
    }
  });
}
test('external UI guard rejects null images without throwing', () => {
  const c = validExternalContext(); c.externalDetailImport.signedImages[0] = null;
  assert.equal(ready(c), false);
});
test('external UI guard rejects wrong count and unapproved source', () => {
  const c = validExternalContext(); c.externalDetailImport.status = 'pending'; assert.equal(ready(c), false);
  c.externalDetailImport.status = 'approved'; c.externalDetailImport.signedImages.pop(); assert.equal(ready(c), false);
  assert.equal(ready(null), false);
});
