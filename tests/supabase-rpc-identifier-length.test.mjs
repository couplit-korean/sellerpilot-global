import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const sourceRoots = [
  new URL("../app/", import.meta.url),
  new URL("../lib/", import.meta.url),
];
const sourceExtensions = new Set([".js", ".mjs", ".ts", ".tsx"]);
const knownOversizedRpcNames = new Set([
  "sellerpilot_service_complete_marketplace_normalized_asset_cleanup",
]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const url = new URL(entry.name, directory);
    if (entry.isDirectory()) return sourceFiles(new URL(`${url.href}/`));
    const extension = entry.name.slice(entry.name.lastIndexOf("."));
    return sourceExtensions.has(extension) ? [url] : [];
  }));
  return nested.flat();
}

test("every new literal Supabase RPC name fits PostgreSQL's 63-byte identifier limit", async () => {
  const files = (await Promise.all(sourceRoots.map(sourceFiles))).flat();
  const rpcPattern = /\.rpc\(\s*["'`]([a-zA-Z0-9_]+)["'`]/gu;
  const observed = [];
  const observedKnownOversized = new Set();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(rpcPattern)) {
      const name = match[1];
      const bytes = Buffer.byteLength(name, "utf8");
      observed.push(name);
      if (knownOversizedRpcNames.has(name)) {
        observedKnownOversized.add(name);
        continue;
      }
      assert.ok(
        bytes <= 63,
        `${name} is ${bytes} UTF-8 bytes and cannot be addressed exactly through PostgREST`,
      );
    }
  }
  assert.ok(observed.includes(
    "sellerpilot_service_get_qoo10_adopted_localization_identity",
  ));
  assert.ok(observed.includes(
    "sellerpilot_service_arm_qoo10_adopted_localization_update",
  ));
  assert.deepEqual(observedKnownOversized, knownOversizedRpcNames);
  assert.ok(observed.length > 0, "at least one literal Supabase RPC must be checked");
});
