import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const workbenchUrl = new URL("../app/product-publish-workbench.tsx", import.meta.url);

test("Temu remains visible in channel readiness but cannot be selected for publication", async () => {
  const source = await readFile(pageUrl, "utf8");

  assert.match(source, /connectedChannelEntries\.map\(\(\[key, channel\]\) =>/);
  assert.match(source, /connectedChannelKeys\.filter\(\(key\) => key !== "temu" && channelSelection\[key\] !== false\)/);
  assert.match(source, /const publicationSelectable = key !== "temu"/);
  assert.match(source, /disabled=\{!publicationSelectable\}/);
  assert.match(source, /연결됨 · 게시 상태 독립 readback 검증 전/);
  assert.match(source, /상품 게시 검증 전 선택 불가/);
});

test("single and bulk publication paths fail closed for Temu", async () => {
  const source = await readFile(workbenchUrl, "utf8");

  assert.match(source, /publicationSelectableChannelKeys = activeChannelKeys\.filter\(\(channel\) => channel !== "temu"\)/);
  assert.match(source, /publicationSelectableChannelKeys\.filter\(\(channel\) => selectedChannels\.includes\(channel\)\)/);
  assert.match(source, /const executeChannel = async[\s\S]*?if \(channel === "temu"\) \{[\s\S]*?자동 등록을 차단합니다[\s\S]*?return false;/);
  assert.match(source, /const readyChannels = visibleChannels\.filter[\s\S]*?\.slice\(0, publicationSelectableChannelKeys\.length\)/);
});
