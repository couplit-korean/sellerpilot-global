import assert from 'node:assert/strict';
import test from 'node:test';
import { createGatewayMutationBoundary } from '../scripts/gateway-mutation-boundary.mjs';

test('image upload and subsequent listing PUT share one consumed claim boundary', async () => {
  let registrations = 0;
  let started = false;
  let validLease = true;
  const mark = createGatewayMutationBoundary({
    reuseRegistration: true,
    assertLeaseHealthy: async () => { if (!validLease) throw new Error('lease lost'); },
    persist: async () => { assert.equal(++registrations, 1, 'permit already consumed'); },
    onStarted: () => { started = true; },
  });
  await Promise.all([mark(), mark()]);
  assert.equal(started, true);
  await mark();
  assert.equal(registrations, 1);
  validLease = false;
  await assert.rejects(mark(), /lease lost/);
});

test('failed authorization is retained and cannot be retried as a new boundary', async () => {
  let registrations = 0;
  let started = false;
  const mark = createGatewayMutationBoundary({
    reuseRegistration: true,
    assertLeaseHealthy: async () => {},
    persist: async () => { registrations++; throw new Error('authorization denied'); },
    onStarted: () => { started = true; },
  });
  await assert.rejects(mark(), /authorization denied/);
  await assert.rejects(mark(), /authorization denied/);
  assert.equal(registrations, 1);
  assert.equal(started, false);
});

test('persisted write uncertainty survives lease loss after registration', async () => {
  let started = false;
  const mark = createGatewayMutationBoundary({
    reuseRegistration: true,
    assertLeaseHealthy: async () => { if (started) throw new Error('lease lost after persist'); },
    persist: async () => {},
    onStarted: () => { started = true; },
  });
  await assert.rejects(mark(), /lease lost after persist/);
  assert.equal(started, true);
});

test('other jobs preserve fresh authorization for every provider write', async () => {
  let registrations = 0;
  let writes = 0;
  const mark = createGatewayMutationBoundary({
    assertLeaseHealthy: async () => {},
    persist: async () => { if (++registrations === 2) throw new Error('second fence rejected'); },
    onStarted: () => {},
  });
  await mark();
  writes++;
  await assert.rejects(async () => { await mark(); writes++; }, /second fence rejected/);
  assert.equal(registrations, 2);
  assert.equal(writes, 1);
});
