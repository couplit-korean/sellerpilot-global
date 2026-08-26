import {
  maximumStudioSourceImageBytes,
  maximumStudioSourceImageDimension,
  maximumStudioSourceImagePixels,
  minimumStudioSourceImageDimension,
  type StudioSourceImageMediaType,
} from "./studio-source-photo-policy";

const maximumNormalizedStudioImageBytes = 3 * 1024 * 1024;
const studioImageInspectionConcurrency = 3;
const studioSourceImageInspectionConcurrency = 3;

export const maximumPreservedStudioImageInspectionConcurrency =
  studioImageInspectionConcurrency + studioSourceImageInspectionConcurrency;

type SignedStudioImageEntry = {
  signedUrl?: unknown;
  error?: unknown;
};

export async function createSignedStudioImageDownloader({
  paths,
  sign,
  fetcher = globalThis.fetch,
  fetchTimeoutMs = 30_000,
}: {
  paths: string[];
  sign: (paths: string[]) => Promise<{
    data: SignedStudioImageEntry[] | null;
    error: unknown;
  }>;
  fetcher?: typeof fetch;
  fetchTimeoutMs?: number;
}) {
  const signed = await sign(paths).catch(() => null);
  if (!signed || signed.error || signed.data?.length !== paths.length) return null;
  const signedUrlByPath = new Map<string, string>();
  for (let index = 0; index < paths.length; index += 1) {
    const entry = signed.data[index];
    if (!entry || entry.error || typeof entry.signedUrl !== "string") return null;
    signedUrlByPath.set(paths[index], entry.signedUrl);
  }
  return async (path: string) => {
    const signedUrl = signedUrlByPath.get(path);
    if (!signedUrl) return null;
    return fetcher(signedUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(fetchTimeoutMs),
    }).catch(() => null);
  };
}

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

function uint24le(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function uint32le(bytes: Uint8Array, offset: number) {
  return (bytes[offset]
    + bytes[offset + 1] * 0x100
    + bytes[offset + 2] * 0x10000
    + bytes[offset + 3] * 0x1000000) >>> 0;
}

function pngDimensions(bytes: Uint8Array) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((value, index) => bytes[index] !== value)
      || String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") return null;
  return {
    width: (bytes[16] * 0x1000000 + bytes[17] * 0x10000 + bytes[18] * 0x100 + bytes[19]) >>> 0,
    height: (bytes[20] * 0x1000000 + bytes[21] * 0x10000 + bytes[22] * 0x100 + bytes[23]) >>> 0,
  };
}

function webpDimensions(bytes: Uint8Array) {
  if (bytes.length < 30
      || String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF"
      || String.fromCharCode(...bytes.slice(8, 12)) !== "WEBP") return null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunk = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const size = uint32le(bytes, offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + size > bytes.length) return null;
    if (chunk === "VP8X" && size >= 10) {
      return {
        width: uint24le(bytes, dataOffset + 4) + 1,
        height: uint24le(bytes, dataOffset + 7) + 1,
      };
    }
    if (chunk === "VP8L" && size >= 5 && bytes[dataOffset] === 0x2f) {
      const bits = uint32le(bytes, dataOffset + 1);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
    if (chunk === "VP8 " && size >= 10
        && bytes[dataOffset + 3] === 0x9d
        && bytes[dataOffset + 4] === 0x01
        && bytes[dataOffset + 5] === 0x2a) {
      return {
        width: (bytes[dataOffset + 6] | (bytes[dataOffset + 7] << 8)) & 0x3fff,
        height: (bytes[dataOffset + 8] | (bytes[dataOffset + 9] << 8)) & 0x3fff,
      };
    }
    offset = dataOffset + size + (size % 2);
  }
  return null;
}

function sourceImageDimensions(mediaType: StudioSourceImageMediaType, bytes: Uint8Array) {
  if (mediaType === "image/jpeg") return jpegDimensions(bytes);
  if (mediaType === "image/png") return pngDimensions(bytes);
  return webpDimensions(bytes);
}

async function boundedImageBytes(
  source: Blob | Response,
  expectedMediaType: string,
  maximumBytes: number,
) {
  if (source instanceof Blob) {
    if (source.size < 1 || source.size > maximumBytes || source.type !== expectedMediaType) return null;
    return new Uint8Array(await source.arrayBuffer());
  }
  const mediaType = source.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const contentLength = source.headers.get("content-length");
  const declaredLength = contentLength == null ? null : Number(contentLength);
  if (!source.ok || mediaType !== expectedMediaType
      || (declaredLength != null && (!Number.isFinite(declaredLength) || declaredLength < 1 || declaredLength > maximumBytes))
      || !source.body) return null;
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("studio image exceeds the byte limit");
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total < 1 || (declaredLength != null && total !== declaredLength)) return null;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function verifyNormalizedStudioImages(
  paths: string[],
  download: (path: string) => Promise<Blob | Response | null>,
) {
  if (paths.length < 1 || paths.length > 100) return false;
  let nextIndex = 0;
  let valid = true;

  const inspect = async () => {
    while (valid && nextIndex < paths.length) {
      const index = nextIndex;
      nextIndex += 1;
      const source = await download(paths[index]);
      if (!source) {
        valid = false;
        return;
      }
      const bytes = await boundedImageBytes(source, "image/jpeg", maximumNormalizedStudioImageBytes);
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

type OriginalStudioImageSpec = {
  originalBytes: number;
  originalMediaType: StudioSourceImageMediaType;
  originalWidth: number;
  originalHeight: number;
};

export async function verifyPreservedStudioImages({
  normalizedPaths,
  originalPaths,
  specs,
  download,
}: {
  normalizedPaths: string[];
  originalPaths: string[];
  specs: OriginalStudioImageSpec[];
  download: (path: string) => Promise<Blob | Response | null>;
}) {
  const [normalized, originals] = await Promise.all([
    verifyNormalizedStudioImages(normalizedPaths, download),
    verifyOriginalStudioImages(originalPaths, specs, download),
  ]);
  return { normalized, originals };
}

export async function verifyOriginalStudioImages(
  paths: string[],
  specs: OriginalStudioImageSpec[],
  download: (path: string) => Promise<Blob | Response | null>,
) {
  if (paths.length < 1 || paths.length > 100 || specs.length !== paths.length) return false;
  let nextIndex = 0;
  let valid = true;
  const inspect = async () => {
    while (valid && nextIndex < paths.length) {
      const index = nextIndex;
      nextIndex += 1;
      const spec = specs[index];
      const source = await download(paths[index]);
      if (!source) {
        valid = false;
        return;
      }
      const bytes = await boundedImageBytes(source, spec.originalMediaType, maximumStudioSourceImageBytes);
      const dimensions = bytes ? sourceImageDimensions(spec.originalMediaType, bytes) : null;
      const exactDimensions = dimensions?.width === spec.originalWidth && dimensions.height === spec.originalHeight;
      const exifRotatedDimensions = spec.originalMediaType === "image/jpeg"
        && dimensions?.width === spec.originalHeight
        && dimensions.height === spec.originalWidth;
      const dimensionsWithinPolicy = dimensions
        && dimensions.width >= minimumStudioSourceImageDimension
        && dimensions.height >= minimumStudioSourceImageDimension
        && dimensions.width <= maximumStudioSourceImageDimension
        && dimensions.height <= maximumStudioSourceImageDimension
        && dimensions.width * dimensions.height <= maximumStudioSourceImagePixels;
      if (!bytes
          || bytes.byteLength !== spec.originalBytes
          || !dimensions
          || !dimensionsWithinPolicy
          || (!exactDimensions && !exifRotatedDimensions)
      ) {
        valid = false;
        return;
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(studioSourceImageInspectionConcurrency, paths.length) },
    () => inspect(),
  ));
  return valid && nextIndex === paths.length;
}
