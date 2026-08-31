import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const workbenchUrl = new URL("../app/product-publish-workbench.tsx", import.meta.url);

test("Temu is selectable as the eighth publication channel", async () => {
  const source = await readFile(pageUrl, "utf8");

  assert.match(source, /connectedChannelEntries\.map\(\(\[key, channel\]\) =>/);
  assert.match(source, /connectedChannelKeys\.filter\(\(key\) => channelSelection\[key\] !== false\)/);
  assert.doesNotMatch(source, /const publicationSelectable = key !== "temu"/);
  assert.doesNotMatch(source, /게시 상태 독립 readback 검증 전/);
  assert.match(source, /8개 판매채널 등록/);
  assert.match(source, /eBay·Temu 규격으로 변환/);
});

test("single and bulk publication paths include Temu", async () => {
  const source = await readFile(workbenchUrl, "utf8");

  assert.match(source, /publicationSelectableChannelKeys = activeChannelKeys;/);
  assert.match(source, /publicationSelectableChannelKeys\.filter\(\(channel\) => selectedChannels\.includes\(channel\)\)/);
  assert.doesNotMatch(source, /Temu 상품 게시 상태를 독립적으로 재조회할 수 있을 때까지 자동 등록을 차단합니다/);
  assert.match(source, /const readyChannels = visibleChannels\.filter[\s\S]*?\.slice\(0, publicationSelectableChannelKeys\.length\)/);
});
