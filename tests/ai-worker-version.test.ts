import assert from "node:assert/strict";
import test from "node:test";
import {
  minimumResultUploadWorkerVersion,
  supportsLiveResultUploadAuthorization,
} from "../lib/ai-worker-version";

test("new AI claims reject worker 1.42 and accept worker 1.43", () => {
  assert.equal(minimumResultUploadWorkerVersion, "sellerpilot-cli-worker/1.43");
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.42"), false);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.42.99"), false);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.43"), true);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.43.0"), true);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/1.44"), true);
  assert.equal(supportsLiveResultUploadAuthorization("sellerpilot-cli-worker/unknown"), false);
});
