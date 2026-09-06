import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("background RPC wrappers preserve parameters and service-only access under exact names", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema sellerpilot_private;
      create function public.sellerpilot_service_enqueue_due_listing_publication_verifications(p_limit integer)
      returns jsonb language plpgsql as $$ begin
        if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then
          raise exception 'service role required';
        end if;
        if p_limit < 0 then raise exception 'invalid limit'; end if;
        return jsonb_build_object('limit',p_limit);
      end $$;
      create function public.sellerpilot_service_complete_marketplace_normalized_asset_cleanup(
        p_claim_token uuid,p_removed_paths text[],p_error text
      ) returns jsonb language sql as $$ select jsonb_build_object('token',p_claim_token,'paths',p_removed_paths,'error',p_error) $$;
    `);
    const roleSource=await readFile(new URL("../supabase/migrations/20260907031500_product_registration_role_claims.sql",import.meta.url),"utf8");
    await db.exec(roleSource.slice(roleSource.indexOf("create or replace function sellerpilot_private.request_has_unambiguous_service_role_claim()"),roleSource.indexOf("do $migration$")));
    await db.exec(await readFile(new URL("../supabase/migrations/20260907172000_postgrest_safe_background_rpc_names.sql",import.meta.url),"utf8"));
    await db.exec(`select set_config('request.jwt.claim.role','',false),set_config('request.jwt.claims','{"role":"service_role"}',false);`);
    const result = await db.query(`select
      public.sellerpilot_service_enqueue_due_publication_reviews(7) as publication,
      public.sellerpilot_service_complete_normalized_asset_cleanup(
        '10000000-0000-4000-8000-000000000001',array['normalized/ab/example.jpg'],'storage_remove_failed'
      ) as cleanup`);
    assert.deepEqual(result.rows[0].publication,{limit:7});
    assert.deepEqual(result.rows[0].cleanup,{token:"10000000-0000-4000-8000-000000000001",paths:["normalized/ab/example.jpg"],error:"storage_remove_failed"});
    assert.equal((await db.query("select current_setting('request.jwt.claim.role',true) role")).rows[0].role,"");
    await assert.rejects(db.query("select public.sellerpilot_service_enqueue_due_publication_reviews(-1)"),/invalid limit/u);
    assert.equal((await db.query("select current_setting('request.jwt.claim.role',true) role")).rows[0].role,"");
    for (const [legacy,claims] of [["",""],["","invalid-json"],["service_role",'{"role":"authenticated"}'],["anon",'{"role":"service_role"}']]) {
      await db.query("select set_config('request.jwt.claim.role',$1,false),set_config('request.jwt.claims',$2,false)",[legacy,claims]);
      await assert.rejects(db.query("select public.sellerpilot_service_enqueue_due_publication_reviews(1)"),/service role required/u);
    }
    for (const [name,args] of [
      ["sellerpilot_service_enqueue_due_publication_reviews","integer"],
      ["sellerpilot_service_complete_normalized_asset_cleanup","uuid,text[],text"],
    ]) {
      const row=(await db.query(`select proname,
        has_function_privilege('anon',oid,'execute') as anon,
        has_function_privilege('authenticated',oid,'execute') as authenticated,
        has_function_privilege('service_role',oid,'execute') as service
        from pg_proc where oid=$1::regprocedure`,[`public.${name}(${args})`])).rows[0];
      assert.equal(row.proname,name);
      assert.equal(row.anon,false);assert.equal(row.authenticated,false);assert.equal(row.service,true);
    }
    await db.exec(`select set_config('request.jwt.claim.role','',false),set_config('request.jwt.claims','{"role":"service_role"}',false);set role service_role;`);
    assert.equal((await db.query("select public.sellerpilot_service_enqueue_due_publication_reviews(3) result")).rows[0].result.limit,3);
    await db.exec("reset role;set role anon;");
    await assert.rejects(db.query("select public.sellerpilot_service_enqueue_due_publication_reviews(3)"),/permission denied/u);
    await db.exec("reset role;set role authenticated;");
    await assert.rejects(db.query("select public.sellerpilot_service_enqueue_due_publication_reviews(3)"),/permission denied/u);
  } finally { await db.close(); }
});
