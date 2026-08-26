import assert from "node:assert/strict";
import test from "node:test";
import { rejectedUploadPaths } from "../lib/ai-upload-guard";

const userId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";
const validPaths = [
  `${userId}/${jobId}/input/001.jpg`,
  `${userId}/${jobId}/input/002.jpg`,
];

test("invalid AI intake cleanup is limited to the authenticated user's job paths", () => {
  assert.deepEqual(rejectedUploadPaths({ jobId, imagePaths: validPaths }, userId), validPaths);
  assert.deepEqual(rejectedUploadPaths({
    jobId,
    imagePaths: validPaths,
    imageSpecs: [
      { originalPath: `${userId}/${jobId}/original/001.source` },
      { originalPath: `${userId}/${jobId}/original/002.source` },
    ],
  }, userId), [
    validPaths[0], `${userId}/${jobId}/original/001.source`,
    validPaths[1], `${userId}/${jobId}/original/002.source`,
  ]);
});

test("invalid AI intake cleanup rejects foreign, mixed, and traversal paths", () => {
  const foreignUser = "33333333-3333-4333-8333-333333333333";
  assert.deepEqual(rejectedUploadPaths({ jobId, imagePaths: [`${foreignUser}/${jobId}/input/001.jpg`] }, userId), []);
  assert.deepEqual(rejectedUploadPaths({ jobId, imagePaths: [...validPaths, `${foreignUser}/${jobId}/input/003.jpg`] }, userId), []);
  assert.deepEqual(rejectedUploadPaths({ jobId, imagePaths: [`${userId}/${jobId}/input/../secret.jpg`] }, userId), []);
  assert.deepEqual(rejectedUploadPaths({
    jobId,
    imagePaths: validPaths,
    imageSpecs: [
      { originalPath: `${foreignUser}/${jobId}/original/001.source` },
      { originalPath: `${userId}/${jobId}/original/002.source` },
    ],
  }, userId), validPaths);
});

test("invalid AI intake cleanup requires bounded UUID job payloads", () => {
  assert.deepEqual(rejectedUploadPaths({ jobId: "not-a-uuid", imagePaths: validPaths }, userId), []);
  assert.deepEqual(rejectedUploadPaths({ jobId, imagePaths: [] }, userId), []);
  assert.deepEqual(rejectedUploadPaths({ jobId, imagePaths: Array.from({ length: 101 }, (_, index) => `${userId}/${jobId}/input/${index}.jpg`) }, userId), []);
});
