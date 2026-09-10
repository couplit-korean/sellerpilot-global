import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
// Explicit allowlist only. No migration directory discovery and no SQL execution.
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const predecessor = read('20260830200000_require_static_egress_for_shopee.sql');
const patch = read('20260904211500_allow_local_shopee_category_and_diagnostic_claims.sql');
const gate = read('20260906070000_evidence_based_global_publication_gate_counters.sql');
function tagged(source, tag) {
  const matches = [...source.matchAll(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`, 'g'))];
  return matches.map(m => m[1]);
}
test('DB review: 211500 accepts the exact published predecessor without weakening unknown drift', () => {
  const predecessorLocalNew = tagged(predecessor, 'new')[1];
  const expectedOld = tagged(patch, 'old')[0];
  const alreadyNew = tagged(patch, 'new')[0];
  const publishedPredecessor = tagged(patch, 'published')[0];
  assert.equal(predecessorLocalNew.split(expectedOld).length - 1, 0);
  assert.equal(predecessorLocalNew.split(alreadyNew).length - 1, 0);
  assert.equal(predecessorLocalNew, publishedPredecessor);
  assert.ok(publishedPredecessor.includes("j.channel = 'shopee'"));
  assert.ok(patch.includes('v_published_predecessor_count = 1'));
  assert.ok(patch.includes('and v_attr_old_count = 0'));
  assert.ok(patch.includes('and v_attr_new_count = 0 then'));
  assert.ok(patch.includes("'11820 Shopee marker cardinality drift old=%, new=%, published=%, attr_old=%, attr_new=%'"));
});
test('DB review: operator marker branches have explicit cardinality', () => {
  assert.ok(patch.includes('A previous live overlay put Shopee categories into that in-list'));
  assert.ok(patch.includes("'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure"));
  assert.match(patch, /elsif v_old_count = 1[\s\S]*?v_attr_old_count = 3[\s\S]*?v_attr_new_count = 0 then/);
  assert.match(patch, /elsif v_old_count = 0[\s\S]*?v_new_count = 1[\s\S]*?v_attr_old_count = 0[\s\S]*?v_attr_new_count = 3 then/);
});
test('DB review: gate response inherits base fields, so old broad substring test cannot prove response schema', () => {
  const start = gate.indexOf('CREATE OR REPLACE FUNCTION public.sellerpilot_service_listing_mutation_release_gate_status()');
  const end = gate.indexOf('CREATE OR REPLACE FUNCTION public.sellerpilot_service_set_listing_mutation_release_gate', start);
  const status = gate.slice(start, end);
  assert.ok(status.includes('sellerpilot_301100_listing_gate_status_pre_publication_review()'));
  for (const inherited of ['contract', 'open', 'state', 'openedAt', 'updatedAt']) {
    assert.equal(status.includes(`'${inherited}'`), false, `${inherited} depends on baseline function, not this wrapper`);
  }
  assert.ok(status.includes("'effectiveOpen'"));
  assert.ok(status.includes("'reconciliationRequired'"));
});
