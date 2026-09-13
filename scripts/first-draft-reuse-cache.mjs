import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, writeFile } from "node:fs/promises";
import { join } from "node:path";

const digestOf = (bytes) => createHash("sha256").update(bytes).digest("hex");

// This cache exists only for this claim's private job directory. Never recover
// an existing file or fetch again after a long-running Studio text generation.
export async function cacheFirstDraftAssetBytes({ entries, jobDir, downloadBytes, signal }) {
    const ids = new Set();
    for (const entry of entries) {
        if (!/^[a-z][a-z0-9-]*$/.test(entry?.id ?? "") || ids.has(entry.id)
            || !/^[a-f0-9]{64}$/.test(entry?.digest ?? "")
            || typeof entry?.path !== "string" || typeof entry?.signedUrl !== "string") {
            throw new Error("1차 이미지 캐시 계약이 올바르지 않습니다.");
        }
        ids.add(entry.id);
    }
    const cache = new Map();
    for (const entry of entries) {
        signal?.throwIfAborted();
        const bytes = await downloadBytes(entry);
        signal?.throwIfAborted();
        if (!Buffer.isBuffer(bytes) || !bytes.length || digestOf(bytes) !== entry.digest) {
            throw new Error(`${entry.id} 1차 이미지 다운로드가 검수 manifest와 일치하지 않습니다.`);
        }
        const file = join(jobDir, `.first-draft-reuse-${entry.id}.png`);
        await writeFile(file, bytes, { flag: "wx", mode: 0o400 });
        cache.set(entry.id, Object.freeze({ file, digest: entry.digest, bytes: bytes.length, sourcePath: entry.path }));
    }
    return cache;
}

export async function readCachedFirstDraftAssetBytes(cache, entry, signal) {
    signal?.throwIfAborted();
    const cached = cache?.get(entry.id);
    if (!cached || cached.digest !== entry.digest || cached.sourcePath !== entry.path) {
        throw new Error(`${entry.id} 검증된 1차 이미지 캐시가 없습니다.`);
    }
    const handle = await open(cached.file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size !== cached.bytes) {
            throw new Error(`${entry.id} 1차 이미지 캐시 크기가 변경됐습니다.`);
        }
        const bytes = await handle.readFile();
        signal?.throwIfAborted();
        if (digestOf(bytes) !== cached.digest) {
            throw new Error(`${entry.id} 1차 이미지 캐시가 검수 manifest와 일치하지 않습니다.`);
        }
        return bytes;
    } finally {
        await handle.close();
    }
}
