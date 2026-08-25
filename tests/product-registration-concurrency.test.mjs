import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("one queued product does not serialize another product or channel write", async () => {
  const studio = await readFile(new URL("../app/ai-product-studio.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const workbench = await readFile(new URL("../app/product-publish-workbench.tsx", import.meta.url), "utf8");

  assert.match(studio, /readActiveStudioJobs\(\)/);
  assert.match(studio, /for \(const activeJob of activeJobs\)/);
  assert.match(studio, /void finishStudioJob\(activeJob\.jobId, accessToken, true\)/);
  assert.match(studio, /처리되는 동안 다른 상품 등록을 바로 시작할 수 있습니다/);
  assert.match(page, /다른 상품 등록/);
  assert.match(workbench, /Promise\.all\(readyChannels\.map/);
});

test("the same product form cannot enqueue a duplicate while its own job is active", async () => {
  const studio = await readFile(new URL("../app/ai-product-studio.tsx", import.meta.url), "utf8");

  assert.match(studio, /if \(!mainPhoto \|\| generating \|\| queuedOwnJobId\) return/);
  assert.match(studio, /setQueuedOwnJobId\(queued\.jobId\)/);
  assert.match(studio, /disabled=\{!mainPhoto \|\| generating \|\| Boolean\(queuedOwnJobId\)\}/);
});
