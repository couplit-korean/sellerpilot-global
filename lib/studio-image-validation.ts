const maximumNormalizedStudioImageBytes = 3 * 1024 * 1024;
const studioImageInspectionConcurrency = 3;

function jpegDimensions(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 8 < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 1 >= bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if (startOfFrame.has(marker) && length >= 7) {
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }
    offset += length;
  }
  return null;
}

export async function verifyNormalizedStudioImages(
  paths: string[],
  download: (path: string) => Promise<Blob | Response | null>,
) {
  if (paths.length < 1 || paths.length > 100) return false;
  let nextIndex = 0;
  let valid = true;

  const inspectSource = async (source: Blob | Response) => {
    if (source instanceof Blob) {
      if (source.size > maximumNormalizedStudioImageBytes || source.type !== "image/jpeg") return null;
      return new Uint8Array(await source.arrayBuffer());
    }
    const mediaType = source.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    const declaredLength = Number(source.headers.get("content-length"));
    if (!source.ok || mediaType !== "image/jpeg"
        || (Number.isFinite(declaredLength) && declaredLength > maximumNormalizedStudioImageBytes)
        || !source.body) return null;
    const reader = source.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maximumNormalizedStudioImageBytes) {
          await reader.cancel("normalized studio image exceeds the byte limit");
          return null;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  };

  const inspect = async () => {
    while (valid && nextIndex < paths.length) {
      const index = nextIndex;
      nextIndex += 1;
      const source = await download(paths[index]);
      if (!source) {
        valid = false;
        return;
      }
      const bytes = await inspectSource(source);
      const dimensions = bytes ? jpegDimensions(bytes) : null;
      if (dimensions?.width !== 1200 || dimensions.height !== 1200) {
        valid = false;
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(studioImageInspectionConcurrency, paths.length) }, () => inspect()));
  return valid && nextIndex === paths.length;
}
