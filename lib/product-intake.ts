import { z } from "zod";
import { isResolvedProductFact } from "./product-facts";
import {
  maximumStudioSourceImageBytes,
  maximumStudioSourceImageDimension,
  maximumStudioSourceImagePixels,
  minimumStudioSourceImageDimension,
  studioSourceImageMediaTypes,
} from "./studio-source-photo-policy";

export const productCurrencies = [
  "KRW", "JPY", "USD", "SGD", "MYR", "PHP", "VND", "THB", "TWD", "BRL", "MXN", "IDR", "EUR",
] as const;

export const productConditions = ["NEW", "USED", "REFURBISHED"] as const;

const productIntakeShape = {
  researchInput: z.string().trim().min(2, "상품 링크나 설명을 2자 이상 입력해 주세요.").max(12_000),
  productName: z.string().trim().min(2, "상품명을 2자 이상 입력해 주세요.").max(160),
  sellerSku: z.string().trim().min(2, "판매자 SKU를 입력해 주세요.").max(100)
    .regex(/^[A-Za-z0-9._-]+$/, "SKU는 영문, 숫자, ., _, -만 사용할 수 있습니다."),
  categoryHint: z.string().trim().min(2, "카테고리 힌트를 입력해 주세요.").max(120),
  brandName: z.string().trim().min(1, "브랜드명 또는 No Brand를 입력해 주세요.").max(120),
  manufacturer: z.string().trim().min(1, "제조사·공급처를 입력해 주세요.").max(160),
  countryOfOrigin: z.string().trim().min(2, "원산지를 입력해 주세요.").max(80),
  material: z.string().trim().min(2, "소재·성분을 입력해 주세요.").max(500),
  packageContents: z.string().trim().min(2, "판매 구성품을 입력해 주세요.").max(500),
  condition: z.enum(productConditions),
  gtinStatus: z.enum(["HAS_GTIN", "NO_GTIN"]),
  gtin: z.string().trim().max(14),
  sellingPrice: z.number().finite().positive("판매가는 0보다 커야 합니다."),
  currency: z.enum(productCurrencies),
  stock: z.number().int().min(1, "업로드 테스트 재고는 1개 이상이어야 합니다.").max(999_999),
  weightKg: z.number().finite().positive("포장 중량을 입력해 주세요.").max(1_000),
  packageLengthCm: z.number().finite().positive("포장 가로를 입력해 주세요.").max(10_000),
  packageWidthCm: z.number().finite().positive("포장 세로를 입력해 주세요.").max(10_000),
  packageHeightCm: z.number().finite().positive("포장 높이를 입력해 주세요.").max(10_000),
  shippingFeeKrw: z.number().finite().min(0, "배송비는 0원 이상이어야 합니다.").max(100_000_000).default(0),
  shippingRule: z.string().trim().max(1000).default(""),
  packagingRule: z.string().trim().max(1000).default(""),
  description: z.string().trim().min(20, "용도·특징을 포함해 상품 설명을 20자 이상 입력해 주세요.").max(4_000),
  productUrl: z.string().trim().max(1_000).refine(
    (value) => value === "" || /^https?:\/\//i.test(value),
    "상품 링크는 http(s) 주소만 사용할 수 있습니다.",
  ),
  imageRightsConfirmed: z.literal(true, { error: "이미지·상품 자료 사용 권한을 확인해 주세요." }),
  productFactsConfirmed: z.literal(true, { error: "입력한 상품 정보가 실물과 일치함을 확인해 주세요." }),
};

function refineProductIntake(value: z.infer<z.ZodObject<typeof productIntakeShape>>, context: z.RefinementCtx) {
  for (const field of ["brandName", "manufacturer", "countryOfOrigin", "material", "packageContents"] as const) {
    if (!isResolvedProductFact(value[field])) {
      context.addIssue({ code: "custom", path: [field], message: "확인 필요 문구 대신 실물·공급처 기준 값을 입력해 주세요." });
    }
  }
  if (value.gtinStatus === "HAS_GTIN" && !/^\d{8,14}$/.test(value.gtin)) {
    context.addIssue({ code: "custom", path: ["gtin"], message: "GTIN/EAN/UPC를 8~14자리 숫자로 입력해 주세요." });
  }
  if (value.gtinStatus === "NO_GTIN" && value.gtin) {
    context.addIssue({ code: "custom", path: ["gtin"], message: "GTIN 없음을 선택한 경우 번호를 비워 주세요." });
  }
}

export const productIntakeSchema = z.object(productIntakeShape).superRefine(refineProductIntake);

export const productEditSchema = z.object({
  ...productIntakeShape,
  stock: z.number().int().min(0, "실재고는 0개 이상이어야 합니다.").max(999_999),
}).superRefine(refineProductIntake);

const productIntakeDraftShape = {
  researchInput: z.string().max(12_000),
  productName: z.string().max(160),
  sellerSku: z.string().max(100),
  categoryHint: z.string().max(120),
  brandName: z.string().max(120),
  manufacturer: z.string().max(160),
  countryOfOrigin: z.string().max(80),
  material: z.string().max(500),
  packageContents: z.string().max(500),
  condition: z.enum(productConditions),
  gtinStatus: z.enum(["HAS_GTIN", "NO_GTIN"]),
  gtin: z.string().max(14),
  sellingPrice: z.number().finite().min(0).max(1_000_000_000),
  currency: z.enum(productCurrencies),
  stock: z.number().int().min(0).max(999_999),
  weightKg: z.number().finite().min(0).max(1_000),
  packageLengthCm: z.number().finite().min(0).max(10_000),
  packageWidthCm: z.number().finite().min(0).max(10_000),
  packageHeightCm: z.number().finite().min(0).max(10_000),
  shippingFeeKrw: z.number().finite().min(0).max(100_000_000),
  shippingRule: z.string().max(1_000),
  packagingRule: z.string().max(1_000),
  description: z.string().max(4_000),
  productUrl: z.string().max(1_000),
  imageRightsConfirmed: z.boolean(),
  productFactsConfirmed: z.boolean(),
};

/**
 * Server draft validation deliberately accepts incomplete values. Publication and
 * product creation must continue to use productIntakeSchema/productEditSchema.
 */
export const productIntakeDraftSchema = z.object(productIntakeDraftShape).strict();

export const productIntakeDraftDecisionsSchema = z.object({
  condition: z.boolean(),
  gtinStatus: z.boolean(),
  currency: z.boolean(),
  shippingFeeKrw: z.boolean(),
}).strict();

export const emptyProductIntakeDraftDecisions = {
  condition: false,
  gtinStatus: false,
  currency: false,
  shippingFeeKrw: false,
} as const;

export function isProductIntakePublicationReady(
  value: unknown,
  decisions: ProductIntakeDraftDecisions,
) {
  return productIntakeSchema.safeParse(value).success
    && decisions.condition
    && decisions.gtinStatus
    && decisions.currency
    && decisions.shippingFeeKrw;
}

const productIntakeDraftFieldSchema = z.enum([
  "researchInput", "productName", "sellerSku", "categoryHint", "brandName", "manufacturer",
  "countryOfOrigin", "material", "packageContents", "condition", "gtinStatus", "gtin",
  "sellingPrice", "currency", "stock", "weightKg", "packageLengthCm", "packageWidthCm",
  "packageHeightCm", "shippingFeeKrw", "shippingRule", "packagingRule", "description", "productUrl",
  "imageRightsConfirmed", "productFactsConfirmed",
]);

const productIntakeDraftImageSelectionSchema = z.object({
  role: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(240),
  mediaType: z.string().trim().min(1).max(100),
  bytes: z.number().int().min(1).max(maximumStudioSourceImageBytes),
  originalWidth: z.number().int().min(1).max(maximumStudioSourceImageDimension),
  originalHeight: z.number().int().min(1).max(maximumStudioSourceImageDimension),
  uploadedPath: z.string().trim().min(1).max(400).refine(
    (value) => !value.includes("..") && !/^(?:blob:|data:|https?:|\/)/i.test(value),
    "업로드 원장 안의 상대 저장 경로만 초안에 보관할 수 있습니다.",
  ).nullable(),
}).strict();

export const productRegistrationIntakeDraftSchema = z.object({
  schemaVersion: z.literal(1),
  intake: productIntakeDraftSchema,
  decisions: productIntakeDraftDecisionsSchema,
  userEditedFields: z.array(productIntakeDraftFieldSchema).max(productIntakeDraftFieldSchema.options.length),
  imageSelections: z.array(productIntakeDraftImageSelectionSchema).max(100),
  researchJobId: z.string().uuid().nullable(),
}).strict();

export const normalizedProductImageSpecSchema = z.object({
  name: z.string().trim().min(1).max(240),
  role: z.string().trim().min(1).max(40),
  originalWidth: z.number().int().min(1).max(50_000),
  originalHeight: z.number().int().min(1).max(50_000),
  width: z.literal(1200),
  height: z.literal(1200),
  bytes: z.number().int().min(1).max(3 * 1024 * 1024),
  mediaType: z.literal("image/jpeg"),
  fit: z.literal("contain"),
});

export const sourcePreservingProductImageSpecSchema = normalizedProductImageSpecSchema.extend({
  originalWidth: z.number().int().min(minimumStudioSourceImageDimension).max(maximumStudioSourceImageDimension),
  originalHeight: z.number().int().min(minimumStudioSourceImageDimension).max(maximumStudioSourceImageDimension),
  originalName: z.string().trim().min(1).max(240),
  originalBytes: z.number().int().min(1).max(maximumStudioSourceImageBytes),
  originalMediaType: z.enum(studioSourceImageMediaTypes),
  originalPath: z.string().min(1).max(400),
}).superRefine((value, context) => {
  if (value.originalWidth > maximumStudioSourceImageDimension
      || value.originalHeight > maximumStudioSourceImageDimension
      || value.originalWidth * value.originalHeight > maximumStudioSourceImagePixels) {
    context.addIssue({
      code: "custom",
      path: ["originalWidth"],
      message: "원본 이미지는 1,600만 픽셀 이하여야 합니다.",
    });
  }
});

export type ProductIntakeFields = z.infer<typeof productIntakeSchema>;
export type NormalizedProductImageSpec = z.infer<typeof normalizedProductImageSpecSchema>;
export type SourcePreservingProductImageSpec = z.infer<typeof sourcePreservingProductImageSpecSchema>;
export type ProductIntakeDraft = z.infer<typeof productIntakeDraftSchema>;
export type ProductIntakeDraftDecisions = z.infer<typeof productIntakeDraftDecisionsSchema>;
export type ProductRegistrationIntakeDraft = z.infer<typeof productRegistrationIntakeDraftSchema>;

export const emptyProductIntake: ProductIntakeDraft = {
  researchInput: "",
  productName: "",
  sellerSku: "",
  categoryHint: "",
  brandName: "",
  manufacturer: "",
  countryOfOrigin: "",
  material: "",
  packageContents: "",
  condition: "NEW",
  gtinStatus: "NO_GTIN",
  gtin: "",
  sellingPrice: 0,
  currency: "KRW",
  stock: 0,
  weightKg: 0,
  packageLengthCm: 0,
  packageWidthCm: 0,
  packageHeightCm: 0,
  shippingFeeKrw: 0,
  shippingRule: "",
  packagingRule: "",
  description: "",
  productUrl: "",
  imageRightsConfirmed: false,
  productFactsConfirmed: false,
};
