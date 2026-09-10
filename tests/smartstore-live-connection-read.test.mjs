import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diagnoseSmartstore, runCli } from '../scripts/smartstore-live-connection-read.mjs';
const credential = { client_id: 'fixture-app', client_secret: 'SYNTHETIC_SECRET_DO_NOT_OUTPUT', token_type: 'SELF' };
const options = { expectedAppId: 'fixture-app', expectedEgressIp: '192.0.2.1', allowTokenOnce: true };
function fixture(overrides = {}) {
  const calls = [];
  const io = { now: () => '2026-09-06T00:00:00Z', getEgressIp: async () => '192.0.2.1',
    issueToken: async () => { calls.push('token'); return { accessToken: 'SYNTHETIC_TOKEN_DO_NOT_OUTPUT', expiresAt: '2026-09-06T03:00:00Z', remote: { response: new Response('{}', { status: 200 }) } }; },
    getAccount: async () => { calls.push('account'); return { response: new Response('{}', { status: 200 }), data: { accountId: 'ncp_fixture', accountNo: 1234, access_token: 'SYNTHETIC_TOKEN_DO_NOT_OUTPUT', client_secret: credential.client_secret, accountName: 'not an identifier', nested: { token: 'SECRET' } }, text: 'PRIVATE_RAW_RESPONSE' }; }, ...overrides };
  return { io, calls };
}
test('actual naverRequest wrapper response.ok succeeds; only allowed evidence fields leave', async () => {
  const { io, calls } = fixture(); const result = await diagnoseSmartstore(credential, options, io);
  assert.deepEqual(calls, ['token', 'account']); assert.deepEqual(result.sellerIdentifiers, { accountId: 'ncp_fixture', accountNo: 1234 });
  assert.deepEqual(Object.keys(result).sort(), ['http', 'sellerIdentifiers', 'appId', 'egressIp', 'tokenExpired', 'credentialExpired'].sort());
  assert.deepEqual(result.http.map(row => row.status), [200, 200]);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC|PRIVATE_RAW|client_secret|access_token|nested|accountName/);
});
test('usable staged token means zero token exchanges', async () => {
  const { io, calls } = fixture(); await diagnoseSmartstore({ ...credential, access_token: 'staged', access_token_expires_at: '2026-09-06T03:00:00Z' }, options, io); assert.deepEqual(calls, ['account']);
});
test('wrong app, expired credential, unproved SELLER or wrong egress fail before auth', async () => {
  for (const changed of [{ ...credential, client_id: 'wrong' }, { ...credential, credential_expires_at: '2000-01-01' }, { ...credential, token_type: 'SELLER', account_id: 'unproved' }]) {
    const { io, calls } = fixture(); await assert.rejects(diagnoseSmartstore(changed, options, io)); assert.deepEqual(calls, []);
  }
  const { io, calls } = fixture({ getEgressIp: async () => '192.0.2.2' }); await assert.rejects(diagnoseSmartstore(credential, options, io), /EGRESS_MISMATCH/); assert.deepEqual(calls, []);
});
test('token exchange requires explicit permission', async () => {
  const { io, calls } = fixture(); await assert.rejects(diagnoseSmartstore(credential, { ...options, allowTokenOnce: false }, io), /TOKEN_AUTHORIZATION_REQUIRED/); assert.deepEqual(calls, []);
});
test('non-200 or missing/mismatched identity is never called a successful read', async () => {
  for (const remote of [{ response: new Response('PRIVATE', { status: 401 }), data: { accountId: 'x' } }, { response: new Response('{}'), data: { client_secret: credential.client_secret } }]) {
    const { io } = fixture({ getAccount: async () => remote }); await assert.rejects(diagnoseSmartstore(credential, options, io), /SELLER_ACCOUNT_HTTP_FAILURE|SELLER_IDENTITY_MISSING/);
  }
  const { io } = fixture(); await assert.rejects(diagnoseSmartstore(credential, { ...options, expectedAccountId: 'wrong' }, io), /SELLER_IDENTITY_MISMATCH/);
});
test('CLI persists only safe result and deletes private credential on success and failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'smartstore-cli-test-'));
  try {
    for (const success of [true, false]) {
      const privateDir = join(root, success ? 'success' : 'failure'); await mkdir(privateDir, { mode: 0o700 });
      const file = join(privateDir, 'credential.json'); await writeFile(file, JSON.stringify(credential), { mode: 0o600 });
      const output = join(root, success ? 'result.json' : 'must-not-exist.json'); const { io } = fixture(success ? {} : { getAccount: async () => { throw new Error('PRIVATE_SECRET_ERROR'); } });
      const argv = ['--credential-file', file, '--output', output, '--expected-app-id', 'fixture-app', '--expected-egress-ip', '192.0.2.1', '--allow-token-once'];
      if (success) { await runCli(argv, io); assert.doesNotMatch(await readFile(output, 'utf8'), /SYNTHETIC|PRIVATE_RAW|client_secret|access_token/); }
      else { await assert.rejects(runCli(argv, io)); await assert.rejects(access(output)); }
      await assert.rejects(access(file));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('official provider diagnostic does not invent workspace access or equate actor with credential creator', async () => {
  const { io } = fixture();
  const input = { ...credential, actorId: '11111111-1111-4111-8111-111111111111', created_by: '33333333-3333-4333-8333-333333333333', credentialOwnerId: '33333333-3333-4333-8333-333333333333' };
  const result = await diagnoseSmartstore(input, options, io);
  assert.deepEqual(result.sellerIdentifiers, { accountId: 'ncp_fixture', accountNo: 1234 });
  assert.doesNotMatch(JSON.stringify(result), /actorId|created_by|credentialOwnerId|authorizationModel|11111111|33333333/);
  const source = await readFile(new URL('../scripts/smartstore-live-connection-read.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /auth\.admin|signInWithPassword|createUser|updateUserById|sellerpilot_decrypt_credential/);
});
