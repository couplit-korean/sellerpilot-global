import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { sha256HexUtf8 } from "../lib/sha256-portable";

test("portable SHA-256 matches standard UTF-8 SHA-256", () => {
  const values = [
    "",
    "abc",
    "한국어 상품명\u001f상세 설명\u001f첫 번째\u001e두 번째",
    "😀 multibyte / 한글 / 日本語 / " + "x".repeat(10_000),
  ];
  for (const value of values) {
    assert.equal(
      sha256HexUtf8(value),
      createHash("sha256").update(value, "utf8").digest("hex"),
    );
  }
});
