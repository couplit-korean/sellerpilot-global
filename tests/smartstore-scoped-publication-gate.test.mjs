import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';

const release='a'.repeat(40);
const otherRelease='b'.repeat(40);
const sourceJob='10000000-0000-4000-8000-000000000001';
const otherJob='10000000-0000-4000-8000-000000000002';
const migration=await readFile(new URL('../supabase/migrations/20260907151000_smartstore_scoped_publication_gate.sql',import.meta.url),'utf8');

async function fixture(){
  const db=new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema sellerpilot_private;
    create table sellerpilot_private.listing_mutation_release_gate(
      singleton boolean primary key,is_open boolean,opened_at timestamptz,
      opened_release_sha text,opened_channel text,updated_at timestamptz,
      constraint listing_mutation_release_gate_channel_check check(opened_channel in ('qoo10','coupang'))
    );
    insert into sellerpilot_private.listing_mutation_release_gate values(true,true,now(),'${release}','coupang',now());
    create table sellerpilot_private.listing_publication_adapter_release(channel text primary key,adapter_ready boolean,contract_version text,release_sha text);
    insert into sellerpilot_private.listing_publication_adapter_release
      select channel,true,'verified_remote_state_v1','${release}' from unnest(array['qoo10','coupang','smartstore']) channel;
    create table sellerpilot_private.listing_publication_rechecker_release(singleton boolean primary key,rechecker_ready boolean,release_sha text);
    insert into sellerpilot_private.listing_publication_rechecker_release values(true,true,'${release}');
    create table sellerpilot_private.runtime_release(sha text);
    insert into sellerpilot_private.runtime_release values('${release}');
    create table sellerpilot_private.channel_gateway_jobs(id uuid primary key,channel text,operation text,status text,proof boolean default false);
    insert into sellerpilot_private.channel_gateway_jobs values('${sourceJob}','smartstore','listing.create','reconciliation_required',false);
    create table sellerpilot_private.product_listings(id uuid primary key,channel_key text,requested_publication_intent text,remote_visibility text);
    create table sellerpilot_private.listing_publication_reviews(listing_id uuid,channel text,status text);
    create function sellerpilot_private.listing_publication_review_is_current(uuid) returns boolean language sql as $$select false$$;
    create function sellerpilot_private.active_serverless_runtime_release_sha() returns text language sql as $$select sha from sellerpilot_private.runtime_release$$;
    create function sellerpilot_private.listing_mutation_release_gate_is_effective() returns boolean language sql as $$select false$$;
    create function sellerpilot_private.qoo10_exact_s1_source_reconciliation_resolved(uuid) returns boolean language sql as $$select false$$;
    create function sellerpilot_private.temu_safe_test_source_reconciliation_resolved(uuid) returns boolean language sql as $$select false$$;
    create function sellerpilot_private.smartstore_manual_adoption_reconciliation_resolved(uuid) returns boolean language sql as $$select coalesce((select proof from sellerpilot_private.channel_gateway_jobs where id=$1),false)$$;
    create function public.sellerpilot_service_listing_mutation_release_gate_status() returns jsonb language sql security definer as $$
      select jsonb_build_object('globalSentinel','preserved','reconciliationRequired',
        (select count(*) from sellerpilot_private.channel_gateway_jobs where status='reconciliation_required' and not proof))
    $$;
  `);
  await db.exec(migration);
  return db;
}

async function open(db,channel='smartstore',sha=release){
  return (await db.query('select public.sellerpilot_service_set_listing_channel_mutation_release_gate($1,true,$2) value',[channel,sha])).rows[0].value;
}

test('SmartStore scoped activation preserves jobs and rejects unverified reconciliation',async()=>{
  const db=await fixture();
  try{
    const before=(await db.query('select to_jsonb(j) value from sellerpilot_private.channel_gateway_jobs j where id=$1',[sourceJob])).rows[0].value;
    assert.equal((await db.query('select opened_channel from sellerpilot_private.listing_mutation_release_gate')).rows[0].opened_channel,'coupang');
    await assert.rejects(open(db),/reconciliations must be resolved/);
    await db.query('update sellerpilot_private.channel_gateway_jobs set proof=true where id=$1',[sourceJob]);
    const status=await open(db);
    assert.equal(status.smartstoreEffectiveOpen,true);
    assert.equal(status.smartstoreReconciliationRequired,0);
    assert.equal(status.globalSentinel,'preserved');
    const after=(await db.query('select to_jsonb(j) value from sellerpilot_private.channel_gateway_jobs j where id=$1',[sourceJob])).rows[0].value;
    assert.deepEqual({...after,proof:false},before);
    const predicates=(await db.query("select sellerpilot_private.listing_mutation_release_gate_is_effective('coupang') cp,sellerpilot_private.listing_mutation_release_gate_is_effective() global")).rows[0];
    assert.deepEqual(predicates,{cp:false,global:false});
    await db.query('update sellerpilot_private.runtime_release set sha=$1',[otherRelease]);
    assert.equal((await db.query("select sellerpilot_private.listing_mutation_release_gate_is_effective('smartstore') value")).rows[0].value,false);
    await assert.rejects(open(db),/runtime must match/);
  }finally{await db.close();}
});

test('SmartStore scope requires drained jobs, current review and exact adapter release',async()=>{
  const db=await fixture();
  try{
    await db.query('update sellerpilot_private.channel_gateway_jobs set proof=true where id=$1',[sourceJob]);
    await db.query("insert into sellerpilot_private.channel_gateway_jobs values($1,'coupang','listing.update','running',false)",[otherJob]);
    await assert.rejects(open(db),/running listing mutations must drain/);
    await db.query("update sellerpilot_private.channel_gateway_jobs set channel='smartstore',status='queued' where id=$1",[otherJob]);
    await assert.rejects(open(db),/mutation jobs must drain/);
    await db.query('delete from sellerpilot_private.channel_gateway_jobs where id=$1',[otherJob]);
    await db.query("insert into sellerpilot_private.product_listings values($1,'smartstore','live','pending_review')",[otherJob]);
    await assert.rejects(open(db),/orphan pending publication reviews/);
    await db.query('delete from sellerpilot_private.product_listings where id=$1',[otherJob]);
    await db.query("update sellerpilot_private.listing_publication_adapter_release set release_sha=$1 where channel='smartstore'",[otherRelease]);
    await assert.rejects(open(db),/components must attest/);
    await assert.rejects(open(db,'elevenst'),/unsupported scoped/);
  }finally{await db.close();}
});

test('SmartStore proof cannot exempt another channel and authenticated roles cannot open gates',async()=>{
  const db=await fixture();
  try{
    await db.query('update sellerpilot_private.channel_gateway_jobs set proof=true where id=$1',[sourceJob]);
    await db.query("insert into sellerpilot_private.channel_gateway_jobs values($1,'coupang','listing.create','reconciliation_required',true)",[otherJob]);
    await assert.rejects(open(db,'coupang'),/reconciliations must be resolved/);
    await db.query('update sellerpilot_private.channel_gateway_jobs set proof=false where id=$1',[otherJob]);
    const status=await open(db);
    assert.equal(status.smartstoreEffectiveOpen,true);
    assert.equal(status.reconciliationRequired,1);
    await db.exec('set role authenticated');
    await assert.rejects(open(db),/permission denied/);
    await db.exec('reset role; set role service_role');
    assert.equal((await open(db)).smartstoreEffectiveOpen,true);
  }finally{await db.close();}
});
