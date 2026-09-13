import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cacheFirstDraftAssetBytes, readCachedFirstDraftAssetBytes } from "../../scripts/first-draft-reuse-cache.mjs";

const assetIds = ["portrait", "wide", "detail-overview", "detail-use", "detail-routine", "detail-scale", "detail-storage", "detail-context"];
const buffers = new Map(assetIds.map((id) => [id, Buffer.from(`verified-image-bytes:${id}`)]));
const entries = assetIds.map((id) => ({
    id, path: `results/research/claims/verified/${id}.png`, signedUrl: `https://example.invalid/${id}?expires=3600`,
    digest: createHash("sha256").update(buffers.get(id)).digest("hex"),
}));
async function fixture(t) {
    const jobDir = await mkdtemp(join(tmpdir(), "sellerpilot-reuse-cache-test-"));
    t.after(() => rm(jobDir, { recursive: true, force: true }));
    return jobDir;
}

test("all eight verified bytes survive signed URL expiry without another download", async (t) => {
    const jobDir = await fixture(t);
    let now = 0;
    let calls = 0;
    const cache = await cacheFirstDraftAssetBytes({ entries, jobDir, downloadBytes: async (entry) => {
        calls++;
        assert.ok(now < 3600, "provider refuses expired signed URLs");
        return buffers.get(entry.id);
    } });
    assert.equal(cache.size, 8);
    now = 7200;
    for (const entry of entries) {
        assert.deepEqual(await readCachedFirstDraftAssetBytes(cache, entry), buffers.get(entry.id));
    }
    assert.equal(calls, 8, "no late signed URL fetch or refresh");
});

test("rejects invalid entries before downloading and rejects incorrect downloaded digest", async (t) => {
    const jobDir = await fixture(t);
    let calls = 0;
    await assert.rejects(cacheFirstDraftAssetBytes({
        entries: [...entries.slice(0, -1), { ...entries.at(-1), digest: "invalid" }], jobDir,
        downloadBytes: async () => { calls++; return buffers.get("portrait"); },
    }), /캐시 계약/);
    assert.equal(calls, 0);
    await assert.rejects(cacheFirstDraftAssetBytes({ entries, jobDir,
        downloadBytes: async () => Buffer.from("different unverified image"),
    }), /manifest/);
});

test("does not adopt existing files, missing cached files, changed bytes or changed lineage", async (t) => {
    const jobDir = await fixture(t);
    const entry = entries[0];
    const cache = await cacheFirstDraftAssetBytes({ entries: [entry], jobDir, downloadBytes: async () => buffers.get(entry.id) });
    const path = cache.get(entry.id).file;
    await assert.rejects(cacheFirstDraftAssetBytes({ entries: [entry], jobDir, downloadBytes: async () => buffers.get(entry.id) }), { code: "EEXIST" });
    await assert.rejects(readCachedFirstDraftAssetBytes(cache, { ...entry, path: "results/other-claim/portrait.png" }), /캐시가 없습니다/);
    await chmod(path, 0o600);
    const changed = Buffer.from(await readFile(path));
    changed[0] ^= 1;
    await writeFile(path, changed);
    await assert.rejects(readCachedFirstDraftAssetBytes(cache, entry), /manifest/);
    await rm(path);
    await assert.rejects(readCachedFirstDraftAssetBytes(cache, entry), { code: "ENOENT" });
    await assert.rejects(readCachedFirstDraftAssetBytes(new Map(), entry), /캐시가 없습니다/);
});

test("cancellation stops download and does not produce a usable cache", async (t) => {
    const jobDir = await fixture(t);
    const controller = new AbortController();
    const reason = new Error("lease lost");
    let calls = 0;
    await assert.rejects(cacheFirstDraftAssetBytes({ entries, jobDir, signal: controller.signal,
        downloadBytes: async (entry) => { calls++; controller.abort(reason); return buffers.get(entry.id); },
    }), reason);
    assert.equal(calls, 1);
});
