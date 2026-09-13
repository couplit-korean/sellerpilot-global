import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../supabase/migrations/20260913024658_restore_lazada_create_receipts_with_byte_integrity.sql', import.meta.url), 'utf8');
const job = '91111111-1111-4111-8111-111111111111';
const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');

test('recovered Lazada receipts bind exact bytes and channel jobs, preserve replay, and deny client access', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema sellerpilot_private; create schema extensions;
      create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
      create table sellerpilot_private.products(id uuid primary key,status text,demo boolean,on_hand integer,updated_at timestamptz);
      create table sellerpilot_private.product_listings(id uuid primary key,product_id uuid,channel_key text,status text,remote_id text,updated_at timestamptz);
      create table sellerpilot_private.channel_gateway_jobs(id uuid primary key,channel text,operation text);
      insert into sellerpilot_private.channel_gateway_jobs values('${job}','lazada','listing.create');
    `);
    await db.exec(migration);
    const request = '{"상품":"검증"}';
    const response = '{"code":"0","data":{"item_id":"123"}}';
    const args = [job, 'POST', '/product/create', request, response, sha(request), sha(response)];
    const write = values => db.query('select public.sellerpilot_lzd_store_post_rcpt_r7($1,$2,$3,$4,$5,$6,$7) id', values);
    const first = await write(args);
    assert.deepEqual(await write(args), first, 'an identical retry must return the same receipt');
    await assert.rejects(() => write([...args.slice(0, 6), '0'.repeat(64)]), /BYTES_MISMATCH/);
    const changed = '{"code":"1"}';
    await assert.rejects(() => write([job, 'POST', '/product/create', request, changed, sha(request), sha(changed)]), /REPLAY_CONFLICT/);
    await db.exec(`update sellerpilot_private.channel_gateway_jobs set channel='ebay' where id='${job}'`);
    await assert.rejects(() => write(args), /JOB_MISMATCH/);
    await db.exec(`update sellerpilot_private.channel_gateway_jobs set channel='lazada' where id='${job}'`);
    const rows = await db.query('select count(*)::int n from sellerpilot_private.lazada_create_raw_receipts_r7');
    assert.equal(rows.rows[0].n, 1);
    for (const role of ['anon', 'authenticated']) {
      const grants = await db.query(`select has_function_privilege($1,'public.sellerpilot_lzd_store_post_rcpt_r7(uuid,text,text,text,text,text,text)','EXECUTE') allowed`, [role]);
      assert.equal(grants.rows[0].allowed, false);
    }
    const rls = await db.query("select relrowsecurity from pg_class where oid='sellerpilot_private.lazada_create_raw_receipts_r7'::regclass");
    assert.equal(rls.rows[0].relrowsecurity, true);
  } finally { await db.close(); }
});
