import assert from "node:assert/strict";
import test from "node:test";
import { readdir } from "node:fs/promises";

test("every Supabase migration has one globally unique 14-digit version", async () => {
  const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
  const filenames = (await readdir(migrationDirectory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  const versions = new Map();

  for (const filename of filenames) {
    const match = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(filename);
    assert.ok(match, `invalid migration filename: ${filename}`);
    const version = match[1];
    const existing = versions.get(version);
    assert.equal(existing, undefined, `duplicate migration version ${version}: ${existing}, ${filename}`);
    versions.set(version, filename);
  }

  assert.equal(versions.size, filenames.length);
});
