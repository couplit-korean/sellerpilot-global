import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workbenchUrl = new URL("../app/product-publish-workbench.tsx", import.meta.url);

test("degraded studioQuality blocks create/update as 재제작 필요 and never 등록 준비", async () => {
  const source = await readFile(workbenchUrl, "utf8");

  assert.match(source, /studioQuality\?: StudioResultQuality;/);
  assert.match(source, /export function workbenchStudioPublicationBlocked\(/);
  assert.match(source, /context\?\.studioQuality\?\.blockedForPublication === true/);
  assert.match(source, /data-studio-quality="degraded"/);
  assert.match(source, /<b>재제작 필요<\/b>/);
  assert.match(source, /studioBlocked \? "재제작 필요" : "등록 준비"/);
  assert.match(source, /studioBlocked \? "재제작 필요" : "콘텐츠 수정 준비"/);
  assert.match(source, /if \(workbenchStudioPublicationBlocked\(context\)\) \{\s*notify\(context\.studioQuality\?\.message/);
  assert.match(source, /&& !workbenchStudioPublicationBlocked\(context\)/);
  assert.match(source, /disabled=\{bulkRunning \|\| bulkConfirming \|\| !imagePackageReady \|\| studioBlocked\}/);
  assert.match(source, /disabled=\{!imagePackageReady \|\| studioBlocked \|\| !credential/);
  assert.doesNotMatch(source, /품질 통과|품질 검증|quality verified|운영 게시 준비 완료/);
});

test("listing.stop and read-only recovery stay outside the studio publication fence", async () => {
  const source = await readFile(workbenchUrl, "utf8");
  const stopFn = source.slice(
    source.indexOf("const stopQoo10Listing"),
    source.indexOf("const activateTemuListing"),
  );
  assert.match(stopFn, /operation: "listing.stop"/);
  assert.doesNotMatch(stopFn, /workbenchStudioPublicationBlocked/);
  assert.doesNotMatch(stopFn, /blockedForPublication/);
  assert.match(source, /onClick=\{\(\) => openConfirmation\(\{ kind: "qoo10-stop", listing \}\)\}/);
  assert.match(source, /정책 저장/);
  assert.match(source, /fetchStoredListingHandoff/);
  assert.doesNotMatch(source, /inspectStudioResultQuality\(/);
});
