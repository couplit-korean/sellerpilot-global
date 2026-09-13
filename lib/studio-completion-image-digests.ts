import { createHash } from "node:crypto";
import { aiGeneratedAssetPath, aiGeneratedAssetSpecs } from "./ai-generated-assets";

const maximumImageBytes = 20 * 1024 * 1024;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Hash the stored claim bytes, never caller-supplied hashes or Storage ETags. */
export async function collectStudioCompletionImageDigests({
  jobId, claimToken, paths, download,
}: {
  jobId: string;
  claimToken: string;
  paths: Record<string, string>;
  download: (path: string) => Promise<Response | Blob | null>;
}): Promise<Record<string, string>> {
  const entries = Object.entries(paths);
  if (!entries.length || entries.length > aiGeneratedAssetSpecs.length
      || entries.some(([id, path]) => {
        const asset = aiGeneratedAssetSpecs.find((candidate) => candidate.id === id);
        return !asset || path !== aiGeneratedAssetPath(jobId, asset, claimToken);
      })) throw new Error("STUDIO_COMPLETION_IMAGE_PATH_INVALID");

  const digests: Record<string, string> = {};
  let next = 0;
  const inspect = async () => {
    while (next < entries.length) {
      const [id, path] = entries[next++];
      const source = await download(path);
      if (!source) throw new Error("STUDIO_COMPLETION_IMAGE_UNAVAILABLE");
      const response = source instanceof Response;
      const contentType = response ? source.headers.get("content-type") : source.type;
      const length = response ? source.headers.get("content-length") : String(source.size);
      const size = length === null ? null : Number(length);
      if ((response && !source.ok) || contentType?.split(";", 1)[0].trim().toLowerCase() !== "image/png"
          || (size !== null && (!Number.isSafeInteger(size) || size < 1 || size > maximumImageBytes))) {
        if (response) await source.body?.cancel();
        throw new Error("STUDIO_COMPLETION_IMAGE_INVALID");
      }
      const reader = (response ? source.body : source.stream())?.getReader();
      if (!reader) throw new Error("STUDIO_COMPLETION_IMAGE_UNAVAILABLE");
      const hash = createHash("sha256");
      let total = 0;
      let signature = Buffer.alloc(0);
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          total += chunk.value.byteLength;
          if (total > maximumImageBytes) throw new Error("STUDIO_COMPLETION_IMAGE_TOO_LARGE");
          if (signature.length < 8) signature = Buffer.concat([signature, Buffer.from(chunk.value.subarray(0, 8 - signature.length))]);
          hash.update(chunk.value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      if (total < 33 || (size !== null && total !== size) || !signature.equals(pngSignature)) throw new Error("STUDIO_COMPLETION_IMAGE_INVALID");
      digests[id] = hash.digest("hex");
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, entries.length) }, inspect));
  return digests;
}
