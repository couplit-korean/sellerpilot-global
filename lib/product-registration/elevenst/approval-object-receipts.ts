import { createHash } from "node:crypto";
import { elevenstNewProductSourceDigest } from "./new-product-input-source";

type ObjectReader = (bucket: string, path: string) => Promise<{
  data: Blob | null;
  error: unknown;
}>;

export async function readElevenstApprovalObjectReceipts(input: {
  ownerId: string;
  productImagePaths: string[];
  detailImagePaths: string[];
  detailImageBucket: "sellerpilot-ai" | "sellerpilot-detail-imports";
}, read: ObjectReader) {
  const invalidPath = (path: string) => !path || path.includes("..") || path.includes("\\") || /[\x00-\x1f]/u.test(path);
  if (input.productImagePaths.length !== 4 || input.detailImagePaths.length !== 8
    || input.productImagePaths.some(path => invalidPath(path) || !path.startsWith(`${input.ownerId}/`))
    || input.detailImagePaths.some(path => invalidPath(path) || !path.startsWith(
      input.detailImageBucket === "sellerpilot-ai" ? "results/" : "external-detail/"))) {
    throw new Error("ELEVENST_APPROVED_ASSET_OBJECT_PATH_INVALID");
  }
  const objects = [
    ...input.productImagePaths.map(path => ({ bucket: "sellerpilot-ai", path })),
    ...input.detailImagePaths.map(path => ({ bucket: input.detailImageBucket, path })),
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
      receipts[index] = {
        ...object,
        bytesSha256: createHash("sha256").update(bytes).digest("hex"),
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
