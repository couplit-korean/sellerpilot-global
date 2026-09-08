import { readFile, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const root = new URL('../../', import.meta.url);
const testSource = await readFile(new URL('tests/cs-commerce-boundaries-db.test.mjs', root), 'utf8');
const migration = await readFile(new URL('supabase/migrations/20260908001000_harden_cs_commerce_boundaries.sql', root), 'utf8');
const setup = testSource.slice(testSource.indexOf('const owner='), testSource.indexOf('test("CS order linkage'));
const fixture = new Function('PGlite', 'migration', `${setup}\nreturn fixture;`)(PGlite, migration);
const cases = [
 ['order_reference_changed', "update sellerpilot_private.commerce_orders set external_order_id='ORDER-CHANGED'"],
 ['order_owner_changed', "update sellerpilot_private.commerce_orders set owner_id='00000000-0000-4000-8000-000000009999'"],
 ['credential_channel_changed', "update sellerpilot_private.channel_credentials set channel='ebay'"],
];
const evidence = [];
for (const [name, statement] of cases) {
 const db = await fixture();
 try {
  await db.exec(statement);
  const row = (await db.query(`select ticket.order_id is not null as still_linked, binding.status,
    sellerpilot_private.cs_order_binding_is_exact(ticket.owner_id,ticket.channel_key,ticket.external_order_reference,ticket.source_credential_id,ticket.order_id) as actually_exact
    from sellerpilot_private.support_tickets ticket join sellerpilot_private.cs_order_bindings binding on binding.ticket_id=ticket.id`)).rows[0];
  evidence.push({name, expected:'invalid bindings are removed and no longer marked exact', observed:row, defectReproduced:row.still_linked && row.status==='exact' && !row.actually_exact});
 } finally { await db.close(); }
}
const result={mode:'isolated PGlite synthetic fixture; no production access',evidence};
await writeFile(new URL('docs/evidence/cs-progress-recheck-20260908.json',root),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
