import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const before=await readFile(new URL('./fixtures/lazada-serverless-policy-before.sql',import.meta.url),'utf8');
const migration=await readFile(new URL('../supabase/migrations/20260912210928_route_lazada_to_local_egress.sql',import.meta.url),'utf8');
test('Lazada cannot be stolen by the cloud claimant; other delegated operations retain their decisions',async()=>{
 const db=new PGlite();try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema sellerpilot_private;
  create function sellerpilot_private.serverless_gateway_job_allowed_before_coupang_create_reconciliation(text,text) returns boolean language sql as $$select $2 in ('orders.list','inquiries.list','diagnostic.test','listing.create')$$;`);
  await db.exec(before);
  assert.equal((await db.query("select sellerpilot_private.serverless_gateway_job_allowed('lazada','orders.list') allowed")).rows[0].allowed,true);
  await db.exec(migration);
  for(const channel of ['lazada','qoo10','ebay','coupang','smartstore','elevenst','shopee','temu']){
   for(const operation of ['orders.list','inquiries.list','diagnostic.test','listing.create']){
    assert.equal((await db.query('select sellerpilot_private.serverless_gateway_job_allowed($1,$2) allowed',[channel,operation])).rows[0].allowed,channel!=='lazada');
   }
  }
  assert.equal((await db.query("select sellerpilot_private.serverless_gateway_job_allowed('coupang','listing.lineage.verify') allowed")).rows[0].allowed,true);
  assert.equal((await db.query("select sellerpilot_private.serverless_gateway_job_allowed('ebay','unsupported') allowed")).rows[0].allowed,false);
  await assert.rejects(db.exec(migration),/LAZADA_SERVERLESS_POLICY_PREIMAGE_CHANGED/);await db.exec('rollback');
 }finally{await db.close();}
});
