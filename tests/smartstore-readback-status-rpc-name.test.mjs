import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL(
  "../supabase/migrations/20260907170000_smartstore_readback_status_rpc_name.sql",
  import.meta.url,
), "utf8");

const oldDeclaredName = "sellerpilot_service_get_smartstore_manual_adoption_readback_status";
const oldInstalledName = oldDeclaredName.slice(0, 63);
const newName = "sellerpilot_service_get_smartstore_adoption_readback_status";

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create function public.${oldDeclaredName}(p_actor uuid,p_product_id uuid)
    returns jsonb language sql stable security definer set search_path='' as $$
      select jsonb_build_object(
        'contract','smartstore_manual_adoption_readback_enqueue_v1',
        'status','queued','productId',p_product_id,'actorId',p_actor
      )
    $$;
    revoke all on function public.${oldInstalledName}(uuid,uuid)
      from public,anon,authenticated,service_role;
    grant execute on function public.${oldInstalledName}(uuid,uuid)
      to service_role;
  `);
  return db;
}

test("170000 exposes a 59-byte PostgREST status RPC and preserves the installed 63-byte implementation", async () => {
  const db = await database();
  try {
    assert.equal(oldDeclaredName.length, 66);
    assert.equal(oldInstalledName.length, 63);
    assert.equal(newName.length, 59);
    await db.exec(migration);

    const functions = await db.query(`
      select procedure.proname,pg_get_function_identity_arguments(procedure.oid) arguments
      from pg_proc procedure join pg_namespace namespace
        on namespace.oid=procedure.pronamespace
      where namespace.nspname='public'
        and procedure.proname in ($1,$2)
      order by procedure.proname
    `,[oldInstalledName,newName]);
    assert.deepEqual(functions.rows.map((row) => row.proname), [
      newName,oldInstalledName,
    ].sort());
    assert.ok(functions.rows.every((row) => row.proname.length <= 63));
    assert.ok(functions.rows.every((row) => row.arguments === "p_actor uuid, p_product_id uuid"));

    const actor = "10000000-0000-4000-8000-000000000001";
    const product = "20000000-0000-4000-8000-000000000002";
    const result = await db.query(
      `select public.${newName}($1,$2) result`,[actor,product],
    );
    assert.equal(result.rows[0].result.status,"queued");
    assert.equal(result.rows[0].result.productId,product);
    assert.equal(result.rows[0].result.actorId,actor);

    const acl = await db.query(`
      select
        has_function_privilege('service_role',$1,'EXECUTE') service_allowed,
        has_function_privilege('anon',$1,'EXECUTE') anon_allowed,
        has_function_privilege('authenticated',$1,'EXECUTE') authenticated_allowed
    `,[`public.${newName}(uuid,uuid)`]);
    assert.equal(acl.rows[0].service_allowed,true);
    assert.equal(acl.rows[0].anon_allowed,false);
    assert.equal(acl.rows[0].authenticated_allowed,false);
    assert.match(migration,/notify pgrst, 'reload schema'/u);
  } finally {
    await db.close();
  }
});

test("170000 refuses a missing truncated implementation instead of creating a disconnected API", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon;create role authenticated;create role service_role;");
    await assert.rejects(
      db.exec(migration),
      /SMARTSTORE_READBACK_TRUNCATED_STATUS_RPC_MISSING/u,
    );
  } finally {
    await db.close();
  }
});
