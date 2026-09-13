import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const fixtureUrl = new URL('./elevenst-new-product-source-approval-migration.test.mjs', import.meta.url);
const fixtureSource = await readFile(fixtureUrl, 'utf8');
const source = fixtureSource.slice(0, fixtureSource.indexOf('test("11st approval RPC'))
  .replaceAll('"import.meta.url"', '"__FIXTURE_META_URL__"')
  .replaceAll('import.meta.url', JSON.stringify(fixtureUrl.href))
  .replaceAll('__FIXTURE_META_URL__', 'import.meta.url')
  .replaceAll('import.meta.resolve("@electric-sql/pglite")', JSON.stringify(import.meta.resolve('@electric-sql/pglite')))
  .replace('  await db.exec(sourceMigration);', '')
  .replace('  await db.exec(approvalMigration);', '');
const fixture = await import(`data:text/javascript;base64,${Buffer.from(source + '\nexport { database, context, approve, approvalPayload, fixture, PRODUCT_ID };').toString('base64')}`);
const migration = await readFile(new URL('../supabase/migrations/20260913024900_restore_elevenst_approval_and_create_recovery_contracts.sql', import.meta.url), 'utf8');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
    : JSON.stringify(value);
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');

test('complete recovered 11st chain uses real approval records and verifies immutable image evidence', async () => {
  const { db, credentialId } = await fixture.database();
  try {
    // The fixture deliberately ends before the production serverless chain.
    // Production preimage guards are tested against the live catalog in a rollback transaction.
    const fixtureSql = migration.replace(/do \$recovery_guard\$[\s\S]*?end \$recovery_guard\$;/u, '');
    await db.exec(fixtureSql);
    const current = await fixture.context(db, credentialId);
    assert.ok(current, 'the actual JSON.stringify channel draft key must resolve');
    const payload = fixture.approvalPayload(current, credentialId);
    const receipts = [...current.productImagePaths, ...current.detailImagePaths].map(path => ({
      bucket: 'sellerpilot-ai', path, bytesSha256: 'a'.repeat(64), contentLength: 1234, contentType: 'image/jpeg',
    }));
    payload.providerProductSha256 = digest(payload.providerProduct);
    payload.policySource.content = {
      ...payload.policySource.content,
      htmlDetail: '<section>test</section>', htmlDetailSha256: 'b'.repeat(64), imageUrlsSha256: 'c'.repeat(64),
      productImageBucket: 'sellerpilot-ai', detailImageBucket: 'sellerpilot-ai',
      productImagePaths: current.productImagePaths, detailImagePaths: current.detailImagePaths,
      objectReceipts: receipts, objectReceiptsSha256: digest(receipts),
    };
    const bad = structuredClone(payload);
    bad.policySource.content.objectReceipts[0].path = 'another-owner/foreign.jpg';
    bad.policySource.content.objectReceiptsSha256 = digest(bad.policySource.content.objectReceipts);
    await assert.rejects(fixture.approve(db, credentialId, bad), /OBJECT_EVIDENCE_INVALID/u);
    const missing = structuredClone(payload);
    delete missing.policySource.content.objectReceipts;
    await assert.rejects(fixture.approve(db, credentialId, missing), /OBJECT_EVIDENCE_INVALID/u);
    const saved = await fixture.approve(db, credentialId, payload);
    assert.equal(saved.status, 'approved');
    const replay = await fixture.approve(db, credentialId, payload);
    assert.equal(replay.status, 'existing');
    assert.equal(replay.sourceId, saved.sourceId);
    const stored = await db.query('select policy_source from sellerpilot_private.elevenst_new_product_server_sources where id=$1', [saved.sourceId]);
    assert.deepEqual(stored.rows[0].policy_source.content.objectReceipts, receipts);
    await assert.rejects(db.query("update sellerpilot_private.elevenst_new_product_server_sources set policy_source='{}' where id=$1", [saved.sourceId]), /IMMUTABLE/u);
    const read = await db.query("select public.sellerpilot_service_elevenst_new_product_source_readback($1,$2,$3,'KR','11st') value", [fixture.fixture.ADMIN_ID, fixture.PRODUCT_ID, credentialId]);
    assert.equal(read.rows[0].value.sourceId, saved.sourceId);
    await assert.rejects(db.query("select public.sellerpilot_service_claim_elevenst_create_recovery('invalid')"), /ACCESS_DENIED/u);
    const acl = await db.query("select has_function_privilege('authenticated','public.sellerpilot_service_claim_elevenst_create_recovery(text)','EXECUTE') allowed");
    assert.equal(acl.rows[0].allowed, false);
  } finally { await db.close(); }
});
