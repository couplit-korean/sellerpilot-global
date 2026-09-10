import test from 'node:test';
import assert from 'node:assert/strict';
import { smartstoreReplyReadbackContext } from '../lib/channels/cs/smartstore/reply-readback';

test('present malformed readback metadata cannot fall through to ordinary inquiry ingestion', () => {
  assert.equal(smartstoreReplyReadbackContext({ arguments: {} }), null);
  for (const marker of [null, false, 'invalid', [], 1]) {
    assert.throws(() => smartstoreReplyReadbackContext({ arguments: {}, sellerpilotSmartstoreReplyReadback: marker }), /SMARTSTORE_REPLY_READBACK_CONTEXT_INVALID/);
  }
  assert.throws(() => smartstoreReplyReadbackContext({ sellerpilotSmartstoreReplyReadback: {} }), /SMARTSTORE_REPLY_READBACK_CONTEXT_INVALID/);
});
