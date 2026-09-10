import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const patchPath = resolve(root, 'docs/cs-parallel/proposals/lazada/lazada-005-runtime-v3.patch');
const patchSource = await readFile(patchPath, 'utf8');
const preimages = new Map([
  ['lib/channels/lazada-im-webhook.ts', '407e6b54a2877c019bc7b1c632edd14c586b5fc9de6f91e74bd8b5920940a4cd'],
  ['app/api/webhooks/lazada-im/route.ts', '195573905df95ac6305d89507b4735898ed2fb59f7a28b74951158bd85b0f8b1'],
  ['app/api/channel-gateway/worker/complete/route.ts', '41435b65a23dc4d12a9c47a37f8ac20d572a81afe8af1fb9171d004edb0f7e64'],
  ['lib/channels/serverless-gateway.ts', '07b99bea1c41a7d2cad259a06302f49f4654d599b1f4fb7197bc9f4ffb49896a'],
  ['lib/channels/lazada-raw-reprocess.ts', 'abb5ee158fbc4bd47e35561949fa2ce33d76c55ce55ee1099ebd08c67f0e45e6'],
]);

const postimages = new Map([
  ['lib/channels/lazada-im-webhook.ts', '45e1f2bb3cd8b34ef87584a112cee00399ec3569ea06c9781edf52bf2f939767'],
  ['app/api/webhooks/lazada-im/route.ts', 'e8409ab4929c88da3d46a8fa41af108f1cdf3aa5bb0d2fccac16b9c41c4e851f'],
  ['app/api/channel-gateway/worker/complete/route.ts', '9e1ba34b77788d1ea68ac2489e09dda322fea4d9f8400cbd8c85e757e7831781'],
  ['lib/channels/serverless-gateway.ts', 'aa8703fff6a2441558f4bb926d7642dab4cbd21fcf8a73b90bcd98882e9ae852'],
  ['lib/channels/lazada-raw-reprocess.ts', '4445237b37f85d5a786ffbaed2e55269fb1db1514375cdd0602ab287f62b69e0'],
]);

test('the frozen V3 patch preserves Lazada-owned file integrity after shared channel integration', async () => {
  const actual = new Map();
  for (const [path] of preimages) actual.set(path, createHash('sha256').update(await readFile(resolve(root, path))).digest('hex'));
  const applied = ![...preimages].every(([path, hash]) => actual.get(path) === hash);
  // Shared gateway files also carry reviewed changes for other channels. Preserve
  // exact hashes for Lazada-owned files. Shared entrypoints are exercised by
  // runtime tests; their historical patch context changes as channels are added.
  for (const [path, expected] of applied ? postimages : preimages) {
    if (applied && (path === 'app/api/channel-gateway/worker/complete/route.ts' || path === 'lib/channels/serverless-gateway.ts')) continue;
    assert.equal(actual.get(path), expected, path);
  }
  assert.doesNotThrow(() => execFileSync('git', ['apply', ...(applied ? [
    '--reverse', '--exclude=lib/channels/serverless-gateway.ts',
    '--exclude=app/api/channel-gateway/worker/complete/route.ts',
  ] : []), '--check', patchPath], { cwd: root, stdio: 'pipe' }));
});

test('every integrated ingestion entrypoint retains credential-specific V3 readiness and storage calls', async () => {
  const additions = patchSource.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).join('\n');
  for (const path of [
    'app/api/webhooks/lazada-im/route.ts',
    'app/api/channel-gateway/worker/complete/route.ts',
    'lib/channels/serverless-gateway.ts',
    'lib/channels/lazada-raw-reprocess.ts',
  ]) {
    assert.match(patchSource, new RegExp(`(?:---|\\+\\+\\+) [ab]/${path.replaceAll('/', '\\/')}`));
    const current = await readFile(resolve(root, path), 'utf8');
    assert.match(current, /sellerpilot_service_lazada_im_ingest_ready_v3/, path);
    assert.match(current, /sellerpilot_service_ingest_lazada_(?:inquiries|gateway)_v3/, path);
    assert.doesNotMatch(current, /sellerpilot_service_ingest_lazada_(?:inquiries|gateway)_v2/, path);
  }
  assert.ok((additions.match(/sellerpilot_service_lazada_im_ingest_ready_v3/g) ?? []).length >= 4);
  assert.ok((additions.match(/sellerpilot_service_ingest_lazada_inquiries_v3/g) ?? []).length >= 2);
  assert.ok((additions.match(/sellerpilot_service_ingest_lazada_gateway_v3/g) ?? []).length >= 2);
  assert.ok((additions.match(/lazada_ingest_v3/g) ?? []).length >= 3);
});
