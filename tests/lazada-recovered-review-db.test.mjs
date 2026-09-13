// Run the behavioral permission/replay/readback tests against the exact forward
// recovery, including its latest result trigger. Only live MD5 guards are omitted.
import { readFile } from 'node:fs/promises';
const fixtureUrl=new URL('./cs-lazada-product-review-reply-db.test.mjs',import.meta.url);
let source=await readFile(fixtureUrl,'utf8');
const migration=(await readFile(new URL('../supabase/migrations/20260913034000_restore_lazada_product_review_reply_contracts.sql',import.meta.url),'utf8'))
  .replace(/do \$recovery_guard\$[\s\S]*?end \$recovery_guard\$;/u,'');
source=source.replace(/const migration = await readFile\([\s\S]*?"utf8"\);/u,()=>`const migration=${JSON.stringify(migration)};`)
  .replace(/const uiMigration = await readFile\([\s\S]*?"utf8"\);/u,'const uiMigration="";')
  .replaceAll('"@electric-sql/pglite"',JSON.stringify(import.meta.resolve('@electric-sql/pglite')))
  .replaceAll('"@electric-sql/pglite/contrib/pgcrypto"',JSON.stringify(import.meta.resolve('@electric-sql/pglite/contrib/pgcrypto')));
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
