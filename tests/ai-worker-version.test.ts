import assert from "node:assert/strict";
import test from "node:test";
import {
  minimumResultUploadWorkerVersion,
  supportsLiveResultUploadAuthorization,
} from "../lib/ai-worker-version";

test("new AI claims reject worker 1.50 and accept worker 1.51 or newer", () => {
  assert.equal(minimumResultUploadWorkerVersion, "sellerpilot-cli-worker/1.51");
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.42"), false);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.42.99"), false);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.43"), false);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.43.99"), false);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.44"), false);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.44.99"), false);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.45"), false);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.45.99"), false);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.46"), false);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.46.99"), false);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.47"), false);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.47.99"), false);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.48"), false);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.48.99"), false);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.49"), false);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.49.99"), false);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.50"), false);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.50.99"), false);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.51"), true);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.51.0"), true);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.52"), true);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.52.0"), true);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.53"), true);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.54"), true);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/unknown"), false);
});
