import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
const prior=await readFile(new URL('../supabase/migrations/20260912210928_route_lazada_to_local_egress.sql',import.meta.url),'utf8');
const previousFunction=prior.match(/CREATE OR REPLACE FUNCTION[\s\S]+?\$function\$;/)[0];
const migration=await readFile(new URL('../supabase/migrations/20260912224310_pin_registered_egress_reads_to_local.sql',import.meta.url),'utf8');
test('six registered-egress channels cannot be claimed in cloud while other operation gates are preserved',async()=>{
 const db=new PGlite();try{
  await db.exec(`create schema sellerpilot_private;create role anon;create role authenticated;create role service_role;
  create function sellerpilot_private.serverless_gateway_job_allowed_before_coupang_create_reconciliation(text,text) returns boolean language sql as $$select $2 in ('diagnostic.test','orders.list','inquiries.list','listing.update')$$;`);
  await db.exec(previousFunction);
  const channels=['coupang','smartstore','elevenst','shopee','lazada','temu','qoo10','ebay'];
  const writes=['listing.create','listing.update','inquiries.reply','shipment.confirm','listing.lineage.verify'];
  const call=async(c,o)=>(await db.query('select sellerpilot_private.serverless_gateway_job_allowed($1,$2) allowed',[c,o])).rows[0].allowed;
  const before=new Map();for(const c of channels)for(const o of writes)before.set(c+o,await call(c,o));
  assert.equal(await call('smartstore','orders.list'),true);
  await db.exec(migration);
  for(const c of channels){
   for(const o of ['diagnostic.test','orders.list','inquiries.list'])assert.equal(await call(c,o),['qoo10','ebay'].includes(c),`${c}:${o}`);
   for(const o of writes)assert.equal(await call(c,o),before.get(c+o),`${c}:${o} changed`);
  }
  for(const role of ['anon','authenticated','service_role']) assert.equal((await db.query("select has_function_privilege($1,'sellerpilot_private.serverless_gateway_job_allowed(text,text)','EXECUTE') allowed",[role])).rows[0].allowed,false);
 }finally{await db.close();}
});
