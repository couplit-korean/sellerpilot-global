import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL(
  "../app/cs/channels/elevenst/read-state.tsx",
  import.meta.url,
), "utf8");
const stylesheet = await readFile(new URL(
  "../app/cs/channels/elevenst/read-state.module.css",
  import.meta.url,
), "utf8");

test("11st read-state imports only its channel-owned stylesheet", () => {
  assert.match(component, /import styles from "\.\/read-state\.module\.css";/u);
  assert.doesNotMatch(component, /lazada|\.\.\/\.\.\/[^"']+\.css/iu);
  assert.doesNotMatch(stylesheet, /lazada|@import/iu);
});

test("11st channel stylesheet owns every CSS module class used by the panel", () => {
  const usedClasses = [...component.matchAll(/styles\.([A-Za-z_][\w-]*)/gu)]
    .map((match) => match[1]);
  assert.deepEqual([...new Set(usedClasses)].sort(), ["accountSelector", "messages", "panel"]);
  for (const className of usedClasses) {
    assert.match(stylesheet, new RegExp(`\\.${className}(?:[\\s{.:>]|$)`, "u"));
  }
});
