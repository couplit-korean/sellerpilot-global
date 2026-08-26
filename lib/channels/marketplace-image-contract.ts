export const marketplaceGalleryAssetCount = 4;
export const marketplaceDetailAssetCount = 12;
export const marketplaceGeneratedAssetCount = marketplaceGalleryAssetCount + marketplaceDetailAssetCount;

// Channel APIs use eight localized detail panels even though the master page
// retains all twelve evidence and setting assets.
export const marketplaceChannelDetailImageCount = 8;
export const marketplaceMinimumThumbnailCount = 1;

export const marketplaceLocalizedDetailSectionTypes = [
  "overview",
  "feature",
  "howto",
  "spec",
  "routine",
  "contents",
  "care",
  "proof",
] as const;
