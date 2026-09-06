import { lstat, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const fail = code => { throw new Error(code); };
const scalarId = value => (typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value))
  || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
const identityKeys = ['accountId', 'accountNo', 'sellerId', 'sellerNo', 'channelId', 'channelNo', 'storeId', 'mallId'];

// Standalone provider GET for an explicitly approved official-app credential file.
// This does not read Vault, authorize a SellerPilot actor, or assert exclusive
// credential ownership. Shared Vault access must be approved upstream using the
// authenticated actor contract; created_by/ownerId in a file is never such proof.
// Actor identity and credential lineage must not be substituted for provider IDs.
// Dependencies are explicit so regression tests cannot reach a real service.
export async function diagnoseSmartstore(credential, options, io) {
  const now = io.now ?? (() => new Date().toISOString());
  if (!credential || credential.client_id !== options.expectedAppId) fail('APP_IDENTITY_MISMATCH');
  if (!['SELF', 'SELLER'].includes(credential.token_type)) fail('TOKEN_TYPE_UNVERIFIED');
  if (credential.token_type === 'SELLER' && (!options.expectedAccountId || credential.account_id !== options.expectedAccountId)) fail('SELLER_ACCOUNT_UNVERIFIED');
  const credentialExpiry = credential.credential_expires_at;
  if (credentialExpiry != null && (!Number.isFinite(Date.parse(credentialExpiry)) || Date.parse(credentialExpiry) <= Date.parse(now()))) fail('CREDENTIAL_EXPIRED_OR_UNKNOWN');
  const egressIp = await io.getEgressIp();
  if (egressIp !== options.expectedEgressIp) fail('EGRESS_MISMATCH');
  const http = [];
  let accessToken = typeof credential.access_token === 'string' ? credential.access_token : '';
  let expiresAt = credential.access_token_expires_at;
  if (!accessToken || !(Date.parse(expiresAt) > Date.parse(now()) + 300000)) {
    if (!options.allowTokenOnce) fail('TOKEN_AUTHORIZATION_REQUIRED');
    const startedAt = now();
    const issued = await io.issueToken(credential);
    if (!issued?.remote?.response?.ok) fail('TOKEN_HTTP_FAILURE');
    http.push({ method: 'POST', path: '/v1/oauth2/token', status: issued.remote.response.status, startedAt, finishedAt: now() });
    accessToken = issued.accessToken; expiresAt = issued.expiresAt;
  }
  if (!accessToken || !(Date.parse(expiresAt) > Date.parse(now()))) fail('TOKEN_EXPIRED_OR_UNKNOWN');
  const startedAt = now();
  const remote = await io.getAccount(accessToken);
  // naverRequest returns { response, data, text }, NOT { ok, status, data }.
  if (!remote?.response?.ok) fail('SELLER_ACCOUNT_HTTP_FAILURE');
  http.push({ method: 'GET', path: '/v1/seller/account', status: remote.response.status, startedAt, finishedAt: now() });
  const data = remote.data && typeof remote.data === 'object' && !Array.isArray(remote.data) ? remote.data : {};
  const sellerIdentifiers = Object.fromEntries(identityKeys.filter(key => scalarId(data[key])).map(key => [key, data[key]]));
  if (!Object.keys(sellerIdentifiers).length) fail('SELLER_IDENTITY_MISSING');
  if (options.expectedAccountId && !Object.values(sellerIdentifiers).some(value => String(value) === options.expectedAccountId)) fail('SELLER_IDENTITY_MISMATCH');
  accessToken = '';
  return { http, sellerIdentifiers, appId: credential.client_id, egressIp, tokenExpired: Date.parse(expiresAt) <= Date.parse(now()), credentialExpired: credentialExpiry == null ? null : false };
}

export async function runCli(argv, io) {
  const values = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (key === '--allow-token-once') values[key] = true;
    else if (['--credential-file', '--output', '--expected-app-id', '--expected-egress-ip', '--expected-account-id'].includes(key) && argv[index + 1] && !argv[index + 1].startsWith('--')) values[key] = argv[++index];
    else fail('INVALID_ARGUMENT');
  }
  for (const key of ['--credential-file', '--output', '--expected-app-id', '--expected-egress-ip']) if (!values[key]) fail('MISSING_ARGUMENT');
  const file = resolve(values['--credential-file']);
  const output = resolve(values['--output']);
  if (file === output) fail('OUTPUT_INPUT_COLLISION');
  const directoryStat = await lstat(dirname(file));
  const fileStat = await lstat(file);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || (directoryStat.mode & 0o777) !== 0o700 || !fileStat.isFile() || fileStat.isSymbolicLink() || (fileStat.mode & 0o777) !== 0o600) fail('PRIVATE_PERMISSION_MISMATCH');
  let credential;
  try {
    credential = JSON.parse(await readFile(file, 'utf8'));
    const result = await diagnoseSmartstore(credential, { expectedAppId: values['--expected-app-id'], expectedEgressIp: values['--expected-egress-ip'], expectedAccountId: values['--expected-account-id'], allowTokenOnce: values['--allow-token-once'] === true }, io);
    await writeFile(output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    return result;
  } finally {
    if (credential && typeof credential === 'object') for (const key of Object.keys(credential)) credential[key] = null;
    await unlink(file);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const nativeFetch = globalThis.fetch;
  try {
    const protocol = await import('../lib/channels/protocols.ts');
    let tokenCalls = 0; let accountCalls = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input); const method = init?.method ?? 'GET';
      if (url === 'https://api.commerce.naver.com/external/v1/oauth2/token' && method === 'POST' && ++tokenCalls === 1) return nativeFetch(input, init);
      if (url === 'https://api.commerce.naver.com/external/v1/seller/account' && method === 'GET' && ++accountCalls === 1) return nativeFetch(input, init);
      fail('OUT_OF_SCOPE_OR_REPEATED_REQUEST');
    };
    const result = await runCli(process.argv.slice(2), {
      getEgressIp: async () => { const response = await nativeFetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(10000) }); if (!response.ok) fail('EGRESS_LOOKUP_FAILED'); return (await response.json()).ip; },
      issueToken: protocol.fetchNaverAccessToken,
      getAccount: accessToken => protocol.naverRequest({ accessToken, method: 'GET', path: '/v1/seller/account' }),
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ error: /^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'SAFE_DIAGNOSTIC_FAILED' }));
    process.exitCode = 1;
  } finally { globalThis.fetch = nativeFetch; }
}
