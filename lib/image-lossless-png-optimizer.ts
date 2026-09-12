import sharp from "sharp";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export type LosslessPngEncoder =
  | "original"
  | "sharp-png9-adaptive"
  | "sharp-png9-none";

export type LosslessPngOptimization = {
  bytes: Buffer;
  encoder: LosslessPngEncoder;
  beforeBytes: number;
  afterBytes: number;
  savedBytes: number;
  savedPercent: number;
  candidateFailures: readonly string[];
};

type ParsedPngChunk = {
  type: string;
  data: Buffer;
  encoded: Buffer;
};

function parsePngChunks(value: Uint8Array) {
  const buffer = Buffer.from(value);
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("PNG signature mismatch");
  }
  const chunks: ParsedPngChunk[] = [];
  let offset = 8;
  let ended = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) throw new Error("PNG chunk length exceeds input");
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    chunks.push({
      type,
      data: buffer.subarray(offset + 8, offset + 8 + length),
      encoded: buffer.subarray(offset, end),
    });
    offset = end;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  if (!ended || offset !== buffer.length) throw new Error("PNG has trailing or incomplete chunk data");
  return chunks;
}

function protectedPngChunks(value: Uint8Array) {
  // IDAT is the only byte sequence an encoder may change. Protecting every
  // other chunk (including IHDR, caBX/C2PA provenance, ICC, gamma, EXIF and
  // text) is stricter than an allowlist and prevents silent metadata loss.
  return parsePngChunks(value).flatMap((chunk) => (
    chunk.type === "IDAT" ? [] : [`${chunk.type}:${chunk.data.toString("base64")}`]
  ));
}

function replaceIdatWhilePreservingOriginalChunks(original: Uint8Array, encodedPixels: Uint8Array) {
  const originalChunks = parsePngChunks(original);
  const encodedChunks = parsePngChunks(encodedPixels);
  if (originalChunks.some((chunk) => ["acTL", "fcTL", "fdAT"].includes(chunk.type))) {
    throw new Error("animated PNG is not rewritten");
  }
  const originalHeader = originalChunks.find((chunk) => chunk.type === "IHDR")?.data;
  const encodedHeader = encodedChunks.find((chunk) => chunk.type === "IHDR")?.data;
  const encodedIdat = encodedChunks.filter((chunk) => chunk.type === "IDAT");
  if (!originalHeader || !encodedHeader || !originalHeader.equals(encodedHeader) || encodedIdat.length < 1) {
    throw new Error("encoded PNG structure differs");
  }
  let inserted = false;
  const chunks = originalChunks.flatMap((chunk) => {
    if (chunk.type !== "IDAT") return [chunk.encoded];
    if (inserted) return [];
    inserted = true;
    return encodedIdat.map((candidate) => candidate.encoded);
  });
  if (!inserted) throw new Error("PNG has no IDAT data");
  return Buffer.concat([PNG_SIGNATURE, ...chunks]);
}

export function pngContainsOptimizerFragileProvenance(value: Uint8Array) {
  try {
    return parsePngChunks(value).some((chunk) => chunk.type === "caBX" || chunk.type === "iDOT");
  } catch {
    return false;
  }
}

async function decodedPng(value: Uint8Array, maximumPixels: number) {
  const buffer = Buffer.from(value);
  const image = sharp(buffer, { failOn: "warning", limitInputPixels: maximumPixels });
  const metadata = await image.metadata();
  if (metadata.format !== "png" || !metadata.width || !metadata.height) {
    throw new Error("input is not a decodable PNG");
  }
  if (metadata.depth && metadata.depth !== "uchar") {
    throw new Error(`unsupported PNG depth: ${metadata.depth}`);
  }
  const decoded = await image.raw().toBuffer({ resolveWithObject: true });
  return { metadata, ...decoded };
}

export async function verifyLosslessPngCandidate(
  original: Uint8Array,
  candidate: Uint8Array,
  maximumPixels = 16_000_000,
) {
  const [before, after] = await Promise.all([
    decodedPng(original, maximumPixels),
    decodedPng(candidate, maximumPixels),
  ]);
  if (
    before.info.width !== after.info.width
    || before.info.height !== after.info.height
    || before.info.channels !== after.info.channels
    || before.metadata.depth !== after.metadata.depth
    || !before.data.equals(after.data)
  ) {
    throw new Error("decoded PNG pixels or alpha differ");
  }
  const [beforeChunks, afterChunks] = [
    protectedPngChunks(original),
    protectedPngChunks(candidate),
  ];
  if (beforeChunks.length !== afterChunks.length
      || beforeChunks.some((chunk, index) => chunk !== afterChunks[index])) {
    throw new Error("protected PNG metadata differs");
  }
  return {
    width: before.info.width,
    height: before.info.height,
    channels: before.info.channels,
    protectedChunkCount: beforeChunks.length,
  };
}

export async function optimizePngWithSharp(
  value: Uint8Array,
  maximumPixels = 16_000_000,
): Promise<LosslessPngOptimization> {
  const original = Buffer.from(value);
  const originalChunks = parsePngChunks(original);
  const metadata = await sharp(original, { failOn: "warning", limitInputPixels: maximumPixels }).metadata();
  if (metadata.format !== "png" || !metadata.width || !metadata.height) {
    throw new Error("input is not a decodable PNG");
  }
  const preservedOriginal = (reason: string): LosslessPngOptimization => ({
    bytes: original,
    encoder: "original",
    beforeBytes: original.length,
    afterBytes: original.length,
    savedBytes: 0,
    savedPercent: 0,
    candidateFailures: [reason],
  });
  if (originalChunks.some((chunk) => ["acTL", "fcTL", "fdAT"].includes(chunk.type))) {
    return preservedOriginal("unsupported-apng");
  }
  if (metadata.depth && metadata.depth !== "uchar") {
    return preservedOriginal(`unsupported-depth:${metadata.depth}`);
  }
  // Decode and validate even when every encoder candidate is rejected. This
  // keeps callers from treating an arbitrary byte string as an "original PNG"
  // fallback.
  await decodedPng(original, maximumPixels);

  const candidates: Array<{
    bytes: Buffer;
    encoder: Exclude<LosslessPngEncoder, "original">;
  }> = [];
  const candidateFailures: string[] = [];
  for (const configuration of [
    { adaptiveFiltering: true, encoder: "sharp-png9-adaptive" as const },
    { adaptiveFiltering: false, encoder: "sharp-png9-none" as const },
  ]) {
    try {
      const encodedPixels = await sharp(original, { failOn: "warning", limitInputPixels: maximumPixels })
        .png({ compressionLevel: 9, adaptiveFiltering: configuration.adaptiveFiltering, palette: false })
        .toBuffer();
      const bytes = replaceIdatWhilePreservingOriginalChunks(original, encodedPixels);
      candidates.push({ bytes, encoder: configuration.encoder });
    } catch (error) {
      candidateFailures.push(
        `${configuration.encoder}:${error instanceof Error ? error.message : "encoding failed"}`,
      );
    }
  }

  let selected: { bytes: Buffer; encoder: LosslessPngEncoder } = {
    bytes: original,
    encoder: "original",
  };
  for (const candidate of candidates) {
    if (candidate.bytes.length >= selected.bytes.length) continue;
    try {
      await verifyLosslessPngCandidate(original, candidate.bytes, maximumPixels);
      selected = candidate;
    } catch (error) {
      candidateFailures.push(
        `${candidate.encoder}:${error instanceof Error ? error.message : "verification failed"}`,
      );
    }
  }
  const savedBytes = original.length - selected.bytes.length;
  return {
    ...selected,
    beforeBytes: original.length,
    afterBytes: selected.bytes.length,
    savedBytes,
    savedPercent: original.length ? (savedBytes / original.length) * 100 : 0,
    candidateFailures,
  };
}
