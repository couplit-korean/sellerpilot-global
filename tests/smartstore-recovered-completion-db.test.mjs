import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const fixtureUrl = new URL('./smartstore-create-final-transport-r4.test.mjs', import.meta.url);
const source = await readFile(fixtureUrl, 'utf8');
const recovery = await readFile(new URL('../supabase/migrations/20260913032500_restore_smartstore_create_source_and_completion_contracts.sql', import.meta.url), 'utf8');
const transportSql = 'begin;\n' + recovery.slice(recovery.indexOf('-- Reviewed source: 20260910050500'));
const declarations = source.slice(0, source.indexOf('test("reserved SmartStore'))
  + source.slice(source.indexOf('async function complete('), source.indexOf('test("atomic SmartStore'));
const moduleSource = declarations
  .replace(/const migration = await readFile\([\s\S]*?"utf8"\);/u, () => `const migration = ${JSON.stringify(transportSql)};`)
  .replaceAll('"@electric-sql/pglite"', JSON.stringify(import.meta.resolve('@electric-sql/pglite')))
  .replaceAll('"@electric-sql/pglite/contrib/pgcrypto"', JSON.stringify(import.meta.resolve('@electric-sql/pglite/contrib/pgcrypto')))
  .replaceAll('"../lib/channels/smartstore-create-transport.ts"', JSON.stringify(new URL('../lib/channels/smartstore-create-transport.ts', import.meta.url).href));
const fixture = await import(`data:text/javascript;base64,${Buffer.from(moduleSource + '\nexport {createDatabase,stage,complete,ids};').toString('base64')}`);

test('recovered SmartStore transport rejects missing required fields and completes only the exact owned lineage', async () => {
  const {db,body}=await fixture.createDatabase();
  try {
    await db.exec("alter table sellerpilot_private.channel_gateway_jobs add constraint production_status check(status in ('queued','running','succeeded','failed','cancelled','reconciliation_required'))");
    await db.query("update sellerpilot_private.products set status='active'");
    await db.exec("alter table sellerpilot_private.products add constraint production_product_status check(status in ('draft','active','low_stock','out_of_stock','archived'))");
    await assert.rejects(fixture.stage(db,body), /TRANSPORT_SOURCE_DRIFT/u);
    const stateFix=(await readFile(new URL('../supabase/migrations/20260913035500_align_smartstore_create_with_production_product_state.sql',import.meta.url),'utf8'))
      .replace('v_oid:=to_regprocedure(r.signature);','v_oid:=to_regprocedure(r.signature); if v_oid is null then continue;end if;');
    // This transport-only fixture omits the five category/predecessor functions.
    // The production rollback applies all eight exact MD5-guarded replacements.
    await db.exec(stateFix);
    const missing=structuredClone(body);delete missing.smartstoreChannelProduct.naverShoppingRegistration;
    await assert.rejects(fixture.stage(db,missing), /TRANSPORT_SOURCE_DRIFT/u);
    await db.query("update sellerpilot_private.channel_gateway_jobs set request_payload=request_payload #- '{arguments,sellerpilotSmartstoreCreateSource,contract}' where id=$1",[fixture.ids.job]);
    await assert.rejects(fixture.stage(db,body), /TRANSPORT_SOURCE_DRIFT/u);
    await db.query("update sellerpilot_private.channel_gateway_jobs set request_payload=jsonb_set(request_payload,'{arguments,sellerpilotSmartstoreCreateSource,contract}','\"smartstore_listing_create_source_v1\"') where id=$1",[fixture.ids.job]);
    await fixture.stage(db,body);
    await assert.rejects(fixture.complete(db,body,{channelProductNo:'10000001'}), /COMPLETION_RECEIPT_INVALID/u);
    await db.query('update sellerpilot_private.product_listings set owner_id=$1 where id=$2',[fixture.ids.product,fixture.ids.listing]);
    await assert.rejects(fixture.complete(db,body), /COMPLETION_SOURCE_MISMATCH/u);
    await db.query('update sellerpilot_private.product_listings set owner_id=$1 where id=$2',[fixture.ids.owner,fixture.ids.listing]);
    assert.equal((await fixture.complete(db,body)).rows[0].completed.status,'completed');
    assert.equal((await fixture.complete(db,body)).rows[0].completed.reused,true);
    assert.equal((await db.query('select status from sellerpilot_private.channel_gateway_jobs where id=$1',[fixture.ids.job])).rows[0].status,'succeeded');
    const rows=await db.query('select status,remote_id from sellerpilot_private.product_listings where id=$1',[fixture.ids.listing]);
    assert.deepEqual(rows.rows,[{status:'published',remote_id:'10000001'}]);
  } finally {await db.close();}
});
