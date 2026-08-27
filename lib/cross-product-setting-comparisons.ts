import { z } from "zod";

export const crossProductSettingAssetIds = [
  "portrait",
  "wide",
  "detail-overview",
  "detail-use",
  "detail-routine",
  "detail-scale",
  "detail-storage",
  "detail-context",
] as const;

const crossProductSettingAssetFiles = {
  portrait: "thumbnail-portrait.png",
  wide: "thumbnail-wide.png",
  "detail-overview": "detail-overview.png",
  "detail-use": "detail-use.png",
  "detail-routine": "detail-routine.png",
  "detail-scale": "detail-scale.png",
  "detail-storage": "detail-storage.png",
  "detail-context": "detail-context.png",
} as const satisfies Record<(typeof crossProductSettingAssetIds)[number], string>;

const UUID_PATH_PART = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

function storagePathSchema(fileName: string) {
  return z.string().min(1).max(400).regex(new RegExp(
    `^results/${UUID_PATH_PART}/claims/${UUID_PATH_PART}/${fileName.replace(".", "\\.")}$`,
  ));
}

const assetPathsSchema = z.object({
  portrait: storagePathSchema(crossProductSettingAssetFiles.portrait),
  wide: storagePathSchema(crossProductSettingAssetFiles.wide),
  "detail-overview": storagePathSchema(crossProductSettingAssetFiles["detail-overview"]),
  "detail-use": storagePathSchema(crossProductSettingAssetFiles["detail-use"]),
  "detail-routine": storagePathSchema(crossProductSettingAssetFiles["detail-routine"]),
  "detail-scale": storagePathSchema(crossProductSettingAssetFiles["detail-scale"]),
  "detail-storage": storagePathSchema(crossProductSettingAssetFiles["detail-storage"]),
  "detail-context": storagePathSchema(crossProductSettingAssetFiles["detail-context"]),
}).strict();

const sceneIdentityText = (maximum: number) => z.string()
  .trim()
  .min(1)
  .max(maximum)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "장면 식별 문자열에 제어 문자를 포함할 수 없습니다.");

const crossProductComparisonProductSchema = z.object({
  sourceJobId: z.string().uuid(),
  sceneIdentity: z.object({
    category: sceneIdentityText(120),
    name: sceneIdentityText(160),
  }).strict(),
  assets: assetPathsSchema,
}).strict();

export const crossProductSettingComparisonsSchema = z.object({
  version: z.literal(1),
  productCount: z.number().int().min(0).max(8),
  assetCount: z.number().int().min(0).max(64),
  products: z.array(crossProductComparisonProductSchema).max(8),
}).strict().superRefine((value, context) => {
  if (value.productCount !== value.products.length || value.assetCount !== value.products.length * 8) {
    context.addIssue({ code: "custom", message: "교차 상품 비교 개수 계약이 일치하지 않습니다." });
  }
  const sourceJobIds = value.products.map((product) => product.sourceJobId);
  if (new Set(sourceJobIds).size !== sourceJobIds.length) {
    context.addIssue({ code: "custom", path: ["products"], message: "교차 상품 비교 작업이 중복되었습니다." });
  }
  const paths = value.products.flatMap((product) => (
    crossProductSettingAssetIds.map((assetId) => product.assets[assetId])
  ));
  if (new Set(paths).size !== paths.length) {
    context.addIssue({ code: "custom", path: ["products"], message: "교차 상품 비교 이미지 경로가 중복되었습니다." });
  }
});

export type CrossProductSettingComparisons = z.infer<typeof crossProductSettingComparisonsSchema>;
