import { createHash } from "node:crypto";
import sharp from "sharp";
import type { IdentityBackgroundContactMode } from "./ai-background-audit";
import type { CliStudioResult } from "./ai-cli-contract";
import { aiGeneratedAssetSpecs } from "./ai-generated-assets";
import {
  resolveIdentityBackgroundContactMode,
  resolveProductSettingShot,
} from "./ai-image-planning";
import {
  assertIdentityBackgroundPlate,
  compositeIdentityForeground,
  isRepairableMissingIdentitySupportBoundary,
  normalizeIdentityBackgroundPlate,
  planIdentityEvidenceAttempt,
  renderIdentityEvidencePanel,
  renderIdentityOnNeutralCanvas,
  repairMissingIdentitySupportSurface,
  type IdentityAssetSpec,
  type IdentityForeground,
} from "./product-identity-protection";

const MAXIMUM_IDENTITY_SOURCE_PIXELS = 16_000_000;
const MINIMUM_VISIBLE_PIXEL_RATIO = 0.025;
const ALPHA_FOREGROUND_THRESHOLD = 96;
const MINIMUM_EDGE = 120;

export class ServerStudioIdentityPlateError extends Error {
  readonly failureDimensions: readonly string[];
  readonly plate: Buffer;
  readonly repairableMissingSupportBoundary: boolean;

  constructor(
    message: string,
    plate: Buffer,
    failureDimensions: readonly string[],
    repairableMissingSupportBoundary: boolean,
  ) {
    super(message);
    this.name = "ServerStudioIdentityPlateError";
    this.plate = plate;
    this.failureDimensions = failureDimensions;
    this.repairableMissingSupportBoundary = repairableMissingSupportBoundary;
  }
}

export function serverStudioIdentitySpec(
  asset: (typeof aiGeneratedAssetSpecs)[number],
): IdentityAssetSpec {
  return {
    id: asset.id,
    width: asset.width,
    height: asset.height,
    identityPolicy: asset.identityPolicy,
  };
}

export function serverStudioIdentityFailureDimensions(error: unknown): string[] {
  if (error instanceof ServerStudioIdentityPlateError) return [...error.failureDimensions];
  if (error && typeof error === "object" && "failedDimensions" in error) {
    const dimensions = (error as { failedDimensions?: unknown }).failedDimensions;
    if (Array.isArray(dimensions) && dimensions.every((value) => typeof value === "string")) {
      return dimensions;
    }
  }
  const message = error instanceof Error ? error.message : "";
  if (/reserved-zone|접촉면|지지면|상품 배치 구역/u.test(message)) return ["reserved-zone"];
  if (/고대비|잔여|상품·용기/u.test(message)) return ["composition:residual-product"];
  if (/불투명/u.test(message)) return ["geometry:background-opacity"];
  if (/전경|컷아웃|장면 전체/u.test(message)) return ["identity:foreground"];
  return ["identity:background-plate"];
}

/**
 * In-memory adapter for the CLI vision cutout loader. The filesystem-only
 * `loadVisionIdentityForeground` path is not used: Studio already holds the
 * segmented PNG in memory, and inventing a VisionCutoutReport would skip the
 * OCR/instance gates that loader expects.
 *
 * Rectangular scene-attachment pruning stays inside the unexported CLI helper
 * and only runs when that report exists. Server cutouts come from the portable
 * polygon mask, so this adapter keeps largest-opaque-component pixels, rejects
 * empty masks, and never invents product or label pixels.
 */
export async function loadServerStudioIdentityForeground(
  cutout: Uint8Array | Buffer,
): Promise<IdentityForeground> {
  const source = Buffer.isBuffer(cutout) ? cutout : Buffer.from(cutout);
  if (source.length < 1 || source.length > 20 * 1024 * 1024) {
    throw new Error("원본 상품 컷아웃의 바이트 크기가 안전 한도를 벗어났습니다.");
  }
  const decoded = await sharp(source, {
    failOn: "warning",
    limitInputPixels: MAXIMUM_IDENTITY_SOURCE_PIXELS,
  }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = decoded.info;
  if (channels !== 4 || width < MINIMUM_EDGE || height < MINIMUM_EDGE
      || width * height > MAXIMUM_IDENTITY_SOURCE_PIXELS) {
    throw new Error("원본 상품 컷아웃의 픽셀 규격을 안전하게 확인하지 못했습니다.");
  }
  retainLargestOpaqueComponent(decoded.data, width, height);
  const cleaned = await sharp(decoded.data, { raw: { width, height, channels: 4 } })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer({ resolveWithObject: true });
  if (cleaned.info.width < MINIMUM_EDGE || cleaned.info.height < MINIMUM_EDGE) {
    throw new Error("원본 상품 전경을 손실 없이 유지할 수 없습니다.");
  }
  return {
    buffer: cleaned.data,
    width: cleaned.info.width,
    height: cleaned.info.height,
    sourceDigest: createHash("sha256").update(cleaned.data).digest("hex"),
    retainedPixelRatio: opaqueRatio(decoded.data),
  };
}

/**
 * Evidence panels may show a dedicated seller photo rather than the segmented
 * cutout. The photo is never redrawn; it is only transcoded to PNG so
 * `renderIdentityEvidencePanel` can place the same source pixels.
 */
export async function loadServerStudioEvidenceForeground(
  source: Uint8Array | Buffer,
): Promise<IdentityForeground> {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source);
  const decoded = await sharp(bytes, {
    failOn: "warning",
    limitInputPixels: MAXIMUM_IDENTITY_SOURCE_PIXELS,
  }).rotate().ensureAlpha().png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer({ resolveWithObject: true });
  if ((decoded.info.width ?? 0) < MINIMUM_EDGE || (decoded.info.height ?? 0) < MINIMUM_EDGE) {
    throw new Error("원본 근거 사진의 픽셀 규격을 안전하게 확인하지 못했습니다.");
  }
  return {
    buffer: decoded.data,
    width: decoded.info.width,
    height: decoded.info.height,
    sourceDigest: createHash("sha256").update(decoded.data).digest("hex"),
    retainedPixelRatio: 1,
  };
}

export async function renderServerStudioCatalogAsset(
  asset: (typeof aiGeneratedAssetSpecs)[number],
  cutout: Uint8Array,
) {
  const foreground = await loadServerStudioIdentityForeground(cutout);
  return renderIdentityOnNeutralCanvas(foreground, serverStudioIdentitySpec(asset));
}

export async function renderServerStudioEvidenceAsset(
  asset: (typeof aiGeneratedAssetSpecs)[number],
  source: Uint8Array,
  attempt: number,
) {
  const spec = serverStudioIdentitySpec(asset);
  if (spec.identityPolicy.mode !== "source-evidence") {
    throw new Error(`${asset.id} 원본 근거 패널은 source-evidence 이미지에만 사용할 수 있습니다.`);
  }
  const foreground = await loadServerStudioEvidenceForeground(source);
  const plan = planIdentityEvidenceAttempt(1, attempt);
  if (plan?.mode === "single-source-panel") {
    return renderIdentityEvidencePanel(foreground, spec, plan.variant);
  }
  return renderIdentityOnNeutralCanvas(foreground, spec);
}

export function resolveServerStudioContactMode(
  result: CliStudioResult,
  assetId: (typeof aiGeneratedAssetSpecs)[number]["id"],
): IdentityBackgroundContactMode {
  const setting = resolveProductSettingShot(result, assetId);
  return resolveIdentityBackgroundContactMode(result, setting);
}

export async function compositeServerStudioSettingShot(input: {
  background: Uint8Array | Buffer;
  cutout: Uint8Array | Buffer;
  asset: (typeof aiGeneratedAssetSpecs)[number];
  contactMode: IdentityBackgroundContactMode;
  attempt: number;
  maximumAttempt?: number;
}): Promise<{ bytes: Buffer; plate: Buffer }> {
  const spec = serverStudioIdentitySpec(input.asset);
  const maximumAttempt = input.maximumAttempt ?? 4;
  let plate: Buffer = await sharp(input.background, {
    failOn: "warning",
    limitInputPixels: MAXIMUM_IDENTITY_SOURCE_PIXELS,
  }).rotate().resize(spec.width, spec.height, { fit: "cover" }).png().toBuffer();
  plate = await normalizeIdentityBackgroundPlate(plate, spec);
  try {
    await assertIdentityBackgroundPlate(plate, spec, input.contactMode);
  } catch (error) {
    const mayRepair = input.attempt >= maximumAttempt
      && input.contactMode === "surface-supported"
      && isRepairableMissingIdentitySupportBoundary(error);
    if (!mayRepair) {
      throw new ServerStudioIdentityPlateError(
        error instanceof Error ? error.message : `${spec.id} 배경판 검수에 실패했습니다.`,
        plate,
        serverStudioIdentityFailureDimensions(error),
        isRepairableMissingIdentitySupportBoundary(error),
      );
    }
    plate = await repairMissingIdentitySupportSurface(plate, spec);
    await assertIdentityBackgroundPlate(plate, spec, input.contactMode);
  }
  const foreground = await loadServerStudioIdentityForeground(input.cutout);
  const bytes = await compositeIdentityForeground(plate, foreground, spec, input.contactMode);
  return { bytes, plate };
}

function opaqueRatio(raw: Buffer) {
  let opaque = 0;
  for (let offset = 3; offset < raw.length; offset += 4) {
    if (raw[offset] >= ALPHA_FOREGROUND_THRESHOLD) opaque += 1;
  }
  return opaque / (raw.length / 4);
}

function retainLargestOpaqueComponent(raw: Buffer, width: number, height: number) {
  const pixels = width * height;
  const visible = (index: number) => raw[index * 4 + 3] >= ALPHA_FOREGROUND_THRESHOLD;
  let totalVisible = 0;
  for (let index = 0; index < pixels; index += 1) {
    if (visible(index)) totalVisible += 1;
  }
  if (totalVisible / pixels < MINIMUM_VISIBLE_PIXEL_RATIO) {
    throw new Error("원본 상품 전경 픽셀이 충분하지 않습니다.");
  }
  const visited = new Uint8Array(pixels);
  const queue = new Uint32Array(pixels);
  let largestSize = 0;
  let largestSeed = -1;
  for (let start = 0; start < pixels; start += 1) {
    if (visited[start] || !visible(start)) continue;
    let head = 0;
    let tail = 1;
    let size = 0;
    queue[0] = start;
    visited[start] = 1;
    while (head < tail) {
      const index = queue[head];
      head += 1;
      size += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      const enqueue = (neighbor: number) => {
        if (visited[neighbor] || !visible(neighbor)) return;
        visited[neighbor] = 1;
        queue[tail] = neighbor;
        tail += 1;
      };
      if (x > 0) enqueue(index - 1);
      if (x + 1 < width) enqueue(index + 1);
      if (y > 0) enqueue(index - width);
      if (y + 1 < height) enqueue(index + width);
    }
    if (size > largestSize) {
      largestSize = size;
      largestSeed = start;
    }
  }
  if (largestSeed < 0) throw new Error("원본 상품 전경 픽셀이 충분하지 않습니다.");
  visited.fill(0);
  let head = 0;
  let tail = 1;
  queue[0] = largestSeed;
  visited[largestSeed] = 1;
  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    const enqueue = (neighbor: number) => {
      if (visited[neighbor] || !visible(neighbor)) return;
      visited[neighbor] = 1;
      queue[tail] = neighbor;
      tail += 1;
    };
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }
  for (let index = 0; index < pixels; index += 1) {
    if (visited[index]) continue;
    raw[index * 4 + 3] = 0;
  }
}
