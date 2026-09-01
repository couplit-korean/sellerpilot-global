import { marketplaceChannelDetailImageCount } from "./marketplace-image-contract";

export const temuExactExistingUpdateContract =
  "temu_exact_existing_active_content_update_v1" as const;
export const temuExactExistingUpdateArgument =
  "sellerpilotTemuExactExistingUpdate" as const;
export const temuExactPreservedAssetsArgument =
  "sellerpilotTemuExactPreservedAssets" as const;
export const temuExactPreservedAssetsContract =
  "temu_exact_preserved_assets_v1" as const;

export const temuExactExistingUpdateIdentity = {
  productId: "ddccde35-9c58-4856-b673-d7aa27ce4220",
  sourceSellerSku: "QA-20260823-CC-001",
  goodsId: "608570473054515",
  skuId: "123896921649274",
  market: "KR",
  targetId: "KR",
  currency: "KRW",
  price: 5_000,
  stock: 1,
  locale: "ko-KR",
  providerOperation: "bg.local.goods.partial.update",
  representativeImageCount: 1,
  detailImageCount: marketplaceChannelDetailImageCount,
} as const;

export function temuExactExistingUpdateCandidate(input: {
  channel: string;
  operation: string;
  productId?: string;
  remoteId?: string | null;
  status?: string | null;
  requestedPublicationIntent?: string | null;
  remoteVisibility?: string | null;
}) {
  return input.channel === "temu"
    && input.operation === "listing.update"
    && input.productId === temuExactExistingUpdateIdentity.productId
    && input.remoteId === temuExactExistingUpdateIdentity.goodsId
    && input.status === "published"
    && input.requestedPublicationIntent === "live"
    && input.remoteVisibility === "live";
}
