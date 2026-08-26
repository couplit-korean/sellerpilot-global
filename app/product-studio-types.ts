export type StudioMode = "cli";

export type DetailImageAsset =
  | "none"
  | "detail-overview"
  | "detail-feature"
  | "detail-use"
  | "detail-package"
  | "detail-routine"
  | "detail-scale"
  | "detail-storage"
  | "detail-context"
  | "detail-material"
  | "detail-dimensions"
  | "detail-contents"
  | "detail-care";

export type DetailLayout = "split" | "full-bleed" | "cards" | "steps" | "spec-grid" | "editorial";

export type DetailMotion = "none" | "reveal" | "stagger";

export type DetailSection = {
  type: "benefit" | "story" | "howto" | "proof" | "spec" | "caution" | "comparison" | "faq" | "notice";
  buyerQuestion: string;
  evidence: string;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  layout: DetailLayout;
  imageAsset: DetailImageAsset;
  visualDirection: string;
  motion: DetailMotion;
};

export type ProductClassification = {
  displayName: string;
  verificationStatus: "verified" | "needs-review";
  evidence: string;
  isHealthFunctionalFood: boolean | null;
};

export type LocalizedListing = {
  channel: "qoo10" | "shopee" | "lazada" | "coupang" | "elevenst" | "smartstore" | "ebay" | "temu";
  market: string;
  locale: string;
  title: string;
  shortDescription: string;
  description: string;
  keywords: string[];
  thumbnailAltText: string;
  classification: ProductClassification;
  detailSections: Array<{
    type: "overview" | "feature" | "howto" | "spec" | "routine" | "contents" | "care" | "proof";
    buyerQuestion: string;
    evidence: string;
    heading: string;
    body: string;
    imageAsset: Exclude<DetailImageAsset, "none">;
    imageAltText: string;
  }>;
};

export type ProductStudioResult = {
  mode: StudioMode;
  product: {
    name: string;
    category: string;
    classification: ProductClassification;
    oneLine: string;
    targetCustomer: string;
    features: string[];
    cautions: string[];
  };
  design: {
    themeName: string;
    creativeStrategy: {
      designArchetype: "proof-led" | "problem-solution" | "routine-led" | "comparison-led" | "material-led" | "fit-guide" | "gift-story" | "spec-first";
      purchaseDecision: string;
      contentDensity: "long" | "deep-dive";
      targetSectionCount: number;
      lengthRationale: string;
      differentiationKey: string;
      artDirection: string;
      motionPolicy: "static-first";
    };
    palette: {
      primary: string;
      accent: string;
      surface: string;
      text: string;
    };
    heroCopy: string;
    heroSubcopy: string;
    cta: string;
    sections: DetailSection[];
  };
  thumbnail: {
    headline: string;
    subline: string;
    badge: string;
  };
  localizedListings: LocalizedListing[];
  warnings: string[];
};
