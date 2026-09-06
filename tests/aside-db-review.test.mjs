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
test('DB review: published predecessor replacement has neither exact marker required by 211500', () => {
  const predecessorLocalNew = tagged(predecessor, 'new')[1];
  const expectedOld = tagged(patch, 'old')[0];
  const alreadyNew = tagged(patch, 'new')[0];
  assert.ok(predecessorLocalNew.includes("j.channel = 'shopee'"));
  assert.equal(predecessorLocalNew.split(expectedOld).length - 1, 0);
  assert.equal(predecessorLocalNew.split(alreadyNew).length - 1, 0);
  assert.ok(patch.includes("raise exception '11820 Shopee in-list marker count=%', v_old_count"));
  // This reproduces the exact string precondition mismatch, NOT PostgreSQL replay.
});
test('DB review: failed patch itself documents reliance on previous live overlay', () => {
  assert.ok(patch.includes('A previous live overlay put Shopee categories into that in-list'));
  assert.ok(patch.includes("'public.sellerpilot_11820_claim_gateway_unsafe(text,text)'::regprocedure"));
  assert.ok(patch.includes('if v_old_count <> 1 then'));
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
