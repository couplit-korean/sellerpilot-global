import { createHash } from "node:crypto";
import { elevenstNewProductSourceDigest } from "./new-product-input-source";
import { canonicalProductDetailImageManifestInput, isProductDetailImageRole, type ProductDetailImageManifestEntry } from "../../product-detail-image-manifest";

type ObjectReader = (bucket: string, path: string) => Promise<{
  data: Blob | null;
  error: unknown;
}>;

export async function readElevenstApprovalObjectReceipts(input: {
  ownerId: string;
  productImagePaths: string[];
  detailImagePaths: string[];
  detailImageBucket: "sellerpilot-ai" | "sellerpilot-detail-imports";
  productImageSha256s?: string[];
  detailImageSha256s?: string[];
  detailManifestDigest?: string;
}, read: ObjectReader) {
  const invalidPath = (path: string) => !path || path.includes("..") || path.includes("\\") || /[\x00-\x1f]/u.test(path);
  const generatedProducts = input.productImagePaths.some(path => path.startsWith("results/"));
  if (input.productImagePaths.length !== 4 || input.detailImagePaths.length !== 8
    || input.productImagePaths.some(path => invalidPath(path) || !path.startsWith(generatedProducts ? "results/" : `${input.ownerId}/`))
    || input.detailImagePaths.some(path => invalidPath(path) || !path.startsWith(
      input.detailImageBucket === "sellerpilot-ai" ? "results/" : "external-detail/"))) {
    throw new Error("ELEVENST_APPROVED_ASSET_OBJECT_PATH_INVALID");
  }
  if (generatedProducts) {
    const hashes = input.detailImageSha256s;
    const productHashes = input.productImageSha256s;
    const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
    const generatedPath = new RegExp(`^(results/${uuid}/claims/${uuid}/)(detail-[a-z-]+)\\.png$`, "u");
    const matches = input.detailImagePaths.map(path => generatedPath.exec(path));
    if (input.detailImageBucket !== "sellerpilot-ai"
      || !Array.isArray(hashes) || hashes.length !== 8
      || !Array.isArray(productHashes) || productHashes.length !== 4
      || [...hashes, ...productHashes].some(hash => !/^[a-f0-9]{64}$/u.test(hash))
      || matches.some(match => !match || match[1] !== matches[0]?.[1] || !isProductDetailImageRole(match[2]))
      || new Set(input.detailImagePaths).size !== 8
      || input.productImagePaths.some((path,index) => path !== input.detailImagePaths[index] || productHashes[index] !== hashes[index])) {
      throw new Error("ELEVENST_APPROVED_GENERATED_ASSET_BINDING_INVALID");
    }
    const entries = input.detailImagePaths.map((path,index) => ({ role: matches[index]![2], path, sourceSha256: hashes[index] })) as ProductDetailImageManifestEntry[];
    const manifestDigest = createHash("sha256").update(canonicalProductDetailImageManifestInput(entries), "utf8").digest("hex");
    if (manifestDigest !== input.detailManifestDigest) throw new Error("ELEVENST_APPROVED_GENERATED_MANIFEST_MISMATCH");
  }
  const objects = [
    ...input.productImagePaths.map((path,index) => ({ bucket: "sellerpilot-ai", path, expectedSha256: input.productImageSha256s?.[index] })),
    ...input.detailImagePaths.map((path,index) => ({ bucket: input.detailImageBucket, path, expectedSha256: input.detailImageSha256s?.[index] })),
  ];
  const receipts = new Array<{
    bucket: string; path: string; bytesSha256: string; contentLength: number; contentType: string;
  }>(objects.length);
  let next = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < objects.length) {
      const index = next++;
      const object = objects[index];
      const result = await read(object.bucket, object.path);
      const blob = result.data;
      if (result.error || !blob || blob.size < 1 || blob.size > 20 * 1024 * 1024
        || !/^image\/[a-z0-9.+-]+$/u.test(blob.type)) {
        throw new Error("ELEVENST_APPROVED_ASSET_OBJECT_UNAVAILABLE");
      }
      const bytes = Buffer.from(await blob.arrayBuffer());
      const bytesSha256 = createHash("sha256").update(bytes).digest("hex");
      if (object.expectedSha256 && bytesSha256 !== object.expectedSha256) {
        throw new Error("ELEVENST_APPROVED_ASSET_BYTES_MISMATCH");
      }
      receipts[index] = {
        bucket: object.bucket,
        path: object.path,
        bytesSha256,
        contentLength: bytes.byteLength,
        contentType: blob.type,
      };
    }
  }));
  return {
    productImageBucket: "sellerpilot-ai",
    detailImageBucket: input.detailImageBucket,
    productImagePaths: input.productImagePaths,
    detailImagePaths: input.detailImagePaths,
    objectReceipts: receipts,
    objectReceiptsSha256: elevenstNewProductSourceDigest(receipts),
  };
}
