import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration=await readFile(new URL('../supabase/migrations/20260912200128_index_gateway_reconciliation_guard.sql',import.meta.url),'utf8');
const lookup=`select j.id from sellerpilot_private.channel_gateway_jobs j
 join sellerpilot_private.channel_credentials c on c.id=j.credential_id
 where c.channel='shopee' and c.environment='production'
 and j.status='reconciliation_required'
 and (j.credential_refresh_in_flight or j.credential_refresh_recovery_vault_id is not null
   or (j.operation='oauth.exchange' and j.prepared_credential_id is not null and not j.oauth_exchange_completed))`;

function nodes(plan) { return [plan,...(plan.Plans??[]).flatMap(nodes)]; }

test('partial reconciliation index preserves guard results and avoids scanning completed queue history',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`
   create role anon;create role authenticated;create role service_role;
   create schema sellerpilot_private;
   create table sellerpilot_private.channel_credentials(id bigint primary key,channel text,environment text);
   insert into sellerpilot_private.channel_credentials values(1,'shopee','production'),(2,'lazada','production'),(3,'shopee','sandbox');
   create table sellerpilot_private.channel_gateway_jobs(
    id bigint primary key,credential_id bigint references sellerpilot_private.channel_credentials(id),
    channel text,environment text,operation text,status text,credential_refresh_in_flight boolean default false,
    credential_refresh_recovery_vault_id uuid,prepared_credential_id uuid,oauth_exchange_completed boolean default false
   );
   alter table sellerpilot_private.channel_gateway_jobs enable row level security;
   insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,channel,environment,operation,status)
   select i,1,'shopee','production','inquiries.list','succeeded' from generate_series(1,50000) i;
   insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,channel,environment,operation,status,credential_refresh_in_flight)
   select 50000+i,c.id,c.channel,c.environment,'oauth.exchange','reconciliation_required',true
   from generate_series(1,15) i join sellerpilot_private.channel_credentials c on c.id=1+(i%3);
   insert into sellerpilot_private.channel_gateway_jobs(id,credential_id,channel,environment,operation,status)
   values(60001,1,'shopee','production','oauth.exchange','running'),(60002,1,'shopee','production','oauth.exchange','queued');
   analyze sellerpilot_private.channel_gateway_jobs;analyze sellerpilot_private.channel_credentials;
  `);
  const before=(await db.query(lookup+' order by j.id')).rows;
  assert.equal(before.length,5);
  const oldPlan=(await db.query('explain(format json) '+lookup)).rows[0]['QUERY PLAN'][0].Plan;
  assert.ok(nodes(oldPlan).some(n=>n['Node Type']==='Seq Scan' && n['Relation Name']==='channel_gateway_jobs'));
  const distribution=(await db.query('select status,count(*) from sellerpilot_private.channel_gateway_jobs group by status order by status')).rows;
  await db.exec(migration);
  assert.deepEqual((await db.query(lookup+' order by j.id')).rows,before);
  assert.deepEqual((await db.query('select status,count(*) from sellerpilot_private.channel_gateway_jobs group by status order by status')).rows,distribution);
  const newPlan=(await db.query('explain(format json) '+lookup)).rows[0]['QUERY PLAN'][0].Plan;
  assert.ok(nodes(newPlan).some(n=>n['Index Name']==='channel_gateway_jobs_reconciliation_lookup_idx'));
  assert.equal(nodes(newPlan).some(n=>n['Node Type']==='Seq Scan'&&n['Relation Name']==='channel_gateway_jobs'),false);
  const index=(await db.query("select c.reltuples::integer rows,i.indisvalid from pg_class c join pg_index i on i.indexrelid=c.oid where c.relname='channel_gateway_jobs_reconciliation_lookup_idx'")).rows[0];
  assert.equal(index.indisvalid,true);
  // ANALYZE samples; reltuples is an estimate, not an exact index row count.
  assert.ok(index.rows>0 && index.rows<100);
  assert.equal((await db.query("select count(*)::integer count from sellerpilot_private.channel_gateway_jobs where status='reconciliation_required'")).rows[0].count,15);
  for(const role of ['anon','authenticated','service_role']) {
   assert.equal((await db.query("select has_table_privilege($1,'sellerpilot_private.channel_gateway_jobs','select') allowed",[role])).rows[0].allowed,false);
  }
 } finally { await db.close(); }
});
