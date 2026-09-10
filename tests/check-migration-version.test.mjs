import assert from 'node:assert/strict';
import test from 'node:test';
import {checkMigrationVersion} from '../scripts/check-migration-version.mjs';

test('a different migration cannot reuse an occupied version',()=>{
  assert.throws(()=>checkMigrationVersion('20260907110000_read_owned_accounts.sql',[
    '20260907110000_general_local_channel_executor.sql',
  ]),/already belongs to/);
  assert.throws(()=>checkMigrationVersion('20260907103000_exact_manual_receipt.sql',[
    '20260907103000_search_cs_archive.sql',
  ]),/already belongs to/);
});
test('the timestamp must represent a real date and time',()=>{
  for(const name of ['20260907106000_test.sql','20260230010000_test.sql','20261301010000_test.sql','20260907240000_test.sql']){
    assert.throws(()=>checkMigrationVersion(name,[]),/Invalid calendar timestamp/);
  }
});
test('an existing same filename can be rechecked without reading its SQL',()=>{
  const name='20260907151000_smartstore_scoped_publication_gate.sql';
  assert.deepEqual(checkMigrationVersion(name,[name,'20260907150000_adoption.sql']),{
    version:'20260907151000',name,
  });
});
