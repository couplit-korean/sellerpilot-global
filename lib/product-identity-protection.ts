import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

export type IdentityAssetPolicy = {
  mode: "source-catalog" | "source-evidence" | "source-composite";
  sourceRoles: readonly string[];
  requiresDedicatedRole?: boolean;
  fit?: "inside" | "cover";
  background: string;
  placement: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
};

export type IdentityAssetSpec = {
  id: string;
  width: number;
  height: number;
  identityPolicy: IdentityAssetPolicy;
};

export type IdentityForeground = {
  buffer: Buffer;
  width: number;
  height: number;
  sourceDigest: string;
  retainedPixelRatio: number;
};

export type VisionCutoutReport = {
  inputIndex: number;
  inputRole: string;
  method: "rectangle" | "single-instance";
  score: number;
  textCount: number;
  identityMatches: number;
  productTokenCount: number;
  productNameMatches: number;
  brandMatches: number;
  manufacturerMatches: number;
  gtinExpected: boolean;
  gtinMatch: boolean;
  evidenceSignals: number;
  instanceCount: number;
  retainedRatio: number;
  boundingCoverage: number;
};

export type VisionCutoutMode = "front" | "evidence" | "view" | "subject" | "alternate";

const MAXIMUM_IDENTITY_SOURCE_PIXELS = 16_000_000;
const MINIMUM_VISIBLE_PIXEL_RATIO = 0.025;
const MAXIMUM_FRONT_PIXEL_RATIO = 0.82;
const MAXIMUM_EVIDENCE_PIXEL_RATIO = 0.90;
const MINIMUM_PRIMARY_COMPONENT_SHARE = 0.965;
const ALPHA_FOREGROUND_THRESHOLD = 96;
const sourceCompositeRotationDegrees: Record<string, number> = {
  portrait: -2.5,
  wide: 3.5,
  "detail-overview": -4,
  "detail-use": 5,
};

function boundedPlacement(spec: IdentityAssetSpec) {
  const placement = spec.identityPolicy.placement;
  const left = Math.max(0, Math.min(spec.width - 1, Math.round(spec.width * placement.left)));
  const top = Math.max(0, Math.min(spec.height - 1, Math.round(spec.height * placement.top)));
  const width = Math.max(1, Math.min(spec.width - left, Math.round(spec.width * placement.width)));
  const height = Math.max(1, Math.min(spec.height - top, Math.round(spec.height * placement.height)));
  return { left, top, width, height };
}

function assertVisionReport(report: VisionCutoutReport, mode: VisionCutoutMode) {
  if (!Number.isInteger(report.inputIndex) || report.inputIndex < 0 || !report.inputRole.trim()) {
    throw new Error("원본 상품 컷아웃의 입력 이미지 근거를 확인하지 못했습니다.");
  }
  if (report.method !== "rectangle" && report.method !== "single-instance") {
    throw new Error("원본 상품 컷아웃이 허용되지 않은 분리 방법을 사용했습니다.");
  }
  if (!Number.isInteger(report.textCount)
      || !Number.isInteger(report.identityMatches)
      || !Number.isInteger(report.productTokenCount)
      || !Number.isInteger(report.productNameMatches)
      || !Number.isInteger(report.brandMatches)
      || !Number.isInteger(report.manufacturerMatches)
      || typeof report.gtinExpected !== "boolean"
      || typeof report.gtinMatch !== "boolean"
      || !Number.isInteger(report.evidenceSignals)) {
    throw new Error("원본 상품 컷아웃의 OCR 근거를 확인하지 못했습니다.");
  }
  if (!Number.isFinite(report.retainedRatio)
    || report.retainedRatio < MINIMUM_VISIBLE_PIXEL_RATIO
    || report.retainedRatio > (mode === "front" || mode === "subject" ? MAXIMUM_FRONT_PIXEL_RATIO : MAXIMUM_EVIDENCE_PIXEL_RATIO)) {
    throw new Error("원본 상품 컷아웃이 사진 장면 전체를 상품으로 잘못 분리했습니다.");
  }
  if (!Number.isFinite(report.boundingCoverage) || report.boundingCoverage < 0.45 || report.boundingCoverage > 1.01) {
    throw new Error("원본 상품 컷아웃의 장면 분리 밀도를 확인하지 못했습니다.");
  }
  const requiredFrontProductMatches = Math.min(3, report.productTokenCount);
  const frontFieldLinked = report.gtinMatch
    || (requiredFrontProductMatches >= 1
      && report.productNameMatches >= requiredFrontProductMatches
      && (requiredFrontProductMatches >= 3 || report.brandMatches + report.manufacturerMatches >= 1));
  if (mode === "front" && (!frontFieldLinked || report.textCount < 2 || report.score < 20)) {
    throw new Error("상품명과 일치하는 원본 정면 포장을 신뢰도 높게 확인하지 못했습니다.");
  }
  if (mode === "evidence" && (report.textCount < 6 || report.evidenceSignals < 1 || report.score < 9)) {
    throw new Error("원본 측면·후면 표시사항을 신뢰도 높게 확인하지 못했습니다.");
  }
  if (mode === "view" && (report.textCount < 2
      || (report.identityMatches < 1 && report.evidenceSignals < 1)
      || report.score < 10)) {
    throw new Error("원본 상품의 다른 실제 면을 상품명·표시사항과 연결하지 못했습니다.");
  }
  if ((mode === "subject" || mode === "alternate")
      && (report.method !== "single-instance" || report.instanceCount !== 1 || report.score < 8)) {
    throw new Error("원본 사진에서 장면과 분리된 단일 상품을 신뢰도 높게 확인하지 못했습니다.");
  }
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * Vision can occasionally join a shelf stand or a supporting hand to a printed,
 * rectangular carton. Only for a strongly rectangular, text-rich object, fit
 * the two long package edges from stable scanlines and remove outliers outside
 * those source-pixel edges. Irregular silhouettes never enter this cleanup.
 */
function pruneRectangularSceneAttachments(
  raw: Buffer,
  width: number,
  height: number,
  report: VisionCutoutReport,
) {
  if (report.textCount < 6) return false;
  const rows: Array<{ y: number; minX: number; maxX: number; span: number; opaque: number }> = [];
  for (let y = 0; y < height; y += 1) {
    let minX = width;
    let maxX = -1;
    let opaque = 0;
    for (let x = 0; x < width; x += 1) {
      if (raw[(y * width + x) * 4 + 3] < ALPHA_FOREGROUND_THRESHOLD) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      opaque += 1;
    }
    if (opaque > 0) rows.push({ y, minX, maxX, span: maxX - minX + 1, opaque });
  }
  if (rows.length < height * 0.45) return false;
  const typicalSpan = median(rows.map((row) => row.span));
  const visibleAspect = typicalSpan / rows.length;
  if (typicalSpan < width * 0.30 || (visibleAspect > 0.74 && visibleAspect < 1.35)) return false;
  const stable = rows.filter((row) => row.span >= typicalSpan * 0.90
    && row.span <= typicalSpan * 1.08
    && row.opaque / row.span >= 0.92);
  if (stable.length < rows.length * 0.58) return false;

  const fitLine = (selector: (row: (typeof stable)[number]) => number) => {
    const meanY = stable.reduce((sum, row) => sum + row.y, 0) / stable.length;
    const meanX = stable.reduce((sum, row) => sum + selector(row), 0) / stable.length;
    const denominator = stable.reduce((sum, row) => sum + (row.y - meanY) ** 2, 0);
    const slope = denominator > 0
      ? stable.reduce((sum, row) => sum + (row.y - meanY) * (selector(row) - meanX), 0) / denominator
      : 0;
    return { slope, intercept: meanX - slope * meanY };
  };
  const leftEdge = fitLine((row) => row.minX);
  const rightEdge = fitLine((row) => row.maxX);
  const residuals = stable.flatMap((row) => [
    Math.abs(row.minX - (leftEdge.slope * row.y + leftEdge.intercept)),
    Math.abs(row.maxX - (rightEdge.slope * row.y + rightEdge.intercept)),
  ]);
  if (median(residuals) > typicalSpan * 0.025) return false;

  const stableYs = stable.map((row) => row.y).sort((left, right) => left - right);
  const yMin = Math.max(0, stableYs[Math.floor(stableYs.length * 0.01)] - Math.ceil(height * 0.025));
  const yMax = Math.min(height - 1, stableYs[Math.floor(stableYs.length * 0.99)] + Math.ceil(height * 0.025));
  const edgeMargin = Math.max(3, Math.ceil(typicalSpan * 0.018));
  for (let y = 0; y < height; y += 1) {
    const allowedMin = Math.floor(leftEdge.slope * y + leftEdge.intercept - edgeMargin);
    const allowedMax = Math.ceil(rightEdge.slope * y + rightEdge.intercept + edgeMargin);
    for (let x = 0; x < width; x += 1) {
      if (y < yMin || y > yMax || x < allowedMin || x > allowedMax) {
        raw[(y * width + x) * 4 + 3] = 0;
      }
    }
  }
  return true;
}

function retainLargestAlphaComponent(raw: Buffer, width: number, height: number) {
  const pixels = width * height;
  const visited = new Uint8Array(pixels);
  const queue = new Uint32Array(pixels);
  let totalVisible = 0;
  let largestSize = 0;
  let largestSeed = -1;
  const visible = (index: number) => raw[index * 4 + 3] >= ALPHA_FOREGROUND_THRESHOLD;

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
    totalVisible += size;
    if (size > largestSize) {
      largestSize = size;
      largestSeed = start;
    }
  }
  if (largestSeed < 0 || totalVisible / pixels < MINIMUM_VISIBLE_PIXEL_RATIO) {
    throw new Error("원본 상품 전경 픽셀이 충분하지 않습니다.");
  }
  if (largestSize / totalVisible < MINIMUM_PRIMARY_COMPONENT_SHARE) {
    throw new Error("원본 컷아웃에 상품 외 장면이 함께 분리되어 안전하게 합성할 수 없습니다.");
  }

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
  return largestSize / pixels;
}

export async function loadVisionIdentityForeground(
  cutoutPath: string,
  report: VisionCutoutReport,
  mode: VisionCutoutMode,
): Promise<IdentityForeground> {
  assertVisionReport(report, mode);
  const source = await readFile(cutoutPath);
  const decoded = await sharp(source, {
    failOn: "warning",
    limitInputPixels: MAXIMUM_IDENTITY_SOURCE_PIXELS,
  }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = decoded.info;
  if (channels !== 4 || width < 120 || height < 120 || width * height > MAXIMUM_IDENTITY_SOURCE_PIXELS) {
    throw new Error("원본 상품 컷아웃의 픽셀 규격을 안전하게 확인하지 못했습니다.");
  }

  let retainedPixelRatio = 1;
  if (report.method === "single-instance") {
    retainedPixelRatio = retainLargestAlphaComponent(decoded.data, width, height);
    if (retainedPixelRatio > 0.985) {
      throw new Error("원본 사진 장면 전체가 상품으로 분리되어 합성을 중단했습니다.");
    }
    const prunedSceneAttachment = pruneRectangularSceneAttachments(decoded.data, width, height, report);
    if (report.boundingCoverage < (mode === "subject" || mode === "alternate" ? 0.78 : 0.70)
        && !prunedSceneAttachment) {
      throw new Error("원본 컷아웃에 손·진열대 또는 주변 장면이 연결되어 합성을 중단했습니다.");
    }
  }
  const cleaned = await sharp(decoded.data, { raw: { width, height, channels: 4 } })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer({ resolveWithObject: true });
  if (cleaned.info.width < 120 || cleaned.info.height < 120) {
    throw new Error("원본 상품 전경을 손실 없이 유지할 수 없습니다.");
  }
  return {
    buffer: cleaned.data,
    width: cleaned.info.width,
    height: cleaned.info.height,
    sourceDigest: createHash("sha256").update(cleaned.data).digest("hex"),
    retainedPixelRatio,
  };
}

export async function assertIdentityEvidenceLinkage(
  front: { foreground: IdentityForeground; report: VisionCutoutReport },
  evidence: { foreground: IdentityForeground; report: VisionCutoutReport },
  mode: "evidence" | "view" = "evidence",
) {
  if (front.report.inputIndex === evidence.report.inputIndex) {
    throw new Error("정면과 근거 사진이 같은 원본이어서 별도 표시사항 근거로 사용할 수 없습니다.");
  }
  const requiredProductMatches = Math.min(2, evidence.report.productTokenCount);
  const namedProductLinked = requiredProductMatches >= 1
    && evidence.report.productNameMatches >= requiredProductMatches
    && evidence.report.brandMatches + evidence.report.manufacturerMatches >= 1;
  if (mode === "evidence" && evidence.report.gtinExpected) {
    if (evidence.report.gtinMatch) return;
    throw new Error("근거 사진의 바코드가 판매자가 확정한 GTIN과 정확히 일치하지 않습니다.");
  }
  if (evidence.report.gtinMatch || namedProductLinked) return;
  throw new Error("근거 사진에서 판매자가 확정한 고유 상품명과 브랜드·제조사 조합을 함께 확인하지 못했습니다.");
}

export async function compositeIdentityForeground(
  background: Buffer,
  foreground: IdentityForeground,
  spec: IdentityAssetSpec,
) {
  const placement = boundedPlacement(spec);
  const renderedForeground = await sharp(foreground.buffer, {
    failOn: "warning",
    limitInputPixels: MAXIMUM_IDENTITY_SOURCE_PIXELS,
  }).rotate(sourceCompositeRotationDegrees[spec.id] ?? 0, {
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
    .resize(placement.width, placement.height, {
      fit: spec.identityPolicy.fit ?? "inside",
      withoutEnlargement: false,
      kernel: sharp.kernel.lanczos3,
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer({ resolveWithObject: true });
  const left = placement.left + Math.max(0, Math.floor((placement.width - renderedForeground.info.width) / 2));
  const top = placement.top + Math.max(0, Math.floor((placement.height - renderedForeground.info.height) / 2));
  const output = await sharp(background, {
    failOn: "warning",
    limitInputPixels: MAXIMUM_IDENTITY_SOURCE_PIXELS,
  })
    .resize(spec.width, spec.height, { fit: "cover", position: "centre" })
    .composite([{ input: renderedForeground.data, left, top }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const metadata = await sharp(output).metadata();
  if (metadata.width !== spec.width || metadata.height !== spec.height || metadata.format !== "png") {
    throw new Error(`${spec.id} 원본 상품 픽셀 합성 규격을 확인하지 못했습니다.`);
  }
  return output;
}

export async function renderIdentityOnNeutralCanvas(
  foreground: IdentityForeground,
  spec: IdentityAssetSpec,
) {
  const background = await sharp({
    create: {
      width: spec.width,
      height: spec.height,
      channels: 4,
      background: spec.identityPolicy.background,
    },
  }).png().toBuffer();
  return compositeIdentityForeground(background, foreground, spec);
}

export async function renderMissingIdentityEvidence(spec: IdentityAssetSpec) {
  const digest = createHash("sha256").update(`missing-evidence:${spec.id}`).digest();
  const frameWidth = Math.round(spec.width * (0.46 + (digest[0] % 13) / 100));
  const frameHeight = Math.round(spec.height * (0.36 + (digest[1] % 15) / 100));
  const left = Math.round((spec.width - frameWidth) * (0.18 + (digest[2] % 55) / 100));
  const top = Math.round((spec.height - frameHeight) * (0.14 + (digest[3] % 60) / 100));
  const border = Math.max(5, Math.round(Math.min(spec.width, spec.height) * 0.008));
  const markerSize = Math.max(18, Math.round(Math.min(spec.width, spec.height) * (0.035 + (digest[4] % 3) / 100)));
  const [frame, inset, marker] = await Promise.all([
    sharp({ create: { width: frameWidth, height: frameHeight, channels: 4, background: "#aab2ba" } }).png().toBuffer(),
    sharp({ create: { width: frameWidth - border * 2, height: frameHeight - border * 2, channels: 4, background: spec.identityPolicy.background } }).png().toBuffer(),
    sharp({ create: { width: markerSize, height: markerSize, channels: 4, background: "#7e8994" } }).png().toBuffer(),
  ]);
  const output = await sharp({
    create: {
      width: spec.width,
      height: spec.height,
      channels: 4,
      background: spec.identityPolicy.background,
    },
  }).composite([
    { input: frame, left, top },
    { input: inset, left: left + border, top: top + border },
    {
      input: marker,
      left: left + border * 3 + (digest[5] % Math.max(1, frameWidth - markerSize - border * 6)),
      top: top + border * 3 + (digest[6] % Math.max(1, frameHeight - markerSize - border * 6)),
    },
  ]).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  const metadata = await sharp(output).metadata();
  if (metadata.width !== spec.width || metadata.height !== spec.height || metadata.format !== "png") {
    throw new Error(`${spec.id} 미제공 근거 자리표시자 규격을 확인하지 못했습니다.`);
  }
  return output;
}

export async function assertIdentityBackgroundPlate(background: Buffer, spec: IdentityAssetSpec) {
  if (!Buffer.isBuffer(background) || background.length < 1 || background.length > 20 * 1024 * 1024) {
    throw new Error(`${spec.id} 배경판 바이트 크기가 안전 한도를 벗어났습니다.`);
  }
  const source = sharp(background, {
    failOn: "warning",
    limitInputPixels: MAXIMUM_IDENTITY_SOURCE_PIXELS,
  });
  const fullFrame = await source.clone().resize(128, 128, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const quantized = new Uint16Array(128 * 128);
  const binCounts = new Map<number, number>();
  for (let index = 0; index < quantized.length; index += 1) {
    const offset = index * 3;
    const key = (fullFrame[offset] >> 5) * 64 + (fullFrame[offset + 1] >> 5) * 8 + (fullFrame[offset + 2] >> 5);
    quantized[index] = key;
    binCounts.set(key, (binCounts.get(key) ?? 0) + 1);
  }
  const dominantKey = [...binCounts].sort((left, right) => right[1] - left[1])[0]?.[0] ?? -1;
  const dominantRgb = [
    ((dominantKey >> 6) & 7) * 32 + 16,
    ((dominantKey >> 3) & 7) * 32 + 16,
    (dominantKey & 7) * 32 + 16,
  ];
  const visited = new Uint8Array(quantized.length);
  const queue = new Uint16Array(quantized.length);
  const salientComponents: Array<{
    minX: number; minY: number; maxX: number; maxY: number; width: number; height: number; share: number;
  }> = [];
  for (let start = 0; start < quantized.length; start += 1) {
    const key = quantized[start];
    if (visited[start] || key === dominantKey || (binCounts.get(key) ?? 0) < quantized.length * 0.0025) continue;
    let head = 0;
    let tail = 1;
    let minX = 128;
    let minY = 128;
    let maxX = -1;
    let maxY = -1;
    queue[0] = start;
    visited[start] = 1;
    while (head < tail) {
      const index = queue[head++];
      const x = index % 128;
      const y = Math.floor(index / 128);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const add = (neighbor: number) => {
        if (visited[neighbor] || quantized[neighbor] !== key) return;
        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      };
      if (x > 0) add(index - 1);
      if (x < 127) add(index + 1);
      if (y > 0) add(index - 128);
      if (y < 127) add(index + 128);
    }
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const share = tail / quantized.length;
    const fill = tail / (width * height);
    const aspect = width / height;
    const rgb = [((key >> 6) & 7) * 32 + 16, ((key >> 3) & 7) * 32 + 16, (key & 7) * 32 + 16];
    const chroma = Math.max(...rgb) - Math.min(...rgb);
    const dominantDistance = Math.hypot(...rgb.map((value, index) => value - dominantRgb[index]));
    const detached = minX > 1 && minY > 1 && maxX < 126 && maxY < 126;
    if (detached && share >= 0.003 && share <= 0.40 && fill >= 0.58
        && aspect >= 0.15 && aspect <= 4 && (chroma >= 32 || dominantDistance >= 70)) {
      salientComponents.push({ minX, minY, maxX, maxY, width, height, share });
    }
  }
  const stackedMerchandiseShape = salientComponents.some((body) => salientComponents.some((cap) => {
    if (body === cap || body.share < 0.012 || body.height < cap.height * 1.6) return false;
    const verticalGap = body.minY - cap.maxY;
    const centersAligned = Math.abs((body.minX + body.maxX) / 2 - (cap.minX + cap.maxX) / 2) <= body.width * 0.18;
    return verticalGap >= -2 && verticalGap <= 4
      && cap.width >= body.width * 0.22 && cap.width <= body.width * 0.82
      && centersAligned;
  }));
  if (stackedMerchandiseShape) {
    throw new Error(`${spec.id} 배경판에서 뚜껑과 몸체가 연결된 상품·용기형 물체가 감지됐습니다.`);
  }

  const placement = boundedPlacement(spec);
  const sample = await source.extract(placement).resize(96, 96, { fit: "fill" }).greyscale().raw().toBuffer();
  let highContrastEdges = 0;
  let comparisons = 0;
  for (let y = 0; y < 96; y += 1) {
    for (let x = 0; x < 96; x += 1) {
      const value = sample[y * 96 + x];
      if (x + 1 < 96) {
        highContrastEdges += Math.abs(value - sample[y * 96 + x + 1]) >= 42 ? 1 : 0;
        comparisons += 1;
      }
      if (y + 1 < 96) {
        highContrastEdges += Math.abs(value - sample[(y + 1) * 96 + x]) >= 42 ? 1 : 0;
        comparisons += 1;
      }
    }
  }
  if (highContrastEdges / comparisons > 0.16) {
    throw new Error(`${spec.id} 배경판의 상품 배치 구역에 글자·포장처럼 보이는 고대비 물체가 있습니다.`);
  }
}
