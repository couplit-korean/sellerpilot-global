import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

test("Swift identity keeps a brand-equal product name but requires distinguishing variants when available", {
  skip: process.platform !== "darwin", timeout: 60_000,
}, async () => {
  const source = await readFile(new URL("../scripts/source-product-cutout.swift", import.meta.url), "utf8");
  // Execute the production identity code with Foundation only; no customer image
  // fixture or Vision device is needed for this name-normalization regression.
  const anchor = source.slice(source.indexOf("struct IdentityAnchor:"), source.indexOf("struct IdentityMatchEvidence"));
  const functions = source.slice(source.indexOf("func identityTokens("), source.indexOf("func normalizedDigits("));
  const directory = await mkdtemp(join(tmpdir(), "sellerpilot-anchor-test-"));
  try {
    const script = join(directory, "anchor.swift");
    await writeFile(script, `import Foundation\n${anchor}\n${functions}\n
let inputs = [
  IdentityAnchor(productName: "나랑드사이다", brandName: "나랑드사이다", manufacturer: nil, gtin: nil, fallbackName: nil),
  IdentityAnchor(productName: "나랑드사이다 파인애플 500ml", brandName: "나랑드사이다", manufacturer: nil, gtin: nil, fallbackName: nil),
  IdentityAnchor(productName: "500ml 12개", brandName: "나랑드사이다", manufacturer: nil, gtin: nil, fallbackName: nil),
  IdentityAnchor(productName: "", brandName: "나랑드사이다", manufacturer: nil, gtin: nil, fallbackName: "나랑드사이다")
]
print(String(data: try JSONEncoder().encode(inputs.map { anchorProductTokens($0).sorted() }), encoding: .utf8)!)
`);
    const { stdout } = await promisify(execFile)("/usr/bin/swift", [script], { timeout: 55_000 });
    assert.deepEqual(JSON.parse(stdout), [["나랑드사이다"], ["파인애플"], [], ["나랑드사이다"]]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
