import assert from 'node:assert/strict';
import test from 'node:test';
import { serverlessCsRepairInquiryEnqueues, serverlessCsCurrentInquiryEnqueues } from '../lib/cs/operations/schedule.ts';
const routes = ['coupang','elevenst','smartstore','temu'] as const;
test('hourly catch-up offers keep identical daily history keys and ranges', () => {
  const baseline = serverlessCsRepairInquiryEnqueues(new Date('2026-09-12T15:00:00.000Z'), routes);
  for (const time of ['2026-09-12T16:00:00.758Z', '2026-09-13T07:02:03.915Z', '2026-09-13T14:04:59.999Z']) {
    assert.deepEqual(serverlessCsRepairInquiryEnqueues(new Date(time), routes), baseline,
      'same KST day must reuse DB periodicKey cooldown instead of creating hourly history queues');
  }
  assert.equal(baseline.filter(x=>x.channel==='ebay').length,37);
});
test('repair anchor advances at KST midnight; current inquiry windows retain actual time', () => {
  const before = serverlessCsRepairInquiryEnqueues(new Date('2026-09-13T14:02:00Z'), routes);
  const after = serverlessCsRepairInquiryEnqueues(new Date('2026-09-13T15:02:00Z'), routes);
  assert.notDeepEqual(before.filter(x=>x.channel==='ebay'),after.filter(x=>x.channel==='ebay'));
  assert.deepEqual(serverlessCsRepairInquiryEnqueues(new Date('2026-09-13T07:05:00Z'),routes),[]);
  const early=serverlessCsCurrentInquiryEnqueues(new Date('2026-09-13T01:00:00Z'),routes);
  const late=serverlessCsCurrentInquiryEnqueues(new Date('2026-09-13T07:00:00Z'),routes);
  assert.notDeepEqual(early,late,'current reads must cover the current day beyond the fixed repair cutoff');
});
