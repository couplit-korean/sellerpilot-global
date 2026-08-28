import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);

test("support reply polling is cancelled on replacement, navigation, and unmount", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /const supportReplyControllerRef = useRef<AbortController \| null>\(null\)/);
  assert.match(page, /if \(view !== "cs"\)[\s\S]{0,260}supportReplyControllerRef\.current\?\.abort/);
  assert.match(page, /useEffect\(\(\) => \(\) => \{[\s\S]{0,260}supportReplyControllerRef\.current\?\.abort/);
  assert.match(page, /supportReplyControllerRef\.current\?\.abort\(new DOMException\("새 답변 초안 요청으로 교체됐습니다\.", "AbortError"\)\)/);
  assert.match(page, /const fetchSupportReply = async[\s\S]{0,260}createPageAbortScope\([\s\S]{0,160}30_000/);
  assert.match(page, /abortableBrowserDelay\(2_000, controller\.signal\)/);
  assert.match(page, /fetchSupportReply\(`\/api\/ai\/jobs\/\$\{jobId\}`\)/);
  assert.match(page, /controller\.signal\.aborted \|\| \(error instanceof Error && error\.name === "AbortError"\)/);
  assert.match(page, /supportReplyControllerRef\.current === controller[\s\S]{0,100}supportReplyControllerRef\.current = null/);
});
