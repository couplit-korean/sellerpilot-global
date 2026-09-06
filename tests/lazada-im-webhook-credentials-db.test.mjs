import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
const sql = await readFile(new URL("../supabase/migrations/20260906011000_route_lazada_im_webhook_credentials.sql", import.meta.url), "utf8");
const signature = "public.sellerpilot_service_lazada_im_webhook_candidates_v1(text)";
async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create role unrelated;
    create schema sellerpilot_private; create schema vault;
    create table sellerpilot_private.channel_credentials(id uuid primary key,created_by uuid,channel text,environment text,status text,expires_at timestamptz,vault_secret_id uuid);
    create table vault.secrets(id uuid primary key,secret text);
    create view vault.decrypted_secrets as select id,secret as decrypted_secret from vault.secrets;
    create function public.sellerpilot_get_active_credential_secret(text,text) returns text language sql as $$ select 'untouched' $$;
  `);
  return db;
}
async function seed(db, number, patch = {}, secretPatch = {}) {
  const id = `00000000-0000-4000-8000-${String(number).padStart(12,"0")}`;
  const row = { channel: "lazada", environment: "production", status: "active", expires_at: null, ...patch };
  const secret = { im_app_key: "im-app", im_app_secret: "fixture-im-secret", app_key: "commerce-app", app_secret: "MUST-NOT-RETURN", access_token: "MUST-NOT-RETURN", im_access_token: "MUST-NOT-RETURN", country: "my", ...secretPatch };
  await db.query("insert into vault.secrets values($1,$2)",[id,JSON.stringify(secret)]);
  await db.query("insert into sellerpilot_private.channel_credentials values($1,$2,$3,$4,$5,$6,$1)",[id, number%2 ? "11111111-1111-4111-8111-111111111111" : "22222222-2222-4222-8222-222222222222",row.channel,row.environment,row.status,row.expires_at]);
  return id;
}
async function call(db, selector = null, role = "service_role") {
  assert.ok(["service_role","anon","authenticated","unrelated","none"].includes(role));
  await db.exec(role === "none" ? "reset role" : `set role ${role}`);
  try { return (await db.query("select public.sellerpilot_service_lazada_im_webhook_candidates_v1($1) as result",[selector])).rows[0].result; }
  finally { await db.exec("reset role"); }
}
test("actual additive migration: service-only bounded IM candidate contract", async t => {
  const db = await setup();
  try {
    await db.exec(sql);
    const id = await seed(db,1);
    await seed(db,2,{}, { im_app_key: "other-app" });
    await seed(db,3,{channel:"shopee"}); await seed(db,4,{environment:"sandbox"});
    await seed(db,5,{status:"grace"}); await seed(db,6,{expires_at:"2000-01-01"});
    await seed(db,7,{}, {im_app_secret:""}); await seed(db,8,{}, {im_app_key:null});
    await t.test("filters channel, production, active, expiry and explicit IM pair only; minimal secrets",async()=>{
      const result = await call(db);
      assert.equal(result.contract,"lazada_im_webhook_candidates_v1"); assert.equal(result.limit,32); assert.equal(result.overflow,false); assert.equal(result.candidates.length,2);
      assert.deepEqual((await call(db,"im-app")).candidates.map(r=>r.credential_id),[id]);
      assert.equal((await call(db,"unknown")).candidates.length,0);
      assert.equal((await call(db,"commerce-app")).candidates.length,0);
      assert.doesNotMatch(JSON.stringify(result),/MUST-NOT-RETURN|access_token|created_by/);
      assert.equal(result.candidates[0].secret_payload.provider_account_subject,null);
      assert.equal((await db.query("select public.sellerpilot_get_active_credential_secret('x','x') as v")).rows[0].v,"untouched");
      await assert.rejects(call(db," "),{code:"22023"});
    });
    await t.test("ACL and real role guard deny anon/authenticated/PUBLIC even with forged JWT role",async()=>{
      await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
      for (const role of ["anon","authenticated","unrelated","none"]) await assert.rejects(call(db,null,role),{code:"42501"});
      for (const role of ["anon","authenticated","unrelated"]) assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') as ok",[role,signature])).rows[0].ok,false);
      assert.equal((await db.query("select has_function_privilege('service_role',$1,'EXECUTE') as ok",[signature])).rows[0].ok,true);
      for (const role of ["anon","authenticated","service_role"]) {
        await db.exec(`set role ${role}`);
        await assert.rejects(db.query("select * from vault.decrypted_secrets"),{code:"42501"});
        await assert.rejects(db.query("select * from sellerpilot_private.channel_credentials"),{code:"42501"});
        await db.exec("reset role");
      }
      const fn=(await db.query("select prosecdef,proconfig from pg_proc where oid=$1::regprocedure",[signature])).rows[0];
      assert.equal(fn.prosecdef,true); assert.deepEqual(fn.proconfig,["search_path=pg_catalog"]);
    });
    await t.test("32 candidates are complete; 33+ is overflow without leaked prefix; selector narrows before bound",async()=>{
      for(let n=10;n<40;n++) await seed(db,n);
      assert.equal((await call(db)).candidates.length,32);
      await seed(db,40);
      assert.deepEqual(await call(db),{contract:"lazada_im_webhook_candidates_v1",limit:32,overflow:true,candidates:[]});
      assert.equal((await call(db,"im-app")).candidates.length,32);
      await seed(db,41);
      assert.equal((await call(db,"im-app")).overflow,true);
      assert.equal((await call(db,"other-app")).candidates.length,1);
    });
    await t.test("rerun does not overwrite the existing function",async()=>{
      const before=(await db.query("select pg_get_functiondef($1::regprocedure) as def",[signature])).rows[0].def;
      await assert.rejects(db.exec(sql),/LAZADA_IM_WEBHOOK_CANDIDATES_ALREADY_DEFINED/); await db.exec("rollback");
      assert.equal((await db.query("select pg_get_functiondef($1::regprocedure) as def",[signature])).rows[0].def,before);
    });
  } finally {await db.close();}
});
test("same-name overload blocks installation instead of overwriting definitions",async()=>{
  const db=await setup(); try {
    await db.exec("create function public.sellerpilot_service_lazada_im_webhook_candidates_v1(integer) returns integer language sql as $$ select 7 $$");
    await assert.rejects(db.exec(sql),/LAZADA_IM_WEBHOOK_CANDIDATES_ALREADY_DEFINED/); await db.exec("rollback");
    assert.equal((await db.query("select to_regprocedure($1) as fn",[signature])).rows[0].fn,null);
    assert.equal((await db.query("select public.sellerpilot_service_lazada_im_webhook_candidates_v1(1) as v")).rows[0].v,7);
  } finally {await db.close();}
});
