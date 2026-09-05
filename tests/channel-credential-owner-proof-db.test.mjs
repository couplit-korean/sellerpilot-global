import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const sql = await readFile(new URL("../supabase/migrations/20260906010000_verify_channel_credential_owner.sql", import.meta.url), "utf8");
const owner = "11111111-1111-4111-8111-111111111111";
const other = "33333333-3333-4333-8333-333333333333";
const id = "22222222-2222-4222-8222-222222222222";
const signature = "public.sellerpilot_verify_channel_credential_owner_v1(uuid,text,text)";
// Local in-memory PostgreSQL only. No socket, connection string, Vault or signed token.
async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create role service_role; create role unrelated;
    create schema auth; create schema sellerpilot_private;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create table sellerpilot_private.admin_users(user_id uuid primary key);
    create table sellerpilot_private.channel_credentials (
      id uuid primary key, channel text, environment text, created_by uuid,
      status text, version integer, expires_at timestamptz, fingerprint text, vault_secret_id uuid,
      rotation_interval_days integer default 90, warning_days integer default 30,
      grace_ends_at timestamptz, last_rotated_at timestamptz default now(),
      last_checked_at timestamptz, last_check_status text, last_check_message text,
      created_at timestamptz default now()
    );
    insert into sellerpilot_private.admin_users values ('${owner}'),('${other}');
    insert into sellerpilot_private.channel_credentials
      (id,channel,environment,created_by,status,version,expires_at,fingerprint,vault_secret_id) values
      ('${id}','coupang','production','${owner}','active',7,null,'never-return-fingerprint','${id}');
  `);
  // Use the real admin and shared metadata RPC bodies, not mocked authorization.
  // list_credentials matches the live body verified in the read-only review.
  const base = await readFile(new URL("../supabase/migrations/20260816060000_channel_credentials_and_roles.sql", import.meta.url), "utf8");
  for (const name of ["sellerpilot_is_admin", "sellerpilot_list_credentials"]) {
    const start = base.indexOf(`create or replace function public.${name}()`);
    await db.exec(base.slice(start, base.indexOf("$$;", start) + 3));
    await db.exec(`revoke all on function public.${name}() from public,anon; grant execute on function public.${name}() to authenticated`);
  }
  return db;
}
async function call(db, { role = "authenticated", uid = owner, credentialId = id, channel = "coupang", environment = "production" } = {}) {
  await db.query("select set_config('test.uid',$1,false)", [uid ?? ""]);
  // Role identifiers are a test-local constant allowlist, never user input.
  assert.ok(["authenticated", "anon", "service_role", "unrelated", "none"].includes(role));
  await db.exec(role === "none" ? "reset role" : `set role ${role}`);
  try {
    return (await db.query(`select public.sellerpilot_verify_channel_credential_owner_v1($1::uuid,$2,$3) as proof`, [credentialId, channel, environment])).rows[0].proof;
  } finally { await db.exec("reset role"); }
}

test("in-memory DB executes the actual migration and full positive/negative contract", async t => {
  const db = await setup();
  try {
    await db.exec(sql);
    await t.test("authenticated same-owner active credential returns exact safe fields", async () => {
      assert.deepEqual(await call(db), { contractVersion: 1, authorizationModel: "shared_admin_workspace", actorId: owner, credentialId: id, credentialOwnerId: owner, channel: "coupang", environment: "production", credentialVersion: 7, expiresAt: null });
      await db.exec(`update sellerpilot_private.channel_credentials set expires_at='2099-01-01T00:00:00Z'`);
      assert.equal(Date.parse((await call(db)).expiresAt), Date.parse("2099-01-01T00:00:00Z"));
      await db.exec("update sellerpilot_private.channel_credentials set expires_at=null");
    });
    await t.test("actual shared metadata permits another approved actor without reassigning lineage", async () => {
      await db.query("select set_config('test.uid',$1,false)", [other]);
      await db.exec("set role authenticated");
      const listed = (await db.query("select id,channel,environment,status from public.sellerpilot_list_credentials()")).rows;
      assert.deepEqual(listed, [{ id, channel: "coupang", environment: "production", status: "active" }]);
      await db.exec("reset role");
      const proof = await call(db, { uid: other });
      assert.equal(proof.actorId, other); assert.equal(proof.credentialOwnerId, owner);
      assert.equal(proof.authorizationModel, "shared_admin_workspace");
      assert.equal((await db.query("select created_by from sellerpilot_private.channel_credentials where id=$1", [id])).rows[0].created_by, owner);
      assert.equal("ownerId" in proof, false);
    });
    await t.test("ACL denies anon, PUBLIC-derived role and service_role even with owner UID", async () => {
      for (const role of ["anon", "unrelated", "service_role"]) {
        const acl = await db.query("select has_function_privilege($1,$2,'EXECUTE') as allowed", [role, signature]);
        assert.equal(acl.rows[0].allowed, false);
        await assert.rejects(call(db, {role}), { code: "42501" });
      }
      assert.equal((await db.query("select has_function_privilege('authenticated',$1,'EXECUTE') as allowed", [signature])).rows[0].allowed, true);
    });
    await t.test("UID-less authenticated, non-admin and privileged owner sessions deny", async () => {
      for (const args of [{uid:null},{uid:"44444444-4444-4444-8444-444444444444"},{role:"none"},{role:"service_role",uid:null}]) await assert.rejects(call(db,args), {code:"42501"});
      await db.exec(`delete from sellerpilot_private.admin_users where user_id='${owner}'`);
      await assert.rejects(call(db),{code:"42501"});
      await db.exec(`insert into sellerpilot_private.admin_users values('${owner}')`);
    });
    await t.test("wrong ID/channel/environment including null deny without cross-owner fallback", async () => {
      for (const args of [{credentialId:other},{credentialId:null},{channel:"shopee"},{channel:null},{environment:"sandbox"},{environment:null},{environment:"preview"}]) await assert.rejects(call(db,args), {code:"42501"});
    });
    await t.test("inactive and expired deny; changed lineage is reported separately, never synthesized", async () => {
      for (const status of ["grace","revoked","invalid"]) {
        await db.query("update sellerpilot_private.channel_credentials set status=$1",[status]);
        await assert.rejects(call(db),{code:"42501"});
      }
      await db.exec("update sellerpilot_private.channel_credentials set status='active', expires_at=clock_timestamp()");
      await assert.rejects(call(db),{code:"42501"});
      await db.exec("update sellerpilot_private.channel_credentials set expires_at='2000-01-01'");
      await assert.rejects(call(db),{code:"42501"});
      await db.exec(`update sellerpilot_private.channel_credentials set expires_at=null,created_by='${other}'`);
      const changed = await call(db);
      assert.equal(changed.actorId, owner); assert.equal(changed.credentialOwnerId, other);
      await db.exec("update sellerpilot_private.channel_credentials set created_by=null");
      await assert.rejects(call(db),{code:"42501"});
      await db.exec(`update sellerpilot_private.channel_credentials set created_by='${owner}',version=8`);
      assert.equal((await call(db)).credentialVersion,8);
    });
    await t.test("security definer and fixed search path; no authenticated secret/table access", async () => {
      const fn=(await db.query("select prosecdef,proconfig from pg_proc where oid=$1::regprocedure",[signature])).rows[0];
      assert.equal(fn.prosecdef,true); assert.deepEqual(fn.proconfig,["search_path=pg_catalog, public, sellerpilot_private"]);
      await db.exec("set role authenticated");
      await assert.rejects(db.query("select * from sellerpilot_private.channel_credentials"),{code:"42501"});
      await db.exec("reset role");
    });
    await t.test("rerun refuses rather than replacing the existing definition", async () => {
      const before=(await db.query("select pg_get_functiondef($1::regprocedure) as def",[signature])).rows[0].def;
      await assert.rejects(db.exec(sql),/CHANNEL_CREDENTIAL_OWNER_PROOF_ALREADY_DEFINED/);
      await db.exec("rollback");
      assert.equal((await db.query("select pg_get_functiondef($1::regprocedure) as def",[signature])).rows[0].def,before);
    });
  } finally { await db.close(); }
});
test("existing same-name overload also blocks migration without replacing it",async()=>{
  const db=await setup();
  try {
    await db.exec("create function public.sellerpilot_verify_channel_credential_owner_v1(text) returns text language sql as $$ select 'existing' $$");
    await assert.rejects(db.exec(sql),/CHANNEL_CREDENTIAL_OWNER_PROOF_ALREADY_DEFINED/);
    await db.exec("rollback");
    assert.equal((await db.query("select public.sellerpilot_verify_channel_credential_owner_v1('x') as value")).rows[0].value,"existing");
    assert.equal((await db.query("select to_regprocedure($1) as definition",[signature])).rows[0].definition,null);
  } finally {await db.close();}
});
test("owner contract matches tracked gateway and order-owner functions, no secret return",async()=>{
  const orders=await readFile(new URL("../supabase/migrations/20260821102500_order_product_linking.sql",import.meta.url),"utf8");
  const gateway=await readFile(new URL("../supabase/migrations/20260817054039_channel_gateway_queue.sql",import.meta.url),"utf8");
  assert.match(orders,/select c\.created_by into v_owner/);
  assert.match(gateway,/select c\.environment, c\.created_by/);
  assert.match(gateway,/p_request_payload, v_created_by/);
  assert.doesNotMatch(sql,/create or replace|vault\.|fingerprint|secret_payload|decrypt_credential/i);
});
